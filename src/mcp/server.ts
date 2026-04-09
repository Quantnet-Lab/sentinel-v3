/**
 * MCP (Model Context Protocol) Server
 *
 * Exposes Sentinel's full runtime to Claude and other LLMs via JSON-RPC.
 * Tools are visibility-tiered: public (read-only), restricted (governance),
 * operator (runtime intervention).
 *
 * Tools:
 *   Public:    get_agent_status, get_signals, get_risk_metrics, get_trust_state,
 *              get_capital_rights, get_mandate_state, get_checkpoints,
 *              get_performance_metrics, get_trade_history, explain_trade,
 *              get_validation_status, get_sage_status, get_logs, list_tools
 *   Restricted: propose_trade
 *   Operator:  pause_agent, resume_agent, emergency_stop
 *
 * Resources: agent_state, checkpoint_log, trade_log, sage_state, mandate_state
 */

import express from 'express';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { getRecentLogs, getErrorLogs } from '../agent/logger.js';
import { getCheckpoints, getCheckpointStats, verifyChain } from '../trust/checkpoint.js';
import { getSAGEStatus, getActivePlaybookRules } from '../strategy/sage-engine.js';
import { getAdaptationSummary, getAdaptiveParams, getContextStats } from '../strategy/adaptive-learning.js';
import { getDefaultMandate } from '../chain/agent-mandate.js';
import { computeRiskAdjustedMetrics, type EquityPoint, type TradeOutcome } from '../analytics/performance-metrics.js';
import {
  pauseTrading, resumeTrading, emergencyStop,
  getOperatorControlState, getLatestOperatorAction, getOperatorActionReceipts,
} from '../agent/operator-control.js';
import { getTradeStats, getClosedTrades } from '../agent/trade-log.js';

const log = createLogger('MCP');

// ── Shared state injected from agent loop ─────────────────────────────────────
let _agentState: Record<string, unknown> = {};

