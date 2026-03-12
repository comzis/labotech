import { useState, useEffect, useRef } from "react";

const C = {
  bg:"#06080c", surface:"#0b0e15", panel:"#0d1118", panelAlt:"#0f1420",
  border:"#161d2b", borderHi:"#243045", borderFocus:"#2d5fff",
  text:"#c4d0e8", muted:"#3e506a", dim:"#1a2233",
  ok:"#00e676", warn:"#ffab00", err:"#ff3d57",
  cyan:"#00e5ff", accent:"#2d5fff", purple:"#9d6fff",
  orange:"#ff8c00", head:"#6b82aa", input:"#080b10",
};

// ── Atoms ──────────────────────────────────────────────────────
const Dot = ({ color, size=7 }) => (
  <span style={{ display:"inline-block", width:size, height:size,
    borderRadius:"50%", background:color,
    boxShadow:`0 0 ${size}px ${color}88`, flexShrink:0 }}/>
);

const Badge = ({ label, color=C.ok, filled, small }) => (
  <span style={{ fontSize:small?8:9, fontWeight:800, letterSpacing:"0.1em",
    color:filled?"#06080c":color, background:filled?color:"transparent",
    border:`1px solid ${color}`, borderRadius:2,
    padding:small?"1px 4px":"1px 6px", textTransform:"uppercase",
    whiteSpace:"nowrap" }}>{label}</span>
);

const NavTab = ({ label, icon, active, onClick }) => (
  <button onClick={onClick} style={{
    background:"none", border:"none", cursor:"pointer",
    padding:"6px 10px", display:"flex", flexDirection:"column",
    alignItems:"center", gap:2, opacity:active?1:0.4,
    borderBottom:active?`2px solid ${C.ok}`:"2px solid transparent",
    transition:"all 0.15s",
  }}>
    <span style={{ fontSize:13 }}>{icon}</span>
    <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em",
      color:active?C.ok:C.head, textTransform:"uppercase" }}>{label}</span>
  </button>
);

const Label = ({ children, required }) => (
  <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.11em",
    color:C.head, textTransform:"uppercase", marginBottom:4 }}>
    {children}{required&&<span style={{ color:C.err, marginLeft:2 }}>*</span>}
  </div>
);

const Input = ({ value, onChange, placeholder, mono, disabled, suffix, readOnly }) => (
  <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
    <input value={value} onChange={onChange} placeholder={placeholder}
      disabled={disabled} readOnly={readOnly}
      style={{
        width:"100%", boxSizing:"border-box",
        background: disabled||readOnly ? C.dim : C.input,
        border:`1px solid ${C.border}`, borderRadius:2,
        color: disabled||readOnly ? C.muted : C.text,
        padding:"5px 8px", fontSize:mono?11:11,
        fontFamily:mono?"'Courier New',monospace":"inherit",
        outline:"none", transition:"border-color 0.15s",
        cursor: readOnly?"default":"text",
      }}
      onFocus={e=>!readOnly&&(e.target.style.borderColor=C.borderFocus)}
      onBlur={e=>e.target.style.borderColor=C.border}/>
    {suffix&&<span style={{ position:"absolute", right:7, fontSize:9,
      color:C.muted, pointerEvents:"none" }}>{suffix}</span>}
  </div>
);

const Select = ({ value, onChange, options, disabled }) => (
  <select value={value} onChange={onChange} disabled={disabled} style={{
    width:"100%", background:disabled?C.dim:C.input,
    border:`1px solid ${C.border}`, borderRadius:2,
    color:disabled?C.muted:C.text, padding:"5px 8px",
    fontSize:11, fontFamily:"inherit", outline:"none",
    cursor:disabled?"default":"pointer", appearance:"none",
    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%233e506a'/%3E%3C/svg%3E")`,
    backgroundRepeat:"no-repeat", backgroundPosition:"calc(100% - 8px) center",
    paddingRight:24,
  }}>
    {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
  </select>
);

const Field = ({ label, required, children, style }) => (
  <div style={{ display:"flex", flexDirection:"column", ...style }}>
    {label&&<Label required={required}>{label}</Label>}
    {children}
  </div>
);

const PanelBox = ({ children, style }) => (
  <div style={{ background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:3, overflow:"hidden", ...style }}>{children}</div>
);

const SectionHead = ({ icon, title, active=true, right }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"7px 12px", background:C.panelAlt,
    borderBottom:`1px solid ${C.borderHi}` }}>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:11 }}>{icon}</span>
      <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.15em",
        color:C.head, textTransform:"uppercase" }}>{title}</span>
    </div>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      {right}
      <Dot color={active?C.ok:C.muted}/>
      <span style={{ fontSize:8, color:C.muted }}>▲</span>
    </div>
  </div>
);

