# Trading Strategies — Sentinel v3

Sentinel runs 3 strategies simultaneously on every cycle (every 60 seconds) across all configured symbols. Each strategy independently evaluates the last 200 candles and returns a signal with a confidence score. The ensemble picks the highest-confidence signal above the minimum threshold (default 10%), with a confluence bonus applied when multiple strategies agree on direction.

All strategies are **24/7 crypto-native** — no session filters, no kill zones, no time restrictions. Parameters are tuned for the volatility profiles of mid-cap and large-cap crypto assets.

---

## Regime Detection

**File:** `src/strategy/regime.ts`

Before any strategy runs, the regime detector classifies current market conditions using ADX, RSI, EMA slope, and ATR volatility. The regime label is passed to all strategies and affects their confidence scoring and stop placement.

| Regime | Condition | Effect on strategies |
|--------|-----------|----------------------|
| `trending_up` | ADX ≥ 20, EMA20 > EMA50 | Momentum receives +confidence boost |
| `trending_down` | ADX ≥ 20, EMA20 < EMA50 | Momentum receives +confidence boost |
| `ranging` | ADX < 20 | Momentum returns HOLD (suppressed entirely) |
| `volatile` | ATR > 3% of price | Momentum −5% penalty, all strategies use wider stops |

ADX threshold is set at 20 (vs the traditional 25) because crypto assets tend to show sustained directional moves at lower ADX values than traditional markets.

---

## Strategy 1: Order Block (`order_block`)

**File:** `src/strategy/order-block.ts`

### What is an Order Block?

An Order Block (OB) is the last bearish candle before a bullish displacement (bullish OB), or the last bullish candle before a bearish displacement (bearish OB). Institutional players leave unfilled orders at these levels; when price returns to retest the zone, a reaction is expected. This is a core ICT/SMC (Inner Circle Trader / Smart Money Concepts) technique.

### Signal Logic

1. Scan recent candles to detect order blocks — displacement candle must be ≥ 2× ATR body to qualify
2. Filter to valid OBs: strength ≥ 0.35, age ≤ 80 candles, ≤ 1 prior retest (crypto often retests before reversing)
3. Current price must be inside or touching the OB zone (±0.5% tolerance — wider for crypto wicks)
4. RSI < 72 for buys, RSI > 28 for sells (prevents entries into overextended momentum)
5. BOS/CHoCH, FVG, and liquidity sweeps add confidence bonuses — they are not hard gates

### Confidence Formula

```
base = 0.52
+ OB strength × 0.20      (strength = displacement body / ATR)
+ 0.08 if BOS/CHoCH present (break of structure / change of character)
+ 0.08 if recent liquidity sweep into OB (stop hunt → reversal setup)
+ 0.06 if Fair Value Gap present inside OB zone
→ capped at 0.92
```

### Stop Loss / Take Profit

- **Buy SL:** OB bottom − 0.75× ATR
- **Buy TP:** Entry price + 3× ATR
- **Sell SL:** OB top + 0.75× ATR
- **Sell TP:** Entry price − 3× ATR
- **Minimum R:R:** 3:1

---

## Strategy 2: Engulfing at Key Level (`engulfing`)

**File:** `src/strategy/engulfing.ts`

### What is an Engulfing Pattern?

A bullish engulfing candle opens below the prior candle's close and closes above the prior candle's open, fully engulfing the prior body. This signals a shift in order flow from sellers to buyers. A bearish engulfing is the mirror. Engulfing signals are only taken at key levels — swing highs/lows or order block zones — to filter low-quality patterns in open space.

### Signal Logic

1. Detect engulfing on the last two closed candles
2. Engulfing body must be ≥ 40% of the candle's total range (ATR filter — avoids tiny-body false signals)
3. Body ratio must be ≥ 1.2× the prior candle body (ensures the engulf is meaningful in size)
4. Price must be within 1.5% of a key level (order block zone or recent swing high/low)
5. RSI must not be overextended: < 65 for buys, > 35 for sells

### Confidence Formula

```
base = 0.55
+ (body ratio − 1.0) × 0.10   (larger engulf body = higher confidence)
+ 0.10 if occurring at an order block level
→ capped at 0.82
```

