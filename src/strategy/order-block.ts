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
import { orderBlocks, structureBreaks, fairValueGaps, atrLast, rsiLast, closes } from './indicators.js';
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

    // Filter untouched OBs (price has not closed inside them since formation)
    const untouchedBullish = blocks.filter(ob => {
      if (ob.type !== 'bullish') return false;
      // Check price hasn't revisited this OB before now
      const afterOB = candles.slice(ob.index + 2);
      const retested = afterOB.filter(c => c.low <= ob.top && c.high >= ob.bottom);
      return retested.length === 0 || retested.length === 1; // first retest only
    });

    const untouchedBearish = blocks.filter(ob => {
      if (ob.type !== 'bearish') return false;
      const afterOB = candles.slice(ob.index + 2);
      const retested = afterOB.filter(c => c.high >= ob.bottom && c.low <= ob.top);
      return retested.length === 0 || retested.length === 1;
    });

    const recentStructure = structure.filter(s => s.index >= candles.length - 15);
    const recentFVGs = fvgs.filter(f => f.index >= candles.length - 15);

    // Bullish OB retest
    const bullOB = untouchedBullish.find(ob =>
      price >= ob.bottom * 0.999 && price <= ob.top * 1.001 && ob.strength > 0.3,
    );
    if (bullOB) {
      const hasBOS = recentStructure.some(s => s.type === 'bos_bullish' || s.type === 'choch_bullish');
      const hasFVG = recentFVGs.some(f => f.type === 'bullish');
      if (hasBOS && rsiVal < 60) {
        const confidence = 0.6 + bullOB.strength * 0.2 + (hasFVG ? 0.1 : 0);
        return {
          direction: 'buy',
          confidence: Math.min(0.88, confidence),
          strategy: 'order_block',
          price,
          stopLoss:   bullOB.bottom - atrVal * 0.5,
          takeProfit: price + atrVal * 3,
          reasoning:  `[ORDER BLOCK BUY] Bullish OB retest [${bullOB.bottom.toFixed(4)},${bullOB.top.toFixed(4)}], strength=${bullOB.strength.toFixed(2)}, FVG=${hasFVG}`,
          regime,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Bearish OB retest
    const bearOB = untouchedBearish.find(ob =>
      price <= ob.top * 1.001 && price >= ob.bottom * 0.999 && ob.strength > 0.3,
    );
    if (bearOB) {
      const hasBOS = recentStructure.some(s => s.type === 'bos_bearish' || s.type === 'choch_bearish');
      const hasFVG = recentFVGs.some(f => f.type === 'bearish');
      if (hasBOS && rsiVal > 40) {
        const confidence = 0.6 + bearOB.strength * 0.2 + (hasFVG ? 0.1 : 0);
        return {
          direction: 'sell',
          confidence: Math.min(0.88, confidence),
          strategy: 'order_block',
          price,
          stopLoss:   bearOB.top + atrVal * 0.5,
          takeProfit: price - atrVal * 3,
          reasoning:  `[ORDER BLOCK SELL] Bearish OB retest [${bearOB.bottom.toFixed(4)},${bearOB.top.toFixed(4)}], strength=${bearOB.strength.toFixed(2)}, FVG=${hasFVG}`,
          regime,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return HOLD_SIGNAL(price, regime, `No OB retest. BullOBs=${untouchedBullish.length}, BearOBs=${untouchedBearish.length}`, 'order_block');
  }
}
