/**
 * AMD Cycle Strategy (Accumulation → Manipulation → Distribution)
 *
 * Targets the NY session sequence:
 *   1. Identify Asia range (accumulation) from 20:00–00:00 UTC
 *   2. London manipulation sweep (00:00–08:00 UTC) — price takes out Asia range
 *   3. NY distribution — trade the reversal after the manipulation
 *   4. Requires CHoCH + FVG for entry confirmation
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import { fairValueGaps, structureBreaks, liquiditySweeps, atrLast, rsiLast, closes } from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

// NY Session open: 13:00 UTC
const NY_SESSION_START_UTC = 13;
const NY_SESSION_END_UTC = 21;

export class AMDCycleStrategy {
  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 50) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'amd_cycle');

    const latestTime = new Date(candles[candles.length - 1].time);
    const utcHour = latestTime.getUTCHours();

    if (utcHour < NY_SESSION_START_UTC || utcHour >= NY_SESSION_END_UTC) {
      return HOLD_SIGNAL(candles.at(-1)!.close, regime, `Outside NY session (UTC ${utcHour}:00)`, 'amd_cycle');
    }

    const price = candles[candles.length - 1].close;
    const atrVal = atrLast(candles, 14);
    const rsiVal = rsiLast(closes(candles), 14);

    // Asia range: look for candles 12–20 hours ago
    const now = candles[candles.length - 1].time;
    const asiaCandles = candles.filter(c => {
      const h = new Date(c.time).getUTCHours();
      return h >= 20 || h < 4;  // 20:00–04:00 UTC
    });

    if (asiaCandles.length < 5) {
      return HOLD_SIGNAL(price, regime, 'Not enough Asia session candles', 'amd_cycle');
    }

    const asiaHigh = Math.max(...asiaCandles.map(c => c.high));
    const asiaLow  = Math.min(...asiaCandles.map(c => c.low));
    const asiaRange = asiaHigh - asiaLow;

    // Manipulation: recent candle swept Asia range
    const lookback = 15;
    const recentCandles = candles.slice(-lookback);
    const sweeps = liquiditySweeps(candles, 20);
    const recentSweeps = sweeps.filter(s => s.index >= candles.length - lookback);

    const fvgs = fairValueGaps(candles);
    const structure = structureBreaks(candles, 5);
    const recentFVGs = fvgs.filter(f => f.index >= candles.length - lookback);
    const recentStructure = structure.filter(s => s.index >= candles.length - lookback);

    // Bullish AMD: swept Asia low (manipulation), then reversed up (distribution)
    const sweptLow  = recentSweeps.find(s => s.type === 'sweep_low'  && s.level <= asiaLow  * 1.002);
    const sweptHigh = recentSweeps.find(s => s.type === 'sweep_high' && s.level >= asiaHigh * 0.998);

    if (sweptLow) {
      const choch = recentStructure.find(s => s.type === 'choch_bullish' || s.type === 'bos_bullish');
      const fvg   = recentFVGs.find(f => f.type === 'bullish');
      if (choch && fvg && rsiVal < 55) {
        return {
          direction: 'buy',
          confidence: 0.75,
          strategy: 'amd_cycle',
          price,
          stopLoss:   asiaLow - atrVal,
          takeProfit: asiaHigh + asiaRange * 0.5,
          reasoning:  `[AMD BUY] Asia low swept at ${sweptLow.level.toFixed(4)}, CHoCH at ${choch.level.toFixed(4)}, FVG mid=${fvg.midpoint.toFixed(4)}, NY ${utcHour}h`,
          regime,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Bearish AMD: swept Asia high, then reversed down
    if (sweptHigh) {
      const choch = recentStructure.find(s => s.type === 'choch_bearish' || s.type === 'bos_bearish');
      const fvg   = recentFVGs.find(f => f.type === 'bearish');
      if (choch && fvg && rsiVal > 45) {
        return {
          direction: 'sell',
          confidence: 0.75,
          strategy: 'amd_cycle',
          price,
          stopLoss:   asiaHigh + atrVal,
          takeProfit: asiaLow - asiaRange * 0.5,
          reasoning:  `[AMD SELL] Asia high swept at ${sweptHigh.level.toFixed(4)}, CHoCH at ${choch.level.toFixed(4)}, FVG mid=${fvg.midpoint.toFixed(4)}, NY ${utcHour}h`,
          regime,
          timestamp: new Date().toISOString(),
        };
      }
    }

    return HOLD_SIGNAL(price, regime, `No AMD confluence. Asia=[${asiaLow.toFixed(4)},${asiaHigh.toFixed(4)}], Sweeps=${recentSweeps.length}`, 'amd_cycle');
  }
}
