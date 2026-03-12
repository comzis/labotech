import { useState } from "react";

// ── Tokens ─────────────────────────────────────────────────────
const C = {
  bg:       "#06080c",
  surface:  "#0b0e15",
  panel:    "#0d1118",
  panelAlt: "#0f1420",
  border:   "#161d2b",
  borderHi: "#243045",
  borderFocus:"#2d5fff",
  text:     "#c4d0e8",
  muted:    "#3e506a",
  dim:      "#1e2a3a",
  ok:       "#00e676",
  warn:     "#ffab00",
  err:      "#ff3d57",
  cyan:     "#00e5ff",
  accent:   "#2d5fff",
  purple:   "#9d6fff",
  head:     "#6b82aa",
  input:    "#080b10",
};

// ── Reusable UI atoms ──────────────────────────────────────────
const Dot = ({ color, size = 7 }) => (
  <span style={{ display:"inline-block", width:size, height:size,
    borderRadius:"50%", background:color,
    boxShadow:`0 0 ${size}px ${color}88`, flexShrink:0 }}/>
);

const Badge = ({ label, color=C.ok, filled }) => (
  <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.1em",
    color: filled ? "#06080c" : color,
    background: filled ? color : "transparent",
    border:`1px solid ${color}`, borderRadius:2,
    padding:"1px 6px", textTransform:"uppercase" }}>{label}</span>
);

const NavTab = ({ label, icon, active, onClick }) => (
  <button onClick={onClick} style={{
    background:"none", border:"none", cursor:"pointer",
    padding:"6px 10px", display:"flex", flexDirection:"column",
    alignItems:"center", gap:2,
    opacity: active ? 1 : 0.4,
    borderBottom: active ? `2px solid ${C.cyan}` : "2px solid transparent",
    transition:"all 0.15s",
  }}>
    <span style={{ fontSize:13 }}>{icon}</span>
    <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em",
      color: active ? C.cyan : C.head, textTransform:"uppercase" }}>{label}</span>
  </button>
);

// ── Form atoms ─────────────────────────────────────────────────
const Label = ({ children, required }) => (
  <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.11em",
    color:C.head, textTransform:"uppercase", marginBottom:4 }}>
    {children}{required && <span style={{ color:C.err, marginLeft:2 }}>*</span>}
  </div>
);

const Input = ({ value, onChange, placeholder, mono, disabled, suffix }) => (
  <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
    <input
      value={value} onChange={onChange} placeholder={placeholder}
      disabled={disabled}
      style={{
        width:"100%", boxSizing:"border-box",
        background: disabled ? C.dim : C.input,
        border:`1px solid ${C.border}`,
        borderRadius:2, color: disabled ? C.muted : C.text,
        padding:"5px 8px", fontSize: mono ? 12 : 11,
        fontFamily: mono ? "'Courier New',monospace" : "inherit",
        outline:"none",
        transition:"border-color 0.15s",
      }}
      onFocus={e => e.target.style.borderColor = C.borderFocus}
      onBlur={e  => e.target.style.borderColor = C.border}
    />
    {suffix && (
      <span style={{ position:"absolute", right:6, fontSize:9,
        color:C.muted, pointerEvents:"none" }}>{suffix}</span>
    )}
  </div>
);

