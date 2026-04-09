/**
 * Adaptive Learning Layer
 *
 * Responsible self-improvement within immutable CAGE bounds. The agent
 * adjusts strategy parameters based on observed trade outcomes, but cannot:
 *   - Change its own risk boundaries
 *   - Disable compliance checks
 *   - Expand parameter ranges beyond pre-approved limits
 *   - Override symbolic safety rules
 *
 * What it CAN do (all within CAGE bounds):
 *   - Adjust stop-loss ATR multiple within [1.0, 2.5]
 *   - Adjust base position size within [1%, 4%] of capital
 *   - Adjust confidence threshold within [5%, 30%]
 *   - Apply bounded Bayesian confidence bias per regime + direction
 *
 * Every adaptation produces an auditable artifact recording what changed,
 * why it changed, and the immutable boundary that constrains it.
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('ADAPTIVE');

const CAGE = {
  stopLossAtrMultiple:    { min: 1.0,  max: 2.5,  default: 1.5  },
  basePositionPct:        { min: 0.01, max: 0.04, default: 0.02 },
  confidenceThreshold:    { min: 0.05, max: 0.30, default: 0.10 },
  maxAdaptationPerCycle:  0.05,
  minSampleSize:          10,
  adaptationCooldown:     5,
  maxContextBiasAbs:      0.12,
  minContextSamples:      5,
} as const;

export interface Outcome {
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  stopHit: boolean;
  regime: 'low' | 'normal' | 'high' | 'extreme';
  confidence: number;
  timestamp: string;
}

interface AdaptiveParams {
  stopLossAtrMultiple: number;
  basePositionPct: number;
  confidenceThreshold: number;
}

export interface AdaptationArtifact {
  type: 'adaptation_artifact';
  timestamp: string;
  cycleNumber: number;
  parameter: string;
  previousValue: number;
  newValue: number;
  cageBounds: { min: number; max: number };
  trigger: string;
  observations: { sampleSize: number; metric: string; value: number };
  reasoning: string;
}

export interface ContextBiasInput {
  regime: Outcome['regime'];
  direction: Outcome['direction'];
  confidence: number;
}

const outcomes: Outcome[] = [];
const adaptationHistory: AdaptationArtifact[] = [];
let currentParams: AdaptiveParams = {
  stopLossAtrMultiple:  CAGE.stopLossAtrMultiple.default,
  basePositionPct:      CAGE.basePositionPct.default,
  confidenceThreshold:  CAGE.confidenceThreshold.default,
};
let cyclesSinceAdaptation = 0;
const MAX_OUTCOMES = 100;

export function recordTradeOutcome(outcome: Outcome): void {
  outcomes.push(outcome);
  if (outcomes.length > MAX_OUTCOMES) outcomes.shift();
}

export function getAdaptiveParams(): Readonly<AdaptiveParams> {
  return { ...currentParams };
}

export function getCageBounds() {
  return { ...CAGE };
}

export function runAdaptation(currentCycle: number): AdaptationArtifact[] {
  cyclesSinceAdaptation++;
  if (cyclesSinceAdaptation < CAGE.adaptationCooldown) return [];
  if (outcomes.length < CAGE.minSampleSize) return [];

  const artifacts: AdaptationArtifact[] = [];

  const stopHitRate = computeStopHitRate();
  if (stopHitRate !== null) {
    const a = adaptStopLoss(stopHitRate, currentCycle);
    if (a) artifacts.push(a);
  }

  const recentWinRate = computeWinRate(20);
  if (recentWinRate !== null) {
    const a = adaptPositionSize(recentWinRate, currentCycle);
    if (a) artifacts.push(a);
  }

  const falseSignalRate = computeFalseSignalRate();
  if (falseSignalRate !== null) {
    const a = adaptConfidenceThreshold(falseSignalRate, currentCycle);
    if (a) artifacts.push(a);
  }

  if (artifacts.length > 0) {
    cyclesSinceAdaptation = 0;
    adaptationHistory.push(...artifacts);
  }

  return artifacts;
}

/**
 * Bounded Bayesian context memory — returns a small confidence bias for
 * the current regime/direction context. Does NOT alter stops or sizing.
 */