// ── Protocol type pill ─────────────────────────────────────────
const ProtoBtn = ({ label, sub, active, onClick, color }) => (
  <button onClick={onClick} style={{
    flex:1, background:active?`${color}14`:"transparent",
    border:`1px solid ${active?color:C.border}`,
    borderRadius:3, padding:"7px 5px", cursor:"pointer",
    textAlign:"center", transition:"all 0.13s",
    boxShadow:active?`0 0 14px ${color}22`:"none",
  }}>
    <div style={{ fontSize:11, fontWeight:800, color:active?color:C.muted,
      letterSpacing:"0.06em" }}>{label}</div>
    {sub&&<div style={{ fontSize:8, color:active?`${color}99`:C.dim,
      letterSpacing:"0.08em", marginTop:1 }}>{sub}</div>}
  </button>
);

// ── Running forwarder row ──────────────────────────────────────
function FwdRow({ fw, onClick, selected }) {
  const [hover, setHover] = useState(false);
  const sCol = fw.status==="RUNNING"?C.ok:fw.status==="ERROR"?C.err:C.muted;
  return (
    <div onClick={onClick}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{
        display:"grid",
        gridTemplateColumns:"120px 90px 1fr 1fr 80px 80px 70px 60px",
        gap:"0 10px", padding:"5px 12px",
        borderBottom:`1px solid ${C.border}`,
        cursor:"pointer", alignItems:"center",
        background:selected?`${sCol}0d`:hover?`${C.borderHi}33`:"transparent",
        borderLeft:selected?`3px solid ${sCol}`:"3px solid transparent",
        transition:"background 0.08s",
      }}>
      <span style={{ fontFamily:"'Courier New',monospace", fontSize:9.5,
        color:selected?C.cyan:C.accent }}>{fw.id}</span>
      <span><Badge label={fw.proto} color={C.cyan} small/></span>
      <span style={{ fontFamily:"'Courier New',monospace", fontSize:9,
        color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
        whiteSpace:"nowrap" }}>{fw.src}</span>
      <span style={{ fontFamily:"'Courier New',monospace", fontSize:9,
        color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
        whiteSpace:"nowrap" }}>{fw.dst}</span>
      <span style={{ fontFamily:"'Courier New',monospace",
        fontSize:10, color:C.cyan, textAlign:"right" }}>{fw.bitrate}</span>
      <span style={{ fontFamily:"'Courier New',monospace",
        fontSize:10, color:C.text, textAlign:"right" }}>{fw.pkts}</span>
      <span style={{ fontFamily:"'Courier New',monospace",
        fontSize:9, color:fw.loss==="0%"?C.ok:C.err,
        textAlign:"right" }}>{fw.loss}</span>
      <span><Badge label={fw.status} color={sCol} small/></span>
    </div>
  );
}

