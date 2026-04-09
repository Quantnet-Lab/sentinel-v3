/**
 * Scheduler — drives the agent's trading loop.
 *
 * - Primary: runs every `cycleIntervalMs` (default 60s)
 * - Heartbeat: runs every 5 min to emit checkpoint even if no signal
 * - SAGE reflection: runs every 6 hours if enabled
 *
 * Uses node-cron for precise scheduling and tracks cycle timing.
 */

import cron from 'node-cron';
import { createLogger } from './logger.js';
import { config } from './config.js';

const log = createLogger('SCHEDULER');

export type CycleHandler  = () => Promise<void>;
export type HeartbeatHandler = () => Promise<void>;
export type SageHandler   = () => Promise<void>;

interface SchedulerOptions {
  onCycle: CycleHandler;
  onHeartbeat: HeartbeatHandler;
  onSageReflection?: SageHandler;
}

let _running = false;
let _cycleInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(opts: SchedulerOptions): void {
  if (_running) return;
  _running = true;

  const cycleMs = config.minTradeIntervalMs;
  log.info(`[SCHEDULER] Starting — cycle every ${cycleMs / 1000}s`);

  // Run immediately, then on interval
  _runCycle(opts.onCycle);
  _cycleInterval = setInterval(() => _runCycle(opts.onCycle), cycleMs);

  // Heartbeat every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    _runTask('heartbeat', opts.onHeartbeat);
  });

  // SAGE reflection every 6 hours
  if (config.sageEnabled && opts.onSageReflection) {
    cron.schedule('0 */6 * * *', () => {
      _runTask('sage-reflection', opts.onSageReflection!);
    });
  }

  log.info('[SCHEDULER] Running');
}

export function stopScheduler(): void {
  if (_cycleInterval) {
    clearInterval(_cycleInterval);
    _cycleInterval = null;
  }
  _running = false;
  log.info('[SCHEDULER] Stopped');
}

async function _runCycle(fn: CycleHandler): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    log.debug(`[SCHEDULER] Cycle complete in ${Date.now() - t0}ms`);
  } catch (e) {
    log.error(`[SCHEDULER] Cycle error: ${e}`);
  }
}

async function _runTask(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    log.error(`[SCHEDULER] Task '${name}' error: ${e}`);
  }
}
