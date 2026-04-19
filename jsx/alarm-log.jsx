import { useState, useEffect, useRef } from "react";

const C = {
  bg:"#06080c", surface:"#0b0e15", panel:"#0d1118", panelAlt:"#0f1420",
  border:"#161d2b", borderHi:"#243045", text:"#c4d0e8", muted:"#3e506a",
  dim:"#1a2233", ok:"#00e676", warn:"#ffab00", err:"#ff3d57",
  crit:"#ff1a3a", info:"#29b6f6", cyan:"#00e5ff", accent:"#2d5fff",
  purple:"#9d6fff", orange:"#ff8c00", head:"#6b82aa", input:"#080b10",
};

const SEV_COLOR = { CRITICAL:C.crit, WARNING:C.warn, INFO:C.info, NOMINAL:C.ok };
const SEV_ICON  = { CRITICAL:"🔴", WARNING:"🟡", INFO:"🔵", NOMINAL:"🟢" };

const QOS_IMPACT = {
  cc_error:         { impact:"HIGH",   service:"Video/Audio continuity broken — viewer sees artefacts or freeze", etr:"ETR 290 P1 · CC Error", recovery:"Automatic on next I-frame" },
  pcr_jitter:       { impact:"MEDIUM", service:"Timing instability — decoder buffer stress, potential A/V lip-sync drift", etr:"ETR 290 P2 · PCR Accuracy", recovery:"Recovers if jitter < 40ms" },
  si_repetition:    { impact:"LOW",    service:"EPG/guide data delayed — no direct picture impact", etr:"ETR 290 P3 · SI Repetition", recovery:"Automatic on next SI cycle" },
  pat_error:        { impact:"CRITICAL",service:"Complete service loss — all decoders will lose lock", etr:"ETR 290 P1 · PAT Error", recovery:"Manual intervention may be required" },
  sync_loss:        { impact:"CRITICAL",service:"Entire TS stream lost — all services unavailable", etr:"ETR 290 P1 · Sync Loss", recovery:"Automatic on sync recovery" },
  analyse_result:   { impact:"NONE",   service:"Periodic analysis snapshot — no QoS degradation", etr:"ETR 290 Monitor", recovery:"N/A — informational only" },
  pmt_error:        { impact:"HIGH",   service:"Service descriptor failure — decoders may drop service", etr:"ETR 290 P1 · PMT Error", recovery:"Automatic on next PAT cycle" },
  transport_error:  { impact:"HIGH",   service:"Bit errors in transport stream — possible picture corruption", etr:"ETR 290 P2 · Transport Error", recovery:"FEC dependent" },
  network_timeout:  { impact:"CRITICAL",service:"Input stream lost — total outage on all downstream services", etr:"Stream Supervision", recovery:"Manual source check required" },
  bitrate_exceed:   { impact:"MEDIUM", service:"Mux overload — packet stuffing errors, buffer overflow risk", etr:"Mux Supervision", recovery:"Reduce bitrate or add stuffing" },
};

const IMPACT_COLOR = { CRITICAL:C.crit, HIGH:C.err, MEDIUM:C.warn, LOW:C.info, NONE:C.muted };

// ── Generate realistic mock events ────────────────────────────
function genEvents(n = 120) {
  const instances = ["decoder-1773309037146","encoder-0x1A2B","transcoder-PAL-HD","forwarder-SRT-1","analyser-main"];
  const types = Object.keys(QOS_IMPACT);
  const sevMap = {
    cc_error:"WARNING", pcr_jitter:"WARNING", si_repetition:"INFO",
    pat_error:"CRITICAL", sync_loss:"CRITICAL", analyse_result:"INFO",
    pmt_error:"WARNING", transport_error:"WARNING",
    network_timeout:"CRITICAL", bitrate_exceed:"WARNING",
  };
  const now = Date.now();
  return Array.from({ length:n }, (_, i) => {
    const type = types[Math.floor(Math.random()*types.length)];
    const sev  = sevMap[type];
    const ms   = now - i * (Math.random()*8000 + 2000);
    const d    = new Date(ms);
    return {
      id: `EVT-${(n-i).toString().padStart(4,"0")}`,
      ts: ms,
      utc: d.toISOString().replace("T"," ").replace("Z","").slice(0,23) + " UTC",
      instance: instances[Math.floor(Math.random()*instances.length)],
      severity: sev,
      status: Math.random() > 0.3 ? "ACTIVE" : "RESOLVED",
      event: type,
      pid: sev!=="INFO" ? `#${Math.floor(Math.random()*4000+256)}` : null,
      count: sev==="INFO" ? null : Math.floor(Math.random()*8+1),
      duration: sev==="RESOLVED" ? `${(Math.random()*60).toFixed(1)}s` : null,
    };
  });
}

