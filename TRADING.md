# Trading Strategies — Sentinel v3

Sentinel runs 3 strategies simultaneously on every cycle (every 60 seconds). Each strategy independently evaluates the last 200 candles and returns a signal with a confidence score. The ensemble picks the highest-confidence signal above `MIN_CONFIDENCE` (default 0.1).

All strategies are **24/7 crypto compatible** — no session restrictions, no kill zones, no time filters.

---

## Strategy 1: Order Block (`order_block`)

**File:** `src/strategy/order-block.ts`

### What is an Order Block?
An Order Block (OB) is the last bearish candle before a bullish displacement (bullish OB) or the last bullish candle before a bearish displacement (bearish OB). Institutional players leave unfilled orders at these levels, causing price to return and react.

### Signal Logic
1. Detect order blocks in the last 200 candles (displacement candle must be ≥ 2× ATR)
2. Filter to untouched OBs (price hasn't returned before — first retest only)
3. Current price must be inside or touching the OB zone (±0.1%)
4. Require recent BOS (Break of Structure) or CHoCH (Change of Character) in the same direction
5. Optional FVG (Fair Value Gap) inside the OB zone boosts confidence

### Confidence Formula
```
base = 0.60
+ OB strength × 0.20    (strength = displacement size / ATR)
+ 0.10 if FVG present
→ capped at 0.88
```

### Filters
- RSI < 60 for buys (not overbought)
- RSI > 40 for sells (not oversold)
- OB strength > 0.3

### Stop Loss / Take Profit
- **SL:** OB bottom − 0.5× ATR (buy) | OB top + 0.5× ATR (sell)
- **TP:** Price + 3× ATR (buy) | Price − 3× ATR (sell)

---

## Strategy 2: Engulfing at Key Level (`engulfing`)

**File:** `src/strategy/engulfing.ts`

### What is an Engulfing Pattern?
A bullish engulfing candle opens below the prior candle's close and closes above the prior candle's open, with a larger body. This signals a reversal of momentum. Bearish engulfing is the mirror.

### Signal Logic
1. Detect engulfing on the last two closed candles
2. Current candle body must be larger than the prior candle body
3. Price must be within 1.5% of a key level:
   - Near a bullish or bearish order block
   - Near a swing high (for bearish) or swing low (for bullish)
4. RSI must not be overextended

### Confidence Formula
```
base = 0.55
+ (body ratio − 1) × 0.10    (larger engulf = higher confidence)
+ 0.10 if at an OB level
→ capped at 0.82
```

### Filters
- RSI < 65 for buys
- RSI > 35 for sells
- Must be at a key level (OB or swing point within 1.5%)

### Stop Loss / Take Profit
- **SL:** Engulfing candle low − 0.5× ATR (buy) | high + 0.5× ATR (sell)
- **TP:** Price + 2.5× ATR (buy) | Price − 2.5× ATR (sell)

---

## Strategy 3: SMA Momentum (`momentum`)

**File:** `src/strategy/momentum.ts`

### What is SMA Momentum?
Uses a fast SMA(20) vs slow SMA(50) separation to detect trending conditions, firing on either:
- A **crossover** (immediate signal, highest confidence)
- **Trend continuation** when separation > 0.05% with 5-bar momentum alignment

This fires continuously in trending and ranging markets alike, making it the highest-frequency strategy.

### Signal Logic
1. Compute SMA(20) and SMA(50) using EMA at period boundaries
2. Calculate separation: `(SMA20 − SMA50) / price`
3. Calculate 5-bar momentum: `(price − price[5 bars ago]) / price[5 bars ago]`
4. **Crossover:** SMA20 crosses above/below SMA50
5. **Trend continuation:** separation > 0.05% AND 5-bar momentum agrees

### Confidence Formula
```
sepStrength  = min(|separation| / 0.003, 1.0)   # caps at 0.3% separation
momStrength  = min(|momentum5| / 0.001, 1.0)    # caps at 0.1% momentum
crossBonus   = 0.10 if crossover detected

confidence = min(0.85, 0.45 + sepStrength × 0.20 + momStrength × 0.15 + crossBonus)
```

### Filters
- RSI < 75 for buys (only blocks extreme overbought)
- RSI > 25 for sells (only blocks extreme oversold)

### Stop Loss / Take Profit
- **SL:** Price − 2× ATR (buy) | Price + 2× ATR (sell)
- **TP:** Price + 3× ATR (buy) | Price − 3× ATR (sell)

---

## Ensemble Selection

**File:** `src/strategy/ensemble.ts`

All 3 strategies run every cycle for every symbol. The ensemble:
1. Collects all non-hold signals
2. Returns all signals above `MIN_CONFIDENCE` threshold
3. Each symbol can fire at most one trade per cycle (highest confidence wins if multiple fire)

Signals below `MIN_CONFIDENCE` (default 10%) are treated as HOLD.

---

## Risk Management

**File:** `src/risk/manager.ts`

Every approved signal passes through the Risk Gate before execution:

| Check | Limit | Default |
|-------|-------|---------|
| Max open positions | 15 | `MAX_POSITIONS=15` |
| Max position size | 5% equity per trade | `MAX_POSITION_PCT=5` |
| Max daily loss | 3% equity | `MAX_DAILY_LOSS_PCT=3` |
| Max drawdown | 10% from peak | `MAX_DRAWDOWN_PCT=10` |
| Max hold time | 2 hours | hardcoded |
| Circuit breaker | 3 consecutive losses | hardcoded |

### Position Sizing
```
ATR-based:  size = (equity × maxPositionPct) / (ATR × 2)
Notional cap: size ≤ (equity × maxPositionPct) / price
```

### Auto-Close
Positions auto-close after **2 hours** if stop-loss or take-profit hasn't triggered. This prevents paper positions from filling the position limit indefinitely.

---

## Market Regime

**File:** `src/strategy/regime.ts`

The regime detector classifies market conditions each cycle:
- `trending_bull` / `trending_bear` — strong directional move
- `ranging` — low volatility, oscillating
- `volatile` — high ATR relative to recent average

Regime affects confidence modifiers applied by the ensemble but does not block signals.

---

## Indicators Reference

**File:** `src/strategy/indicators.ts`

| Function | Description |
|----------|-------------|
| `ema(closes, period)` | Exponential Moving Average |
| `rsiLast(closes, period)` | RSI (last value) |
| `atrLast(candles, period)` | Average True Range (last value) |
| `orderBlocks(candles, lookback)` | Detect bullish/bearish OBs |
| `structureBreaks(candles, swing)` | Detect BOS and CHoCH |
| `fairValueGaps(candles)` | Detect FVG (3-candle imbalance) |
| `swingHighs(candles, lookback)` | Boolean array of swing highs |
| `swingLows(candles, lookback)` | Boolean array of swing lows |
| `closes(candles)` | Extract close price array |

---

## Supported Symbols

Default: `BTCUSD, ETHUSD, SOLUSD, DOGEUSD, LINKUSD`

Configure via `TRADING_SYMBOLS` in `.env`. Any Kraken spot pair is supported.

---

## Execution Modes

| Mode | Behavior |
|------|----------|
| `paper` | Simulates orders in-memory, still submits TradeIntents on-chain |
| `live` | Places real orders on Kraken via REST API (requires API key with trade permission) |
| `disabled` | No orders placed, no on-chain submission |

Set via `EXECUTION_MODE` in `.env`.