// ── Side panel: forwarder detail ───────────────────────────────
function DetailPanel({ fw, onClose }) {
  if (!fw) return null;
  const sCol = fw.status==="RUNNING"?C.ok:fw.status==="ERROR"?C.err:C.muted;
  return (
    <>
      {/* Click-away backdrop */}
      <div onClick={onClose} style={{
        position:"fixed", inset:0, zIndex:90,
        background:"transparent",
      }}/>
      <div style={{
        position:"fixed", right:0, top:0, bottom:0, width:380,
        background:C.surface, borderLeft:`1px solid ${C.borderHi}`,
        display:"flex", flexDirection:"column", zIndex:100,
        boxShadow:"-14px 0 50px #00000099",
        animation:"slideIn 0.18s ease",
      }}>
        <style>{`@keyframes slideIn{from{transform:translateX(40px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>

        {/* Header */}
        <div style={{ padding:"11px 14px", borderBottom:`1px solid ${C.borderHi}`,
          background:C.panelAlt, display:"flex",
          justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
              <Dot color={sCol}/>
              <span style={{ fontFamily:"'Courier New',monospace", fontSize:13,
                fontWeight:800, color:sCol }}>{fw.id}</span>
              <Badge label={fw.status} color={sCol} small/>
            </div>
            <div style={{ fontSize:9, color:C.muted }}>
              {fw.proto} · {fw.src} → {fw.dst}
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none",
            color:C.muted, cursor:"pointer", fontSize:18,
            lineHeight:1, padding:0 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"10px 14px",
          display:"flex", flexDirection:"column", gap:8 }}>

          {/* Live metrics */}
          <Sec title="📡 Live Network Metrics">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
              {[
                { l:"Bitrate",     v:fw.bitrate,  c:C.cyan },
                { l:"Packets Fwd", v:fw.pkts,     c:C.text },
                { l:"Packet Loss", v:fw.loss,     c:fw.loss==="0%"?C.ok:C.err },
                { l:"Jitter",      v:fw.jitter,   c:fw.jitter==="0.3ms"?C.ok:C.warn },
                { l:"Latency",     v:fw.latency,  c:C.ok },
                { l:"Uptime",      v:fw.uptime,   c:C.text },
                { l:"Restarts",    v:fw.restarts, c:fw.restarts==="0"?C.ok:C.warn },
                { l:"Buffer",      v:fw.buffer,   c:C.ok },
              ].map((s,i)=>(
                <div key={i} style={{ background:C.panel, borderRadius:2,
                  padding:"5px 8px", border:`1px solid ${C.border}`,
                  display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:9, color:C.muted }}>{s.l}</span>
                  <span style={{ fontFamily:"'Courier New',monospace",
                    fontSize:11, fontWeight:700, color:s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          </Sec>

          {/* Source / Destination */}
          <Sec title="🔗 Path Configuration">
            <R2 l="Forwarder ID"  v={fw.id} mono/>
            <R2 l="Protocol"      v={fw.proto} color={C.cyan}/>
            <R2 l="Source"        v={fw.src}  mono/>
            <R2 l="Destination"   v={fw.dst}  mono/>
            <R2 l="TTL"           v={fw.ttl}  mono/>
            <R2 l="NIC"           v={fw.nic}  mono/>
            <R2 l="Subnet"        v={fw.subnet} mono/>
          </Sec>

          {/* QoS */}
          <Sec title="📊 QoS Assessment">
            <div style={{ padding:"8px 10px", background:C.dim,
              border:`1px solid ${fw.loss==="0%"?C.ok+"44":C.err+"44"}`,
              borderRadius:2, fontSize:10, color:C.text, lineHeight:1.6 }}>
              {fw.loss==="0%"
                ? "✅ Stream forwarding nominal. No packet loss detected. All downstream destinations receiving clean signal."
                : "⚠️ Packet loss detected on this forwarder. Downstream decoders may experience CC errors or picture artefacts. Investigate network path."}
            </div>
          </Sec>

          {/* Actions */}
          <Sec title="⚡ Controls">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
              <button style={{ background:`${C.err}14`,
                border:`1px solid ${C.err}`, color:C.err,
                borderRadius:2, padding:"6px 0", cursor:"pointer",
                fontSize:9, fontWeight:800, letterSpacing:"0.1em" }}>
                ■ STOP
              </button>
              <button style={{ background:`${C.warn}14`,
                border:`1px solid ${C.warn}`, color:C.warn,
                borderRadius:2, padding:"6px 0", cursor:"pointer",
                fontSize:9, fontWeight:800, letterSpacing:"0.1em" }}>
                ↺ RESTART
              </button>
              <button style={{ background:`${C.accent}14`,
                border:`1px solid ${C.accent}`, color:C.accent,
                borderRadius:2, padding:"6px 0", cursor:"pointer",
                fontSize:9, fontWeight:800, letterSpacing:"0.1em",
                gridColumn:"1 / -1" }}>
                ✎ EDIT CONFIGURATION
              </button>
            </div>
          </Sec>

          {/* Raw config */}
          <Sec title="🔧 Raw Config">
            <div style={{ fontFamily:"'Courier New',monospace", fontSize:8.5,
              color:C.muted, background:C.input, borderRadius:2,
              padding:"8px 10px", border:`1px solid ${C.border}`,
              lineHeight:1.7, whiteSpace:"pre-wrap" }}>
{`{
  "id":       "${fw.id}",
  "protocol": "${fw.proto}",
  "source":   "${fw.src}",
  "dest":     "${fw.dst}",
  "ttl":      ${fw.ttl},
  "nic":      "${fw.nic}",
  "status":   "${fw.status}",
  "uptime":   "${fw.uptime}"
}`}
            </div>
          </Sec>
        </div>

        <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.border}`,
          background:C.panelAlt }}>
          <button onClick={onClose} style={{ width:"100%", background:"transparent",
            border:`1px solid ${C.border}`, color:C.muted, borderRadius:2,
            padding:"5px 0", cursor:"pointer", fontSize:9,
            fontWeight:700, letterSpacing:"0.1em" }}>
            CLOSE PANEL
          </button>
        </div>
      </div>
    </>
  );
}

