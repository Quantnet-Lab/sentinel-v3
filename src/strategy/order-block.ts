/**
 * Order Block Retest Strategy
 *
 * Detects institutional order blocks and trades the first retest:
 *   1. Identify a valid order block (strong displacement candle following OB)
 *   2. Wait for price to return to the OB zone (first retest)
 *   3. Require BOS/CHoCH in the expected direction
 *   4. FVG inside or near the OB for precision entry
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import { orderBlocks, structureBreaks, fairValueGaps, liquiditySweeps, atrLast, rsiLast, closes } from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

export class OrderBlockStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 40) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'order_block');

    const price = candles[candles.length - 1].close;
    const atrVal = atrLast(candles, 14);
    const rsiVal = rsiLast(closes(candles), 14);

    const blocks = orderBlocks(candles.slice(0, -5), 10); // don't look at last 5 (too recent)
    const structure = structureBreaks(candles, 5);
    const fvgs = fairValueGaps(candles);
    const sweeps = liquiditySweeps(candles, 10);
    // Liquidity sweep into OB = highest probability crypto setup (stop hunt before reversal)
    const recentSweepHigh = sweeps.some(s => s.type === 'sweep_high' && s.index >= candles.length - 5);
    const recentSweepLow  = sweeps.some(s => s.type === 'sweep_low'  && s.index >= candles.length - 5);

    // Filter valid OBs: max 1 prior retest (altcoins get touched more), max 80 candles old, min strength 0.35
    const maxAge = 80;
    const untouchedBullish = blocks.filter(ob => {
      if (ob.type !== 'bullish') return false;
      if (ob.strength < 0.35) return false;
      if (candles.length - ob.index > maxAge) return false;
      const afterOB = candles.slice(ob.index + 2, -3);
      const retested = afterOB.filter(c => c.low <= ob.top && c.high >= ob.bottom);
      return retested.length <= 1; // allow 1 prior retest — altcoins often poke levels before reversing
    });

    const untouchedBearish = blocks.filter(ob => {
      if (ob.type !== 'bearish') return false;
      if (ob.strength < 0.35) return false;
      if (candles.length - ob.index > maxAge) return false;
      const afterOB = candles.slice(ob.index + 2, -3);
      const retested = afterOB.filter(c => c.high >= ob.bottom && c.low <= ob.top);
      return retested.length <= 1;
    });

    const recentStructure = structure.filter(s => s.index >= candles.length - 20);
    const recentFVGs = fvgs.filter(f => f.index >= candles.length - 20);

    // Crypto-wider OB zone tolerance (0.5%) — wicks are large in crypto, entries need room
    const bullOB = untouchedBullish.find(ob =>
      price >= ob.bottom * 0.995 && price <= ob.top * 1.005,
    );
    if (bullOB && rsiVal < 72) {
      // BOS/CHoCH is a confidence boost, not a hard gate — altcoins have less frequent structure breaks
      const hasBOS = recentStructure.some(s => s.type === 'bos_bullish' || s.type === 'choch_bullish');
      const hasFVG = recentFVGs.some(f => f.type === 'bullish');
      const hasSweep = recentSweepLow;
      const bosBonus   = hasBOS   ? 0.08 : 0;
      const sweepBonus = hasSweep ? 0.08 : 0;
      const fvgBonus   = hasFVG   ? 0.06 : 0;
      const confidence = 0.52 + bullOB.strength * 0.2 + bosBonus + fvgBonus + sweepBonus;
      return {
        direction: 'buy',
        confidence: Math.min(0.92, confidence),
        strategy: 'order_block',
        price,
        stopLoss:   bullOB.bottom - atrVal * 0.75,
        takeProfit: price + atrVal * 3,
        reasoning:  `[ORDER BLOCK BUY] Bullish OB [${bullOB.bottom.toFixed(2)},${bullOB.top.toFixed(2)}] str=${bullOB.strength.toFixed(2)} BOS=${hasBOS} FVG=${hasFVG} sweep=${hasSweep}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    const bearOB = untouchedBearish.find(ob =>
      price <= ob.top * 1.005 && price >= ob.bottom * 0.995,
    );
    if (bearOB && rsiVal > 28) {
      const hasBOS = recentStructure.some(s => s.type === 'bos_bearish' || s.type === 'choch_bearish');
      const hasFVG = recentFVGs.some(f => f.type === 'bearish');
      const hasSweep = recentSweepHigh;
      const bosBonus   = hasBOS   ? 0.08 : 0;
      const sweepBonus = hasSweep ? 0.08 : 0;
      const fvgBonus   = hasFVG   ? 0.06 : 0;
      const confidence = 0.52 + bearOB.strength * 0.2 + bosBonus + fvgBonus + sweepBonus;
      return {
        direction: 'sell',
        confidence: Math.min(0.92, confidence),
        strategy: 'order_block',
        price,
        stopLoss:   bearOB.top + atrVal * 0.75,
        takeProfit: price - atrVal * 3,
        reasoning:  `[ORDER BLOCK SELL] Bearish OB [${bearOB.bottom.toFixed(2)},${bearOB.top.toFixed(2)}] str=${bearOB.strength.toFixed(2)} BOS=${hasBOS} FVG=${hasFVG} sweep=${hasSweep}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return HOLD_SIGNAL(price, regime, `No OB retest. BullOBs=${untouchedBullish.length}, BearOBs=${untouchedBearish.length}`, 'order_block');
  }
}
