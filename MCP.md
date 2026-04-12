# MCP Server — Sentinel v3

Sentinel exposes a **Model Context Protocol (MCP)** server on port 3001. Any MCP-compatible LLM client can inspect and control the running agent in real time using 18 structured tools. The server is stateless from the client's perspective — every tool call reflects the current live state of the agent at the moment of the call.

---

## Starting the MCP Server

The MCP server starts automatically with the agent:

```bash
npm run dev
# MCP available at http://localhost:3001/mcp
```

Or standalone:

```bash
npm run mcp
```

---

## Connecting from Claude Code

Add to your `.claude/settings.json`:

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
Returns full agent state: identity, mode, cycle count, symbols, last trade time, vault info, trust tier, and halt status.

```json
{
  "agentId": 19,
  "mode": "paper",
  "cycle": 546,
  "symbols": ["BTCUSD", "ETHUSD", "SOLUSD", "XMRUSD", "ATOMUSD", "LINKUSD", "DOGEUSD", "PEPEUSD"],
  "lastTradeAt": "2026-04-12T10:20:04.000Z",
  "halted": false,
  "equity": 9997.48
}
```

#### `halt_agent`
Emergency halt — stops all new trade execution immediately. Existing positions remain open.

```json
{ "reason": "Manual halt for review" }
```

#### `resume_agent`
Resume the agent after a halt.

#### `get_agent_identity`
Returns ERC-8004 on-chain identity: agentId, wallet, active status, registration timestamp, and declared capabilities.

---

### Signals & Strategies

#### `get_recent_signals`
Returns the last N signals per strategy across all symbols, including confidence, direction, price, and reasoning string.

```json
// Input
{ "limit": 10 }

// Response
[
  {
    "symbol": "BTCUSD",
    "strategy": "order_block",
    "direction": "buy",
    "confidence": 0.86,
    "price": 72758.9,
    "reasoning": "[ORDER BLOCK BUY] Bullish OB [72700,72760] str=0.72 BOS=true FVG=false sweep=false",
    "timestamp": "2026-04-12T10:20:03.000Z"
  }
]
```

#### `get_strategy_scores`
Returns current confidence scores for all 3 strategies across all configured symbols — the same data shown in the dashboard Signal Feed.

---

### Positions & Trades

#### `get_open_positions`
Returns all currently open positions with live mark-to-market P&L.

```json
[
  {
    "id": 3,
    "symbol": "BTCUSD",
    "side": "buy",
    "size": 0.006183,
    "entryPrice": 72758.9,
    "stopLoss": 72600.5,
    "takeProfit": 73800.4,
    "strategy": "order_block",
    "regime": "trending_up",
    "entryConfidence": 0.86,
    "openedAt": "2026-04-12T10:20:04.000Z",
    "unrealizedPnl": 12.4
  }
]
```

#### `get_trade_history`
Returns the closed trades log with P&L, strategy, duration, and exit reason for each trade.

#### `get_performance_summary`
Returns win rate, total P&L, Sharpe ratio approximation, and maximum drawdown reached.

---

### Risk & Circuit Breaker

#### `get_risk_metrics`
Returns live risk state including equity, drawdown, daily P&L, open position count, total exposure, and circuit breaker status.

```json
{
  "equity": 9997.48,
  "peakEquity": 10000.00,
  "drawdown": 0.003,
  "dailyPnl": -2.52,
  "openPositions": 4,
  "totalExposure": 650.00,
  "status": "normal",
  "circuitBreaker": {
    "tripped": false,
    "consecutiveLosses": 0
  }
}
```

#### `get_circuit_breaker_state`
Returns circuit breaker details: tripped status, consecutive loss count, and cooldown time remaining.

#### `reset_circuit_breaker`
Manually reset a tripped circuit breaker. Use with caution — the circuit breaker exists to prevent runaway losses after consecutive failures.

---

### Adaptive Learning

#### `get_adaptation_summary`
Returns current adaptive parameters, CAGE bounds, total outcomes recorded, total adaptations triggered, and the last adaptation artifact.

```json
{
  "currentParams": {
    "stopLossAtrMultiple": 1.58,
    "basePositionPct": 0.019,
    "confidenceThreshold": 0.12
  },
  "cage": {
    "stopLossAtrMultiple": { "min": 1.0, "max": 2.5, "default": 1.5 },
    "basePositionPct":     { "min": 0.01, "max": 0.04, "default": 0.02 },
    "confidenceThreshold": { "min": 0.05, "max": 0.30, "default": 0.10 }
  },
  "totalOutcomes": 12,
  "totalAdaptations": 1,
  "lastAdaptation": {
    "parameter": "stopLossAtrMultiple",
    "previousValue": 1.5,
    "newValue": 1.58,
    "trigger": "Stop-loss hit rate 65%",
    "reasoning": "Stops widened because hit rate (65%) exceeded acceptable threshold."
  }
}
```

---

### On-Chain

#### `get_on_chain_summary`
Returns ERC-8004 on-chain status: agentId, vault balance, last TradeIntent hash, and current reputation score.

#### `get_checkpoint_history`
Returns recent IPFS checkpoints with CID, event type, data hash, timestamp, and integrity verification status.

#### `post_reputation_score`
Manually post a reputation score to the Reputation Registry contract.

```json
{ "score": 0.85, "reason": "Consistent profitable signals" }
```

---

### Market Data

#### `get_market_snapshot`
Returns current prices and 24-hour changes for all tracked symbols.

#### `get_sentiment`
Returns the current sentiment composite score and its sources.

```json
{
  "composite": -0.53,
  "sources": ["fear_greed", "funding_proxy"],
  "fearGreed": 28,
  "fundingProxy": -0.62
}
```

---

### Logs & Diagnostics

#### `get_recent_logs`
Returns the last N structured log entries with time, level, logger, and message fields.

```json
// Input
{ "limit": 50, "errorsOnly": false }

// Response
[
  {
    "time": "2026-04-12T10:20:04.000Z",
    "level": "INFO",
    "logger": "AGENT",
    "msg": "[AGENT] Trade opened: BTCUSD BUY size=0.006183 @ 72758.9 | order_block | CP#761"
  }
]
```

#### `get_error_logs`
Returns only ERROR-level log entries — useful for quick diagnostics without filtering through INFO noise.

---

## Example Session

```
You: What signals fired in the last 10 minutes?
Claude: [calls get_recent_signals] → BTCUSD order_block 86% buy, ETHUSD engulfing 71% buy

You: What is the current risk state?
Claude: [calls get_risk_metrics] → equity=$9,997.48, drawdown=0.03%, 4 open positions, circuit breaker clear

You: Has the agent learned anything from its trades?
Claude: [calls get_adaptation_summary] → 12 outcomes recorded, SL multiple widened 1.5→1.58 after 65% stop-hit rate

You: Halt the agent, something looks wrong.
Claude: [calls halt_agent] → agent stops taking new trades immediately
```

---

## Implementation

**File:** `src/mcp/server.ts`

The server uses a lightweight HTTP + JSON-RPC transport. Each tool reads live agent state directly from in-memory singletons — RiskManager, TradeLog, CheckpointStore, AdaptiveLearning — and returns structured JSON. No caching, no stale data.