const ALL_EVENTS = genEvents(120);

// ── Atoms ──────────────────────────────────────────────────────
const Dot = ({ color, size=7 }) => (
  <span style={{ display:"inline-block", width:size, height:size,
    borderRadius:"50%", background:color,
    boxShadow:`0 0 ${size}px ${color}88`, flexShrink:0 }}/>
);

const Badge = ({ label, color=C.ok, filled, small }) => (
  <span style={{ fontSize:small?8:9, fontWeight:800, letterSpacing:"0.1em",
    color: filled?"#06080c":color, background:filled?color:"transparent",
    border:`1px solid ${color}`, borderRadius:2,
    padding:small?"1px 4px":"1px 6px", textTransform:"uppercase",
    whiteSpace:"nowrap", display:"inline-block" }}>{label}</span>
);

const NavTab = ({ label, icon, active, alert, onClick }) => (
  <button onClick={onClick} style={{
    background:"none", border:"none", cursor:"pointer",
    padding:"6px 10px", display:"flex", flexDirection:"column",
    alignItems:"center", gap:2, opacity:active?1:0.4,
    borderBottom:active?`2px solid ${C.err}`:"2px solid transparent",
    position:"relative", transition:"all 0.15s",
  }}>
    {alert && <span style={{ position:"absolute", top:4, right:6,
      width:6, height:6, borderRadius:"50%", background:C.err,
      boxShadow:`0 0 6px ${C.err}` }}/>}
    <span style={{ fontSize:13 }}>{icon}</span>
    <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em",
      color:active?C.err:C.head, textTransform:"uppercase" }}>{label}</span>
  </button>
);

