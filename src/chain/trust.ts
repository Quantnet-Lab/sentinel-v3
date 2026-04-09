/**
 * Trust Score — 6-component trust assessment for ERC-8004 compliance.
 *
 * Components:
 *   - identity_age:          Days since on-chain registration (0–1)
 *   - registration:          Agent is registered and active (0 or 1)
 *   - checkpoint_integrity:  Hash chain is valid (0 or 1)
 *   - attestation:           On-chain attestations present (0–1)
 *   - risk_health:           Not in drawdown caution zone (0–1)
 *   - consistency:           Win rate consistency (0–1)
 *
 * Gate states (Capital Trust Ladder):
 *   0.0–0.3  → probation   (25% max size)
 *   0.3–0.5  → limited     (50% max size)
 *   0.5–0.7  → standard    (75% max size)
 *   0.7–0.85 → elevated    (90% max size)
 *   0.85–1.0 → elite       (100% max size)
 */

export type TrustTier = 'probation' | 'limited' | 'standard' | 'elevated' | 'elite';

export interface TrustComponents {
  identity_age: number;
  registration: number;
  checkpoint_integrity: number;
  attestation: number;
  risk_health: number;
  consistency: number;
}

export interface TrustAssessment {
  score: number;
  tier: TrustTier;
  sizeFactor: number;
  components: TrustComponents;
  reasoning: string;
}

const WEIGHTS: TrustComponents = {
  identity_age:         0.10,
  registration:         0.20,
  checkpoint_integrity: 0.25,
  attestation:          0.15,
  risk_health:          0.20,
  consistency:          0.10,
};

const TIER_THRESHOLDS: [number, TrustTier, number][] = [
  [0.85, 'elite',     1.00],
  [0.70, 'elevated',  0.90],
  [0.50, 'standard',  0.75],
  [0.30, 'limited',   0.50],
  [0.00, 'probation', 0.25],
];

export function computeTrust(params: {
  identityAgeDays: number | null;
  isRegistered: boolean;
  checkpointChainValid: boolean;
  attestationCount: number;
  drawdownPct: number;
  maxDrawdownPct: number;
  recentWinRate: number | null;
}): TrustAssessment {
  const components: TrustComponents = {
    identity_age:         ageDaysScore(params.identityAgeDays),
    registration:         params.isRegistered ? 1.0 : 0.0,
    checkpoint_integrity: params.checkpointChainValid ? 1.0 : 0.0,
    attestation:          Math.min(1.0, params.attestationCount / 10),
    risk_health:          1 - Math.min(1, params.drawdownPct / params.maxDrawdownPct),
    consistency:          params.recentWinRate != null ? Math.min(1, params.recentWinRate / 0.6) : 0.5,
  };

  const score = (Object.keys(components) as (keyof TrustComponents)[])
    .reduce((sum, k) => sum + components[k] * WEIGHTS[k], 0);

  const [, tier, sizeFactor] = TIER_THRESHOLDS.find(([threshold]) => score >= threshold)!;

  const reasoning = `Trust ${(score * 100).toFixed(0)}% → ${tier} (${(sizeFactor * 100).toFixed(0)}% max size). ` +
    `age=${(components.identity_age * 100).toFixed(0)}%, integrity=${components.checkpoint_integrity === 1 ? 'ok' : 'BROKEN'}, ` +
    `attestations=${params.attestationCount}, health=${(components.risk_health * 100).toFixed(0)}%`;

  return { score, tier, sizeFactor, components, reasoning };
}

function ageDaysScore(days: number | null): number {
  if (days == null) return 0;
  if (days >= 30) return 1.0;
  if (days >= 7)  return 0.5;
  if (days >= 1)  return 0.2;
  return 0.0;
}
