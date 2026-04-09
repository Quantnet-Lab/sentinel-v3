/**
 * Circuit Breaker — halts trading when risk thresholds are breached.
 *
 * Triggers:
 *   - Daily loss limit exceeded
 *   - Maximum drawdown exceeded
 *   - Consecutive losses threshold
 *   - Volatility spike (extreme regime)
 */

export type CircuitBreakerReason =
  | 'daily_loss_limit'
  | 'max_drawdown'
  | 'consecutive_losses'
  | 'volatility_spike'
  | null;

export interface CircuitBreakerState {
  tripped: boolean;
  reason: CircuitBreakerReason;
  tripTime: string | null;
  resetTime: string | null;
  consecutiveLosses: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = {
    tripped: false,
    reason: null,
    tripTime: null,
    resetTime: null,
    consecutiveLosses: 0,
  };

  private readonly maxConsecutiveLosses = 5;
  private readonly autoResetMs = 30 * 60 * 1000; // 30 min auto-reset

  check(params: {
    dailyPnlPct: number;
    drawdownPct: number;
    isVolatilityExtreme: boolean;
    maxDailyLossPct: number;
    maxDrawdownPct: number;
  }): CircuitBreakerState {
    // Auto-reset after cooldown
    if (this.state.tripped && this.state.tripTime) {
      const elapsed = Date.now() - new Date(this.state.tripTime).getTime();
      if (elapsed > this.autoResetMs) {
        this.reset();
      }
    }

    if (this.state.tripped) return { ...this.state };

    if (params.dailyPnlPct <= -params.maxDailyLossPct) {
      return this.trip('daily_loss_limit');
    }
    if (params.drawdownPct >= params.maxDrawdownPct) {
      return this.trip('max_drawdown');
    }
    if (this.state.consecutiveLosses >= this.maxConsecutiveLosses) {
      return this.trip('consecutive_losses');
    }
    if (params.isVolatilityExtreme) {
      return this.trip('volatility_spike');
    }

    return { ...this.state };
  }

  recordLoss(): void {
    this.state.consecutiveLosses++;
  }

  recordWin(): void {
    this.state.consecutiveLosses = 0;
  }

  private trip(reason: CircuitBreakerReason): CircuitBreakerState {
    this.state.tripped = true;
    this.state.reason = reason;
    this.state.tripTime = new Date().toISOString();
    this.state.resetTime = new Date(Date.now() + this.autoResetMs).toISOString();
    return { ...this.state };
  }

  reset(): void {
    this.state = { tripped: false, reason: null, tripTime: null, resetTime: null, consecutiveLosses: 0 };
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}
