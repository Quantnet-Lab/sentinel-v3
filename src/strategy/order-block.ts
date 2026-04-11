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

    // Filter valid OBs: untouched (first retest only), not stale (< 60 candles old), minimum strength
    const maxAge = 60;
    const untouchedBullish = blocks.filter(ob => {
      if (ob.type !== 'bullish') return false;
      if (ob.strength < 0.4) return false; // raised from 0.3
      if (candles.length - ob.index > maxAge) return false; // discard stale OBs
      const afterOB = candles.slice(ob.index + 2);
      const retested = afterOB.filter(c => c.low <= ob.top && c.high >= ob.bottom);
      return retested.length === 0 || retested.length === 1;
    });

    const untouchedBearish = blocks.filter(ob => {
      if (ob.type !== 'bearish') return false;
      if (ob.strength < 0.4) return false;
      if (candles.length - ob.index > maxAge) return false;
      const afterOB = candles.slice(ob.index + 2);
      const retested = afterOB.filter(c => c.high >= ob.bottom && c.low <= ob.top);
      return retested.length === 0 || retested.length === 1;
    });

    const recentStructure = structure.filter(s => s.index >= candles.length - 15);
    const recentFVGs = fvgs.filter(f => f.index >= candles.length - 15);

    // Crypto-wider OB zone tolerance (0.5%) — wicks are large in crypto, entries need room
    const bullOB = untouchedBullish.find(ob =>
      price >= ob.bottom * 0.995 && price <= ob.top * 1.005 && ob.strength > 0.4,
    );
    if (bullOB) {
      const hasBOS = recentStructure.some(s => s.type === 'bos_bullish' || s.type === 'choch_bullish');
      const hasFVG = recentFVGs.some(f => f.type === 'bullish');
      const hasSweep = recentSweepLow; // sweep of lows into bullish OB = stop hunt reversal
      // Crypto RSI 70 ceiling for buys — uptrends stay elevated
      if (hasBOS && rsiVal < 70) {
        const sweepBonus = hasSweep ? 0.08 : 0;
        const confidence = 0.6 + bullOB.strength * 0.2 + (hasFVG ? 0.08 : 0) + sweepBonus;
        return {
          direction: 'buy',
          confidence: Math.min(0.92, confidence),
          strategy: 'order_block',
          price,
          stopLoss:   bullOB.bottom - atrVal * 0.75, // slightly wider for crypto wicks
          takeProfit: price + atrVal * 3,
          reasoning:  `[ORDER BLOCK BUY] Bullish OB [${bullOB.bottom.toFixed(4)},${bullOB.top.toFixed(4)}] str=${bullOB.strength.toFixed(2)} FVG=${hasFVG} sweep=${hasSweep}`,
          regime,
          timestamp: new Date().toISOString(),
        };
      }
    }

    const bearOB = untouchedBearish.find(ob =>
      price <= ob.top * 1.005 && price >= ob.bottom * 0.995 && ob.strength > 0.4,
    );
    if (bearOB) {
      const hasBOS = recentStructure.some(s => s.type === 'bos_bearish' || s.type === 'choch_bearish');
      const hasFVG = recentFVGs.some(f => f.type === 'bearish');
      const hasSweep = recentSweepHigh; // sweep of highs into bearish OB = stop hunt reversal
      // Crypto RSI 30 floor for sells — downtrends stay oversold longer
      if (hasBOS && rsiVal > 30) {
        const sweepBonus = hasSweep ? 0.08 : 0;
        const confidence = 0.6 + bearOB.strength * 0.2 + (hasFVG ? 0.08 : 0) + sweepBonus;
        return {
          direction: 'sell',
          confidence: Math.min(0.92, confidence),
          strategy: 'order_block',
          price,
          stopLoss:   bearOB.top + atrVal * 0.75,
          takeProfit: price - atrVal * 3,
          reasoning:  `[ORDER BLOCK SELL] Bearish OB [${bearOB.bottom.toFixed(4)},${bearOB.top.toFixed(4)}] str=${bearOB.strength.toFixed(2)} FVG=${hasFVG} sweep=${hasSweep}`,
          regime,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return HOLD_SIGNAL(price, regime, `No OB retest. BullOBs=${untouchedBullish.length}, BearOBs=${untouchedBearish.length}`, 'order_block');
  }
}
