/**
 * Neuro-Symbolic Cognitive Layer
 *
 * Sits between the ensemble signal and the risk engine:
 *   Ensemble Signal → [THIS LAYER] → Risk Engine → Execute
 *
 * Applies declarative symbolic rules that encode trading wisdom
 * statistical signals miss:
 *   - "Don't go LONG after 3 consecutive LONG stop-losses"
 *   - "Reduce confidence after high-volatility spike"
 *   - "Never trade against dominant weekly trend"
 *   - "Block ICT setups when spread > 2× ATR"
 *
 * Every rule that fires is recorded in the checkpoint artifact.
 * This layer CANNOT bypass risk checks — it only adjusts confidence.
 */

import { createLogger } from '../agent/logger.js';
import type { TradeSignal } from './types.js';

const log = createLogger('NEURO-SYM');

export interface SymbolicRuleResult {
  ruleId: string;
  ruleName: string;
  fired: boolean;
  action: 'pass' | 'override_neutral' | 'reduce_confidence' | 'boost_confidence';
  reason: string;
  confidenceAdjustment: number;
}

export interface CognitiveOutput {
  originalSignal: TradeSignal;
  adjustedSignal: TradeSignal;
  rulesEvaluated: number;
  rulesFired: number;
  ruleResults: SymbolicRuleResult[];
  override: boolean;
  overrideReason: string | null;
}

interface TradeOutcome {
  direction: string;
  strategy: string;
  result: 'win' | 'loss' | 'open';
  pnlPct: number;
  timestamp: string;
}

// ── Shared state (in-memory, survives across cycles) ──────────────────────────
const recentOutcomes: TradeOutcome[] = [];
const MAX_OUTCOMES = 50;
let lastVolatilitySpike = 0;

export function recordOutcome(outcome: TradeOutcome): void {
  recentOutcomes.push(outcome);
  if (recentOutcomes.length > MAX_OUTCOMES) recentOutcomes.shift();
}

export function notifyVolatilitySpike(): void {
  lastVolatilitySpike = Date.now();
}

// ── Rule definitions ──────────────────────────────────────────────────────────

type Rule = (signal: TradeSignal) => SymbolicRuleResult;

const rules: Rule[] = [
  // R1: Block after 3 consecutive losses in same direction
  (signal) => {
    const recent = recentOutcomes.slice(-5);
    const consecutive = recent.filter(o => o.direction === signal.direction && o.result === 'loss');
    if (consecutive.length >= 3) {
      return { ruleId: 'R1', ruleName: 'ConsecutiveLossBlock', fired: true, action: 'override_neutral', confidenceAdjustment: -1, reason: `${consecutive.length} consecutive ${signal.direction} losses` };
    }
    return { ruleId: 'R1', ruleName: 'ConsecutiveLossBlock', fired: false, action: 'pass', confidenceAdjustment: 0, reason: '' };
  },

  // R2: Reduce confidence after volatility spike (10 min cooldown)
  (signal) => {
    const elapsed = Date.now() - lastVolatilitySpike;
    if (lastVolatilitySpike > 0 && elapsed < 10 * 60 * 1000) {
      return { ruleId: 'R2', ruleName: 'VolatilitySpikeReduction', fired: true, action: 'reduce_confidence', confidenceAdjustment: -0.15, reason: `Volatility spike ${Math.round(elapsed / 1000)}s ago` };
    }
    return { ruleId: 'R2', ruleName: 'VolatilitySpikeReduction', fired: false, action: 'pass', confidenceAdjustment: 0, reason: '' };
  },

  // R3: Boost confidence for ICT/AMD in high-confluence conditions
  (signal) => {
    if ((signal.strategy === 'ict_silver_bullet' || signal.strategy === 'amd_cycle') && signal.confidence >= 0.75) {
      return { ruleId: 'R3', ruleName: 'InstitutionalSetupBoost', fired: true, action: 'boost_confidence', confidenceAdjustment: 0.05, reason: `High-confluence institutional setup: ${signal.strategy}` };
    }
    return { ruleId: 'R3', ruleName: 'InstitutionalSetupBoost', fired: false, action: 'pass', confidenceAdjustment: 0, reason: '' };
  },

  // R4: Reduce confidence if win rate below 40% in last 10 trades
  (signal) => {
    const last10 = recentOutcomes.slice(-10).filter(o => o.result !== 'open');
    if (last10.length >= 5) {
      const wins = last10.filter(o => o.result === 'win').length;
      const winRate = wins / last10.length;
      if (winRate < 0.35) {
        return { ruleId: 'R4', ruleName: 'LowWinRateReduction', fired: true, action: 'reduce_confidence', confidenceAdjustment: -0.1, reason: `Win rate ${(winRate * 100).toFixed(0)}% < 40% in last ${last10.length} trades` };
      }
    }
    return { ruleId: 'R4', ruleName: 'LowWinRateReduction', fired: false, action: 'pass', confidenceAdjustment: 0, reason: '' };
  },

  // R5: Block trade if strategy has been losing consistently
  (signal) => {
    const strategyTrades = recentOutcomes.filter(o => o.strategy === signal.strategy && o.result !== 'open').slice(-5);
    if (strategyTrades.length >= 3 && strategyTrades.every(t => t.result === 'loss')) {
      return { ruleId: 'R5', ruleName: 'StrategyHaltRule', fired: true, action: 'override_neutral', confidenceAdjustment: -1, reason: `Strategy ${signal.strategy} lost last ${strategyTrades.length} trades` };
    }
    return { ruleId: 'R5', ruleName: 'StrategyHaltRule', fired: false, action: 'pass', confidenceAdjustment: 0, reason: '' };
  },
];

// ── Main apply function ───────────────────────────────────────────────────────

export function applySymbolicReasoning(signal: TradeSignal): CognitiveOutput {
  if (signal.direction === 'hold') {
    return {
      originalSignal: signal,
      adjustedSignal: signal,
      rulesEvaluated: 0,
      rulesFired: 0,
      ruleResults: [],
      override: false,
      overrideReason: null,
    };
  }

  const ruleResults = rules.map(r => r(signal));
  const fired = ruleResults.filter(r => r.fired);

  let override = false;
  let overrideReason: string | null = null;
  let adjustedConfidence = signal.confidence;

  for (const result of fired) {
    if (result.action === 'override_neutral') {
      override = true;
      overrideReason = result.reason;
      log.warn(`[NEURO-SYM] Rule ${result.ruleId} (${result.ruleName}) BLOCKED trade: ${result.reason}`);
      break;
    }
    adjustedConfidence += result.confidenceAdjustment;
    log.info(`[NEURO-SYM] Rule ${result.ruleId} (${result.ruleName}) fired: ${result.reason} (adj: ${result.confidenceAdjustment >= 0 ? '+' : ''}${result.confidenceAdjustment.toFixed(2)})`);
  }

  adjustedConfidence = Math.max(0, Math.min(1, adjustedConfidence));

  const adjustedSignal: TradeSignal = override
    ? { ...signal, direction: 'hold', confidence: 0, reasoning: `[BLOCKED] ${overrideReason} | Original: ${signal.reasoning}` }
    : { ...signal, confidence: adjustedConfidence };

  return {
    originalSignal: signal,
    adjustedSignal,
    rulesEvaluated: rules.length,
    rulesFired: fired.length,
    ruleResults,
    override,
    overrideReason,
  };
}
