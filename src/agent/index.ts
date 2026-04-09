/**
 * Sentinel v3 — Main Agent Loop
 *
 * Full governance pipeline per cycle, per symbol:
 *   1.  Fetch market candles + ticker
 *   2.  Oracle integrity guard (price feed validation)
 *   3.  Run ensemble strategy → TradeSignal (6 ICT/SMC strategies)
 *   4.  Apply neuro-symbolic reasoning layer
 *   5.  Sentiment + PRISM confidence modifiers
 *   6.  Adaptive learning context bias
 *   7.  Operator control gate (pause / emergency stop)
 *   8.  Agent mandate check (asset, protocol, size, daily loss limits)
 *   9.  Execution simulation (slippage, net edge, price impact)
 *  10.  Supervisory meta-agent (trust tier, drawdown, regime throttle)
 *  11.  Trust policy scorecard
 *  12.  Risk engine (circuit breaker, drawdown, ATR sizing)
 *  13.  AI narrative generation (Claude → Gemini → template fallback)
 *  14.  Execute order via Kraken bridge (paper / live / disabled)
 *  15.  Build + emit validation artifact
 *  16.  Save tamper-evident checkpoint
 *  17.  Pin artifact to IPFS (async)
 *  18.  Post attestation on-chain (async)
 *
 * Governance:
 *   - SAGE adaptive engine reflects every 6h on trade outcomes
 *   - Adaptive learning layer tunes parameters within CAGE bounds
 *   - Trust policy scorecard governs position sizing
 *   - Supervisory meta-agent enforces capital tier limits
 *   - Operator control allows human pause / emergency stop at any time
 *   - Circuit breaker halts on daily loss / max drawdown / consecutive losses
 */

import 'dotenv/config';
import { createLogger } from './logger.js';
import { config } from './config.js';
import {
  loadState, getState, incrementCycle,
  recordTrade, recordSignal, setHalted, getWinRate,
} from './state.js';
import {
  loadTradeLog, recordClosedTrade, generateTradeId, getTradeStats,
} from './trade-log.js';
import { startScheduler } from './scheduler.js';
import {
  loadCheckpointHistory, saveCheckpoint,
  verifyChain, getCheckpointStats,
} from '../trust/checkpoint.js';
import { buildArtifact } from '../trust/artifact-emitter.js';
import { buildTrustPolicyScorecard } from '../trust/trust-scorecard.js';
import { pinArtifact } from '../trust/ipfs.js';
import { fetchCandles, fetchTicker } from '../data/market.js';
import { fetchSentiment } from '../data/sentiment-feed.js';
import { fetchPrismData, prismConfidenceModifier } from '../data/prism-feed.js';
import { EnsembleStrategy } from '../strategy/ensemble.js';
import { applySymbolicReasoning } from '../strategy/neuro-symbolic.js';
import { generateReasoning } from '../strategy/ai-reasoning.js';
import { runAdaptation, recordTradeOutcome, getContextConfidenceBias } from '../strategy/adaptive-learning.js';
import { RiskManager } from '../risk/manager.js';
import { computeTrust } from '../chain/trust.js';
import { loadIdentity, postCheckpointOnChain } from '../chain/identity.js';
import { placeOrder, initPaperAccount } from '../data/kraken-bridge.js';
import { runSAGEReflection } from '../strategy/sage-engine.js';
import { startDashboard, injectAgentState as injectDashboard } from '../dashboard/server.js';
import { startMCPServer, injectAgentState as injectMCP } from '../mcp/server.js';
import { evaluateOracleIntegrity } from '../security/oracle-integrity.js';
import { evaluateMandate } from '../chain/agent-mandate.js';
import { simulateExecution } from '../chain/execution-simulator.js';
import {
  evaluateSupervisoryDecision, applySupervisorySizing,
} from './supervisory-meta-agent.js';
import {
  getOperatorControlState,
} from './operator-control.js';
import { recordTrustObservation } from '../trust/reputation-evolution.js';
import type { ClosedTrade } from './trade-log.js';

const log = createLogger('AGENT');

// ── Module singletons ─────────────────────────────────────────────────────────

const risk = new RiskManager(config.initialCapital ?? 10000);
const _ensemble = new EnsembleStrategy(config.strategy.minConfidence);

let _identity: Awaited<ReturnType<typeof loadIdentity>> | null = null;

