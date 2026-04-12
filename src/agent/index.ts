/**
 * Sentinel v3 — Main Agent Loop
 *
 * 6-stage pipeline per cycle, per symbol:
 *   1. Oracle    — candle fetch + data integrity check
 *   2. Signal    — 3-strategy ensemble (Order Block, Engulfing, Momentum)
 *   3. Sentiment — composite sentiment confidence adjustment
 *   4. Risk Gate — mandate + position sizing + circuit breaker
 *   5. Execute   — place order via Kraken REST API
 *   6. Record    — save tamper-evident checkpoint
 */

import 'dotenv/config';
import { createLogger } from './logger.js';
import { config } from './config.js';
import {
  loadState, getState, incrementCycle,
  recordTrade, recordSignal, setHalted,
  persistEquity, getPersistedEquity,
} from './state.js';
import {
  loadTradeLog, recordClosedTrade, generateTradeId, getTradeStats,
} from './trade-log.js';
import { startScheduler } from './scheduler.js';
import {
  loadCheckpointHistory, saveCheckpoint,
  verifyChain, getCheckpointStats,
} from '../trust/checkpoint.js';
import { buildTrustPolicyScorecard } from '../trust/trust-scorecard.js';
import { fetchCandles, fetchTicker } from '../data/market.js';
import { fetchSentiment } from '../data/sentiment-feed.js';
import { EnsembleStrategy } from '../strategy/ensemble.js';
import { RiskManager } from '../risk/manager.js';
import { loadIdentity, postCheckpointOnChain } from '../chain/identity.js';
import { placeOrder, initPaperAccount } from '../data/kraken-bridge.js';
import { startDashboard, injectAgentState as injectDashboard } from '../dashboard/server.js';
import { startMCPServer, injectAgentState as injectMCP } from '../mcp/server.js';
import { evaluateOracleIntegrity } from '../security/oracle-integrity.js';
import { evaluateMandate } from '../chain/agent-mandate.js';
import { getOperatorControlState } from './operator-control.js';
import { submitTradeIntent, claimVaultCapital } from '../chain/risk-router.js';
import { simulateExecution } from '../chain/execution-simulator.js';
import { generateReasoning } from '../strategy/ai-reasoning.js';
import { recordTradeOutcome, runAdaptation, getAdaptiveParams } from '../strategy/adaptive-learning.js';
import type { ClosedTrade } from './trade-log.js';
import type { TradeSignal } from '../strategy/types.js';

const log = createLogger('AGENT');

// ── Module singletons ─────────────────────────────────────────────────────────

let risk = new RiskManager(config.initialCapital ?? 10000);
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

// Trust-based position sizing factor (updated each broadcast from scorecard)
let _trustSizeFactor = 1.0;

// Session-level heartbeat / observability state
const _startedAt = Date.now();
let _lastCycleAt: string | null = null;
let _lastTradeAt: string | null = null;
let _consecutiveErrors = 0;
let _lastNarrative: { narrative: string; source: string; symbol: string; timestamp: string } | null = null;
let _lastSentiment: Record<string, unknown> | null = null;
// All strategy evaluations from last cycle, keyed by symbol
const _allEvaluations: Record<string, { name: string; signal: string; confidence: number }[]> = {};
// All signals that fired last cycle, keyed by symbol
const _lastFiredSignals: Record<string, { symbol: string; direction: string; confidence: number; strategy: string; reasoning: string; timestamp: string }[]> = {};

