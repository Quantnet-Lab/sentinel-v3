/**
 * Sentinel v3 — Main Agent Loop
 *
 * Execution pipeline per cycle, per symbol:
 *   1. Fetch market candles + ticker
 *   2. Run ensemble strategy → TradeSignal
 *   3. Apply neuro-symbolic reasoning layer
 *   4. Generate AI narrative (Claude → Gemini → template)
 *   5. Run risk engine (circuit breaker, drawdown, sizing)
 *   6. Apply trust-based position sizing
 *   7. Execute order via Kraken bridge (paper/live/disabled)
 *   8. Build + emit validation artifact
 *   9. Save tamper-evident checkpoint
 *  10. Pin artifact to IPFS (async)
 *  11. Post attestation on-chain (async)
 *
 * Governance:
 *   - SAGE adaptive engine reflects every 6h on trade outcomes
 *   - Trust policy scorecard governs position sizing
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
import { runEnsemble } from '../strategy/ensemble.js';
import { applySymbolicReasoning } from '../strategy/neuro-symbolic.js';
import { generateReasoning } from '../strategy/ai-reasoning.js';
import { RiskManager } from '../risk/manager.js';
import { computeTrust } from '../chain/trust.js';
import { loadIdentity, postCheckpointOnChain } from '../chain/identity.js';
import { placeOrder, initPaperAccount } from '../data/kraken-bridge.js';
import { runSAGEReflection } from '../strategy/sage-engine.js';
import { startDashboard, injectAgentState as injectDashboard } from '../dashboard/server.js';
import { startMCPServer, injectAgentState as injectMCP } from '../mcp/server.js';
import type { ClosedTrade } from './trade-log.js';

const log = createLogger('AGENT');

// ── Module singletons ─────────────────────────────────────────────────────────

const risk = new RiskManager(config.initialCapital ?? 10000);

// Agent identity cache — populated at bootstrap
let _identity: Awaited<ReturnType<typeof loadIdentity>> | null = null;

// Scorecard input trackers (in-memory, accumulate over session)
let _vetoCount = 0;
let _totalSignals = 0;
let _stopHitCount = 0;
let _dailyLossBreaches = 0;
let _circuitBreakerTrips = 0;

// ── Startup ───────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  log.info('[AGENT] ─────────────────────────────────────────');
  log.info(`[AGENT] Sentinel v3 starting`);
  log.info(`[AGENT] Mode: ${config.executionMode} | Symbols: ${config.symbols.join(', ')}`);
  log.info('[AGENT] ─────────────────────────────────────────');

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
  if (state.halted) {
    log.warn(`[AGENT] Halted: ${state.haltReason}`);
    return;
  }

  incrementCycle();

  await Promise.allSettled(
    config.symbols.map(symbol => processSymbol(symbol))
  );

  await checkManagedPositions();
  broadcastState();
}

// ── Per-symbol processing ─────────────────────────────────────────────────────

async function processSymbol(symbol: string): Promise<void> {
  try {
    // 1. Market data
    const [candles, ticker] = await Promise.all([
      fetchCandles(symbol, '15', 100),
      fetchTicker(symbol),
    ]);

    if (candles.length < 50) {
      log.warn(`[AGENT] Insufficient candles for ${symbol}: ${candles.length}`);
      return;
    }

    // 2. Ensemble strategy
    const ensemble = runEnsemble(candles, symbol);
    let signal = ensemble.signal;
    _totalSignals++;

    // 3. Neuro-symbolic reasoning
    const stats = getTradeStats(symbol);
    const cognitiveCtx = {
      consecutiveLosses: _getConsecutiveLosses(symbol),
      winRate: stats.winRate,
    };
    const cognitive = applySymbolicReasoning(signal, candles, cognitiveCtx);
    signal = cognitive.adjustedSignal;

    // 4. Sentiment + PRISM modifiers
    const [sentiment, prism] = await Promise.all([
      fetchSentiment(symbol).catch(() => null),
      fetchPrismData(symbol).catch(() => null),
    ]);

    if (sentiment && Math.abs(sentiment.composite) > 0.6) {
      const boost = sentiment.composite > 0 ? 0.05 : -0.05;
      signal = { ...signal, confidence: Math.min(0.95, signal.confidence + boost) };
    }
    if (prism) {
      signal = { ...signal, confidence: Math.min(0.95, signal.confidence + prismConfidenceModifier(signal, prism)) };
    }

    recordSignal(symbol, signal.direction);
    log.info(`[AGENT] ${symbol} | ${signal.direction.toUpperCase()} | conf=${(signal.confidence * 100).toFixed(0)}% | ${signal.strategy}`);

    if (signal.direction === 'hold') {
      await saveCheckpoint({ eventType: 'signal', symbol, agentId: config.agentId, signal: 'hold', data: { strategy: signal.strategy } });
      return;
    }

    // 5. Trust computation
    const integrity = verifyChain();
    const cpStats   = getCheckpointStats();
    const trStats   = getTradeStats();
    const metrics   = risk.getMetrics();

    const trust = computeTrust({
      identityAgeDays: _identity?.identityAgeDays ?? null,
      isRegistered: _identity?.active ?? false,
      checkpointChainValid: integrity.valid,
      attestationCount: cpStats.signed ?? 0,
      drawdownPct: metrics.drawdown,
      maxDrawdownPct: config.maxDrawdownPct,
      recentWinRate: trStats.total > 0 ? trStats.winRate : null,
    });

    // 6. Risk validation
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

    // 7. Trust policy scorecard
    const scorecard = buildTrustPolicyScorecard({
      mandateViolations: 0,
      vetoedTrades: _vetoCount,
      totalSignals: _totalSignals,
      maxDrawdownPct: metrics.drawdown,
      configMaxDrawdownPct: config.maxDrawdownPct,
      dailyLossBreaches: _dailyLossBreaches,
      circuitBreakerTrips: _circuitBreakerTrips,
      checkpointCount: cpStats.total ?? 0,
      ipfsPinnedCount: 0,
      onChainAttestations: cpStats.signed ?? 0,
      checkpointChainValid: integrity.valid,
      winCount: trStats.wins,
      lossCount: trStats.losses,
      stopHitCount: _stopHitCount,
      totalClosed: trStats.total,
    });

    // 8. AI narrative (non-blocking on failure)
    const narrative = await generateReasoning(signal, `Symbol: ${symbol} | Trust: ${scorecard.tier} | Cycle: ${getState().cycle}`).catch(() => null);

    // 9. Execute
    const finalSize = riskDecision.positionSize * scorecard.sizeFactor;
    const orderResult = await placeOrder({
      symbol,
      direction: signal.direction as 'buy' | 'sell',
      size: finalSize,
      stopLoss: riskDecision.stopLoss ?? undefined,
      takeProfit: riskDecision.takeProfit ?? undefined,
    });

    if (!orderResult.success) {
      log.error(`[AGENT] Order failed for ${symbol}: ${orderResult.error}`);
      return;
    }

    // Track in risk manager
    const position = risk.openPosition(symbol, signal, { ...riskDecision, positionSize: finalSize }, signal.atr ?? null);

    // 10. Build artifact
    const artifact = buildArtifact({
      eventType: 'trade',
      symbol,
      signal,
      riskDecision: { ...riskDecision, positionSize: finalSize },
      cognitive,
      scorecard,
      sentiment,
      aiNarrative: narrative?.text ?? null,
      aiSource: narrative?.source ?? null,
      drawdown: metrics.drawdown,
      dailyPnl: metrics.dailyPnl,
    });

    // 11. Checkpoint
    const cp = await saveCheckpoint({
      eventType: 'trade',
      symbol,
      agentId: config.agentId,
      signal: signal.direction,
      data: { strategy: signal.strategy, confidence: signal.confidence, price: signal.price, positionId: position.id },
    });

    artifact.checkpointHash = cp.hash;
    artifact.checkpointSignature = cp.signature;

    // 12. IPFS + on-chain (async, non-blocking)
    if (config.pinataJwt) {
      pinArtifact(artifact).then(r => { if (r) log.info(`[AGENT] IPFS: ${r.cid}`); }).catch(() => {});
    }
    if (config.validationRegistry && cp.signature && config.agentId != null) {
      postCheckpointOnChain({ agentId: config.agentId, dataHash: cp.hash, signature: cp.signature }).catch(() => {});
    }

    log.info(`[AGENT] Trade opened: ${symbol} ${signal.direction.toUpperCase()} size=${finalSize.toFixed(6)} @ ${signal.price.toFixed(4)} | CP#${cp.id}`);

  } catch (e) {
    log.error(`[AGENT] processSymbol(${symbol}) error: ${e}`);
  }
}

// ── Managed position check ────────────────────────────────────────────────────

async function checkManagedPositions(): Promise<void> {
  const positions = risk.getPositions();

  for (const pos of positions) {
    try {
      const ticker = await fetchTicker(pos.symbol);
      const price = ticker.last;

      risk.updateTrailingStop(pos.id, price);

      const { close, reason } = risk.shouldClose(pos, price);
      if (!close) continue;

      await placeOrder({
        symbol: pos.symbol,
        direction: pos.side === 'buy' ? 'sell' : 'buy',
        size: pos.size,
      });

      const closed = risk.closePosition(pos.id, price);
      if (!closed) continue;

      const won = closed.pnl > 0;
      recordTrade(pos.symbol, won);
      if (reason === 'stop_loss') _stopHitCount++;

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
  const state   = getState();
  const metrics = risk.getMetrics();
  const trStats = getTradeStats();

  const integrity = verifyChain();
  const cpStats   = getCheckpointStats();

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
    mandateViolations: 0,
    vetoedTrades: _vetoCount,
    totalSignals: _totalSignals,
    maxDrawdownPct: metrics.drawdown,
    configMaxDrawdownPct: config.maxDrawdownPct,
    dailyLossBreaches: _dailyLossBreaches,
    circuitBreakerTrips: _circuitBreakerTrips,
    checkpointCount: cpStats.total ?? 0,
    ipfsPinnedCount: 0,
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
    riskMetrics: {
      equity: metrics.equity,
      dailyPnl: metrics.dailyPnl,
      drawdown: metrics.drawdown,
      openPositions: metrics.openPositions,
      status: state.halted ? 'halted' : metrics.status,
    },
    trust: {
      overall: scorecard.overall,
      tier: scorecard.tier,
      sizeFactor: scorecard.sizeFactor,
    },
    signals: Object.entries(state.symbols).map(([sym, s]) => ({
      symbol: sym,
      direction: s.lastSignal,
      confidence: 0,
      reasoning: `Last signal: ${s.lastSignalTime ?? 'none'}`,
    })),
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
