# MCP Server — Sentinel v3

Sentinel exposes a **Model Context Protocol (MCP)** server on port 3001. This allows any MCP-compatible LLM client (Claude, GPT, custom agent) to inspect and control the running agent in real time.

---

## Starting the MCP Server

The MCP server starts automatically with the agent:
```bash
npm run dev
# MCP available at http://localhost:3001
```

Or standalone:
```bash
npm run mcp
```

---

## Connecting from Claude Code

Add to your `.claude/settings.json` or use the Claude Code MCP config:

```json
{
  "mcpServers": {
    "sentinel": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

---

## Available Tools (18 total)

### Agent Status & Control

#### `get_agent_status`
Returns full agent state including identity, mode, cycle count, last trade, and vault info.

```json
// Response
{
  "agentId": 57,
  "mode": "paper",
  "cycle": 412,
  "symbols": ["BTCUSD", "ETHUSD", "SOLUSD", "DOGEUSD", "LINKUSD"],
  "lastTradeAt": "2026-04-10T10:29:09.000Z",
  "halted": false,
  "vaultCapital": "0.001"
}
```

#### `halt_agent`
Emergency halt — stops all new trade execution immediately.
```json
{ "reason": "Manual halt for review" }
```

#### `resume_agent`
Resume agent after halt.

#### `get_agent_identity`
Returns ERC-8004 on-chain identity: agentId, wallet, active status, registration date.

---

### Signals & Strategies

#### `get_recent_signals`
Returns the last N signals per strategy across all symbols.
```json
// Input
{ "limit": 10 }

// Response
[
  {
    "symbol": "BTCUSD",
    "strategy": "momentum",
    "direction": "sell",
    "confidence": 0.56,
    "price": 71733.2,
    "reasoning": "[MOMENTUM SELL] Trend continuation sep=-0.08% mom5=-0.05% RSI=48.2",
    "timestamp": "2026-04-10T10:29:09.000Z"
  }
]
```

#### `get_strategy_scores`
Returns current confidence scores for all 3 strategies across all symbols (same as the log line `order_block=0%(hold) | engulfing=82%(sell) | momentum=0%(hold)`).

---

### Positions & Trades

#### `get_open_positions`
Returns all currently open positions with unrealized P&L.
```json
[
  {
    "id": 1,
    "symbol": "BTCUSD",
    "side": "sell",
    "size": 0.00697,
    "entryPrice": 71733.2,
    "stopLoss": 72876.4,
    "takeProfit": 70019.6,
    "strategy": "momentum",
    "openedAt": "2026-04-10T10:29:09.000Z",
    "unrealizedPnl": -12.4
  }
]
```

#### `get_trade_history`
Returns closed trades log with P&L, strategy, and duration.

#### `get_performance_summary`
Returns win rate, total P&L, Sharpe ratio approximation, max drawdown reached.

---

### Risk & Circuit Breaker

#### `get_risk_metrics`
Returns live risk state.
```json
{
  "equity": 10000.00,
  "peakEquity": 10000.00,
  "drawdown": 0.0,
  "dailyPnl": -24.5,
  "openPositions": 3,
  "totalExposure": 1500.00,
  "status": "normal",
  "circuitBreaker": {
    "tripped": false,
    "consecutiveLosses": 1
  }
}
```

#### `get_circuit_breaker_state`
Returns circuit breaker details: tripped, consecutive losses, cooldown remaining.

#### `reset_circuit_breaker`
Manually reset a tripped circuit breaker (use with caution).

---

### On-Chain

#### `get_on_chain_summary`
Returns ERC-8004 on-chain status: agentId, vault balance, last TradeIntent hash, reputation score.

#### `get_checkpoint_history`
Returns recent IPFS checkpoints with CID, event type, and data hash.

#### `post_reputation_score`
Manually post a reputation score to the Reputation Registry.
```json
{ "score": 0.85, "reason": "Consistent profitable signals" }
```

---

### Market Data

#### `get_market_snapshot`
Returns current prices and 24h changes for all tracked symbols.

#### `get_sentiment`
Returns current sentiment composite score and sources (Fear & Greed index, funding rate proxy).
```json
{
  "composite": -0.44,
  "sources": ["fear_greed", "funding_proxy"],
  "fearGreed": 28,
  "fundingProxy": -0.62
}
```

---

### Logs & Diagnostics

#### `get_recent_logs`
Returns the last N structured log entries.
```json
// Input
{ "limit": 50, "level": "warn" }

// Response
[
  {
    "time": "2026-04-10T10:29:10.000Z",
    "level": "WARN",
    "logger": "ROUTER",
    "msg": "Submit failed: missing revert data..."
  }
]
```

#### `get_error_logs`
Returns only ERROR-level log entries — useful for quick diagnostics.

---

## MCP Server Implementation

**File:** `src/mcp/server.ts`

The server uses a lightweight HTTP + JSON-RPC transport. Each tool corresponds to a handler that reads live agent state from in-memory singletons (RiskManager, TradeLog, CheckpointStore) and returns structured JSON.

The server is stateless from the client's perspective — every tool call reflects the current live state of the running agent.

---

## Example: Using from Claude Code

```
You: What signals has the agent fired in the last 10 minutes?
Claude: [calls get_recent_signals] → shows SOLUSD engulfing 82% sell, BTCUSD momentum 56% sell

You: What's the current risk state?
Claude: [calls get_risk_metrics] → equity=$10,024.50, drawdown=0.2%, 3 open positions

You: Halt the agent, something looks wrong
Claude: [calls halt_agent with reason="User requested review"] → agent stops taking new trades
```

---

## Port Configuration

```env
MCP_PORT=3001          # Default MCP server port
DASHBOARD_PORT=3000    # Default dashboard port
```

Both can be changed in `.env`.
