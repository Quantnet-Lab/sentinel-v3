import React, { useState, useEffect, useRef, useCallback } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   SENTINEL v3  —  PRISM Dashboard
   Sidebar layout · Glassmorphism cards · Inter font · Indigo/violet accent
───────────────────────────────────────────────────────────────────────────── */

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:       "#0d0d14",
  surface:  "rgba(255,255,255,0.04)",
  surfaceHi:"rgba(255,255,255,0.07)",
  border:   "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.13)",
  text:     "#f1f5f9",
  textSec:  "#94a3b8",
  textMut:  "#475569",
  indigo:   "#6366f1",
  indigoDim:"rgba(99,102,241,0.15)",
  violet:   "#8b5cf6",
  violetDim:"rgba(139,92,246,0.12)",
  emerald:  "#10b981",
  emeraldDim:"rgba(16,185,129,0.10)",
  rose:     "#f43f5e",
  roseDim:  "rgba(244,63,94,0.10)",
  amber:    "#f59e0b",
  amberDim: "rgba(245,158,11,0.10)",
  sky:      "#38bdf8",
  skyDim:   "rgba(56,189,248,0.10)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const usd    = v => "$" + Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct    = (v, d = 1) => `${(v * 100).toFixed(d)}%`;
const num    = (v, d = 2) => Number(v ?? 0).toFixed(d);
const ago    = ms => {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - new Date(ms).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
};
const uptime = ms => {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const buyColor  = d => d === "buy"  || d === "BUY"  ? C.emerald : d === "sell" || d === "SELL" ? C.rose : C.textSec;
const tierColor = t => ({ elite: C.indigo, elevated: C.violet, standard: C.sky, limited: C.amber, probation: C.rose }[t] ?? C.textMut);
const tierGrad  = t => ({ elite: `linear-gradient(135deg,${C.indigo},${C.violet})`, elevated: `linear-gradient(135deg,${C.violet},${C.sky})`, standard: `linear-gradient(135deg,${C.sky},${C.emerald})`, limited: `linear-gradient(135deg,${C.amber},${C.rose})`, probation: `linear-gradient(135deg,${C.rose},#7f1d1d)` }[t] ?? C.surface);

// ── Base components ───────────────────────────────────────────────────────────
const Card = ({ children, style, onClick, hover }) => {
  const [h, setH] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setH(true)}
      onMouseLeave={() => hover && setH(false)}
      style={{
        background: h ? C.surfaceHi : C.surface,
        border: `1px solid ${h ? C.borderHi : C.border}`,
        borderRadius: 16, padding: 20,
        transition: "all 0.2s",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Label = ({ children, style }) => (
  <div style={{ fontSize: 11, fontWeight: 600, color: C.textMut, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, ...style }}>
    {children}
  </div>
);

const Pill = ({ children, color = C.indigo, style }) => (
  <span style={{
    display: "inline-flex", alignItems: "center",
    padding: "3px 10px", borderRadius: 999,
    fontSize: 11, fontWeight: 600,
    background: color + "20", color,
    border: `1px solid ${color}30`,
    ...style,
  }}>
    {children}
  </span>
);

const Dot = ({ color, pulse }) => (
  <span style={{
    display: "inline-block", width: 7, height: 7, borderRadius: "50%",
    background: color, flexShrink: 0,
    boxShadow: `0 0 6px ${color}80`,
    animation: pulse ? "pulse 1.8s infinite" : "none",
  }} />
);

const Bar = ({ value, color, height = 4 }) => (
  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.6s ease" }} />
  </div>
);

const Divider = () => <div style={{ height: 1, background: C.border, margin: "16px 0" }} />;

// ── Data hook ─────────────────────────────────────────────────────────────────
function useData() {
  const [status,  setStatus]  = useState(null);
  const [trades,  setTrades]  = useState({ trades: [], stats: {} });
  const [sage,    setSage]    = useState(null);
  const [logs,    setLogs]    = useState([]);
  const [checks,  setChecks]  = useState({ checkpoints: [], stats: {}, integrity: {} });

  const load = useCallback(async () => {
    const safe = async (url, fb) => { try { const r = await fetch(url); return r.ok ? r.json() : fb; } catch { return fb; } };
    const [s, t, sg, l, c] = await Promise.all([
      safe("/api/status", null),
      safe("/api/trades", { trades: [], stats: {} }),
      safe("/api/sage", null),
      safe("/api/logs?limit=60", []),
      safe("/api/checkpoints?limit=30", { checkpoints: [], stats: {}, integrity: {} }),
    ]);
    if (s) setStatus(s);
    setTrades(t);
    if (sg) setSage(sg);
    setLogs(l);
    setChecks(c);
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);
  return { status, trades, sage, logs, checks };
}

// ── Equity sparkline ──────────────────────────────────────────────────────────
function EquitySparkline({ checks, equity }) {
  const points = (checks?.checkpoints ?? [])
    .filter(cp => cp.data?.equity != null)
    .map(cp => cp.data.equity)
    .slice(-40);
  // Append current equity so the line always ends at the live value
  if (equity != null) points.push(equity);
  if (points.length < 2) return null;

  const W = 212, H = 44;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map(v => H - ((v - min) / range) * H);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const fill = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
    + ` L ${W} ${H} L 0 ${H} Z`;
  const isUp = points[points.length - 1] >= points[0];
  const col  = isUp ? C.emerald : C.rose;

  return (
    <svg width={W} height={H} style={{ display: "block", marginTop: 10, overflow: "visible" }}>
      <defs>
        <linearGradient id="spkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={col} stopOpacity="0.25" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#spkGrad)" />
      <path d={d} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={col} />
    </svg>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function Sidebar({ status, trades, sage, checks }) {
  const trust   = status?.trust ?? {};
  const metrics = status?.riskMetrics ?? {};
  const hb      = status?.heartbeat ?? {};
  const tier    = trust.tier ?? "probation";
  const score   = (trust.overall ?? 0) * 100;
  const sf      = (trust.sizeFactor ?? 0) * 100;
  const equity  = metrics.equity ?? 0;
  const init    = status?.initialCapital ?? 10000;
  const pnlAll  = equity - init;
  const pnlPct  = init > 0 ? pnlAll / init : 0;
  const isUp    = pnlAll >= 0;

  return (
    <div style={{
      width: 256, flexShrink: 0, display: "flex", flexDirection: "column", gap: 12,
      height: "100vh", overflowY: "auto", padding: "16px 12px",
      borderRight: `1px solid ${C.border}`, background: "rgba(0,0,0,0.25)",
      position: "sticky", top: 0,
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 12px" }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, color: "#fff",
          boxShadow: "0 4px 12px rgba(99,102,241,0.4)",
        }}>S</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: "0.04em" }}>SENTINEL</div>
          <div style={{ fontSize: 10, color: C.textMut, fontWeight: 500 }}>v3 · ERC-8004</div>
        </div>
      </div>

      {/* Status pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 4px" }}>
        <Pill color={status?.halted ? C.rose : C.emerald}>
          <Dot color={status?.halted ? C.rose : C.emerald} pulse={!status?.halted} />
          <span style={{ marginLeft: 5 }}>{status?.halted ? "HALTED" : "LIVE"}</span>
        </Pill>
        <Pill color={C.textSec}>{(status?.executionMode ?? "paper").toUpperCase()}</Pill>
      </div>

      <Divider />

      {/* Equity */}
      <div style={{ padding: "0 4px" }}>
        <Label>Portfolio Equity</Label>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>{usd(equity)}</div>
        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <Dot color={isUp ? C.emerald : C.rose} />
          <span style={{ fontSize: 12, fontWeight: 600, color: isUp ? C.emerald : C.rose }}>
            {isUp ? "+" : ""}{usd(pnlAll)} ({isUp ? "+" : ""}{pct(pnlPct)})
          </span>
        </div>
        <EquitySparkline checks={checks} equity={equity} />
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textSec, marginBottom: 4 }}>
            <span>Daily P&L</span>
            <span style={{ color: metrics.dailyPnl >= 0 ? C.emerald : C.rose, fontWeight: 600 }}>
              {metrics.dailyPnl >= 0 ? "+" : ""}{usd(metrics.dailyPnl ?? 0)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textSec }}>
            <span>Drawdown</span>
            <span style={{ color: (metrics.drawdown ?? 0) > 0.05 ? C.rose : C.textSec, fontWeight: 600 }}>
              {pct(metrics.drawdown ?? 0)}
            </span>
          </div>
        </div>
      </div>

      <Divider />

      {/* Trust tier */}
      <div style={{ padding: "0 4px" }}>
        <Label>Trust Tier</Label>
        <div style={{
          padding: "12px 14px", borderRadius: 12,
          background: tierGrad(tier), marginBottom: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: "0.08em" }}>{tier}</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>{num(score, 0)}% trust score</div>
        </div>
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.textSec, marginBottom: 4 }}>
            <span>Size Factor</span>
            <span style={{ fontWeight: 600, color: C.text }}>{num(sf, 0)}%</span>
          </div>
          <Bar value={trust.sizeFactor ?? 0} color={tierColor(tier)} />
        </div>

        {/* Dimension bars */}
        {trust.dimensions && Object.entries(trust.dimensions).map(([key, dim]) => {
          const label = { policyCompliance: "Policy", riskDiscipline: "Risk", validationCompleteness: "Validation", outcomeQuality: "Outcomes" }[key] ?? key;
          const col = dim.score >= 0.7 ? C.emerald : dim.score >= 0.5 ? C.sky : dim.score >= 0.3 ? C.amber : C.rose;
          return (
            <div key={key} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMut, marginBottom: 3 }}>
                <span>{label}</span>
                <span style={{ color: col, fontWeight: 600 }}>{pct(dim.score ?? 0, 0)}</span>
              </div>
              <Bar value={dim.score ?? 0} color={col} height={3} />
            </div>
          );
        })}
      </div>

      <Divider />

      {/* Agent info */}
      <div style={{ padding: "0 4px" }}>
        <Label>Agent</Label>
        <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.8 }}>
          <div>ID <span style={{ color: C.text, fontWeight: 600 }}>#{status?.agentId ?? "—"}</span></div>
          <div>Cycle <span style={{ color: C.text, fontWeight: 600 }}>{status?.cycle ?? "—"}</span></div>
          <div>Uptime <span style={{ color: C.text, fontWeight: 600 }}>{uptime(hb.uptimeMs)}</span></div>
          <div>Last trade <span style={{ color: C.text, fontWeight: 600 }}>{ago(hb.lastTradeAt)}</span></div>
        </div>
      </div>

      {hb.consecutiveErrors > 0 && (
        <div style={{ background: C.roseDim, border: `1px solid ${C.rose}30`, borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, color: C.rose, fontWeight: 600 }}>⚠ {hb.consecutiveErrors} consecutive errors</div>
        </div>
      )}

      <Divider />

      {/* SAGE */}
      {sage && (
        <div style={{ padding: "0 4px" }}>
          <Label>SAGE Engine</Label>
          <div style={{ fontSize: 11, color: C.textSec, lineHeight: 1.8 }}>
            <div>Reflections <span style={{ color: C.text, fontWeight: 600 }}>{sage.reflectionCount ?? 0}</span></div>
            <div>Outcomes <span style={{ color: C.text, fontWeight: 600 }}>{sage.outcomesRecorded ?? 0}</span></div>
            <div>Rules <span style={{ color: C.text, fontWeight: 600 }}>{sage.playbookRules ?? 0}</span></div>
          </div>
          {sage.contextPrefix && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.textMut, lineHeight: 1.6, fontStyle: "italic", padding: "8px 10px", background: C.indigoDim, borderRadius: 8, border: `1px solid ${C.indigo}20` }}>
              "{sage.contextPrefix}"
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Operator controls */}
      <div style={{ padding: "0 4px 4px" }}>
        <Label>Operator</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "Pause", color: C.amber, endpoint: "/api/operator/pause" },
            { label: "Resume", color: C.emerald, endpoint: "/api/operator/resume" },
            { label: "Emergency Stop", color: C.rose, endpoint: "/api/operator/emergency-stop" },
          ].map(({ label, color, endpoint }) => (
            <button
              key={label}
              onClick={async () => { try { await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "dashboard", actor: "operator" }) }); } catch {} }}
              style={{
                padding: "8px 12px", borderRadius: 8, border: `1px solid ${color}30`,
                background: color + "12", color, fontSize: 11, fontWeight: 600,
                cursor: "pointer", fontFamily: "Inter,sans-serif", transition: "all 0.15s",
              }}
            >{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Top bar with live ticker ──────────────────────────────────────────────────
function TopBar({ status }) {
  const signals = status?.signals ?? [];
  const items = status?.riskMetrics ? [
    `BTC ${status.symbols?.includes("BTCUSD") ? "●" : ""}`,
    ...signals.map(s => `${s.symbol}  ${s.direction?.toUpperCase()}  ${((s.confidence ?? 0) * 100).toFixed(0)}%`),
    `Equity  ${usd(status.riskMetrics.equity ?? 0)}`,
    `Positions  ${status.riskMetrics.openPositions ?? 0}`,
    `Mode  ${(status.executionMode ?? "—").toUpperCase()}`,
  ] : [];
  const ticker = [...items, ...items].join("   ·   ");

  return (
    <div style={{
      height: 44, borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center",
      background: "rgba(0,0,0,0.3)", flexShrink: 0, overflow: "hidden",
    }}>
      <div style={{ padding: "0 20px", borderRight: `1px solid ${C.border}`, height: "100%", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Dot color={status?.halted ? C.rose : C.emerald} pulse />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textSec, letterSpacing: "0.06em" }}>SENTINEL v3</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{
          display: "inline-block", whiteSpace: "nowrap",
          fontSize: 11, color: C.textSec, fontWeight: 500,
          animation: ticker.length > 10 ? "ticker 40s linear infinite" : "none",
          paddingLeft: "100%",
        }}>
          {ticker}
        </div>
      </div>
      <div style={{ padding: "0 16px", flexShrink: 0, display: "flex", gap: 8 }}>
        {status?.testMode && <Pill color={C.amber}>TEST</Pill>}
        <Pill color={C.indigo}>ERC-8004</Pill>
      </div>
    </div>
  );
}

