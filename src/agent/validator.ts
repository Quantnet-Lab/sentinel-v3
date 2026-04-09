import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('VALIDATOR');

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateConfig(): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!config.privateKey && !config.agentWalletPrivateKey) {
    warnings.push('No private key set — running in local-only mode. Checkpoints will be unsigned.');
  }
  if (!config.pinataJwt) {
    warnings.push('PINATA_JWT not set — IPFS artifact pinning disabled.');
  }
  if (!config.anthropicApiKey && !config.geminiApiKey && !config.openaiApiKey) {
    warnings.push('No LLM API key set — AI reasoning and SAGE reflection disabled.');
  }
  if (!config.krakenApiKey) {
    warnings.push('KRAKEN_API_KEY not set — live execution disabled.');
  }
  if (!config.prismApiKey) {
    warnings.push('PRISM_API_KEY not set — PRISM confidence modifier disabled.');
  }
  if (config.symbols.length === 0) {
    errors.push('TRADING_SYMBOLS is empty — no symbols to trade.');
  }
  if (config.initialCapital <= 0) {
    errors.push('INITIAL_CAPITAL must be > 0.');
  }

  if (warnings.length > 0) {
    warnings.forEach(w => log.warn(w));
  }
  if (errors.length > 0) {
    errors.forEach(e => log.error(e));
  }

  return { valid: errors.length === 0, warnings, errors };
}
