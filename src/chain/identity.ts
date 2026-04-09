/**
 * ERC-8004 Identity — agent registration and on-chain presence.
 * Reads identity from agent-id.json if available, otherwise uses config.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { getSignerAddress } from './eip712.js';

const log = createLogger('IDENTITY');
const ID_FILE = join(process.cwd(), 'agent-id.json');

const AGENT_REGISTRY_ABI = [
  'function getAgent(uint256 agentId) view returns (address wallet, string name, bool active, uint256 registeredAt)',
  'function agentCount() view returns (uint256)',
];

export interface AgentIdentity {
  agentId: number | null;
  name: string | null;
  agentWallet: string | null;
  signerWallet: string | null;
  active: boolean;
  registeredAt: number | null;
  identityAgeDays: number | null;
  chain: 'live' | 'offline';
  signingEnabled: boolean;
}

let cachedIdentity: AgentIdentity | null = null;

function loadFromFile(): number | null {
  if (!existsSync(ID_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(ID_FILE, 'utf-8'));
    return typeof data.agentId === 'number' ? data.agentId : null;
  } catch {
    return null;
  }
}

function saveToFile(agentId: number): void {
  try {
    writeFileSync(ID_FILE, JSON.stringify({ agentId }, null, 2));
  } catch { /* non-critical */ }
}

export async function loadIdentity(): Promise<AgentIdentity> {
  if (cachedIdentity) return cachedIdentity;

  const signerWallet = getSignerAddress();
  const agentIdFromFile = loadFromFile();
  const agentId = config.agentId ?? agentIdFromFile;

  const base: AgentIdentity = {
    agentId,
    name: config.agentName,
    agentWallet: config.walletAddress || signerWallet,
    signerWallet,
    active: false,
    registeredAt: null,
    identityAgeDays: null,
    chain: 'offline',
    signingEnabled: signerWallet != null,
  };

  if (!config.rpcUrl || !agentId) {
    log.warn('[IDENTITY] No RPC URL or agentId — running local-only');
    cachedIdentity = base;
    return base;
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const registry = new ethers.Contract(config.agentRegistryAddress, AGENT_REGISTRY_ABI, provider);
    const data = await Promise.race([
      registry.getAgent(agentId),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]) as [string, string, boolean, bigint];

    const registeredAt = Number(data[3]);
    const ageDays = registeredAt > 0 ? (Date.now() / 1000 - registeredAt) / 86400 : null;

    cachedIdentity = {
      ...base,
      agentWallet: data[0] || base.agentWallet,
      name: data[1] || base.name,
      active: data[2],
      registeredAt,
      identityAgeDays: ageDays,
      chain: 'live',
    };
    log.info(`[IDENTITY] ERC-8004 ready | agentId=${agentId} | active=${data[2]} | age=${ageDays?.toFixed(1)}d`);
  } catch (e) {
    log.warn(`[IDENTITY] Chain unavailable (${e}) — offline mode`);
    cachedIdentity = base;
  }

  return cachedIdentity;
}

export async function postCheckpointOnChain(params: {
  agentId: number;
  dataHash: string;
  signature: string;
}): Promise<string | null> {
  const key = config.agentWalletPrivateKey || config.privateKey;
  if (!key || !config.validationRegistry) return null;

  try {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(key, provider);
    const abi = ['function attest(uint256 agentId, bytes32 dataHash, bytes signature) external'];
    const contract = new ethers.Contract(config.validationRegistry, abi, wallet);
    const tx = await contract.attest(params.agentId, params.dataHash, params.signature);
    await tx.wait();
    return tx.hash;
  } catch (e) {
    log.warn(`[IDENTITY] On-chain attest failed: ${e}`);
    return null;
  }
}
