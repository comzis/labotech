import { useState, useEffect } from "react";

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:"#07090d", panel:"#0d1017", panelB:"#0b0e14",
  border:"#1a2030", borderHi:"#253044",
  text:"#c8d4e8", muted:"#3e4f6e", dim:"#2a3650",
  ok:"#00e676", warn:"#ffab00", err:"#ff3d57",
  info:"#29b6f6", cyan:"#00e5ff", accent:"#3d6bff",
  blue:"#2979ff", red:"#f50057", purple:"#aa00ff",
  gold:"#ffd740", head:"#6a7fa8",
};

// ── Atoms ──────────────────────────────────────────────────────────────────────
const Dot = ({ c, size=7 }) => (
  <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%",
    background:c, boxShadow:`0 0 5px ${c}99`, flexShrink:0 }}/>
);
const Badge = ({ label, color=C.ok, small }) => (
  <span style={{ fontSize:small?8:9, fontWeight:700, letterSpacing:"0.08em", color,
    border:`1px solid ${color}66`, borderRadius:2, padding:small?"0px 4px":"1px 5px",
    background:`${color}12`, textTransform:"uppercase", whiteSpace:"nowrap" }}>{label}</span>
);
const Mono = ({ v, c=C.cyan, size=11 }) => (
  <span style={{ fontFamily:"'Courier New',monospace", color:c, fontSize:size }}>{v}</span>
);
const TH = ({ children, right }) => (
  <th style={{ fontSize:8, fontWeight:700, letterSpacing:"0.1em", color:C.muted,
    textAlign:right?"right":"left", padding:"0 4px 4px", borderBottom:`1px solid ${C.borderHi}`,
    whiteSpace:"nowrap" }}>{children}</th>
);
const TD = ({ children, right, mono, color, small }) => (
  <td style={{ fontSize:small?9:10, color:color||C.text, padding:"2px 4px",
    borderBottom:`1px solid ${C.border}`, fontFamily:mono?"'Courier New',monospace":"inherit",
    textAlign:right?"right":"left", whiteSpace:"nowrap" }}>{children}</td>
);
const Panel = ({ children, style, title, status, right }) => (
  <div style={{ background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:3, overflow:"hidden", ...style }}>
    {title && (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"5px 8px", borderBottom:`1px solid ${C.borderHi}`,
        background:C.panelB }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.14em",
            color:C.head, textTransform:"uppercase" }}>{title}</span>
          {status && <Badge label={status} color={status==="OK"?C.ok:status==="WARN"?C.warn:C.err} small/>}
        </div>
        {right && <span style={{ fontSize:9, color:C.muted }}>{right}</span>}
      </div>
    )}
    <div style={{ padding:"6px 8px" }}>{children}</div>
  </div>
);
const KV = ({ k, v, vc }) => (
  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
    padding:"2px 0", borderBottom:`1px solid ${C.border}` }}>
    <span style={{ fontSize:9, color:C.muted }}>{k}</span>
    <Mono v={v} c={vc||C.text} size={10}/>
  </div>
);

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TABS = ["ETR 290","ST 2022-7","DVB Tables","PIDs","Programs","Event Log"];
const TabBar = ({ active, onChange }) => (
  <div style={{ display:"flex", gap:2, borderBottom:`1px solid ${C.borderHi}`,
    marginBottom:8, paddingBottom:0 }}>
    {TABS.map(t => (
      <button key={t} onClick={()=>onChange(t)} style={{
        background: active===t ? C.borderHi : "transparent",
        border:"none", borderBottom: active===t ? `2px solid ${C.cyan}` : "2px solid transparent",
        color: active===t ? C.cyan : C.muted,
        fontSize:9, fontWeight:700, letterSpacing:"0.1em",
        padding:"5px 10px", cursor:"pointer", textTransform:"uppercase",
        fontFamily:"'Courier New',monospace", borderRadius:"2px 2px 0 0",
        transition:"all 0.15s"
      }}>{t}</button>
    ))}
  </div>
);

