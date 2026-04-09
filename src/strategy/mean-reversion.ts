/**
 * Mean Reversion Strategy — Bollinger Band squeeze + Z-Score extremes.
 * Fires in ranging/low-volatility regimes.
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import { closes, bollingerBands, rsiLast, atrLast, zscoreLast } from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

export class MeanReversionStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 30) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'mean_reversion');

    const c = closes(candles);
    const bb = bollingerBands(c, 20, 2);
    const rsiVal = rsiLast(c, 14);
    const atrVal = atrLast(candles, 14);
    const zVal = zscoreLast(c, 20);
    const price = c[c.length - 1];

    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const middle = bb.middle[bb.middle.length - 1];
    const bw = bb.bandwidth[bb.bandwidth.length - 1];

    // Only trade mean reversion in ranging markets with tight bands
    if (regime !== 'ranging' && regime !== 'unknown') {
      return HOLD_SIGNAL(price, regime, `Mean reversion skipped in ${regime} regime`, 'mean_reversion');
    }

    // BUY: price below lower band, oversold RSI, negative z-score
    if (price < lower && rsiVal < 35 && zVal < -1.5) {
      const confidence = 0.5 + Math.min(0.3, (35 - rsiVal) / 100) + Math.min(0.2, Math.abs(zVal) * 0.05);
      return {
        direction: 'buy',
        confidence: Math.min(0.85, confidence),
        strategy: 'mean_reversion',
        price,
        stopLoss:   price - atrVal * 1.5,
        takeProfit: middle,
        reasoning:  `[MEAN REVERSION BUY] Price ${price.toFixed(4)} < BB lower ${lower.toFixed(4)}, RSI=${rsiVal.toFixed(1)}, Z=${zVal.toFixed(2)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    // SELL: price above upper band, overbought RSI, positive z-score
    if (price > upper && rsiVal > 65 && zVal > 1.5) {
      const confidence = 0.5 + Math.min(0.3, (rsiVal - 65) / 100) + Math.min(0.2, Math.abs(zVal) * 0.05);
      return {
        direction: 'sell',
        confidence: Math.min(0.85, confidence),
        strategy: 'mean_reversion',
        price,
        stopLoss:   price + atrVal * 1.5,
        takeProfit: middle,
        reasoning:  `[MEAN REVERSION SELL] Price ${price.toFixed(4)} > BB upper ${upper.toFixed(4)}, RSI=${rsiVal.toFixed(1)}, Z=${zVal.toFixed(2)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return HOLD_SIGNAL(price, regime, `No BB extreme. Price=${price.toFixed(4)}, BB=[${lower.toFixed(4)},${upper.toFixed(4)}], RSI=${rsiVal.toFixed(1)}`, 'mean_reversion');
  }
}
