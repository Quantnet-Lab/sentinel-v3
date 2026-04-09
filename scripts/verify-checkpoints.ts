/**
 * Verify Checkpoint Chain Integrity
 *
 * Reads .sentinel/checkpoints.jsonl and verifies the SHA256 hash chain.
 * Exits 0 if valid, 1 if broken.
 *
 * Usage: npx tsx scripts/verify-checkpoints.ts
 */

import 'dotenv/config';
import { loadCheckpointHistory, verifyChain, getCheckpoints, getCheckpointStats } from '../src/trust/checkpoint.js';

loadCheckpointHistory();

const stats = getCheckpointStats();
const result = verifyChain();
const checkpoints = getCheckpoints();

console.log('\n=== Sentinel v3 — Checkpoint Verification ===\n');
console.log(`Total checkpoints : ${stats.total}`);
console.log(`Signed            : ${stats.signed}`);
console.log(`Unsigned          : ${stats.unsigned}`);
console.log('');
console.log('By type:');
for (const [k, v] of Object.entries(stats)) {
  if (!['total', 'signed', 'unsigned'].includes(k)) {
    console.log(`  ${k.padEnd(15)}: ${v}`);
  }
}
console.log('');

if (result.valid) {
  console.log('✓ Chain integrity: VALID');
  if (checkpoints.length > 0) {
    const last = checkpoints[checkpoints.length - 1];
    console.log(`  Latest checkpoint: #${last.id} @ ${last.timestamp}`);
    console.log(`  Latest hash:       ${last.hash}`);
  }
  process.exit(0);
} else {
  console.error(`✗ Chain integrity: BROKEN at checkpoint #${result.brokenAt}`);
  for (const issue of result.issues) {
    console.error(`  Issue: ${issue}`);
  }
  process.exit(1);
}
