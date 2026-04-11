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
import { closes, ema, macd, rsiLast, atrLast } from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

export class MomentumStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 60) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'momentum');

    // Suppress momentum only in ranging — volatile crypto markets often have the strongest momentum moves
    if (regime === 'ranging') {
      return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Momentum suppressed in ranging regime', 'momentum');
    }

    const c     = closes(candles);
    const price = c[c.length - 1];
    const atr   = atrLast(candles, 14);
    const rsi   = rsiLast(c, 14);

    const ema20 = ema(c, 20);
    const ema50 = ema(c, 50);

    const e20     = ema20[ema20.length - 1];
    const e20prev = ema20[ema20.length - 2];
    const e50     = ema50[ema50.length - 1];
    const e50prev = ema50[ema50.length - 2];

    // EMA separation as % of price — raised to 0.3% to filter weak trends
    const separation = (e20 - e50) / price;

    // 5-bar short momentum
    const momentum5 = (price - c[c.length - 6]) / c[c.length - 6];

    // MACD confirmation — histogram must be positive/negative and growing
    const macdResult = macd(c, 12, 26, 9);
    const hist     = macdResult.histogram;
    const histLast = hist[hist.length - 1];
    const histPrev = hist[hist.length - 2];
    const macdBull = !isNaN(histLast) && histLast > 0 && histLast > histPrev;
    const macdBear = !isNaN(histLast) && histLast < 0 && histLast < histPrev;

    // Crossover detection — fresh cross is strong enough on its own (MACD lags 15min crypto)
    const bullCross = e20prev < e50prev && e20 > e50;
    const bearCross = e20prev > e50prev && e20 < e50;

    // Trend continuation — requires 0.3% separation AND MACD alignment
    const bullTrend = separation > 0.003 && momentum5 > 0 && macdBull;
    const bearTrend = separation < -0.003 && momentum5 < 0 && macdBear;

    // Crossover standalone valid; continuation needs MACD confirmation
    const isBull = bullCross || bullTrend;
    const isBear = bearCross || bearTrend;

    if (!isBull && !isBear) {
      return HOLD_SIGNAL(price, regime, `No trend. Sep=${(separation*100).toFixed(2)}%, MACD hist=${histLast?.toFixed(4)}`, 'momentum');
    }

    const sepStrength = Math.min(Math.abs(separation) / 0.01, 1.0);  // caps at 1% sep
    const momStrength = Math.min(Math.abs(momentum5) / 0.005, 1.0);  // caps at 0.5% mom
    const macdStrength = Math.min(Math.abs(histLast ?? 0) / (atr * 0.1 || 1), 1.0);

    // Crypto-adjusted RSI limits — crypto runs hot, RSI 70-85 is normal in bull trends
    const volatilePenalty = regime === 'volatile' ? -0.05 : 0;
    const slMultiple = regime === 'volatile' ? 2.5 : 2.0; // wider stops in volatile crypto

    if (isBull && rsi < 80) {
      const crossBonus = bullCross ? 0.1 : 0;
      const confidence = Math.min(0.87, 0.50 + sepStrength * 0.15 + momStrength * 0.1 + macdStrength * 0.1 + crossBonus + volatilePenalty);
      return {
        direction: 'buy',
        confidence,
        strategy: 'momentum',
        price,
        stopLoss:   price - atr * slMultiple,
        takeProfit: price + atr * 3,
        reasoning:  `[MOMENTUM BUY] ${bullCross ? 'EMA cross' : 'Trend continuation'} sep=${(separation*100).toFixed(2)}% MACD=${histLast?.toFixed(4)} RSI=${rsi.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    if (isBear && rsi > 20) {
      const crossBonus = bearCross ? 0.1 : 0;
      const confidence = Math.min(0.87, 0.50 + sepStrength * 0.15 + momStrength * 0.1 + macdStrength * 0.1 + crossBonus + volatilePenalty);
      return {
        direction: 'sell',
        confidence,
        strategy: 'momentum',
        price,
        stopLoss:   price + atr * slMultiple,
        takeProfit: price - atr * 3,
        reasoning:  `[MOMENTUM SELL] ${bearCross ? 'EMA cross' : 'Trend continuation'} sep=${(separation*100).toFixed(2)}% MACD=${histLast?.toFixed(4)} RSI=${rsi.toFixed(1)}`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return HOLD_SIGNAL(price, regime, `RSI filter blocked. RSI=${rsi.toFixed(1)}`, 'momentum');
  }
}
