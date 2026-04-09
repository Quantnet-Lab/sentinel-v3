/**
 * PRISM Feed — Strykr PRISM API integration.
 * Provides technical signal confirmation: RSI, MACD, Bollinger, directional bias.
 * Used as a confidence modifier (+0–10%) — boosts when PRISM agrees, never penalizes.
 */

import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';

const log = createLogger('PRISM');

const PRISM_BASE = 'https://api.prism.strykr.io/v1';

export interface PrismData {
  symbol: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  rsi: number | null;
  macdHistogram: number | null;
  bbPosition: number | null; // -1 (below lower) to +1 (above upper)
  confidence: number | null; // 0–1
  fetchedAt: string;
}

const cache = new Map<string, { data: PrismData; at: number }>();
const TTL_MS = 3 * 60 * 1000;

export async function fetchPrismData(symbol: string): Promise<PrismData | null> {
  if (!config.prismApiKey) return null;

  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  try {
    const resp = await fetch(`${PRISM_BASE}/signals/${symbol}`, {
      headers: { Authorization: `Bearer ${config.prismApiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw: any = await resp.json();

    const data: PrismData = {
      symbol,
      bias:         raw.bias ?? 'neutral',
      rsi:          raw.rsi ?? null,
      macdHistogram: raw.macd_histogram ?? null,
      bbPosition:   raw.bb_position ?? null,
      confidence:   raw.confidence ?? null,
      fetchedAt:    new Date().toISOString(),
    };

    cache.set(symbol, { data, at: Date.now() });
    return data;
  } catch (e) {
    log.warn(`[PRISM] Fetch failed for ${symbol}: ${e}`);
    return null;
  }
}

/**
 * Returns a confidence modifier [0, 0.1].
 * Only applied when PRISM agrees with the signal direction.
 */
export function prismConfidenceModifier(prism: PrismData | null, direction: 'buy' | 'sell'): number {
  if (!prism || prism.bias === 'neutral') return 0;
  const agrees = (direction === 'buy' && prism.bias === 'bullish') ||
                 (direction === 'sell' && prism.bias === 'bearish');
  if (!agrees) return 0;
  return Math.min(0.10, (prism.confidence ?? 0) * 0.1);
}