// ── ETR 290 data ──────────────────────────────────────────────────────────────
const ETR_CHECKS = [
  // Priority 1
  { p:1, id:"1.1", label:"TS sync loss",           count:0,  ok:true  },
  { p:1, id:"1.2", label:"Sync byte error",         count:0,  ok:true  },
  { p:1, id:"1.3", label:"PAT error",               count:0,  ok:true  },
  { p:1, id:"1.4", label:"Continuity count error",  count:2,  ok:false },
  { p:1, id:"1.5", label:"PMT error",               count:0,  ok:true  },
  { p:1, id:"1.6", label:"PID error",               count:0,  ok:true  },
  // Priority 2
  { p:2, id:"2.1", label:"Transport error",         count:0,  ok:true  },
  { p:2, id:"2.2", label:"CRC error",               count:0,  ok:true  },
  { p:2, id:"2.3", label:"PCR discontinuity",       count:0,  ok:true  },
  { p:2, id:"2.4", label:"PCR accuracy",            count:0,  ok:true  },
  { p:2, id:"2.5", label:"PTS error",               count:0,  ok:true  },
  { p:2, id:"2.6", label:"CAT error",               count:0,  ok:true  },
  // Priority 3
  { p:3, id:"3.1", label:"NIT actual error",        count:0,  ok:true  },
  { p:3, id:"3.2", label:"NIT other error",         count:0,  ok:true  },
  { p:3, id:"3.3", label:"SI repetition rate",      count:1,  ok:false },
  { p:3, id:"3.4", label:"Unreferenced PID",        count:0,  ok:true  },
  { p:3, id:"3.5", label:"SDT actual error",        count:0,  ok:true  },
  { p:3, id:"3.6", label:"EIT actual error",        count:0,  ok:true  },
  { p:3, id:"3.7", label:"RST error",               count:0,  ok:true  },
  { p:3, id:"3.8", label:"TDT error",               count:0,  ok:true  },
];

// ── DVB SI table data ─────────────────────────────────────────────────────────
const DVB_TABLES = [
  {
    pid:"0x0000", table:"PAT", name:"Program Association Table", ver:3,
    interval_ms:500, last_ms:498, ok:true, tsid:"0x1234",
    desc:"Links each Program Number to its PMT PID",
    entries:[
      { num:"0x0000", pid:"0x001F", label:"NIT PID" },
      { num:"0x0001", pid:"0x01FF", label:"PMT → Svc 1" },
      { num:"0x0002", pid:"0x0203", label:"PMT → Svc 2" },
    ]
  },
  {
    pid:"0x001F", table:"NIT", name:"Network Information Table", ver:7,
    interval_ms:10000, last_ms:9840, ok:true, tsid:"-",
    desc:"Describes the physical network and transport streams",
    entries:[
      { num:"Net ID", pid:"0x20A1", label:"Labotech DVB-IP" },
      { num:"TS ID",  pid:"0x1234", label:"Mux A" },
      { num:"Desc",   pid:"cable",  label:"DVB-C delivery" },
    ]
  },
  {
    pid:"0x01FF", table:"PMT", name:"Program Map Table (Svc 1)", ver:2,
    interval_ms:500, last_ms:487, ok:true, tsid:"-",
    desc:"Describes the elementary streams for Service 1",
    entries:[
      { num:"PCR",   pid:"0x0200", label:"PCR PID" },
      { num:"0x1B",  pid:"0x0201", label:"H.264 Video" },
      { num:"0x03",  pid:"0x0202", label:"MP3 Audio" },
      { num:"0x05",  pid:"0x020F", label:"Private data" },
    ]
  },
  {
    pid:"0x0011", table:"SDT", name:"Service Description Table", ver:5,
    interval_ms:2000, last_ms:1920, ok:true, tsid:"-",
    desc:"Service names, provider, and running status",
    entries:[
      { num:"Svc 1", pid:"Run:4",  label:"PM_AUDIO · FUNCTION SL · Running" },
      { num:"Svc 2", pid:"Run:4",  label:"DAB_TRAF_fm/B · FUNCTION SL · Running" },
    ]
  },
  {
    pid:"0x0012", table:"EIT", name:"Event Information Table", ver:1,
    interval_ms:2000, last_ms:1876, ok:true, tsid:"-",
    desc:"Now/Next and schedule event information",
    entries:[
      { num:"p/f",    pid:"0x0001", label:"Present/Following – Svc 1" },
      { num:"sched",  pid:"0x0050", label:"8-day schedule – Svc 1" },
    ]
  },
  {
    pid:"0x0010", table:"BAT", name:"Bouquet Association Table", ver:0,
    interval_ms:10000, last_ms:9700, ok:true, tsid:"-",
    desc:"Groups services into logical bouquets",
    entries:[
      { num:"Bouquet", pid:"0xA101", label:"Labotech DVB Bouquet" },
    ]
  },
  {
    pid:"0x0001", table:"CAT", name:"Conditional Access Table", ver:0,
    interval_ms:500, last_ms:488, ok:true, tsid:"-",
    desc:"Lists conditional access systems (EMM PIDs)",
    entries:[
      { num:"CA sys", pid:"0x0900", label:"No CA present – FTA" },
    ]
  },
  {
    pid:"0x0014", table:"TDT", name:"Time & Date Table", ver:"-",
    interval_ms:30000, last_ms:28400, ok:true, tsid:"-",
    desc:"Carries UTC date and time",
    entries:[
      { num:"UTC", pid:"-", label:"2025-03-14  09:51:22 UTC" },
    ]
  },
  {
    pid:"0x0014", table:"TOT", name:"Time Offset Table", ver:"-",
    interval_ms:30000, last_ms:29200, ok:true, tsid:"-",
    desc:"UTC time + local time offset descriptors",
    entries:[
      { num:"Offset", pid:"+01:00", label:"CET · Europe/Paris" },
    ]
  },
  {
    pid:"0x0013", table:"RST", name:"Running Status Table", ver:"-",
    interval_ms:"-", last_ms:"-", ok:true, tsid:"-",
    desc:"Updates service running status in real-time",
    entries:[]
  },
  {
    pid:"0x001E", table:"DIT", name:"Discontinuity Info Table", ver:"-",
    interval_ms:"-", last_ms:"-", ok:true, tsid:"-",
    desc:"Signals intentional DVB SI discontinuities",
    entries:[]
  },
  {
    pid:"0x001F", table:"SIT", name:"Selection Info Table", ver:"-",
    interval_ms:"-", last_ms:"-", ok:false, tsid:"-",
    desc:"Used in partial TS (PVR / recording)",
    entries:[]
  },
];