export function getContextConfidenceBias(input: ContextBiasInput): number {
  const relevant = outcomes.filter(
    (o) => o.regime === input.regime && o.direction === input.direction,
  );
  if (relevant.length < CAGE.minContextSamples) return 0;

  const wins = relevant.filter((o) => o.pnlPct > 0).length;
  const losses = relevant.length - wins;
  const posteriorWinRate = (wins + 1) / (wins + losses + 2);
  const edgeVsNeutral = posteriorWinRate - 0.5;
  const sampleWeight = clamp(relevant.length / 20, 0, 1);
  const confidenceWeight = clamp(0.6 + input.confidence * 0.4, 0.6, 1.0);
  const rawBias = edgeVsNeutral * 0.4 * sampleWeight * confidenceWeight;

  return clamp(rawBias, -CAGE.maxContextBiasAbs, CAGE.maxContextBiasAbs);
}

export function getContextStats(input: Pick<ContextBiasInput, 'regime' | 'direction'>) {
  const relevant = outcomes.filter(
    (o) => o.regime === input.regime && o.direction === input.direction,
  );
  const wins = relevant.filter((o) => o.pnlPct > 0).length;
  const losses = relevant.length - wins;
  return {
    sampleSize: relevant.length,
    wins,
    losses,
    posteriorWinRate: relevant.length > 0 ? (wins + 1) / (wins + losses + 2) : 0.5,
  };
}

export function getAdaptationHistory(): AdaptationArtifact[] {
  return [...adaptationHistory];
}

export function getAdaptationSummary() {
  return {
    currentParams: getAdaptiveParams(),
    cage: getCageBounds(),
    totalOutcomes: outcomes.length,
    totalAdaptations: adaptationHistory.length,
    lastAdaptation: adaptationHistory[adaptationHistory.length - 1] ?? null,
  };
}

function adaptStopLoss(hitRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.stopLossAtrMultiple;
  let newVal = prev;

  if (hitRate > 0.60) newVal = prev * (1 + CAGE.maxAdaptationPerCycle);
  else if (hitRate < 0.20 && prev > CAGE.stopLossAtrMultiple.min + 0.1) newVal = prev * (1 - CAGE.maxAdaptationPerCycle);
  else return null;

  newVal = clamp(newVal, CAGE.stopLossAtrMultiple.min, CAGE.stopLossAtrMultiple.max);
  if (Math.abs(newVal - prev) < 0.01) return null;

  currentParams.stopLossAtrMultiple = newVal;
  const direction = newVal > prev ? 'widened' : 'tightened';
  log.info(`Stop-loss ${direction}: ${prev.toFixed(3)} → ${newVal.toFixed(3)} (hit rate: ${(hitRate * 100).toFixed(0)}%)`);

  return {
    type: 'adaptation_artifact',
    timestamp: new Date().toISOString(),
    cycleNumber: cycle,
    parameter: 'stopLossAtrMultiple',
    previousValue: Math.round(prev * 1000) / 1000,
    newValue: Math.round(newVal * 1000) / 1000,
    cageBounds: { min: CAGE.stopLossAtrMultiple.min, max: CAGE.stopLossAtrMultiple.max },
    trigger: `Stop-loss hit rate ${(hitRate * 100).toFixed(0)}%`,
    observations: { sampleSize: outcomes.length, metric: 'stopHitRate', value: Math.round(hitRate * 100) / 100 },
    reasoning: `Stop-losses ${direction} because hit rate (${(hitRate * 100).toFixed(0)}%) was ${hitRate > 0.5 ? 'above' : 'below'} acceptable range. New ATR multiple: ${newVal.toFixed(3)}.`,
  };
}

