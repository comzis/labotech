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
  dim:      "#1a2233",
  ok:       "#00e676",
  warn:     "#ffab00",
  err:      "#ff3d57",
  cyan:     "#00e5ff",
  accent:   "#2d5fff",
  purple:   "#9d6fff",
  orange:   "#ff8c00",
  head:     "#6b82aa",
  input:    "#080b10",
  selected: "#001f3a",
};

// ── Atoms ──────────────────────────────────────────────────────
const Dot = ({ color, size = 7 }) => (
  <span style={{ display:"inline-block", width:size, height:size,
    borderRadius:"50%", background:color,
    boxShadow:`0 0 ${size}px ${color}88`, flexShrink:0 }}/>
);

const Badge = ({ label, color=C.ok, filled, small }) => (
  <span style={{ fontSize: small?8:9, fontWeight:800, letterSpacing:"0.1em",
    color: filled ? "#06080c" : color,
    background: filled ? color : "transparent",
    border:`1px solid ${color}`, borderRadius:2,
    padding: small?"1px 4px":"1px 6px", textTransform:"uppercase",
    whiteSpace:"nowrap" }}>{label}</span>
);

const NavTab = ({ label, icon, active, onClick }) => (
  <button onClick={onClick} style={{
    background:"none", border:"none", cursor:"pointer",
    padding:"6px 10px", display:"flex", flexDirection:"column",
    alignItems:"center", gap:2, opacity: active ? 1 : 0.4,
    borderBottom: active ? `2px solid ${C.orange}` : "2px solid transparent",
    transition:"all 0.15s",
  }}>
    <span style={{ fontSize:13 }}>{icon}</span>
    <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em",
      color: active ? C.orange : C.head, textTransform:"uppercase" }}>{label}</span>
  </button>
);

const Label = ({ children, required }) => (
  <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.11em",
    color:C.head, textTransform:"uppercase", marginBottom:4 }}>
    {children}{required && <span style={{ color:C.err, marginLeft:2 }}>*</span>}
  </div>
);

const Input = ({ value, onChange, placeholder, mono, disabled, suffix, style }) => (
  <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
    <input value={value} onChange={onChange} placeholder={placeholder}
      disabled={disabled} style={{
        width:"100%", boxSizing:"border-box",
        background: disabled ? C.dim : C.input,
        border:`1px solid ${C.border}`, borderRadius:2,
        color: disabled ? C.muted : C.text,
        padding:"5px 8px", fontSize: mono ? 11 : 11,
        fontFamily: mono ? "'Courier New',monospace" : "inherit",
        outline:"none", transition:"border-color 0.15s", ...style,
      }}
      onFocus={e=>e.target.style.borderColor=C.borderFocus}
      onBlur={e=>e.target.style.borderColor=C.border}/>
    {suffix && <span style={{ position:"absolute", right:6, fontSize:9,
      color:C.muted, pointerEvents:"none" }}>{suffix}</span>}
  </div>
);

const Select = ({ value, onChange, options, disabled }) => (
  <select value={value} onChange={onChange} disabled={disabled} style={{
    width:"100%", background: disabled ? C.dim : C.input,
    border:`1px solid ${C.border}`, borderRadius:2,
    color: disabled ? C.muted : C.text,
    padding:"5px 8px", fontSize:11, fontFamily:"inherit",
    outline:"none", cursor: disabled ? "default" : "pointer",
    appearance:"none",
    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%233e506a'/%3E%3C/svg%3E")`,
    backgroundRepeat:"no-repeat", backgroundPosition:"calc(100% - 8px) center",
    paddingRight:24,
  }}>
    {options.map(o => <option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
  </select>
);

const Field = ({ label, required, children, style }) => (
  <div style={{ display:"flex", flexDirection:"column", ...style }}>
    {label && <Label required={required}>{label}</Label>}
    {children}
  </div>
);

const PanelBox = ({ children, style }) => (
  <div style={{ background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:3, overflow:"hidden", ...style }}>{children}</div>
);

const SectionHead = ({ icon, num, title, active=true, right }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"7px 12px", background:C.panelAlt,
    borderBottom:`1px solid ${C.borderHi}` }}>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      {num && <span style={{ fontSize:9, fontWeight:800, color:C.muted,
        letterSpacing:"0.1em", background:C.dim,
        border:`1px solid ${C.border}`, borderRadius:2,
        padding:"1px 5px" }}>{num}</span>}
      <span style={{ fontSize:10 }}>{icon}</span>
      <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.15em",
        color:C.head, textTransform:"uppercase" }}>{title}</span>
    </div>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      {right}
      <Dot color={active ? C.ok : C.muted}/>
      <span style={{ fontSize:8, color:C.muted }}>▲</span>
    </div>
  </div>
);

