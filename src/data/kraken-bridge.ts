/**
 * Kraken execution bridge — paper simulation + live order placement via CLI.
 *
 * Paper mode runs entirely in-process (no CLI required).
 * Live mode shells out to the kraken CLI with API credentials.
 * Disabled mode returns a dry-run success without touching anything.
 */

import { execSync } from 'child_process';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';

const log = createLogger('KRAKEN');

export interface OrderResult {
  success: boolean;
  mode: string;
  side: string;
  pair: string;
  volume: number;
  txid: string | null;
  fillPrice: number | null;
  error: string | null;
  raw: Record<string, unknown> | null;
}

// ── Internal paper account ────────────────────────────────────────────────────

interface PaperState {
  balanceUsd: number;
  positions: Record<string, number>;
  initialised: boolean;
}

const _paper: PaperState = { balanceUsd: 0, positions: {}, initialised: false };

export async function initPaperAccount(balance = 10000): Promise<boolean> {
  if (config.executionMode !== 'paper') return true;
  _paper.balanceUsd = balance;
  _paper.initialised = true;
  log.info(`[KRAKEN] Paper account initialised — balance: $${balance.toFixed(2)}`);
  return true;
}

// ── Pair mapping ──────────────────────────────────────────────────────────────

const PAIR_MAP: Record<string, string> = {
  BTCUSD:  'XBTUSD',
  ETHUSD:  'ETHUSD',
  SOLUSD:  'SOLUSD',
  DOGEUSD: 'DOGEUSD',
  LINKUSD: 'LINKUSD',
  PEPEUSD: 'PEPEUSD',
};

function pair(symbol: string): string {
  return PAIR_MAP[symbol.toUpperCase()] ?? symbol;
}

// ── Live CLI helper ───────────────────────────────────────────────────────────

function runKraken(args: string[]): { ok: boolean; data: any; error: string } {
  const bin = config.krakenCliPath;
  const env = {
    ...process.env,
    KRAKEN_API_KEY:    config.krakenApiKey,
    KRAKEN_API_SECRET: config.krakenApiSecret,
  };
  try {
    const stdout = execSync(
      `${bin} -o json ${args.join(' ')}`,
      { timeout: 30000, env },
    ).toString().trim();
    return { ok: true, data: stdout ? JSON.parse(stdout) : {}, error: '' };
  } catch (e: any) {
    const stderr = e.stderr?.toString() ?? '';
    let parsed: any = null;
    try { parsed = JSON.parse(e.stdout?.toString() ?? ''); } catch {}
    return { ok: false, data: parsed, error: stderr || e.message };
  }
}

// ── Order placement ───────────────────────────────────────────────────────────

export async function placeOrder(params: {
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  orderType?: 'market' | 'limit';
  price?: number;
}): Promise<OrderResult> {
  const mode = config.executionMode;
  const p    = pair(params.symbol);

  // Disabled — dry run, no side effects
  if (mode === 'disabled') {
    return {
      success: true, mode, side: params.side, pair: p,
      volume: params.volume, txid: `sim_${Date.now()}`,
      fillPrice: params.price ?? null, error: null, raw: null,
    };
  }

  // Paper — in-process simulation
  if (mode === 'paper') {
    const txid = `paper_${Date.now()}`;
    log.info(`[KRAKEN] PAPER ${params.side.toUpperCase()} ${params.volume.toFixed(6)} ${params.symbol} — txid=${txid}`);
    return {
      success: true, mode, side: params.side, pair: p,
      volume: params.volume, txid, fillPrice: params.price ?? null,
      error: null, raw: null,
    };
  }

  // Live — shell out to kraken CLI
  const orderArgs = [
    'order', 'add',
    '--pair', p,
    '--type', params.side,
    '--ordertype', params.orderType ?? 'market',
    '--volume', String(params.volume),
  ];
  if (params.orderType === 'limit' && params.price) {
    orderArgs.push('--price', String(params.price));
  }
  orderArgs.push('--yes');

  const result = runKraken(orderArgs);
  if (!result.ok) {
    log.warn(`[KRAKEN] Live order failed: ${result.error}`);
    return {
      success: false, mode, side: params.side, pair: p,
      volume: params.volume, txid: null, fillPrice: null,
      error: result.error, raw: result.data,
    };
  }

  const txid = result.data?.txid?.[0] ?? null;
  log.info(`[KRAKEN] LIVE ${params.side.toUpperCase()} ${params.volume} ${params.symbol} @ market — txid=${txid}`);
  return {
    success: true, mode, side: params.side, pair: p,
    volume: params.volume, txid, fillPrice: null, error: null, raw: result.data,
  };
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

export async function getAccountSnapshot(): Promise<Record<string, number>> {
  if (config.executionMode === 'paper') {
    return { USD: _paper.balanceUsd };
  }
  const result = runKraken(['balance']);
  return result.ok ? (result.data ?? {}) : {};
}

export async function getCLIStatus(): Promise<boolean> {
  if (config.executionMode !== 'live') return true;
  return runKraken(['status']).ok;
}
