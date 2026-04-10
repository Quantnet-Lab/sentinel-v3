# Sentinel v3 — ERC-8004 Autonomous Trading Agent

Sentinel is a fully autonomous on-chain trading agent built for the ERC-8004 hackathon. It runs a 6-stage governance pipeline, signs TradeIntents with EIP-712, submits them to the Sepolia Risk Router, and records every decision to IPFS as a tamper-proof audit trail.

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
┌─────────────────────────────────────────────────────────┐
│                    Sentinel v3 Agent                     │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Oracle   │→ │ Signal   │→ │Sentiment │              │
│  │(Kraken)  │  │(3 strats)│  │(Fear/Fund│              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                    │                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Record   │← │ Execute  │← │Risk Gate │              │
│  │(IPFS/CP) │  │(Kraken)  │  │(Manager) │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                    │                     │
│              ERC-8004 Risk Router (Sepolia)              │
│              EIP-712 TradeIntent Submission              │
└─────────────────────────────────────────────────────────┘
```

### 6-Stage Pipeline

| Stage | Name | What it does |
|-------|------|--------------|
| 1 | **Oracle** | Fetches live 1-min candles from Kraken REST API |
| 2 | **Signal** | Runs 3 strategies (order_block, engulfing, momentum) |
| 3 | **Sentiment** | Checks Fear & Greed + funding rate proxy |
| 4 | **Risk Gate** | Position limits, drawdown, daily loss, circuit breaker |
| 5 | **Execute** | Places paper/live order on Kraken; submits EIP-712 TradeIntent on-chain |
| 6 | **Record** | Saves checkpoint to IPFS, logs to dashboard |

---

## Trading Strategies

See [TRADING.md](TRADING.md) for full details.

| Strategy | Signal | Min Confidence |
|----------|--------|----------------|
| Order Block | Price retests institutional OB zone + BOS confirmation | 60% |
| Engulfing | Engulfing candle at swing high/low or OB level | 55% |
| Momentum | SMA(20/50) crossover or 0.05% separation with momentum | 45% |

---

## On-Chain Setup (ERC-8004)

### Deployed Agent
- **agentId:** `57`
- **Wallet:** `0x51E8bf572a357f501aB3393f13183b9f7a6B0775`
- **Network:** Sepolia testnet

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
AGENT_ID=57                              # Set after running npm run register

# Kraken API (optional — paper mode works without it)
KRAKEN_API_KEY=...
KRAKEN_API_SECRET=...

# Execution
EXECUTION_MODE=paper                     # paper | live | disabled
TRADING_SYMBOLS=BTCUSD,ETHUSD,SOLUSD,DOGEUSD,LINKUSD
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

## MCP Server

The agent exposes an MCP (Model Context Protocol) server on port 3001 with 18 tools that let any LLM client inspect and control the agent in real time.

See [MCP.md](MCP.md) for full tool reference.

```bash
# Start MCP server standalone
npm run mcp
```

Key tools: `get_agent_status`, `get_open_positions`, `get_recent_signals`, `get_risk_metrics`, `halt_agent`, `resume_agent`, `get_recent_logs`

---

## Dashboard

Live dashboard at `http://localhost:3000`:

- **Signal Cards** — one card per strategy per fired signal
- **Pipeline Stages** — 6-stage visual progress bar per cycle
- **Open Positions** — live mark-to-market P&L
- **Risk Metrics** — equity, drawdown, daily P&L, circuit breaker state
- **Log Stream** — structured real-time log feed

---

## Scripts

```bash
npm run dev                  # Start agent (tsx)
npm run build                # Compile TypeScript
npm run start                # Run compiled build
npm run register             # Register agent on ERC-8004 (once)
npm run verify-checkpoints   # Verify IPFS checkpoint hashes
npm run demo-halt            # Demo emergency halt flow
```

---

## Project Structure

```
sentinel-v3/
├── src/
│   ├── agent/           # Core agent loop, config, logger, state, scheduler
│   │   ├── index.ts     # Main 6-stage pipeline
│   │   ├── config.ts    # All env var loading
│   │   ├── logger.ts    # Structured logger (LogEntry objects)
│   │   └── scheduler.ts # 60s cron loop
│   ├── strategy/        # Trading strategies
│   │   ├── ensemble.ts  # Runs all 3 strategies, picks best signal
│   │   ├── order-block.ts
│   │   ├── engulfing.ts
│   │   ├── momentum.ts
│   │   ├── indicators.ts # EMA, ATR, RSI, OB detection, FVG, BOS
│   │   └── types.ts
│   ├── chain/           # On-chain integrations
│   │   ├── eip712.ts    # EIP-712 signing (TradeIntent + Checkpoint)
│   │   ├── risk-router.ts # Risk Router submission, vault claim
│   │   └── identity.ts  # ERC-8004 agent identity loading
│   ├── risk/            # Risk management
│   │   ├── manager.ts   # Position sizing, SL/TP, 2h auto-close
│   │   ├── circuit-breaker.ts
│   │   └── volatility.ts
│   ├── data/            # Market data
│   │   ├── kraken-bridge.ts # REST API orders + paper mode
│   │   ├── oracle.ts    # Candle fetching
│   │   └── sentiment-feed.ts # Fear & Greed + funding proxy
│   ├── dashboard/       # Web UI
│   │   ├── server.ts
│   │   └── SentinelDashboard.jsx
│   └── mcp/             # MCP tool server
│       └── server.ts
├── scripts/
│   ├── register-agent.ts    # ERC-8004 registration + vault claim
│   └── verify-checkpoints.ts
├── docs/
│   ├── TRADING.md           # Strategy details
│   ├── MCP.md               # MCP tool reference
│   └── HACKATHON.md         # Hackathon checklist
├── agent-id.json        # Persisted agentId after registration
└── .env                 # Environment variables (git-ignored)
```

---

## License

MIT — Quantnet-Lab
