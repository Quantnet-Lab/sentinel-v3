/**
 * Momentum Strategy — SMA crossover + trend continuation scoring.
 *
 * Fires continuously whenever:
 *   1. SMA(20) crosses SMA(50) — crossover signal
 *   2. SMA separation > 0.3% — trend continuation (no crossover needed)
 *   3. Short momentum (5-bar return) aligns with trend direction
 *
 * No kill zones. No session restrictions. 24/7 crypto compatible.
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import { closes, ema, rsiLast, atrLast } from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

export class MomentumStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 60) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'momentum');

    const c     = closes(candles);
    const price = c[c.length - 1];
    const atr   = atrLast(candles, 14);
    const rsi   = rsiLast(c, 14);

    // SMA via EMA (same values at period boundaries, faster)
    const sma20 = ema(c, 20);
    const sma50 = ema(c, 50);

    const s20      = sma20[sma20.length - 1];
    const s20prev  = sma20[sma20.length - 2];
    const s50      = sma50[sma50.length - 1];
    const s50prev  = sma50[sma50.length - 2];

    // SMA separation as % of price
    const separation = (s20 - s50) / price;

    // 5-bar short momentum
    const momentum5 = (price - c[c.length - 6]) / c[c.length - 6];

    // Crossover detection
    const bullCross = s20prev < s50prev && s20 > s50;
    const bearCross = s20prev > s50prev && s20 < s50;

    // Trend continuation — lowered to 0.05% so it fires in ranging markets too
    const bullTrend = separation > 0.0005 && momentum5 > 0;
    const bearTrend = separation < -0.0005 && momentum5 < 0;

    const isBull = bullCross || bullTrend;
    const isBear = bearCross || bearTrend;

    if (!isBull && !isBear) {
      return HOLD_SIGNAL(price, regime, `No trend. Sep=${(separation*100).toFixed(2)}%, Mom5=${(momentum5*100).toFixed(2)}%`, 'momentum');
    }

    // Score: base + separation strength + momentum alignment + RSI filter
    const sepStrength = Math.min(Math.abs(separation) / 0.003, 1.0); // caps at 0.3% sep
    const momStrength = Math.min(Math.abs(momentum5) / 0.001, 1.0);  // caps at 0.1% mom

    if (isBull && rsi < 75) {
      const crossBonus = bullCross ? 0.1 : 0;
      const confidence = Math.min(0.85, 0.45 + sepStrength * 0.2 + momStrength * 0.15 + crossBonus);
      return {
        direction: 'buy',
        confidence,
        strategy: 'momentum',
        price,
        stopLoss:   price - atr * 2,
        takeProfit: price + atr * 3,
        reasoning:  `[MOMENTUM BUY] ${bullCross ? 'SMA crossover' : 'Trend continuation'} sep=${(separation*100).toFixed(2)}% mom5=${(momentum5*100).toFixed(2)}% RSI=${rsi.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    if (isBear && rsi > 25) {
      const crossBonus = bearCross ? 0.1 : 0;
      const confidence = Math.min(0.85, 0.45 + sepStrength * 0.2 + momStrength * 0.15 + crossBonus);
      return {
        direction: 'sell',
        confidence,
        strategy: 'momentum',
        price,
        stopLoss:   price + atr * 2,
        takeProfit: price - atr * 3,
        reasoning:  `[MOMENTUM SELL] ${bearCross ? 'SMA crossover' : 'Trend continuation'} sep=${(separation*100).toFixed(2)}% mom5=${(momentum5*100).toFixed(2)}% RSI=${rsi.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return HOLD_SIGNAL(price, regime, `RSI filter blocked. RSI=${rsi.toFixed(1)}`, 'momentum');
  }
}