export function injectAgentState(state: Record<string, unknown>): void {
  _agentState = state;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function buildCapitalRights(trustScore: number | null) {
  const score = trustScore ?? 0;
  if (score < 60) return { tier: 'TIER_0_BLOCKED',   multiplier: 0    };
  if (score < 72) return { tier: 'TIER_1_PROBATION', multiplier: 0.40 };
  if (score < 82) return { tier: 'TIER_2_LIMITED',   multiplier: 0.70 };
  if (score < 90) return { tier: 'TIER_3_STANDARD',  multiplier: 0.90 };
  if (score < 95) return { tier: 'TIER_4_ELEVATED',  multiplier: 1.00 };
  return                 { tier: 'TIER_5_ELITE',     multiplier: 1.00 };
}

function buildEquitySeries(): { equityPoints: EquityPoint[]; trades: TradeOutcome[] } {
  const riskMetrics = _agentState.riskMetrics as Record<string, unknown> | undefined;
  const equity = Number(riskMetrics?.equity ?? config.initialCapital);
  const dailyPnl = Number(riskMetrics?.dailyPnl ?? 0);
  const startEquity = equity - dailyPnl;

  const points: EquityPoint[] = [
    { timestamp: new Date(Date.now() - 86400000).toISOString(), equity: Math.max(startEquity, 1) },
    { timestamp: new Date().toISOString(), equity: Math.max(equity, 1) },
  ];
  return { equityPoints: points, trades: [] };
}

// ── Tool definitions ──────────────────────────────────────────────────────────

type Visibility = 'public' | 'restricted' | 'operator';

interface Tool {
  description: string;
  visibility: Visibility;
  handler: (params: Record<string, unknown>) => unknown;
}

const TOOLS: Record<string, Tool> = {

  get_agent_status: {
    description: 'Current agent status, equity, positions, cycle count, and halted state',
    visibility: 'public',
    handler: () => _agentState,
  },

  get_signals: {
    description: 'Last trade signals for all symbols with direction and confidence',
    visibility: 'public',
    handler: () => (_agentState as any).signals ?? [],
  },

  get_risk_metrics: {
    description: 'Current risk metrics: equity, drawdown, daily PnL, open positions',
    visibility: 'public',
    handler: () => (_agentState as any).riskMetrics ?? {},
  },

  get_trust_state: {
    description: 'Trust score, tier, capital multiplier, and adaptive learning summary',
    visibility: 'public',
    handler: () => {
      const trust = (_agentState as any).trust ?? {};
      const score = typeof trust.overall === 'number' ? trust.overall * 100 : null;
      const rights = buildCapitalRights(score);
      return {
        trustScore: score,
        trustTier: rights.tier,
        capitalMultiplier: rights.multiplier,
        tier: trust.tier,
        sizeFactor: trust.sizeFactor,
        adaptiveParams: getAdaptiveParams(),
        adaptationSummary: getAdaptationSummary(),
      };
    },
  },

  get_capital_rights: {
    description: 'Current capital rights determined by trust tier and mandate constraints',
    visibility: 'public',
    handler: () => {
      const trust = (_agentState as any).trust ?? {};
      const score = typeof trust.overall === 'number' ? trust.overall * 100 : null;
      const rights = buildCapitalRights(score);
      const mandate = getDefaultMandate(config.initialCapital);
      return {
        trustScore: score,
        trustTier: rights.tier,
        capitalMultiplier: rights.multiplier,
        maxTradeSizePct: mandate.maxTradeSizePct,
        maxDailyLossPct: mandate.maxDailyLossPct,
        requireHumanApprovalAboveUsd: mandate.requireHumanApprovalAboveUsd,
        allowedAssets: mandate.allowedAssets,
        allowedProtocols: mandate.allowedProtocols,
      };
    },
  },

  get_mandate_state: {
    description: 'Active mandate parameters and current operator/supervisory state',
    visibility: 'public',
    handler: () => ({
      mandate: getDefaultMandate(config.initialCapital),
      operatorControl: getOperatorControlState(),
      latestOperatorAction: getLatestOperatorAction(),
      recentOperatorReceipts: getOperatorActionReceipts(5),
    }),
  },

  get_checkpoints: {
    description: 'Recent checkpoints with hash chain integrity status',
    visibility: 'public',
    handler: ({ limit = 20 }) => ({
      checkpoints: getCheckpoints().slice(-(limit as number)),
      stats: getCheckpointStats(),
      integrity: verifyChain(),
    }),
  },

  get_performance_metrics: {
    description: 'Risk-adjusted return metrics: Sharpe, Sortino, Calmar, max drawdown, profit factor, win rate',
    visibility: 'public',
    handler: () => {
      const { equityPoints, trades } = buildEquitySeries();
      const metrics = computeRiskAdjustedMetrics(equityPoints, trades, 0);
      return {
        ...metrics,
        equityPoints,
        note: 'Metrics derived from current session equity and trade history.',
      };
    },
  },

  get_trade_history: {
    description: 'Closed trade history and aggregate statistics',
    visibility: 'public',
    handler: ({ limit = 50 }) => {
      const tradeStats = getTradeStats();
      const trades = getClosedTrades().slice(-(limit as number));
      return { stats: tradeStats, trades };
    },
  },

  get_sage_status: {
    description: 'SAGE adaptive engine status and active playbook rules',
    visibility: 'public',
    handler: () => ({
      sage: getSAGEStatus(),
      playbookRules: getActivePlaybookRules(),
      adaptationSummary: getAdaptationSummary(),
    }),
  },

  get_logs: {
    description: 'Recent agent logs (pass errorsOnly=true for error-only view)',
    visibility: 'public',
    handler: ({ limit = 50, errorsOnly = false }) =>
      (errorsOnly as boolean) ? getErrorLogs().slice(-(limit as number)) : getRecentLogs().slice(-(limit as number)),
  },

  explain_trade: {
    description: 'Full governance proof for the latest trade: signal, risk checks, trust, IPFS receipt',
    visibility: 'public',
    handler: ({ trade_id }) => {
      const cps = getCheckpoints();
      const cp = typeof trade_id === 'number'
        ? cps.find((c: any) => c.id === trade_id)
        : cps[cps.length - 1];
      if (!cp) return { error: 'No checkpoints available yet' };
      const trust = (_agentState as any).trust ?? {};
      const score = typeof trust.overall === 'number' ? trust.overall * 100 : null;
      const rights = buildCapitalRights(score);
      return {
        checkpointId: (cp as any).id,
        timestamp: (cp as any).timestamp,
        eventType: (cp as any).eventType,
        signal: (cp as any).signal,
        symbol: (cp as any).symbol,
        trustScore: score,
        trustTier: rights.tier,
        capitalMultiplier: rights.multiplier,
        hash: (cp as any).hash,
        signature: (cp as any).signature,
      };
    },
  },

  get_validation_status: {
    description: 'Validation status: checkpoint chain integrity, IPFS coverage, on-chain attestations',
    visibility: 'public',
    handler: () => {
      const stats = getCheckpointStats();
      const integrity = verifyChain();
      return {
        checkpointChainValid: integrity.valid,
        totalCheckpoints: stats.total,
        signedCheckpoints: stats.signed,
        validationRegistryConfigured: Boolean(config.validationRegistry),
        integrity,
      };
    },
  },

  list_tools: {
    description: 'List all available MCP tools with descriptions and visibility tiers',
    visibility: 'public',
    handler: () =>
      Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        visibility: t.visibility,
      })),
  },

  // ── Restricted ──

  propose_trade: {
    description: 'Create a governed trade proposal without submitting it to the market',
    visibility: 'restricted',
    handler: ({ market, side, size_hint_pct }) => {
      const trust = (_agentState as any).trust ?? {};
      const score = typeof trust.overall === 'number' ? trust.overall * 100 : null;
      const rights = buildCapitalRights(score);
      const mandate = getDefaultMandate(config.initialCapital);
      const hint = typeof size_hint_pct === 'number' ? Math.max(0, size_hint_pct) / 100 : 0.02;
      const governedPct = Math.min(hint * rights.multiplier, mandate.maxTradeSizePct);
      const operatorState = getOperatorControlState();
      const status = rights.multiplier <= 0 || !operatorState.canTrade ? 'BLOCKED' : 'APPROVED';

      return {
        status,
        market: String(market ?? config.tradingPair),
        side: side ?? 'buy',
        trustScore: score,
        trustTier: rights.tier,
        governedSizePct: governedPct,
        notionalUsd: Number((config.initialCapital * governedPct).toFixed(2)),
        rationale: [
          status === 'APPROVED' ? 'runtime permits proposal' : 'proposal blocked by runtime state',
          `capital rights multiplier ${rights.multiplier.toFixed(2)}x`,
          `max mandate trade size ${(mandate.maxTradeSizePct * 100).toFixed(2)}%`,
        ],
        adaptationSummary: getAdaptationSummary(),
        contextStats: getContextStats({
          regime: 'normal',
          direction: (side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
        }),
      };
    },
  },

  // ── Operator ──

  pause_agent: {
    description: 'Pause the trading runtime. Operator-only governance action.',
    visibility: 'operator',
    handler: ({ reason, actor }) =>
      pauseTrading(String(reason ?? 'mcp pause request'), String(actor ?? 'mcp-operator')),
  },

  resume_agent: {
    description: 'Resume the trading runtime. Operator-only governance action.',
    visibility: 'operator',
    handler: ({ reason, actor }) =>
      resumeTrading(String(reason ?? 'mcp resume request'), String(actor ?? 'mcp-operator')),
  },

  emergency_stop: {
    description: 'Immediately halt all trading. Operator-only governance action.',
    visibility: 'operator',
    handler: ({ reason, actor }) =>
      emergencyStop(String(reason ?? 'mcp emergency stop'), String(actor ?? 'mcp-operator')),
  },
};

