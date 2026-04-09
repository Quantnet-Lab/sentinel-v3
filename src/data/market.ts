/**
 * Market data provider — fetches OHLCV candles from Kraken REST API
 * or Kraken CLI, with yfinance-style fallback via fetch.
 */

import { execSync } from 'child_process';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import type { Candle } from '../strategy/types.js';

const log = createLogger('MARKET');

// ── Kraken REST ───────────────────────────────────────────────────────────────

const KRAKEN_REST = 'https://api.kraken.com/0/public';

const PAIR_MAP: Record<string, string> = {
  BTCUSD:  'XBTUSD',
  ETHUSD:  'ETHUSD',
  SOLUSD:  'SOLUSD',
  DOGEUSD: 'DOGEUSD',
  LINKUSD: 'LINKUSD',
  PEPEUSD: 'PEPEUSD',
  XRPUSD:  'XRPUSD',
  ADAUSD:  'ADAUSD',
};

function krakenPair(symbol: string): string {
  return PAIR_MAP[symbol.toUpperCase()] ?? symbol;
}

export async function fetchCandles(symbol: string, intervalMinutes = 1, limit = 200): Promise<Candle[]> {
  // Try Kraken CLI first
  const cliCandles = await fetchViaCLI(symbol, intervalMinutes, limit);
  if (cliCandles.length > 0) return cliCandles;

  // Fallback to Kraken REST
  return fetchViaREST(symbol, intervalMinutes, limit);
}

async function fetchViaREST(symbol: string, intervalMinutes: number, limit: number): Promise<Candle[]> {
  const pair = krakenPair(symbol);
  const url  = `${KRAKEN_REST}/OHLC?pair=${pair}&interval=${intervalMinutes}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data: any = await resp.json();
    if (data.error?.length) throw new Error(data.error[0]);

    const key = Object.keys(data.result).find(k => k !== 'last')!;
    const raw: number[][] = data.result[key];

    return raw.slice(-limit).map(c => ({
      time:   c[0] * 1000,
      open:   parseFloat(c[1]),
      high:   parseFloat(c[2]),
      low:    parseFloat(c[3]),
      close:  parseFloat(c[4]),
      volume: parseFloat(c[6]),
    }));
  } catch (e) {
    log.warn(`[MARKET] REST fetch failed for ${symbol}: ${e}`);
    return [];
  }
}

async function fetchViaCLI(symbol: string, intervalMinutes: number, limit: number): Promise<Candle[]> {
  const bin = config.krakenCliPath;
  const pair = krakenPair(symbol);

  try {
    const stdout = execSync(
      `${bin} -o json ohlc ${pair} --interval ${intervalMinutes}`,
      { timeout: 15000, env: { ...process.env, KRAKEN_API_KEY: config.krakenApiKey, KRAKEN_API_SECRET: config.krakenApiSecret } },
    ).toString();

    const data = JSON.parse(stdout);
    const key = Object.keys(data).find(k => k !== 'last')!;
    const raw: any[] = data[key];

    return raw.slice(-limit).map((c: any) => ({
      time:   (typeof c.time === 'number' ? c.time : parseInt(c[0])) * 1000,
      open:   parseFloat(c.open ?? c[1]),
      high:   parseFloat(c.high ?? c[2]),
      low:    parseFloat(c.low  ?? c[3]),
      close:  parseFloat(c.close ?? c[4]),
      volume: parseFloat(c.volume ?? c[6] ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function fetchTicker(symbols: string[]): Promise<Record<string, { price: number; change24hPct: number }>> {
  const pairs = symbols.map(krakenPair).join(',');
  try {
    const resp = await fetch(`${KRAKEN_REST}/Ticker?pair=${pairs}`, { signal: AbortSignal.timeout(8000) });
    const data: any = await resp.json();
    if (data.error?.length) throw new Error(data.error[0]);

    const result: Record<string, { price: number; change24hPct: number }> = {};
    for (const sym of symbols) {
      const key = Object.keys(data.result).find(k => k.includes(krakenPair(sym).slice(0, 3)));
      if (!key) continue;
      const t = data.result[key];
      const price = parseFloat(t.c[0]);
      const open  = parseFloat(t.o);
      result[sym] = { price, change24hPct: ((price - open) / open) * 100 };
    }
    return result;
  } catch (e) {
    log.warn(`[MARKET] Ticker fetch failed: ${e}`);
    return {};
  }
}
