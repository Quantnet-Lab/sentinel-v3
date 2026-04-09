import React, { useState, useEffect, useMemo, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   SENTINEL v3 — Institutional SMC Trading Agent
   ERC-8004 Trust-Governed · 18-Stage Governance Pipeline
   Live Proof Dashboard · Production Control Plane
   ═══════════════════════════════════════════════════════════════════════ */

const PIPELINE_STAGES = [
  "Oracle Guard","Ensemble","Neuro-Sym","Sentiment","PRISM",
  "Adapt Bias","Op Control","Mandate","Sim","Supervisory",
  "Scorecard","Risk","Narrative","Execute","Artifact",
  "Checkpoint","IPFS","On-Chain",
];

const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const pct   = (v,d=1)   => `${(v*100).toFixed(d)}%`;
const usd   = (v)       => `$${Number(v).toFixed(2)}`;
const fmt   = (v,d=2)   => Number(v).toFixed(d);
const ago   = (ms) => {
  if (ms == null) return "never";
  const s = Math.floor(ms/1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s/60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ${m%60}m ago`;
  return `${Math.floor(h/24)}d ${h%24}h ago`;
};
const uptime = (ms) => {
  const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/* ── Design tokens ─────────────────────────────────────────────────────────── */
const T = {
  bg:  "#080b11", s1: "#0c1018", s2: "#111621", s3: "#161c29",
  brd: "#1c2536", brdA: "#253045",
  fg:  "#c9d1dc", fg2: "#7c8a9e", fg3: "#4b5668", w: "#edf2f7",
  up:  "#34d399", dn: "#f87171", warn: "#fbbf24",
  info: "#60a5fa", cyan: "#22d3ee", purple: "#a78bfa",
};
const F = "'JetBrains Mono','SF Mono','Cascadia Code',monospace";

/* ── Color helpers ─────────────────────────────────────────────────────────── */
const dirColor = (d) => d === "buy" || d === "BUY" || d === "LONG" ? T.up : d === "sell" || d === "SELL" || d === "SHORT" ? T.dn : T.fg2;
const tierColor = (t) => { if (t === "elite" || t === "elevated") return T.up; if (t === "standard") return T.info; if (t === "limited") return T.warn; return T.dn; };
const eventColor = (e) => { if (e === "trade") return T.up; if (e === "halt") return T.dn; if (e === "veto") return T.warn; if (e === "close") return T.info; return T.fg3; };
const truC = (s) => s >= 85 ? T.up : s >= 70 ? T.info : s >= 55 ? T.warn : T.dn;
const sentColor = (v) => v > 0.08 ? T.up : v < -0.08 ? T.dn : T.warn;
const sentLabel = (v) => v > 0.3 ? "BULLISH" : v > 0.08 ? "MILD BULL" : v < -0.3 ? "BEARISH" : v < -0.08 ? "MILD BEAR" : "NEUTRAL";

/* ── Primitives ────────────────────────────────────────────────────────────── */
function Dot({ color, pulse }) {
  return (
    <span style={{
      display:"inline-block", width:7, height:7, borderRadius:"50%",
      background:color, flexShrink:0,
      boxShadow: pulse ? `0 0 0 3px ${color}30, 0 0 8px ${color}60` : `0 0 5px ${color}50`,
    }} />
  );
}

function Badge({ children, color = T.info }) {
  return (
    <span style={{
      fontSize:9, fontWeight:700, color,
      background:`${color}18`, padding:"1px 6px",
      borderRadius:2, whiteSpace:"nowrap", letterSpacing:0.3,
    }}>
      {children}
    </span>
  );
}

function Bar({ value, color = T.up, height = 4 }) {
  return (
    <div style={{ height, background:T.bg, borderRadius:2, overflow:"hidden", marginTop:3 }}>
      <div style={{
        height:"100%", width:`${clamp(value,0,1)*100}%`,
        background:color, borderRadius:2, transition:"width .5s ease",
      }} />
    </div>
  );
}

function Spark({ data = [], h = 48, color }) {
  if (data.length < 2) return <div style={{ height:h, background:T.s1, borderRadius:3 }} />;
  const W=400, mn=Math.min(...data)-1e-9, mx=Math.max(...data)+1e-9, rng=mx-mn;
  const sx = W/(data.length-1);
  const pts = data.map((v,i)=>`${i*sx},${h-((v-mn)/rng)*(h-6)-3}`).join(" ");
  const c = color || (data[data.length-1]>=data[0] ? T.up : T.dn);
  const gid = `sg${Math.abs(c.replace(/#/g,"").charCodeAt(0))}${data.length}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity=".15"/>
          <stop offset="100%" stopColor={c} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${(data.length-1)*sx},${h}`} fill={`url(#${gid})`}/>
      <polyline points={pts} fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

function Panel({ title, tag, tip, children, style: sx, full, noPad }) {
  return (
    <div style={{
      background:T.s1, border:`1px solid ${T.brd}`, borderRadius:6,
      overflow:"hidden", display:"flex", flexDirection:"column",
      gridColumn: full ? "1 / -1" : undefined, ...sx,
    }}>
      <div style={{
        display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"7px 12px", borderBottom:`1px solid ${T.brd}`,
        background:T.s2, flexShrink:0,
      }}>
        <span title={tip} style={{ fontSize:10.5, fontWeight:700, color:T.fg, letterSpacing:0.4, cursor:tip?"help":"default" }}>{title}</span>
        {tag && <span style={{ fontSize:8.5, color:T.fg3, fontWeight:600 }}>{tag}</span>}
      </div>
      <div style={noPad ? { flex:1 } : { padding:"8px 12px", flex:1 }}>{children}</div>
    </div>
  );
}

function KV({ k, v, c = T.fg, mono }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"2.5px 0", fontSize:10.5 }}>
      <span style={{ color:T.fg2 }}>{k}</span>
      <span style={{
        color:c, fontWeight:500, textAlign:"right",
        maxWidth:"62%", overflow:"hidden", textOverflow:"ellipsis",
        whiteSpace:"nowrap", fontFamily: mono ? "monospace" : undefined,
      }}>{v}</span>
    </div>
  );
}

function Metric({ label, value, sub, color = T.fg }) {
  return (
    <div style={{ padding:"6px 10px" }}>
      <div style={{ fontSize:8, color:T.fg3, textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:15, fontWeight:700, color, lineHeight:1, fontVariantNumeric:"tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:T.fg2, marginTop:3 }}>{sub}</div>}
    </div>
  );
}

/* ── Error boundary ────────────────────────────────────────────────────────── */
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err:null }; }
  static getDerivedStateFromError(e) { return { err:e }; }
  render() {
    if (this.state.err) return (
      <div style={{ minHeight:"100vh", background:T.bg, color:T.dn, padding:40, fontFamily:"monospace" }}>
        <h2 style={{ color:T.w, marginBottom:12 }}>Dashboard Error</h2>
        <pre style={{ fontSize:12, whiteSpace:"pre-wrap", color:T.warn }}>{String(this.state.err)}</pre>
        <button onClick={()=>this.setState({err:null})} style={{
          marginTop:16, padding:"8px 20px", background:`${T.up}20`,
          color:T.up, border:`1px solid ${T.up}40`, borderRadius:4, cursor:"pointer", fontFamily:"monospace",
        }}>Retry</button>
      </div>
    );
    return this.props.children;
  }
}

export default function SentinelWrapper() { return <ErrorBoundary><Sentinel /></ErrorBoundary>; }

/* ════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════════ */
function Sentinel() {
  const [status,      setStatus]      = useState(null);
  const [risk,        setRisk]        = useState(null);
  const [trust,       setTrust]       = useState(null);
  const [checkpoints, setCheckpoints] = useState({ checkpoints:[], stats:{}, integrity:{} });
  const [positions,   setPositions]   = useState([]);
  const [trades,      setTrades]      = useState({ trades:[], stats:{} });
  const [sage,        setSage]        = useState(null);
  const [logs,        setLogs]        = useState([]);
  const [opState,     setOpState]     = useState("ACTIVE");
  const [opLog,       setOpLog]       = useState([]);
  const [equityHist,  setEquityHist]  = useState([10000]);
  const [online,      setOnline]      = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [selCpIdx,    setSelCpIdx]    = useState(0);

  const fetchAll = useCallback(async () => {
    try {
      const [s, r, tr, cp, pos, td, sg, lg, opS, opA] = await Promise.all([
        fetch("/api/status").then(x=>x.json()),
        fetch("/api/risk").then(x=>x.json()),
        fetch("/api/trust").then(x=>x.json()),
        fetch("/api/checkpoints?limit=20").then(x=>x.json()),
        fetch("/api/positions").then(x=>x.json()),
        fetch("/api/trades?limit=30").then(x=>x.json()),
        fetch("/api/sage").then(x=>x.json()),
        fetch("/api/logs?limit=80").then(x=>x.json()),
        fetch("/api/operator/state").then(x=>x.json()).catch(()=>null),
        fetch("/api/operator/actions?limit=8").then(x=>x.json()).catch(()=>null),
      ]);
      setStatus(s); setRisk(r); setTrust(tr);
      setCheckpoints(cp); setPositions(pos); setTrades(td);
      setSage(sg); setLogs(lg);
      setOnline(true);
      setLastUpdate(new Date());
      if (r?.equity) setEquityHist(h => [...h.slice(-79), r.equity]);
      if (opS) {
        const m = { normal:"ACTIVE", paused:"PAUSED", emergency_stop:"EMERGENCY_STOP" };
        setOpState(m[opS.mode] || "ACTIVE");
      }
      if (opA?.actions) setOpLog(opA.actions.slice(0,8).map(a => ({
        ts: a.timestamp ? new Date(a.timestamp).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}) : "—",
        action: a.action || "—",
        reason: a.reason || "—",
      })));
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 4000); return ()=>clearInterval(id); }, [fetchAll]);

  /* ── Operator actions ── */
  const opPost = async (endpoint, reason) => {
    try {
      const res = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ reason, actor:"dashboard" }) });
      const data = await res.json();
      if (data.state) {
        const m = { normal:"ACTIVE", paused:"PAUSED", emergency_stop:"EMERGENCY_STOP" };
        setOpState(m[data.state.mode] || "ACTIVE");
      }
    } catch {}
  };

  /* ── Derived values ── */
  const eq      = risk?.equity    ?? 10000;
  const dpnl    = risk?.dailyPnl  ?? 0;
  const dd      = (risk?.drawdown ?? 0) * 100;
  const openPos = risk?.openPositions ?? 0;
  const cycle   = status?.cycle   ?? 0;
  const halted  = status?.halted  ?? false;
  const mode    = status?.executionMode ?? "paper";
  const testMode = status?.testMode ?? false;
  const operatorMode = status?.operatorMode ?? "normal";
  const signals = status?.signals ?? [];
  const gov     = status?.governance ?? {};
  const hb      = status?.heartbeat ?? {};
  const narrative = status?.narrative ?? null;
  const sentiment = status?.sentiment ?? null;
  const strategyEvals = status?.strategyEvaluations ?? null;

  const tier    = trust?.tier ?? "probation";
  const tScore  = (trust?.overall ?? 0) * 100;
  const tSize   = (trust?.sizeFactor ?? 0) * 100;
  const dims    = trust?.dimensions ?? {};

  const pnlPct  = ((eq - 10000) / 10000) * 100;
  const cpList  = checkpoints.checkpoints ?? [];
  const cpStats = checkpoints.stats ?? {};
  const intact  = checkpoints.integrity?.valid ?? true;
  const tradeList = trades.trades ?? [];
  const trStats   = trades.stats  ?? {};

  const { stagesDone, hasActiveStage } = useMemo(() => {
    if (!cpList.length) return { stagesDone: 0, hasActiveStage: false };
    const last = cpList[0];
    if (last.eventType === "trade")     return { stagesDone: 18, hasActiveStage: false };
    if (last.eventType === "close")     return { stagesDone: 15, hasActiveStage: false };
    if (last.eventType === "heartbeat") return { stagesDone: 8,  hasActiveStage: true  };
    if (last.eventType === "veto")      return { stagesDone: 10, hasActiveStage: true  };
    if (last.eventType === "halt")      return { stagesDone: 12, hasActiveStage: true  };
    // "signal" = HOLD — completed Oracle+Ensemble+Neuro-Sym, stopped there
    return { stagesDone: 3, hasActiveStage: false };
  }, [cpList]);

  const lastCycleMs = hb.lastCycleAt ? Date.now() - new Date(hb.lastCycleAt).getTime() : null;
  const lastTradeMs = hb.lastTradeAt ? Date.now() - new Date(hb.lastTradeAt).getTime() : null;
  const cycleStale  = lastCycleMs != null && lastCycleMs > 120_000;
  const hasError    = (hb.consecutiveErrors ?? 0) > 0;
  const isRunning   = online && !halted && operatorMode === "normal";
  const hbColor     = !online ? T.dn : (cycleStale || hasError) ? T.warn : T.up;
  const hbLabel     = !online ? "OFFLINE" : cycleStale ? "STALE" : hasError ? "ERRORS" : "RUNNING";

  const btn = (color, disabled) => ({
    background: disabled ? `${T.fg3}10` : `${color}18`,
    color: disabled ? T.fg3 : color,
    border: `1px solid ${disabled ? T.brd : `${color}40`}`,
    borderRadius:4, padding:"6px 14px", fontSize:10, fontWeight:700,
    fontFamily:F, cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <div style={{ background:T.bg, minHeight:"100vh", fontFamily:F, fontSize:11, lineHeight:1.4, color:T.fg }}>

      {/* ── Global styles ── */}
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:${T.bg}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-thumb{background:${T.brd};border-radius:2px}
        button:hover{opacity:.8}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @media(max-width:900px){
          .main-grid{grid-template-columns:1fr 1fr !important}
          .col4{grid-column:1/-1 !important}
          .col3{grid-template-columns:1fr 1fr !important}
        }
        @media(max-width:600px){
          .main-grid{grid-template-columns:1fr !important}
          .col3{grid-template-columns:1fr !important}
          .statusbar-right{display:none !important}
        }
      `}</style>

      {/* ══════════════════════════════════════════════════════════════════════
          1. STATUS BAR
          ══════════════════════════════════════════════════════════════════════ */}
      <header style={{
        background:T.s2, borderBottom:`1px solid ${T.brd}`,
        padding:"0 16px", height:42, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{
            width:22, height:22, borderRadius:4,
            background:`linear-gradient(135deg, ${T.up}, ${T.cyan})`,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:11, fontWeight:800, color:T.bg,
          }}>S</div>
          <span style={{ fontSize:13, fontWeight:800, color:T.w, letterSpacing:2 }}>SENTINEL v3</span>
          <span style={{ fontSize:8, color:T.fg3, letterSpacing:1.5 }}>ERC-8004 · SMC · Sepolia</span>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <Badge color={online ? T.up : T.dn}>{online ? "ONLINE" : "OFFLINE"}</Badge>
          <Badge color={T.info}>{mode.toUpperCase()}</Badge>
          {testMode && <Badge color={T.warn}>TEST MODE</Badge>}
          {halted && <Badge color={T.dn}>HALTED</Badge>}
          {operatorMode !== "normal" && <Badge color={operatorMode === "emergency_stop" ? T.dn : T.warn}>{operatorMode.toUpperCase().replace("_"," ")}</Badge>}
          <Badge color={tierColor(tier)}>{tier.toUpperCase()}</Badge>
        </div>
        <div className="statusbar-right" style={{ marginLeft:"auto", display:"flex", gap:16, alignItems:"center", fontSize:10 }}>
          <span style={{ color:T.fg3 }}>CYCLE <span style={{ color:T.fg }}>{cycle}</span></span>
          <span style={{ color:T.fg3 }}>POS <span style={{ color:openPos>0?T.up:T.fg }}>{openPos}</span></span>
          <span style={{ color:T.fg3 }}>CP <span style={{ color:T.fg }}>{cpStats.total ?? 0}</span></span>
          <span style={{ color:T.fg3 }}>TRUST <span style={{ color:truC(tScore) }}>{fmt(tScore,0)}</span></span>
          <span style={{ color:T.fg3 }}>{lastUpdate ? lastUpdate.toLocaleTimeString() : "—"}</span>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════════
          2. HEARTBEAT BANNER
          ══════════════════════════════════════════════════════════════════════ */}
      <div style={{
        display:"flex", alignItems:"center", gap:14, padding:"5px 16px",
        borderBottom:`1px solid ${T.brd}`, background:`${hbColor}08`, fontSize:10,
        flexWrap:"wrap",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{
            display:"inline-block", width:8, height:8, borderRadius:"50%",
            background:hbColor, boxShadow:`0 0 8px ${hbColor}60`,
            animation: isRunning && !cycleStale ? "pulse 2s infinite" : "none",
          }} />
          <span style={{ fontWeight:800, color:hbColor, letterSpacing:1 }}>{hbLabel}</span>
        </div>
        <span style={{ color:T.fg3 }}>|</span>
        <span style={{ color:T.fg2 }}>Last Cycle:</span>
        <span style={{ color:cycleStale?T.warn:T.fg, fontWeight:600 }}>{ago(lastCycleMs)}</span>
        <span style={{ color:T.fg3 }}>|</span>
        <span style={{ color:T.fg2 }}>Last Trade:</span>
        <span style={{ color:lastTradeMs==null?T.warn:T.fg, fontWeight:600 }}>{ago(lastTradeMs)}</span>
        <span style={{ color:T.fg3 }}>|</span>
        <span style={{ color:T.fg2 }}>Uptime:</span>
        <span style={{ color:T.fg, fontWeight:600 }}>{hb.uptimeMs ? uptime(hb.uptimeMs) : "—"}</span>
        <span style={{ color:T.fg3 }}>|</span>
        <span style={{ color:T.fg2 }}>Cycles:</span>
        <span style={{ color:T.fg, fontWeight:600 }}>{cycle}</span>
        {hasError && (
          <>
            <span style={{ color:T.fg3 }}>|</span>
            <span style={{ color:T.dn, fontWeight:700 }}>{hb.consecutiveErrors} err</span>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          3. MAIN GRID
          ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ padding:"10px 12px 30px" }}>

        {/* ── Row 1: Portfolio · Signals · Sentiment · Trust ── */}
        <div className="main-grid" style={{
          display:"grid",
          gridTemplateColumns:"220px 1fr 220px 220px",
          gap:10, marginBottom:10,
        }}>

          {/* Portfolio */}
          <Panel title="Portfolio" tag={`#${status?.agentId ?? "—"}`}>
            <div style={{ textAlign:"center", padding:"8px 0 4px" }}>
              <div style={{ fontSize:22, fontWeight:700, color:eq>=10000?T.up:T.dn, fontVariantNumeric:"tabular-nums" }}>
                {usd(eq)}
              </div>
              <div style={{ fontSize:10, color:T.fg2, marginTop:2 }}>
                {pnlPct>=0?"+":""}{fmt(pnlPct)}% all time
              </div>
            </div>
            <Spark data={equityHist} h={44} />
            <div style={{ marginTop:8 }}>
              <KV k="Daily P&L"  v={`${dpnl>=0?"+":""}${usd(dpnl)}`}  c={dpnl>=0?T.up:T.dn} />
              <KV k="Drawdown"   v={`${fmt(dd)}%`}                      c={dd>5?T.dn:dd>2?T.warn:T.fg} />
              <KV k="Status"     v={risk?.status ?? "—"}                 c={halted?T.dn:T.up} />
              <KV k="Open Pos"   v={openPos}                             c={openPos>0?T.cyan:T.fg2} />
            </div>
          </Panel>

          {/* Live Signals — one card per fired strategy */}
          <Panel title="Live Signals" tag={`${signals.length} fired`}>
            <div style={{ overflowY:"auto", maxHeight:"100%" }}>
              {signals.length === 0 && (
                <span style={{ color:T.fg3, fontSize:10 }}>No strategies fired this cycle</span>
              )}
              {signals.length > 0 && (
                <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.max(1,Math.min(signals.length,4))},1fr)`, gap:8 }}>
                  {signals.map((s, i) => (
                    <div key={`${s.symbol}-${s.strategy}-${i}`} style={{
                      background:T.s2, borderRadius:5, padding:"10px 12px",
                      border:`1px solid ${s.direction==="buy"?`${T.up}50`:s.direction==="sell"?`${T.dn}50`:T.brd}`,
                    }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                        <span style={{ fontWeight:700, color:T.w, fontSize:11 }}>{s.symbol}</span>
                        <Badge color={dirColor(s.direction)}>{(s.direction||"hold").toUpperCase()}</Badge>
                      </div>
                      <div style={{ fontSize:9.5, color:T.cyan, marginBottom:4, fontWeight:600 }}>
                        {(s.strategy ?? "unknown").replace(/_/g," ").toUpperCase()}
                      </div>
                      <div style={{ fontSize:10, color:T.fg, marginBottom:3 }}>
                        Conf: <span style={{ color:s.confidence>=0.7?T.up:s.confidence>=0.5?T.warn:T.dn, fontWeight:700 }}>{pct(s.confidence??0)}</span>
                      </div>
                      {s.reasoning && (
                        <div style={{ fontSize:9, color:T.fg3, lineHeight:1.3, borderTop:`1px solid ${T.brd}`, paddingTop:4, marginTop:4 }}>
                          {s.reasoning.length > 80 ? s.reasoning.slice(0,80)+"…" : s.reasoning}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          {/* Sentiment */}
          <Panel title="Sentiment" tip="Composite market sentiment. Drives confidence adjustments.">
            {sentiment ? (() => {
              const comp = sentiment.composite ?? 0;
              const fg   = sentiment.fearGreed;
              const fgRaw = fg != null ? Math.round((fg+1)*50) : null;
              const fgLabel = fgRaw != null ? (fgRaw<=20?"Ext Fear":fgRaw<=40?"Fear":fgRaw<=60?"Neutral":fgRaw<=80?"Greed":"Ext Greed") : "—";
              const barW   = Math.abs(comp)*100;
              const barL   = comp>=0 ? 50 : 50-barW;
              const sc     = sentColor(comp);
              return (
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0, marginBottom:8, borderBottom:`1px solid ${T.brd}`, paddingBottom:6 }}>
                    <Metric label="Composite" value={fmt(comp)} sub={sentLabel(comp)} color={sc} />
                    <Metric label="Fear&Greed" value={fgRaw != null ? String(fgRaw) : "—"} sub={fgLabel} color={fgRaw!=null?(fgRaw>60?T.up:fgRaw<40?T.dn:T.warn):T.fg3} />
                  </div>
                  {sentiment.newsSentiment != null && <KV k="News" v={fmt(sentiment.newsSentiment)} c={sentiment.newsSentiment>0.1?T.up:sentiment.newsSentiment<-0.1?T.dn:T.warn} />}
                  {sentiment.fundingRate   != null && <KV k="Funding" v={fmt(sentiment.fundingRate)} c={sentiment.fundingRate>0.1?T.up:sentiment.fundingRate<-0.1?T.dn:T.warn} />}
                  {sentiment.socialSentiment != null && <KV k="Social" v={fmt(sentiment.socialSentiment)} c={sentiment.socialSentiment>0.1?T.up:sentiment.socialSentiment<-0.1?T.dn:T.warn} />}
                  <div style={{ position:"relative", height:10, background:T.bg, borderRadius:4, overflow:"hidden", border:`1px solid ${T.brd}`, marginTop:8 }}>
                    <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:T.fg3 }} />
                    <div style={{ position:"absolute", left:`${barL}%`, top:1, bottom:1, width:`${barW}%`, background:sc, borderRadius:3, opacity:.7, transition:"all .5s" }} />
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:7.5, color:T.fg3, marginTop:3 }}>
                    <span>FEAR</span><span>GREED</span>
                  </div>
                </div>
              );
            })() : (
              <div style={{ color:T.fg3, fontSize:10, textAlign:"center", padding:16 }}>Awaiting sentiment data…</div>
            )}
          </Panel>

          {/* Trust Scorecard */}
          <Panel title="Trust Scorecard" tag={`${fmt(tScore,0)}%`}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ fontSize:16, fontWeight:700, color:tierColor(tier) }}>{tier.toUpperCase()}</span>
              <span style={{ fontSize:10, color:T.fg2 }}>size {fmt(tSize,0)}%</span>
            </div>
            {Object.entries(dims).map(([key, dim]) => {
              const label = { policyCompliance:"Policy", riskDiscipline:"Risk Disc", validationCompleteness:"Validation", outcomeQuality:"Outcome" }[key] ?? key;
              const score = dim?.score ?? 0;
              const c = score > 0.75 ? T.up : score > 0.5 ? T.warn : T.dn;
              return (
                <div key={key} style={{ marginBottom:6 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:2 }}>
                    <span style={{ color:T.fg2 }}>{label}</span>
                    <span style={{ color:c }}>{pct(score)}</span>
                  </div>
                  <Bar value={score} color={c} />
                </div>
              );
            })}
            <div style={{ marginTop:8 }}>
              <KV k="Chain Integrity" v={intact ? "✓ Valid" : "✗ Broken"} c={intact?T.up:T.dn} />
              <KV k="IPFS Pinned"     v={gov.ipfsPinnedCount ?? 0} />
            </div>
          </Panel>
        </div>

        {/* ── Row 2: Governance Pipeline (full width) ── */}
        <Panel title="Governance Pipeline" tag="18-stage ERC-8004" tip="Every trade passes through 18 deterministic stages." full style={{ marginBottom:10 }}>
          <div style={{ fontSize:9.5, color:T.fg2, marginBottom:8 }}>
            Every signal traverses 18 gate stages — only trades that clear all checks execute on-chain.
          </div>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
            {PIPELINE_STAGES.map((s,i) => {
              const done   = i < stagesDone;
              const active = hasActiveStage && i === stagesDone;
              const c = done ? T.up : active ? T.warn : T.fg3;
              return (
                <div key={i} style={{
                  fontSize:9, padding:"4px 8px", borderRadius:3,
                  background: done ? `${T.up}12` : active ? `${T.warn}12` : T.bg,
                  border:`1px solid ${done?`${T.up}30`:active?`${T.warn}40`:T.brd}`,
                  color:c, fontWeight:done?600:400, transition:"all .3s",
                  position:"relative",
                }}>
                  {active && <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:T.warn, borderRadius:2 }} />}
                  {done   && <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:T.up, borderRadius:2 }} />}
                  <div style={{ fontSize:7, color:T.fg3, marginBottom:1 }}>{String(i+1).padStart(2,"0")}</div>
                  {s}
                  <div style={{ fontSize:7, color:c, marginTop:1 }}>{done?"PASS":active?"ACTIVE":"PEND"}</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:8, display:"flex", gap:16, fontSize:10, color:T.fg2 }}>
            <span><span style={{ color:T.up }}>■</span> Passed ({stagesDone})</span>
            {hasActiveStage && <span><span style={{ color:T.warn }}>■</span> Active</span>}
            <span><span style={{ color:T.fg3 }}>■</span> {cpList[0]?.eventType === "signal" ? "Skipped — HOLD signal" : `Pending (${18-stagesDone})`}</span>
          </div>
        </Panel>

        {/* ── Row 3: Decision Engine (clickable table) ── */}
        <Panel title="Decision Engine" tag={`${cpList.length} decisions`} tip="Chronological log of every trade decision with signals and artifacts." full noPad style={{ marginBottom:10 }}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:900 }}>
              <thead>
                <tr style={{ background:T.s2 }}>
                  {["#","Time","Event","Symbol","Signal","Strategy","Price","Size","CP Hash"].map(h => (
                    <th key={h} style={{ textAlign:"left", padding:"5px 8px", fontSize:8, letterSpacing:1.2, color:T.fg3, fontWeight:600, borderBottom:`1px solid ${T.brd}`, whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cpList.map((c, i) => (
                  <tr key={c.id} onClick={()=>setSelCpIdx(i)} style={{
                    background: i===selCpIdx ? `${T.info}08` : "transparent",
                    cursor:"pointer", borderBottom:`1px solid ${T.brd}30`,
                    transition:"background .1s",
                  }}>
                    <td style={{ padding:"5px 8px", color:T.fg3 }}>{c.id}</td>
                    <td style={{ padding:"5px 8px", color:T.fg2, whiteSpace:"nowrap" }}>{new Date(c.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding:"5px 8px" }}><Badge color={eventColor(c.eventType)}>{c.eventType}</Badge></td>
                    <td style={{ padding:"5px 8px", color:T.w, fontWeight:600 }}>{c.symbol}</td>
                    <td style={{ padding:"5px 8px", color:dirColor(c.signal), fontWeight:700 }}>{c.signal?.toUpperCase()}</td>
                    <td style={{ padding:"5px 8px", color:T.fg2 }}>{c.data?.strategy ?? "—"}</td>
                    <td style={{ padding:"5px 8px" }}>{c.data?.price ? `$${fmt(c.data.price,4)}` : "—"}</td>
                    <td style={{ padding:"5px 8px" }}>{c.data?.positionSize ?? c.data?.size ? fmt(c.data.positionSize??c.data.size,6) : "—"}</td>
                    <td style={{ padding:"5px 8px", color:T.fg3, fontFamily:"monospace", fontSize:9 }}>{c.hash?.slice(0,16)}…</td>
                  </tr>
                ))}
                {cpList.length === 0 && (
                  <tr><td colSpan={9} style={{ padding:"12px 8px", color:T.fg3 }}>No checkpoints recorded yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── Row 4: Deep dive + AI Reasoning + Strategy Scores + Governance ── */}
        <div className="col3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10, marginBottom:10 }}>

          {/* Selected Checkpoint Detail */}
          {(() => {
            const sel = cpList[selCpIdx] ?? null;
            return (
              <Panel title="Trade Proof" tag={sel ? `CP #${sel.id} · ${sel.eventType}` : "Select row above"}>
                {sel ? (
                  <div>
                    <div style={{ marginBottom:8, paddingBottom:6, borderBottom:`1px solid ${eventColor(sel.eventType)}20` }}>
                      <span style={{ fontSize:13, fontWeight:800, color:eventColor(sel.eventType) }}>{sel.eventType?.toUpperCase()}</span>
                      <span style={{ fontSize:10, color:T.fg2, marginLeft:8 }}>{sel.symbol}</span>
                    </div>
                    <KV k="Signal"     v={(sel.signal||"—").toUpperCase()} c={dirColor(sel.signal)} />
                    <KV k="Strategy"   v={sel.data?.strategy ?? "—"} />
                    <KV k="Confidence" v={sel.data?.confidence ? pct(sel.data.confidence) : "—"} />
                    <KV k="Price"      v={sel.data?.price ? `$${fmt(sel.data.price,4)}` : "—"} />
                    <KV k="Size"       v={sel.data?.positionSize ? fmt(sel.data.positionSize,6) : "—"} />
                    {sel.data?.pnl != null && <KV k="P&L" v={`${sel.data.pnl>=0?"+":""}${usd(sel.data.pnl)}`} c={sel.data.pnl>=0?T.up:T.dn} />}
                    <KV k="Trust Tier" v={sel.data?.supervisoryTier ?? "—"} c={T.info} />
                    <KV k="Slippage"   v={sel.data?.simSlippageBps ? `${fmt(sel.data.simSlippageBps,1)}bps` : "—"} />
                    <KV k="Net Edge"   v={sel.data?.netEdgePct ? pct(sel.data.netEdgePct,3) : "—"} c={T.up} />
                    <div style={{ marginTop:8, paddingTop:6, borderTop:`1px solid ${T.brd}` }}>
                      <div style={{ fontSize:8.5, color:T.fg3, marginBottom:4, letterSpacing:1 }}>ARTIFACTS</div>
                      <KV k="CP Hash" v={sel.hash?.slice(0,24)+"…"} mono />
                      {sel.ipfsCid && <KV k="IPFS CID" v={sel.ipfsCid.slice(0,24)+"…"} c={T.info} mono />}
                      {sel.txHash  && <KV k="Tx Hash"  v={sel.txHash.slice(0,24)+"…"}  c={T.cyan} mono />}
                    </div>
                  </div>
                ) : (
                  <div style={{ color:T.fg3, fontSize:10, textAlign:"center", padding:20 }}>Click a row in Decision Engine above</div>
                )}
              </Panel>
            );
          })()}

          {/* AI Reasoning */}
          <Panel title="AI Reasoning" tag={narrative ? `via ${narrative.source}` : "awaiting trade"} tip="Natural language explanation of the latest trade decision.">
            {narrative ? (
              <div style={{ fontSize:10, lineHeight:1.7, color:T.fg }}>
                <div style={{ color:T.info, fontWeight:600, fontSize:10.5, marginBottom:8 }}>
                  {narrative.symbol} · {new Date(narrative.timestamp).toLocaleTimeString()}
                </div>
                <div style={{ color:T.fg2, fontSize:10, lineHeight:1.8, padding:"8px 10px", background:T.bg, borderRadius:4, border:`1px solid ${T.brd}` }}>
                  {narrative.narrative}
                </div>
                <div style={{ marginTop:8, fontSize:9, color:T.fg3 }}>
                  Source: <span style={{ color:narrative.source==="claude"?T.purple:narrative.source==="groq"?T.cyan:T.fg2, fontWeight:600 }}>{narrative.source?.toUpperCase()}</span>
                </div>
              </div>
            ) : (
              <div style={{ color:T.fg3, fontSize:10, textAlign:"center", padding:20 }}>
                <div style={{ marginBottom:8, fontSize:13 }}>🤖</div>
                Awaiting first trade for AI narrative…
                <div style={{ marginTop:8, fontSize:9, color:T.fg3 }}>Chain: Claude → Groq → Template</div>
              </div>
            )}
          </Panel>

          {/* Strategy Scores */}
          <Panel title="Strategy Scores" tag={strategyEvals ? strategyEvals.symbol : "awaiting"} tip="Confidence score each strategy computed last cycle. Min threshold shown.">
            {strategyEvals ? (
              <div>
                {strategyEvals.evaluations.map(e => {
                  const c = e.signal !== "hold" ? T.up : e.confidence > 0.3 ? T.warn : T.fg3;
                  const barVal = e.confidence;
                  return (
                    <div key={e.name} style={{ marginBottom:7 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, marginBottom:2 }}>
                        <span style={{ color: e.signal !== "hold" ? T.up : T.fg2 }}>{e.name.replace(/_/g," ")}</span>
                        <span style={{ color:c, fontWeight:600 }}>{e.signal !== "hold" ? `${e.signal.toUpperCase()} ` : ""}{pct(e.confidence)}</span>
                      </div>
                      <div style={{ height:4, background:T.bg, borderRadius:2, overflow:"hidden", position:"relative" }}>
                        <div style={{ height:"100%", width:`${clamp(barVal,0,1)*100}%`, background:c, borderRadius:2, transition:"width .5s" }} />
                        {/* threshold marker at 40% */}
                        <div style={{ position:"absolute", top:0, bottom:0, left:"40%", width:1, background:`${T.warn}80` }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop:6, fontSize:9, color:T.fg3 }}>Vertical line = 40% threshold · ICT/AMD only fire in Kill Zones</div>
              </div>
            ) : (
              <div style={{ color:T.fg3, fontSize:10, textAlign:"center", padding:16 }}>Awaiting first cycle…</div>
            )}
          </Panel>

          {/* Governance Counters + SAGE */}
          <Panel title="Governance" tag="18-stage">
            <KV k="Total Signals"    v={gov.totalSignals     ?? 0} />
            <KV k="Vetoed"           v={gov.vetoedTrades     ?? 0} c={(gov.vetoedTrades??0)>0?T.warn:T.fg} />
            <KV k="Mandate Violations" v={gov.mandateViolations ?? 0} c={(gov.mandateViolations??0)>0?T.dn:T.fg} />
            <KV k="IPFS Pinned"      v={gov.ipfsPinnedCount  ?? 0} c={T.cyan} />
            <KV k="Trades W/L"       v={`${trStats.wins??0}/${trStats.losses??0}`} c={T.up} />
            <KV k="Win Rate"         v={trStats.total>0?pct(trStats.winRate):"-"} c={T.up} />
            <div style={{ borderTop:`1px solid ${T.brd}`, marginTop:8, paddingTop:8 }}>
              <div style={{ fontSize:9, color:T.fg3, marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 }}>SAGE Engine</div>
              <KV k="Adaptations"    v={sage?.totalAdaptations ?? 0} />
              <KV k="Last reflection" v={sage?.lastReflectionAt ? new Date(sage.lastReflectionAt).toLocaleTimeString() : "—"} />
              <KV k="Enabled"        v={sage?.enabled ? "yes" : "no"} c={sage?.enabled?T.up:T.fg2} />
            </div>
          </Panel>
        </div>

        {/* ── Row 5: Capital Ladder · Open Positions · Operator Controls ── */}
        <div className="col3" style={{ display:"grid", gridTemplateColumns:"220px 1fr 220px", gap:10, marginBottom:10 }}>

          {/* Trust + Capital Ladder */}
          <Panel title="Capital Ladder" tag={tier.toUpperCase()} tip="ERC-8004 tier progression — higher tiers unlock larger position sizes.">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:0, marginBottom:8 }}>
              <div>
                <div style={{ fontSize:8, color:T.fg3 }}>TRUST SCORE</div>
                <div style={{ fontSize:18, fontWeight:700, color:truC(tScore) }}>{fmt(tScore,0)}</div>
                <div style={{ fontSize:9, color:T.fg2 }}>{tier.toUpperCase()}</div>
              </div>
              <div>
                <div style={{ fontSize:8, color:T.fg3 }}>SIZE FACTOR</div>
                <div style={{ fontSize:18, fontWeight:700, color:T.info }}>{fmt(tSize,0)}%</div>
                <div style={{ fontSize:9, color:T.fg2 }}>of max pos</div>
              </div>
            </div>
            <div style={{ display:"grid", gap:3, marginTop:4 }}>
              {[
                { label:"T0 Blocked",   min:0,   mult:0,    threshold:"< 55" },
                { label:"T1 Probation", min:55,  mult:0.25, threshold:"55–69" },
                { label:"T2 Limited",   min:70,  mult:0.5,  threshold:"70–79" },
                { label:"T3 Standard",  min:80,  mult:1.0,  threshold:"80–89" },
                { label:"T4 Elevated",  min:90,  mult:1.25, threshold:"≥ 90" },
              ].map(x => {
                const active = tScore >= x.min && (x.min === 90 ? true : tScore < x.min + (x.min===0?55:x.min===55?15:x.min===70?10:10));
                const c = active ? truC(tScore) : T.fg3;
                return (
                  <div key={x.label} style={{
                    display:"flex", alignItems:"center", gap:8, padding:"4px 8px",
                    borderRadius:3, background: active ? `${c}0a` : "transparent",
                    border:`1px solid ${active ? `${c}20` : `${T.brd}40`}`,
                  }}>
                    <span style={{ fontSize:9, fontWeight:700, color:c, minWidth:80 }}>{x.label}</span>
                    <div style={{ flex:1, height:3, borderRadius:2, background:T.bg, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${(x.mult/1.25)*100}%`, background:active?c:T.fg3, borderRadius:2 }} />
                    </div>
                    <span style={{ fontSize:9, color:active?T.w:T.fg3, minWidth:32, textAlign:"right" }}>{x.mult.toFixed(2)}x</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Open Positions */}
          <Panel title="Open Positions" tag={`${positions.length} open`} noPad>
            {positions.length === 0 ? (
              <div style={{ padding:"12px", color:T.fg3, fontSize:10 }}>No open positions</div>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5, minWidth:600 }}>
                  <thead>
                    <tr style={{ color:T.fg3 }}>
                      {["#","Symbol","Side","Size","Entry","Stop","TP","Strategy","Opened"].map(h => (
                        <th key={h} style={{ textAlign:"left", padding:"4px 8px", borderBottom:`1px solid ${T.brd}`, fontWeight:600, fontSize:9 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={p.id} style={{ borderBottom:`1px solid ${T.brd}30` }}>
                        <td style={{ padding:"4px 8px", color:T.fg3 }}>{p.id}</td>
                        <td style={{ padding:"4px 8px", color:T.w, fontWeight:600 }}>{p.symbol}</td>
                        <td style={{ padding:"4px 8px", color:dirColor(p.side), fontWeight:600 }}>{p.side?.toUpperCase()}</td>
                        <td style={{ padding:"4px 8px" }}>{fmt(p.size,6)}</td>
                        <td style={{ padding:"4px 8px" }}>${fmt(p.entryPrice,4)}</td>
                        <td style={{ padding:"4px 8px", color:T.dn }}>{p.stopLoss?`$${fmt(p.stopLoss,4)}`:"—"}</td>
                        <td style={{ padding:"4px 8px", color:T.up }}>{p.takeProfit?`$${fmt(p.takeProfit,4)}`:"—"}</td>
                        <td style={{ padding:"4px 8px", color:T.fg3 }}>{p.strategy}</td>
                        <td style={{ padding:"4px 8px", color:T.fg2 }}>{new Date(p.openedAt).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Operator Controls */}
          <Panel title="Operator Controls" tag={opState}>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:9, color:T.fg3, marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 }}>Agent Mode</div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <Dot color={opState==="ACTIVE"?T.up:opState==="PAUSED"?T.warn:T.dn} pulse={opState==="ACTIVE"} />
                <span style={{ fontWeight:700, fontSize:12, color:opState==="ACTIVE"?T.up:opState==="PAUSED"?T.warn:T.dn }}>{opState}</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <button onClick={()=>opPost("/api/operator/resume","manual_operator_resume")} disabled={opState==="ACTIVE"} style={btn(T.up, opState==="ACTIVE")}>▶ Resume</button>
                <button onClick={()=>opPost("/api/operator/pause","manual_operator_pause")} disabled={opState==="PAUSED"} style={btn(T.warn, opState==="PAUSED")}>⏸ Pause</button>
                <button onClick={()=>opPost("/api/operator/emergency-stop","manual_emergency")} disabled={opState==="EMERGENCY_STOP"} style={btn(T.dn, opState==="EMERGENCY_STOP")}>⛔ Emergency Stop</button>
              </div>
            </div>
            {opLog.length > 0 && (
              <div style={{ borderTop:`1px solid ${T.brd}`, paddingTop:8 }}>
                <div style={{ fontSize:9, color:T.fg3, marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 }}>Action Log</div>
                {opLog.slice(0,5).map((l,i) => (
                  <div key={i} style={{ fontSize:9.5, padding:"2px 0", borderBottom:`1px solid ${T.brd}20`, display:"flex", gap:6 }}>
                    <span style={{ color:T.fg3 }}>{l.ts}</span>
                    <span style={{ color:l.action==="pause"?T.warn:l.action==="emergency_stop"?T.dn:T.up, fontWeight:600 }}>{l.action}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ── Row 6: Trade History ── */}
        <Panel title="Trade History" tag={`${trStats.total??0} closed`} full style={{ marginBottom:10 }} noPad>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5, minWidth:700 }}>
              <thead>
                <tr style={{ color:T.fg3, background:T.s2 }}>
                  {["Symbol","Dir","Entry","Exit","P&L","P&L%","Strategy","Duration","Exit Reason"].map(h => (
                    <th key={h} style={{ textAlign:"left", padding:"4px 8px", borderBottom:`1px solid ${T.brd}`, fontWeight:600, fontSize:9 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tradeList.map(t => {
                  const won = t.pnl >= 0;
                  return (
                    <tr key={t.tradeId} style={{ borderBottom:`1px solid ${T.brd}30` }}>
                      <td style={{ padding:"4px 8px", color:T.w, fontWeight:600 }}>{t.symbol}</td>
                      <td style={{ padding:"4px 8px", color:dirColor(t.direction) }}>{t.direction?.toUpperCase()}</td>
                      <td style={{ padding:"4px 8px" }}>${fmt(t.entryPrice,4)}</td>
                      <td style={{ padding:"4px 8px" }}>${fmt(t.exitPrice,4)}</td>
                      <td style={{ padding:"4px 8px", color:won?T.up:T.dn }}>{won?"+":""}{usd(t.pnl)}</td>
                      <td style={{ padding:"4px 8px", color:won?T.up:T.dn }}>{won?"+":""}{pct(t.pnlPct)}</td>
                      <td style={{ padding:"4px 8px", color:T.fg3 }}>{t.strategy}</td>
                      <td style={{ padding:"4px 8px", color:T.fg2 }}>{t.durationMs?`${Math.round(t.durationMs/60000)}m`:"—"}</td>
                      <td style={{ padding:"4px 8px", color:T.fg3 }}>{t.exitReason}</td>
                    </tr>
                  );
                })}
                {tradeList.length === 0 && (
                  <tr><td colSpan={9} style={{ padding:"12px 8px", color:T.fg3 }}>No closed trades yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── Row 7: Checkpoint Chain + Log Stream ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>

          {/* Checkpoint Chain */}
          <Panel title="Checkpoint Chain" tag={intact?"✓ intact":"✗ broken"} noPad>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5 }}>
                <thead>
                  <tr style={{ color:T.fg3 }}>
                    {["#","Time","Event","Symbol","Signal","Hash"].map(h => (
                      <th key={h} style={{ textAlign:"left", padding:"3px 8px", borderBottom:`1px solid ${T.brd}`, fontWeight:600, fontSize:9 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cpList.slice(0,15).map(c => (
                    <tr key={c.id} style={{ borderBottom:`1px solid ${T.brd}20` }}>
                      <td style={{ padding:"3px 8px", color:T.fg3 }}>{c.id}</td>
                      <td style={{ padding:"3px 8px", color:T.fg2 }}>{new Date(c.timestamp).toLocaleTimeString()}</td>
                      <td style={{ padding:"3px 8px" }}><Badge color={eventColor(c.eventType)}>{c.eventType}</Badge></td>
                      <td style={{ padding:"3px 8px", color:T.w }}>{c.symbol}</td>
                      <td style={{ padding:"3px 8px", color:dirColor(c.signal) }}>{c.signal}</td>
                      <td style={{ padding:"3px 8px", color:T.fg3, fontFamily:"monospace", fontSize:9 }}>{c.hash?.slice(0,16)}…</td>
                    </tr>
                  ))}
                  {cpList.length === 0 && (
                    <tr><td colSpan={6} style={{ padding:"8px", color:T.fg3 }}>No checkpoints yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Log Stream */}
          <Panel title="Log Stream" tag="live">
            <div style={{
              maxHeight:220, overflowY:"auto", fontFamily:"monospace", fontSize:10.5,
              background:T.bg, borderRadius:4, padding:8,
            }}>
              {logs.slice().reverse().map((l,i) => {
                const c = l.level==="ERROR"?T.dn : l.level==="WARN"?T.warn : l.level==="INFO"?T.fg : T.fg3;
                return (
                  <div key={i} style={{ padding:"1px 0", color:c, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                    <span style={{ color:T.fg3 }}>{l.time ? new Date(l.time).toLocaleTimeString() : ""} </span>
                    <span style={{ color:T.fg2 }}>[{l.logger}] </span>
                    {l.msg}
                  </div>
                );
              })}
              {logs.length === 0 && <span style={{ color:T.fg3 }}>No logs yet</span>}
            </div>
          </Panel>
        </div>

      </div>
    </div>
  );
}