function adaptPositionSize(winRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.basePositionPct;
  let newVal = prev;

  if (winRate > 0.55) newVal = prev * (1 + CAGE.maxAdaptationPerCycle * 0.5);
  else if (winRate < 0.35) newVal = prev * (1 - CAGE.maxAdaptationPerCycle);
  else return null;

  newVal = clamp(newVal, CAGE.basePositionPct.min, CAGE.basePositionPct.max);
  if (Math.abs(newVal - prev) < 0.001) return null;

  currentParams.basePositionPct = newVal;
  const direction = newVal > prev ? 'increased' : 'decreased';
  log.info(`Position size ${direction}: ${(prev * 100).toFixed(2)}% → ${(newVal * 100).toFixed(2)}% (win rate: ${(winRate * 100).toFixed(0)}%)`);

  return {
    type: 'adaptation_artifact',
    timestamp: new Date().toISOString(),
    cycleNumber: cycle,
    parameter: 'basePositionPct',
    previousValue: Math.round(prev * 10000) / 10000,
    newValue: Math.round(newVal * 10000) / 10000,
    cageBounds: { min: CAGE.basePositionPct.min, max: CAGE.basePositionPct.max },
    trigger: `Win rate ${(winRate * 100).toFixed(0)}%`,
    observations: { sampleSize: Math.min(outcomes.length, 20), metric: 'winRate', value: Math.round(winRate * 100) / 100 },
    reasoning: `Position size ${direction} because win rate (${(winRate * 100).toFixed(0)}%) ${winRate > 0.5 ? 'supports larger' : 'warrants smaller'} positions.`,
  };
}

function adaptConfidenceThreshold(falseSignalRate: number, cycle: number): AdaptationArtifact | null {
  const prev = currentParams.confidenceThreshold;
  let newVal = prev;

  if (falseSignalRate > 0.50) newVal = prev + 0.02;
  else if (falseSignalRate < 0.25 && prev > CAGE.confidenceThreshold.min + 0.02) newVal = prev - 0.01;
  else return null;

  newVal = clamp(newVal, CAGE.confidenceThreshold.min, CAGE.confidenceThreshold.max);
  if (Math.abs(newVal - prev) < 0.005) return null;

  currentParams.confidenceThreshold = newVal;
  const direction = newVal > prev ? 'raised' : 'lowered';
  log.info(`Confidence threshold ${direction}: ${(prev * 100).toFixed(1)}% → ${(newVal * 100).toFixed(1)}%`);

  return {
    type: 'adaptation_artifact',
    timestamp: new Date().toISOString(),
    cycleNumber: cycle,
    parameter: 'confidenceThreshold',
    previousValue: Math.round(prev * 1000) / 1000,
    newValue: Math.round(newVal * 1000) / 1000,
    cageBounds: { min: CAGE.confidenceThreshold.min, max: CAGE.confidenceThreshold.max },
    trigger: `False signal rate ${(falseSignalRate * 100).toFixed(0)}%`,
    observations: { sampleSize: outcomes.length, metric: 'falseSignalRate', value: Math.round(falseSignalRate * 100) / 100 },
    reasoning: `Confidence threshold ${direction} because ${(falseSignalRate * 100).toFixed(0)}% of signals led to losses.`,
  };
}

function computeStopHitRate(): number | null {
  const closed = outcomes.filter(o => o.exitPrice > 0);
  if (closed.length < CAGE.minSampleSize) return null;
  return closed.filter(o => o.stopHit).length / closed.length;
}

function computeWinRate(window = 20): number | null {
  const recent = outcomes.slice(-window);
  if (recent.length < Math.min(window, CAGE.minSampleSize)) return null;
  return recent.filter(o => o.pnlPct > 0).length / recent.length;
}

function computeFalseSignalRate(): number | null {
  if (outcomes.length < CAGE.minSampleSize) return null;
  return outcomes.filter(o => o.pnlPct < 0 && o.confidence < 0.5).length / outcomes.length;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
