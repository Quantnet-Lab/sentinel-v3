/**
 * Ensemble Strategy — 3 complementary strategies for 24/7 crypto trading.
 *
 *   1. Order Block  — institutional SMC levels, any session
 *   2. Engulfing    — price-action momentum at key levels
 *   3. Momentum     — MACD crossover + EMA trend (trending regimes)
 *
 * All fired signals are returned independently for parallel execution.
 */

import type { Candle, TradeSignal, RegimeSignal, MarketRegime } from './types.js';
import { RegimeDetector } from './regime.js';
import { OrderBlockStrategy } from './order-block.js';
import { EngulfingStrategy } from './engulfing.js';
import { MomentumStrategy } from './momentum.js';
import { HOLD_SIGNAL } from './types.js';

export interface EnsembleResult {
  regimeSignal: RegimeSignal;
  tradeSignal: TradeSignal;        // first fired signal or HOLD (backward compat)
  tradeSignals: TradeSignal[];     // ALL signals that met threshold
  strategyEvaluations: { name: string; signal: string; confidence: number }[];
}

export class EnsembleStrategy {
  private regime     = new RegimeDetector();
  private orderBlock = new OrderBlockStrategy();
  private engulfing  = new EngulfingStrategy();
  private momentum   = new MomentumStrategy();

  private readonly minConfidence: number;

  constructor(minConfidence = 0.5) {
    this.minConfidence = minConfidence;
  }

  analyze(candles: Candle[]): EnsembleResult {
    const regimeSignal = this.regime.detect(candles);
    const { regime } = regimeSignal;
    const price = candles.at(-1)?.close ?? 0;

    const strategies: [string, () => TradeSignal][] = [
      ['order_block', () => this.orderBlock.generate(candles, regime)],
      ['engulfing',   () => this.engulfing.generate(candles, regime)],
      ['momentum',    () => this.momentum.generate(candles, regime)],
    ];

    const evaluations: { name: string; signal: string; confidence: number }[] = [];
    const firedSignals: TradeSignal[] = [];

    for (const [name, fn] of strategies) {
      const signal = fn();
      evaluations.push({ name, signal: signal.direction, confidence: signal.confidence });
      if (signal.direction !== 'hold' && signal.confidence >= this.minConfidence) {
        firedSignals.push(signal);
      }
    }

    if (firedSignals.length > 0) {
      // Confluence boost: when 2+ strategies agree on the same direction, reward it
      if (firedSignals.length >= 2) {
        const bullCount = firedSignals.filter(s => s.direction === 'buy').length;
        const bearCount = firedSignals.filter(s => s.direction === 'sell').length;
        const agreeingDir = bullCount >= 2 ? 'buy' : bearCount >= 2 ? 'sell' : null;
        if (agreeingDir) {
          const boost = firedSignals.length === 3 ? 0.08 : 0.05; // 3-way = stronger boost
          for (const s of firedSignals) {
            if (s.direction === agreeingDir) {
              (s as any).confidence = Math.min(0.95, s.confidence + boost);
              (s as any).reasoning = `[CONFLUENCE x${bullCount + bearCount}] ` + s.reasoning;
            }
          }
        }
      }
      return { regimeSignal, tradeSignal: firedSignals[0], tradeSignals: firedSignals, strategyEvaluations: evaluations };
    }

    const hold = HOLD_SIGNAL(price, regime, 'No strategy reached min confidence threshold');
    return { regimeSignal, tradeSignal: hold, tradeSignals: [], strategyEvaluations: evaluations };
  }
}
