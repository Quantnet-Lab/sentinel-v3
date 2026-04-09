/**
 * Persistent Agent State
 *
 * Survives process restarts via JSON on disk.
 * Tracks: cycle count, last signal per symbol, cumulative stats,
 * consecutive losses, and SAGE adaptation history.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('STATE');
const STATE_DIR = join(process.cwd(), '.sentinel');
const STATE_FILE = join(STATE_DIR, 'agent-state.json');

export interface SymbolState {
  lastSignal: string;
  lastSignalTime: string | null;
  consecutiveLosses: number;
  tradeCount: number;
  winCount: number;
}

export interface AgentState {
  version: string;
  startedAt: string;
  cycle: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  symbols: Record<string, SymbolState>;
  lastHeartbeat: string | null;
  halted: boolean;
  haltReason: string | null;
}

const DEFAULT_SYMBOL_STATE: SymbolState = {
  lastSignal: 'hold',
  lastSignalTime: null,
  consecutiveLosses: 0,
  tradeCount: 0,
  winCount: 0,
};

let _state: AgentState = {
  version: '3.0',
  startedAt: new Date().toISOString(),
  cycle: 0,
  totalTrades: 0,
  totalWins: 0,
  totalLosses: 0,
  symbols: {},
  lastHeartbeat: null,
  halted: false,
  haltReason: null,
};

export function loadState(): AgentState {
  if (!existsSync(STATE_FILE)) {
    _state.startedAt = new Date().toISOString();
    persistState();
    return _state;
  }
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    _state = { ..._state, ...JSON.parse(raw) };
    log.info(`[STATE] Loaded: cycle=${_state.cycle} trades=${_state.totalTrades}`);
  } catch (e) {
    log.warn(`[STATE] Failed to load, using defaults: ${e}`);
  }
  return _state;
}

export function getState(): AgentState {
  return _state;
}

export function getSymbolState(symbol: string): SymbolState {
  if (!_state.symbols[symbol]) {
    _state.symbols[symbol] = { ...DEFAULT_SYMBOL_STATE };
  }
  return _state.symbols[symbol];
}

export function incrementCycle(): void {
  _state.cycle++;
  _state.lastHeartbeat = new Date().toISOString();
  persistState();
}

export function recordTrade(symbol: string, won: boolean): void {
  _state.totalTrades++;
  const sym = getSymbolState(symbol);
  sym.tradeCount++;

  if (won) {
    _state.totalWins++;
    sym.winCount++;
    sym.consecutiveLosses = 0;
  } else {
    _state.totalLosses++;
    sym.consecutiveLosses++;
  }
  persistState();
}

export function recordSignal(symbol: string, direction: string): void {
  const sym = getSymbolState(symbol);
  sym.lastSignal = direction;
  sym.lastSignalTime = new Date().toISOString();
  persistState();
}

export function setHalted(reason: string | null): void {
  _state.halted = reason !== null;
  _state.haltReason = reason;
  persistState();
}

export function getWinRate(): number {
  if (_state.totalTrades === 0) return 0.5;
  return _state.totalWins / _state.totalTrades;
}

export function getSymbolWinRate(symbol: string): number {
  const sym = getSymbolState(symbol);
  if (sym.tradeCount === 0) return 0.5;
  return sym.winCount / sym.tradeCount;
}

function persistState(): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(_state, null, 2));
  } catch { /* non-critical */ }
}
