/**
 * Supervisory Meta-Agent — Capital Steward
 *
 * Lightweight governance layer that decides whether Sentinel is allowed
 * to deploy capital on a given cycle. Acts as the final pre-trade gate.
 *
 * Principles:
 *   - Uses trust score as the primary capital-rights signal
 *   - De-risks automatically in stress / drawdown regimes
 *   - Never expands beyond pre-approved limits inside the live loop
 *   - Produces an auditable decision object for artifacts and dashboards
 */

import { getCapitalLimitPct, getCapitalMultiplier, getRecoveryState, resolveTrustTier } from '../trust/reputation-evolution.js';
import type { MarketRegime } from '../strategy/types.js';

export type SupervisoryStatus = 'allowed' | 'throttled' | 'paused' | 'blocked';
export type TrustTierName = 'probation' | 'limited' | 'standard' | 'elevated' | 'elite';

export interface SupervisoryInput {
  trustScore: number | null;
  drawdownPct: number;
  marketRegime: MarketRegime | 'UNKNOWN';
  edgeAllowed: boolean;
  volatilityRegime?: string | null;
  validationScore?: number | null;
  currentOpenPositions?: number;
  maxOpenPositions?: number;
}

export interface SupervisoryDecision {
  timestamp: string;
  trustScore: number | null;
  trustTier: TrustTierName;
  status: SupervisoryStatus;
  canTrade: boolean;
  capitalMultiplier: number;
  capitalLimitPct: number;
  reason: string[];
  restrictions: string[];
}

function downgradeTier(name: TrustTierName) {
  const ordered: TrustTierName[] = ['elite', 'elevated', 'standard', 'limited', 'probation'];
  const idx = ordered.findIndex((entry) => entry === name);
  const next = ordered[Math.min(ordered.length - 1, Math.max(0, idx + 1))];
  return {
    name: next,
    capitalMultiplier: getCapitalMultiplier(scoreFloorForTier(next)),
    capitalLimitPct: getCapitalLimitPct(scoreFloorForTier(next)),
  };
}

function regimeToGovernance(regime: MarketRegime | 'UNKNOWN'): 'TRENDING' | 'RANGING' | 'STRESSED' | 'UNKNOWN' {
  if (regime === 'volatile') return 'STRESSED';
  if (regime === 'ranging') return 'RANGING';
  if (regime === 'trending_up' || regime === 'trending_down') return 'TRENDING';
  return 'UNKNOWN';
}

export function evaluateSupervisoryDecision(input: SupervisoryInput): SupervisoryDecision {
  const reason: string[] = [];
  const restrictions: string[] = [];

  let tier = {
    name: resolveTrustTier(input.trustScore).tier as TrustTierName,
    capitalMultiplier: getCapitalMultiplier(input.trustScore),
    capitalLimitPct: getCapitalLimitPct(input.trustScore),
  };
  let status: SupervisoryStatus = tier.capitalMultiplier < 1 ? 'throttled' : 'allowed';
  let canTrade = true;

  const recovery = getRecoveryState(null);
  reason.push(`trust tier ${tier.name} from score ${input.trustScore ?? 'n/a'}`);

  if (recovery.active) {
    tier = downgradeTier(tier.name);
    status = 'throttled';
    restrictions.push('trust_recovery_mode');
    reason.push(`trust recovery mode active (${recovery.streak}/${recovery.required}) — capital restoration is path-dependent`);
  }

  if (!input.edgeAllowed) {
    canTrade = false;
    status = 'blocked';
    restrictions.push('edge_gate');
    reason.push('expected edge below execution-cost threshold');
  }

  if (
    typeof input.currentOpenPositions === 'number' &&
    typeof input.maxOpenPositions === 'number' &&
    input.currentOpenPositions >= input.maxOpenPositions
  ) {
    canTrade = false;
    status = 'blocked';
    restrictions.push('position_limit');
    reason.push(`position limit reached (${input.currentOpenPositions}/${input.maxOpenPositions})`);
  }

  const hasOpenPositions = (input.currentOpenPositions ?? 0) > 0;

  if (input.drawdownPct >= 0.08) {
    canTrade = false;
    status = 'paused';
    restrictions.push('drawdown_hard_pause');
    reason.push(`drawdown ${pct(input.drawdownPct)} breached hard pause threshold`);
  } else if (input.drawdownPct >= 0.06) {
    if (hasOpenPositions) {
      canTrade = false;
      status = 'paused';
      restrictions.push('drawdown_pause');
      reason.push(`drawdown ${pct(input.drawdownPct)} breached supervisory pause threshold`);
    } else {
      tier = downgradeTier(downgradeTier(tier.name).name);
      status = 'throttled';
      restrictions.push('drawdown_recovery_throttle');
      reason.push(`drawdown ${pct(input.drawdownPct)} — recovery mode (no open positions, heavily throttled)`);
    }
  } else if (input.drawdownPct >= 0.04) {
    tier = downgradeTier(tier.name);
    status = 'throttled';
    restrictions.push('drawdown_throttle');
    reason.push(`drawdown ${pct(input.drawdownPct)} triggered capital throttle`);
  }

  const gov = regimeToGovernance(input.marketRegime);

  if (gov === 'STRESSED') {
    tier = downgradeTier(tier.name);
    status = canTrade ? 'throttled' : status;
    restrictions.push('stress_regime');
    reason.push('volatile market regime — defensive posture applied');
    if ((input.trustScore ?? 75) < 85) {
      canTrade = false;
      status = 'paused';
      restrictions.push('stress_pause');
      reason.push('stress regime + insufficient trust score => pause trading');
    }
  } else if (gov === 'RANGING') {
    restrictions.push('range_regime');
    reason.push('ranging regime — noted (strategy applies confidence discount internally)');
  }

  if (input.volatilityRegime === 'extreme' && (input.trustScore ?? 75) < 90) {
    canTrade = false;
    status = 'paused';
    restrictions.push('extreme_volatility_pause');
    reason.push('extreme volatility requires elevated trust >= 90');
  }

  // Validation completeness (IPFS, on-chain) is tracked and shown on the
  // dashboard scorecard but is not a hard trading gate — it's an audit metric.
  if (input.validationScore !== null && input.validationScore !== undefined) {
    reason.push(`validation completeness ${input.validationScore.toFixed(0)}%`);
  }

  return {
    timestamp: new Date().toISOString(),
    trustScore: input.trustScore,
    trustTier: tier.name,
    status,
    canTrade,
    capitalMultiplier: clamp(tier.capitalMultiplier, 0, 1),
    capitalLimitPct: clamp(tier.capitalLimitPct, 0, 0.20),
    reason,
    restrictions,
  };
}

export function applySupervisorySizing(
  requestedUnits: number,
  capitalUsd: number,
  currentPrice: number,
  decision: SupervisoryDecision,
): number {
  if (!decision.canTrade || requestedUnits <= 0 || currentPrice <= 0) return 0;
  const throttledUnits = requestedUnits * decision.capitalMultiplier;
  const maxUnitsByCapital = (capitalUsd * decision.capitalLimitPct) / currentPrice;
  return round(Math.max(0, Math.min(throttledUnits, maxUnitsByCapital)), 8);
}

export function summarizeSupervisoryDecision(decision: SupervisoryDecision): string {
  return [
    `${decision.status.toUpperCase()} via tier ${decision.trustTier}`,
    `cap=${pct(decision.capitalLimitPct)}`,
    `mult=${decision.capitalMultiplier.toFixed(2)}`,
    ...decision.reason,
  ].join(' | ');
}

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }
function round(v: number, dp = 6): number { const f = 10 ** dp; return Math.round(v * f) / f; }
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function scoreFloorForTier(name: TrustTierName): number {
  if (name === 'elite') return 95;
  if (name === 'elevated') return 90;
  if (name === 'standard') return 82;
  if (name === 'limited') return 72;
  return 0;
}
