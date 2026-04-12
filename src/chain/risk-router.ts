/**
 * ERC-8004 Risk Router — hackathon on-chain trade submission.
 *
 * Every trade is submitted to the hackathon Risk Router contract as a
 * signed TradeIntent (EIP-712). The router enforces position limits,
 * max leverage, whitelisted markets, and daily loss limits on-chain.
 *
 * Flow:
 *   1. Sign TradeIntent with EIP-712 (agent wallet)
 *   2. Submit to Risk Router contract → emits on-chain event
 *   3. Router validates + records PnL → feeds leaderboard
 *
 * Contracts on Sepolia:
 *   Risk Router:      0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC
 *   Hackathon Vault:  0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90
 *   Agent Registry:   0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3
 *   Reputation:       0x423a9904e39537a9997fbaF0f220d79D7d545763
 */

import { ethers } from 'ethers';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { signTradeIntent } from './eip712.js';

const log = createLogger('ROUTER');

// ── ABIs ─────────────────────────────────────────────────────────────────────

const RISK_ROUTER_ABI = [
  // Submit a signed trade intent (tuple form — verified against deployed bytecode)
  'function submitTradeIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent, bytes signature) external',
  // Dry-run — returns (valid, reason) without spending gas on a rejected trade
  'function simulateIntent(tuple(uint256 agentId, address agentWallet, string pair, string action, uint256 amountUsdScaled, uint256 maxSlippageBps, uint256 nonce, uint256 deadline) intent) external view returns (bool valid, string reason)',
  // Per-agent nonce (starts at 0, increments on each approved intent)
  'function getIntentNonce(uint256 agentId) external view returns (uint256)',
  // Events
  'event TradeApproved(uint256 indexed agentId, bytes32 indexed intentHash, uint256 amountUsdScaled)',
  'event TradeRejected(uint256 indexed agentId, bytes32 indexed intentHash, string reason)',
];

const VAULT_ABI = [
  // Claim sandbox capital allocation for this agent
  'function claimAllocation(uint256 agentId) external returns (uint256 amount)',
  // Check claimed balance
  'function balanceOf(uint256 agentId) external view returns (uint256)',
  // Has this agent already claimed?
  'function hasClaimed(uint256 agentId) external view returns (bool)',
];

const AGENT_REGISTRY_ABI = [
  'function register(address agentWallet, string name, string description, string[] capabilities, string agentURI) external returns (uint256 agentId)',
  'function isRegistered(uint256 agentId) external view returns (bool)',
  'function getAgent(uint256 agentId) external view returns (tuple(address operatorWallet, address agentWallet, string name, string description, string[] capabilities, uint256 registeredAt, bool active))',
  'event AgentRegistered(uint256 indexed agentId, address indexed operatorWallet, address indexed agentWallet)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REPUTATION_ABI = [
  // Post a validation score for this agent
  'function recordScore(uint256 agentId, uint256 score, string reason) external',
  // Read current reputation
  'function getScore(uint256 agentId) external view returns (uint256)',
];

// ── Provider / wallet ─────────────────────────────────────────────────────────

function getWallet(): ethers.Wallet | null {
  const key = config.agentWalletPrivateKey || config.privateKey;
  if (!key || !config.rpcUrl) return null;
  try {
    return new ethers.Wallet(key, new ethers.JsonRpcProvider(config.rpcUrl));
  } catch {
    return null;
  }
}

// Per-agent nonce — must match _intentNonces[agentId] on the Risk Router (starts at 0).
// We fetch the on-chain value before the first submission and track it locally.
const _agentNonce: Record<number, number> = {};

async function getNextNonce(router: ethers.Contract, agentId: number): Promise<number> {
  if (_agentNonce[agentId] == null) {
    const onChain = await router.getIntentNonce(agentId);
    _agentNonce[agentId] = Number(onChain);
    log.info(`[ROUTER] Nonce for agentId=${agentId}: ${_agentNonce[agentId]} (from chain)`);
  }
  return _agentNonce[agentId];
}

// ── Agent registration ────────────────────────────────────────────────────────

