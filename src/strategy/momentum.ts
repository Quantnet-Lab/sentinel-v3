/**
 * Momentum Strategy — MACD crossover + EMA trend + RSI filter.
 * Fires in trending regimes as the ensemble fallback.
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import { closes, ema, macd, rsiLast, atrLast } from '../strategy/indicators.js';
import { HOLD_SIGNAL as makeHold } from './types.js';

export class MomentumStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 60) return makeHold(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'momentum');

    const c = closes(candles);
    const { macd: macdLine, signal: signalLine } = macd(c, 12, 26, 9);
    const ema50 = ema(c, 50);
    const rsiVal = rsiLast(c, 14);
    const atrVal = atrLast(candles, 14);
    const price = c[c.length - 1];

    const macdCurr = macdLine[macdLine.length - 1];
    const macdPrev = macdLine[macdLine.length - 2];
    const sigCurr  = signalLine[signalLine.length - 1];
    const sigPrev  = signalLine[signalLine.length - 2];
    const e50 = ema50[ema50.length - 1];

    const bullCross = macdPrev < sigPrev && macdCurr > sigCurr;
    const bearCross = macdPrev > sigPrev && macdCurr < sigCurr;
    const aboveEma  = price > e50;
    const belowEma  = price < e50;

    if ((regime === 'trending_up' || regime === 'ranging') && bullCross && aboveEma && rsiVal < 70) {
      const confidence = this.confidence(rsiVal, macdCurr - sigCurr, atrVal, 'buy');
      return {
        direction: 'buy',
        confidence,
        strategy: 'momentum',
        price,
        stopLoss:   price - atrVal * 2,
        takeProfit: price + atrVal * 3,
        reasoning:  `[MOMENTUM BUY] MACD crossover above EMA50. MACD=${macdCurr.toFixed(4)}, RSI=${rsiVal.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    if ((regime === 'trending_down' || regime === 'ranging') && bearCross && belowEma && rsiVal > 30) {
      const confidence = this.confidence(rsiVal, sigCurr - macdCurr, atrVal, 'sell');
      return {
        direction: 'sell',
        confidence,
        strategy: 'momentum',
        price,
        stopLoss:   price + atrVal * 2,
        takeProfit: price - atrVal * 3,
        reasoning:  `[MOMENTUM SELL] MACD crossover below EMA50. MACD=${macdCurr.toFixed(4)}, RSI=${rsiVal.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return makeHold(price, regime, `No MACD crossover or trend misalignment. MACD=${macdCurr?.toFixed(4)}, RSI=${rsiVal.toFixed(1)}`, 'momentum');
  }

  private confidence(rsi: number, macdStrength: number, atr: number, dir: 'buy' | 'sell'): number {
    let score = 0.5;
    if (dir === 'buy') {
      if (rsi < 60) score += 0.1;
      if (rsi > 50) score += 0.05;
    } else {
      if (rsi > 40) score += 0.1;
      if (rsi < 50) score += 0.05;
    }
    if (macdStrength > atr * 0.01) score += 0.1;
    return Math.max(0, Math.min(1, score));
  }
}
