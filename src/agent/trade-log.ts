/**
 * Trade Log — append-only JSONL record of every closed trade.
 *
 * Each line: { tradeId, symbol, direction, entry, exit, pnl, pnlPct, duration, strategy, timestamp }
 * Used for SAGE reflection, win rate computation, and audit trail.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const log = createLogger('TRADELOG');
const STATE_DIR = join(process.cwd(), '.sentinel');
const LOG_FILE  = join(STATE_DIR, 'trades.jsonl');

export interface ClosedTrade {
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  positionSize: number;
  pnl: number;
  pnlPct: number;
  strategy: string;
  openedAt: string;
  closedAt: string;
  durationMs: number;
  exitReason: 'stop' | 'target' | 'trailing' | 'signal' | 'halt';
  checkpointHash: string | null;
  ipfsCid: string | null;
}

const _trades: ClosedTrade[] = [];

export function loadTradeLog(): void {
  if (!existsSync(LOG_FILE)) return;
  try {
    const lines = readFileSync(LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      _trades.push(JSON.parse(line));
    }
    log.info(`[TRADELOG] Loaded ${_trades.length} closed trades`);
  } catch (e) {
    log.warn(`[TRADELOG] Failed to load: ${e}`);
  }
}

export function recordClosedTrade(trade: ClosedTrade): void {
  _trades.push(trade);
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(trade) + '\n');
  } catch { /* non-critical */ }
}

export function getClosedTrades(): ClosedTrade[] {
  return [..._trades];
}

export function getTradeStats(symbol?: string): {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
} {
  const trades = symbol ? _trades.filter(t => t.symbol === symbol) : _trades;
  const total = trades.length;
  if (total === 0) return { total: 0, wins: 0, losses: 0, winRate: 0, avgPnl: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0 };

  const wins = trades.filter(t => t.pnl > 0).length;
  const pnls = trades.map(t => t.pnl);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);

  return {
    total,
    wins,
    losses: total - wins,
    winRate: wins / total,
    avgPnl: totalPnl / total,
    totalPnl,
    bestTrade: Math.max(...pnls),
    worstTrade: Math.min(...pnls),
  };
}

export function getRecentTradeOutcomes(symbol: string, n: number): boolean[] {
  return _trades
    .filter(t => t.symbol === symbol)
    .slice(-n)
    .map(t => t.pnl > 0);
}

export function generateTradeId(symbol: string): string {
  return `${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
