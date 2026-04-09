/**
 * MCP (Model Context Protocol) Server
 *
 * Exposes Sentinel internals to Claude and other LLMs via JSON-RPC.
 * Provides tools, resources, and prompts for agent introspection.
 *
 * Tools: get_signals, get_positions, get_checkpoints, get_risk_metrics,
 *        get_trust_score, get_sage_status, get_sentiment, force_halt
 *
 * Resources: agent_state, checkpoint_log, trade_log, sage_state
 */

import express from 'express';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { getRecentLogs, getErrorLogs } from '../agent/logger.js';
import { getCheckpoints, getCheckpointStats, verifyChain } from '../trust/checkpoint.js';
import { getSAGEStatus, getActivePlaybookRules } from '../strategy/sage-engine.js';

const log = createLogger('MCP');

// ── Shared state injected from agent loop ─────────────────────────────────────
let _agentState: Record<string, unknown> = {};
export function injectAgentState(state: Record<string, unknown>): void {
  _agentState = state;
}

// ── MCP Response helpers ──────────────────────────────────────────────────────

function mcpResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

const TOOLS: Record<string, { description: string; handler: (params: any) => unknown }> = {
  get_agent_status: {
    description: 'Get current agent status, equity, positions, and cycle count',
    handler: () => _agentState,
  },
  get_checkpoints: {
    description: 'Get recent checkpoints with hash chain integrity status',
    handler: ({ limit = 20 }) => ({
      checkpoints: getCheckpoints().slice(-limit),
      stats: getCheckpointStats(),
      integrity: verifyChain(),
    }),
  },
  get_risk_metrics: {
    description: 'Get current risk metrics: equity, drawdown, daily PnL',
    handler: () => (_agentState as any).riskMetrics ?? {},
  },
  get_trust_score: {
    description: 'Get current trust scorecard with tier and size factor',
    handler: () => (_agentState as any).trust ?? {},
  },
  get_sage_status: {
    description: 'Get SAGE adaptive engine status and active playbook rules',
    handler: () => ({
      sage: getSAGEStatus(),
      playbookRules: getActivePlaybookRules(),
    }),
  },
  get_logs: {
    description: 'Get recent agent logs',
    handler: ({ limit = 50, errorsOnly = false }) =>
      errorsOnly ? getErrorLogs().slice(-limit) : getRecentLogs().slice(-limit),
  },
  get_signals: {
    description: 'Get last signals for all symbols',
    handler: () => (_agentState as any).signals ?? [],
  },
  list_tools: {
    description: 'List all available MCP tools',
    handler: () => Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description })),
  },
};

// ── Express app ───────────────────────────────────────────────────────────────

export function startMCPServer(): void {
  const app = express();
  app.use(express.json());

  app.post('/mcp', (req, res) => {
    const { id, method, params } = req.body;

    if (method === 'tools/list') {
      return res.json(mcpResult(id, {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
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
        return res.json(mcpResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }));
      } catch (e) {
        return res.json(mcpError(id, -32603, String(e)));
      }
    }

    if (method === 'resources/list') {
      return res.json(mcpResult(id, {
        resources: [
          { uri: 'sentinel://agent/state', name: 'Agent State', mimeType: 'application/json' },
          { uri: 'sentinel://trust/checkpoints', name: 'Checkpoint Log', mimeType: 'application/json' },
          { uri: 'sentinel://sage/state', name: 'SAGE State', mimeType: 'application/json' },
        ],
      }));
    }

    res.json(mcpError(id, -32601, `Method not found: ${method}`));
  });

  // Health check
  app.get('/health', (_, res) => res.json({ status: 'ok', agent: config.agentName }));

  app.listen(config.mcpPort, () => {
    log.info(`[MCP] Server running on port ${config.mcpPort}`);
  });
}
