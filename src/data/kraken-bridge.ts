/**
 * Kraken execution bridge — paper simulation + live order placement via REST API.
 *
 * Paper mode runs entirely in-process (no external calls).
 * Live mode calls the Kraken private REST API directly (no CLI required).
 * Disabled mode returns a dry-run success without touching anything.
 */

import * as crypto from 'crypto';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';

const log = createLogger('KRAKEN');

const KRAKEN_REST = 'https://api.kraken.com';

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

function krakenPair(symbol: string): string {
  return PAIR_MAP[symbol.toUpperCase()] ?? symbol;
}

// ── Kraken private REST API ───────────────────────────────────────────────────

function buildSignature(path: string, nonce: string, postData: string): string {
  const secret = Buffer.from(config.krakenApiSecret, 'base64');
  const hash   = crypto.createHash('sha256').update(nonce + postData).digest();
  const hmac   = crypto.createHmac('sha512', secret).update(path).update(hash).digest('base64');
  return hmac;
}

// Strictly-increasing nonce — never goes backwards even across concurrent calls
let _lastNonce = BigInt(0);
function nextNonce(): string {
  const ts = BigInt(Date.now()) * BigInt(1000);
  _lastNonce = ts > _lastNonce ? ts : _lastNonce + BigInt(1);
  return _lastNonce.toString();
}

async function krakenPrivate(endpoint: string, params: Record<string, string>): Promise<{ ok: boolean; data: any; error: string }> {
  const path     = `/0/private/${endpoint}`;
  const nonce    = nextNonce();
  const postData = new URLSearchParams({ nonce, ...params }).toString();
  const sig      = buildSignature(path, nonce, postData);

  try {
    const resp = await fetch(`${KRAKEN_REST}${path}`, {
      method:  'POST',
      headers: {
        'API-Key':  config.krakenApiKey,
        'API-Sign': sig,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body:   postData,
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json() as any;
    if (data.error?.length) {
      return { ok: false, data: null, error: data.error.join(', ') };
    }
    return { ok: true, data: data.result, error: '' };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message ?? String(e) };
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
  const p    = krakenPair(params.symbol);

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

  // Live — Kraken private REST API
  const orderParams: Record<string, string> = {
    pair:      p,
    type:      params.side,
    ordertype: params.orderType ?? 'market',
    volume:    String(params.volume),
    validate:  'false',
  };
  if (params.orderType === 'limit' && params.price) {
    orderParams.price = String(params.price);
  }

  log.info(`[KRAKEN] LIVE ${params.side.toUpperCase()} ${params.volume} ${params.symbol} via REST API...`);
  const result = await krakenPrivate('AddOrder', orderParams);

  if (!result.ok) {
    log.warn(`[KRAKEN] Live order failed: ${result.error}`);
    return {
      success: false, mode, side: params.side, pair: p,
      volume: params.volume, txid: null, fillPrice: null,
      error: result.error, raw: null,
    };
  }

  const txid = result.data?.txid?.[0] ?? null;
  log.info(`[KRAKEN] LIVE order placed — txid=${txid} | ${params.side.toUpperCase()} ${params.volume} ${params.symbol}`);
  return {
    success: true, mode, side: params.side, pair: p,
    volume: params.volume, txid, fillPrice: null, error: null, raw: result.data,
  };
}

// ── Account helpers ───────────────────────────────────────────────────────────

export async function getAccountSnapshot(): Promise<Record<string, number>> {
  if (config.executionMode === 'paper') {
    return { USD: _paper.balanceUsd };
  }
  const result = await krakenPrivate('Balance', {});
  if (!result.ok) return {};
  const balances: Record<string, number> = {};
  for (const [k, v] of Object.entries(result.data ?? {})) {
    balances[k] = parseFloat(String(v));
  }
  return balances;
}

export async function getCLIStatus(): Promise<boolean> {
  if (config.executionMode !== 'live') return true;
  // Ping the public time endpoint — no auth needed
  try {
    const resp = await fetch(`${KRAKEN_REST}/0/public/Time`, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json() as any;
    return !data.error?.length;
  } catch {
    return false;
  }
}
