/**
 * Ensemble Strategy — the brain of Sentinel v3.
 *
 * Priority hierarchy (first non-HOLD wins):
 *   1. ICT Silver Bullet  — Kill Zone + sweep + MSS + FVG (highest precision)
 *   2. AMD Cycle          — NY session + manipulation sweep + reversal
 *   3. Order Block Retest — any time, untouched OB + first retest + BOS + FVG
 *   4. Engulfing          — any time, engulfing at key level + RSI
 *   5. Momentum           — trending regimes, MACD crossover + EMA
 *   6. Mean Reversion     — ranging regimes, BB extreme + Z-Score
 *
 * Each strategy only fires when ALL its confluence requirements are met.
 */

import type { Candle, TradeSignal, RegimeSignal, MarketRegime } from './types.js';
import { RegimeDetector } from './regime.js';
import { ICTSilverBulletStrategy } from './ict-smc.js';
import { AMDCycleStrategy } from './amd-cycle.js';
import { OrderBlockStrategy } from './order-block.js';
import { EngulfingStrategy } from './engulfing.js';
import { MomentumStrategy } from './momentum.js';
import { MeanReversionStrategy } from './mean-reversion.js';
import { HOLD_SIGNAL } from './types.js';

export interface EnsembleResult {
  regimeSignal: RegimeSignal;
  tradeSignal: TradeSignal;        // first fired signal or HOLD (backward compat)
  tradeSignals: TradeSignal[];     // ALL signals that met threshold (one per strategy)
  strategyEvaluations: { name: string; signal: string; confidence: number }[];
}

export class EnsembleStrategy {
  private regime     = new RegimeDetector();
  private ictSmc     = new ICTSilverBulletStrategy();
  private amdCycle   = new AMDCycleStrategy();
  private orderBlock = new OrderBlockStrategy();
  private engulfing  = new EngulfingStrategy();
  private momentum   = new MomentumStrategy();
  private meanRev    = new MeanReversionStrategy();

  private readonly minConfidence: number;

  constructor(minConfidence = 0.5) {
    this.minConfidence = minConfidence;
  }

  analyze(candles: Candle[]): EnsembleResult {
    const regimeSignal = this.regime.detect(candles);
    const { regime } = regimeSignal;
    const price = candles.at(-1)?.close ?? 0;

    const evaluations: { name: string; signal: string; confidence: number }[] = [];

    const strategies: [string, () => TradeSignal][] = [
      ['ict_silver_bullet', () => this.ictSmc.generate(candles, regime)],
      ['amd_cycle',         () => this.amdCycle.generate(candles, regime)],
      ['order_block',       () => this.orderBlock.generate(candles, regime)],
      ['engulfing',         () => this.engulfing.generate(candles, regime)],
      ['momentum',          () => this.momentum.generate(candles, regime)],
      ['mean_reversion',    () => this.meanRev.generate(candles, regime)],
    ];

    const firedSignals: TradeSignal[] = [];

    for (const [name, fn] of strategies) {
      const signal = fn();
      evaluations.push({ name, signal: signal.direction, confidence: signal.confidence });

      if (signal.direction !== 'hold' && signal.confidence >= this.minConfidence) {
        firedSignals.push(signal);
        // continue — collect every strategy that fires, not just the first
      }
    }

    if (firedSignals.length > 0) {
      return {
        regimeSignal,
        tradeSignal:  firedSignals[0],
        tradeSignals: firedSignals,
        strategyEvaluations: evaluations,
      };
    }

    const hold = HOLD_SIGNAL(price, regime, 'No strategy reached min confidence threshold');
    return {
      regimeSignal,
      tradeSignal:  hold,
      tradeSignals: [],
      strategyEvaluations: evaluations,
    };
  }
}