const Select = ({ value, onChange, options }) => (
  <select value={value} onChange={onChange} style={{
    width:"100%", background:C.input, border:`1px solid ${C.border}`,
    borderRadius:2, color:C.text, padding:"5px 8px",
    fontSize:11, fontFamily:"inherit", outline:"none",
    cursor:"pointer", appearance:"none",
    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%233e506a'/%3E%3C/svg%3E")`,
    backgroundRepeat:"no-repeat", backgroundPosition:"calc(100% - 8px) center",
    paddingRight:24,
  }}>
    {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
  </select>
);

const Field = ({ label, required, children, style }) => (
  <div style={{ display:"flex", flexDirection:"column", ...style }}>
    <Label required={required}>{label}</Label>
    {children}
  </div>
);

const SectionHead = ({ icon, title, active = true }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"7px 12px", borderBottom:`1px solid ${C.border}`,
    background: C.panelAlt, borderRadius:"3px 3px 0 0" }}>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:12 }}>{icon}</span>
      <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.15em",
        color:C.head, textTransform:"uppercase" }}>{title}</span>
    </div>
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <Dot color={active ? C.ok : C.muted}/>
      <span style={{ fontSize:8, color:C.muted, cursor:"pointer" }}>▲</span>
    </div>
  </div>
);

const Divider = ({ label }) => (
  <div style={{ display:"flex", alignItems:"center", gap:8, margin:"6px 0" }}>
    <div style={{ flex:1, height:1, background:C.border }}/>
    {label && <span style={{ fontSize:8, color:C.muted, letterSpacing:"0.12em",
      textTransform:"uppercase" }}>{label}</span>}
    <div style={{ flex:1, height:1, background:C.border }}/>
  </div>
);

const PanelBox = ({ children, style }) => (
  <div style={{ background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:3, ...style }}>{children}</div>
);

// ── Audio Matrix Row ───────────────────────────────────────────
const AudioRow = ({ src, codec, bitrate, ch, pid, lang, onRemove }) => (
  <div style={{ display:"grid",
    gridTemplateColumns:"28px 1fr 70px 44px 60px 60px 28px",
    gap:4, padding:"4px 8px", alignItems:"center",
    borderBottom:`1px solid ${C.border}`,
    background:C.input,
  }}>
    <span style={{ fontFamily:"'Courier New',monospace", fontSize:10,
      color:C.accent, textAlign:"center" }}>{src}</span>
    <Input value={codec} mono placeholder="aac"/>
    <Input value={bitrate} mono placeholder="256k" suffix="k"/>
    <Input value={ch} mono placeholder="2"/>
    <Input value={pid} mono placeholder="auto"/>
    <Input value={lang} mono placeholder="eng"/>
    <button onClick={onRemove} style={{ background:"none", border:"none",
      color:C.err, cursor:"pointer", fontSize:13, padding:0,
      opacity:0.6, lineHeight:1 }}>×</button>
  </div>
);

// ── PID Row (DVB SI) ───────────────────────────────────────────
const PidRow = ({ label, value, onChange }) => (
  <div style={{ display:"flex", justifyContent:"space-between",
    alignItems:"center", padding:"3px 0", borderBottom:`1px solid ${C.border}` }}>
    <span style={{ fontSize:9, color:C.head, letterSpacing:"0.08em",
      textTransform:"uppercase", minWidth:110 }}>{label}</span>
    <div style={{ width:80 }}>
      <Input value={value} onChange={onChange} mono/>
    </div>
  </div>
);