// ── QoS Detail Popup ──────────────────────────────────────────
function QoSPanel({ event, onClose }) {
  if (!event) return null;
  const qos  = QOS_IMPACT[event.event] || QOS_IMPACT.analyse_result;
  const sCol = SEV_COLOR[event.severity];
  const iCol = IMPACT_COLOR[qos.impact];
  const dur  = event.duration ? event.duration : `${((Date.now()-event.ts)/1000).toFixed(0)}s ongoing`;

  return (
    <div style={{
      position:"fixed", right:0, top:0, bottom:0, width:400,
      background:C.surface, borderLeft:`1px solid ${C.borderHi}`,
      display:"flex", flexDirection:"column", zIndex:100,
      boxShadow:`-12px 0 40px #00000088`,
      animation:"slideIn 0.18s ease",
    }}>
      <style>{`@keyframes slideIn{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>

      {/* Header */}
      <div style={{ padding:"12px 14px", borderBottom:`1px solid ${C.borderHi}`,
        background:C.panelAlt, display:"flex", justifyContent:"space-between",
        alignItems:"flex-start" }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
            <span style={{ fontSize:14 }}>{SEV_ICON[event.severity]}</span>
            <span style={{ fontSize:13, fontWeight:800, color:sCol,
              letterSpacing:"0.04em", textTransform:"uppercase" }}>{event.severity}</span>
            <Badge label={event.id} color={C.muted} small/>
          </div>
          <div style={{ fontFamily:"'Courier New',monospace", fontSize:11,
            color:C.cyan, fontWeight:700 }}>{event.event.replace(/_/g," ").toUpperCase()}</div>
          <div style={{ fontSize:9, color:C.muted, marginTop:2 }}>{event.instance}</div>
        </div>
        <button onClick={onClose} style={{ background:"none", border:"none",
          color:C.muted, cursor:"pointer", fontSize:18, lineHeight:1,
          padding:0 }}>×</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex:1, overflowY:"auto", padding:"12px 14px",
        display:"flex", flexDirection:"column", gap:10 }}>

        {/* Timestamps */}
        <Section title="⏱ Timestamps">
          <Row2 l="Event Time (UTC)" v={event.utc} mono color={C.cyan}/>
          <Row2 l="Local Time"       v={new Date(event.ts).toLocaleString()} mono/>
          <Row2 l="Duration"         v={dur} mono color={event.status==="ACTIVE"?C.warn:C.ok}/>
          <Row2 l="Status"           v={event.status}
            color={event.status==="ACTIVE"?C.warn:C.ok}/>
          {event.count && <Row2 l="Occurrence Count" v={`${event.count}×`} mono color={C.err}/>}
          {event.pid   && <Row2 l="Affected PID"     v={event.pid} mono color={C.accent}/>}
        </Section>

        {/* QoS Impact */}
        <Section title="📡 QoS Impact Assessment">
          <div style={{ display:"flex", alignItems:"center", gap:8,
            padding:"8px 10px", background:C.dim,
            border:`1px solid ${iCol}44`,
            borderRadius:2, marginBottom:6,
            boxShadow:`inset 0 0 20px ${iCol}08` }}>
            <div style={{ width:3, alignSelf:"stretch", background:iCol,
              borderRadius:2, flexShrink:0 }}/>
            <div>
              <div style={{ fontSize:8, color:C.muted, fontWeight:700,
                letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:2 }}>
                Impact Level
              </div>
              <div style={{ fontSize:15, fontWeight:800, color:iCol,
                letterSpacing:"0.06em" }}>{qos.impact}</div>
            </div>
          </div>
          <div style={{ padding:"8px 10px", background:C.dim,
            border:`1px solid ${C.border}`, borderRadius:2, fontSize:10,
            color:C.text, lineHeight:1.6 }}>
            {qos.service}
          </div>
        </Section>

        {/* ETR 290 Reference */}
        <Section title="📋 ETR 290 Reference">
          <Row2 l="Standard"  v={qos.etr} color={C.orange}/>
          <Row2 l="Recovery"  v={qos.recovery} color={C.text}/>
        </Section>

        {/* Viewer Impact */}
        <Section title="👁 Viewer Impact">
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
            {[
              { l:"Picture",    v: qos.impact==="CRITICAL"||qos.impact==="HIGH" ? "AFFECTED" : "OK",
                c: qos.impact==="CRITICAL"||qos.impact==="HIGH" ? C.err : C.ok },
              { l:"Audio",      v: qos.impact==="CRITICAL" ? "AFFECTED" : "OK",
                c: qos.impact==="CRITICAL" ? C.err : C.ok },
              { l:"EPG/Guide",  v: qos.impact==="LOW" ? "DELAYED" : qos.impact==="NONE"?"OK":"OK",
                c: qos.impact==="LOW" ? C.warn : C.ok },
              { l:"Subtitles",  v: qos.impact==="CRITICAL" ? "LOST" : "OK",
                c: qos.impact==="CRITICAL" ? C.err : C.ok },
            ].map((s,i) => (
              <div key={i} style={{ background:C.panel, borderRadius:2,
                padding:"5px 8px", border:`1px solid ${C.border}`,
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:9, color:C.muted }}>{s.l}</span>
                <Badge label={s.v} color={s.c} small/>
              </div>
            ))}
          </div>
        </Section>

        {/* Recommended Action */}
        <Section title="⚡ Recommended Action">
          <div style={{ padding:"8px 10px", background:`${C.accent}10`,
            border:`1px solid ${C.accent}44`, borderRadius:2,
            fontSize:10, color:C.text, lineHeight:1.7 }}>
            {qos.impact === "CRITICAL" &&
              "🚨 Immediate action required. Check source signal and network path. Escalate to NOC if not resolved within 30 seconds."}
            {qos.impact === "HIGH" &&
              "⚠️ Investigate within 2 minutes. Check PID continuity counters and re-mux pipeline. Monitor for escalation."}
            {qos.impact === "MEDIUM" &&
              "🔍 Monitor closely. Verify PCR/PTS alignment. No immediate action if isolated event — escalate if recurring."}
            {qos.impact === "LOW" &&
              "📝 Log and monitor. SI tables will self-correct on next cycle. No viewer impact expected."}
            {qos.impact === "NONE" &&
              "✅ No action required. This is a routine analysis snapshot. Archive for reporting."}
          </div>
        </Section>

        {/* Raw payload */}
        <Section title="🔧 Raw Event Data">
          <div style={{ fontFamily:"'Courier New',monospace", fontSize:9,
            color:C.muted, background:C.input, borderRadius:2,
            padding:"8px 10px", border:`1px solid ${C.border}`,
            lineHeight:1.7, whiteSpace:"pre-wrap" }}>
{`{
  "id":       "${event.id}",
  "ts_utc":   "${event.utc}",
  "instance": "${event.instance}",
  "severity": "${event.severity}",
  "event":    "${event.event}",
  "status":   "${event.status}",
  "pid":      ${event.pid ? `"${event.pid}"` : "null"},
  "count":    ${event.count ?? 0},
  "duration": ${event.duration ? `"${event.duration}"` : "null"}
}`}
          </div>
        </Section>
      </div>

      {/* Footer actions */}
      <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.border}`,
        background:C.panelAlt, display:"flex", gap:6 }}>
        <button style={{ flex:1, background:`${C.ok}15`,
          border:`1px solid ${C.ok}`, color:C.ok, borderRadius:2,
          padding:"5px 0", cursor:"pointer", fontSize:9,
          fontWeight:700, letterSpacing:"0.1em" }}>
          ✓ ACKNOWLEDGE
        </button>
        <button style={{ flex:1, background:"transparent",
          border:`1px solid ${C.border}`, color:C.muted, borderRadius:2,
          padding:"5px 0", cursor:"pointer", fontSize:9,
          fontWeight:700, letterSpacing:"0.1em" }}>
          🔗 COPY LINK
        </button>
        <button style={{ flex:1, background:"transparent",
          border:`1px solid ${C.border}`, color:C.muted, borderRadius:2,
          padding:"5px 0", cursor:"pointer", fontSize:9,
          fontWeight:700, letterSpacing:"0.1em" }}>
          📤 EXPORT
        </button>
      </div>
    </div>
  );
}