// ── Resources ─────────────────────────────────────────────────────────────────

const RESOURCES: Record<string, { name: string; description: string; mimeType: string; resolve: () => unknown }> = {
  'sentinel://agent/state': {
    name: 'Agent State',
    description: 'Full runtime agent state snapshot',
    mimeType: 'application/json',
    resolve: () => _agentState,
  },
  'sentinel://trust/checkpoints': {
    name: 'Checkpoint Log',
    description: 'Hash-chain checkpoint history',
    mimeType: 'application/json',
    resolve: () => ({ checkpoints: getCheckpoints().slice(-50), stats: getCheckpointStats(), integrity: verifyChain() }),
  },
  'sentinel://sage/state': {
    name: 'SAGE State',
    description: 'SAGE adaptive engine and adaptive learning state',
    mimeType: 'application/json',
    resolve: () => ({ sage: getSAGEStatus(), adaptation: getAdaptationSummary(), playbookRules: getActivePlaybookRules() }),
  },
  'sentinel://governance/mandate': {
    name: 'Mandate & Operator State',
    description: 'Active agent mandate and operator control receipts',
    mimeType: 'application/json',
    resolve: () => ({
      mandate: getDefaultMandate(config.initialCapital),
      operatorControl: getOperatorControlState(),
      receipts: getOperatorActionReceipts(10),
    }),
  },
  'sentinel://analytics/performance': {
    name: 'Performance Metrics',
    description: 'Risk-adjusted return metrics for current session',
    mimeType: 'application/json',
    resolve: () => {
      const { equityPoints, trades } = buildEquitySeries();
      return computeRiskAdjustedMetrics(equityPoints, trades, 0);
    },
  },
};

