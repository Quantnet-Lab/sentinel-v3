/**
 * Trust Policy Scorecard — 4-dimension trust scoring.
 *
 * Dimensions:
 *   1. Policy Compliance    — mandate adherence, no blocked trades bypassed
 *   2. Risk Discipline      — drawdown, daily loss, circuit breaker behavior
 *   3. Validation Completeness — IPFS pins, checkpoint chain, on-chain attestations
 *   4. Outcome Quality      — win rate, Sharpe approximation, stop-hit rate
 *
 * Produces a tier-based capital allocation recommendation.
 */

import type { TrustTier } from '../chain/trust.js';

export interface TrustDimension {
  name: string;
  score: number;  // 0–1
  weight: number;
  components: Record<string, number>;
}

export interface TrustPolicyScorecard {
  overall: number;
  tier: TrustTier;
  sizeFactor: number;
  dimensions: {
    policyCompliance: TrustDimension;
    riskDiscipline: TrustDimension;
    validationCompleteness: TrustDimension;
    outcomeQuality: TrustDimension;
  };
  generatedAt: string;
}

interface ScorecardInput {
  // Policy
  mandateViolations: number;
  vetoedTrades: number;
  totalSignals: number;
  // Risk
  maxDrawdownPct: number;
  configMaxDrawdownPct: number;
  dailyLossBreaches: number;
  circuitBreakerTrips: number;
  // Validation
  checkpointCount: number;
  ipfsPinnedCount: number;
  onChainAttestations: number;
  checkpointChainValid: boolean;
  // Outcomes
  winCount: number;
  lossCount: number;
  stopHitCount: number;
  totalClosed: number;
}

function tier(score: number): [TrustTier, number] {
  if (score >= 0.85) return ['elite',     1.00];
  if (score >= 0.70) return ['elevated',  0.90];
  if (score >= 0.50) return ['standard',  0.75];
  if (score >= 0.30) return ['limited',   0.50];
  return                    ['probation', 0.25];
}

export function buildTrustPolicyScorecard(input: ScorecardInput): TrustPolicyScorecard {
  // 1. Policy Compliance
  const complianceRate = input.totalSignals > 0
    ? 1 - (input.mandateViolations / input.totalSignals)
    : 1;
  const policyCompliance: TrustDimension = {
    name: 'Policy Compliance',
    score: Math.max(0, complianceRate),
    weight: 0.25,
    components: {
      complianceRate,
      mandateViolations: input.mandateViolations,
      vetoedTrades: input.vetoedTrades,
    },
  };

  // 2. Risk Discipline
  const drawdownScore = 1 - Math.min(1, input.maxDrawdownPct / (input.configMaxDrawdownPct * 1.5));
  const breachPenalty = Math.max(0, 1 - (input.dailyLossBreaches + input.circuitBreakerTrips) * 0.1);
  const riskScore = drawdownScore * 0.6 + breachPenalty * 0.4;
  const riskDiscipline: TrustDimension = {
    name: 'Risk Discipline',
    score: Math.max(0, riskScore),
    weight: 0.30,
    components: { drawdownScore, breachPenalty, dailyLossBreaches: input.dailyLossBreaches },
  };

  // 3. Validation Completeness
  const ipfsCoverage = input.checkpointCount > 0
    ? input.ipfsPinnedCount / input.checkpointCount
    : 0;
  const attestationScore = Math.min(1, input.onChainAttestations / 10);
  const validationScore = (
    (input.checkpointChainValid ? 0.4 : 0) +
    ipfsCoverage * 0.4 +
    attestationScore * 0.2
  );
  const validationCompleteness: TrustDimension = {
    name: 'Validation Completeness',
    score: Math.max(0, validationScore),
    weight: 0.25,
    components: { ipfsCoverage, attestationScore, chainValid: input.checkpointChainValid ? 1 : 0 },
  };

  // 4. Outcome Quality
  const winRate = input.totalClosed > 0 ? input.winCount / input.totalClosed : 0.5;
  const stopHitRate = input.totalClosed > 0 ? input.stopHitCount / input.totalClosed : 0;
  const outcomeScore = winRate * 0.6 + (1 - stopHitRate) * 0.4;
  const outcomeQuality: TrustDimension = {
    name: 'Outcome Quality',
    score: Math.max(0, Math.min(1, outcomeScore)),
    weight: 0.20,
    components: { winRate, stopHitRate, totalClosed: input.totalClosed },
  };

  const overall =
    policyCompliance.score * policyCompliance.weight +
    riskDiscipline.score   * riskDiscipline.weight +
    validationCompleteness.score * validationCompleteness.weight +
    outcomeQuality.score   * outcomeQuality.weight;

  const [trustTier, sizeFactor] = tier(overall);

  return {
    overall,
    tier: trustTier,
    sizeFactor,
    dimensions: { policyCompliance, riskDiscipline, validationCompleteness, outcomeQuality },
    generatedAt: new Date().toISOString(),
  };
}
