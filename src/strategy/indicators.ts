/**
 * Technical indicators used across all Sentinel strategies.
 * Pure functions — no side effects.
 */

import type { Candle } from './types.js';

// ── Basic series helpers ──────────────────────────────────────────────────────

export function closes(candles: Candle[]): number[] {
  return candles.map(c => c.close);
}

export function highs(candles: Candle[]): number[] {
  return candles.map(c => c.high);
}

export function lows(candles: Candle[]): number[] {
  return candles.map(c => c.low);
}

// ── EMA ───────────────────────────────────────────────────────────────────────

export function ema(values: number[], period: number): number[] {
  if (values.length < period) return values.map(() => NaN);
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function emaLast(values: number[], period: number): number {
  const e = ema(values, period);
  return e[e.length - 1];
}

// ── SMA ───────────────────────────────────────────────────────────────────────

export function sma(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

export function smaLast(values: number[], period: number): number {
  const s = sma(values, period);
  return s[s.length - 1];
}

// ── RSI ───────────────────────────────────────────────────────────────────────

export function rsi(values: number[], period = 14): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  if (values.length < period + 1) return result;

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta; else losses -= delta;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function rsiLast(values: number[], period = 14): number {
  const r = rsi(values, period);
  return r[r.length - 1];
}

// ── MACD ──────────────────────────────────────────────────────────────────────

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MACDResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = emaFast.map((v, i) => (isNaN(v) || isNaN(emaSlow[i])) ? NaN : v - emaSlow[i]);
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalPadded = [
    ...new Array(macdLine.length - validMacd.length).fill(NaN),
    ...ema(validMacd, signalPeriod),
  ];
  const histogram = macdLine.map((v, i) => isNaN(v) || isNaN(signalPadded[i]) ? NaN : v - signalPadded[i]);
  return { macd: macdLine, signal: signalPadded, histogram };
}

// ── ATR ───────────────────────────────────────────────────────────────────────

export function atr(candles: Candle[], period = 14): number[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });

  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  result[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
  }
  return result;
}

export function atrLast(candles: Candle[], period = 14): number {
  const a = atr(candles, period);
  return a[a.length - 1];
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

export interface BBResult {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
}

export function bollingerBands(values: number[], period = 20, stdDev = 2): BBResult {
  const middle = sma(values, period);
  const upper: number[] = [], lower: number[] = [], bandwidth: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (isNaN(middle[i])) {
      upper.push(NaN); lower.push(NaN); bandwidth.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance) * stdDev;
    upper.push(mean + std);
    lower.push(mean - std);
    bandwidth.push((mean + std - (mean - std)) / mean);
  }
  return { upper, middle, lower, bandwidth };
}

// ── ADX ───────────────────────────────────────────────────────────────────────

export function adx(candles: Candle[], period = 14): number[] {
  if (candles.length < period * 2) return new Array(candles.length).fill(NaN);

  const result: number[] = new Array(candles.length).fill(NaN);
  const dmPlus: number[] = [0], dmMinus: number[] = [0], trArr: number[] = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    dmPlus.push(up > down && up > 0 ? up : 0);
    dmMinus.push(down > up && down > 0 ? down : 0);
    const prev = candles[i - 1].close;
    trArr.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - prev), Math.abs(candles[i].low - prev)));
  }

  const smoothed = (arr: number[], i: number) => {
    if (i < period) return NaN;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += arr[j];
    return sum;
  };

  for (let i = period; i < candles.length; i++) {
    const sTr = smoothed(trArr, i);
    const sDmP = smoothed(dmPlus, i);
    const sDmM = smoothed(dmMinus, i);
    if (!sTr) continue;
    const diP = (sDmP / sTr) * 100;
    const diM = (sDmM / sTr) * 100;
    const dx = Math.abs(diP - diM) / (diP + diM + 1e-10) * 100;
    result[i] = dx;
  }
  return result;
}

export function adxLast(candles: Candle[], period = 14): number {
  const a = adx(candles, period);
  return a[a.length - 1];
}

// ── Z-Score ───────────────────────────────────────────────────────────────────

export function zscore(values: number[], lookback = 20): number[] {
  return values.map((_, i) => {
    if (i < lookback - 1) return NaN;
    const slice = values.slice(i - lookback + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / lookback;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / lookback);
    return std === 0 ? 0 : (values[i] - mean) / std;
  });
}

export function zscoreLast(values: number[], lookback = 20): number {
  const z = zscore(values, lookback);
  return z[z.length - 1];
}

// ── Swing Highs / Lows ────────────────────────────────────────────────────────

export function swingHighs(candles: Candle[], lookback = 5): boolean[] {
  return candles.map((c, i) => {
    if (i < lookback || i >= candles.length - lookback) return false;
    const slice = candles.slice(i - lookback, i + lookback + 1);
    return slice.every(s => s.high <= c.high);
  });
}

export function swingLows(candles: Candle[], lookback = 5): boolean[] {
  return candles.map((c, i) => {
    if (i < lookback || i >= candles.length - lookback) return false;
    const slice = candles.slice(i - lookback, i + lookback + 1);
    return slice.every(s => s.low >= c.low);
  });
}

// ── Fair Value Gaps (FVG) ─────────────────────────────────────────────────────

export interface FVG {
  index: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  midpoint: number;
}