// Session-level governance counters
let _vetoCount = 0;
let _totalSignals = 0;
let _stopHitCount = 0;
let _dailyLossBreaches = 0;
let _circuitBreakerTrips = 0;
let _mandateViolations = 0;
let _ipfsPinnedCount = 0;
let _prevTrustScore: number | null = null;

// ── Startup ───────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  log.info('[AGENT] ─────────────────────────────────────────────────────────');
  log.info(`[AGENT] Sentinel v3 starting`);
  log.info(`[AGENT] Mode: ${config.executionMode} | Symbols: ${config.symbols.join(', ')}`);
  log.info('[AGENT] ─────────────────────────────────────────────────────────');

  loadState();
  loadTradeLog();
  loadCheckpointHistory();

  if (config.executionMode === 'paper') {
    await initPaperAccount(config.initialCapital ?? 10000);
  }

  _identity = await loadIdentity();

  startDashboard();
  startMCPServer();
  broadcastState();

  startScheduler({
    onCycle: runCycle,
    onHeartbeat: runHeartbeat,
    onSageReflection: config.sageEnabled ? runSAGEReflection : undefined,
  });
}

// ── Main cycle ────────────────────────────────────────────────────────────────

async function runCycle(): Promise<void> {
  const state = getState();

  // Operator control gate — hard block on pause or emergency stop
  const opState = getOperatorControlState();
  if (!opState.canTrade) {
    log.warn(`[AGENT] Operator control active (${opState.mode}): ${opState.lastReason}`);
    return;
  }

  if (state.halted) {
    log.warn(`[AGENT] Halted: ${state.haltReason}`);
    return;
  }

  incrementCycle();

  // Run adaptive learning reflection (throttled internally)
  const adaptations = runAdaptation(state.cycle);
  if (adaptations.length > 0) {
    log.info(`[AGENT] Adaptive learning: ${adaptations.length} parameter(s) updated`);
  }

  await Promise.allSettled(config.symbols.map(symbol => processSymbol(symbol)));

  await checkManagedPositions();
  broadcastState();
}

// ── Per-symbol processing ─────────────────────────────────────────────────────

