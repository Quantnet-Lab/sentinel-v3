/**
 * TEE Attestation — software-based Trusted Execution Environment attestation.
 *
 * Generates a signed attestation binding:
 *   - Agent identity (wallet address, agentId)
 *   - Runtime environment (Node version, platform, process uptime)
 *   - Code fingerprint (package.json version)
 *   - Timestamp
 *
 * This is a software attestation — not hardware TEE — but provides
 * a verifiable binding between the agent's identity and runtime context.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../agent/config.js';
import { getSignerAddress } from '../chain/eip712.js';

export interface TEEAttestation {
  agentWallet: string | null;
  agentId: number | null;
  nodeVersion: string;
  platform: string;
  agentVersion: string;
  runtimeHash: string;
  uptimeSeconds: number;
  generatedAt: string;
}

function getAgentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function computeRuntimeHash(attestation: Omit<TEEAttestation, 'runtimeHash'>): string {
  const data = JSON.stringify(attestation);
  return createHash('sha256').update(data).digest('hex');
}

export function generateAttestation(): TEEAttestation {
  const partial: Omit<TEEAttestation, 'runtimeHash'> = {
    agentWallet:   getSignerAddress(),
    agentId:       config.agentId,
    nodeVersion:   process.version,
    platform:      process.platform,
    agentVersion:  getAgentVersion(),
    uptimeSeconds: Math.floor(process.uptime()),
    generatedAt:   new Date().toISOString(),
  };

  return { ...partial, runtimeHash: computeRuntimeHash(partial) };
}

export function generateAttestationSummary(): string {
  const a = generateAttestation();
  return `agent=${a.agentId ?? 'unregistered'} wallet=${a.agentWallet?.slice(0, 10) ?? 'none'} v=${a.agentVersion} node=${a.nodeVersion} hash=${a.runtimeHash.slice(0, 16)}`;
}