// ── Main ──────────────────────────────────────────────────────
export default function EncoderConfig() {
  const [activeTab, setActiveTab] = useState("runtime");

  // Transport & Networking
  const [channelId,   setChannelId]   = useState("");
  const [inputMode,   setInputMode]   = useState("RTP");
  const [inputHost,   setInputHost]   = useState("239.100.25.29");
  const [inputPort,   setInputPort]   = useState("6501");
  const [bindIp,      setBindIp]      = useState("");
  const [outputMode,  setOutputMode]  = useState("SRT");
  const [srtHost,     setSrtHost]     = useState("");
  const [srtPort,     setSrtPort]     = useState("9999");
  const [latency,     setLatency]     = useState("2000");
  const [passphrase,  setPassphrase]  = useState("");
  const [encryption,  setEncryption]  = useState("AES-128");
  const [adapterIp,   setAdapterIp]   = useState("10.67.18.29");
  const [streamId,    setStreamId]    = useState("");

  // DVB / TS Service
  const [serviceId,   setServiceId]   = useState("1");
  const [tsId,        setTsId]        = useState("1");
  const [netId,       setNetId]       = useState("1");
  const [pmtPid,      setPmtPid]      = useState("4096");
  const [serviceName, setServiceName] = useState("");
  const [provName,    setProvName]    = useState("");
  const [serviceType, setServiceType] = useState("1");

  // Video encoding
  const [vCodec,      setVCodec]      = useState("H.264");
  const [vBitrate,    setVBitrate]    = useState("8000");
  const [vRes,        setVRes]        = useState("1920x1080");
  const [vFps,        setVFps]        = useState("25");
  const [vProfile,    setVProfile]    = useState("High");
  const [vGop,        setVGop]        = useState("50");
  const [vPid,        setVPid]        = useState("256");

  // Audio matrix
  const [audioRows, setAudioRows] = useState([
    { src:0, codec:"aac", bitrate:"256", ch:"2", pid:"auto", lang:"eng" },
  ]);

  const addAudioRow = () => setAudioRows(r => [
    ...r, { src:r.length, codec:"aac", bitrate:"192", ch:"2", pid:"auto", lang:"eng" }
  ]);
  const removeAudioRow = i => setAudioRows(r => r.filter((_,j)=>j!==i));

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

  const g = (cols, gap=8) => ({
    display:"grid", gridTemplateColumns:cols, gap,
  });

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", background:C.bg,
      color:C.text, minHeight:"100vh", display:"flex",
      flexDirection:"column", fontSize:11 }}>

      {/* ── TOPBAR ── */}
      <div style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", background:C.surface,
        borderBottom:`1px solid ${C.borderHi}`,
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
              active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}/>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center", minWidth:200,
          justifyContent:"flex-end" }}>
          <div style={{ fontSize:9, textAlign:"right", lineHeight:1.6 }}>
            <span style={{ color:C.muted }}>CPU </span>
            <span style={{ color:C.ok, fontWeight:700, fontFamily:"'Courier New',monospace" }}>0.6%</span>
            {"  "}
            <span style={{ color:C.muted }}>MEM </span>
            <span style={{ color:C.warn, fontWeight:700, fontFamily:"'Courier New',monospace" }}>8.3%</span>
            <div style={{ color:C.dim, fontFamily:"'Courier New',monospace", fontSize:8 }}>5321/64038MB</div>
          </div>
          <Badge label="● ONLINE" color={C.ok} filled/>
        </div>
      </div>

      {/* ── PAGE HEADER ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 16px 8px", borderBottom:`1px solid ${C.border}`,
        background:C.surface }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:16 }}>⚡</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:C.text,
              letterSpacing:"0.04em" }}>Encoder Configuration</div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.1em",
              textTransform:"uppercase" }}>Runtime · Instance Setup</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={{ background:"transparent", border:`1px solid ${C.border}`,
            color:C.muted, borderRadius:2, padding:"5px 16px", cursor:"pointer",
            fontSize:10, fontWeight:600, letterSpacing:"0.06em" }}>
            ✕ Cancel
          </button>
          <button style={{ background:C.accent, border:"none",
            color:"#fff", borderRadius:2, padding:"5px 20px", cursor:"pointer",
            fontSize:10, fontWeight:700, letterSpacing:"0.08em",
            boxShadow:`0 0 12px ${C.accent}66` }}>
            ▶ APPLY
          </button>
          <button style={{ background:`${C.ok}18`, border:`1px solid ${C.ok}`,
            color:C.ok, borderRadius:2, padding:"5px 16px", cursor:"pointer",
            fontSize:10, fontWeight:700, letterSpacing:"0.08em" }}>
            ● START
          </button>
        </div>
      </div>

      {/* ── BODY: 3-column layout ── */}
      <div style={{ flex:1, display:"grid",
        gridTemplateColumns:"1fr 1fr 280px",
        gap:8, padding:8, alignItems:"start" }}>

        {/* ══ COL 1: Transport & Networking ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <PanelBox>
            <SectionHead icon="📡" title="Transport & Networking"/>
            <div style={{ padding:"10px 12px", display:"flex",
              flexDirection:"column", gap:10 }}>

              <div style={g("1fr 1fr")}>
                <Field label="Channel ID" required>
                  <Input value={channelId} onChange={e=>setChannelId(e.target.value)}
                    placeholder="e.g. encoder-001" mono/>
                </Field>
                <Field label="Input Mode" required>
                  <Select value={inputMode} onChange={e=>setInputMode(e.target.value)}
                    options={["RTP","UDP","SRT","RTMP","NDI","File"]}/>
                </Field>
              </div>

              <div style={g("1fr 120px")}>
                <Field label="Input Host / IP" required>
                  <Input value={inputHost} onChange={e=>setInputHost(e.target.value)}
                    placeholder="239.x.x.x or hostname" mono/>
                </Field>
                <Field label="Input Port" required>
                  <Input value={inputPort} onChange={e=>setInputPort(e.target.value)}
                    placeholder="6501" mono/>
                </Field>
              </div>

              <Field label="Input Bind IP (optional)">
                <Input value={bindIp} onChange={e=>setBindIp(e.target.value)}
                  placeholder="Leave blank for eno2 multicast" mono/>
              </Field>

              <Divider label="Output"/>

              <Field label="Output Mode" required>
                <Select value={outputMode} onChange={e=>setOutputMode(e.target.value)}
                  options={[
                    { value:"SRT",  label:"SRT — Secure Reliable Transport" },
                    { value:"UDP",  label:"UDP — Multicast / Unicast" },
                    { value:"RTMP", label:"RTMP — Live Streaming" },
                    { value:"RTP",  label:"RTP — Real-time Protocol" },
                  ]}/>
              </Field>

              {outputMode === "SRT" && (
                <>
                  <div style={g("1fr 100px 110px")}>
                    <Field label="SRT Target Host" required>
                      <Input value={srtHost} onChange={e=>setSrtHost(e.target.value)}
                        placeholder="srt://host or IP" mono/>
                    </Field>
                    <Field label="Port">
                      <Input value={srtPort} onChange={e=>setSrtPort(e.target.value)} mono/>
                    </Field>
                    <Field label="Latency (ms)">
                      <Input value={latency} onChange={e=>setLatency(e.target.value)}
                        mono suffix="ms"/>
                    </Field>
                  </div>

                  <div style={g("1fr 140px 1fr 1fr")}>
                    <Field label="Passphrase">
                      <Input value={passphrase} onChange={e=>setPassphrase(e.target.value)}
                        placeholder="optional" mono/>
                    </Field>
                    <Field label="Encryption">
                      <Select value={encryption} onChange={e=>setEncryption(e.target.value)}
                        options={["None","AES-128","AES-192","AES-256"]}/>
                    </Field>
                    <Field label="Adapter / Bind IP">
                      <Input value={adapterIp} onChange={e=>setAdapterIp(e.target.value)} mono/>
                    </Field>
                    <Field label="Stream ID">
                      <Input value={streamId} onChange={e=>setStreamId(e.target.value)}
                        placeholder="optional" mono/>
                    </Field>
                  </div>
                </>
              )}

              {outputMode === "UDP" && (
                <div style={g("1fr 120px")}>
                  <Field label="Destination IP" required>
                    <Input value="" placeholder="239.x.x.x" mono/>
                  </Field>
                  <Field label="Port" required>
                    <Input value="5500" mono/>
                  </Field>
                </div>
              )}
            </div>
          </PanelBox>

          {/* DVB / TS Service */}
          <PanelBox>
            <SectionHead icon="📺" title="DVB / TS Service"/>
            <div style={{ padding:"10px 12px" }}>
              <div style={g("1fr 1fr", 8)}>
                <div>
                  <PidRow label="Service ID"     value={serviceId}   onChange={e=>setServiceId(e.target.value)}/>
                  <PidRow label="TS ID"          value={tsId}        onChange={e=>setTsId(e.target.value)}/>
                  <PidRow label="Orig Network ID" value={netId}      onChange={e=>setNetId(e.target.value)}/>
                  <PidRow label="PMT PID"        value={pmtPid}      onChange={e=>setPmtPid(e.target.value)}/>
                </div>
                <div>
                  <Field label="Service Name" style={{ marginBottom:6 }}>
                    <Input value={serviceName} onChange={e=>setServiceName(e.target.value)}
                      placeholder="e.g. BBC ONE HD"/>
                  </Field>
                  <Field label="Provider Name" style={{ marginBottom:6 }}>
                    <Input value={provName} onChange={e=>setProvName(e.target.value)}
                      placeholder="e.g. LABOTECH"/>
                  </Field>
                  <Field label="Service Type">
                    <Select value={serviceType} onChange={e=>setServiceType(e.target.value)}
                      options={[
                        { value:"1",  label:"01 — Digital TV" },
                        { value:"2",  label:"02 — Digital Radio" },
                        { value:"17", label:"17 — HDTV (H.264)" },
                        { value:"25", label:"25 — HDTV (H.265)" },
                      ]}/>
                  </Field>
                </div>
              </div>
            </div>
          </PanelBox>
        </div>

        {/* ══ COL 2: Video Encoding + PID Map ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <PanelBox>
            <SectionHead icon="🎬" title="Video Encoding"/>
            <div style={{ padding:"10px 12px", display:"flex",
              flexDirection:"column", gap:10 }}>

              <div style={g("1fr 1fr")}>
                <Field label="Codec">
                  <Select value={vCodec} onChange={e=>setVCodec(e.target.value)}
                    options={["H.264","H.265 / HEVC","AV1","MPEG-2"]}/>
                </Field>
                <Field label="Profile">
                  <Select value={vProfile} onChange={e=>setVProfile(e.target.value)}
                    options={["Baseline","Main","High","High 10"]}/>
                </Field>
              </div>

              <div style={g("1fr 1fr 1fr 1fr")}>
                <Field label="Bitrate (kbps)">
                  <Input value={vBitrate} onChange={e=>setVBitrate(e.target.value)}
                    mono suffix="k"/>
                </Field>
                <Field label="Resolution">
                  <Select value={vRes} onChange={e=>setVRes(e.target.value)}
                    options={["3840x2160","1920x1080","1280x720","720x576","720x480"]}/>
                </Field>
                <Field label="Frame Rate">
                  <Select value={vFps} onChange={e=>setVFps(e.target.value)}
                    options={["23.976","24","25","29.97","30","50","59.94","60"]}/>
                </Field>
                <Field label="GOP Size">
                  <Input value={vGop} onChange={e=>setVGop(e.target.value)} mono/>
                </Field>
              </div>

              <div style={g("1fr 1fr 1fr")}>
                <Field label="Rate Control">
                  <Select value="CBR" options={["CBR","VBR","CQP","CRF"]}/>
                </Field>
                <Field label="B-Frames">
                  <Input value="2" mono/>
                </Field>
                <Field label="Video PID">
                  <Input value={vPid} onChange={e=>setVPid(e.target.value)} mono/>
                </Field>
              </div>

              {/* Encoding stats bar */}
              <div style={{ display:"flex", gap:4, padding:"6px 8px",
                background:C.input, borderRadius:2, border:`1px solid ${C.border}`,
                marginTop:2 }}>
                {[
                  { l:"Status",  v:"IDLE",   c:C.muted },
                  { l:"Encoded", v:"—",      c:C.muted },
                  { l:"Dropped", v:"—",      c:C.muted },
                  { l:"Bitrate", v:"—",      c:C.muted },
                  { l:"Latency", v:"—",      c:C.muted },
                ].map((s,i) => (
                  <div key={i} style={{ flex:1, textAlign:"center",
                    borderRight: i<4 ? `1px solid ${C.border}` : "none",
                    paddingRight:4 }}>
                    <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em",
                      textTransform:"uppercase" }}>{s.l}</div>
                    <div style={{ fontFamily:"'Courier New',monospace",
                      fontSize:11, fontWeight:700, color:s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </PanelBox>

          {/* PID Map */}
          <PanelBox>
            <SectionHead icon="🗺" title="PID Map"/>
            <div style={{ padding:"10px 12px" }}>
              <div style={{ display:"grid",
                gridTemplateColumns:"80px 60px 60px 80px 80px",
                gap:"2px 8px", fontSize:9, color:C.head, fontWeight:700,
                letterSpacing:"0.1em", textTransform:"uppercase",
                borderBottom:`1px solid ${C.borderHi}`, paddingBottom:4, marginBottom:4 }}>
                <span>Stream</span><span>Type</span><span>PID</span><span>Codec</span><span>Status</span>
              </div>
              {[
                { stream:"Video",    type:"V",   pid:"256",  codec:vCodec,  ok:true  },
                { stream:"Audio 0",  type:"A",   pid:"auto", codec:"AAC",   ok:true  },
                { stream:"PMT",      type:"PSI", pid:pmtPid, codec:"—",     ok:true  },
                { stream:"PCR",      type:"PCR", pid:"256",  codec:"—",     ok:true  },
                { stream:"PAT",      type:"PSI", pid:"0",    codec:"—",     ok:true  },
              ].map((r,i) => (
                <div key={i} style={{ display:"grid",
                  gridTemplateColumns:"80px 60px 60px 80px 80px",
                  gap:"2px 8px", padding:"2px 0",
                  borderBottom:`1px solid ${C.border}`, alignItems:"center" }}>
                  <span style={{ fontSize:10, color:C.text }}>{r.stream}</span>
                  <span style={{ fontSize:9 }}>
                    <Badge label={r.type}
                      color={r.type==="V"?C.cyan:r.type==="A"?C.purple:C.muted}/>
                  </span>
                  <span style={{ fontFamily:"'Courier New',monospace",
                    fontSize:10, color:C.accent }}>{r.pid}</span>
                  <span style={{ fontSize:9, color:C.muted }}>{r.codec}</span>
                  <span><Badge label="READY" color={C.ok}/></span>
                </div>
              ))}
            </div>
          </PanelBox>

          {/* Mux Settings */}
          <PanelBox>
            <SectionHead icon="🔧" title="Mux Settings"/>
            <div style={{ padding:"10px 12px" }}>
              <div style={g("1fr 1fr 1fr 1fr")}>
                <Field label="Mux Bitrate (kbps)">
                  <Input value="10000" mono suffix="k"/>
                </Field>
                <Field label="PCR Interval (ms)">
                  <Input value="40" mono suffix="ms"/>
                </Field>
                <Field label="PCR PID">
                  <Input value="256" mono/>
                </Field>
                <Field label="Stuffing">
                  <Select value="CBR" options={["CBR","VBR"]}/>
                </Field>
              </div>
            </div>
          </PanelBox>
        </div>

        {/* ══ COL 3: Audio Matrix + Quick Status ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>

          {/* Audio Matrix */}
          <PanelBox>
            <SectionHead icon="🎚" title="Audio Matrix"/>
            {/* Column headers */}
            <div style={{ display:"grid",
              gridTemplateColumns:"28px 1fr 70px 44px 60px 60px 28px",
              gap:4, padding:"4px 8px",
              background:C.panelAlt,
              borderBottom:`1px solid ${C.borderHi}`,
              fontSize:8, color:C.head, fontWeight:800, letterSpacing:"0.12em",
              textTransform:"uppercase" }}>
              <span>#</span><span>CODEC</span><span>BITRATE</span><span>CH</span>
              <span>PID</span><span>LANG</span><span></span>
            </div>

            {audioRows.map((r,i) => (
              <AudioRow key={i} {...r} onRemove={()=>removeAudioRow(i)}/>
            ))}

            {/* Add */}
            <button onClick={addAudioRow} style={{
              width:"100%", background:"none",
              border:"none", borderTop:`1px dashed ${C.border}`,
              color:C.muted, cursor:"pointer", fontSize:9, padding:"6px",
              letterSpacing:"0.1em", fontFamily:"'Segoe UI',sans-serif",
              transition:"color 0.15s",
            }}
              onMouseEnter={e=>e.target.style.color=C.cyan}
              onMouseLeave={e=>e.target.style.color=C.muted}>
              + ADD AUDIO PAIR
            </button>
          </PanelBox>

          {/* Quick status */}
          <PanelBox>
            <SectionHead icon="📊" title="Instance Status"/>
            <div style={{ padding:"8px 12px", display:"flex",
              flexDirection:"column", gap:3 }}>
              {[
                { l:"State",       v:"STOPPED",     c:C.muted },
                { l:"Uptime",      v:"—",           c:C.muted },
                { l:"Input",       v:"No signal",   c:C.muted },
                { l:"Output",      v:"Not sending", c:C.muted },
                { l:"Frames enc",  v:"—",           c:C.muted },
                { l:"Dropped",     v:"—",           c:C.muted },
                { l:"Buffer",      v:"—",           c:C.muted },
                { l:"Net TX",      v:"—",           c:C.muted },
              ].map((s,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  padding:"2px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:9, color:C.muted,
                    textTransform:"uppercase", letterSpacing:"0.08em" }}>{s.l}</span>
                  <span style={{ fontFamily:"'Courier New',monospace",
                    fontSize:10, fontWeight:700, color:s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          </PanelBox>

          {/* Preset */}
          <PanelBox>
            <SectionHead icon="💾" title="Presets"/>
            <div style={{ padding:"8px 12px", display:"flex",
              flexDirection:"column", gap:6 }}>
              <Select value="" options={[
                { value:"", label:"— Load preset —" },
                { value:"hd",   label:"HD 1080i25 H.264 SRT" },
                { value:"uhd",  label:"UHD 4K H.265 SRT" },
                { value:"dab",  label:"DAB Radio AAC Multicast" },
                { value:"dvb",  label:"DVB-S2 MPEG-2 SD" },
              ]}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                <button style={{ background:"transparent",
                  border:`1px solid ${C.border}`, color:C.muted,
                  borderRadius:2, padding:"4px 0", cursor:"pointer",
                  fontSize:9, fontWeight:600, letterSpacing:"0.08em" }}>
                  SAVE AS…
                </button>
                <button style={{ background:`${C.accent}18`,
                  border:`1px solid ${C.accent}`, color:C.accent,
                  borderRadius:2, padding:"4px 0", cursor:"pointer",
                  fontSize:9, fontWeight:700, letterSpacing:"0.08em" }}>
                  LOAD
                </button>
              </div>
            </div>
          </PanelBox>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"4px 14px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:C.surface, flexShrink:0 }}>
        <span style={{ fontSize:9, color:C.muted }}>
          LABOTECH · Broadcast Engine · Encoder Configuration
        </span>
        <div style={{ display:"flex", gap:10 }}>
          <span style={{ fontSize:9, color:C.muted }}>
            Input: <span style={{ color:C.text }}>RTP · {inputHost}:{inputPort}</span>
          </span>
          <span style={{ fontSize:9, color:C.muted }}>
            Output: <span style={{ color:C.text }}>{outputMode} · {srtHost||"—"}:{srtPort}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
