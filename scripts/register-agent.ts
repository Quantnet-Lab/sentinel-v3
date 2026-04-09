/**
 * Register Agent On-Chain (ERC-8004)
 *
 * Deploys or retrieves the agent's identity from the Sepolia registry.
 * Saves the agentId to .sentinel/agent-id.json for future runs.
 *
 * Usage: npx tsx scripts/register-agent.ts
 */

import 'dotenv/config';
import { loadIdentity } from '../src/chain/identity.js';
import { config } from '../src/agent/config.js';

async function main() {
  console.log('\n=== Sentinel v3 — Agent Registration ===\n');
  console.log(`Name       : ${config.agentName}`);
  console.log(`Chain      : Sepolia (${config.chainId})`);
  console.log(`RPC        : ${config.rpcUrl}`);
  console.log(`Registry   : ${config.agentRegistryAddress}`);
  console.log('');

  const identity = await loadIdentity();

  console.log(`Agent ID   : ${identity.agentId ?? 'not set'}`);
  console.log(`Wallet     : ${identity.agentWallet || 'not set'}`);
  console.log(`Registered : ${identity.active ? 'YES' : 'NO'}`);
  console.log(`Age        : ${identity.identityAgeDays != null ? identity.identityAgeDays.toFixed(1) + ' days' : 'unknown'}`);
  console.log(`Chain mode : ${identity.chain}`);
  console.log(`Signing    : ${identity.signingEnabled ? 'enabled' : 'disabled (no private key)'}`);
  console.log('');

  if (!identity.active) {
    console.log('Agent is not registered on-chain.');
    console.log('To register, set AGENT_ID and PRIVATE_KEY in .env and ensure wallet has Sepolia ETH.');
  } else {
    console.log('✓ Agent identity verified on-chain.');
  }
}

main().catch(e => {
  console.error(`Error: ${e}`);
  process.exit(1);
});
