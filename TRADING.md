# Trading Strategies — Sentinel v3

Sentinel runs 3 strategies simultaneously on every cycle (every 60 seconds) for every configured symbol. Each strategy independently evaluates the last 200 candles and returns a signal with a confidence score. The ensemble picks the highest-confidence signal above `MIN_CONFIDENCE` (default 10%).

All strategies are **24/7 crypto native** — no session filters, no kill zones, no time restrictions. Parameters are tuned for altcoin volatility profiles.

---

## Regime Detection

**File:** `src/strategy/regime.ts`

Before any strategy runs, the regime detector classifies current market conditions using ADX, RSI, EMA slope, and ATR volatility.

| Regime | Condition | Strategy behaviour |
|--------|-----------|-------------------|
| `trending_up` | ADX ≥ 20, EMA20 > EMA50 | Momentum gets +confidence boost |
| `trending_down` | ADX ≥ 20, EMA20 < EMA50 | Momentum gets +confidence boost |
| `ranging` | ADX < 20 | Momentum suppressed entirely |
| `volatile` | ATR > 3% of price | Momentum −5% penalty, wider stops |

**ADX threshold:** 20 (lowered from 25 for altcoins which trend at lower ADX values)

---

## Strategy 1: Order Block (`order_block`)

**File:** `src/strategy/order-block.ts`

### What is an Order Block?
An Order Block (OB) is the last bearish candle before a bullish displacement (bullish OB) or the last bullish candle before a bearish displacement (bearish OB). Institutional players leave unfilled orders at these levels, causing price to return and react.

### Signal Logic
1. Detect order blocks in recent candles (displacement candle must be ≥ 2× ATR body)
2. Filter to valid OBs: strength ≥ 0.35, age ≤ 80 candles, ≤ 1 prior retest (altcoins often poke levels before reversing)
3. Current price inside or touching the OB zone (±0.5% tolerance — wider for crypto wicks)
4. RSI < 72 for buys, RSI > 28 for sells
5. BOS/CHoCH, FVG, and liquidity sweeps add confidence bonuses (not hard gates)

### Confidence Formula
```
base = 0.52
+ OB strength × 0.20      (strength = displacement / ATR)
+ 0.08 if BOS/CHoCH present
+ 0.08 if recent liquidity sweep into OB (stop hunt → reversal)
+ 0.06 if Fair Value Gap present inside OB
→ capped at 0.92
```

### Stop Loss / Take Profit
- **SL:** OB bottom − 0.75× ATR (buy) | OB top + 0.75× ATR (sell)
- **TP:** Price + 3× ATR (buy) | Price − 3× ATR (sell)
- **R:R:** 3:1 minimum

---

## Strategy 2: Engulfing at Key Level (`engulfing`)

**File:** `src/strategy/engulfing.ts`

### What is an Engulfing Pattern?
A bullish engulfing candle opens below the prior candle's close and closes above the prior candle's open, with a larger body. This signals a reversal of momentum. Bearish engulfing is the mirror image.

### Signal Logic
1. Detect engulfing on the last two closed candles
2. Engulfing body must be ≥ 40% of the candle range (ATR filter — avoids tiny-body engulfs)
3. Body ratio must be ≥ 1.2× the prior candle body
4. Price must be within 1.5% of a key level (OB or swing high/low)
5. RSI must not be overextended (< 65 for buys, > 35 for sells)

### Confidence Formula
```
base = 0.55
+ (body ratio − 1) × 0.10   (larger engulf = higher confidence)
+ 0.10 if at an OB level
→ capped at 0.82
```

### Stop Loss / Take Profit
- **SL:** Engulfing candle low − 0.5× ATR (buy) | high + 0.5× ATR (sell)
- **TP:** Price + 2.5× ATR (buy) | Price − 2.5× ATR (sell)

---

## Strategy 3: EMA Momentum (`momentum`)

**File:** `src/strategy/momentum.ts`

### What is EMA Momentum?
Uses EMA(20) vs EMA(50) separation and MACD histogram for trend confirmation. Fires on crossovers or trend continuations. Fully regime-aware — suppressed in ranging markets to avoid choppy signals.

### Regime Behaviour
- **Ranging:** Returns HOLD — momentum strategies perform poorly in range-bound conditions
- **Volatile:** Applies −5% confidence penalty, uses 2.5× ATR stop (wider to handle spikes)
- **Trending:** Normal confidence, standard stops

### Signal Logic
1. Compute EMA(20) and EMA(50)
2. Calculate separation: `(EMA20 − EMA50) / price`
3. Calculate 5-bar momentum: `(price − price[5 bars ago]) / price[5 bars ago]`
4. Require separation > 0.3% (raised from 0.05% to filter noise)
5. **Crossover:** EMA20 crosses EMA50 — valid standalone signal
6. **Continuation:** Separation > 0.3% + 5-bar momentum agrees + MACD histogram confirms direction
7. RSI < 80 for buys, RSI > 20 for sells (crypto-wide limits)

### Confidence Formula
```
sepStrength = min(|separation| / 0.003, 1.0)
momStrength = min(|momentum5| / 0.001, 1.0)
crossBonus  = 0.10 if crossover detected
macdBonus   = 0.05 if MACD histogram confirms direction

base = 0.45 + sepStrength × 0.20 + momStrength × 0.15 + crossBonus + macdBonus
volatile penalty: base − 0.05
→ capped at 0.85
```

### Stop Loss / Take Profit
- **SL:** Price − 2× ATR (buy, standard) | Price − 2.5× ATR (volatile regime)
- **TP:** Price + 3× ATR (buy) | Price − 3× ATR (sell)

