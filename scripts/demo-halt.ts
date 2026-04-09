/**
 * Demo: Force Halt + Checkpoint Audit Trail
 *
 * Simulates a circuit-breaker halt and verifies the checkpoint chain
 * records the halt event with a valid hash.
 *
 * Usage: npx tsx scripts/demo-halt.ts
 */

import 'dotenv/config';
import { loadCheckpointHistory, saveCheckpoint, verifyChain, getCheckpoints } from '../src/trust/checkpoint.js';
import { config } from '../src/agent/config.js';

async function main() {
  console.log('\n=== Sentinel v3 — Demo Halt ===\n');

  loadCheckpointHistory();
  const before = getCheckpoints().length;
  console.log(`Checkpoints before: ${before}`);

  // Emit a halt checkpoint
  const cp = await saveCheckpoint({
    eventType: 'halt',
    symbol: 'SYSTEM',
    agentId: config.agentId,
    signal: 'hold',
    data: { reason: 'demo_halt', triggered_by: 'scripts/demo-halt.ts', cycle: 0 },
  });

  console.log(`\nHalt checkpoint saved:`);
  console.log(`  ID        : #${cp.id}`);
  console.log(`  Timestamp : ${cp.timestamp}`);
  console.log(`  Hash      : ${cp.hash}`);
  console.log(`  Prev Hash : ${cp.prevHash}`);
  console.log(`  Signature : ${cp.signature ?? 'unsigned'}`);

  const result = verifyChain();
  console.log(`\nChain integrity: ${result.valid ? '✓ VALID' : '✗ BROKEN'}`);
  if (!result.valid) {
    for (const issue of result.issues) console.error(`  ${issue}`);
    process.exit(1);
  }

  console.log(`\nTotal checkpoints: ${getCheckpoints().length}`);
  process.exit(0);
}

main().catch(e => {
  console.error(`Error: ${e}`);
  process.exit(1);
});