// ── PID data ──────────────────────────────────────────────────────────────────
const PID_TABLE = [
  { pid:"0x0000", type:"SI",    label:"PAT",             bps:"12.8 kbps", cc:0,  ok:true  },
  { pid:"0x0001", type:"SI",    label:"CAT",             bps:"1.2 kbps",  cc:0,  ok:true  },
  { pid:"0x001F", type:"SI",    label:"NIT/BAT/SIT",     bps:"18.4 kbps", cc:0,  ok:true  },
  { pid:"0x0011", type:"SI",    label:"SDT/BAT",         bps:"22.1 kbps", cc:0,  ok:true  },
  { pid:"0x0012", type:"SI",    label:"EIT",             bps:"64.2 kbps", cc:0,  ok:true  },
  { pid:"0x0014", type:"SI",    label:"TDT/TOT/RST",     bps:"0.4 kbps",  cc:0,  ok:true  },
  { pid:"0x01FF", type:"SI",    label:"PMT Svc 1",       bps:"6.1 kbps",  cc:0,  ok:true  },
  { pid:"0x0200", type:"PCR",   label:"PCR Svc 1",       bps:"0.8 kbps",  cc:0,  ok:true  },
  { pid:"0x0201", type:"Video", label:"H.264 Svc 1",     bps:"8.210 Mbps",cc:2,  ok:false },
  { pid:"0x0202", type:"Audio", label:"MP3 Svc 1",       bps:"192 kbps",  cc:0,  ok:true  },
  { pid:"0x0203", type:"SI",    label:"PMT Svc 2",       bps:"6.1 kbps",  cc:0,  ok:true  },
  { pid:"0x0204", type:"Audio", label:"MP3 Svc 2",       bps:"192 kbps",  cc:0,  ok:true  },
  { pid:"0x1FFF", type:"NULL",  label:"Null packets",    bps:"6.88%",     cc:0,  ok:true  },
];

// ── Programs data ─────────────────────────────────────────────────────────────
const PROGRAMS = [
  {
    num:"0x0001", name:"PM_AUDIO", provider:"FUNCTION SL",
    running:4, scrambled:false, eit:true,
    streams:[
      { pid:"0x0200", type:"PCR",   codec:"-",     kbps:"-"     },
      { pid:"0x0201", type:"Video", codec:"H.264",  kbps:"8210"  },
      { pid:"0x0202", type:"Audio", codec:"MP3",    kbps:"192"   },
    ]
  },
  {
    num:"0x0002", name:"DAB_TRAF_fm/B", provider:"FUNCTION SL",
    running:4, scrambled:false, eit:false,
    streams:[
      { pid:"0x0203", type:"PCR",   codec:"-",     kbps:"-"     },
      { pid:"0x0204", type:"Audio", codec:"MP3",    kbps:"192"   },
    ]
  },
];

