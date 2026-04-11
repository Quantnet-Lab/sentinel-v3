# Sentinel v3 — ERC-8004 Autonomous Trading Agent

Sentinel is a fully autonomous on-chain trading agent built for the ERC-8004 standard. It runs a 6-stage governance pipeline per symbol, signs TradeIntents with EIP-712, submits them to the Sepolia Risk Router, and records every decision to IPFS as a tamper-proof audit trail. The agent learns from its own trade history via a bounded adaptive engine (CAGE).

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill environment variables
cp .env.example .env
# Edit .env — see Environment Variables section below

# 3. Register your agent on-chain (run once)
npm run register

# 4. Start the agent
npm run dev

# Dashboard: http://localhost:3000
# MCP server: http://localhost:3001
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Sentinel v3 Agent                       │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Oracle   │→ │ Signal   │→ │Sentiment │→ │ Risk Gate  │  │
│  │(Kraken)  │  │(3 strats)│  │(F&G/Fund)│  │(Manager)   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                    │         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ SAGE     │  │ Adaptive │  │ Record   │← │ Execute    │  │
│  │ Engine   │  │ Learning │  │(IPFS/CP) │  │(Kraken)    │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                              │
│            ERC-8004 Risk Router (Sepolia)                    │
│            EIP-712 TradeIntent Submission                    │
└─────────────────────────────────────────────────────────────┘
```

### 6-Stage Pipeline (per symbol, every cycle)

| Stage | Name | What it does |
|-------|------|--------------|
| 1 | **Oracle** | Fetches live 1-min candles from Kraken REST + data integrity check |
| 2 | **Signal** | Runs 3 strategies (order_block, engulfing, momentum) via ensemble |
| 3 | **Sentiment** | Fear & Greed + funding rate proxy adjusts confidence |
| 4 | **Risk Gate** | Mandate check, position limits, drawdown, daily loss, circuit breaker, execution simulation |
| 5 | **Execute** | Places paper/live order on Kraken; submits EIP-712 TradeIntent on-chain |
| 6 | **Record** | Saves tamper-evident checkpoint to IPFS, logs to dashboard |

---

## Trading Strategies

See [TRADING.md](TRADING.md) for full details.

| Strategy | Signal | Confidence Range |
|----------|--------|-----------------|
| Order Block | Price retests institutional OB zone, optional BOS/FVG/sweep bonuses | 52–92% |
| Engulfing | Engulfing candle at swing high/low with ATR body filter | 55–82% |
| Momentum | EMA(20/50) crossover + MACD confirmation, regime-aware | 45–85% |

### Ensemble
All 3 run every cycle per symbol. Confluence bonus applied when 2+ strategies agree direction (+5%) or all 3 agree (+8%). Highest-confidence signal above `MIN_CONFIDENCE` wins.

### Adaptive Learning (CAGE)
After every 10 trades, the agent adjusts 3 parameters within hard bounds:
- **SL ATR multiple** — widens if stop-hit rate > 60%, tightens if < 20% (bounds: 1.0–2.5)
- **Position size %** — shrinks on win rate < 35%, grows on > 55% (bounds: 1–4% equity)
- **Confidence threshold** — raises if false signal rate > 50% (bounds: 5–30%)

### SAGE Engine
Self-Adapting Generative Engine: runs a Groq/Gemini reflection after each trade, produces adaptive playbook rules that adjust ensemble weights.

---

## On-Chain Setup (ERC-8004)

### Deployed Agent
- **agentId:** `19`
- **Wallet:** `0x51E8bf572a357f501aB3393f13183b9f7a6B0775`
- **Network:** Sepolia testnet
- **Age:** ~5 days active

### Contracts

| Contract | Address |
|----------|---------|
| Risk Router | `0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC` |
| Hackathon Vault | `0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90` |
| Agent Registry | `0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3` |
| Reputation Registry | `0x423a9904e39537a9997fbaF0f220d79D7d545763` |
| Validation Registry | `0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1` |

### Registration (one-time)

```bash
npm run register
# Registers agent on ERC-8004 registry (mints ERC-721 NFT)
# Claims hackathon vault sandbox capital
# Saves agentId to agent-id.json
```

---

## Environment Variables

```env
# Wallet (Sepolia)
PRIVATE_KEY=0x...                        # Your Sepolia wallet private key

# Network
RPC_URL=https://1rpc.io/sepolia
CHAIN_ID=11155111

# ERC-8004 Contracts (pre-filled for hackathon)
AGENT_REGISTRY_ADDRESS=0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3
HACKATHON_VAULT_ADDRESS=0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90
RISK_ROUTER_ADDRESS=0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC
REPUTATION_REGISTRY_ADDRESS=0x423a9904e39537a9997fbaF0f220d79D7d545763
AGENT_ID=19                              # Set after running npm run register

# Kraken API (optional — paper mode works without it)
KRAKEN_API_KEY=...
KRAKEN_API_SECRET=...

# AI / Reasoning
GROQ_API_KEY=...                         # Groq API key (narrative + SAGE fallback)
ANTHROPIC_API_KEY=...                    # Optional — primary AI reasoning chain