// ── Hero metric card ──────────────────────────────────────────────────────────
function HeroCard({ label, value, sub, color = C.text, icon, style }) {
  return (
    <Card style={{ ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Label>{label}</Label>
        {icon && <span style={{ fontSize: 18, opacity: 0.4 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: C.textSec, fontWeight: 500 }}>{sub}</div>}
    </Card>
  );
}

// ── Live signals feed ─────────────────────────────────────────────────────────
function SignalsFeed({ status }) {
  const signals = status?.signals ?? [];
  const evals   = status?.strategyEvaluations ?? {}; // now a Record<symbol, evaluations[]>
  const [selectedSym, setSelectedSym] = useState(null);

  // Pick symbol to show scores for: selected, or first with a signal, or first available
  const evalSymbols = Object.keys(evals);
  const activeSymbol = selectedSym && evals[selectedSym]
    ? selectedSym
    : signals[0]?.symbol && evals[signals[0].symbol]
      ? signals[0].symbol
      : evalSymbols[0] ?? null;

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <Label style={{ marginBottom: 2 }}>Live Signals</Label>
          <div style={{ fontSize: 11, color: C.textMut }}>Fired this cycle</div>
        </div>
        <Pill color={signals.length > 0 ? C.emerald : C.textMut}>{signals.length} active</Pill>
      </div>

      {signals.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: C.textMut, fontSize: 12 }}>
          No strategies fired this cycle
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {signals.map((s, i) => {
            const col = buyColor(s.direction);
            const conf = (s.confidence ?? 0) * 100;
            return (
              <div key={i} style={{
                padding: "12px 14px", borderRadius: 12,
                background: col + "0d", border: `1px solid ${col}25`,
                animation: "fadeIn 0.3s ease",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Dot color={col} pulse />
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{s.symbol}</span>
                    <Pill color={col} style={{ fontSize: 10 }}>{(s.direction ?? "HOLD").toUpperCase()}</Pill>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: col }}>{num(conf, 0)}%</span>
                </div>
                <div style={{ marginBottom: 4 }}>
                  <Bar value={s.confidence ?? 0} color={col} height={3} />
                </div>
                <div style={{ fontSize: 10, color: C.textSec, fontWeight: 500 }}>
                  {(s.strategy ?? "—").replace(/_/g, " ").toUpperCase()}
                </div>
                {s.reasoning && (
                  <div style={{ marginTop: 6, fontSize: 10, color: C.textMut, lineHeight: 1.5 }}>
                    {s.reasoning.length > 110 ? s.reasoning.slice(0, 110) + "…" : s.reasoning}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Strategy scores — symbol picker */}
      {evalSymbols.length > 0 && (
        <>
          <Divider />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Label style={{ marginBottom: 0 }}>Strategy Scores</Label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {evalSymbols.map(sym => (
                <button key={sym} onClick={() => setSelectedSym(sym)} style={{
                  padding: "2px 8px", borderRadius: 6, fontSize: 9, fontWeight: 600,
                  background: sym === activeSymbol ? C.indigoDim : "transparent",
                  border: `1px solid ${sym === activeSymbol ? C.indigo : C.border}`,
                  color: sym === activeSymbol ? C.indigo : C.textMut,
                  cursor: "pointer", fontFamily: "Inter,sans-serif",
                }}>{sym.replace("USD","")}</button>
              ))}
            </div>
          </div>
          {activeSymbol && (evals[activeSymbol] ?? []).map((e, i) => {
            const conf = (e.confidence ?? 0) * 100;
            const col  = conf > 60 ? C.emerald : conf > 40 ? C.amber : C.textMut;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 76, fontSize: 10, color: C.textSec, fontWeight: 500, flexShrink: 0 }}>
                  {e.name.replace(/_/g, " ")}
                </div>
                <div style={{ flex: 1 }}><Bar value={e.confidence ?? 0} color={col} height={6} /></div>
                <div style={{ width: 32, fontSize: 11, fontWeight: 700, color: col, textAlign: "right" }}>
                  {num(conf, 0)}%
                </div>
                <Pill color={e.signal !== "hold" ? buyColor(e.signal) : C.textMut} style={{ fontSize: 9, padding: "2px 6px" }}>
                  {(e.signal ?? "hold").toUpperCase()}
                </Pill>
              </div>
            );
          })}
        </>
      )}
    </Card>
  );
}

// ── AI Narrative ──────────────────────────────────────────────────────────────
function NarrativeCard({ status }) {
  const n = status?.narrative;
  const sourceColor = { claude: C.violet, groq: C.sky, template: C.textMut };
  return (
    <Card style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <Label style={{ marginBottom: 0 }}>AI Reasoning</Label>
        {n && <Pill color={sourceColor[n.source] ?? C.textMut} style={{ fontSize: 10 }}>{(n.source ?? "—").toUpperCase()}</Pill>}
      </div>
      {n ? (
        <>
          <div style={{ fontSize: 11, color: C.textSec, marginBottom: 10 }}>
            <span style={{ fontWeight: 600, color: C.text }}>{n.symbol}</span>
            {" · "}
            {n.timestamp ? new Date(n.timestamp).toLocaleTimeString() : "—"}
          </div>
          <div style={{
            fontSize: 13, color: C.text, lineHeight: 1.8, fontWeight: 400,
            padding: "14px 16px", background: C.indigoDim,
            borderRadius: 10, border: `1px solid ${C.indigo}20`,
            flex: 1,
          }}>
            {n.narrative}
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.textMut, gap: 8, padding: "24px 0" }}>
          <div style={{ fontSize: 28, opacity: 0.3 }}>🤖</div>
          <div style={{ fontSize: 12 }}>Awaiting first trade…</div>
          <div style={{ fontSize: 10, color: C.textMut }}>Claude → Groq → Template</div>
        </div>
      )}
    </Card>
  );
}