// ── ST 2022-7 data ─────────────────────────────────────────────────────────────
const ST2022_STREAMS = [
  {
    name:"000@blue", leg:"A", color:C.blue, signal:"10d", input:"enp...",
    mapping:"7TS/RTP", net_bps:"21.182 Mbps",
    cc_err:0, pids:11, svcs:1,
    curr:"21.503 Mbps", min:"21.492 Mbps", max:"21.514 Mbps",
    dst:"239.253.3.0:1234", tos:128, ttl:64, vlan:"-",
    src:"185.148.231.127:62610",
    iat_avg:"489.616 µs", iat_min:"0.064 µs", iat_max:"1.239 ms",
    rtp_drop:0, rtp_dup:0, rtp_ooo:0, fec:"-", rtt:"<1ms",
    ok:true,
  },
  {
    name:"000@red",  leg:"B", color:C.red, signal:"10d", input:"enp...",
    mapping:"7TS/RTP", net_bps:"21.182 Mbps",
    cc_err:0, pids:11, svcs:1,
    curr:"21.503 Mbps", min:"21.492 Mbps", max:"21.514 Mbps",
    dst:"239.254.3.0:1234", tos:128, ttl:64, vlan:"-",
    src:"185.148.231.127:62610",
    iat_avg:"489.609 µs", iat_min:"0.064 µs", iat_max:"1.239 ms",
    rtp_drop:0, rtp_dup:0, rtp_ooo:0, fec:"-", rtt:"<1ms",
    ok:true,
  },
  {
    name:"000 (merged)", leg:"2022-7", color:C.gold, signal:"10d", input:"-",
    mapping:"ST 2022-7", net_bps:"21.182 Mbps",
    cc_err:0, pids:"-", svcs:"-",
    curr:"-----", min:"-----", max:"-----",
    dst:"20.22.3.0:2022", tos:"-", ttl:"-", vlan:"-", src:"-",
    iat_avg:"-451.602 µs", iat_min:"-468.757 µs", iat_max:"0.000 µs",
    rtp_drop:0, rtp_dup:0, rtp_ooo:0, fec:"SMPTE 2022-7", rtt:"-",
    ok:true, merged:true,
  },
];

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function ETRAnalysis() {
  const [tab, setTab]   = useState("ETR 290");
  const [tick, setTick] = useState(0);
  const [bps, setBps]   = useState(36.118);
  const [pkts, setPkts] = useState(128482);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    const t = setInterval(() => {
      setTick(x => x+1);
      setBps(b => +(b + (Math.random()-0.5)*0.06).toFixed(3));
      setPkts(p => p + Math.floor(Math.random()*80+20));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const ts = new Date().toTimeString().slice(0,8);

  const p1fail = ETR_CHECKS.filter(r=>r.p===1&&!r.ok).length;
  const p2fail = ETR_CHECKS.filter(r=>r.p===2&&!r.ok).length;
  const p3fail = ETR_CHECKS.filter(r=>r.p===3&&!r.ok).length;

  return (
    <div style={{ fontFamily:"'Courier New',monospace", background:C.bg, color:C.text,
      minHeight:"100vh", padding:8, boxSizing:"border-box", fontSize:11 }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        borderBottom:`1px solid ${C.borderHi}`, marginBottom:8, paddingBottom:5 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:14, fontWeight:800, letterSpacing:"0.1em",
            color:C.cyan }}>◈ ETR ANALYSIS</span>
          <Badge label="LIVE" color={C.ok}/>
          <Badge label="TS/IP" color={C.accent}/>
          <Badge label="ST 2022-7" color={C.gold}/>
          <span style={{ color:C.muted, fontSize:9 }}>241.100.33.45 · UDP · 14 clients</span>
        </div>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          {[
            ["P1", p1fail===0?C.ok:C.err],
            ["P2", p2fail===0?C.ok:C.warn],
            ["P3", p3fail===0?C.ok:C.warn],
            ["PCR", C.ok], ["SFP", C.ok], ["2022-7", C.ok]
          ].map(([l,c]) => (
            <span key={l} style={{ display:"flex", alignItems:"center", gap:3, fontSize:9 }}>
              <Dot c={c}/><span style={{ color:C.muted }}>{l}</span>
            </span>
          ))}
          <Mono v={ts} c={C.warn} size={10}/>
        </div>
      </div>

      {/* ── STATS STRIP ─────────────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", gap:5, marginBottom:8 }}>
        {[
          { l:"BITRATE",    v:`${bps.toFixed(3)} Mbps`, c:C.cyan },
          { l:"PACKETS",    v:pkts.toLocaleString(),     c:C.text },
          { l:"CC ERRORS",  v:"2",                       c:C.err  },
          { l:"PCR JITTER", v:"0.28 ms",                 c:C.ok   },
          { l:"NULL PKT",   v:"6.88 %",                  c:C.text },
          { l:"SERVICES",   v:"2",                        c:C.ok   },
          { l:"PIDs",       v:"13",                       c:C.text },
          { l:"SCORE",      v:"90 %",                     c:C.ok   },
        ].map((s,i) => (
          <div key={i} style={{ background:C.panel, border:`1px solid ${C.border}`,
            borderRadius:3, padding:"4px 6px", textAlign:"center" }}>
            <div style={{ fontSize:8, color:C.muted, marginBottom:1 }}>{s.l}</div>
            <div style={{ fontFamily:"'Courier New',monospace",
              fontSize:12, color:s.c, fontWeight:700 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* ── TABS ────────────────────────────────────────────────────────────── */}
      <TabBar active={tab} onChange={setTab}/>

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: ETR 290
      ═══════════════════════════════════════════════════════════════════ */}
      {tab==="ETR 290" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 260px", gap:6 }}>
          <Panel title="ETR 290 Priority Checks" right="ETSI TR 101 290">
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  <TH>ID</TH><TH>Priority</TH><TH>Description</TH>
                  <TH right>Count</TH><TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {[1,2,3].map(p => (
                  <>
                    <tr key={`ph${p}`}>
                      <td colSpan={5} style={{ background:C.panelB, padding:"3px 4px",
                        fontSize:8, fontWeight:800, color:C.head,
                        letterSpacing:"0.12em", textTransform:"uppercase" }}>
                        ── Priority {p} {p===1?"(Must not)":p===2?"(Should not)":"(May)"}
                      </td>
                    </tr>
                    {ETR_CHECKS.filter(r=>r.p===p).map(r => (
                      <tr key={r.id} style={{ background:!r.ok?"rgba(255,61,87,0.05)":"transparent" }}>
                        <TD mono small>{r.id}</TD>
                        <TD><span style={{ color:p===1?C.err:p===2?C.warn:C.info, fontSize:9 }}>P{p}</span></TD>
                        <TD><span style={{ color:r.ok?C.text:C.err }}>{r.label}</span></TD>
                        <TD right mono><span style={{ color:r.count>0?C.err:C.muted }}>{r.count}</span></TD>
                        <TD><Badge label={r.ok?"PASS":"FAIL"} color={r.ok?C.ok:C.err} small/></TD>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </Panel>

          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <Panel title="PCR / Timing">
              <KV k="PCR PID"      v="#0x0200"    vc={C.accent}/>
              <KV k="PCR Interval" v="39.7 ms"    vc={C.ok}/>
              <KV k="PCR Accuracy" v="±0.3 ms"    vc={C.ok}/>
              <KV k="PCR Jitter"   v="0.28 ms"    vc={C.ok}/>
              <KV k="PTS offset"   v="8.00 ms"/>
              <KV k="OCC packets"  v="0"/>
              <KV k="PCR gaps"     v="0"           vc={C.ok}/>
            </Panel>
            <Panel title="Priority Summary">
              {[
                { p:"P1 (1.1–1.6)", pass:5, total:6, c:C.warn },
                { p:"P2 (2.1–2.6)", pass:6, total:6, c:C.ok   },
                { p:"P3 (3.1–3.8)", pass:7, total:8, c:C.warn  },
              ].map((s,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"3px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:9, color:C.muted }}>{s.p}</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:60, height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
                      <div style={{ width:`${(s.pass/s.total)*100}%`, height:"100%",
                        background:s.c, transition:"width 0.5s" }}/>
                    </div>
                    <Mono v={`${s.pass}/${s.total}`} c={s.c} size={10}/>
                  </div>
                </div>
              ))}
            </Panel>
            <Panel title="Stream Info" status="OK">
              <KV k="Source"      v="241.100.33.45"/>
              <KV k="Protocol"    v="UDP"    vc={C.accent}/>
              <KV k="Port"        v="4789"/>
              <KV k="SFP Link"    v="UP"     vc={C.ok}/>
              <KV k="SFP Temp"    v="38 °C"  vc={C.warn}/>
              <KV k="TX Power"    v="-2.8 dBm" vc={C.ok}/>
              <KV k="RX Power"    v="-3.2 dBm" vc={C.ok}/>
            </Panel>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: ST 2022-7
      ═══════════════════════════════════════════════════════════════════ */}
      {tab==="ST 2022-7" && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {/* Legend */}
          <div style={{ display:"flex", gap:10, alignItems:"center",
            padding:"4px 8px", background:C.panel,
            border:`1px solid ${C.borderHi}`, borderRadius:3, fontSize:9 }}>
            <span style={{ color:C.muted }}>SMPTE ST 2022-7 — Seamless stream redundancy over IP</span>
            <span style={{ flex:1 }}/>
            <span style={{ display:"flex", gap:3, alignItems:"center" }}>
              <Dot c={C.blue} size={8}/><span style={{ color:C.blue }}>Leg A (Blue)</span>
            </span>
            <span style={{ display:"flex", gap:3, alignItems:"center" }}>
              <Dot c={C.red} size={8}/><span style={{ color:C.red }}>Leg B (Red)</span>
            </span>
            <span style={{ display:"flex", gap:3, alignItems:"center" }}>
              <Dot c={C.gold} size={8}/><span style={{ color:C.gold }}>Merged / 2022-7</span>
            </span>
          </div>

          {/* Main multicast table */}
          <Panel title="Joined Multicasts" right="3 entries · ST 2022-7 active">
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr>
                    {["Leg","Name","Signal","Mapping","Net bitrate","CC err",
                      "PIDs","Svcs","Curr","Min","Max","Dst address","TOS",
                      "TTL","Src address","IAT avg","IAT min","IAT max",
                      "Drop","Dup","OOO","FEC","RTT"].map(h => <TH key={h}>{h}</TH>)}
                  </tr>
                </thead>
                <tbody>
                  {ST2022_STREAMS.map((s,i) => (
                    <tr key={i} style={{
                      background: s.merged
                        ? `rgba(255,215,64,0.04)`
                        : i===0 ? `rgba(41,121,255,0.04)` : `rgba(245,0,87,0.04)`,
                      borderLeft:`3px solid ${s.color}`,
                    }}>
                      <TD>
                        <span style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <Dot c={s.color}/>
                          <span style={{ fontSize:9, color:s.color, fontWeight:700 }}>{s.leg}</span>
                        </span>
                      </TD>
                      <TD><Mono v={s.name} c={s.color} size={10}/></TD>
                      <TD mono>{s.signal}</TD>
                      <TD><Badge label={s.mapping} color={s.merged?C.gold:C.accent} small/></TD>
                      <TD mono><Mono v={s.net_bps} c={C.cyan} size={10}/></TD>
                      <TD right mono><span style={{ color:s.cc_err>0?C.err:C.muted }}>{s.cc_err}</span></TD>
                      <TD right mono>{s.pids}</TD>
                      <TD right mono>{s.svcs}</TD>
                      <TD mono><Mono v={s.curr} c={C.text} size={9}/></TD>
                      <TD mono><Mono v={s.min} c={C.muted} size={9}/></TD>
                      <TD mono><Mono v={s.max} c={C.muted} size={9}/></TD>
                      <TD mono><Mono v={s.dst} c={s.color} size={9}/></TD>
                      <TD right>{s.tos}</TD>
                      <TD right>{s.ttl}</TD>
                      <TD mono><Mono v={s.src} c={C.muted} size={9}/></TD>
                      <TD mono><Mono v={s.iat_avg} c={s.merged?C.warn:C.ok} size={9}/></TD>
                      <TD mono><Mono v={s.iat_min} c={C.muted} size={9}/></TD>
                      <TD mono><Mono v={s.iat_max} c={C.muted} size={9}/></TD>
                      <TD right><span style={{ color:s.rtp_drop>0?C.err:C.muted }}>{s.rtp_drop}</span></TD>
                      <TD right><span style={{ color:s.rtp_dup>0?C.err:C.muted }}>{s.rtp_dup}</span></TD>
                      <TD right><span style={{ color:s.rtp_ooo>0?C.err:C.muted }}>{s.rtp_ooo}</span></TD>
                      <TD><span style={{ fontSize:9, color:s.merged?C.gold:C.muted }}>{s.fec}</span></TD>
                      <TD mono>{s.rtt}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* 2022-7 delta panel */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
            <Panel title="Leg A — Blue" status="OK">
              <KV k="IAT avg"    v="489.616 µs" vc={C.ok}/>
              <KV k="IAT min"    v="0.064 µs"   vc={C.ok}/>
              <KV k="IAT max"    v="1.239 ms"   vc={C.ok}/>
              <KV k="RTP drops"  v="0"          vc={C.ok}/>
              <KV k="RTP dups"   v="0"          vc={C.ok}/>
              <KV k="RTP ooo"    v="0"          vc={C.ok}/>
              <KV k="CC errors"  v="0"          vc={C.ok}/>
              <KV k="Path"       v="239.253.3.0:1234" vc={C.blue}/>
            </Panel>
            <Panel title="Leg B — Red" status="OK">
              <KV k="IAT avg"    v="489.609 µs" vc={C.ok}/>
              <KV k="IAT min"    v="0.064 µs"   vc={C.ok}/>
              <KV k="IAT max"    v="1.239 ms"   vc={C.ok}/>
              <KV k="RTP drops"  v="0"          vc={C.ok}/>
              <KV k="RTP dups"   v="0"          vc={C.ok}/>
              <KV k="RTP ooo"    v="0"          vc={C.ok}/>
              <KV k="CC errors"  v="0"          vc={C.ok}/>
              <KV k="Path"       v="239.254.3.0:1234" vc={C.red}/>
            </Panel>
            <Panel title="Merged Stream — 2022-7" status="OK">
              <KV k="IAT delta"   v="-451.602 µs" vc={C.warn}/>
              <KV k="IAT min Δ"   v="-468.757 µs" vc={C.warn}/>
              <KV k="IAT max Δ"   v="0.000 µs"    vc={C.ok}/>
              <KV k="Switch events" v="0"          vc={C.ok}/>
              <KV k="FEC mode"    v="SMPTE 2022-7" vc={C.gold}/>
              <KV k="Merged dst"  v="20.22.3.0:2022" vc={C.gold}/>
              <KV k="Status"      v="SEAMLESS"     vc={C.ok}/>
            </Panel>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: DVB Tables
      ═══════════════════════════════════════════════════════════════════ */}
      {tab==="DVB Tables" && (
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          <div style={{ fontSize:9, color:C.muted, marginBottom:4, padding:"0 2px" }}>
            DVB SI/PSI table structure · Click a table to inspect contents
          </div>
          {DVB_TABLES.map((t,i) => {
            const open = expanded[t.table];
            return (
              <div key={i} style={{ background:C.panel,
                border:`1px solid ${open?C.borderHi:C.border}`,
                borderRadius:3, overflow:"hidden" }}>
                {/* Header row */}
                <div
                  onClick={()=>setExpanded(e=>({...e,[t.table]:!e[t.table]}))}
                  style={{ display:"grid",
                    gridTemplateColumns:"22px 60px 1fr 80px 90px 90px 80px 60px",
                    gap:8, padding:"5px 8px", cursor:"pointer", alignItems:"center",
                    background: open?C.panelB:C.panel,
                    transition:"background 0.15s" }}>
                  <span style={{ fontSize:9, color:C.muted }}>{open?"▾":"▸"}</span>
                  <span style={{ fontFamily:"'Courier New',monospace", fontSize:10,
                    color:C.accent }}>{t.pid}</span>
                  <div>
                    <span style={{ fontSize:10, fontWeight:700, color:t.ok?C.cyan:C.err,
                      marginRight:8 }}>{t.table}</span>
                    <span style={{ fontSize:9, color:C.muted }}>{t.name}</span>
                  </div>
                  <span style={{ fontSize:9, color:C.muted }}>ver {t.ver}</span>
                  <span style={{ fontSize:9, color:C.muted }}>
                    int {t.interval_ms==="--"?"n/a":`${t.interval_ms} ms`}
                  </span>
                  <span style={{ fontSize:9, color:
                    typeof t.last_ms==="number" && t.last_ms > t.interval_ms*0.9
                    ? C.warn : C.ok }}>
                    last {typeof t.last_ms==="number"?`${t.last_ms} ms`:"n/a"}
                  </span>
                  <Badge label={t.ok?"PRESENT":"ABSENT"}
                    color={t.ok?C.ok:C.err} small/>
                  <span style={{ fontSize:8, color:C.muted }}>
                    {t.tsid!=="-"?`TSID ${t.tsid}`:""}
                  </span>
                </div>

                {/* Expanded detail */}
                {open && (
                  <div style={{ borderTop:`1px solid ${C.borderHi}`,
                    padding:"8px", display:"grid",
                    gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <div>
                      <div style={{ fontSize:8, color:C.muted, marginBottom:4,
                        letterSpacing:"0.1em", textTransform:"uppercase" }}>Description</div>
                      <div style={{ fontSize:10, color:C.text, lineHeight:1.5 }}>{t.desc}</div>
                    </div>
                    <div>
                      <div style={{ fontSize:8, color:C.muted, marginBottom:4,
                        letterSpacing:"0.1em", textTransform:"uppercase" }}>Entries</div>
                      {t.entries.length===0
                        ? <span style={{ fontSize:9, color:C.muted }}>No entries parsed</span>
                        : t.entries.map((e,j) => (
                          <div key={j} style={{ display:"flex", gap:8, alignItems:"center",
                            padding:"2px 0", borderBottom:`1px solid ${C.border}` }}>
                            <Mono v={e.num} c={C.accent} size={9}/>
                            <Mono v={e.pid} c={C.muted} size={9}/>
                            <span style={{ fontSize:9, color:C.text }}>{e.label}</span>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: PIDs
      ═══════════════════════════════════════════════════════════════════ */}
      {tab==="PIDs" && (
        <Panel title="PID Table" right={`${PID_TABLE.length} PIDs`}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <TH>PID</TH><TH>Type</TH><TH>Description</TH>
                <TH right>Bitrate</TH><TH right>CC Errs</TH><TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {PID_TABLE.map((p,i) => (
                <tr key={i} style={{ background:!p.ok?"rgba(255,61,87,0.05)":"transparent" }}>
                  <TD mono><Mono v={p.pid} c={C.accent} size={10}/></TD>
                  <TD>
                    <Badge label={p.type}
                      color={p.type==="Video"?C.purple:p.type==="Audio"?C.info:
                             p.type==="PCR"?C.gold:p.type==="NULL"?C.dim:C.head}
                      small/>
                  </TD>
                  <TD>{p.label}</TD>
                  <TD right mono><Mono v={p.bps} c={C.cyan} size={10}/></TD>
                  <TD right mono><span style={{ color:p.cc>0?C.err:C.muted }}>{p.cc}</span></TD>
                  <TD><Badge label={p.ok?"OK":"ERR"} color={p.ok?C.ok:C.err} small/></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: Programs
      ═══════════════════════════════════════════════════════════════════ */}
      {tab==="Programs" && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {PROGRAMS.map((p,i) => (
            <Panel key={i} title={`${p.name} · ${p.num}`}
              status={p.scrambled?"SCRAMBLED":"FTA"}
              right={p.provider}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 3fr", gap:12 }}>
                <div>
                  <KV k="Program Num"  v={p.num}       vc={C.accent}/>
                  <KV k="Service Name" v={p.name}       vc={C.cyan}/>
                  <KV k="Provider"     v={p.provider}/>
                  <KV k="Running"      v={p.running===4?"Running":"Not running"} vc={C.ok}/>
                  <KV k="Scrambled"    v={p.scrambled?"YES":"NO"} vc={p.scrambled?C.err:C.ok}/>
                  <KV k="EIT"          v={p.eit?"Present":"Absent"} vc={p.eit?C.ok:C.muted}/>
                </div>
                <div>
                  <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.1em",
                    textTransform:"uppercase", marginBottom:4 }}>Elementary Streams</div>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead><tr>
                      <TH>PID</TH><TH>Stream Type</TH><TH>Codec</TH><TH right>Bitrate</TH>
                    </tr></thead>
                    <tbody>
                      {p.streams.map((s,j) => (
                        <tr key={j}>
                          <TD mono><Mono v={s.pid} c={C.accent} size={10}/></TD>
                          <TD>
                            <Badge label={s.type}
                              color={s.type==="Video"?C.purple:s.type==="Audio"?C.info:C.gold}
                              small/>
                          </TD>
                          <TD>{s.codec}</TD>
                          <TD right mono>
                            <Mono v={s.kbps==="-"?"-":`${s.kbps} kbps`} c={C.cyan} size={10}/>
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TAB: Event Log
      ═══════════════════════════════════════════════════════════════════ */}
      {tab==="Event Log" && (
        <Panel title="Event Log" right="live · auto-scroll">
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <TH>Time</TH><TH>Severity</TH><TH>Source</TH><TH>Event</TH>
            </tr></thead>
            <tbody>
              {[
                { t:"09:51:22", sev:"ERROR",   src:"ETR 290",   msg:"CC Error on PID #0x0201 (count: 2)"     },
                { t:"09:50:17", sev:"WARN",    src:"ETR 290",   msg:"P3 SI repetition rate exceeded"         },
                { t:"09:49:58", sev:"INFO",    src:"ST 2022-7", msg:"Leg A IAT avg stable at 489 µs"         },
                { t:"09:49:03", sev:"OK",      src:"Stream",    msg:"Stream OK – 14 TS clients connected"    },
                { t:"09:48:55", sev:"OK",      src:"SFP",       msg:"SFP link UP – 10G, RX –3.2 dBm"        },
                { t:"09:48:30", sev:"INFO",    src:"DVB/SI",    msg:"PAT version updated → v3"               },
                { t:"09:47:11", sev:"INFO",    src:"DVB/SI",    msg:"NIT received – Net: Labotech DVB-IP"    },
                { t:"09:47:05", sev:"OK",      src:"ST 2022-7", msg:"Seamless switchover active – no drops"  },
                { t:"09:46:44", sev:"INFO",    src:"DVB/SI",    msg:"EIT p/f present for Service 1"          },
                { t:"09:46:00", sev:"INFO",    src:"System",    msg:"Session started"                        },
              ].map((e,i) => {
                const c = e.sev==="ERROR"?C.err:e.sev==="WARN"?C.warn:e.sev==="OK"?C.ok:C.info;
                return (
                  <tr key={i} style={{ background:e.sev==="ERROR"?"rgba(255,61,87,0.04)":"transparent" }}>
                    <TD mono><Mono v={e.t} c={C.muted} size={9}/></TD>
                    <TD><Badge label={e.sev} color={c} small/></TD>
                    <TD><span style={{ fontSize:9, color:C.muted }}>{e.src}</span></TD>
                    <TD><span style={{ fontSize:10, color:c==="err"?C.err:C.text }}>{e.msg}</span></TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <div style={{ marginTop:8, borderTop:`1px solid ${C.border}`,
        paddingTop:5, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:9, color:C.muted }}>
          LABOTECH ETR · SMPTE ST 2022-7 · ETSI TR 101 290 · DVB SI/PSI
          · Session #{(tick+0x1A2B).toString(16).toUpperCase()}
        </span>
        <Mono v={`upd ${ts} · pkts ${pkts.toLocaleString()}`} c={C.dim} size={9}/>
      </div>
    </div>
  );
}