// ── Transform profile card ─────────────────────────────────────
const TransformCard = ({ label, sub, active, onClick }) => (
  <div onClick={onClick} style={{
    padding:"9px 12px", cursor:"pointer",
    background: active ? C.selected : "transparent",
    border:`1px solid ${active ? C.cyan : C.border}`,
    borderRadius:3, marginBottom:5,
    boxShadow: active ? `0 0 16px ${C.cyan}18, inset 0 0 12px ${C.cyan}08` : "none",
    transition:"all 0.15s",
  }}>
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
      <div style={{ fontFamily:"'Courier New',monospace", fontSize:12,
        fontWeight:700, color: active ? C.cyan : C.text }}>{label}</div>
      {active && <Dot color={C.cyan} size={6}/>}
    </div>
    <div style={{ fontSize:9, color: active ? `${C.cyan}88` : C.muted,
      letterSpacing:"0.06em", marginTop:2 }}>{sub}</div>
  </div>
);

// ── Output mode toggle ─────────────────────────────────────────
const OutModeBtn = ({ label, sub, active, onClick, color }) => (
  <button onClick={onClick} style={{
    flex:1, background: active ? `${color}15` : "transparent",
    border:`1px solid ${active ? color : C.border}`,
    borderRadius:3, padding:"8px 6px", cursor:"pointer",
    textAlign:"center", transition:"all 0.15s",
    boxShadow: active ? `0 0 14px ${color}22` : "none",
  }}>
    <div style={{ fontSize:11, fontWeight:800, color: active ? color : C.muted,
      letterSpacing:"0.06em" }}>{label}</div>
    <div style={{ fontSize:8, color: active ? `${color}88` : C.dim,
      letterSpacing:"0.08em", marginTop:2, textTransform:"uppercase" }}>{sub}</div>
  </button>
);

// ── Pipeline row ───────────────────────────────────────────────
const PipelineRow = ({ id, profile, input, output, status, fps, bitrate }) => (
  <div style={{ display:"grid",
    gridTemplateColumns:"44px 1fr 1fr 1fr 60px 60px 70px",
    gap:"2px 8px", padding:"5px 10px", alignItems:"center",
    borderBottom:`1px solid ${C.border}`,
    background:C.panel,
    transition:"background 0.1s",
  }}>
    <span style={{ fontFamily:"'Courier New',monospace", fontSize:9,
      color:C.accent }}>{id}</span>
    <span style={{ fontSize:10, color:C.text }}>{profile}</span>
    <span style={{ fontFamily:"'Courier New',monospace", fontSize:9,
      color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
      whiteSpace:"nowrap" }}>{input}</span>
    <span style={{ fontFamily:"'Courier New',monospace", fontSize:9,
      color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
      whiteSpace:"nowrap" }}>{output}</span>
    <span style={{ fontFamily:"'Courier New',monospace", fontSize:10,
      color:C.text, textAlign:"right" }}>{fps}</span>
    <span style={{ fontFamily:"'Courier New',monospace", fontSize:10,
      color:C.cyan, textAlign:"right" }}>{bitrate}</span>
    <span><Badge label={status}
      color={status==="RUNNING"?C.ok:status==="ERROR"?C.err:C.muted}
      small/></span>
  </div>
);

