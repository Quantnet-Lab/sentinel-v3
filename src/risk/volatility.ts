/**
 * Volatility Tracker — classifies current market volatility regime.
 * Used by the risk engine and circuit breaker.
 */

import type { VolatilityRegime } from '../strategy/types.js';

export interface VolatilityState {
  current: number | null;
  baseline: number;
  ratio: number;
  regime: VolatilityRegime;
  spikeDetected: boolean;
}

export class VolatilityTracker {
  private readings: number[] = [];
  private readonly maxReadings = 100;
  private readonly baseline: number;

  constructor(baselineVolatility = 0.01) {
    this.baseline = baselineVolatility;
  }

  update(atrPct: number): VolatilityState {
    this.readings.push(atrPct);
    if (this.readings.length > this.maxReadings) this.readings.shift();
    return this.getState();
  }

  getState(): VolatilityState {
    const current = this.readings.length > 0
      ? this.readings.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, this.readings.length)
      : null;

    const ratio = current != null ? current / this.baseline : 1;
    const regime = this.classify(current ?? this.baseline);
    const spikeDetected = ratio > 3;

    return { current, baseline: this.baseline, ratio, regime, spikeDetected };
  }

  private classify(atrPct: number): VolatilityRegime {
    if (atrPct < 0.005) return 'low';
    if (atrPct < 0.015) return 'normal';
    if (atrPct < 0.03)  return 'high';
    return 'extreme';
  }
}
