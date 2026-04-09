/**
 * Sentinel Dashboard Server
 */

import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { createLogger } from '../agent/logger.js';
import { config } from '../agent/config.js';
import { getCheckpoints, getCheckpointStats, verifyChain } from '../trust/checkpoint.js';
import { getRecentLogs } from '../agent/logger.js';
import { getSAGEStatus } from '../strategy/sage-engine.js';
import { getClosedTrades, getTradeStats } from '../agent/trade-log.js';
import {
  pauseTrading, resumeTrading, emergencyStop,
  getOperatorControlState, getOperatorActionReceipts,
} from '../agent/operator-control.js';

const log = createLogger('DASHBOARD');
const __dirname = dirname(fileURLToPath(import.meta.url));

let _agentState: Record<string, unknown> = {};
export function injectAgentState(state: Record<string, unknown>): void {
  _agentState = state;
}

export function startDashboard(): void {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(join(__dirname, 'public')));

  // Serve the React dashboard JSX component
  app.get('/dashboard-app.jsx', (_, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    const p = join(__dirname, 'SentinelDashboard.jsx');
    createReadStream(p).pipe(res);
  });

  // ── API routes ──────────────────────────────────────────────────────────────

  app.get('/api/status', (_, res) => {
    res.json({
      agent: config.agentName,
      agentId: config.agentId,
      version: '3.0',
      executionMode: config.executionMode,
      symbols: config.symbols,
      testMode: config.testMode,
      ..._agentState,
    });
  });

  app.get('/api/checkpoints', (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? '50');
    const cps = getCheckpoints().slice(-limit).reverse();
    res.json({ checkpoints: cps, stats: getCheckpointStats(), integrity: verifyChain() });
  });

  app.get('/api/checkpoint/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const cp = getCheckpoints().find(c => c.id === id);
    if (!cp) return res.status(404).json({ error: 'not found' });
    res.json(cp);
  });

  app.get('/api/risk', (_, res) => {
    res.json((_agentState as any).riskMetrics ?? {});
  });

  app.get('/api/trust', (_, res) => {
    res.json((_agentState as any).trust ?? {});
  });

  app.get('/api/signals', (_, res) => {
    res.json((_agentState as any).signals ?? []);
  });

  app.get('/api/positions', (_, res) => {
    res.json((_agentState as any).positions ?? []);
  });

  app.get('/api/trades', (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? '20');
    const trades = getClosedTrades().slice(-limit).reverse();
    const stats = getTradeStats();
    res.json({ trades, stats });
  });

  app.get('/api/sage', (_, res) => {
    res.json(getSAGEStatus());
  });

  app.get('/api/logs', (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? '100');
    res.json(getRecentLogs().slice(-limit));
  });

  app.get('/api/governance', (_, res) => {
    res.json((_agentState as any).governance ?? {});
  });

  app.get('/api/verify-checkpoints', (_, res) => {
    const result = verifyChain();
    const stats = getCheckpointStats();
    res.json({ ...result, ...stats });
  });

  // ── Operator control endpoints ───────────────────────────────────────────────

  app.get('/api/operator/state', (_, res) => {
    res.json(getOperatorControlState());
  });

  app.get('/api/operator/actions', (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? '20');
    res.json({ actions: getOperatorActionReceipts(limit) });
  });

  app.post('/api/operator/pause', (req, res) => {
    const { reason = 'manual_pause', actor = 'dashboard' } = req.body ?? {};
    pauseTrading(String(reason), String(actor));
    res.json({ state: getOperatorControlState() });
  });

  app.post('/api/operator/resume', (req, res) => {
    const { reason = 'manual_resume', actor = 'dashboard' } = req.body ?? {};
    resumeTrading(String(reason), String(actor));
    res.json({ state: getOperatorControlState() });
  });

  app.post('/api/operator/emergency-stop', (req, res) => {
    const { reason = 'emergency', actor = 'dashboard' } = req.body ?? {};
    emergencyStop(String(reason), String(actor));
    res.json({ state: getOperatorControlState() });
  });

  app.listen(config.dashboardPort, () => {
    log.info(`[DASHBOARD] Running on http://localhost:${config.dashboardPort}`);
  });
}