---

## Ensemble Selection

**File:** `src/strategy/ensemble.ts`

All 3 strategies run every cycle for every symbol. The ensemble:

1. Collects all non-hold signals above `MIN_CONFIDENCE` (default 10%)
2. Applies **confluence boost** when strategies agree:
   - 2 strategies agree direction → +5% confidence
   - All 3 agree direction → +8% confidence
3. Returns all qualifying signals (the agent opens one position per symbol per cycle — highest confidence wins if multiple fire)

---

## Risk Management

**File:** `src/risk/manager.ts`

Every approved signal passes through the Risk Gate before execution:

| Check | Limit | Default |
|-------|-------|---------|
| Max open positions | 15 | `MAX_POSITIONS=15` |
| Max position size | 5% equity × trust factor | `MAX_POSITION_PCT=5` |
| Max daily loss | 3% equity | `MAX_DAILY_LOSS_PCT=3` |
| Max drawdown | 10% from peak | `MAX_DRAWDOWN_PCT=10` |
| Max hold time | 2 hours (auto-close) | hardcoded |
| Circuit breaker | 3 consecutive losses | hardcoded |
| No pyramid | One position per symbol | hardcoded |
| Stop grace period | No stop-loss checks for first 5 min | hardcoded |

### Position Sizing (ATR-based)
```
ATR_distance = |signal.price − signal.stopLoss|
size = (equity × maxPositionPct × trustFactor) / (ATR_distance × 2)
cap  = (equity × maxPositionPct × trustFactor) / signal.price
```

### Trust-Adjusted Sizing
The trust scorecard (4 dimensions: accuracy, compliance, data quality, SAGE confidence) produces a tier and size factor applied to all position sizes:

| Tier | Size Factor |
|------|-------------|
| Elite | 1.00 |
| Elevated | 0.80 |
| Standard | 0.60 |
| Limited | 0.40 |
| Probation | 0.25 |

### Stop Grace Period
Newly opened positions are immune to stop-loss triggers for the first **5 minutes**. This prevents the live ticker price (used for close checks) from immediately breaching the stop set against the candle close price (used for entry). Take-profit and max-hold-time still fire immediately.

### Trailing Stop
Once a position is profitable by ≥ 0.5%, the stop trails upward (buy) or downward (sell) by 2× ATR from the high-water mark.

---

## Adaptive Learning (CAGE)

**File:** `src/strategy/adaptive-learning.ts`

The agent self-improves within immutable CAGE (Constrained Adaptive Generative Engine) bounds. It cannot change risk limits or disable safety checks — only tune 3 parameters within pre-approved ranges.

### What It Adjusts

| Parameter | Trigger | Adjustment | Bounds |
|-----------|---------|------------|--------|
| SL ATR multiple | Stop-hit rate > 60% | Widen stops +5% | 1.0× – 2.5× |
| SL ATR multiple | Stop-hit rate < 20% | Tighten stops −5% | 1.0× – 2.5× |
| Position size % | Win rate > 55% | Increase +2.5% | 1% – 4% equity |
| Position size % | Win rate < 35% | Decrease −5% | 1% – 4% equity |
| Confidence threshold | False signal rate > 50% | Raise +2% | 5% – 30% |
| Confidence threshold | False signal rate < 25% | Lower −1% | 5% – 30% |

### Bayesian Context Memory
For each regime + direction combination, the engine tracks a posterior win rate. When evaluating new signals, it applies a small confidence bias (±12% max) based on historical performance in the same context. After 5+ samples, the bias activates.

### How It Activates
- Requires **10 closed trades minimum** before first adaptation
- Cooldown of **5 cycles** between adaptations (prevents over-fitting)
- Every adaptation produces an auditable artifact logged to the dashboard

---

## SAGE Engine

**File:** `src/strategy/sage-engine.ts`

Self-Adapting Generative Engine: after every trade, SAGE calls Groq (with Gemini as primary, Groq as fallback) to reflect on recent performance and generate adaptive playbook rules. These rules adjust ensemble strategy weights for the next cycle.

---

## AI Reasoning (Groq Narratives)

**File:** `src/strategy/ai-reasoning.ts`

After every trade opens, the agent generates a human-readable trade narrative:
1. Tries Claude (Anthropic API)
2. Falls back to Groq (~600ms latency)
3. Falls back to template if both unavailable

Narratives appear in the dashboard Narrative Card and are saved to each checkpoint.

---

## Execution Simulation Gate

**File:** `src/chain/execution-simulator.ts`

Before every trade executes, a simulation estimates:
- **Slippage** in basis points (model: base + volatility premium + size impact)
- **Net edge** = signal confidence − estimated slippage cost

Veto conditions:
- Slippage > 120 bps → VETO
- Net edge ≤ 0 → VETO

---

## Supported Symbols

Default: `BTCUSD, ETHUSD, SOLUSD, XMRUSD, ATOMUSD, LINKUSD, DOGEUSD, PEPEUSD`

Configure via `TRADING_SYMBOLS` in `.env`. Mandate whitelist via `ALLOWED_ASSETS`. Any Kraken spot pair is supported.

---

## Execution Modes

| Mode | Behaviour |
|------|-----------|
| `paper` | Simulates orders in-memory, still submits TradeIntents on-chain |
| `live` | Places real orders on Kraken via REST API (requires API key with trade permission) |
| `disabled` | No orders placed, no on-chain submission |

Set via `EXECUTION_MODE` in `.env`.
