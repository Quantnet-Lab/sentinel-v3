/**
 * Regime Detector — classifies market state before strategy selection.
 * Combines ADX, RSI, EMA slope, and volatility into a deterministic regime.
 */

import type { Candle, MarketRegime, RegimeSignal, VolatilityRegime } from './types.js';
import { adxLast, rsiLast, ema, atrLast, closes } from './indicators.js';

export class RegimeDetector {
  private readonly adxTrendThreshold = 20; // lowered from 25 — altcoins trend at lower ADX values
  private readonly adxStrongThreshold = 40;
  private readonly rsiOverbought = 70;
  private readonly rsiOversold = 30;

  detect(candles: Candle[]): RegimeSignal {
    if (candles.length < 50) {
      return {
        regime: 'unknown',
        adx: 0,
        rsi: 50,
        trend: 'flat',
        volatilityRegime: 'normal',
        reasoning: 'Not enough data',
      };
    }

    const c = closes(candles);
    const adxVal = adxLast(candles, 14);
    const rsiVal = rsiLast(c, 14);
    const ema20 = ema(c, 20);
    const ema50 = ema(c, 50);
    const atrVal = atrLast(candles, 14);

    const lastClose = c[c.length - 1];
    const e20 = ema20[ema20.length - 1];
    const e50 = ema50[ema50.length - 1];

    // EMA slope over last 5 candles
    const e20_5ago = ema20[ema20.length - 6] ?? e20;
    const emaSlope = (e20 - e20_5ago) / (e20_5ago || 1);

    // Volatility regime from ATR % of price
    const atrPct = atrVal / lastClose;
    const volatilityRegime = this.classifyVolatility(atrPct);

    // Trend direction
    const trend = e20 > e50 ? 'up' : e20 < e50 ? 'down' : 'flat';

    let regime: MarketRegime;
    let reasoning = `ADX=${adxVal.toFixed(1)}, RSI=${rsiVal.toFixed(1)}, EMA20>${e20.toFixed(2)}, EMA50=${e50.toFixed(2)}`;

    if (volatilityRegime === 'extreme') {
      regime = 'volatile';
      reasoning = `[VOLATILE] ATR=${(atrPct * 100).toFixed(2)}% of price`;
    } else if (adxVal >= this.adxTrendThreshold) {
      regime = trend === 'up' ? 'trending_up' : 'trending_down';
      reasoning = `[${regime}] ADX=${adxVal.toFixed(1)}, EMAs ${trend}`;
    } else {
      regime = 'ranging';
      reasoning = `[RANGING] ADX=${adxVal.toFixed(1)} < ${this.adxTrendThreshold}`;
    }

    return { regime, adx: adxVal, rsi: rsiVal, trend, volatilityRegime, reasoning };
  }

  private classifyVolatility(atrPct: number): VolatilityRegime {
    if (atrPct < 0.005) return 'low';
    if (atrPct < 0.015) return 'normal';
    if (atrPct < 0.03)  return 'high';
    return 'extreme';
  }
}