const Section = ({ title, children }) => (
  <div style={{ background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:3, overflow:"hidden" }}>
    <div style={{ padding:"5px 10px", background:C.panelAlt,
      borderBottom:`1px solid ${C.border}`,
      fontSize:9, fontWeight:800, letterSpacing:"0.12em",
      color:C.head, textTransform:"uppercase" }}>{title}</div>
    <div style={{ padding:"6px 10px", display:"flex",
      flexDirection:"column", gap:2 }}>{children}</div>
  </div>
);

const Row2 = ({ l, v, mono, color }) => (
  <div style={{ display:"flex", justifyContent:"space-between",
    alignItems:"center", padding:"2px 0",
    borderBottom:`1px solid ${C.dim}` }}>
    <span style={{ fontSize:9, color:C.muted }}>{l}</span>
    <span style={{ fontFamily: mono?"'Courier New',monospace":"inherit",
      fontSize:10, color:color||C.text, fontWeight: color?700:400,
      textAlign:"right", maxWidth:220, wordBreak:"break-all" }}>{v}</span>
  </div>
);

// ── Event table row ────────────────────────────────────────────
function EventRow({ ev, selected, onClick }) {
  const sCol = SEV_COLOR[ev.severity];
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{
        display:"grid",
        gridTemplateColumns:"180px 1fr 90px 90px 130px 50px",
        gap:"0 10px", padding:"5px 12px",
        borderBottom:`1px solid ${C.border}`,
        cursor:"pointer", alignItems:"center",
        background: selected ? `${sCol}0e` :
                    hover    ? `${C.borderHi}44` : "transparent",
        borderLeft: selected ? `3px solid ${sCol}` : "3px solid transparent",
        transition:"background 0.08s",
      }}>
      <span style={{ fontFamily:"'Courier New',monospace",
        fontSize:9.5, color:C.muted }}>{ev.utc.replace(" UTC","")}</span>
      <span style={{ fontSize:10, color: selected ? sCol : C.text,
        fontWeight: selected ? 700 : 400,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {ev.instance}
      </span>
      <span>
        <Badge label={ev.severity} color={sCol} small/>
      </span>
      <span style={{ fontSize:9,
        color: ev.status==="ACTIVE" ? C.warn : C.ok,
        fontWeight:700, letterSpacing:"0.06em" }}>{ev.status}</span>
      <span style={{ fontFamily:"'Courier New',monospace",
        fontSize:9.5, color: selected ? sCol : C.muted }}>
        {ev.event}
      </span>
      <span style={{ fontSize:9, color:C.muted, textAlign:"right" }}>
        {ev.pid || "—"}
      </span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function AlarmLog() {
  const [activeTab,    setActiveTab]    = useState("alarms");
  const [filter,       setFilter]       = useState("ALL");
  const [search,       setSearch]       = useState("");
  const [selected,     setSelected]     = useState(null);
  const [events,       setEvents]       = useState(ALL_EVENTS);
  const [autoScroll,   setAutoScroll]   = useState(true);
  const tableRef = useRef();

  // Simulate new incoming events
  useEffect(() => {
    const t = setInterval(() => {
      const types = Object.keys(QOS_IMPACT);
      const sevMap = {
        cc_error:"WARNING", pcr_jitter:"WARNING", si_repetition:"INFO",
        pat_error:"CRITICAL", sync_loss:"CRITICAL", analyse_result:"INFO",
        pmt_error:"WARNING", transport_error:"WARNING",
        network_timeout:"CRITICAL", bitrate_exceed:"WARNING",
      };
      const type = types[Math.floor(Math.random()*types.length)];
      const sev  = sevMap[type];
      const d    = new Date();
      const newEv = {
        id: `EVT-${String(Math.floor(Math.random()*9999)).padStart(4,"0")}`,
        ts: Date.now(),
        utc: d.toISOString().replace("T"," ").replace("Z","").slice(0,23)+" UTC",
        instance: "decoder-1773309037146",
        severity: sev, status:"ACTIVE",
        event: type,
        pid: sev!=="INFO" ? `#${Math.floor(Math.random()*4000+256)}` : null,
        count: 1, duration: null,
      };
      setEvents(prev => [newEv, ...prev.slice(0, 199)]);
    }, 3500);
    return () => clearInterval(t);
  }, []);

  const FILTERS = ["ALL","CRITICAL","WARNING","INFO","NOMINAL"];

  const filtered = events.filter(e => {
    const matchF = filter==="ALL" || e.severity===filter;
    const matchS = !search || e.instance.includes(search) ||
                   e.event.includes(search.toLowerCase()) ||
                   e.utc.includes(search);
    return matchF && matchS;
  });

  // Counts
  const counts = { CRITICAL:0, WARNING:0, INFO:0, NOMINAL:0 };
  events.forEach(e => counts[e.severity] = (counts[e.severity]||0)+1);

  const tabs = [
    { id:"analyser",   label:"TS Analyser",  icon:"📡" },
    { id:"runtime",    label:"Runtime",      icon:"⚡" },
    { id:"transcoder", label:"Transcoder",   icon:"🔄" },
    { id:"forwarding", label:"Forwarding",   icon:"➡️"  },
    { id:"decoder",    label:"Decoder",      icon:"📺" },
    { id:"multiview",  label:"Multiview",    icon:"⊞"  },
    { id:"live",       label:"Live View",    icon:"🔴" },
    { id:"alarms",     label:"Alarm Log",    icon:"🔔", alert:true },
    { id:"api",        label:"API",          icon:"⚙️"  },
  ];

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", background:C.bg,
      color:C.text, minHeight:"100vh", display:"flex",
      flexDirection:"column", fontSize:11 }}>

      {/* ── TOPBAR ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        background:C.surface, borderBottom:`1px solid ${C.borderHi}`,
        padding:"0 14px", height:52, flexShrink:0 }}>
        <div style={{ display:"flex", flexDirection:"column", minWidth:140 }}>
          <span style={{ fontSize:12, fontWeight:800, color:C.ok,
            letterSpacing:"0.15em" }}>LABOTECH</span>
          <span style={{ fontSize:8, color:C.muted, letterSpacing:"0.1em" }}>BROADCAST ENGINE</span>
          <span style={{ fontSize:7, color:C.dim, letterSpacing:"0.08em" }}>HPE DL360 · Docker</span>
        </div>
        <div style={{ display:"flex", gap:2 }}>
          {tabs.map(t => (
            <NavTab key={t.id} label={t.label} icon={t.icon}
              alert={t.alert} active={activeTab===t.id}
              onClick={()=>setActiveTab(t.id)}/>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center",
          minWidth:210, justifyContent:"flex-end" }}>
          <div style={{ fontSize:9, textAlign:"right", lineHeight:1.6 }}>
            <span style={{ color:C.muted }}>CPU </span>
            <span style={{ color:C.ok, fontWeight:700,
              fontFamily:"'Courier New',monospace" }}>1%</span>{"  "}
            <span style={{ color:C.muted }}>MEM </span>
            <span style={{ color:C.warn, fontWeight:700,
              fontFamily:"'Courier New',monospace" }}>8.4%</span>
            <div style={{ color:C.dim, fontFamily:"'Courier New',monospace",
              fontSize:8 }}>5369/64038MB</div>
          </div>
          <Badge label="● ONLINE" color={C.ok} filled/>
        </div>
      </div>

      {/* ── PAGE HEADER ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"8px 14px", borderBottom:`1px solid ${C.border}`,
        background:C.surface, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <Dot color={C.err} size={8}/>
          <div>
            <div style={{ fontSize:14, fontWeight:700, letterSpacing:"0.04em" }}>
              Alarm & Event Log
            </div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.1em",
              textTransform:"uppercase" }}>
              Real-time · ETR 290 · QoS Monitoring
            </div>
          </div>
        </div>
        {/* Summary pills */}
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {Object.entries(counts).map(([sev, n]) => n > 0 && (
            <div key={sev} style={{ display:"flex", alignItems:"center", gap:4,
              padding:"3px 8px", background:C.panel,
              border:`1px solid ${SEV_COLOR[sev]}44`, borderRadius:2 }}>
              <Dot color={SEV_COLOR[sev]} size={5}/>
              <span style={{ fontFamily:"'Courier New',monospace",
                fontSize:11, fontWeight:700,
                color:SEV_COLOR[sev] }}>{n}</span>
              <span style={{ fontSize:8, color:C.muted,
                letterSpacing:"0.1em" }}>{sev}</span>
            </div>
          ))}
          <div style={{ width:1, height:16, background:C.border }}/>
          <div style={{ display:"flex", gap:4 }}>
            <button style={{ background:"transparent",
              border:`1px solid ${C.border}`, color:C.muted,
              borderRadius:2, padding:"3px 10px", cursor:"pointer",
              fontSize:9, fontWeight:600 }}>↓ JSONL</button>
            <button style={{ background:"transparent",
              border:`1px solid ${C.border}`, color:C.muted,
              borderRadius:2, padding:"3px 10px", cursor:"pointer",
              fontSize:9, fontWeight:600 }}>↓ CSV</button>
          </div>
        </div>
      </div>

      {/* ── TOOLBAR ── */}
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px",
        borderBottom:`1px solid ${C.border}`, background:C.surface,
        flexShrink:0, flexWrap:"wrap" }}>
        {/* Filter buttons */}
        <div style={{ display:"flex", gap:3 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{
              background: filter===f ? `${SEV_COLOR[f]||C.accent}18` : "transparent",
              border:`1px solid ${filter===f ? SEV_COLOR[f]||C.accent : C.border}`,
              color: filter===f ? SEV_COLOR[f]||C.cyan : C.muted,
              borderRadius:2, padding:"3px 10px", cursor:"pointer",
              fontSize:9, fontWeight:700, letterSpacing:"0.1em",
              transition:"all 0.12s",
            }}>
              {f}
              {f!=="ALL" && counts[f]>0 &&
                <span style={{ marginLeft:5, fontFamily:"'Courier New',monospace",
                  fontSize:9 }}>({counts[f]})</span>}
            </button>
          ))}
        </div>
        <div style={{ flex:1 }}/>
        {/* Search */}
        <div style={{ position:"relative" }}>
          <span style={{ position:"absolute", left:7, top:"50%",
            transform:"translateY(-50%)", color:C.muted, fontSize:10 }}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Filter by instance / event / time…"
            style={{ background:C.input, border:`1px solid ${C.border}`,
              borderRadius:2, color:C.text, padding:"4px 8px 4px 24px",
              fontSize:10, fontFamily:"inherit", outline:"none",
              width:260 }}/>
          {search && <button onClick={()=>setSearch("")} style={{
            position:"absolute", right:6, top:"50%",
            transform:"translateY(-50%)", background:"none",
            border:"none", color:C.muted, cursor:"pointer", fontSize:12 }}>×</button>}
        </div>
        {/* Auto-scroll toggle */}
        <label style={{ display:"flex", alignItems:"center", gap:5,
          cursor:"pointer", fontSize:9, color:autoScroll?C.ok:C.muted }}>
          <input type="checkbox" checked={autoScroll}
            onChange={e=>setAutoScroll(e.target.checked)}
            style={{ accentColor:C.ok }}/>
          AUTO-SCROLL
        </label>
        <span style={{ fontSize:9, color:C.muted }}>
          {filtered.length} / {events.length} events
        </span>
      </div>

      {/* ── TABLE ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column",
        marginRight: selected ? 400 : 0, transition:"margin-right 0.18s ease" }}>

        {/* Column headers */}
        <div style={{ display:"grid",
          gridTemplateColumns:"180px 1fr 90px 90px 130px 50px",
          gap:"0 10px", padding:"4px 12px",
          background:C.panelAlt, borderBottom:`1px solid ${C.borderHi}`,
          flexShrink:0 }}>
          {["Time (UTC)","Instance","Severity","Status","Event","PID"].map(h => (
            <span key={h} style={{ fontSize:9, fontWeight:800,
              letterSpacing:"0.12em", color:C.head,
              textTransform:"uppercase" }}>{h}</span>
          ))}
        </div>

        {/* Rows */}
        <div ref={tableRef} style={{ flex:1, overflowY:"auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding:40, textAlign:"center",
              color:C.muted, fontSize:11, fontStyle:"italic" }}>
              No events match the current filter.
            </div>
          ) : (
            filtered.map((ev, i) => (
              <EventRow key={ev.id+i} ev={ev}
                selected={selected?.id===ev.id}
                onClick={()=>setSelected(selected?.id===ev.id ? null : ev)}/>
            ))
          )}
        </div>
      </div>

      {/* ── QoS DETAIL PANEL ── */}
      {selected && (
        <QoSPanel event={selected} onClose={()=>setSelected(null)}/>
      )}

      {/* ── FOOTER ── */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"4px 14px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:C.surface, flexShrink:0,
        marginRight: selected ? 400 : 0, transition:"margin-right 0.18s ease" }}>
        <span style={{ fontSize:9, color:C.muted }}>
          LABOTECH · Broadcast Engine · Alarm & Event Log
          {selected && <span style={{ color:C.cyan, marginLeft:10 }}>
            ← Selected: {selected.event.replace(/_/g," ").toUpperCase()} · {selected.id}
          </span>}
        </span>
        <span style={{ fontFamily:"'Courier New',monospace",
          fontSize:9, color:C.muted }}>
          Live · updates every 3.5s
        </span>
      </div>
    </div>
  );
}
