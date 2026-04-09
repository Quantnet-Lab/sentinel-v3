/**
 * Execution Simulator — Pre-trade dry-run analysis
 *
 * Before any capital is deployed, the simulator models slippage,
 * gas costs, price impact, and expected net edge. A trade is only
 * allowed when it produces a positive net edge after all costs.
 *
 * This prevents the agent from executing trades that are technically
 * valid signals but economically unviable after friction.
 */

import type { TradeSignal } from '../strategy/types.js';
import type { RiskDecision } from '../risk/manager.js';

export interface ExecutionSimulationInput {
  signal: TradeSignal;
  riskDecision: RiskDecision;
  positionSize: number;
  volatility?: number;
  gasUsd?: number;
  liquidityBudgetUsd?: number;
  externalCostBps?: number;
  volatilityRegime?: 'low' | 'normal' | 'high' | 'extreme';
}

export interface ExecutionSimulationResult {
  allowed: boolean;
  reason: string;
  estimatedFillPrice: number;
  estimatedSlippageBps: number;
  estimatedGasUsd: number;
  estimatedTotalCostUsd: number;
  expectedNetEdgePct: number;
  expectedWorstCasePct: number;
  priceImpactPct: number;
  simulationVersion: string;
}

export function simulateExecution(input: ExecutionSimulationInput): ExecutionSimulationResult {
  const { signal, riskDecision } = input;
  const price = signal.price;
  const sizeUnits = input.positionSize;
  const notionalUsd = sizeUnits * price;
  const vol = input.volatility ?? 0.02;
  const liquidityBudgetUsd = input.liquidityBudgetUsd ?? 25000;
  const gasUsd = input.gasUsd ?? 0.10;
  const baseBps = input.externalCostBps ?? 5;

  const sizePressure = liquidityBudgetUsd > 0 ? Math.min(1.5, notionalUsd / liquidityBudgetUsd) : 0;

  // Slippage model: base fee + volatility component + size pressure.
  // Calibrated so typical crypto vol produces 5–25 bps for retail-sized trades.
  const volMultiplier = 600;
  const estimatedSlippageBps = round2(baseBps + vol * volMultiplier + sizePressure * 18);
  const priceImpactPct = estimatedSlippageBps / 10000;
  const sideSign = signal.direction === 'sell' ? -1 : 1;
  const estimatedFillPrice = round4(price * (1 + sideSign * priceImpactPct));

  const stopDistPct = signal.stopLoss > 0
    ? Math.abs(price - signal.stopLoss) / price
    : Math.max(vol * 1.2, 0.01);

  const confidence = signal.confidence;
  const expectedGrossEdgePct = Math.max(0, confidence * Math.max(stopDistPct * 0.85, vol * 0.8));
  const explicitCostPct = price > 0 && sizeUnits > 0 ? (gasUsd / Math.max(notionalUsd, 1e-9)) : 0;
  const totalCostPct = priceImpactPct + explicitCostPct;
  const expectedNetEdgePct = expectedGrossEdgePct - totalCostPct;
  const expectedWorstCasePct = -(stopDistPct + totalCostPct);
  const estimatedTotalCostUsd = round2(notionalUsd * priceImpactPct + gasUsd);

  let allowed = true;
  let reason = 'simulation_pass';

  if (sizeUnits <= 0 || signal.direction === 'hold') {
    allowed = false;
    reason = 'no_executable_trade';
  } else if (estimatedSlippageBps > 120) {
    allowed = false;
    reason = 'slippage_too_high';
  } else if (expectedNetEdgePct <= 0) {
    allowed = false;
    reason = 'net_edge_too_low';
  } else if (input.volatilityRegime === 'extreme') {
    allowed = false;
    reason = 'extreme_volatility_simulation_block';
  }

  return {
    allowed,
    reason,
    estimatedFillPrice,
    estimatedSlippageBps,
    estimatedGasUsd: gasUsd,
    estimatedTotalCostUsd,
    expectedNetEdgePct: round4(expectedNetEdgePct),
    expectedWorstCasePct: round4(expectedWorstCasePct),
    priceImpactPct: round4(priceImpactPct),
    simulationVersion: '1.0',
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }
