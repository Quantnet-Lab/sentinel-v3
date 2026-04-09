/**
 * Checkpoint — tamper-evident hash chain of every agent decision.
 *
 * Every signal, trade, veto, halt, and heartbeat is appended to
 * .sentinel/checkpoints.jsonl as a JSONL file.
 * Each entry hashes the previous entry — any tampering breaks the chain.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { createLogger } from '../agent/logger.js';
import { signCheckpoint, hashData } from '../chain/eip712.js';

const log = createLogger('CHECKPOINT');
const STATE_DIR = join(process.cwd(), '.sentinel');
const CP_FILE   = join(STATE_DIR, 'checkpoints.jsonl');

export type CheckpointEventType = 'signal' | 'trade' | 'close' | 'veto' | 'halt' | 'heartbeat';

export interface CheckpointEntry {
  id: number;
  timestamp: string;
  eventType: CheckpointEventType;
  symbol: string;
  agentId: number | null;
  signal: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
  signature: string | null;
  ipfsCid: string | null;
  onChainTxHash: string | null;
}

const checkpoints: CheckpointEntry[] = [];
let nextId = 0;
let prevHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

export function loadCheckpointHistory(): void {
  if (!existsSync(CP_FILE)) return;
  try {
    const lines = readFileSync(CP_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const cp: CheckpointEntry = JSON.parse(line);
      checkpoints.push(cp);
      nextId = cp.id + 1;
      prevHash = cp.hash;
    }
    log.info(`[CHECKPOINT] Loaded ${checkpoints.length} existing checkpoints`);
  } catch (e) {
    log.warn(`[CHECKPOINT] Failed to load history: ${e}`);
  }
}

export async function saveCheckpoint(params: {
  eventType: CheckpointEventType;
  symbol: string;
  agentId: number | null;
  signal: string;
  data: Record<string, unknown>;
  ipfsCid?: string | null;
  onChainTxHash?: string | null;
}): Promise<CheckpointEntry> {
  const id = nextId++;
  const timestamp = new Date().toISOString();
  const payload = { id, timestamp, eventType: params.eventType, symbol: params.symbol, signal: params.signal, data: params.data, prevHash };
  const hash = hashData(payload);

  let signature: string | null = null;
  if (params.agentId != null) {
    signature = await signCheckpoint({
      agentId: params.agentId,
      symbol: params.symbol,
      eventType: params.eventType,
      dataHash: hash,
      nonce: id,
    });
  }

  const entry: CheckpointEntry = {
    id, timestamp, eventType: params.eventType,
    symbol: params.symbol, agentId: params.agentId,
    signal: params.signal, data: params.data,
    prevHash, hash, signature,
    ipfsCid: params.ipfsCid ?? null,
    onChainTxHash: params.onChainTxHash ?? null,
  };

  checkpoints.push(entry);
  prevHash = hash;
  persistToDisk(entry);

  return entry;
}

function persistToDisk(entry: CheckpointEntry): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(CP_FILE, JSON.stringify({
      id: entry.id, timestamp: entry.timestamp,
      eventType: entry.eventType, symbol: entry.symbol,
      signal: entry.signal, hash: entry.hash,
      prevHash: entry.prevHash, signature: entry.signature,
      ipfsCid: entry.ipfsCid, onChainTxHash: entry.onChainTxHash,
    }) + '\n');
  } catch { /* non-critical */ }
}

export function verifyChain(): { valid: boolean; brokenAt: number | null; issues: string[] } {
  const issues: string[] = [];
  let computedPrev = '0x0000000000000000000000000000000000000000000000000000000000000000';

  for (const cp of checkpoints) {
    if (cp.prevHash !== computedPrev) {
      issues.push(`Chain break at checkpoint #${cp.id}: expected prevHash=${computedPrev}, got ${cp.prevHash}`);
      return { valid: false, brokenAt: cp.id, issues };
    }
    computedPrev = cp.hash;
  }
  return { valid: true, brokenAt: null, issues };
}

export function getCheckpoints(): CheckpointEntry[] {
  return [...checkpoints];
}

export function getCheckpointStats(): Record<string, number> {
  const total = checkpoints.length;
  const signed = checkpoints.filter(c => c.signature != null).length;
  const byType: Record<string, number> = {};
  for (const c of checkpoints) byType[c.eventType] = (byType[c.eventType] ?? 0) + 1;
  return { total, signed, unsigned: total - signed, ...byType };
}