const Sec = ({ title, children }) => (
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

const R2 = ({ l, v, mono, color }) => (
  <div style={{ display:"flex", justifyContent:"space-between",
    alignItems:"center", padding:"2px 0",
    borderBottom:`1px solid ${C.dim}` }}>
    <span style={{ fontSize:9, color:C.muted }}>{l}</span>
    <span style={{ fontFamily:mono?"'Courier New',monospace":"inherit",
      fontSize:10, color:color||C.text }}>{v}</span>
  </div>
);

// ── Mock running forwarders ────────────────────────────────────
const MOCK_FWD = [
  { id:"fwd-multicast-01", proto:"UDP",  src:"rtp://239.100.25.10:5000", dst:"239.100.25.29:1234", bitrate:"36.1 Mbps", pkts:"2,841,002", loss:"0%",    jitter:"0.3ms", latency:"1.2ms", uptime:"4h 22m", restarts:"0", buffer:"48ms", ttl:10, nic:"eno2", subnet:"239.100.25.0/26", status:"RUNNING" },
  { id:"fwd-srt-backup-02", proto:"SRT", src:"srt://10.67.18.1:9999",   dst:"srt://10.67.18.29:9999", bitrate:"18.4 Mbps", pkts:"1,204,815", loss:"0%", jitter:"0.3ms", latency:"2.0ms", uptime:"1h 08m", restarts:"1", buffer:"80ms", ttl:10, nic:"eno2", subnet:"239.100.25.0/26", status:"RUNNING" },
  { id:"fwd-rtp-monitor",   proto:"RTP", src:"rtp://239.100.25.10:5000", dst:"rtp://10.0.1.55:5004",  bitrate:"36.0 Mbps", pkts:"988,441",   loss:"0.1%",jitter:"1.4ms", latency:"3.1ms", uptime:"0h 45m", restarts:"0", buffer:"40ms", ttl:5,  nic:"eno3", subnet:"10.0.1.0/24",       status:"ERROR"   },
];

// ── Main ──────────────────────────────────────────────────────
export default function Forwarder() {
  const [activeTab,   setActiveTab]   = useState("forwarding");
  const [fwdId,       setFwdId]       = useState("");
  const [srcProto,    setSrcProto]    = useState("RTP");
  const [srcHost,     setSrcHost]     = useState("239.100.25.10");
  const [srcPort,     setSrcPort]     = useState("5000");
  const [dstProto,    setDstProto]    = useState("UDP");
  const [dstIp,       setDstIp]       = useState("239.100.25.29");
  const [dstPort,     setDstPort]     = useState("1234");
  const [ttl,         setTtl]         = useState("10");
  const [multicast,   setMulticast]   = useState("");
  const [latency,     setLatency]     = useState("2000");
  const [encryption,  setEncryption]  = useState("None");
  const [approved,    setApproved]    = useState(false);
  const [selected,    setSelected]    = useState(null);
  const [forwarders,  setForwarders]  = useState(MOCK_FWD);

  const srcPreview = `${srcProto.toLowerCase()}://${srcHost}:${srcPort}`;
  const dstPreview = `${dstProto.toLowerCase()}://${dstIp}:${dstPort}`;

  const tabs = [
    { id:"analyser",   label:"TS Analyser",  icon:"📡" },
    { id:"runtime",    label:"Runtime",      icon:"⚡" },
    { id:"transcoder", label:"Transcoder",   icon:"🔄" },
    { id:"forwarding", label:"Forwarding",   icon:"➡️"  },
    { id:"decoder",    label:"Decoder",      icon:"📺" },
    { id:"multiview",  label:"Multiview",    icon:"⊞"  },
    { id:"live",       label:"Live View",    icon:"🔴" },
    { id:"alarms",     label:"Alarm Log",    icon:"🔔" },
    { id:"api",        label:"API",          icon:"⚙️"  },
  ];

  const g = (cols, gap=8) => ({ display:"grid", gridTemplateColumns:cols, gap });
  const running = forwarders.filter(f=>f.status==="RUNNING").length;
  const errors  = forwarders.filter(f=>f.status==="ERROR").length;

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
          <span style={{ fontSize:7, color:C.dim }}>HPE DL360 · Docker</span>
        </div>
        <div style={{ display:"flex", gap:2 }}>
          {tabs.map(t=>(
            <NavTab key={t.id} label={t.label} icon={t.icon}
              active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}/>
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
              fontFamily:"'Courier New',monospace" }}>8.6%</span>
            <div style={{ color:C.dim, fontFamily:"'Courier New',monospace",
              fontSize:8 }}>5495/64038MB</div>
          </div>
          <Badge label="● ONLINE" color={C.ok} filled/>
        </div>
      </div>

      {/* ── PAGE HEADER ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 16px 8px", borderBottom:`1px solid ${C.border}`,
        background:C.surface }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18, color:C.ok }}>⬡</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700, letterSpacing:"0.03em" }}>
              Forwarder Workflow
            </div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.12em",
              textTransform:"uppercase" }}>
              Network Distribution & Group Forwarding
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {errors>0 && <Badge label={`${errors} ERROR`} color={C.err}/>}
          <Badge label={`${running} RUNNING`} color={running>0?C.ok:C.muted}/>
          <button style={{ background:"transparent", border:`1px solid ${C.border}`,
            color:C.muted, borderRadius:2, padding:"5px 16px",
            cursor:"pointer", fontSize:10, fontWeight:600,
            letterSpacing:"0.08em", textTransform:"uppercase" }}>
            Cancel
          </button>
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column",
        gap:8, padding:8,
        marginRight: selected ? 380 : 0,
        transition:"margin-right 0.18s ease" }}>

        {/* ── INTERFACE STATUS BAR ── */}
        <PanelBox>
          <SectionHead icon="🖧" title="Interface Configuration"
            right={<Badge label="eno2 UP" color={C.ok} small/>}/>
          <div style={{ display:"grid",
            gridTemplateColumns:"repeat(5,1fr)",
            gap:0, padding:"10px 14px" }}>
            {[
              { l:"NIC",        v:"eno2",              c:C.ok   },
              { l:"Subnet",     v:"239.100.25.0/26",   c:C.ok   },
              { l:"Default IP", v:"239.100.25.29",     c:C.ok   },
              { l:"TTL",        v:"10",                c:C.text },
              { l:"Link Speed", v:"10 GbE",            c:C.cyan },
            ].map((s,i)=>(
              <div key={i} style={{ borderRight:i<4?`1px solid ${C.border}`:"none",
                padding:"0 16px 0 0", marginRight:i<4?16:0 }}>
                <div style={{ fontSize:9, color:C.muted, fontWeight:700,
                  letterSpacing:"0.1em", textTransform:"uppercase",
                  marginBottom:3 }}>{s.l}</div>
                <div style={{ fontFamily:"'Courier New',monospace",
                  fontSize:13, fontWeight:700, color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
        </PanelBox>

        {/* ── SOURCE + DESTINATION ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>

          {/* Source */}
          <PanelBox>
            <SectionHead icon="📥" title="Source Configuration"/>
            <div style={{ padding:"12px 14px", display:"flex",
              flexDirection:"column", gap:10 }}>

              <Field label="Forwarder ID" required>
                <Input value={fwdId} onChange={e=>setFwdId(e.target.value)}
                  placeholder="e.g. fwd-multicast-01" mono/>
              </Field>

              <div>
                <Label>Source Protocol</Label>
                <div style={{ display:"flex", gap:4 }}>
                  {["RTP","UDP","SRT","RTMP"].map(p=>(
                    <ProtoBtn key={p} label={p} active={srcProto===p}
                      onClick={()=>setSrcProto(p)} color={C.cyan}/>
                  ))}
                </div>
              </div>

              <div style={g("1fr 100px")}>
                <Field label="Source Host / IP" required>
                  <Input value={srcHost} onChange={e=>setSrcHost(e.target.value)}
                    placeholder="239.x.x.x or hostname" mono/>
                </Field>
                <Field label="Source Port" required>
                  <Input value={srcPort} onChange={e=>setSrcPort(e.target.value)} mono/>
                </Field>
              </div>

              {srcProto==="SRT" && (
                <div style={g("1fr 1fr")}>
                  <Field label="SRT Latency (ms)">
                    <Input value={latency} onChange={e=>setLatency(e.target.value)}
                      mono suffix="ms"/>
                  </Field>
                  <Field label="Encryption">
                    <Select value={encryption} onChange={e=>setEncryption(e.target.value)}
                      options={["None","AES-128","AES-256"]}/>
                  </Field>
                </div>
              )}

              {/* URL Preview */}
              <div style={{ padding:"6px 8px", background:C.dim,
                border:`1px solid ${C.border}`, borderRadius:2 }}>
                <div style={{ fontSize:8, color:C.muted, fontWeight:700,
                  letterSpacing:"0.1em", textTransform:"uppercase",
                  marginBottom:2 }}>Source URL Preview</div>
                <div style={{ fontFamily:"'Courier New',monospace",
                  fontSize:10, color: srcHost ? C.cyan : C.muted }}>
                  {srcHost ? srcPreview : "— fill in source fields above —"}
                </div>
              </div>
            </div>
          </PanelBox>

          {/* Destination */}
          <PanelBox>
            <SectionHead icon="📤" title="Destination Configuration"/>
            <div style={{ padding:"12px 14px", display:"flex",
              flexDirection:"column", gap:10 }}>

              <div>
                <Label>Output Protocol</Label>
                <div style={{ display:"flex", gap:4 }}>
                  {["UDP","SRT","RTP","RTMP"].map(p=>(
                    <ProtoBtn key={p} label={p} active={dstProto===p}
                      onClick={()=>setDstProto(p)} color={C.ok}/>
                  ))}
                </div>
              </div>

              <div style={g("1fr 100px")}>
                <Field label="Destination IP" required>
                  <Input value={dstIp} onChange={e=>setDstIp(e.target.value)}
                    placeholder="239.x.x.x" mono/>
                </Field>
                <Field label="Dest Port" required>
                  <Input value={dstPort} onChange={e=>setDstPort(e.target.value)} mono/>
                </Field>
              </div>

              <div style={g("1fr 1fr")}>
                <Field label="TTL">
                  <Input value={ttl} onChange={e=>setTtl(e.target.value)} mono/>
                </Field>
                <Field label="Bind / Multicast IP">
                  <Input value={multicast} onChange={e=>setMulticast(e.target.value)}
                    placeholder="optional" mono/>
                </Field>
              </div>

              {/* Restriction notice */}
              <div style={{ padding:"6px 8px", background:`${C.warn}0e`,
                border:`1px solid ${C.warn}44`, borderRadius:2,
                fontSize:9, color:C.muted, lineHeight:1.6 }}>
                ⚠ Allowed destination is restricted to{" "}
                <span style={{ fontFamily:"'Courier New',monospace",
                  color:C.warn }}>239.100.25.29</span>.
                Contact NOC to authorise additional subnets.
              </div>

              {/* URL Preview */}
              <div style={{ padding:"6px 8px", background:C.dim,
                border:`1px solid ${C.border}`, borderRadius:2 }}>
                <div style={{ fontSize:8, color:C.muted, fontWeight:700,
                  letterSpacing:"0.1em", textTransform:"uppercase",
                  marginBottom:2 }}>Destination URL Preview</div>
                <div style={{ fontFamily:"'Courier New',monospace",
                  fontSize:10, color:dstIp?C.ok:C.muted }}>
                  {dstIp ? dstPreview : "— fill in destination fields above —"}
                </div>
              </div>

              {/* Engineer approval */}
              <label style={{
                display:"flex", alignItems:"center", gap:8,
                cursor:"pointer", padding:"7px 10px",
                background:approved?`${C.ok}10`:C.dim,
                border:`1px solid ${approved?C.ok:C.border}`,
                borderRadius:2, transition:"all 0.15s",
              }}>
                <input type="checkbox" checked={approved}
                  onChange={e=>setApproved(e.target.checked)}
                  style={{ accentColor:C.ok, width:13, height:13 }}/>
                <span style={{ fontSize:10,
                  color:approved?C.ok:C.muted,
                  fontWeight:approved?700:400 }}>
                  Engineer approval confirmed for forwarding start
                </span>
              </label>
            </div>
          </PanelBox>
        </div>

        {/* ── INITIATE BUTTON ── */}
        <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
          <button disabled={!approved} style={{
            background: approved
              ? `linear-gradient(135deg, ${C.ok}, #00c853)`
              : C.dim,
            border:"none",
            color: approved ? "#06080c" : C.muted,
            borderRadius:3, padding:"9px 32px",
            cursor: approved ? "pointer" : "not-allowed",
            fontSize:11, fontWeight:800, letterSpacing:"0.1em",
            textTransform:"uppercase",
            boxShadow: approved ? `0 0 24px ${C.ok}55` : "none",
            transition:"all 0.2s",
          }}>
            ▶ INITIATE FORWARDER
          </button>
        </div>

        {/* ── RUNNING FORWARDERS TABLE ── */}
        <PanelBox>
          <div style={{ display:"flex", alignItems:"center",
            justifyContent:"space-between", padding:"7px 12px",
            background:C.panelAlt, borderBottom:`1px solid ${C.borderHi}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.15em",
                color:C.head, textTransform:"uppercase" }}>
                Running Forwarders
              </span>
              <Badge label={`${running} ACTIVE`} color={running>0?C.ok:C.muted} small/>
              {errors>0 && <Badge label={`${errors} ERROR`} color={C.err} small/>}
            </div>
            <span style={{ fontSize:9, color:C.muted }}>
              Click row for detail · Max concurrent: 8
            </span>
          </div>

          {/* Headers */}
          <div style={{ display:"grid",
            gridTemplateColumns:"120px 90px 1fr 1fr 80px 80px 70px 60px",
            gap:"0 10px", padding:"4px 12px",
            background:C.panelAlt, borderBottom:`1px solid ${C.borderHi}` }}>
            {["ID","PROTO","SOURCE","DESTINATION","BITRATE","PACKETS","LOSS","STATUS"].map(h=>(
              <span key={h} style={{ fontSize:8.5, fontWeight:800,
                letterSpacing:"0.12em", color:C.head,
                textTransform:"uppercase" }}>{h}</span>
            ))}
          </div>

          {forwarders.length===0 ? (
            <div style={{ padding:30, textAlign:"center",
              color:C.muted, fontSize:10, fontStyle:"italic" }}>
              No active forwarders — configure above and click Initiate Forwarder
            </div>
          ) : (
            forwarders.map(fw=>(
              <FwdRow key={fw.id} fw={fw}
                selected={selected?.id===fw.id}
                onClick={()=>setSelected(selected?.id===fw.id ? null : fw)}/>
            ))
          )}
        </PanelBox>
      </div>

      {/* ── DETAIL SIDE PANEL ── */}
      {selected && (
        <DetailPanel fw={selected} onClose={()=>setSelected(null)}/>
      )}

      {/* ── FOOTER ── */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"4px 14px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:C.surface, flexShrink:0,
        marginRight:selected?380:0, transition:"margin-right 0.18s ease" }}>
        <span style={{ fontSize:9, color:C.muted }}>
          LABOTECH · Broadcast Engine · Forwarder Workflow
          {selected && <span style={{ color:C.cyan, marginLeft:10 }}>
            ← {selected.id} · {selected.proto}
          </span>}
        </span>
        <span style={{ fontFamily:"'Courier New',monospace",
          fontSize:9, color:C.muted }}>
          NIC eno2 · 239.100.25.0/26
        </span>
      </div>
    </div>
  );
}
