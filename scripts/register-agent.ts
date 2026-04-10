/**
 * ERC-8004 Agent Registration Script
 *
 * Run once to:
 *   1. Register your agent on the Sepolia Agent Registry (mints ERC-721)
 *   2. Claim sandbox capital from the Hackathon Vault
 *   3. Save agentId to agent-id.json (auto-loaded on next run)
 *
 * Usage:
 *   npx tsx scripts/register-agent.ts
 *
 * Requirements:
 *   - PRIVATE_KEY in .env (Sepolia wallet with some test ETH for gas)
 *   - RPC_URL in .env (default: https://1rpc.io/sepolia)
 *
 * Get free Sepolia ETH: https://sepoliafaucet.com
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const config = {
  privateKey:           process.env.PRIVATE_KEY || process.env.AGENT_WALLET_PRIVATE_KEY || '',
  rpcUrl:               process.env.RPC_URL || 'https://1rpc.io/sepolia',
  agentName:            process.env.AGENT_NAME || 'Sentinel',
  agentDescription:     process.env.AGENT_DESCRIPTION || 'Institutional SMC trading agent',
  agentRegistryAddress: process.env.AGENT_REGISTRY_ADDRESS || '0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3',
  hackathonVaultAddress:process.env.HACKATHON_VAULT_ADDRESS || '0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90',
};

const REGISTRY_ABI = [
  'function register(address agentWallet, string name, string description, string[] capabilities, string agentURI) external returns (uint256 agentId)',
  'function isRegistered(uint256 agentId) external view returns (bool)',
  'function getAgent(uint256 agentId) external view returns (tuple(address operatorWallet, address agentWallet, string name, string description, string[] capabilities, uint256 registeredAt, bool active))',
  'event AgentRegistered(uint256 indexed agentId, address indexed operatorWallet, address indexed agentWallet)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const VAULT_ABI = [
  'function claimAllocation(uint256 agentId) external returns (uint256)',
  'function balanceOf(uint256 agentId) external view returns (uint256)',
  'function hasClaimed(uint256 agentId) external view returns (bool)',
];

const ID_FILE = join(process.cwd(), 'agent-id.json');

function loadSavedId(): number | null {
  if (!existsSync(ID_FILE)) return null;
  try { return JSON.parse(readFileSync(ID_FILE, 'utf-8')).agentId ?? null; } catch { return null; }
}

function saveId(agentId: number): void {
  writeFileSync(ID_FILE, JSON.stringify({ agentId, registeredAt: new Date().toISOString() }, null, 2));
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   Sentinel v3 — ERC-8004 Agent Registration  ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // ── Preflight checks ────────────────────────────────────────────────────────
  if (!config.privateKey) {
    console.error('✗ PRIVATE_KEY not set in .env');
    console.error('  Add your Sepolia wallet private key:');
    console.error('  PRIVATE_KEY=0x...\n');
    console.error('  Get free Sepolia ETH at: https://sepoliafaucet.com');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet   = new ethers.Wallet(config.privateKey, provider);

  console.log(`Wallet   : ${wallet.address}`);
  console.log(`Network  : Sepolia (${config.rpcUrl})`);
  console.log(`Registry : ${config.agentRegistryAddress}`);
  console.log(`Vault    : ${config.hackathonVaultAddress}\n`);

  // Check ETH balance
  const balance = await provider.getBalance(wallet.address);
  const ethBal  = ethers.formatEther(balance);
  console.log(`ETH balance: ${parseFloat(ethBal).toFixed(4)} ETH`);

  if (balance < ethers.parseEther('0.001')) {
    console.error('\n✗ Not enough Sepolia ETH for gas (need ~0.001 ETH)');
    console.error('  Get free ETH at: https://sepoliafaucet.com');
    process.exit(1);
  }

  // ── Check if already registered ────────────────────────────────────────────
  const savedId = loadSavedId();
  if (savedId != null && savedId > 0) {
    console.log(`\n✓ Already registered — agentId=${savedId} (from agent-id.json)`);

    const registry = new ethers.Contract(config.agentRegistryAddress, REGISTRY_ABI, provider);
    try {
      const data = await registry.getAgent(savedId);
      console.log(`  Name   : ${data[1]}`);
      console.log(`  Active : ${data[2]}`);
      console.log(`  Wallet : ${data[0]}`);
    } catch {
      console.log('  (could not verify on-chain — registry may differ)');
    }

    await tryClaimVault(wallet, savedId);
    printEnvLine(savedId);
    return;
  }

  // ── Register agent ──────────────────────────────────────────────────────────
  console.log('\nRegistering agent on ERC-8004 registry...');

  const registry = new ethers.Contract(config.agentRegistryAddress, REGISTRY_ABI, wallet);

  const capabilities = [
    'trading',
    'eip712-signing',
    'risk-management',
    'smc-order-block',
    'sentiment-analysis',
  ];
  const agentURI = `data:application/json,${encodeURIComponent(JSON.stringify({
    name: config.agentName, version: '3.0.0', wallet: wallet.address,
    strategy: 'Order Block + Engulfing + Momentum', timestamp: new Date().toISOString(),
  }))}`;

  let agentId: number | null = null;

  try {
    const tx = await registry.register(
      wallet.address,
      config.agentName,
      config.agentDescription,
      capabilities,
      agentURI,
    );
    console.log(`  Tx sent: ${tx.hash}`);
    console.log('  Waiting for confirmation...');
    const receipt = await tx.wait();
    console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`);

    // Extract agentId from AgentRegistered or Transfer event
    const iface = new ethers.Interface(REGISTRY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'AgentRegistered') { agentId = Number(parsed.args.agentId); break; }
        if (parsed?.name === 'Transfer' && parsed.args[0] === ethers.ZeroAddress) { agentId = Number(parsed.args[2]); break; }
      } catch {}
    }

    if (agentId == null) throw new Error('Could not parse agentId from receipt');

    console.log(`\n✓ Agent registered! agentId = ${agentId}`);
    saveId(agentId);

  } catch (e: any) {
    const msg = e?.reason ?? e?.message ?? String(e);
    console.error(`\n✗ Registration failed: ${msg}`);
    process.exit(1);
  }

  // ── Claim vault capital ─────────────────────────────────────────────────────
  await tryClaimVault(wallet, agentId!);
  printEnvLine(agentId!);
}

async function tryClaimVault(wallet: ethers.Wallet, agentId: number): Promise<void> {
  if (!config.hackathonVaultAddress) return;

  const vault = new ethers.Contract(config.hackathonVaultAddress, VAULT_ABI, wallet);

  try {
    const claimed = await vault.hasClaimed(agentId).catch(() => false);
    if (claimed) {
      const bal = await vault.balanceOf(agentId).catch(() => 0n);
      console.log(`\n✓ Vault already claimed — balance: ${ethers.formatEther(bal)} ETH`);
      return;
    }

    console.log('\nClaiming hackathon vault sandbox capital...');
    const tx = await vault.claimAllocation(agentId);
    console.log(`  Tx sent: ${tx.hash}`);
    await tx.wait();
    const bal = await vault.balanceOf(agentId).catch(() => 0n);
    console.log(`  ✓ Capital claimed — balance: ${ethers.formatEther(bal)} ETH`);
  } catch (e: any) {
    console.log(`  (Vault claim skipped: ${e?.reason ?? e?.message ?? e})`);
  }
}

function printEnvLine(agentId: number): void {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Update your .env file:');
  console.log(`  AGENT_ID=${agentId}`);
  console.log('══════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error(`Fatal: ${e}`);
  process.exit(1);
});
