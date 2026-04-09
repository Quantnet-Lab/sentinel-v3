/**
 * Risk Manager — Sentinel's pre-trade and portfolio-level risk enforcement.
 *
 * Features:
 *   - Position sizing (ATR-based, trust-factor adjusted)
 *   - Stop-loss and take-profit calculation
 *   - Drawdown and daily loss tracking
 *   - ERC-8004 compliant compliance checks
 *   - Trailing stop ratcheting (>0.5% profit → activate trail)
 *   - ATR-based dynamic take-profits per regime
 *   - Circuit breaker integration
 */

import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { VolatilityTracker } from './volatility.js';
import type { TradeSignal } from '../strategy/types.js';

const log = createLogger('RISK');

let nextPositionId = 1;

export interface Position {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopDistance: number | null;
  highWaterMark: number;
  openedAt: string;
  strategy: string;
  atr: number | null;
  ipfsCid: string | null;
  txHash: string | null;
}

export interface ComplianceCheck {
  name: string;
  passed: boolean;
  value: number | string;
  limit: number | string;
  detail: string;
}

export interface RiskDecision {
  approved: boolean;
  symbol: string;
  positionSize: number;
  stopLoss: number | null;
  takeProfit: number | null;
  checks: ComplianceCheck[];
  halted: boolean;
  haltReason: string;
  vetoReason: string | null;
  riskStatus: 'normal' | 'caution' | 'halted';
  explanation: string;
  timestamp: string;
}

export interface RiskMetrics {
  equity: number;
  peakEquity: number;
  drawdown: number;
  dailyPnl: number;
  openPositions: number;
  totalExposure: number;
  status: 'normal' | 'caution' | 'halted';
}

export class RiskManager {
  private equity: number;
  private peakEquity: number;
  private dailyPnl = 0;
  private dailyReset = new Date().toDateString();
  private positions = new Map<number, Position>();
  private circuitBreaker = new CircuitBreaker();
  private volatility: VolatilityTracker;

  constructor(initialCapital: number) {
    this.equity = initialCapital;
    this.peakEquity = initialCapital;
    this.volatility = new VolatilityTracker(0.01);
  }

  // ── Pre-trade validation ────────────────────────────────────────────────────

