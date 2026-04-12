# ERC-8004 Hackathon — Sentinel v3

This document tracks every requirement of the ERC-8004 hackathon and how Sentinel v3 satisfies it.

---

## Agent Identity & Registration

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Register agent on ERC-8004 Agent Registry | Done | agentId=19 registered on Sepolia |
| ERC-721 NFT minted for agent | Done | Transfer event confirmed on registration |
| Agent wallet linked to registry | Done | `0x0f38EC46e5eb7A57cF5371cb259546DE0F896c0A` |
| Agent name & description on-chain | Done | "Sentinel", "Institutional SMC trading agent" |
| Capabilities declared | Done | `['trading', 'eip712-signing', 'risk-management', 'smc-order-block', 'sentiment-analysis', 'adaptive-learning']` |
| agentURI with metadata | Done | data URI with JSON metadata |
| Load identity from chain on startup | Done | `src/chain/identity.ts` — `loadIdentity()` |

**Registration script:** `npm run register` (`scripts/register-agent.ts`)

---

## Hackathon Vault

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Claim sandbox capital from vault | Done | `claimAllocation(19)` called on startup |
| Check `hasClaimed` before claiming | Done | Prevents double-claim revert |
| Capital used for paper trading | Done | Paper account initialised with $10,000, equity persisted across restarts |

**Vault address:** `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90`

---

## EIP-712 TradeIntent Signing

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Sign TradeIntents with EIP-712 | Done | `src/chain/eip712.ts` |
| Correct domain: name=`"RiskRouter"` | Done | Verified against contract |
| Correct domain: version=`"1"` | Done | Verified against contract |
| `verifyingContract` in domain | Done | `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC` |
| Correct TradeIntent struct fields | Done | `agentId, agentWallet, pair, action, amountUsdScaled, maxSlippageBps, nonce, deadline` |
| Strictly-increasing nonce | Done | BigInt nonce counter in `risk-router.ts` |
| 5-minute deadline window | Done | `deadline = now + 300s` |

---

## Risk Router Submission

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Submit TradeIntent to Risk Router | Done | `submitTradeIntent()` in `src/chain/risk-router.ts` |
| Submit after every fired signal | Done | Called in stage 5 of the pipeline |
| Submit even if Kraken fails | Done | Paper fallback — on-chain submission always fires |
| Parse `intentId` from `IntentSubmitted` event | Done | Event log parsing in `submitTradeIntent()` |
| Log intentId and tx hash | Done | `[AGENT] TradeIntent on-chain | intentId=0x... | tx=0x...` |

**Risk Router address:** `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC`

---

## On-Chain Checkpoints (Validation Registry)

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Save checkpoints per trade event | Done | `saveCheckpoint()` called in stage 6 and on close |
| EIP-712 signed checkpoints | Done | `signCheckpoint()` in `eip712.ts` |
| Attest checkpoint hash on-chain | Done | `postCheckpointOnChain()` in `identity.ts` |
| IPFS pinning via Pinata | Done | Checkpoint data pinned to IPFS |
| Tamper-evident hash chain | Done | Each checkpoint references prior hash; `npm run verify-checkpoints` validates chain |

---

## Reputation Registry

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Post reputation scores | Done | `postReputationScore()` in `risk-router.ts` |
| Score in basis points (0–10000) | Done | `scoreBps = score × 100` |
| Exposed via MCP tool | Done | `post_reputation_score` MCP tool |

**Reputation Registry address:** `0x423a9904e39537a9997fbaF0f220d79D7d545763`

---

## Trading Agent Requirements

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Autonomous signal generation | Done | 3 strategies every 60s across 8 symbols |
| 24/7 operation (crypto) | Done | No session filters, no kill zones |
| Multiple symbols | Done | BTCUSD, ETHUSD, SOLUSD, XMRUSD, ATOMUSD, LINKUSD, DOGEUSD, PEPEUSD |
| Risk management | Done | Position limits, drawdown, circuit breaker, trust-adjusted sizing |
| Paper trading support | Done | Full in-memory paper account with equity persistence |
| Live trading support | Done | Kraken REST API with HMAC-SHA512 auth |
| No pyramiding | Done | One position per symbol enforced |
| Mandate compliance | Done | `ALLOWED_ASSETS` whitelist + on-chain mandate evaluation |

---

## Advanced Agent Features

| Feature | Status | Implementation |
|---------|--------|----------------|
| Adaptive learning (CAGE) | Done | `src/strategy/adaptive-learning.ts` — adjusts SL, size, threshold from trade history |
| SAGE reflection engine | Done | `src/strategy/sage-engine.ts` — Groq/Gemini post-trade reflection |
| AI trade narratives | Done | `src/strategy/ai-reasoning.ts` — Claude→Groq→template chain |
| Execution simulation gate | Done | Veto trades with slippage > 120bps or net edge ≤ 0 |
| Trust scorecard | Done | 4-dimension score → tier → size factor |
| Equity persistence | Done | Survives restarts via `state.json` |
| Stop-out grace period | Done | 5-minute immunity to stop-loss checks on new positions |

---

## MCP / Observability

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| MCP server for external inspection | Done | 18 tools on port 3001 |
| Live dashboard | Done | PRISM React dashboard — [sentinel-v3-production.up.railway.app](https://sentinel-v3-production.up.railway.app) |
| Structured logging | Done | `LogEntry { time, level, logger, msg }` |
| Audit trail | Done | IPFS checkpoints for every trade event |
| Equity sparkline | Done | SVG chart in sidebar from checkpoint history |
| Governance pipeline visualisation | Done | 6-stage event-driven status driven by checkpoint event types |

---

## Leaderboard Strategy

The hackathon leaderboard ranks agents by:
1. **Number of TradeIntents submitted** to the Risk Router
2. **P&L performance** tracked on-chain by the Risk Router
3. **Reputation score** in the Reputation Registry

### How Sentinel maximises leaderboard position

- Signals fire every 60 seconds across **8 symbols** simultaneously
- Every signal submits a signed TradeIntent on-chain regardless of execution mode (paper or live)
- Paper mode allows continuous trading without requiring exchange API credentials
- 3 strategies independently evaluate every symbol — more coverage, more signals
- Adaptive learning improves win rate over time for better P&L
- SAGE reflection engine tunes ensemble weights for higher quality signals per regime

---

## Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| Risk Router | `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC` |
| Hackathon Vault | `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90` |
| Agent Registry | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` |
| Reputation Registry | `0x423a9904e39537a9997fbaF0f220d79D7d545763` |
| Validation Registry | `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1` |

## Agent Details

| Field | Value |
|-------|-------|
| agentId | 19 |
| wallet | `0x0f38EC46e5eb7A57cF5371cb259546DE0F896c0A` |
| network | Sepolia (chainId: 11155111) |
| dashboard | [sentinel-v3-production.up.railway.app](https://sentinel-v3-production.up.railway.app) |