# Execution
EXECUTION_MODE=paper                     # paper | live | disabled
TRADING_SYMBOLS=BTCUSD,ETHUSD,SOLUSD,XMRUSD,ATOMUSD,LINKUSD,DOGEUSD,PEPEUSD
ALLOWED_ASSETS=BTC,ETH,SOL,XMR,ATOM,LINK,DOGE,PEPE   # Mandate whitelist
CANDLE_INTERVAL=1                        # minutes
MIN_CONFIDENCE=0.1                       # 0.0–1.0

# Risk limits
MAX_POSITIONS=15
MAX_POSITION_PCT=5                       # % of equity per position
MAX_DAILY_LOSS_PCT=3
MAX_DRAWDOWN_PCT=10

# Dashboard
DASHBOARD_PORT=3000
MCP_PORT=3001
```

---

## Dashboard (PRISM)

Live dashboard at `http://localhost:3000`:

- **Sidebar** — equity hero with sparkline graph, trust tier gradient card, dimension bars, SAGE status
- **Hero Cards** — open positions, win rate, drawdown, uptime
- **Signals Feed** — per-symbol strategy scores with symbol picker
- **Narrative Card** — AI-generated trade rationale via Groq
- **Positions Table** — live mark-to-market P&L with size, trust tier, slippage
- **Governance Pipeline** — 6-stage visual driven by last checkpoint event type
- **Decision Log** — IPFS checkpoint chain with integrity verification
- **System Logs** — structured real-time feed with level badges (ERROR/WARN/INFO)

---

## MCP Server

The agent exposes an MCP (Model Context Protocol) server on port 3001 with 18 tools.

See [MCP.md](MCP.md) for full tool reference.

```bash
npm run mcp    # Start MCP server standalone
```

Key tools: `get_agent_status`, `get_open_positions`, `get_recent_signals`, `get_risk_metrics`, `halt_agent`, `resume_agent`, `get_recent_logs`, `get_adaptation_summary`

---

## Scripts

```bash
npm run dev                  # Start agent (tsx, hot reload)
npm run build                # Compile TypeScript
npm run start                # Run compiled build
npm run register             # Register agent on ERC-8004 (run once)
npm run verify-checkpoints   # Verify IPFS checkpoint hash chain
npm run demo-halt            # Demo emergency halt flow
```

---

## Project Structure

```
sentinel-v3/
├── src/
│   ├── agent/
│   │   ├── index.ts          # Main 6-stage pipeline + adaptive learning loop
│   │   ├── config.ts         # All env var loading + defaults
│   │   ├── logger.ts         # Structured logger {time,level,logger,msg}
│   │   ├── state.ts          # Cycle state, equity persistence
│   │   ├── scheduler.ts      # 60s cron loop
│   │   ├── trade-log.ts      # Closed trade records + stats
│   │   └── operator-control.ts # Pause/resume/halt controls
│   ├── strategy/
│   │   ├── ensemble.ts       # Runs all 3, confluence boost, picks best signal
│   │   ├── order-block.ts    # ICT/SMC order block retest strategy
│   │   ├── engulfing.ts      # Engulfing candle at key level
│   │   ├── momentum.ts       # EMA crossover + MACD, regime-aware
│   │   ├── regime.ts         # ADX + RSI + EMA slope regime classifier
│   │   ├── adaptive-learning.ts  # CAGE bounded self-improvement engine
│   │   ├── sage-engine.ts    # SAGE: Groq/Gemini reflection + playbook rules
│   │   ├── ai-reasoning.ts   # Claude→Groq→template narrative chain
│   │   ├── indicators.ts     # EMA, ATR, RSI, OB, FVG, BOS, sweeps
│   │   └── types.ts
│   ├── chain/
│   │   ├── eip712.ts         # EIP-712 signing (TradeIntent + Checkpoint)
│   │   ├── risk-router.ts    # Risk Router submission, vault claim
│   │   ├── identity.ts       # ERC-8004 agent identity loading
│   │   ├── agent-mandate.ts  # On-chain mandate evaluation (allowed assets)
│   │   └── execution-simulator.ts # Slippage + net edge simulation gate
│   ├── risk/
│   │   ├── manager.ts        # Position sizing, SL/TP, trailing stop, 2h auto-close
│   │   ├── circuit-breaker.ts
│   │   └── volatility.ts
│   ├── trust/
│   │   ├── checkpoint.ts     # IPFS tamper-evident checkpoint chain
│   │   ├── trust-scorecard.ts # 4-dimension trust score → tier → size factor
│   │   └── artifact-emitter.ts
│   ├── data/
│   │   ├── kraken-bridge.ts  # REST API orders + full paper account
│   │   ├── market.ts         # Candle + ticker fetching from Kraken
│   │   └── sentiment-feed.ts # Fear & Greed + funding rate proxy
│   ├── dashboard/
│   │   ├── server.ts         # Express API server (status, trades, logs, checkpoints)
│   │   ├── SentinelDashboard.jsx  # PRISM React UI (Babel in-browser)
│   │   └── public/index.html
│   ├── mcp/
│   │   └── server.ts         # MCP JSON-RPC tool server (18 tools)
│   ├── analytics/
│   │   └── performance-metrics.ts
│   └── security/
│       └── oracle-integrity.ts
├── scripts/
│   ├── register-agent.ts     # ERC-8004 registration + vault claim
│   └── verify-checkpoints.ts
├── agent-id.json             # Persisted agentId after registration
└── .env                      # Environment variables (git-ignored)
```

---

## License

MIT — Quantnet-Lab