async function processSymbol(symbol: string): Promise<void> {
  try {
    // 1. Market data
    const [candles, tickerMap] = await Promise.all([
      fetchCandles(symbol, 15, 100),
      fetchTicker([symbol]),
    ]);
    const ticker = tickerMap[symbol] ?? null;
    if (ticker?.price) risk.markPrice(symbol, ticker.price);

    if (candles.length < 50) {
      log.warn(`[AGENT] Insufficient candles for ${symbol}: ${candles.length}`);
      return;
    }

    // 2. Oracle integrity guard
    const prices = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const timestamps = candles.map(c => new Date(c.time).toISOString());
    const oracleResult = evaluateOracleIntegrity({
      prices, highs, lows, timestamps,
      externalPrice: ticker?.price ?? null,
    });

    if (!oracleResult.passed) {
      log.warn(`[AGENT] Oracle integrity BLOCKED for ${symbol}: ${oracleResult.blockers.join(', ')}`);
      await saveCheckpoint({ eventType: 'veto', symbol, agentId: config.agentId, signal: 'hold', data: { reason: 'oracle_integrity', blockers: oracleResult.blockers } });
      return;
    }

    if (oracleResult.status === 'watch') {
      log.info(`[AGENT] Oracle watch for ${symbol}: ${oracleResult.reasons.join(', ')}`);
    }

    // 3. Ensemble strategy (6 ICT/SMC strategies with priority hierarchy)
    const ensembleResult = _ensemble.analyze(candles);
    let signal = ensembleResult.tradeSignal;
    _totalSignals++;

    // TEST MODE: inject a synthetic signal when ensemble returns HOLD so the
    // full downstream pipeline (mandate→sim→supervisory→order→checkpoint) runs.
    if (config.testMode && signal.direction === 'hold') {
      const price = candles.at(-1)!.close;
      const atr   = price * 0.01; // 1% synthetic ATR
      signal = {
        direction:  'buy',
        confidence: 0.72,
        strategy:   'test_inject',
        price,
        stopLoss:   price - atr * 2,
        takeProfit: price + atr * 3,
        reasoning:  '[TEST MODE] Synthetic signal — bypasses kill zone for pipeline verification',
        regime:     ensembleResult.regimeSignal.regime,
        timestamp:  new Date().toISOString(),
      };
      log.warn(`[AGENT] TEST MODE: injected BUY signal for ${symbol} @ ${price.toFixed(2)}`);
    }

    // 4. Neuro-symbolic reasoning
    const cognitive = applySymbolicReasoning(signal);
    signal = cognitive.adjustedSignal;

    // 5. Sentiment + PRISM confidence modifiers
    const [sentiment, prism] = await Promise.all([
      fetchSentiment(symbol).catch(() => null),
      fetchPrismData(symbol).catch(() => null),
    ]);

    if (sentiment && Math.abs(sentiment.composite) > 0.6) {
      const boost = sentiment.composite > 0 ? 0.05 : -0.05;
      signal = { ...signal, confidence: Math.min(0.95, signal.confidence + boost) };
    }
    if (prism) {
      signal = { ...signal, confidence: Math.min(0.95, signal.confidence + prismConfidenceModifier(prism, signal.direction as 'buy' | 'sell')) };
    }

    // 6. Adaptive learning context bias
    const contextBias = getContextConfidenceBias({
      regime: _mapVolatilityRegime(ensembleResult.regimeSignal?.volatilityRegime),
      direction: signal.direction === 'sell' ? 'sell' : 'buy',
      confidence: signal.confidence,
    });
    if (Math.abs(contextBias) > 0.01) {
      signal = { ...signal, confidence: Math.min(0.95, Math.max(0, signal.confidence + contextBias)) };
    }

    recordSignal(symbol, signal.direction);
    log.info(`[AGENT] ${symbol} | ${signal.direction.toUpperCase()} | conf=${(signal.confidence * 100).toFixed(0)}% | ${signal.strategy}`);

    if (signal.direction === 'hold') {
      await saveCheckpoint({ eventType: 'signal', symbol, agentId: config.agentId, signal: 'hold', data: { strategy: signal.strategy } });
      return;
    }

    // 7. Trust computation
    const integrity = verifyChain();
    const cpStats = getCheckpointStats();
    const trStats = getTradeStats();
    const metrics = risk.getMetrics();

    const trust = computeTrust({
      identityAgeDays: _identity?.identityAgeDays ?? null,
      isRegistered: _identity?.active ?? false,
      checkpointChainValid: integrity.valid,
      attestationCount: cpStats.signed ?? 0,
      drawdownPct: metrics.drawdown,
      maxDrawdownPct: config.maxDrawdownPct,
      recentWinRate: trStats.total > 0 ? trStats.winRate : null,
    });

    const trustScoreNormalized = trust.score * 100;

    // Record trust observation for reputation evolution
    recordTrustObservation({
      agentId: config.agentId,
      trustScore: trustScoreNormalized,
      previousScore: _prevTrustScore,
      regime: _mapMarketRegimeToHint(signal.regime),
    });
    _prevTrustScore = trustScoreNormalized;

    // 8. Risk validation
    const riskDecision = risk.validate(signal, symbol, trust.sizeFactor);

    if (riskDecision.halted) {
      log.warn(`[AGENT] Circuit breaker tripped: ${riskDecision.haltReason}`);
      setHalted(riskDecision.haltReason);
      _circuitBreakerTrips++;
      await saveCheckpoint({ eventType: 'halt', symbol, agentId: config.agentId, signal: signal.direction, data: { reason: riskDecision.haltReason } });
      return;
    }

    if (!riskDecision.approved) {
      log.info(`[AGENT] Risk veto for ${symbol}: ${riskDecision.vetoReason}`);
      _vetoCount++;
      await saveCheckpoint({ eventType: 'veto', symbol, agentId: config.agentId, signal: signal.direction, data: { reason: riskDecision.vetoReason } });
      return;
    }

    // 9. Agent mandate check
    const mandateDecision = evaluateMandate({
      signal,
      positionSize: riskDecision.positionSize,
      capitalUsd: metrics.equity,
      asset: symbol.replace('USD', ''),
      protocol: 'kraken',
      dailyPnlPct: metrics.dailyPnl / metrics.equity,
    });

    if (!mandateDecision.approved) {
      log.info(`[AGENT] Mandate veto for ${symbol}: ${mandateDecision.reasons.join(', ')}`);
      _mandateViolations++;
      _vetoCount++;
      await saveCheckpoint({ eventType: 'veto', symbol, agentId: config.agentId, signal: signal.direction, data: { reason: 'mandate', details: mandateDecision.reasons } });
      return;
    }

    // 10. Execution simulation (slippage + net edge check)
    const simResult = simulateExecution({
      signal,
      riskDecision,
      positionSize: riskDecision.positionSize,
      volatility: 0.02, // ~2% daily vol baseline (ADX is trend strength, not volatility)
      volatilityRegime: _mapVolatilityRegime(ensembleResult.regimeSignal?.volatilityRegime) === 'extreme' ? 'extreme' : undefined,
    });

    if (!simResult.allowed) {
      log.info(`[AGENT] Execution simulation blocked for ${symbol}: ${simResult.reason}`);
      _vetoCount++;
      await saveCheckpoint({ eventType: 'veto', symbol, agentId: config.agentId, signal: signal.direction, data: { reason: `simulation_${simResult.reason}` } });
      return;
    }

    // 11. Trust policy scorecard
    const scorecard = buildTrustPolicyScorecard({
      mandateViolations: _mandateViolations,
      vetoedTrades: _vetoCount,
      totalSignals: _totalSignals,
      maxDrawdownPct: metrics.drawdown,
      configMaxDrawdownPct: config.maxDrawdownPct,
      dailyLossBreaches: _dailyLossBreaches,
      circuitBreakerTrips: _circuitBreakerTrips,
      checkpointCount: cpStats.total ?? 0,
      ipfsPinnedCount: _ipfsPinnedCount,
      onChainAttestations: cpStats.signed ?? 0,
      checkpointChainValid: integrity.valid,
      winCount: trStats.wins,
      lossCount: trStats.losses,
      stopHitCount: _stopHitCount,
      totalClosed: trStats.total,
    });

    // 12. Supervisory meta-agent — final capital-rights gate
    const supervisory = evaluateSupervisoryDecision({
      trustScore: trustScoreNormalized,
      drawdownPct: metrics.drawdown,
      marketRegime: signal.regime,
      edgeAllowed: simResult.expectedNetEdgePct > 0,
      volatilityRegime: ensembleResult.regimeSignal?.volatilityRegime ?? null,
      validationScore: scorecard.dimensions.validationCompleteness.score * 100,
      currentOpenPositions: metrics.openPositions,
      maxOpenPositions: config.maxPositions,
    });

    if (!supervisory.canTrade) {
      log.info(`[AGENT] Supervisory block for ${symbol}: ${supervisory.restrictions.join(', ')}`);
      await saveCheckpoint({ eventType: 'veto', symbol, agentId: config.agentId, signal: signal.direction, data: { reason: 'supervisory', restrictions: supervisory.restrictions } });
      return;
    }

    // 13. AI narrative (non-blocking)
    const narrative = await generateReasoning(
      signal,
      `Symbol: ${symbol} | Trust: ${scorecard.tier} | Tier: ${supervisory.trustTier} | Cycle: ${getState().cycle}`,
    ).catch(() => null);

    // 14. Apply supervisory sizing on top of risk manager sizing
    const riskSizedUnits = riskDecision.positionSize * scorecard.sizeFactor;
    const finalSize = applySupervisorySizing(
      riskSizedUnits,
      metrics.equity,
      signal.price,
      supervisory,
    );

    if (finalSize <= 0) {
      log.info(`[AGENT] Zero-size after supervisory sizing for ${symbol} — skipping`);
      return;
    }

    // 15. Execute
    const orderResult = await placeOrder({
      symbol,
      side: signal.direction as 'buy' | 'sell',
      volume: finalSize,
    });

    if (!orderResult.success) {
      log.error(`[AGENT] Order failed for ${symbol}: ${orderResult.error}`);
      return;
    }

    const position = risk.openPosition(symbol, signal, { ...riskDecision, positionSize: finalSize }, null);

    // 16. Build artifact
    const artifact = buildArtifact({
      eventType: 'trade',
      symbol,
      signal,
      riskDecision: { ...riskDecision, positionSize: finalSize },
      cognitive,
      scorecard,
      sentiment,
      aiNarrative: narrative?.narrative ?? null,
      aiSource: narrative?.source ?? null,
      drawdown: metrics.drawdown,
      dailyPnl: metrics.dailyPnl,
    });

    // 17. Checkpoint
    const cp = await saveCheckpoint({
      eventType: 'trade',
      symbol,
      agentId: config.agentId,
      signal: signal.direction,
      data: {
        strategy: signal.strategy,
        confidence: signal.confidence,
        price: signal.price,
        positionId: position.id,
        supervisoryTier: supervisory.trustTier,
        capitalMultiplier: supervisory.capitalMultiplier,
        simSlippageBps: simResult.estimatedSlippageBps,
        netEdgePct: simResult.expectedNetEdgePct,
      },
    });

    artifact.checkpointHash = cp.hash;
    artifact.checkpointSignature = cp.signature;

    // 18. IPFS + on-chain (async, non-blocking)
    if (config.pinataJwt) {
      pinArtifact(artifact).then(r => {
        if (r) {
          log.info(`[AGENT] IPFS: ${r.cid}`);
          _ipfsPinnedCount++;
        }
      }).catch(() => {});
    }
    if (config.validationRegistry && cp.signature && config.agentId != null) {
      postCheckpointOnChain({ agentId: config.agentId, dataHash: cp.hash, signature: cp.signature }).catch(() => {});
    }

    log.info(`[AGENT] Trade opened: ${symbol} ${signal.direction.toUpperCase()} size=${finalSize.toFixed(6)} @ ${signal.price.toFixed(4)} | tier=${supervisory.trustTier} | CP#${cp.id}`);

  } catch (e) {
    log.error(`[AGENT] processSymbol(${symbol}) error: ${e}`);
  }
}

