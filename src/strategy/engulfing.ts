/**
 * Engulfing at Key Level Strategy
 *
 * Trades engulfing candles that form at institutional levels:
 *   1. Identify a bullish/bearish engulfing candle
 *   2. Must be at a key level (near OB, swing high/low, or FVG)
 *   3. RSI confirmation (not overextended)
 *   4. Volume confirmation (engulfing body > prior body)
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import { orderBlocks, swingHighs, swingLows, atrLast, rsiLast, closes } from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

export class EngulfingStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 30) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'engulfing');

    const price = candles[candles.length - 1].close;
    const atrVal = atrLast(candles, 14);
    const rsiVal = rsiLast(closes(candles), 14);

    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);

    // Bullish engulfing: curr closes above prev open AND body is larger
    const bullEngulf = curr.open < prev.close && curr.close > prev.open && currBody > prevBody && curr.close > curr.open;
    // Bearish engulfing: curr closes below prev open AND body is larger
    const bearEngulf = curr.open > prev.close && curr.close < prev.open && currBody > prevBody && curr.close < curr.open;

    if (!bullEngulf && !bearEngulf) {
      return HOLD_SIGNAL(price, regime, 'No engulfing pattern', 'engulfing');
    }

    // Check proximity to key level
    const blocks = orderBlocks(candles.slice(0, -3), 10);
    const shighs = swingHighs(candles, 5);
    const slows  = swingLows(candles, 5);
    const nearestSwingHigh = candles.filter((_, i) => shighs[i]).map(c => c.high).filter(h => Math.abs(h - price) / price < 0.015);
    const nearestSwingLow  = candles.filter((_, i) => slows[i]).map(c => c.low).filter(l => Math.abs(l - price) / price < 0.015);

    const nearBullOB = blocks.some(ob => ob.type === 'bullish' && price >= ob.bottom * 0.998 && price <= ob.top * 1.002);
    const nearBearOB = blocks.some(ob => ob.type === 'bearish' && price >= ob.bottom * 0.998 && price <= ob.top * 1.002);
    const atKeyLevel = nearBullOB || nearBearOB || nearestSwingHigh.length > 0 || nearestSwingLow.length > 0;

    if (!atKeyLevel) {
      return HOLD_SIGNAL(price, regime, 'Engulfing pattern but not at a key level', 'engulfing');
    }

    if (bullEngulf && (nearBullOB || nearestSwingLow.length > 0) && rsiVal < 65) {
      const confidence = 0.55 + (currBody / prevBody - 1) * 0.1 + (nearBullOB ? 0.1 : 0);
      return {
        direction: 'buy',
        confidence: Math.min(0.82, confidence),
        strategy: 'engulfing',
        price,
        stopLoss:   curr.low - atrVal * 0.5,
        takeProfit: price + atrVal * 2.5,
        reasoning:  `[ENGULFING BUY] Bullish engulf at key level, body ratio=${(currBody / prevBody).toFixed(2)}, nearOB=${nearBullOB}, RSI=${rsiVal.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    if (bearEngulf && (nearBearOB || nearestSwingHigh.length > 0) && rsiVal > 35) {
      const confidence = 0.55 + (currBody / prevBody - 1) * 0.1 + (nearBearOB ? 0.1 : 0);
      return {
        direction: 'sell',
        confidence: Math.min(0.82, confidence),
        strategy: 'engulfing',
        price,
        stopLoss:   curr.high + atrVal * 0.5,
        takeProfit: price - atrVal * 2.5,
        reasoning:  `[ENGULFING SELL] Bearish engulf at key level, body ratio=${(currBody / prevBody).toFixed(2)}, nearOB=${nearBearOB}, RSI=${rsiVal.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return HOLD_SIGNAL(price, regime, 'Engulfing at key level but filters not met', 'engulfing');
  }
}
