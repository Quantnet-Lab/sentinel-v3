/**
 * Structured logger with levels and timestamps.
 * Outputs to console with module-scoped prefixes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

const recentLogs: string[] = [];
const MAX_RECENT = 200;

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level: LogLevel, module: string, msg: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const line = `${timestamp()} [${module}] ${level.toUpperCase()}: ${msg}`;
  recentLogs.push(line);
  if (recentLogs.length > MAX_RECENT) recentLogs.shift();

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg) => emit('debug', module, msg),
    info:  (msg) => emit('info',  module, msg),
    warn:  (msg) => emit('warn',  module, msg),
    error: (msg) => emit('error', module, msg),
  };
}

export function getRecentLogs(): string[] {
  return [...recentLogs];
}

export function getErrorLogs(): string[] {
  return recentLogs.filter(l => l.includes(' ERROR:'));
}