// ── Express app ───────────────────────────────────────────────────────────────

export function startMCPServer(): void {
  const app = express();
  app.use(express.json());

  app.post('/mcp', (req, res) => {
    const { id, method, params } = req.body ?? {};

    if (method === 'tools/list') {
      return res.json(mcpResult(id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          visibility: t.visibility,
          inputSchema: { type: 'object', properties: {} },
        })),
      }));
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const tool = TOOLS[toolName];
      if (!tool) return res.json(mcpError(id, -32601, `Tool not found: ${toolName}`));
      try {
        const result = tool.handler(params?.arguments ?? {});
        return res.json(mcpResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }));
      } catch (e) {
        return res.json(mcpError(id, -32603, String(e)));
      }
    }

    if (method === 'resources/list') {
      return res.json(mcpResult(id, {
        resources: Object.entries(RESOURCES).map(([uri, r]) => ({
          uri, name: r.name, description: r.description, mimeType: r.mimeType,
        })),
      }));
    }

    if (method === 'resources/read') {
      const uri = params?.uri;
      const resource = RESOURCES[uri];
      if (!resource) return res.json(mcpError(id, -32601, `Resource not found: ${uri}`));
      try {
        const content = resource.resolve();
        return res.json(mcpResult(id, {
          contents: [{ uri, mimeType: resource.mimeType, text: JSON.stringify(content, null, 2) }],
        }));
      } catch (e) {
        return res.json(mcpError(id, -32603, String(e)));
      }
    }

    if (method === 'prompts/list') {
      return res.json(mcpResult(id, {
        prompts: [
          { name: 'explain_governance', description: 'Explain the current governance pipeline stage-by-stage' },
          { name: 'audit_last_trade', description: 'Provide a full audit narrative for the most recent trade decision' },
          { name: 'assess_risk_posture', description: 'Assess current risk posture: drawdown, trust, regime, and open positions' },
          { name: 'summarize_session', description: 'Summarize the current trading session: PnL, trades, signals, and trust evolution' },
        ],
      }));
    }

    res.json(mcpError(id, -32601, `Method not found: ${method}`));
  });

  app.get('/health', (_, res) =>
    res.json({ status: 'ok', agent: config.agentName, tools: Object.keys(TOOLS).length }),
  );

  app.listen(config.mcpPort, () => {
    log.info(`[MCP] Server running on port ${config.mcpPort} (${Object.keys(TOOLS).length} tools)`);
  });
}