export function fairValueGaps(candles: Candle[]): FVG[] {
  const fvgs: FVG[] = [];
  for (let i = 2; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const curr  = candles[i];
    // Bullish FVG: gap between prev2 high and current low
    if (curr.low > prev2.high) {
      fvgs.push({
        index: i,
        type: 'bullish',
        bottom: prev2.high,
        top: curr.low,
        midpoint: (prev2.high + curr.low) / 2,
      });
    }
    // Bearish FVG: gap between prev2 low and current high
    if (curr.high < prev2.low) {
      fvgs.push({
        index: i,
        type: 'bearish',
        top: prev2.low,
        bottom: curr.high,
        midpoint: (prev2.low + curr.high) / 2,
      });
    }
  }
  return fvgs;
}

// ── Order Blocks ─────────────────────────────────────────────────────────────

export interface OrderBlock {
  index: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  midpoint: number;
  strength: number; // 0-1
}

export function orderBlocks(candles: Candle[], lookback = 10): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  for (let i = lookback; i < candles.length - 1; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const bodySize = Math.abs(c.close - c.open);
    const nextBodySize = Math.abs(next.close - next.open);

    // Bullish OB: bearish candle followed by strong bullish move
    if (c.close < c.open && next.close > next.open && nextBodySize > bodySize * 1.5) {
      const strength = Math.min(nextBodySize / (atrLast(candles.slice(0, i + 1)) || 1), 1);
      blocks.push({
        index: i,
        type: 'bullish',
        bottom: Math.min(c.open, c.close),
        top: Math.max(c.open, c.close),
        midpoint: (c.open + c.close) / 2,
        strength: Math.max(0, Math.min(1, strength)),
      });
    }
    // Bearish OB: bullish candle followed by strong bearish move
    if (c.close > c.open && next.close < next.open && nextBodySize > bodySize * 1.5) {
      const strength = Math.min(nextBodySize / (atrLast(candles.slice(0, i + 1)) || 1), 1);
      blocks.push({
        index: i,
        type: 'bearish',
        top: Math.max(c.open, c.close),
        bottom: Math.min(c.open, c.close),
        midpoint: (c.open + c.close) / 2,
        strength: Math.max(0, Math.min(1, strength)),
      });
    }
  }
  return blocks;
}

// ── BOS / CHoCH detection ────────────────────────────────────────────────────

export interface StructureEvent {
  index: number;
  type: 'bos_bullish' | 'bos_bearish' | 'choch_bullish' | 'choch_bearish';
  level: number;
}

export function structureBreaks(candles: Candle[], swingLookback = 5): StructureEvent[] {
  const events: StructureEvent[] = [];
  const shighs = swingHighs(candles, swingLookback);
  const slows  = swingLows(candles, swingLookback);

  let lastSwingHigh = NaN, lastSwingLow = NaN;
  let prevTrend: 'up' | 'down' | null = null;

  for (let i = swingLookback; i < candles.length; i++) {
    if (shighs[i]) lastSwingHigh = candles[i].high;
    if (slows[i])  lastSwingLow  = candles[i].low;

    const c = candles[i];
    if (!isNaN(lastSwingHigh) && c.close > lastSwingHigh) {
      events.push({ index: i, type: prevTrend === 'down' ? 'choch_bullish' : 'bos_bullish', level: lastSwingHigh });
      prevTrend = 'up';
    }
    if (!isNaN(lastSwingLow) && c.close < lastSwingLow) {
      events.push({ index: i, type: prevTrend === 'up' ? 'choch_bearish' : 'bos_bearish', level: lastSwingLow });
      prevTrend = 'down';
    }
  }
  return events;
}

// ── Liquidity Sweeps ─────────────────────────────────────────────────────────

export interface LiquiditySweep {
  index: number;
  type: 'sweep_high' | 'sweep_low';
  level: number;
}

export function liquiditySweeps(candles: Candle[], lookback = 10): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  for (let i = lookback + 1; i < candles.length; i++) {
    const recent = candles.slice(i - lookback, i);
    const priorHigh = Math.max(...recent.map(c => c.high));
    const priorLow  = Math.min(...recent.map(c => c.low));
    const c = candles[i];

    // Sweep high: wick above prior high but close below
    if (c.high > priorHigh && c.close < priorHigh) {
      sweeps.push({ index: i, type: 'sweep_high', level: priorHigh });
    }
    // Sweep low: wick below prior low but close above
    if (c.low < priorLow && c.close > priorLow) {
      sweeps.push({ index: i, type: 'sweep_low', level: priorLow });
    }
  }
  return sweeps;
}

// ── Displacement (strong momentum candle) ────────────────────────────────────

export function isDisplacement(candles: Candle[], index: number, atrMultiple = 1.5): boolean {
  if (index < 14) return false;
  const c = candles[index];
  const body = Math.abs(c.close - c.open);
  const atrVal = atrLast(candles.slice(0, index + 1));
  return body > atrVal * atrMultiple;
}

// ── OTE Zone (Optimal Trade Entry 61.8–79% fib) ──────────────────────────────

export interface OTEZone {
  top: number;
  bottom: number;
  type: 'bullish' | 'bearish';
}

export function oteZone(swingLow: number, swingHigh: number, direction: 'bullish' | 'bearish'): OTEZone {
  const range = swingHigh - swingLow;
  if (direction === 'bullish') {
    return {
      type: 'bullish',
      bottom: swingHigh - range * 0.79,
      top: swingHigh - range * 0.618,
    };
  }
  return {
    type: 'bearish',
    bottom: swingLow + range * 0.618,
    top: swingLow + range * 0.79,
  };
}
