/**
 * Validation Artifact Emitter
 *
 * Every trade decision produces a structured JSON artifact containing:
 *   - Full strategy signal and reasoning
 *   - Risk checks and compliance results
 *   - Trust scorecard snapshot
 *   - Neuro-symbolic rule results
 *   - AI-generated narrative
 *   - TEE attestation
 *   - Market snapshot
 *   - Sentiment data
 *
 * Artifacts are pinned to IPFS for immutable public verification.
 */

import type { TradeSignal } from '../strategy/types.js';
import type { RiskDecision } from '../risk/manager.js';
import type { CognitiveOutput } from '../strategy/neuro-symbolic.js';
import type { TrustPolicyScorecard } from './trust-scorecard.js';
import type { SentimentResult } from '../data/sentiment-feed.js';
import type { IpfsUploadResult } from './ipfs.js';
import { generateAttestation } from './tee-attestation.js';
import { config } from '../agent/config.js';

export interface ValidationArtifact {
  version: string;
  agentName: string;
  agentId: number | null;
  timestamp: string;
  eventType: 'signal' | 'trade' | 'close' | 'veto' | 'halt' | 'heartbeat';

  market: {
    symbol: string;
    price: number;
    regime: string;
    volatilityRegime: string;
  };

  strategy: {
    name: string;
    signal: string;
    confidence: number;
    originalConfidence: number;
    reasoning: string;
    aiNarrative: string | null;
    aiSource: string | null;
  };

  cognitiveLayer: {
    rulesFired: number;
    override: boolean;
    overrideReason: string | null;
    ruleResults: { ruleId: string; fired: boolean; action: string; reason: string }[];
  };

  risk: {
    approved: boolean;
    positionSize: number;
    stopLoss: number | null;
    takeProfit: number | null;
    checks: { name: string; passed: boolean; value: string | number; limit: string | number }[];
    halted: boolean;
    haltReason: string;
    vetoReason: string | null;
    drawdown: number;
    dailyPnl: number;
  };

  trust: {
    score: number;
    tier: string;
    sizeFactor: number;
  } | null;

  sentiment: {
    composite: number;
    sources: string[];
  } | null;

  teeAttestation: {
    agentVersion: string;
    runtimeHash: string;
    nodeVersion: string;
    summary: string;
  };

  ipfs: IpfsUploadResult | null;
  onChainTxHash: string | null;
  checkpointHash: string | null;
  checkpointSignature: string | null;
}

export function buildArtifact(params: {
  eventType: ValidationArtifact['eventType'];
  symbol: string;
  signal: TradeSignal;
  riskDecision: RiskDecision;
  cognitive: CognitiveOutput | null;
  scorecard: TrustPolicyScorecard | null;
  sentiment: SentimentResult | null;
  aiNarrative: string | null;
  aiSource: string | null;
  drawdown: number;
  dailyPnl: number;
}): ValidationArtifact {
  const tee = generateAttestation();

  return {
    version: '3.0',
    agentName: config.agentName,
    agentId: config.agentId,
    timestamp: new Date().toISOString(),
    eventType: params.eventType,

    market: {
      symbol: params.symbol,
      price: params.signal.price,
      regime: params.signal.regime,
      volatilityRegime: 'normal',
    },

    strategy: {
      name: params.signal.strategy,
      signal: params.signal.direction,
      confidence: params.cognitive?.adjustedSignal.confidence ?? params.signal.confidence,
      originalConfidence: params.signal.confidence,
      reasoning: params.signal.reasoning,
      aiNarrative: params.aiNarrative,
      aiSource: params.aiSource,
    },

    cognitiveLayer: {
      rulesFired: params.cognitive?.rulesFired ?? 0,
      override: params.cognitive?.override ?? false,
      overrideReason: params.cognitive?.overrideReason ?? null,
      ruleResults: (params.cognitive?.ruleResults ?? []).map(r => ({
        ruleId: r.ruleId, fired: r.fired, action: r.action, reason: r.reason,
      })),
    },

    risk: {
      approved: params.riskDecision.approved,
      positionSize: params.riskDecision.positionSize,
      stopLoss: params.riskDecision.stopLoss,
      takeProfit: params.riskDecision.takeProfit,
      checks: params.riskDecision.checks,
      halted: params.riskDecision.halted,
      haltReason: params.riskDecision.haltReason,
      vetoReason: params.riskDecision.vetoReason,
      drawdown: params.drawdown,
      dailyPnl: params.dailyPnl,
    },

    trust: params.scorecard ? {
      score: params.scorecard.overall,
      tier: params.scorecard.tier,
      sizeFactor: params.scorecard.sizeFactor,
    } : null,

    sentiment: params.sentiment ? {
      composite: params.sentiment.composite,
      sources: params.sentiment.sources,
    } : null,

    teeAttestation: {
      agentVersion: tee.agentVersion,
      runtimeHash: tee.runtimeHash,
      nodeVersion: tee.nodeVersion,
      summary: `v=${tee.agentVersion} node=${tee.nodeVersion} hash=${tee.runtimeHash.slice(0, 16)}`,
    },

    ipfs: null,
    onChainTxHash: null,
    checkpointHash: null,
    checkpointSignature: null,
  };
}
