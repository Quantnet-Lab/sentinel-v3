/**
 * Shared types for the Sentinel strategy layer.
 */

export type SignalDirection = 'buy' | 'sell' | 'hold';
export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';
export type VolatilityRegime = 'low' | 'normal' | 'high' | 'extreme';
export type StrategyName =
  | 'ict_silver_bullet'
  | 'amd_cycle'
  | 'order_block'
  | 'engulfing'
  | 'momentum'
  | 'mean_reversion'
  | 'ensemble'
  | 'test_inject';

export interface Candle {
  time: number;   // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  direction: SignalDirection;
  confidence: number;       // 0.0 – 1.0
  strategy: StrategyName;
  price: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  regime: MarketRegime;
  timestamp: string;
}

export interface RegimeSignal {
  regime: MarketRegime;
  adx: number;
  rsi: number;
  trend: 'up' | 'down' | 'flat';
  volatilityRegime: VolatilityRegime;
  reasoning: string;
}

export const HOLD_SIGNAL = (
  price: number,
  regime: MarketRegime,
  reason: string,
  strategy: StrategyName = 'ensemble',
): TradeSignal => ({
  direction: 'hold',
  confidence: 0,
  strategy,
  price,
  stopLoss: 0,
  takeProfit: 0,
  reasoning: reason,
  regime,
  timestamp: new Date().toISOString(),
});