export async function registerAgent(): Promise<number | null> {
  const wallet = getWallet();
  if (!wallet || !config.agentRegistryAddress) return null;

  try {
    const registry = new ethers.Contract(config.agentRegistryAddress, AGENT_REGISTRY_ABI, wallet);

    const metadataUri = JSON.stringify({
      name:        config.agentName,
      description: config.agentDescription,
      version:     '3.0.0',
      strategy:    'ICT/SMC Order Block + Engulfing + Momentum',
      wallet:      wallet.address,
      timestamp:   new Date().toISOString(),
    });

    log.info('[ROUTER] Registering agent on ERC-8004 registry...');
    const tx = await registry.register(
      wallet.address,
      config.agentName,
      config.agentDescription,
      ['trading', 'eip712-signing', 'risk-management', 'smc-order-block'],
      `data:application/json,${encodeURIComponent(metadataUri)}`,
    );
    const receipt = await tx.wait();

    // Parse agentId from event logs
    const iface = new ethers.Interface(AGENT_REGISTRY_ABI);
    for (const evLog of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...evLog.topics], data: evLog.data });
        if (parsed?.name === 'AgentRegistered') {
          const agentId = Number(parsed.args.agentId);
          log.info(`[ROUTER] Agent registered — agentId=${agentId} | tx=${tx.hash}`);
          return agentId;
        }
        if (parsed?.name === 'Transfer' && parsed.args[0] === ethers.ZeroAddress) {
          const agentId = Number(parsed.args[2]);
          log.info(`[ROUTER] Agent registered — agentId=${agentId} | tx=${tx.hash}`);
          return agentId;
        }
      } catch {}
    }

    log.info(`[ROUTER] Registration tx sent: ${tx.hash}`);
    return null;
  } catch (e) {
    log.warn(`[ROUTER] Agent registration failed: ${e}`);
    return null;
  }
}

// ── Vault capital claim ───────────────────────────────────────────────────────

export async function claimVaultCapital(agentId: number): Promise<{ claimed: boolean; amount: string }> {
  const wallet = getWallet();
  if (!wallet || !config.hackathonVaultAddress) return { claimed: false, amount: '0' };

  try {
    const vault = new ethers.Contract(config.hackathonVaultAddress, VAULT_ABI, wallet);

    // Check if already claimed
    try {
      const claimed = await vault.hasClaimed(agentId);
      if (claimed) {
        const bal = await vault.balanceOf(agentId).catch(() => 0n);
        log.info(`[ROUTER] Vault already claimed — balance=${ethers.formatEther(bal)} ETH`);
        return { claimed: true, amount: ethers.formatEther(bal) };
      }
    } catch { /* hasClaimed not supported — try claiming */ }

    log.info('[ROUTER] Claiming vault sandbox capital...');
    const tx = await vault.claimAllocation(agentId);
    await tx.wait();
    log.info(`[ROUTER] Vault capital claimed | tx=${tx.hash}`);
    return { claimed: true, amount: 'claimed' };
  } catch (e: any) {
    // "already claimed" is expected after first run — not an error
    if (e?.reason?.includes('already claimed') || e?.message?.includes('already claimed')) {
      log.info('[ROUTER] Vault already claimed (OK)');
      return { claimed: true, amount: 'previously claimed' };
    }
    log.warn(`[ROUTER] Vault claim failed: ${e?.reason ?? e?.message}`);
    return { claimed: false, amount: '0' };
  }
}

// ── Trade intent submission ───────────────────────────────────────────────────

export interface RouterSubmitResult {
  submitted: boolean;
  intentId: string | null;
  txHash: string | null;
  error: string | null;
}