// ── Managed position check ────────────────────────────────────────────────────

async function checkManagedPositions(): Promise<void> {
  const positions = risk.getPositions();

  for (const pos of positions) {
    try {
      const tickerMap = await fetchTicker([pos.symbol]);
      const price = tickerMap[pos.symbol]?.price;
      if (!price) continue;

      risk.markPrice(pos.symbol, price);
      risk.updateTrailingStop(pos.id, price);

      const { close, reason } = risk.shouldClose(pos, price);
      if (!close) continue;

      await placeOrder({
        symbol: pos.symbol,
        side: pos.side === 'buy' ? 'sell' : 'buy',
        volume: pos.size,
      });

      const closed = risk.closePosition(pos.id, price);
      if (!closed) continue;

      const won = closed.pnl > 0;
      recordTrade(pos.symbol, won);
      if (reason === 'stop_loss') _stopHitCount++;

      // Record outcome for adaptive learning
      recordTradeOutcome({
        direction: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: price,
        pnlPct: closed.pnlPct,
        stopHit: reason === 'stop_loss',
        regime: 'normal',
        confidence: 0.5,
        timestamp: new Date().toISOString(),
      });

      const trade: ClosedTrade = {
        tradeId: generateTradeId(pos.symbol),
        symbol: pos.symbol,
        direction: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: price,
        positionSize: pos.size,
        pnl: closed.pnl,
        pnlPct: closed.pnlPct,
        strategy: pos.strategy,
        openedAt: pos.openedAt,
        closedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(pos.openedAt).getTime(),
        exitReason: _mapReason(reason),
        checkpointHash: null,
        ipfsCid: null,
      };
      recordClosedTrade(trade);

      await saveCheckpoint({
        eventType: 'close',
        symbol: pos.symbol,
        agentId: config.agentId,
        signal: pos.side,
        data: { pnl: closed.pnl, pnlPct: closed.pnlPct, reason },
      });

      const sign = closed.pnl >= 0 ? '+' : '';
      log.info(`[AGENT] Closed ${pos.symbol} | PnL: ${sign}$${closed.pnl.toFixed(2)} (${(closed.pnlPct * 100).toFixed(2)}%) | ${reason}`);

    } catch (e) {
      log.error(`[AGENT] checkManagedPositions(${pos.symbol}) error: ${e}`);
    }
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function runHeartbeat(): Promise<void> {
  try {
    const metrics = risk.getMetrics();
    await saveCheckpoint({
      eventType: 'heartbeat',
      symbol: 'SYSTEM',
      agentId: config.agentId,
      signal: 'hold',
      data: {
        cycle: getState().cycle,
        equity: metrics.equity,
        openPositions: metrics.openPositions,
      },
    });
    broadcastState();
  } catch (e) {
    log.error(`[AGENT] Heartbeat error: ${e}`);
  }
}

// ── State broadcast ───────────────────────────────────────────────────────────

function broadcastState(): void {
  const state = getState();
  const metrics = risk.getMetrics();
  const trStats = getTradeStats();
  const integrity = verifyChain();
  const cpStats = getCheckpointStats();
  const opState = getOperatorControlState();

  const trust = computeTrust({
    identityAgeDays: _identity?.identityAgeDays ?? null,
    isRegistered: _identity?.active ?? false,
    checkpointChainValid: integrity.valid,
    attestationCount: cpStats.signed ?? 0,
    drawdownPct: metrics.drawdown,
    maxDrawdownPct: config.maxDrawdownPct,
    recentWinRate: trStats.total > 0 ? trStats.winRate : null,
  });

  const scorecard = buildTrustPolicyScorecard({
    mandateViolations: _mandateViolations,
    vetoedTrades: _vetoCount,
    totalSignals: _totalSignals,
    maxDrawdownPct: metrics.drawdown,
    configMaxDrawdownPct: config.maxDrawdownPct,
    dailyLossBreaches: _dailyLossBreaches,
    circuitBreakerTrips: _circuitBreakerTrips,
    checkpointCount: cpStats.total ?? 0,
    ipfsPinnedCount: _ipfsPinnedCount,
    onChainAttestations: cpStats.signed ?? 0,
    checkpointChainValid: integrity.valid,
    winCount: trStats.wins,
    lossCount: trStats.losses,
    stopHitCount: _stopHitCount,
    totalClosed: trStats.total,
  });

  const shared = {
    cycle: state.cycle,
    halted: state.halted,
    haltReason: state.haltReason,
    executionMode: config.executionMode,
    agentId: config.agentId,
    agentName: config.agentName,
    operatorMode: opState.mode,
    positions: risk.getPositions(),
    riskMetrics: {
      equity: metrics.equity,
      dailyPnl: metrics.dailyPnl,
      drawdown: metrics.drawdown,
      openPositions: metrics.openPositions,
      status: state.halted ? 'halted' : opState.mode !== 'normal' ? opState.mode : metrics.status,
    },
    trust: {
      overall: scorecard.overall,
      tier: scorecard.tier,
      sizeFactor: scorecard.sizeFactor,
      dimensions: scorecard.dimensions,
    },
    signals: Object.entries(state.symbols).map(([sym, s]) => ({
      symbol: sym,
      direction: s.lastSignal,
      confidence: 0,
      reasoning: `Last signal: ${s.lastSignalTime ?? 'none'}`,
    })),
    governance: {
      mandateViolations: _mandateViolations,
      vetoedTrades: _vetoCount,
      totalSignals: _totalSignals,
      ipfsPinnedCount: _ipfsPinnedCount,
    },
  };

  injectDashboard(shared);
  injectMCP(shared);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getConsecutiveLosses(symbol: string): number {
  return getState().symbols[symbol]?.consecutiveLosses ?? 0;
}

function _mapReason(reason: string): ClosedTrade['exitReason'] {
  if (reason === 'stop_loss')   return 'stop';
  if (reason === 'take_profit') return 'target';
  if (reason === 'trailing')    return 'trailing';
  if (reason === 'halt')        return 'halt';
  return 'signal';
}

function _mapVolatilityRegime(regime?: string | null): 'low' | 'normal' | 'high' | 'extreme' {
  if (regime === 'low' || regime === 'high' || regime === 'extreme') return regime;
  return 'normal';
}

function _mapMarketRegimeToHint(regime: string): 'TRENDING' | 'RANGING' | 'STRESSED' | 'UNKNOWN' {
  if (regime === 'trending_up' || regime === 'trending_down') return 'TRENDING';
  if (regime === 'ranging') return 'RANGING';
  if (regime === 'volatile') return 'STRESSED';
  return 'UNKNOWN';
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function shutdown(signal: string): Promise<void> {
  log.info(`[AGENT] Shutdown on ${signal}`);
  try {
    await saveCheckpoint({
      eventType: 'halt',
      symbol: 'SYSTEM',
      agentId: config.agentId,
      signal: 'hold',
      data: { reason: signal, cycle: getState().cycle },
    });
  } catch {}
  process.exit(0);
}

// ── Entry point ───────────────────────────────────────────────────────────────

bootstrap().catch(e => {
  log.error(`[AGENT] Fatal bootstrap error: ${e}`);
  process.exit(1);
});