### Stop Loss / Take Profit

- **Buy SL:** Engulfing candle low − 0.5× ATR
- **Buy TP:** Entry price + 2.5× ATR
- **Sell SL:** Engulfing candle high + 0.5× ATR
- **Sell TP:** Entry price − 2.5× ATR

---

## Strategy 3: EMA Momentum (`momentum`)

**File:** `src/strategy/momentum.ts`

### What is EMA Momentum?

Uses the separation between EMA(20) and EMA(50) combined with MACD histogram for trend confirmation. Fires on crossovers or trend continuation setups. This strategy is fully regime-aware and is completely suppressed in ranging markets to prevent trading noise.

### Regime Behaviour

| Regime | Behaviour |
|--------|-----------|
| `ranging` | Returns HOLD — suppressed entirely |
| `volatile` | −5% confidence penalty, uses 2.5× ATR stop (wider for spike handling) |
| `trending_up` / `trending_down` | Normal confidence, standard stops |

### Signal Logic

1. Compute EMA(20) and EMA(50)
2. Calculate EMA separation: `(EMA20 − EMA50) / price`
3. Calculate 5-bar momentum: `(price − price[5 bars ago]) / price[5 bars ago]`
4. Require separation > 0.3% to filter noise in sideways chop
5. **Crossover signal:** EMA20 crosses EMA50 — valid as a standalone signal
6. **Continuation signal:** Separation > 0.3% + 5-bar momentum agrees direction + MACD histogram confirms
7. RSI < 80 for buys, RSI > 20 for sells (wide crypto limits)

### Confidence Formula

```
sepStrength = min(|separation| / 0.003, 1.0)
momStrength = min(|momentum5|  / 0.001, 1.0)
crossBonus  = 0.10 if EMA crossover detected
macdBonus   = 0.05 if MACD histogram confirms direction

base = 0.45 + sepStrength × 0.20 + momStrength × 0.15 + crossBonus + macdBonus
volatile penalty: base − 0.05
→ capped at 0.85
```

### Stop Loss / Take Profit

- **Buy SL (standard):** Price − 2.0× ATR
- **Buy SL (volatile):** Price − 2.5× ATR
- **Buy TP:** Price + 3× ATR
- **Sell TP:** Price − 3× ATR

---

## Ensemble Selection

**File:** `src/strategy/ensemble.ts`

All 3 strategies evaluate every symbol every cycle. The ensemble:

1. Collects all non-hold signals above `MIN_CONFIDENCE` (default 10%)
2. Applies a confluence boost when strategies agree on direction:
   - 2 strategies agree → +5% confidence to the leading signal
   - All 3 strategies agree → +8% confidence to the leading signal
3. Returns the single highest-confidence qualifying signal per symbol (one position per symbol enforced by the risk gate)

Strategy weights can be adjusted by the SAGE engine between cycles based on recent performance per regime.

---

## Risk Management

**File:** `src/risk/manager.ts`

Every approved signal passes through the risk gate before any order is placed or TradeIntent submitted.

| Check | Default | Config |
|-------|---------|--------|
| Max open positions | 5 | `MAX_POSITIONS` |
| Max position size | 5% equity × trust factor | `MAX_POSITION_PCT` |
| Max daily loss | 3% equity | `MAX_DAILY_LOSS_PCT` |
| Max drawdown | 10% from peak | `MAX_DRAWDOWN_PCT` |
| Max hold time | 2 hours (auto-close) | hardcoded |
| Circuit breaker | 3 consecutive losses | hardcoded |
| No pyramid | One position per symbol | hardcoded |
| Stop grace period | 5 minutes immunity on new positions | hardcoded |

### ATR-Based Position Sizing

```
ATR_distance = |signal.price − signal.stopLoss|
size = (equity × maxPositionPct × trustFactor) / (ATR_distance × 2)
cap  = (equity × maxPositionPct × trustFactor) / signal.price
final_size = min(size, cap)
```

### Trust-Adjusted Sizing

The trust scorecard evaluates 4 dimensions — accuracy, compliance, data quality, and SAGE confidence — to produce a tier and size factor:

| Tier | Size Factor | Description |
|------|-------------|-------------|
| Elite | 1.00 | Full size — consistent performance |
| Elevated | 0.80 | Slightly reduced — minor concerns |
| Standard | 0.60 | Default for new agents |
| Limited | 0.40 | Reduced — recent underperformance |
| Probation | 0.25 | Minimal — significant issues detected |

### Stop Grace Period

Newly opened positions are immune to stop-loss triggers for the first **5 minutes**. This prevents the live ticker price (used for close checks) from immediately breaching the stop set against the candle close price (used for entry). Take-profit and max-hold-time checks remain active from the moment the position opens.

### Trailing Stop

Once a position is profitable by ≥ 0.5%, the stop trails at 2× ATR from the high-water mark — upward for longs, downward for shorts.

---

## Adaptive Learning (CAGE)

**File:** `src/strategy/adaptive-learning.ts`

The agent self-improves within immutable CAGE (Constrained Adaptive Generative Engine) bounds. It cannot change risk limits or disable safety checks — it can only tune 3 parameters within pre-approved ranges, requiring a minimum of 10 closed trades before the first adaptation.

### What CAGE Adjusts

| Parameter | Trigger | Adjustment | Bounds |
|-----------|---------|------------|--------|
| SL ATR multiple | Stop-hit rate > 60% | Widen stops +5% | 1.0× – 2.5× |
| SL ATR multiple | Stop-hit rate < 20% | Tighten stops −5% | 1.0× – 2.5× |
| Position size % | Win rate > 55% | Increase size +2.5% | 1% – 4% equity |
| Position size % | Win rate < 35% | Decrease size −5% | 1% – 4% equity |
| Confidence threshold | False signal rate > 50% | Raise threshold +2% | 5% – 30% |
| Confidence threshold | False signal rate < 25% | Lower threshold −1% | 5% – 30% |

### Bayesian Context Memory

For each regime + direction combination (e.g., trending_up + buy), the engine tracks a posterior win rate across all observed trades in that context. When evaluating a new signal in the same context, it applies a confidence bias of up to ±12% once 5 or more samples have been recorded. This allows the agent to reflect historical performance in specific market conditions without overriding the primary strategy logic.

### Adaptation Rules

- Requires **10 closed trades minimum** before first adaptation
- **5-cycle cooldown** between adaptations prevents overfitting
- Every adaptation produces an auditable artifact logged to the dashboard Decision Log

---

## SAGE Engine

**File:** `src/strategy/sage-engine.ts`

The Self-Adapting Generative Engine runs after every closed trade. It calls Groq (with Gemini as primary) to reflect on recent performance and produce adaptive playbook rules. These rules adjust ensemble strategy weights for the following cycles and generate insight into why a particular strategy is outperforming or underperforming in the current regime.

---

## AI Trade Narratives

**File:** `src/strategy/ai-reasoning.ts`

After every trade opens, the agent generates a human-readable narrative explaining the rationale:

1. Tries Claude (Anthropic API) first
2. Falls back to Groq (fastest alternative, ~600ms latency)
3. Falls back to a deterministic template if both are unavailable

Narratives appear in the dashboard Narrative Card and are saved to the IPFS checkpoint for every trade event.

---

## Execution Simulation Gate

**File:** `src/chain/execution-simulator.ts`

Before every trade executes, a simulation estimates:
- **Slippage** in basis points: base spread + volatility premium + size impact
- **Net edge** = signal confidence − estimated slippage cost

Veto conditions:
- Slippage > 120 bps → VETO (too expensive to trade)
- Net edge ≤ 0 → VETO (no positive expectancy after costs)

---

## Supported Symbols

Default: `BTCUSD, ETHUSD, SOLUSD, XMRUSD, ATOMUSD, LINKUSD, DOGEUSD, PEPEUSD`

Configure via `TRADING_SYMBOLS` in `.env`. Mandate whitelist via `ALLOWED_ASSETS`. Any Kraken spot pair is supported.

---

## Execution Modes

| Mode | Behaviour |
|------|-----------|
| `paper` | Simulates orders in-memory; still submits TradeIntents on-chain |
| `live` | Places real orders on Kraken via REST API (requires API key with trade permission) |
| `disabled` | No orders placed, no on-chain submission |

Set via `EXECUTION_MODE` in `.env`.