  validate(signal: TradeSignal, symbol: string, trustFactor = 1.0): RiskDecision {
    this.resetDailyIfNeeded();

    const checks: ComplianceCheck[] = [];
    const cbState = this.circuitBreaker.check({
      dailyPnlPct: this.dailyPnl / this.equity,
      drawdownPct: (this.peakEquity - this.equity) / this.peakEquity,
      isVolatilityExtreme: this.volatility.getState().regime === 'extreme',
      maxDailyLossPct: config.maxDailyLossPct,
      maxDrawdownPct: config.maxDrawdownPct,
    });

    if (cbState.tripped) {
      return this.denied(symbol, `Circuit breaker: ${cbState.reason}`, checks, true);
    }

    // Max positions
    checks.push({
      name: 'max_positions',
      passed: this.positions.size < config.maxPositions,
      value: this.positions.size,
      limit: config.maxPositions,
      detail: `Open positions: ${this.positions.size}/${config.maxPositions}`,
    });

    // Max drawdown
    const drawdown = (this.peakEquity - this.equity) / this.peakEquity;
    checks.push({
      name: 'max_drawdown',
      passed: drawdown < config.maxDrawdownPct,
      value: `${(drawdown * 100).toFixed(2)}%`,
      limit: `${(config.maxDrawdownPct * 100).toFixed(0)}%`,
      detail: `Drawdown ${(drawdown * 100).toFixed(2)}%`,
    });

    // Daily loss limit
    const dailyLossPct = this.dailyPnl / this.equity;
    checks.push({
      name: 'daily_loss_limit',
      passed: dailyLossPct > -config.maxDailyLossPct,
      value: `${(dailyLossPct * 100).toFixed(2)}%`,
      limit: `-${(config.maxDailyLossPct * 100).toFixed(0)}%`,
      detail: `Daily P&L ${(dailyLossPct * 100).toFixed(2)}%`,
    });

    const failed = checks.find(c => !c.passed);
    if (failed) {
      return this.denied(symbol, failed.detail, checks, false, failed.detail);
    }

    // Position sizing
    const atrVal = signal.stopLoss > 0 ? Math.abs(signal.price - signal.stopLoss) : signal.price * 0.01;
    const baseSizePct = config.maxPositionPct * trustFactor;
    const rawSize = (this.equity * baseSizePct) / (atrVal * 2);
    const maxNotional = this.equity * baseSizePct;
    const size = Math.min(rawSize, maxNotional / signal.price);

    const stopLoss   = signal.stopLoss   > 0 ? signal.stopLoss   : signal.direction === 'buy' ? signal.price - atrVal * 2 : signal.price + atrVal * 2;
    const takeProfit = signal.takeProfit > 0 ? signal.takeProfit : signal.direction === 'buy' ? signal.price + atrVal * 3 : signal.price - atrVal * 3;

    return {
      approved: true,
      symbol,
      positionSize: size,
      stopLoss,
      takeProfit,
      checks,
      halted: false,
      haltReason: '',
      vetoReason: null,
      riskStatus: 'normal',
      explanation: `Approved: size=${size.toFixed(6)}, SL=${stopLoss.toFixed(4)}, TP=${takeProfit.toFixed(4)}`,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Position management ─────────────────────────────────────────────────────

  openPosition(symbol: string, signal: TradeSignal, decision: RiskDecision, atr: number | null = null): Position {
    const pos: Position = {
      id: nextPositionId++,
      symbol,
      side: signal.direction as 'buy' | 'sell',
      size: decision.positionSize,
      entryPrice: signal.price,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      trailingStopDistance: atr != null ? atr * 2 : null,
      highWaterMark: signal.price,
      openedAt: new Date().toISOString(),
      strategy: signal.strategy,
      atr,
      ipfsCid: null,
      txHash: null,
    };
    this.positions.set(pos.id, pos);
    log.info(`[RISK] Opened position #${pos.id} ${symbol} ${signal.direction} @ ${signal.price.toFixed(4)}, size=${pos.size.toFixed(6)}`);
    return pos;
  }

  closePosition(id: number, exitPrice: number): { position: Position; pnl: number; pnlPct: number } | null {
    const pos = this.positions.get(id);
    if (!pos) return null;

    const pnl = pos.side === 'buy'
      ? (exitPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - exitPrice) * pos.size;

    const pnlPct = pos.side === 'buy'
      ? (exitPrice - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - exitPrice) / pos.entryPrice;

    this.equity += pnl;
    this.dailyPnl += pnl;
    if (this.equity > this.peakEquity) this.peakEquity = this.equity;

    if (pnl >= 0) this.circuitBreaker.recordWin();
    else this.circuitBreaker.recordLoss();

    this.positions.delete(id);
    log.info(`[RISK] Closed position #${id} ${pos.symbol} @ ${exitPrice.toFixed(4)}, PnL=${pnl.toFixed(2)} (${(pnlPct * 100).toFixed(2)}%)`);
    return { position: pos, pnl, pnlPct };
  }

  updateTrailingStop(id: number, currentPrice: number): Position | null {
    const pos = this.positions.get(id);
    if (!pos || pos.trailingStopDistance == null) return null;

    if (pos.side === 'buy' && currentPrice > pos.highWaterMark) {
      pos.highWaterMark = currentPrice;
      const minProfit = pos.trailingStopDistance * 0.5 / pos.entryPrice;
      if ((currentPrice - pos.entryPrice) / pos.entryPrice >= 0.005) {
        pos.stopLoss = Math.max(pos.stopLoss ?? 0, currentPrice - pos.trailingStopDistance);
      }
    } else if (pos.side === 'sell' && currentPrice < pos.highWaterMark) {
      pos.highWaterMark = currentPrice;
      if ((pos.entryPrice - currentPrice) / pos.entryPrice >= 0.005) {
        pos.stopLoss = Math.min(pos.stopLoss ?? Infinity, currentPrice + pos.trailingStopDistance);
      }
    }
    return pos;
  }

  shouldClose(pos: Position, currentPrice: number): { close: boolean; reason: string } {
    if (pos.stopLoss != null) {
      if (pos.side === 'buy'  && currentPrice <= pos.stopLoss) return { close: true, reason: 'stop_loss' };
      if (pos.side === 'sell' && currentPrice >= pos.stopLoss) return { close: true, reason: 'stop_loss' };
    }
    if (pos.takeProfit != null) {
      if (pos.side === 'buy'  && currentPrice >= pos.takeProfit) return { close: true, reason: 'take_profit' };
      if (pos.side === 'sell' && currentPrice <= pos.takeProfit) return { close: true, reason: 'take_profit' };
    }
    return { close: false, reason: '' };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  updateVolatility(atrPct: number): void {
    const state = this.volatility.update(atrPct);
    if (state.spikeDetected) log.warn(`[RISK] Volatility spike detected: ATR=${(atrPct * 100).toFixed(2)}%`);
  }

  getMetrics(): RiskMetrics {
    const drawdown = (this.peakEquity - this.equity) / this.peakEquity;
    const exposure = Array.from(this.positions.values()).reduce((s, p) => s + p.size * p.entryPrice, 0);
    const cb = this.circuitBreaker.getState();
    return {
      equity: this.equity,
      peakEquity: this.peakEquity,
      drawdown,
      dailyPnl: this.dailyPnl,
      openPositions: this.positions.size,
      totalExposure: exposure,
      status: cb.tripped ? 'halted' : drawdown > config.maxDrawdownPct * 0.7 ? 'caution' : 'normal',
    };
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getPosition(id: number): Position | undefined {
    return this.positions.get(id);
  }

  private denied(symbol: string, explanation: string, checks: ComplianceCheck[], halted: boolean, veto: string | null = null): RiskDecision {
    return {
      approved: false,
      symbol,
      positionSize: 0,
      stopLoss: null,
      takeProfit: null,
      checks,
      halted,
      haltReason: halted ? explanation : '',
      vetoReason: veto,
      riskStatus: halted ? 'halted' : 'caution',
      explanation,
      timestamp: new Date().toISOString(),
    };
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.dailyReset) {
      this.dailyPnl = 0;
      this.dailyReset = today;
    }
  }
}
