import React, { useState, useEffect, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════════════════
   SENTINEL v3 — Institutional SMC Trading Agent
   ERC-8004 Trust-Governed · 18-Stage Governance Pipeline
   Live Proof Dashboard · Production Control Plane
   ═══════════════════════════════════════════════════════════════════════ */

const T = {
  bg:  "#080b11", s1: "#0c1018", s2: "#111621", s3: "#161c29",
  brd: "#1c2536", brdA: "#253045",
  fg:  "#c9d1dc", fg2: "#7c8a9e", fg3: "#4b5668", w: "#edf2f7",
  up:  "#34d399", dn: "#f87171", warn: "#fbbf24",
  info: "#60a5fa", cyan: "#22d3ee", purple: "#a78bfa",
};

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

// ── Primitives ─────────────────────────────────────────────────────────────

function Dot({ color, pulse }) {
  return (
    <span style={{
      display:"inline-block", width:7, height:7, borderRadius:"50%",
      background: color, flexShrink:0,
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
    <div style={{ height, background:`${T.s1}`, borderRadius:2, overflow:"hidden", marginTop:3 }}>
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
  const gid = `sg${c.replace("#","")}`;
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

function Panel({ title, tag, children, style: sx, full }) {
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
        <span style={{ fontSize:10.5, fontWeight:700, color:T.fg, letterSpacing:0.4 }}>{title}</span>
        {tag && <span style={{ fontSize:8.5, color:T.fg3, fontWeight:600 }}>{tag}</span>}
      </div>
      <div style={{ padding:"8px 12px", flex:1 }}>{children}</div>
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

// ── Tier helpers ───────────────────────────────────────────────────────────

function tierColor(tier) {
  if (tier === "elite")    return T.purple;
  if (tier === "elevated") return T.up;
  if (tier === "standard") return T.info;
  if (tier === "limited")  return T.warn;
  return T.dn;
}

function dirColor(d) {
  if (d === "buy"  || d === "BUY")  return T.up;
  if (d === "sell" || d === "SELL") return T.dn;
  return T.fg2;
}

function eventColor(e) {
  if (e === "trade")    return T.up;
  if (e === "halt")     return T.dn;
  if (e === "veto")     return T.warn;
  if (e === "close")    return T.info;
  return T.fg3;
}

// ── Error boundary ────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────

function Sentinel() {
  const [status,      setStatus]      = useState(null);
  const [risk,        setRisk]        = useState(null);
  const [trust,       setTrust]       = useState(null);
  const [checkpoints, setCheckpoints] = useState({ checkpoints:[], stats:{}, integrity:{} });
  const [positions,   setPositions]   = useState([]);
  const [trades,      setTrades]      = useState({ trades:[], stats:{} });
  const [sage,        setSage]        = useState(null);
  const [logs,        setLogs]        = useState([]);
  const [equityHist,  setEquityHist]  = useState([10000]);
  const [online,      setOnline]      = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);

  async function fetchAll() {
    try {
      const [s, r, tr, cp, pos, td, sg, lg] = await Promise.all([
        fetch("/api/status").then(x=>x.json()),
        fetch("/api/risk").then(x=>x.json()),
        fetch("/api/trust").then(x=>x.json()),
        fetch("/api/checkpoints?limit=15").then(x=>x.json()),
        fetch("/api/positions").then(x=>x.json()),
        fetch("/api/trades?limit=20").then(x=>x.json()),
        fetch("/api/sage").then(x=>x.json()),
        fetch("/api/logs?limit=60").then(x=>x.json()),
      ]);
      setStatus(s); setRisk(r); setTrust(tr);
      setCheckpoints(cp); setPositions(pos); setTrades(td);
      setSage(sg); setLogs(lg);
      setOnline(true);
      setLastUpdate(new Date());
      if (r?.equity) setEquityHist(h => [...h.slice(-71), r.equity]);
    } catch {
      setOnline(false);
    }
  }

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 4000); return ()=>clearInterval(id); }, []);

  const eq      = risk?.equity    ?? 10000;
  const dpnl    = risk?.dailyPnl  ?? 0;
  const dd      = (risk?.drawdown ?? 0) * 100;
  const openPos = risk?.openPositions ?? 0;
  const cycle   = status?.cycle  ?? 0;
  const halted  = status?.halted ?? false;
  const mode    = status?.executionMode ?? "paper";
  const testMode = status?.testMode ?? false;
  const opMode  = status?.operatorMode ?? "normal";
  const signals = status?.signals ?? [];
  const gov     = status?.governance ?? {};
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

  const stagesDone = useMemo(() => {
    if (!cpList.length) return 0;
    const last = cpList[0];
    if (last.eventType === "trade")      return 18;
    if (last.eventType === "close")      return 15;
    if (last.eventType === "heartbeat")  return 8;
    if (last.eventType === "veto")       return 10;
    if (last.eventType === "halt")       return 12;
    return 3;
  }, [cpList]);

  return (
    <div style={{ background:T.bg, minHeight:"100vh", fontFamily:"'JetBrains Mono','SF Mono','Cascadia Code',monospace", fontSize:12 }}>

      {/* ── Status bar ── */}
      <div style={{
        background:T.s2, borderBottom:`1px solid ${T.brd}`,
        padding:"0 20px", height:46, display:"flex", alignItems:"center", gap:16,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <Dot color={online ? T.up : T.dn} pulse={online} />
          <span style={{ fontSize:13, fontWeight:700, color:T.w, letterSpacing:2 }}>SENTINEL v3</span>
        </div>
        <Badge color={online ? T.up : T.dn}>{online ? "LIVE" : "OFFLINE"}</Badge>
        <Badge color={T.info}>{mode.toUpperCase()}</Badge>
        {testMode && <Badge color={T.warn}>TEST MODE</Badge>}
        {halted   && <Badge color={T.dn}>HALTED</Badge>}
        {opMode !== "normal" && <Badge color={T.warn}>{opMode.toUpperCase()}</Badge>}
        <Badge color={tierColor(tier)}>{tier.toUpperCase()}</Badge>

        <div style={{ marginLeft:"auto", display:"flex", gap:20, alignItems:"center" }}>
          <span style={{ fontSize:10, color:T.fg3 }}>CYCLE <span style={{ color:T.fg }}>{cycle}</span></span>
          <span style={{ fontSize:10, color:T.fg3 }}>CP <span style={{ color:T.fg }}>{cpStats.total ?? 0}</span></span>
          <span style={{ fontSize:10, color:T.fg3 }}>POSITIONS <span style={{ color:openPos>0?T.up:T.fg }}>{openPos}</span></span>
          <span style={{ fontSize:10, color:T.fg3 }}>
            {lastUpdate ? lastUpdate.toLocaleTimeString() : "—"}
          </span>
        </div>
      </div>

      {/* ── Grid ── */}
      <div style={{
        display:"grid",
        gridTemplateColumns:"220px 220px 220px 1fr",
        gridTemplateRows:"auto",
        gap:10, padding:12,
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
            <KV k="Open"       v={openPos}                             c={openPos>0?T.cyan:T.fg2} />
          </div>
        </Panel>

        {/* Trust Scorecard */}
        <Panel title="Trust Scorecard" tag={`${fmt(tScore,0)}%`}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
            <span style={{ fontSize:18, fontWeight:700, color:tierColor(tier) }}>{tier.toUpperCase()}</span>
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

        {/* Governance counters */}
        <Panel title="Governance" tag="18-stage">
          <KV k="Total Signals"    v={gov.totalSignals   ?? 0} />
          <KV k="Vetoed"           v={gov.vetoedTrades   ?? 0} c={T.warn} />
          <KV k="Mandate Violations" v={gov.mandateViolations ?? 0} c={(gov.mandateViolations??0)>0?T.dn:T.fg} />
          <KV k="Trades (W/L)"    v={`${trStats.wins??0}/${trStats.losses??0}`} c={T.cyan} />
          <KV k="Win Rate"        v={trStats.total>0?pct(trStats.winRate):"-"} c={T.up} />
          <div style={{ borderTop:`1px solid ${T.brd}`, marginTop:8, paddingTop:8 }}>
            <div style={{ fontSize:9, color:T.fg3, marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 }}>SAGE Engine</div>
            <KV k="Adaptations"    v={sage?.totalAdaptations ?? 0} />
            <KV k="Last reflection" v={sage?.lastReflectionAt ? new Date(sage.lastReflectionAt).toLocaleTimeString() : "—"} />
            <KV k="Enabled"        v={sage?.enabled ? "yes" : "no"} c={sage?.enabled?T.up:T.fg2} />
          </div>
        </Panel>

        {/* Pipeline */}
        <Panel title="Governance Pipeline" tag="latest cycle" style={{ gridColumn:"4" }}>
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", padding:"4px 0" }}>
            {PIPELINE_STAGES.map((s,i) => {
              const done   = i < stagesDone;
              const active = i === stagesDone;
              const c = done ? T.up : active ? T.warn : T.fg3;
              return (
                <div key={i} style={{
                  fontSize:9, padding:"3px 7px", borderRadius:3,
                  background: done ? `${T.up}18` : active ? `${T.warn}18` : `${T.s3}`,
                  border:`1px solid ${done?T.up:active?T.warn:T.brd}`,
                  color:c, fontWeight:done?600:400,
                  transition:"all .3s",
                }}>
                  {i+1}. {s}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:8, display:"flex", gap:12, fontSize:10, color:T.fg2 }}>
            <span><span style={{ color:T.up }}>■</span> Passed</span>
            <span><span style={{ color:T.warn }}>■</span> Active</span>
            <span><span style={{ color:T.fg3 }}>■</span> Pending</span>
          </div>
        </Panel>

        {/* Live Signals */}
        <Panel title="Live Signals" tag={`${signals.length} symbols`} full>
          <div style={{ display:"grid", gridTemplateColumns:`repeat(${Math.min(signals.length,5)},1fr)`, gap:8 }}>
            {signals.map(s => (
              <div key={s.symbol} style={{
                background:T.s2, borderRadius:5, padding:"10px 12px",
                border:`1px solid ${s.direction==="buy"?`${T.up}40`:s.direction==="sell"?`${T.dn}40`:T.brd}`,
              }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontWeight:700, color:T.w }}>{s.symbol}</span>
                  <Badge color={dirColor(s.direction)}>{(s.direction||"hold").toUpperCase()}</Badge>
                </div>
                <div style={{ fontSize:10, color:T.fg2, marginBottom:4 }}>{s.strategy ?? "—"}</div>
                <div style={{ fontSize:10, color:T.fg }}>Conf: <span style={{ color:s.confidence>0.6?T.up:T.warn }}>{pct(s.confidence??0)}</span></div>
              </div>
            ))}
            {signals.length === 0 && <span style={{ color:T.fg3 }}>No signals yet</span>}
          </div>
        </Panel>

        {/* Open Positions */}
        <Panel title="Open Positions" tag={`${positions.length} open`} full>
          {positions.length === 0 ? (
            <span style={{ color:T.fg3 }}>No open positions</span>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5 }}>
              <thead>
                <tr style={{ color:T.fg3 }}>
                  {["#","Symbol","Side","Size","Entry","Stop","Take Profit","Opened","Strategy"].map(h=>(
                    <th key={h} style={{ textAlign:"left", padding:"3px 8px", borderBottom:`1px solid ${T.brd}`, fontWeight:600 }}>{h}</th>
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
                    <td style={{ padding:"4px 8px", color:T.fg2 }}>{new Date(p.openedAt).toLocaleTimeString()}</td>
                    <td style={{ padding:"4px 8px", color:T.fg3 }}>{p.strategy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* Trade History */}
        <Panel title="Trade History" tag={`${trStats.total??0} closed`} full>
          {tradeList.length === 0 ? (
            <span style={{ color:T.fg3 }}>No closed trades yet</span>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5 }}>
              <thead>
                <tr style={{ color:T.fg3 }}>
                  {["Symbol","Dir","Entry","Exit","P&L","P&L%","Strategy","Duration","Exit Reason"].map(h=>(
                    <th key={h} style={{ textAlign:"left", padding:"3px 8px", borderBottom:`1px solid ${T.brd}`, fontWeight:600 }}>{h}</th>
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
              </tbody>
            </table>
          )}
        </Panel>

        {/* Checkpoints */}
        <Panel title="Checkpoint Chain" tag={intact?"✓ intact":"✗ broken"} full>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10.5 }}>
            <thead>
              <tr style={{ color:T.fg3 }}>
                {["#","Time","Event","Symbol","Signal","Hash"].map(h=>(
                  <th key={h} style={{ textAlign:"left", padding:"3px 8px", borderBottom:`1px solid ${T.brd}`, fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cpList.map(c => (
                <tr key={c.id} style={{ borderBottom:`1px solid ${T.brd}20` }}>
                  <td style={{ padding:"3px 8px", color:T.fg3 }}>{c.id}</td>
                  <td style={{ padding:"3px 8px", color:T.fg2 }}>{new Date(c.timestamp).toLocaleTimeString()}</td>
                  <td style={{ padding:"3px 8px" }}>
                    <Badge color={eventColor(c.eventType)}>{c.eventType}</Badge>
                  </td>
                  <td style={{ padding:"3px 8px", color:T.w }}>{c.symbol}</td>
                  <td style={{ padding:"3px 8px", color:dirColor(c.signal) }}>{c.signal}</td>
                  <td style={{ padding:"3px 8px", color:T.fg3, fontFamily:"monospace", fontSize:10 }}>{c.hash?.slice(0,18)}…</td>
                </tr>
              ))}
              {cpList.length === 0 && (
                <tr><td colSpan={6} style={{ padding:"8px", color:T.fg3 }}>No checkpoints yet</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        {/* Log stream */}
        <Panel title="Log Stream" tag="live" full>
          <div style={{
            maxHeight:180, overflowY:"auto", fontFamily:"monospace", fontSize:10.5,
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
  );
}