export async function submitTradeIntent(params: {
  agentId: number;
  symbol: string;
  direction: 'buy' | 'sell';
  price: number;
  size: number;
  stopLoss: number;
  takeProfit: number;
}): Promise<RouterSubmitResult> {
  const wallet = getWallet();
  if (!wallet || !config.riskRouterAddress) {
    return { submitted: false, intentId: null, txHash: null, error: 'No wallet or router address' };
  }

  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min window
  // amountUsdScaled: contract uses USD * 100 (e.g. $500 → 50000)
  const amountUsdScaled = Math.round(params.price * params.size * 100);
  const maxSlippageBps = 100; // 1% slippage tolerance
  // Contract verifies EIP-712 hash with uppercase strings — sign and submit must match exactly
  const action = params.direction.toUpperCase(); // "BUY" | "SELL"
  const pair   = params.symbol.toUpperCase();    // "BTCUSD" etc.

  try {
    const router = new ethers.Contract(config.riskRouterAddress, RISK_ROUTER_ABI, wallet);

    // Fetch on-chain nonce — contract requires intent.nonce == getIntentNonce(agentId)
    const nonce = await getNextNonce(router, params.agentId);

    const intentTuple = {
      agentId:         BigInt(params.agentId),
      agentWallet:     wallet.address,
      pair,
      action,
      amountUsdScaled: BigInt(amountUsdScaled),
      maxSlippageBps:  BigInt(maxSlippageBps),
      nonce:           BigInt(nonce),
      deadline:        BigInt(deadline),
    };

    // Dry-run before spending gas
    try {
      const [valid, reason] = await router.simulateIntent(intentTuple);
      if (!valid) {
        log.warn(`[ROUTER] simulateIntent rejected: ${reason}`);
        return { submitted: false, intentId: null, txHash: null, error: reason };
      }
    } catch { /* simulateIntent failure is non-fatal — proceed anyway */ }

    // Sign the TradeIntent with EIP-712 (RiskRouter domain)
    const signature = await signTradeIntent({
      agentId:         params.agentId,
      agentWallet:     wallet.address,
      pair,
      action,
      amountUsdScaled,
      maxSlippageBps,
      nonce,
      deadline,
    });

    if (!signature) {
      return { submitted: false, intentId: null, txHash: null, error: 'Signing failed — no private key' };
    }

    log.info(`[ROUTER] Submitting TradeIntent: ${action} ${pair} ~$${(amountUsdScaled / 100).toFixed(2)} | nonce=${nonce}`);

    const tx = await router.submitTradeIntent(intentTuple, signature);
    const receipt = await tx.wait();

    // Intent approved — increment local nonce to stay in sync
    _agentNonce[params.agentId] = nonce + 1;

    // Parse TradeApproved / TradeRejected events
    let intentId: string | null = null;
    let rejectReason: string | null = null;
    const iface = new ethers.Interface(RISK_ROUTER_ABI);
    for (const l of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...l.topics], data: l.data });
        if (parsed?.name === 'TradeApproved') intentId = parsed.args.intentHash as string;
        if (parsed?.name === 'TradeRejected') rejectReason = parsed.args.reason as string;
      } catch {}
    }

    if (rejectReason) {
      log.warn(`[ROUTER] Trade rejected on-chain: ${rejectReason}`);
      return { submitted: false, intentId: null, txHash: receipt.hash, error: rejectReason };
    }

    log.info(`[ROUTER] ✓ Intent submitted | intentHash=${intentId ?? 'unknown'} | tx=${receipt.hash}`);
    return { submitted: true, intentId, txHash: receipt.hash, error: null };

  } catch (e: any) {
    const msg = e?.reason ?? e?.message ?? String(e);
    log.warn(`[ROUTER] Submit failed: ${msg}`);
    return { submitted: false, intentId: null, txHash: null, error: msg };
  }
}

// ── Close position on-chain ───────────────────────────────────────────────────

export async function closeTradeIntent(intentId: string, exitPrice: number): Promise<string | null> {
  const wallet = getWallet();
  if (!wallet || !config.riskRouterAddress || !intentId) return null;

  try {
    const router = new ethers.Contract(config.riskRouterAddress, RISK_ROUTER_ABI, wallet);
    const tx = await router.closePosition(intentId, BigInt(Math.round(exitPrice * 1e8)));
    await tx.wait();
    log.info(`[ROUTER] Position closed on-chain | intentId=${intentId} | exit=${exitPrice}`);
    return tx.hash;
  } catch (e) {
    log.warn(`[ROUTER] Close position failed: ${e}`);
    return null;
  }
}

// ── Reputation score post ─────────────────────────────────────────────────────

export async function postReputationScore(agentId: number, score: number, reason: string): Promise<boolean> {
  const wallet = getWallet();
  if (!wallet || !config.reputationRegistry) return false;

  try {
    const rep = new ethers.Contract(config.reputationRegistry, REPUTATION_ABI, wallet);
    const scoreBps = Math.round(score * 100); // 0-10000 basis points
    const tx = await rep.recordScore(agentId, scoreBps, reason);
    await tx.wait();
    log.info(`[ROUTER] Reputation score posted: ${score.toFixed(2)} (${scoreBps} bps)`);
    return true;
  } catch (e) {
    log.warn(`[ROUTER] Reputation post failed: ${e}`);
    return false;
  }
}
