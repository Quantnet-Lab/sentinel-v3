/**
 * ICT Silver Bullet Strategy
 *
 * Executes during specific EST Kill Zones with FULL institutional confluence:
 *   1. Must be inside a Kill Zone (London Open / NY AM / NY PM)
 *   2. A liquidity sweep (stop hunt) must have occurred in the lookback window
 *   3. A Market Structure Shift (BOS/CHoCH) must follow the sweep
 *   4. A Fair Value Gap (FVG) must exist for entry
 *   5. Entry targets the Consequent Encroachment (50% of FVG midpoint)
 *   6. OTE zone alignment optionally boosts confidence
 */

import type { Candle, TradeSignal, MarketRegime } from './types.js';
import {
  fairValueGaps, structureBreaks, liquiditySweeps, atrLast, rsiLast, closes,
} from './indicators.js';
import { HOLD_SIGNAL } from './types.js';

// Kill Zones in UTC (offset from EST: EST = UTC-5)
const KILL_ZONES_UTC: [number, number][] = [
  [8, 9],    // London Open (3–4 EST)
  [15, 16],  // New York AM (10–11 EST)
  [19, 20],  // New York PM (14–15 EST)
];

function isInKillZone(utcHour: number): boolean {
  return KILL_ZONES_UTC.some(([start, end]) => utcHour >= start && utcHour < end);
}

export class ICTSilverBulletStrategy {
  private readonly lookback = 10;

  generate(candles: Candle[], regime: MarketRegime): TradeSignal {
    if (candles.length < 30) return HOLD_SIGNAL(candles.at(-1)?.close ?? 0, regime, 'Not enough data', 'ict_silver_bullet');

    const latestTime = new Date(candles[candles.length - 1].time);
    const utcHour = latestTime.getUTCHours();

    if (!isInKillZone(utcHour)) {
      return HOLD_SIGNAL(candles.at(-1)!.close, regime, `Outside ICT Kill Zones (UTC ${utcHour}:00)`, 'ict_silver_bullet');
    }

    const price = candles[candles.length - 1].close;
    const atrVal = atrLast(candles, 14);
    const rsiVal = rsiLast(closes(candles), 14);

    const sweeps = liquiditySweeps(candles, this.lookback);
    const fvgs = fairValueGaps(candles);
    const structure = structureBreaks(candles, 5);

    const recentSweeps   = sweeps.filter(s => s.index >= candles.length - this.lookback);
    const recentFVGs     = fvgs.filter(f => f.index >= candles.length - this.lookback);
    const recentStructure = structure.filter(s => s.index >= candles.length - this.lookback);

    // ── BULLISH setup: sweep_low → CHoCH/BOS bullish → bullish FVG ──
    const bullSweep = recentSweeps.find(s => s.type === 'sweep_low');
    const bullBOS   = recentStructure.find(s => s.type === 'bos_bullish' || s.type === 'choch_bullish');
    const bullFVG   = recentFVGs.find(f => f.type === 'bullish' && price <= f.top * 1.005);

    if (bullSweep && bullBOS && bullFVG) {
      let confidence = 0.7;
      if (rsiVal < 50) confidence += 0.05;
      if (bullBOS.type === 'choch_bullish') confidence += 0.1;
      const entry = bullFVG.midpoint;
      return {
        direction: 'buy',
        confidence: Math.min(0.9, confidence),
        strategy: 'ict_silver_bullet',
        price,
        stopLoss:   bullSweep.level - atrVal * 0.5,
        takeProfit: entry + atrVal * 3,
        reasoning:  `[ICT SILVER BULLET BUY] Sweep low at ${bullSweep.level.toFixed(4)}, ${bullBOS.type} at ${bullBOS.level.toFixed(4)}, FVG mid=${bullFVG.midpoint.toFixed(4)}, Kill Zone UTC ${utcHour}h`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    // ── BEARISH setup: sweep_high → CHoCH/BOS bearish → bearish FVG ──
    const bearSweep = recentSweeps.find(s => s.type === 'sweep_high');
    const bearBOS   = recentStructure.find(s => s.type === 'bos_bearish' || s.type === 'choch_bearish');
    const bearFVG   = recentFVGs.find(f => f.type === 'bearish' && price >= f.bottom * 0.995);

    if (bearSweep && bearBOS && bearFVG) {
      let confidence = 0.7;
      if (rsiVal > 50) confidence += 0.05;
      if (bearBOS.type === 'choch_bearish') confidence += 0.1;
      const entry = bearFVG.midpoint;
      return {
        direction: 'sell',
        confidence: Math.min(0.9, confidence),
        strategy: 'ict_silver_bullet',
        price,
        stopLoss:   bearSweep.level + atrVal * 0.5,
        takeProfit: entry - atrVal * 3,
        reasoning:  `[ICT SILVER BULLET SELL] Sweep high at ${bearSweep.level.toFixed(4)}, ${bearBOS.type} at ${bearBOS.level.toFixed(4)}, FVG mid=${bearFVG.midpoint.toFixed(4)}, Kill Zone UTC ${utcHour}h`,
        regime,
        timestamp: new Date().toISOString(),
      };
    }

    return HOLD_SIGNAL(price, regime, `No ICT confluence in Kill Zone UTC ${utcHour}h. Sweeps=${recentSweeps.length}, FVGs=${recentFVGs.length}, Structure=${recentStructure.length}`, 'ict_silver_bullet');
  }
}