// ── Sentiment card ────────────────────────────────────────────────────────────
function SentimentCard({ status }) {
  const s   = status?.sentiment;
  const val = s?.composite ?? 0;
  const col = val > 0.1 ? C.emerald : val < -0.1 ? C.rose : C.amber;
  const lbl = val > 0.3 ? "BULLISH" : val > 0.1 ? "MILD BULL" : val < -0.3 ? "BEARISH" : val < -0.1 ? "MILD BEAR" : "NEUTRAL";
  const normalized = (val + 1) / 2;

  return (
    <Card>
      <Label>Market Sentiment</Label>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: col }}>{num(val > 0 ? val : val, 2)}</div>
        <Pill color={col}>{lbl}</Pill>
      </div>
      <div style={{ marginBottom: 8 }}>
        <Bar value={normalized} color={col} height={8} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMut }}>
        <span>FEAR</span><span>NEUTRAL</span><span>GREED</span>
      </div>
      {s?.sources && (
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {s.sources.map(src => <Pill key={src} color={C.textMut} style={{ fontSize: 9 }}>{src.replace(/_/g, " ")}</Pill>)}
        </div>
      )}
    </Card>
  );
}

// ── Positions table ───────────────────────────────────────────────────────────
function PositionsTable({ status }) {
  const positions = status?.positions ?? [];
  const thStyle = { padding: "10px 12px", fontSize: 10, fontWeight: 600, color: C.textMut, textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "left", borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: "12px", fontSize: 12, borderBottom: `1px solid ${C.border}40`, color: C.text };

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <Label style={{ marginBottom: 2 }}>Open Positions</Label>
          <div style={{ fontSize: 11, color: C.textMut }}>{positions.length} active</div>
        </div>
        <Pill color={positions.length > 0 ? C.indigo : C.textMut}>{positions.length} / {status?.maxPositions ?? 5}</Pill>
      </div>
      {positions.length === 0 ? (
        <div style={{ padding: "32px 20px", textAlign: "center", color: C.textMut, fontSize: 12 }}>No open positions</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Symbol", "Side", "Size", "Entry", "Stop", "Target", "Strategy", "Opened"].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map(p => {
                const col = p.side === "buy" ? C.emerald : C.rose;
                return (
                  <tr key={p.id} style={{ transition: "background 0.15s" }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{p.symbol}</td>
                    <td style={tdStyle}><Pill color={col} style={{ fontSize: 10 }}>{(p.side ?? "—").toUpperCase()}</Pill></td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{num(p.size, 6)}</td>
                    <td style={tdStyle}>{usd(p.entryPrice)}</td>
                    <td style={{ ...tdStyle, color: C.rose }}>{p.stopLoss ? usd(p.stopLoss) : "—"}</td>
                    <td style={{ ...tdStyle, color: C.emerald }}>{p.takeProfit ? usd(p.takeProfit) : "—"}</td>
                    <td style={{ ...tdStyle, color: C.textSec, fontSize: 11 }}>{(p.strategy ?? "—").replace(/_/g, " ")}</td>
                    <td style={{ ...tdStyle, color: C.textMut, fontSize: 11 }}>{ago(p.openedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Governance pipeline ───────────────────────────────────────────────────────
function GovernancePipeline({ status, checks }) {
  const stages = ["Oracle", "Signal", "Sentiment", "Risk Gate", "Execute", "Record"];
  const hasActive = (status?.signals ?? []).length > 0;
  const lastCp = (checks?.checkpoints ?? []).find(cp => cp?.eventType);
  const lastEvt = lastCp?.eventType;
  // Map last checkpoint event → how many stages completed
  const stagesDone = status?.halted ? 0
    : lastEvt === "close"      ? 6
    : lastEvt === "trade"      ? 5
    : lastEvt === "veto"       ? 3  // risk gate blocked it
    : lastEvt === "heartbeat"  ? 3  // oracle+signal+sentiment running
    : hasActive                ? 4  // signal found, executing
    : 2;                            // baseline: oracle+signal alive

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Label style={{ marginBottom: 0 }}>Governance Pipeline</Label>
        <Pill color={C.indigo}>6-stage ERC-8004</Pill>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {stages.map((s, i) => {
          const done   = i < stagesDone;
          const active = i === stagesDone;
          const col    = done ? C.emerald : active ? C.amber : C.textMut;
          return (
            <React.Fragment key={s}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: done ? C.emeraldDim : active ? C.amberDim : "rgba(255,255,255,0.04)",
                  border: `2px solid ${col}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: col,
                  transition: "all 0.3s",
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <div style={{ fontSize: 9, fontWeight: 600, color: col, textAlign: "center", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{s.toUpperCase()}</div>
              </div>
              {i < stages.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < stagesDone ? C.emerald : C.border, transition: "background 0.3s", maxWidth: 40 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 10, color: C.textSec }}>
        <span><span style={{ color: C.emerald }}>■</span> Passed ({stagesDone})</span>
        {hasActive && <span><span style={{ color: C.amber }}>■</span> Active</span>}
        <span style={{ marginLeft: "auto", color: C.textMut }}>Every trade passes all 6 gates</span>
      </div>
    </Card>
  );
}

// ── Trade history ─────────────────────────────────────────────────────────────
function TradeHistory({ trades }) {
  const closed = (trades?.trades ?? []).slice(0, 20);
  const stats  = trades?.stats ?? {};
  const thStyle = { padding: "10px 12px", fontSize: 10, fontWeight: 600, color: C.textMut, textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "left", borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: "11px 12px", fontSize: 12, borderBottom: `1px solid ${C.border}30` };

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Label style={{ marginBottom: 2 }}>Trade History</Label>
          <div style={{ fontSize: 11, color: C.textMut }}>{stats.total ?? 0} closed trades</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.emerald }}>{stats.wins ?? 0}</div>
            <div style={{ fontSize: 9, color: C.textMut }}>WINS</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.rose }}>{stats.losses ?? 0}</div>
            <div style={{ fontSize: 9, color: C.textMut }}>LOSSES</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.indigo }}>{stats.total > 0 ? pct(stats.winRate ?? 0, 0) : "—"}</div>
            <div style={{ fontSize: 9, color: C.textMut }}>WIN RATE</div>
          </div>
        </div>
      </div>
      {closed.length === 0 ? (
        <div style={{ padding: "32px 20px", textAlign: "center", color: C.textMut, fontSize: 12 }}>No closed trades yet</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Symbol","Side","Entry","Exit","P&L","P&L %","Strategy","Reason","Duration"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {closed.map((t, i) => {
                const win = t.pnl >= 0;
                const col = win ? C.emerald : C.rose;
                const dur = t.durationMs ? `${Math.round(t.durationMs / 60000)}m` : "—";
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: C.text }}>{t.symbol}</td>
                    <td style={tdStyle}><Pill color={buyColor(t.direction)} style={{ fontSize: 10 }}>{(t.direction ?? "—").toUpperCase()}</Pill></td>
                    <td style={tdStyle}>{usd(t.entryPrice)}</td>
                    <td style={tdStyle}>{usd(t.exitPrice)}</td>
                    <td style={{ ...tdStyle, color: col, fontWeight: 700 }}>{win ? "+" : ""}{usd(t.pnl)}</td>
                    <td style={{ ...tdStyle, color: col, fontWeight: 600 }}>{win ? "+" : ""}{pct(t.pnlPct ?? 0)}</td>
                    <td style={{ ...tdStyle, color: C.textSec, fontSize: 11 }}>{(t.strategy ?? "—").replace(/_/g, " ")}</td>
                    <td style={tdStyle}><Pill color={C.textMut} style={{ fontSize: 9 }}>{t.exitReason ?? "—"}</Pill></td>
                    <td style={{ ...tdStyle, color: C.textMut, fontSize: 11 }}>{dur}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Checkpoint log ────────────────────────────────────────────────────────────
function CheckpointLog({ checks }) {
  const cps = checks?.checkpoints ?? [];
  const stats = checks?.stats ?? {};
  const integrity = checks?.integrity ?? {};
  const evtColor = e => ({ trade: C.emerald, halt: C.rose, veto: C.amber, close: C.sky, heartbeat: C.textMut }[e] ?? C.textMut);

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Label style={{ marginBottom: 2 }}>Decision Log</Label>
          <div style={{ fontSize: 11, color: C.textMut }}>{stats.total ?? 0} checkpoints · chain {integrity.valid ? "✓ valid" : "⚠ invalid"}</div>
        </div>
        <Pill color={integrity.valid ? C.emerald : C.rose}>{integrity.valid ? "CHAIN VALID" : "CHAIN ERROR"}</Pill>
      </div>
      <div style={{ overflowY: "auto", maxHeight: 280 }}>
        {cps.map((cp, i) => {
          const col = evtColor(cp.eventType);
          return (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "10px 20px", borderBottom: `1px solid ${C.border}30`,
              transition: "background 0.15s",
            }}>
              <div style={{ marginTop: 2, flexShrink: 0 }}>
                <Dot color={col} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <Pill color={col} style={{ fontSize: 9, padding: "1px 6px" }}>{(cp.eventType ?? "—").toUpperCase()}</Pill>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text }}>{cp.symbol}</span>
                  <span style={{ fontSize: 10, color: C.textMut, marginLeft: "auto", flexShrink: 0 }}>
                    #{cp.id}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: C.textMut, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cp.hash?.slice(0, 32)}…
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Governance stats ──────────────────────────────────────────────────────────
function GovernanceStats({ status }) {
  const g = status?.governance ?? {};
  const stats = [
    { label: "Total Signals", value: g.totalSignals ?? 0, color: C.indigo },
    { label: "Vetoed Trades", value: g.vetoedTrades ?? 0, color: C.amber },
    { label: "Mandate Violations", value: g.mandateViolations ?? 0, color: g.mandateViolations > 0 ? C.rose : C.textSec },
    { label: "IPFS Pinned", value: g.ipfsPinnedCount ?? 0, color: C.sky },
  ];
  return (
    <Card>
      <Label>Governance Stats</Label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {stats.map(({ label, value, color }) => (
          <div key={label} style={{ padding: "10px 12px", borderRadius: 10, background: color + "0d", border: `1px solid ${color}20` }}>
            <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 10, color: C.textMut, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Log stream ────────────────────────────────────────────────────────────────
function LogStream({ logs }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [logs]);

  const LC = { ERROR: C.rose, WARN: C.amber, INFO: C.sky, DEBUG: C.textMut };
  const levelCol  = lvl => LC[(lvl ?? "").toUpperCase()] ?? C.textMut;
  const levelBadge = lvl => {
    const upper = (lvl ?? "").toUpperCase();
    const col = LC[upper] ?? C.textMut;
    return (
      <span style={{
        display: "inline-block", width: 38, textAlign: "center",
        padding: "1px 0", borderRadius: 3, fontSize: 9, fontWeight: 700,
        background: col + "18", color: col, flexShrink: 0, letterSpacing: "0.04em",
      }}>{upper || "LOG"}</span>
    );
  };

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "16px 20px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Label style={{ marginBottom: 0 }}>System Logs</Label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {["ERROR","WARN","INFO"].map(lvl => {
            const count = logs.filter(l => (l.level ?? "").toUpperCase() === lvl).length;
            return count > 0 ? <Pill key={lvl} color={LC[lvl]} style={{ fontSize: 9, padding: "2px 7px" }}>{lvl} {count}</Pill> : null;
          })}
          <Pill color={C.textMut}>{logs.length} lines</Pill>
        </div>
      </div>
      <div ref={ref} style={{ overflowY: "auto", maxHeight: 260, overflowX: "hidden" }}>
        {logs.slice(-60).map((l, i) => {
          // Support both {time,level,logger,msg} and legacy {timestamp,level,module,message}
          const ts  = l.time ?? l.timestamp ?? "";
          const lvl = (l.level ?? "INFO").toUpperCase();
          const mod = l.logger ?? l.module ?? "";
          const msg = l.msg ?? l.message ?? "";
          return (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "5px 16px", fontSize: 11,
              borderBottom: `1px solid ${C.border}20`,
              fontFamily: "'Fira Code','Consolas','Monaco',monospace",
              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)",
            }}>
              <span style={{ color: C.textMut, flexShrink: 0, fontSize: 10, paddingTop: 1, whiteSpace: "nowrap" }}>
                {ts ? ts.slice(11, 19) : "—"}
              </span>
              {levelBadge(lvl)}
              <span style={{
                color: C.indigo, flexShrink: 0, fontSize: 10,
                width: 68, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", paddingTop: 1,
              }}>{mod}</span>
              <span style={{
                color: lvl === "ERROR" ? C.rose : lvl === "WARN" ? C.amber : C.text,
                flex: 1, minWidth: 0, lineHeight: 1.5,
                wordBreak: "break-word", fontSize: 11,
              }}>{msg}</span>
            </div>
          );
        })}
        {logs.length === 0 && (
          <div style={{ padding: "24px 20px", color: C.textMut, fontSize: 11, textAlign: "center" }}>
            Waiting for log entries…
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Root app ──────────────────────────────────────────────────────────────────
export default function App() {
  const { status, trades, sage, logs, checks } = useData();
  const metrics = status?.riskMetrics ?? {};
  const hb      = status?.heartbeat ?? {};
  const tStats  = trades?.stats ?? {};

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.bg, color: C.text, fontFamily: "Inter,system-ui,sans-serif" }}>
      <TopBar status={status} />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar status={status} trades={trades} sage={sage} checks={checks} />

        {/* Main scroll area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Hero metrics row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
            <HeroCard
              label="Open Positions"
              value={metrics.openPositions ?? 0}
              sub={`of ${status?.maxPositions ?? 5} max`}
              color={C.indigo}
              icon="📊"
            />
            <HeroCard
              label="Win Rate"
              value={tStats.total > 0 ? pct(tStats.winRate ?? 0, 0) : "—"}
              sub={`${tStats.wins ?? 0}W · ${tStats.losses ?? 0}L`}
              color={(tStats.winRate ?? 0) >= 0.5 ? C.emerald : C.rose}
              icon="🏆"
            />
            <HeroCard
              label="Drawdown"
              value={pct(metrics.drawdown ?? 0)}
              sub="from peak equity"
              color={(metrics.drawdown ?? 0) > 0.05 ? C.rose : (metrics.drawdown ?? 0) > 0.02 ? C.amber : C.emerald}
              icon="📉"
            />
            <HeroCard
              label="Uptime"
              value={uptime(hb.uptimeMs)}
              sub={`cycle #${status?.cycle ?? "—"}`}
              color={C.sky}
              icon="⏱"
            />
          </div>

          {/* Signals + Narrative row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <SignalsFeed status={status} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <NarrativeCard status={status} />
              <SentimentCard status={status} />
            </div>
          </div>

          {/* Positions */}
          <PositionsTable status={status} />

          {/* Governance pipeline */}
          <GovernancePipeline status={status} checks={checks} />

          {/* Trade history */}
          <TradeHistory trades={trades} />

          {/* Bottom row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <GovernanceStats status={status} />
            <CheckpointLog checks={checks} />
          </div>

          {/* Logs */}
          <LogStream logs={logs} />

          <div style={{ height: 20 }} />
        </div>
      </div>
    </div>
  );
}