// ── Startup ───────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  log.info('[AGENT] ─────────────────────────────────────────────────────────');
  log.info(`[AGENT] Sentinel v3 starting`);
  log.info(`[AGENT] Mode: ${config.executionMode} | Symbols: ${config.symbols.join(', ')}`);
  log.info('[AGENT] ─────────────────────────────────────────────────────────');

  loadState();
  loadTradeLog();
  loadCheckpointHistory();

  const savedEquity = getPersistedEquity(config.initialCapital ?? 10000);
  risk = new RiskManager(savedEquity);
  log.info(`[AGENT] Equity restored: $${savedEquity.toFixed(2)}`);

  if (config.executionMode === 'paper') {
    await initPaperAccount(savedEquity);
  }

  _identity = await loadIdentity();

  // Claim hackathon vault sandbox capital (non-blocking, fire-and-forget)
  if (_identity.agentId != null) {
    claimVaultCapital(_identity.agentId).then(r => {
      if (r.claimed) log.info(`[AGENT] Vault capital claimed: ${r.amount}`);
    }).catch(() => {});
  }

  startDashboard();
  startMCPServer();
  broadcastState();

  startScheduler({
    onCycle: runCycle,
    onHeartbeat: runHeartbeat,
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
  _lastCycleAt = new Date().toISOString();
  _consecutiveErrors = 0;

  await Promise.allSettled(config.symbols.map(symbol => processSymbol(symbol)));

  await checkManagedPositions();

  // Run adaptive learning after every cycle — adjusts SL multiplier, position size, confidence threshold
  const artifacts = runAdaptation(getState().cycle);
  if (artifacts.length > 0) {
    const adapted = getAdaptiveParams();
    log.info(`[ADAPT] ${artifacts.length} param(s) adapted | SL×${adapted.stopLossAtrMultiple.toFixed(2)} pos=${(adapted.basePositionPct * 100).toFixed(1)}% conf≥${(adapted.confidenceThreshold * 100).toFixed(1)}%`);
  }

  broadcastState();
}

// ── Per-symbol processing (6-stage pipeline) ─────────────────────────────────

async function processSymbol(symbol: string): Promise<void> {
  try {
    // Skip if already holding a position on this symbol — no pyramiding
    const hasOpenPosition = risk.getPositions().some(p => p.symbol === symbol);
    if (hasOpenPosition) return;

    // Stage 1: Oracle — fetch candles + data integrity check
    const [candles, tickerMap] = await Promise.all([
      fetchCandles(symbol, config.candleInterval ?? 1, 200),
      fetchTicker([symbol]),
    ]);
    const ticker = tickerMap[symbol] ?? null;
    if (ticker?.price) risk.markPrice(symbol, ticker.price);

    if (candles.length < 50) {
      log.warn(`[AGENT] Insufficient candles for ${symbol}: ${candles.length}`);
      return;
    }

    const oracleResult = evaluateOracleIntegrity({
      prices:        candles.map(c => c.close),
      highs:         candles.map(c => c.high),
      lows:          candles.map(c => c.low),
      timestamps:    candles.map(c => new Date(c.time).toISOString()),
      externalPrice: ticker?.price ?? null,
    });
    if (!oracleResult.passed) {
      log.warn(`[AGENT] Oracle BLOCKED ${symbol}: ${oracleResult.blockers.join(', ')}`);
      return;
    }

    // Stage 2: Signal — run 3-strategy ensemble
    const ensembleResult = _ensemble.analyze(candles);
    _totalSignals++;
    _allEvaluations[symbol] = ensembleResult.strategyEvaluations;
    log.info(`[AGENT] ${symbol} scores: ${ensembleResult.strategyEvaluations.map(e => `${e.name}=${(e.confidence*100).toFixed(0)}%(${e.signal})`).join(' | ')}`);

    let firedSignals: TradeSignal[] = [...ensembleResult.tradeSignals];

    if (config.testMode && firedSignals.length === 0) {
      const price = candles.at(-1)!.close;
      const atr   = price * 0.01;
      firedSignals = [{ direction: 'buy', confidence: 0.72, strategy: 'test_inject', price, stopLoss: price - atr * 2, takeProfit: price + atr * 3, reasoning: '[TEST] Synthetic signal', regime: ensembleResult.regimeSignal.regime, timestamp: new Date().toISOString() }];
      log.warn(`[AGENT] TEST MODE: injected BUY for ${symbol} @ ${price.toFixed(2)}`);
    }

    if (firedSignals.length === 0) return;

    log.info(`[AGENT] ${symbol} — ${firedSignals.length} signal(s) fired: ${firedSignals.map(s => s.strategy).join(', ')}`);
    _lastFiredSignals[symbol] = firedSignals.map(s => ({ symbol, direction: s.direction, confidence: s.confidence, strategy: s.strategy ?? 'unknown', reasoning: s.reasoning ?? '', timestamp: s.timestamp ?? new Date().toISOString() }));
    broadcastState();

    // Stage 3: Sentiment — fetch once, share across all signals
    const sentiment = await fetchSentiment(symbol).catch(() => null);
    if (sentiment) _lastSentiment = sentiment as unknown as Record<string, unknown>;

    // Execute each fired strategy independently through stages 3-6
    for (const rawSignal of firedSignals) {
      await executeSignal(symbol, rawSignal, sentiment);
    }

  } catch (e) {
    _consecutiveErrors++;
    log.error(`[AGENT] processSymbol(${symbol}) error: ${e}`);
  }
}

// ── Per-signal pipeline (stages 3-6) ─────────────────────────────────────────

async function executeSignal(
  symbol: string,
  signal: TradeSignal,
  sentiment: Awaited<ReturnType<typeof fetchSentiment>> | null,
): Promise<void> {
  try {
    // Stage 3: Sentiment confidence adjustment
    if (sentiment && Math.abs(sentiment.composite) > 0.6) {
      const boost = sentiment.composite > 0 ? 0.05 : -0.05;
      signal = { ...signal, confidence: Math.min(0.95, signal.confidence + boost) };
    }

    recordSignal(symbol, signal.direction);
    log.info(`[AGENT] ${symbol} | ${signal.direction.toUpperCase()} | conf=${(signal.confidence * 100).toFixed(0)}% | ${signal.strategy}`);

    // Stage 4: Risk Gate — circuit breaker + position sizing + mandate
    const metrics = risk.getMetrics();
    const riskDecision = risk.validate(signal, symbol, _trustSizeFactor);

    if (riskDecision.halted) {
      log.warn(`[AGENT] Circuit breaker: ${riskDecision.haltReason}`);
      setHalted(riskDecision.haltReason);
      _circuitBreakerTrips++;
      await saveCheckpoint({ eventType: 'halt', symbol, agentId: config.agentId, signal: signal.direction, data: { reason: riskDecision.haltReason } });
      return;
    }
    if (!riskDecision.approved) {
      log.info(`[AGENT] Risk veto ${symbol}/${signal.strategy}: ${riskDecision.vetoReason}`);
      _vetoCount++;
      return;
    }

    const mandateDecision = evaluateMandate({
      signal,
      positionSize: riskDecision.positionSize,
      capitalUsd:   metrics.equity,
      asset:        symbol.replace('USD', ''),
      protocol:     'kraken',
      dailyPnlPct:  metrics.dailyPnl / metrics.equity,
    });
    if (!mandateDecision.approved) {
      log.info(`[AGENT] Mandate veto ${symbol}/${signal.strategy}: ${mandateDecision.reasons.join(', ')}`);
      _mandateViolations++;
      _vetoCount++;
      return;
    }

    // Stage 4.5: Execution simulation — slippage, gas, net edge
    const sim = simulateExecution({
      signal,
      riskDecision,
      positionSize: riskDecision.positionSize,
      volatilityRegime: signal.regime as 'low' | 'normal' | 'high' | 'extreme',
    });
    if (!sim.allowed) {
      log.info(`[AGENT] Sim veto ${symbol}/${signal.strategy}: ${sim.reason} (slippage=${sim.estimatedSlippageBps}bps, edge=${sim.expectedNetEdgePct})`);
      _vetoCount++;
      return;
    }

    // Stage 5: Execute order (paper fallback keeps pipeline alive even if Kraken rejects)
    const orderResult = await placeOrder({ symbol, side: signal.direction as 'buy' | 'sell', volume: riskDecision.positionSize });
    if (!orderResult.success) {
      log.warn(`[AGENT] Kraken order failed (${orderResult.error}) — recording paper trade for on-chain submission`);
    }

    const position = risk.openPosition(symbol, signal, riskDecision, null);
    _lastTradeAt = new Date().toISOString();

    // Generate AI narrative (non-blocking — fires and updates dashboard on completion)
    generateReasoning(signal).then(result => {
      _lastNarrative = { narrative: result.narrative, source: result.source, symbol, timestamp: new Date().toISOString() };
      log.info(`[AGENT] Narrative via ${result.source} (${result.latencyMs}ms)`);
      broadcastState();
    }).catch(() => {});

    // Submit signed TradeIntent to ERC-8004 Risk Router — always fires (leaderboard)
    if (_identity?.agentId != null) {
      submitTradeIntent({
        agentId:    _identity.agentId,
        symbol,
        direction:  signal.direction as 'buy' | 'sell',
        price:      signal.price,
        size:       riskDecision.positionSize,
        stopLoss:   signal.stopLoss ?? signal.price * 0.98,
        takeProfit: signal.takeProfit ?? signal.price * 1.03,
      }).then(r => {
        if (r.submitted) log.info(`[AGENT] TradeIntent on-chain | intentId=${r.intentId} | tx=${r.txHash}`);
        else log.warn(`[AGENT] TradeIntent failed: ${r.error}`);
      }).catch(() => {});
    }

    // Stage 6: Record checkpoint
    const cp = await saveCheckpoint({
      eventType: 'trade', symbol, agentId: config.agentId, signal: signal.direction,
      data: {
        strategy: signal.strategy,
        confidence: signal.confidence,
        price: signal.price,
        positionId: position.id,
        positionSize: riskDecision.positionSize,
        supervisoryTier: _trustSizeFactor >= 1.0 ? 'elite' : _trustSizeFactor >= 0.9 ? 'elevated' : _trustSizeFactor >= 0.75 ? 'standard' : _trustSizeFactor >= 0.5 ? 'limited' : 'probation',
        simSlippageBps: sim.estimatedSlippageBps,
        netEdgePct: sim.expectedNetEdgePct,
      },
    });

    if (config.validationRegistry && config.agentId != null) {
      postCheckpointOnChain({ agentId: config.agentId, dataHash: cp.hash }).catch(() => {});
    }

    log.info(`[AGENT] ✓ Trade opened: ${symbol} ${signal.direction.toUpperCase()} size=${riskDecision.positionSize.toFixed(6)} @ ${signal.price.toFixed(4)} | ${signal.strategy} | CP#${cp.id}`);

  } catch (e) {
    log.error(`[AGENT] executeSignal(${symbol}/${signal.strategy}) error: ${e}`);
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

      // Grace period: ignore stop_loss triggers within the first 5 minutes.
      // The live ticker price can diverge from the candle close used as entry,
      // causing an immediate stop-out on the same cycle the trade was opened.
      const ageMs = Date.now() - new Date(pos.openedAt).getTime();
      if (reason === 'stop_loss' && ageMs < 5 * 60 * 1000) continue;

      await placeOrder({
        symbol: pos.symbol,
        side: pos.side === 'buy' ? 'sell' : 'buy',
        volume: pos.size,
      });

      const closed = risk.closePosition(pos.id, price);
      if (!closed) continue;

      const won = closed.pnl > 0;
      recordTrade(pos.symbol, won);
      persistEquity(risk.getMetrics().equity);
      if (reason === 'stop_loss') _stopHitCount++;
      _lastTradeAt = new Date().toISOString();

      // Feed outcome into adaptive learning engine with real position metadata
      recordTradeOutcome({
        direction: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: price,
        pnlPct: closed.pnlPct,
        stopHit: reason === 'stop_loss',
        regime: (pos.regime ?? 'normal') as 'low' | 'normal' | 'high' | 'extreme',
        confidence: pos.entryConfidence ?? 0.6,
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

  _trustSizeFactor = scorecard.sizeFactor;

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
    signals: Object.values(_lastFiredSignals).flat(),
    governance: {
      mandateViolations: _mandateViolations,
      vetoedTrades: _vetoCount,
      totalSignals: _totalSignals,
      ipfsPinnedCount: _ipfsPinnedCount,
    },
    heartbeat: {
      lastCycleAt: _lastCycleAt,
      lastTradeAt: _lastTradeAt,
      uptimeMs: Date.now() - _startedAt,
      consecutiveErrors: _consecutiveErrors,
    },
    narrative: _lastNarrative,
    sentiment: _lastSentiment,
    strategyEvaluations: _allEvaluations,
  };

  injectDashboard(shared);
  injectMCP(shared);
}

// ── Helpers ───────────────────────────────────────────────────────────────────


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
