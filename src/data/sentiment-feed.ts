/**
 * Sentiment Feed — composite score from multiple sources.
 *
 * Sources (weighted):
 *   Fear & Greed Index  40%  — macro crypto sentiment
 *   Alpha Vantage News  30%  — news sentiment for symbol
 *   Kraken Funding Rate 20%  — market microstructure proxy
 *   PRISM Social        10%  — social sentiment (if PRISM key available)
 *
 * All normalized to [-1, +1]:  -1 = extreme fear/bearish, +1 = extreme greed/bullish
 */

import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';

const log = createLogger('SENTIMENT');

export interface SentimentResult {
  composite: number;
  fearGreed: number | null;
  newsSentiment: number | null;
  fundingRate: number | null;
  sources: string[];
  fetchedAt: string;
}

// ── In-memory cache ─────────────────────────────────────────────────────────

const cache: { value: SentimentResult | null; fetchedAt: number } = { value: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

// ── Fear & Greed ─────────────────────────────────────────────────────────────

async function fetchFearGreed(): Promise<number | null> {
  try {
    const resp = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(6000) });
    const data: any = await resp.json();
    const raw = parseInt(data?.data?.[0]?.value ?? '50');
    return (raw - 50) / 50; // normalize [0,100] → [-1,+1]
  } catch {
    return null;
  }
}

// ── Alpha Vantage News ────────────────────────────────────────────────────────

async function fetchNewsSentiment(symbol: string): Promise<number | null> {
  if (!config.alphaVantageApiKey) return null;
  try {
    const ticker = symbol.replace('USD', '').replace('BTC', 'CRYPTO:BTC').replace('ETH', 'CRYPTO:ETH');
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${config.alphaVantageApiKey}&limit=5`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data: any = await resp.json();
    const items: any[] = data?.feed ?? [];
    if (items.length === 0) return null;
    const avg = items.slice(0, 5).reduce((s, i) => {
      const score = parseFloat(i.overall_sentiment_score ?? '0');
      return s + score;
    }, 0) / Math.min(items.length, 5);
    return Math.max(-1, Math.min(1, avg * 2)); // scale and clamp
  } catch {
    return null;
  }
}

// ── Kraken Funding Rate proxy ────────────────────────────────────────────────

async function fetchFundingProxy(symbol: string): Promise<number | null> {
  try {
    const pair = symbol === 'BTCUSD' ? 'XBTUSD' : symbol;
    const resp = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, { signal: AbortSignal.timeout(5000) });
    const data: any = await resp.json();
    const key = Object.keys(data?.result ?? {})[0];
    if (!key) return null;
    const t = data.result[key];
    const price = parseFloat(t.c[0]);
    const open  = parseFloat(t.o);
    const change = (price - open) / open;
    return Math.max(-1, Math.min(1, change * 20)); // amplify small moves
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function fetchSentiment(symbol = 'BTCUSD'): Promise<SentimentResult> {
  if (cache.value && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  const [fearGreed, news, funding] = await Promise.all([
    fetchFearGreed(),
    fetchNewsSentiment(symbol),
    fetchFundingProxy(symbol),
  ]);

  const sources: string[] = [];
  let total = 0, weight = 0;

  if (fearGreed != null) { total += fearGreed * 0.4; weight += 0.4; sources.push('fear_greed'); }
  if (news != null)      { total += news      * 0.3; weight += 0.3; sources.push('news'); }
  if (funding != null)   { total += funding   * 0.2; weight += 0.2; sources.push('funding_proxy'); }

  const composite = weight > 0 ? total / weight : 0;

  const result: SentimentResult = {
    composite: Math.max(-1, Math.min(1, composite)),
    fearGreed,
    newsSentiment: news,
    fundingRate: funding,
    sources,
    fetchedAt: new Date().toISOString(),
  };

  cache.value = result;
  cache.fetchedAt = Date.now();

  log.info(`[SENTIMENT] composite=${composite.toFixed(2)}, sources=[${sources.join(',')}]`);
  return result;
}
