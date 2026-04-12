# Sentinel: Autonomous On-Chain Trading Agent

## Overview

Sentinel is an ERC-8004 compliant autonomous trading agent built for the hackathon on Ethereum Sepolia. The system executes institutional-grade crypto trades through a 6-stage governance pipeline that enforces trust, compliance, and risk controls before any position is opened. Every decision is signed with EIP-712, submitted to the on-chain Risk Router, and recorded to IPFS as a tamper-proof audit trail.

**Live Dashboard:** [https://sentinel-v3-production.up.railway.app](https://sentinel-v3-production.up.railway.app)

**Agent ID:** 87 | **Network:** Sepolia | **Wallet:** `0x0D1C6676825b13193E703cD7E31FbE3fA4b4A559`

---

## Core Architecture

The system implements a 6-stage governance pipeline that runs every 60 seconds across all configured symbols:

**Trading Pipeline Stages:**
1. Oracle — fetches live 1-minute candles from Kraken REST with data integrity verification
2. Signal — runs 3 independent strategies (Order Block, Engulfing, Momentum) via an ensemble with confluence scoring
3. Sentiment — Fear & Greed index and funding rate proxy adjust signal confidence up or down
4. Risk Gate — mandate check, position limits, drawdown guard, circuit breaker, and execution simulation veto
5. Execute — places paper or live order on Kraken; submits EIP-712 signed TradeIntent to the on-chain Risk Router
6. Record — saves tamper-evident checkpoint to IPFS and streams results to the live dashboard

---

## Trading Strategies

Sentinel runs three strategies simultaneously on every symbol every cycle. Each returns an independent confidence score; the ensemble picks the highest after applying a confluence bonus when strategies agree.

**Order Block (ICT/SMC):** Detects the last bearish candle before a bullish displacement (bullish OB) or vice versa. Prices retesting institutional order block zones with BOS, FVG, or liquidity sweep confirmation generate high-confidence signals. Confidence range: 52–92%.

**Engulfing at Key Level:** Identifies bullish or bearish engulfing candles at swing highs/lows and order block zones. Requires the engulfing body to be at least 40% of the candle range to filter weak signals. Confidence range: 55–82%.

**EMA Momentum:** Uses EMA(20) vs EMA(50) separation and MACD histogram for trend confirmation. Fully regime-aware — suppressed in ranging markets to avoid choppy signals, penalised in volatile regimes with wider stops. Confidence range: 45–85%.

**Ensemble Confluence:** When two strategies agree on direction, confidence receives a +5% bonus. When all three agree, +8%. The highest-confidence signal above the minimum threshold wins.

---

## Risk Management

Every signal must pass through the risk gate before execution. The gate enforces position limits (max 5 open), daily loss cap (3% equity), maximum drawdown (10% from peak), and a circuit breaker that halts trading after three consecutive losses.

**Trust-Adjusted Position Sizing:** A 4-dimension trust scorecard (accuracy, compliance, data quality, SAGE confidence) produces a tier from Probation to Elite, with a size factor of 0.25× to 1.00× applied to every position. The agent automatically trades smaller when its recent behaviour suggests reduced reliability.

**Execution Simulation Gate:** Before every order, a slippage model estimates notional cost in basis points. Trades are vetoed if estimated slippage exceeds 120 bps or if net edge after costs is zero or negative.

**Stop-Out Grace Period:** Newly opened positions are immune to stop-loss checks for the first 5 minutes, preventing immediate stop-outs caused by the divergence between candle close prices used for entry and live ticker prices used for close monitoring.

**Trailing Stop:** Once a position is profitable by 0.5% or more, the stop trails at 2× ATR from the high-water mark to lock in gains.

---

## Adaptive Learning (CAGE)

After every 10 closed trades, Sentinel adjusts three parameters within immutable hard bounds:

- **Stop-loss ATR multiple** — widens if stop-hit rate exceeds 60%, tightens below 20% (bounds: 1.0–2.5×)
- **Position size percentage** — shrinks if win rate falls below 35%, grows above 55% (bounds: 1–4% equity)
- **Confidence threshold** — raises if false signal rate exceeds 50%, lowers below 25% (bounds: 5–30%)

A 5-cycle cooldown between adaptations prevents overfitting. Every adaptation produces an auditable artifact visible in the dashboard Decision Log. A Bayesian context memory also tracks win rates per regime and direction, applying a small confidence bias (±12% max) to signals in well-sampled contexts.

---

## SAGE Reflection Engine

After every trade, the Self-Adapting Generative Engine calls Groq (Gemini as primary, Groq as fallback) to reflect on recent performance and generate conditional playbook rules. These rules adjust ensemble strategy weights for the next cycle. The engine uses language model reasoning to identify why specific strategies are outperforming or underperforming in the current regime and injects that context into the AI trade narrative.

---

## On-Chain Integration (ERC-8004)

Every signal — regardless of paper or live execution mode — produces an EIP-712 signed TradeIntent submitted to the Risk Router contract on Sepolia. This maintains a continuous on-chain activity record for the hackathon leaderboard. The agent claims sandbox capital from the Hackathon Vault on startup, verifies it has not double-claimed, and checks its on-chain mandate before trading any asset.

Checkpoints are EIP-712 signed, pinned to IPFS via Pinata, and form a hash chain where each checkpoint references the prior hash. The chain can be verified locally with `npm run verify-checkpoints`.

| Contract | Address |
|----------|---------|
| Risk Router | `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC` |
| Hackathon Vault | `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90` |
| Agent Registry | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` |
| Reputation Registry | `0x423a9904e39537a9997fbaF0f220d79D7d545763` |
| Validation Registry | `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1` |

---

## Dashboard (PRISM)

The live dashboard at [https://sentinel-v3-production.up.railway.app](https://sentinel-v3-production.up.railway.app) shows:

- **Equity hero** with real-time sparkline from checkpoint history
- **Trust tier card** with 4-dimension score bars and tier gradient
- **Hero metrics** — open positions, win rate, drawdown, uptime
- **Signal feed** — per-symbol strategy scores with symbol picker
- **AI narrative card** — Groq-generated trade rationale for the last signal
- **Positions table** — live mark-to-market P&L with size, trust tier, slippage
- **Governance pipeline** — 6-stage visual driven by last checkpoint event type
- **Decision log** — IPFS checkpoint chain with integrity status
- **System logs** — structured real-time feed with ERROR/WARN/INFO level badges

---

## MCP Server

The agent exposes a Model Context Protocol server on port 3001 with 18 tools. Any MCP-compatible LLM client can inspect and control the running agent in real time. Key tools: `get_agent_status`, `get_open_positions`, `get_recent_signals`, `get_risk_metrics`, `halt_agent`, `resume_agent`, `get_adaptation_summary`, `get_on_chain_summary`.

See [MCP.md](MCP.md) for the full tool reference.

---

## Quick Start

```bash
npm install
cp .env.example .env        # fill in PRIVATE_KEY, AGENT_ID, API keys
npm run dev                 # starts agent + dashboard (port 3000) + MCP (port 3001)
```

```bash
npm run register            # register agent on-chain (run once)
npm run verify-checkpoints  # verify IPFS checkpoint hash chain
npm run demo-halt           # demo emergency halt flow
```

---

## Technical Stack

Built with TypeScript and Node.js, ethers.js v6 for EIP-712 signing and Sepolia contract interaction, and Express for the dashboard and MCP API. Market data is sourced from Kraken REST for candles and tickers, with an Alternative.me Fear & Greed proxy and funding rate model for sentiment. IPFS artifact storage uses Pinata. The PRISM dashboard is a React app with Babel in-browser transpilation. The MCP server uses a lightweight HTTP + JSON-RPC transport that reads live agent state from in-memory singletons on every tool call.

---

## License

MIT — Quantnet-Lab
