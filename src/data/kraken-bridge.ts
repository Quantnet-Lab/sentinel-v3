/**
 * Kraken execution bridge — wraps kraken-cli for paper/live order placement.
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

const PAIR_MAP: Record<string, string> = {
  BTCUSD: 'XBTUSD', ETHUSD: 'ETHUSD', SOLUSD: 'SOLUSD',
  DOGEUSD: 'DOGEUSD', LINKUSD: 'LINKUSD', PEPEUSD: 'PEPEUSD',
};

function pair(symbol: string): string {
  return PAIR_MAP[symbol.toUpperCase()] ?? symbol;
}

function runKraken(args: string[]): { ok: boolean; data: any; error: string } {
  const bin = config.krakenCliPath;
  const env = { ...process.env, KRAKEN_API_KEY: config.krakenApiKey, KRAKEN_API_SECRET: config.krakenApiSecret };

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

export async function initPaperAccount(balance = 10000): Promise<boolean> {
  const check = runKraken(['paper', 'status']);
  if (check.ok) return true;

  const init = runKraken(['paper', 'init', '--balance', String(balance), '--currency', 'USD', '--fee-rate', '0.0026', '--yes']);
  if (init.ok) {
    log.info(`[KRAKEN] Paper account initialized with $${balance}`);
    return true;
  }
  log.warn(`[KRAKEN] Paper init failed: ${init.error}`);
  return false;
}

export async function placeOrder(params: {
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  orderType?: 'market' | 'limit';
  price?: number;
}): Promise<OrderResult> {
  const mode = config.executionMode;
  if (mode === 'disabled') {
    return { success: true, mode, side: params.side, pair: pair(params.symbol), volume: params.volume, txid: `sim_${Date.now()}`, fillPrice: params.price ?? null, error: null, raw: null };
  }

  const prefix = mode === 'paper' ? ['paper'] : [];
  const orderArgs = [
    ...prefix, 'order', 'add',
    '--pair', pair(params.symbol),
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
    log.warn(`[KRAKEN] Order failed: ${result.error}`);
    return { success: false, mode, side: params.side, pair: pair(params.symbol), volume: params.volume, txid: null, fillPrice: null, error: result.error, raw: result.data };
  }

  const txid = result.data?.txid?.[0] ?? null;
  log.info(`[KRAKEN] ${mode.toUpperCase()} ${params.side.toUpperCase()} ${params.volume} ${params.symbol} @ market — txid=${txid}`);
  return { success: true, mode, side: params.side, pair: pair(params.symbol), volume: params.volume, txid, fillPrice: null, error: null, raw: result.data };
}

export async function getAccountSnapshot(): Promise<Record<string, number>> {
  const mode = config.executionMode;
  const prefix = mode === 'paper' ? ['paper'] : [];
  const result = runKraken([...prefix, 'balance']);
  if (!result.ok) return {};
  return result.data ?? {};
}

export async function getCLIStatus(): Promise<boolean> {
  const result = runKraken(['status']);
  return result.ok;
}