// ── Main ──────────────────────────────────────────────────────
export default function Transcoder() {
  const [activeTab,    setActiveTab]    = useState("transcoder");
  const [transform,    setTransform]    = useState(0);
  const [outMode,      setOutMode]      = useState("SRT");
  const [stdProfile,   setStdProfile]   = useState("dvb-hd");
  const [presetSlot,   setPresetSlot]   = useState("manual");
  const [vCodec,       setVCodec]       = useState("");
  const [aCodec,       setACodec]       = useState("");
  const [vBitrate,     setVBitrate]     = useState("");
  const [aBitrate,     setABitrate]     = useState("");
  const [serviceName,  setServiceName]  = useState("LABOTECH HD");
  const [provName,     setProvName]     = useState("LABOTECH");
  const [audioPairs,   setAudioPairs]   = useState(false);
  const [streamId,     setStreamId]     = useState("channel-1-transcoded");
  const [inputSource,  setInputSource]  = useState("");
  const [srtHost,      setSrtHost]      = useState("10.67.18.29");
  const [srtPort,      setSrtPort]      = useState("9999");
  const [passphrase,   setPassphrase]   = useState("");
  const [udpDest,      setUdpDest]      = useState("");
  const [udpPort,      setUdpPort]      = useState("5500");
  const [rtpDest,      setRtpDest]      = useState("");
  const [rtpPort,      setRtpPort]      = useState("5004");
  const [latency,      setLatency]      = useState("2000");
  const [encryption,   setEncryption]   = useState("AES-128");

  const TRANSFORMS = [
    { label:"1080p25 → 1080i50 (PAL)",           sub:"25 → 50 FPS · INTERLACED" },
    { label:"1080p29.97 → 1080i59.94 (NTSC)",    sub:"29.97 → 59.94 FPS · INTERLACED" },
    { label:"1080p50 → 1080i50 (HFR-PAL)",       sub:"50 → 50 FPS · INTERLACED" },
    { label:"1080i50 → 1080p25 (Deinterlace/OTT)", sub:"50i → 25 FPS · PROGRESSIVE" },
    { label:"Pass-through (No scaling)",          sub:"SOURCE FPS · NO CONVERSION" },
    { label:"4K UHD → 1080p (Downscale)",         sub:"4K → 1080p · PROGRESSIVE" },
  ];

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

  // ── Render ─────────────────────────────────────────────────
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
              active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}/>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center",
          minWidth:210, justifyContent:"flex-end" }}>
          <div style={{ fontSize:9, textAlign:"right", lineHeight:1.6 }}>
            <span style={{ color:C.muted }}>CPU </span>
            <span style={{ color:C.ok, fontWeight:700,
              fontFamily:"'Courier New',monospace" }}>1%</span>
            {"  "}
            <span style={{ color:C.muted }}>MEM </span>
            <span style={{ color:C.warn, fontWeight:700,
              fontFamily:"'Courier New',monospace" }}>8.6%</span>
            <div style={{ color:C.dim, fontFamily:"'Courier New',monospace",
              fontSize:8 }}>5503/64038MB</div>
          </div>
          <Badge label="● ONLINE" color={C.ok} filled/>
        </div>
      </div>

      {/* ── PAGE HEADER ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 16px 8px", borderBottom:`1px solid ${C.border}`,
        background:C.surface }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20, color:C.orange }}>〜</span>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text,
              letterSpacing:"0.03em" }}>Transcoder</div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.12em",
              textTransform:"uppercase" }}>Service Conditioning & Delivery</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button style={{ background:"transparent", border:`1px solid ${C.border}`,
            color:C.muted, borderRadius:2, padding:"6px 18px",
            cursor:"pointer", fontSize:10, fontWeight:600,
            letterSpacing:"0.08em", textTransform:"uppercase" }}>
            Cancel
          </button>
          <button style={{
            background:`linear-gradient(135deg, ${C.orange}, #ff5500)`,
            border:"none", color:"#fff", borderRadius:2,
            padding:"6px 22px", cursor:"pointer", fontSize:11,
            fontWeight:800, letterSpacing:"0.06em",
            boxShadow:`0 0 20px ${C.orange}55`,
          }}>
            ▶ START BROADCAST TRANSCODER
          </button>
        </div>
      </div>

      {/* ── 3-COLUMN BODY ── */}
      <div style={{ flex:1, display:"grid",
        gridTemplateColumns:"260px 1fr 290px",
        gap:8, padding:8, alignItems:"start" }}>

        {/* ══ COL 1: Transformation Matrix ══ */}
        <PanelBox>
          <SectionHead num="1" icon="⇄" title="Transformation Matrix"/>
          <div style={{ padding:"10px 10px" }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em",
              marginBottom:8, borderBottom:`1px solid ${C.border}`, paddingBottom:6 }}>
              SELECT SCAN CONVERSION / FRAME RATE PROFILE
            </div>
            {TRANSFORMS.map((t,i) => (
              <TransformCard key={i} label={t.label} sub={t.sub}
                active={transform===i} onClick={()=>setTransform(i)}/>
            ))}

            {/* Active transform summary */}
            <div style={{ marginTop:8, padding:"8px 10px",
              background:C.dim, borderRadius:2,
              border:`1px solid ${C.borderHi}` }}>
              <div style={{ fontSize:9, color:C.head, fontWeight:700,
                letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:5 }}>
                Active Transform
              </div>
              <div style={g("1fr 1fr", 6)}>
                {[
                  { l:"Mode",    v: TRANSFORMS[transform].label.split("→")[0].trim() },
                  { l:"Output",  v: TRANSFORMS[transform].label.includes("→") ? TRANSFORMS[transform].label.split("→")[1].trim().split(" ")[0] : "—" },
                  { l:"Scan",    v: TRANSFORMS[transform].sub.includes("INTER") ? "Interlaced" : "Progressive" },
                  { l:"FPS",     v: TRANSFORMS[transform].sub.split("·")[0].split("→")[1]?.trim() || "—" },
                ].map((s,i) => (
                  <div key={i} style={{ background:C.panel, borderRadius:2,
                    padding:"3px 6px", border:`1px solid ${C.border}` }}>
                    <div style={{ fontSize:8, color:C.muted,
                      textTransform:"uppercase" }}>{s.l}</div>
                    <div style={{ fontFamily:"'Courier New',monospace",
                      fontSize:10, color:C.cyan, fontWeight:700 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </PanelBox>

        {/* ══ COL 2: Profile Matrix ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <PanelBox>
            <SectionHead num="2" icon="📋" title="Profile Matrix"
              right={<Badge label="DVB HD" color={C.cyan} small/>}/>
            <div style={{ padding:"12px 14px", display:"flex",
              flexDirection:"column", gap:10 }}>

              <div style={g("1fr 1fr")}>
                <Field label="Broadcast Standard Profile" required>
                  <Select value={stdProfile} onChange={e=>setStdProfile(e.target.value)}
                    options={[
                      { value:"dvb-hd",    label:"DVB HD (Distribution)" },
                      { value:"dvb-sd",    label:"DVB SD (MPEG-2 Legacy)" },
                      { value:"dvb-uhd",   label:"DVB UHD (HEVC/H.265)" },
                      { value:"ott-h264",  label:"OTT H.264 (ABR Ladder)" },
                      { value:"ott-hevc",  label:"OTT HEVC (Low Latency)" },
                      { value:"hls",       label:"HLS / DASH Origin" },
                      { value:"custom",    label:"Custom (Manual)" },
                    ]}/>
                </Field>
                <Field label="Preset Slot">
                  <Select value={presetSlot} onChange={e=>setPresetSlot(e.target.value)}
                    options={[
                      { value:"manual",    label:"Manual Configuration" },
                      { value:"slot-1",    label:"Slot 1 — BBC HD Profile" },
                      { value:"slot-2",    label:"Slot 2 — News 24 Profile" },
                      { value:"slot-3",    label:"Slot 3 — Sports HD Profile" },
                    ]}/>
                </Field>
              </div>

              <div style={{ height:1, background:C.border }}/>

              <div style={g("1fr 1fr")}>
                <Field label="Video Codec">
                  <Select value={vCodec} onChange={e=>setVCodec(e.target.value)}
                    options={[
                      { value:"",       label:"Auto (from profile/slot)" },
                      { value:"h264",   label:"H.264 / AVC" },
                      { value:"h265",   label:"H.265 / HEVC" },
                      { value:"mpeg2",  label:"MPEG-2 Video" },
                      { value:"av1",    label:"AV1" },
                    ]}/>
                </Field>
                <Field label="Audio Codec">
                  <Select value={aCodec} onChange={e=>setACodec(e.target.value)}
                    options={[
                      { value:"",      label:"Auto (from profile/slot)" },
                      { value:"aac",   label:"AAC-LC" },
                      { value:"hev",   label:"HE-AAC v2" },
                      { value:"ac3",   label:"Dolby AC-3" },
                      { value:"mp2",   label:"MPEG-1 Layer II" },
                    ]}/>
                </Field>
              </div>

              <div style={g("1fr 1fr")}>
                <Field label="Video Bitrate (Mbps)">
                  <Input value={vBitrate} onChange={e=>setVBitrate(e.target.value)}
                    placeholder="e.g. 10" mono suffix="Mbps"/>
                </Field>
                <Field label="Audio Bitrate">
                  <Input value={aBitrate} onChange={e=>setABitrate(e.target.value)}
                    placeholder="e.g. 256k" mono suffix="kbps"/>
                </Field>
              </div>

              <div style={g("1fr 1fr")}>
                <Field label="Service Name (DVB)">
                  <Input value={serviceName} onChange={e=>setServiceName(e.target.value)}
                    placeholder="LABOTECH HD"/>
                </Field>
                <Field label="Service Provider (DVB)">
                  <Input value={provName} onChange={e=>setProvName(e.target.value)}
                    placeholder="LABOTECH"/>
                </Field>
              </div>

              {/* Audio pairs toggle */}
              <label style={{ display:"flex", alignItems:"center", gap:8,
                cursor:"pointer", padding:"6px 8px",
                background: audioPairs ? `${C.cyan}10` : C.dim,
                border:`1px solid ${audioPairs ? C.cyan : C.border}`,
                borderRadius:2, transition:"all 0.15s",
              }}>
                <input type="checkbox" checked={audioPairs}
                  onChange={e=>setAudioPairs(e.target.checked)}
                  style={{ accentColor:C.cyan, width:12, height:12 }}/>
                <span style={{ fontSize:10, color: audioPairs ? C.cyan : C.muted,
                  fontWeight: audioPairs ? 700 : 400 }}>
                  Enable audio pairs (1 to 8 tracks)
                </span>
              </label>

              {/* Audio pair matrix (expanded) */}
              {audioPairs && (
                <div style={{ background:C.input, border:`1px solid ${C.border}`,
                  borderRadius:2, overflow:"hidden" }}>
                  <div style={{ display:"grid",
                    gridTemplateColumns:"28px 50px 70px 50px 60px 60px",
                    gap:4, padding:"4px 8px", background:C.panelAlt,
                    borderBottom:`1px solid ${C.borderHi}`,
                    fontSize:8, color:C.head, fontWeight:800,
                    letterSpacing:"0.12em", textTransform:"uppercase" }}>
                    <span>#</span><span>CODEC</span><span>BITRATE</span>
                    <span>CH</span><span>PID</span><span>LANG</span>
                  </div>
                  {[0,1].map(i => (
                    <div key={i} style={{ display:"grid",
                      gridTemplateColumns:"28px 50px 70px 50px 60px 60px",
                      gap:4, padding:"4px 8px",
                      borderBottom:`1px solid ${C.border}`, alignItems:"center" }}>
                      <span style={{ fontFamily:"'Courier New',monospace",
                        fontSize:9, color:C.accent }}>{i}</span>
                      <Select value="aac" options={["aac","ac3","mp2"]}/>
                      <Input value="256" mono suffix="k"/>
                      <Input value="2" mono/>
                      <Input value="auto" mono/>
                      <Input value={["eng","fra"][i]} mono/>
                    </div>
                  ))}
                  <div style={{ padding:"4px 8px", fontSize:8, color:C.muted,
                    fontStyle:"italic" }}>
                    Leave codec/bitrates empty to use selected standard profile defaults.
                  </div>
                </div>
              )}

              <div style={{ fontSize:8, color:C.dim, fontStyle:"italic",
                borderTop:`1px solid ${C.border}`, paddingTop:6 }}>
                Leave codec/bitrates empty to use selected standard profile or preset slot defaults.
              </div>
            </div>
          </PanelBox>

          {/* Advanced options row */}
          <PanelBox>
            <SectionHead num="" icon="🔧" title="Advanced Codec Options"/>
            <div style={{ padding:"10px 14px" }}>
              <div style={g("1fr 1fr 1fr 1fr 1fr")}>
                <Field label="GOP Size">
                  <Input value="50" mono/>
                </Field>
                <Field label="B-Frames">
                  <Input value="2" mono/>
                </Field>
                <Field label="Profile">
                  <Select value="High" options={["Baseline","Main","High","High 10"]}/>
                </Field>
                <Field label="Rate Ctrl">
                  <Select value="CBR" options={["CBR","VBR","CQP","CRF"]}/>
                </Field>
                <Field label="Latency">
                  <Select value="low" options={[
                    { value:"ultra", label:"Ultra-Low" },
                    { value:"low",   label:"Low" },
                    { value:"std",   label:"Standard" },
                  ]}/>
                </Field>
              </div>
            </div>
          </PanelBox>
        </div>

        {/* ══ COL 3: Destination Matrix ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <PanelBox>
            <SectionHead num="3" icon="🛰" title="Destination Matrix"/>
            <div style={{ padding:"10px 12px", display:"flex",
              flexDirection:"column", gap:10 }}>

              {/* Output mode selector */}
              <div>
                <Label>Output Mode</Label>
                <div style={{ display:"flex", gap:5 }}>
                  <OutModeBtn label="SRT" sub="HaivisionSRT"
                    active={outMode==="SRT"} onClick={()=>setOutMode("SRT")}
                    color={C.ok}/>
                  <OutModeBtn label="RTP" sub="RTP/MPEG-TS"
                    active={outMode==="RTP"} onClick={()=>setOutMode("RTP")}
                    color={C.cyan}/>
                  <OutModeBtn label="UDP" sub="Legacy Multicast"
                    active={outMode==="UDP"} onClick={()=>setOutMode("UDP")}
                    color={C.purple}/>
                </div>
              </div>

              <Field label="Stream ID" required>
                <Input value={streamId} onChange={e=>setStreamId(e.target.value)}
                  placeholder="channel-1-transcoded" mono/>
              </Field>

              <Field label="Input Source" required>
                <Input value={inputSource} onChange={e=>setInputSource(e.target.value)}
                  placeholder="rtp://239.0.0.1:5000 or srt://source:9999" mono/>
              </Field>

              {outMode === "SRT" && (
                <>
                  <div style={g("1fr 80px")}>
                    <Field label="SRT Target Host" required>
                      <Input value={srtHost} onChange={e=>setSrtHost(e.target.value)}
                        placeholder="srt://host or IP" mono/>
                    </Field>
                    <Field label="Port" required>
                      <Input value={srtPort} onChange={e=>setSrtPort(e.target.value)} mono/>
                    </Field>
                  </div>
                  <div style={g("1fr 1fr")}>
                    <Field label="Latency (ms)">
                      <Input value={latency} onChange={e=>setLatency(e.target.value)}
                        mono suffix="ms"/>
                    </Field>
                    <Field label="Encryption">
                      <Select value={encryption} onChange={e=>setEncryption(e.target.value)}
                        options={["None","AES-128","AES-192","AES-256"]}/>
                    </Field>
                  </div>
                  <Field label="Passphrase">
                    <Input value={passphrase} onChange={e=>setPassphrase(e.target.value)}
                      placeholder="Optional SRT passphrase" mono/>
                  </Field>
                </>
              )}

              {outMode === "UDP" && (
                <div style={g("1fr 80px")}>
                  <Field label="Destination IP" required>
                    <Input value={udpDest} onChange={e=>setUdpDest(e.target.value)}
                      placeholder="239.x.x.x" mono/>
                  </Field>
                  <Field label="Port" required>
                    <Input value={udpPort} onChange={e=>setUdpPort(e.target.value)} mono/>
                  </Field>
                </div>
              )}

              {outMode === "RTP" && (
                <div style={g("1fr 80px")}>
                  <Field label="RTP Destination" required>
                    <Input value={rtpDest} onChange={e=>setRtpDest(e.target.value)}
                      placeholder="host or IP" mono/>
                  </Field>
                  <Field label="Port" required>
                    <Input value={rtpPort} onChange={e=>setRtpPort(e.target.value)} mono/>
                  </Field>
                </div>
              )}

              {/* Destination health */}
              <div style={{ padding:"7px 8px", background:C.dim,
                borderRadius:2, border:`1px solid ${C.border}`,
                display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:9, color:C.muted,
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>
                  Destination Status
                </span>
                <Badge label="NOT CONNECTED" color={C.muted}/>
              </div>
            </div>
          </PanelBox>

          {/* Instance status */}
          <PanelBox>
            <SectionHead icon="📊" title="Pipeline Status"/>
            <div style={{ padding:"8px 12px", display:"flex",
              flexDirection:"column", gap:3 }}>
              {[
                { l:"State",       v:"IDLE",    c:C.muted },
                { l:"Transform",   v:TRANSFORMS[transform].label.split("(")[1]?.replace(")","") || "—", c:C.cyan },
                { l:"Frames In",   v:"—",       c:C.muted },
                { l:"Frames Out",  v:"—",       c:C.muted },
                { l:"Bitrate Out", v:"—",       c:C.muted },
                { l:"Dropped",     v:"—",       c:C.muted },
                { l:"Latency",     v:"—",       c:C.muted },
                { l:"Output",      v:"—",       c:C.muted },
              ].map((s,i)=>(
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
        </div>
      </div>

      {/* ── ACTIVE PIPELINES ── */}
      <div style={{ margin:"0 8px 8px", background:C.surface,
        border:`1px solid ${C.border}`, borderRadius:3 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"6px 12px", borderBottom:`1px solid ${C.border}`,
          background:C.panelAlt }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.15em",
              color:C.head, textTransform:"uppercase" }}>Active Broadcast Pipelines</span>
            <Badge label="0 RUNNING" color={C.muted}/>
          </div>
          <span style={{ fontSize:9, color:C.muted }}>
            Max concurrent: <span style={{ color:C.text }}>4</span>
          </span>
        </div>

        {/* Table header */}
        <div style={{ display:"grid",
          gridTemplateColumns:"44px 1fr 1fr 1fr 60px 60px 70px",
          gap:"2px 8px", padding:"4px 10px",
          background:C.panelAlt,
          borderBottom:`1px solid ${C.borderHi}`,
          fontSize:8, color:C.head, fontWeight:800, letterSpacing:"0.12em",
          textTransform:"uppercase" }}>
          <span>ID</span><span>PROFILE</span><span>INPUT</span>
          <span>OUTPUT</span><span>FPS</span><span>BITRATE</span><span>STATUS</span>
        </div>

        {/* Empty state */}
        <div style={{ padding:"20px", textAlign:"center",
          color:C.muted, fontSize:10, fontStyle:"italic",
          borderBottom:`1px solid ${C.border}` }}>
          No active pipelines — configure above and click Start Broadcast Transcoder
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"4px 14px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:C.surface, flexShrink:0 }}>
        <span style={{ fontSize:9, color:C.muted }}>
          LABOTECH · Broadcast Engine · Transcoder
        </span>
        <div style={{ display:"flex", gap:12 }}>
          <span style={{ fontSize:9, color:C.muted }}>
            Transform: <span style={{ color:C.cyan, fontFamily:"'Courier New',monospace" }}>
              {TRANSFORMS[transform].label}
            </span>
          </span>
          <span style={{ fontSize:9, color:C.muted }}>
            Output: <span style={{ color:C.text }}>{outMode}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
