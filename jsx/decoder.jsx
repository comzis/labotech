import { useState, useEffect } from "react";

const C = {
  bg:"#06080c", surface:"#0b0e15", panel:"#0d1118", panelAlt:"#0f1420",
  border:"#161d2b", borderHi:"#243045", borderFocus:"#2d5fff",
  text:"#c4d0e8", muted:"#3e506a", dim:"#1a2233",
  ok:"#00e676", warn:"#ffab00", err:"#ff3d57",
  info:"#29b6f6", cyan:"#00e5ff", accent:"#2d5fff",
  purple:"#9d6fff", orange:"#ff8c00", head:"#6b82aa", input:"#080b10",
  s22:"#00e5ff",
};

const Dot = ({ color, size=7, pulse }) => (
  <span style={{ display:"inline-block", width:size, height:size,
    borderRadius:"50%", background:color, flexShrink:0,
    boxShadow:`0 0 ${size+2}px ${color}88`,
    animation:pulse?"pulse 1.4s ease-in-out infinite":"none" }}/>
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
    borderBottom:active?`2px solid ${C.info}`:"2px solid transparent",
    transition:"all 0.15s",
  }}>
    <span style={{ fontSize:13 }}>{icon}</span>
    <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.12em",
      color:active?C.info:C.head, textTransform:"uppercase" }}>{label}</span>
  </button>
);

const Label = ({ children, required }) => (
  <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.11em",
    color:C.head, textTransform:"uppercase", marginBottom:4 }}>
    {children}{required&&<span style={{ color:C.err, marginLeft:2 }}>*</span>}
  </div>
);

const Inp = ({ value, onChange, placeholder, mono, disabled, suffix }) => (
  <div style={{ position:"relative", display:"flex", alignItems:"center" }}>
    <input value={value} onChange={onChange} placeholder={placeholder}
      disabled={disabled} style={{
        width:"100%", boxSizing:"border-box",
        background:disabled?C.dim:C.input,
        border:`1px solid ${C.border}`, borderRadius:2,
        color:disabled?C.muted:C.text, padding:"5px 8px", fontSize:11,
        fontFamily:mono?"'Courier New',monospace":"inherit",
        outline:"none", transition:"border-color 0.15s",
      }}
      onFocus={e=>e.target.style.borderColor=C.borderFocus}
      onBlur={e=>e.target.style.borderColor=C.border}/>
    {suffix&&<span style={{ position:"absolute", right:7, fontSize:9,
      color:C.muted, pointerEvents:"none" }}>{suffix}</span>}
  </div>
);

const Sel = ({ value, onChange, options }) => (
  <select value={value} onChange={onChange} style={{
    width:"100%", background:C.input, border:`1px solid ${C.border}`,
    borderRadius:2, color:C.text, padding:"5px 8px", fontSize:11,
    fontFamily:"inherit", outline:"none", cursor:"pointer", appearance:"none",
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

const PBox = ({ children, style }) => (
  <div style={{ background:C.panel, border:`1px solid ${C.border}`,
    borderRadius:3, overflow:"hidden", ...style }}>{children}</div>
);

const SHead = ({ icon, title, active=true, right, badge }) => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"7px 12px", background:C.panelAlt, borderBottom:`1px solid ${C.borderHi}` }}>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:11 }}>{icon}</span>
      <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.15em",
        color:C.head, textTransform:"uppercase" }}>{title}</span>
      {badge}
    </div>
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      {right}<Dot color={active?C.ok:C.muted}/>
      <span style={{ fontSize:8, color:C.muted }}>▲</span>
    </div>
  </div>
);

function Spark({ data, color, h=26 }) {
  if(!data?.length) return null;
  const w=150, min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/range)*(h-3)-1}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width:"100%", height:h }}
      preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)/(data.length-1)*w}
        cy={h-((data[data.length-1]-min)/range)*(h-3)-1}
        r="2.5" fill={color}/>
    </svg>
  );
}

function KpiCard({ label, value, unit, color, data, warn, crit, sub }) {
  const v=parseFloat(value);
  const dc = crit!==undefined&&v>=crit?C.err:warn!==undefined&&v>=warn?C.warn:color||C.text;
  return (
    <div style={{ background:C.panel,
      border:`1px solid ${v>=(crit||1e9)?C.err+"55":v>=(warn||1e9)?C.warn+"44":C.border}`,
      borderRadius:3, padding:"8px 10px" }}>
      <div style={{ fontSize:8.5, color:C.head, fontWeight:700,
        letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:3 }}>{label}</div>
      {data&&<div style={{ marginBottom:3 }}><Spark data={data} color={dc} h={22}/></div>}
      <div style={{ fontFamily:"'Courier New',monospace",
        fontSize:20, fontWeight:800, color:dc, lineHeight:1 }}>
        {value}<span style={{ fontSize:9, color:C.muted, marginLeft:4 }}>{unit}</span>
      </div>
      {sub&&<div style={{ fontSize:8, color:C.muted, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function PathCard({ label, color, active, stats }) {
  return (
    <div style={{ background:C.panel,
      border:`1px solid ${active?color+"55":C.border}`,
      borderRadius:3, padding:"10px 12px",
      boxShadow:active?`0 0 20px ${color}15`:"none" }}>
      <div style={{ display:"flex", alignItems:"center",
        justifyContent:"space-between", marginBottom:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <Dot color={active?color:C.muted} pulse={active} size={8}/>
          <span style={{ fontSize:10, fontWeight:800,
            color:active?color:C.muted, letterSpacing:"0.06em" }}>{label}</span>
        </div>
        <Badge label={active?"ACTIVE":"STANDBY"} color={active?color:C.muted} small/>
      </div>
      {[
        { l:"NIC",          v:stats.nic,     c:color   },
        { l:"Source IP",    v:stats.srcIp,   c:C.text  },
        { l:"Port",         v:stats.port,    c:C.text  },
        { l:"SSRC",         v:stats.ssrc,    c:C.accent},
        { l:"Payload Type", v:stats.pt,      c:C.muted },
      ].map((r,i)=>(
        <div key={i} style={{ display:"flex", justifyContent:"space-between",
          padding:"2px 0", borderBottom:`1px solid ${C.dim}` }}>
          <span style={{ fontSize:9, color:C.muted }}>{r.l}</span>
          <span style={{ fontFamily:"'Courier New',monospace",
            fontSize:9, color:r.c, fontWeight:700 }}>{r.v}</span>
        </div>
      ))}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
        gap:3, marginTop:7 }}>
        {[
          { l:"Pkts/s",  v:stats.pps,     c:C.text },
          { l:"Bitrate", v:stats.bitrate, c:color  },
          { l:"Loss",    v:stats.loss,    c:stats.loss==="0%"?C.ok:C.err },
          { l:"Jitter",  v:stats.jitter,  c:parseFloat(stats.jitter||"0")<1?C.ok:C.warn },
        ].map((s,i)=>(
          <div key={i} style={{ background:C.dim, borderRadius:2,
            padding:"3px 6px", border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:8, color:C.muted,
              textTransform:"uppercase", letterSpacing:"0.07em" }}>{s.l}</div>
            <div style={{ fontFamily:"'Courier New',monospace",
              fontSize:11, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RTPHeaderView({ pkt }) {
  const fields=[
    { n:"V",    bits:2,  label:"Version",       v:pkt.version,   c:C.cyan   },
    { n:"P",    bits:1,  label:"Padding",        v:pkt.padding,   c:C.muted  },
    { n:"X",    bits:1,  label:"Extension",      v:pkt.extension, c:C.muted  },
    { n:"CC",   bits:4,  label:"CSRC Count",     v:pkt.cc,        c:C.muted  },
    { n:"M",    bits:1,  label:"Marker",         v:pkt.marker,    c:C.warn   },
    { n:"PT",   bits:7,  label:"Payload Type",   v:pkt.pt,        c:C.ok     },
    { n:"SEQ",  bits:16, label:"Sequence No.",   v:pkt.seq,       c:C.accent },
    { n:"TS",   bits:32, label:"Timestamp",      v:pkt.ts,        c:C.purple },
    { n:"SSRC", bits:32, label:"Sync Source ID", v:pkt.ssrc,      c:C.orange },
  ];
  return (
    <div>
      <div style={{ display:"flex", gap:2, marginBottom:8, flexWrap:"wrap" }}>
        {fields.map((f,i)=>(
          <div key={i} style={{ flex:f.bits, minWidth:Math.max(f.bits*3.5,26),
            background:`${f.c}15`, border:`1px solid ${f.c}55`,
            borderRadius:2, padding:"3px 4px", textAlign:"center" }}>
            <div style={{ fontSize:8, color:f.c, fontWeight:800 }}>{f.n}</div>
            <div style={{ fontSize:7, color:C.muted }}>{f.bits}b</div>
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:4, marginBottom:8 }}>
        {fields.map((f,i)=>(
          <div key={i} style={{ background:C.dim, borderRadius:2,
            padding:"4px 7px", border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:8, color:C.muted,
              textTransform:"uppercase", letterSpacing:"0.07em" }}>{f.label}</div>
            <div style={{ fontFamily:"'Courier New',monospace",
              fontSize:10, fontWeight:700, color:f.c }}>{f.v}</div>
          </div>
        ))}
      </div>
      <div style={{ padding:"8px 10px", background:C.dim,
        border:`1px solid ${C.border}`, borderRadius:2 }}>
        <div style={{ fontSize:8, color:C.head, fontWeight:700,
          letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>
          Raw Header (hex · RFC 3550)
        </div>
        <div style={{ fontFamily:"'Courier New',monospace",
          fontSize:11, lineHeight:1.8, letterSpacing:"0.05em" }}>
          <span style={{ color:C.cyan }}>80</span>{" "}
          <span style={{ color:C.ok }}>21</span>{" "}
          <span style={{ color:C.accent }}>BC A3</span>{" "}
          <span style={{ color:C.purple }}>E5 2D 8A 0C</span>{" "}
          <span style={{ color:C.orange }}>1A 2B 3C 4D</span>
        </div>
        <div style={{ display:"flex", gap:10, marginTop:5, flexWrap:"wrap" }}>
          {[["cyan","V,P,X,CC"],["ok","M,PT"],["accent","SEQ"],
            ["purple","TS"],["orange","SSRC"]].map(([k,l])=>(
            <span key={k} style={{ display:"flex", alignItems:"center", gap:3, fontSize:8 }}>
              <span style={{ width:8, height:8, borderRadius:1,
                background:C[k], display:"inline-block" }}/>
              <span style={{ color:C.muted }}>{l}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
        gap:4, marginTop:8 }}>
        {[
          { l:"Seq No",     v:"48,291",     c:C.accent },
          { l:"Timestamp",  v:"3,847M",     c:C.purple },
          { l:"SSRC",       v:"0x1A2B3C4D", c:C.orange },
          { l:"Payload",    v:"MP2T (33)",  c:C.ok     },
          { l:"Seq Errors", v:"0",          c:C.ok     },
          { l:"Reorder",    v:"0",          c:C.ok     },
          { l:"Late",       v:"0",          c:C.ok     },
          { l:"Duplicates", v:"0",          c:C.ok     },
        ].map((s,i)=>(
          <div key={i} style={{ background:C.dim, borderRadius:2,
            padding:"4px 7px", border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:8, color:C.muted,
              textTransform:"uppercase", letterSpacing:"0.07em" }}>{s.l}</div>
            <div style={{ fontFamily:"'Courier New',monospace",
              fontSize:11, fontWeight:700, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function mkH(base, noise, n=50) {
  let v=base, arr=[];
  for(let i=0;i<n;i++){ v=Math.max(0,v+(Math.random()-.5)*noise); arr.push(v); }
  return arr;
}

export default function Decoder() {
  const [tab,        setTab]        = useState("decoder");
  const [mode,       setMode]       = useState("RTP");
  const [host,       setHost]       = useState("239.100.25.29");
  const [port,       setPort]       = useState("6501");
  const [decId,      setDecId]      = useState("decoder-1773309037146");
  const [nic,        setNic]        = useState("eno2");
  const [refresh,    setRefresh]    = useState("5");
  const [mv,         setMv]         = useState(true);
  const [use2022,    setUse2022]    = useState(false);
  const [rtpInspect, setRtpInspect] = useState(false);
  const [offset,     setOffset]     = useState("80");
  const [bufSz,      setBufSz]      = useState("200");
  const [subTab,     setSubTab]     = useState("quality");
  const [rows, setRows] = useState([
    { host:"239.100.25.29", port:"6501", id:"auto-1" }
  ]);

  const [pktLoss, setPktLoss] = useState(()=>mkH(0,0.04));
  const [jitter,  setJitter]  = useState(()=>mkH(0.28,0.08));
  const [bitrate, setBitrate] = useState(()=>mkH(21.05,0.3));
  const [pcrErr,  setPcrErr]  = useState(()=>mkH(0,0.015));
  const [ccErr,   setCcErr]   = useState(()=>mkH(0,0.025));
  const [iatMin,  setIatMin]  = useState(()=>mkH(0.31,0.02));

  useEffect(()=>{
    const t=setInterval(()=>{
      const upd=h=>[...h.slice(1),Math.max(0,h[h.length-1]+(Math.random()-.5))];
      setPktLoss(h=>[...h.slice(1),Math.max(0,h[h.length-1]+(Math.random()-.5)*.04)]);
      setJitter(h=>[...h.slice(1),Math.max(0,h[h.length-1]+(Math.random()-.5)*.08)]);
      setBitrate(h=>[...h.slice(1),Math.max(15,h[h.length-1]+(Math.random()-.5)*.4)]);
      setPcrErr(h=>[...h.slice(1),Math.max(0,h[h.length-1]+(Math.random()-.5)*.015)]);
      setCcErr(h=>[...h.slice(1),Math.max(0,h[h.length-1]+(Math.random()-.5)*.025)]);
      setIatMin(h=>[...h.slice(1),Math.max(0,h[h.length-1]+(Math.random()-.5)*.02)]);
    },1000);
    return ()=>clearInterval(t);
  },[]);

  const L = arr=>arr[arr.length-1];

  const tabs=[
    { id:"analyser",   label:"TS Analyser", icon:"📡" },
    { id:"runtime",    label:"Runtime",     icon:"⚡" },
    { id:"transcoder", label:"Transcoder",  icon:"🔄" },
    { id:"forwarding", label:"Forwarding",  icon:"➡️"  },
    { id:"decoder",    label:"Decoder",     icon:"📺" },
    { id:"multiview",  label:"Multiview",   icon:"⊞"  },
    { id:"live",       label:"Live View",   icon:"🔴" },
    { id:"alarms",     label:"Alarm Log",   icon:"🔔" },
    { id:"api",        label:"API",         icon:"⚙️"  },
  ];

  const g=(cols,gap=8)=>({ display:"grid", gridTemplateColumns:cols, gap });

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", background:C.bg,
      color:C.text, minHeight:"100vh", display:"flex",
      flexDirection:"column", fontSize:11 }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>

      {/* TOPBAR */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        background:C.surface, borderBottom:`1px solid ${C.borderHi}`,
        padding:"0 14px", height:52, flexShrink:0 }}>
        <div style={{ display:"flex", flexDirection:"column", minWidth:140 }}>
          <span style={{ fontSize:12, fontWeight:800, color:C.ok, letterSpacing:"0.15em" }}>LABOTECH</span>
          <span style={{ fontSize:8, color:C.muted, letterSpacing:"0.1em" }}>BROADCAST ENGINE</span>
          <span style={{ fontSize:7, color:C.dim }}>HPE DL360 · Docker</span>
        </div>
        <div style={{ display:"flex", gap:2 }}>
          {tabs.map(t=>(
            <NavTab key={t.id} label={t.label} icon={t.icon}
              active={tab===t.id} onClick={()=>setTab(t.id)}/>
          ))}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center",
          minWidth:210, justifyContent:"flex-end" }}>
          <div style={{ fontSize:9, textAlign:"right", lineHeight:1.6 }}>
            <span style={{ color:C.muted }}>CPU </span>
            <span style={{ color:C.ok, fontWeight:700, fontFamily:"'Courier New',monospace" }}>0.9%</span>
            {"  "}
            <span style={{ color:C.muted }}>MEM </span>
            <span style={{ color:C.warn, fontWeight:700, fontFamily:"'Courier New',monospace" }}>8.4%</span>
            <div style={{ color:C.dim, fontFamily:"'Courier New',monospace", fontSize:8 }}>5401/64038MB</div>
          </div>
          <Badge label="● ONLINE" color={C.ok} filled/>
        </div>
      </div>

      {/* PAGE HEADER */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"9px 16px 8px", borderBottom:`1px solid ${C.border}`, background:C.surface }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18, color:C.info }}>📺</span>
          <div>
            <div style={{ fontSize:15, fontWeight:700 }}>Decoder</div>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.12em", textTransform:"uppercase" }}>
              Probe Provisioning · SMPTE 2022-7 · RTP Inspector · Interface Monitor
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {use2022&&<Badge label="2022-7 SEAMLESS" color={C.s22}/>}
          <Badge label="RUNNING" color={C.ok}/>
          <button style={{ background:"transparent", border:`1px solid ${C.border}`,
            color:C.muted, borderRadius:2, padding:"5px 14px",
            cursor:"pointer", fontSize:10, fontWeight:600 }}>Stop</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ flex:1, display:"grid",
        gridTemplateColumns:"300px 1fr 280px",
        gap:8, padding:8, alignItems:"start" }}>

        {/* COL 1: Provisioning */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <PBox>
            <SHead icon="⚙" title="Decoder Provisioning (Compact)"
              badge={<Badge label={mode} color={C.cyan} small/>}/>
            <div style={{ padding:"10px 12px", display:"flex",
              flexDirection:"column", gap:10 }}>

              <div>
                <Label>Input Protocol</Label>
                <div style={{ display:"flex", gap:3 }}>
                  {["RTP","SRT","UDP"].map(p=>(
                    <button key={p} onClick={()=>setMode(p)} style={{
                      flex:1, background:mode===p?`${C.cyan}14`:"transparent",
                      border:`1px solid ${mode===p?C.cyan:C.border}`,
                      color:mode===p?C.cyan:C.muted,
                      borderRadius:2, padding:"5px 0", cursor:"pointer",
                      fontSize:10, fontWeight:800, letterSpacing:"0.08em",
                      transition:"all 0.13s",
                    }}>{p}</button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Provision Targets</Label>
                {rows.map((r,i)=>(
                  <div key={i} style={{ display:"grid",
                    gridTemplateColumns:"1fr 62px 72px 22px",
                    gap:3, marginBottom:3, alignItems:"center" }}>
                    <Inp value={r.host}
                      onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,host:e.target.value}:x))}
                      placeholder="Host / IP" mono/>
                    <Inp value={r.port}
                      onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,port:e.target.value}:x))}
                      placeholder="Port" mono/>
                    <Inp value={r.id}
                      onChange={e=>setRows(rows.map((x,j)=>j===i?{...x,id:e.target.value}:x))}
                      placeholder="ID" mono/>
                    <button onClick={()=>rows.length>1&&setRows(rows.filter((_,j)=>j!==i))}
                      style={{ background:"none", border:"none", color:C.err,
                        cursor:"pointer", fontSize:14, padding:0, lineHeight:1 }}>×</button>
                  </div>
                ))}
                <button onClick={()=>setRows([...rows,{host:"",port:"",id:`auto-${rows.length+1}`}])}
                  style={{ width:"100%", background:`${C.accent}0e`,
                    border:`1px dashed ${C.accent}`, color:C.accent,
                    borderRadius:2, padding:"4px 0", cursor:"pointer",
                    fontSize:9, fontWeight:700, letterSpacing:"0.1em" }}>
                  + ADD ROW
                </button>
              </div>

              {/* URL preview */}
              <div style={{ padding:"5px 8px", background:C.dim,
                border:`1px solid ${C.border}`, borderRadius:2 }}>
                <div style={{ fontSize:8, color:C.muted, fontWeight:700,
                  letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>
                  Source URL Preview
                </div>
                {rows.filter(r=>r.host).map((r,i)=>(
                  <div key={i} style={{ fontFamily:"'Courier New',monospace",
                    fontSize:9, color:C.cyan, marginBottom:1 }}>
                    {mode.toLowerCase()}://{r.host}:{r.port}
                  </div>
                ))}
              </div>

              <div style={g("1fr 90px")}>
                <Field label="Capture NIC">
                  <Inp value={nic} onChange={e=>setNic(e.target.value)}
                    placeholder="eno2" mono/>
                </Field>
                <Field label="Refresh">
                  <Sel value={refresh} onChange={e=>setRefresh(e.target.value)}
                    options={["1","2","5","10","30"].map(v=>({ value:v, label:`${v}s` }))}/>
                </Field>
              </div>

              {/* Feature toggles */}
              {[
                { label:"Add to Multiview",              val:mv,         set:setMv,         color:C.ok     },
                { label:"SMPTE 2022-7 Dual Path",        val:use2022,    set:setUse2022,    color:C.s22    },
                { label:"Inspect RTP Headers",           val:rtpInspect, set:setRtpInspect, color:C.purple },
              ].map((cb,i)=>(
                <label key={i} style={{ display:"flex", alignItems:"center", gap:7,
                  cursor:"pointer", padding:"5px 8px",
                  background:cb.val?`${cb.color}0d`:C.dim,
                  border:`1px solid ${cb.val?cb.color:C.border}`,
                  borderRadius:2, transition:"all 0.13s" }}>
                  <input type="checkbox" checked={cb.val}
                    onChange={e=>cb.set(e.target.checked)}
                    style={{ accentColor:cb.color, width:12, height:12 }}/>
                  <span style={{ fontSize:10, color:cb.val?cb.color:C.muted,
                    fontWeight:cb.val?700:400 }}>{cb.label}</span>
                </label>
              ))}

              {/* 2022-7 params */}
              {use2022&&(
                <div style={{ background:`${C.s22}06`,
                  border:`1px solid ${C.s22}44`, borderRadius:2, padding:"8px 10px" }}>
                  <div style={{ fontSize:9, fontWeight:800, color:C.s22,
                    letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>
                    2022-7 Parameters
                  </div>
                  <div style={g("1fr 1fr",6)}>
                    <Field label="Path Offset (ms)">
                      <Inp value={offset} onChange={e=>setOffset(e.target.value)} mono suffix="ms"/>
                    </Field>
                    <Field label="Buffer (ms)">
                      <Inp value={bufSz} onChange={e=>setBufSz(e.target.value)} mono suffix="ms"/>
                    </Field>
                  </div>
                  <div style={{ marginTop:6 }}>
                    <Field label="Path B NIC">
                      <Inp value="eno3" mono placeholder="eno3"/>
                    </Field>
                  </div>
                  <div style={{ marginTop:6 }}>
                    <Field label="Switch Mode">
                      <Sel value="seamless" options={[
                        { value:"seamless", label:"Seamless (SMPTE 2022-7)" },
                        { value:"hitless",  label:"Hitless protection" },
                        { value:"manual",   label:"Manual failover" },
                      ]}/>
                    </Field>
                  </div>
                </div>
              )}

              <div style={{ display:"flex", gap:6 }}>
                <button style={{ flex:2, background:`${C.info}14`,
                  border:`1px solid ${C.info}`, color:C.info,
                  borderRadius:2, padding:"6px 0", cursor:"pointer",
                  fontSize:10, fontWeight:800, letterSpacing:"0.08em" }}>
                  ▶ PROVISION PROBE
                </button>
                <button style={{ flex:1, background:`${C.err}12`,
                  border:`1px solid ${C.err}`, color:C.err,
                  borderRadius:2, padding:"6px 0", cursor:"pointer",
                  fontSize:10, fontWeight:800 }}>
                  ■ STOP
                </button>
              </div>
            </div>
          </PBox>

          {/* Provision targets table */}
          <PBox>
            <SHead icon="📋" title="Active Provisions"/>
            <div style={{ display:"grid",
              gridTemplateColumns:"22px 80px 44px 1fr 66px",
              gap:"0 6px", padding:"4px 10px",
              borderBottom:`1px solid ${C.borderHi}`,
              fontSize:8, color:C.head, fontWeight:800,
              letterSpacing:"0.1em", textTransform:"uppercase" }}>
              <span>#</span><span>ID</span><span>MODE</span>
              <span>URL</span><span>STATE</span>
            </div>
            {rows.map((r,i)=>(
              <div key={i} style={{ display:"grid",
                gridTemplateColumns:"22px 80px 44px 1fr 66px",
                gap:"0 6px", padding:"4px 10px",
                borderBottom:`1px solid ${C.border}`, alignItems:"center" }}>
                <span style={{ fontFamily:"'Courier New',monospace",
                  fontSize:9, color:C.muted }}>{i+1}</span>
                <span style={{ fontFamily:"'Courier New',monospace",
                  fontSize:8, color:C.accent, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.id||"—"}</span>
                <Badge label={mode} color={C.info} small/>
                <span style={{ fontFamily:"'Courier New',monospace",
                  fontSize:8, color:C.muted, overflow:"hidden",
                  textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {r.host?`${r.host}:${r.port}`:"—"}
                </span>
                <Badge label={r.host?"RUNNING":"INCOMPLETE"}
                  color={r.host?C.ok:C.muted} small/>
              </div>
            ))}
            <div style={{ padding:"5px 10px", display:"flex", alignItems:"center", gap:5,
              borderTop:`1px solid ${C.borderHi}` }}>
              <span style={{ fontSize:8, color:C.muted }}>Instance:</span>
              <span style={{ fontFamily:"'Courier New',monospace", fontSize:8.5,
                color:C.cyan, background:`${C.cyan}0d`,
                border:`1px solid ${C.cyan}44`, borderRadius:2, padding:"1px 7px" }}>
                {decId}
              </span>
            </div>
          </PBox>
        </div>

        {/* COL 2: Sub-tabs */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>

          {/* Tab bar */}
          <div style={{ display:"flex", background:C.panelAlt,
            border:`1px solid ${C.border}`, borderRadius:3, overflow:"hidden" }}>
            {[
              { id:"quality",  label:"Quality Dashboard",  icon:"📊" },
              { id:"rtp",      label:"RTP Header",         icon:"🔬" },
              { id:"2022-7",   label:"SMPTE 2022-7",       icon:"⚡" },
              { id:"iface",    label:"Interfaces",         icon:"🖧"  },
            ].map(t=>(
              <button key={t.id} onClick={()=>setSubTab(t.id)} style={{
                flex:1, background:subTab===t.id?C.panel:"transparent",
                border:"none",
                borderBottom:subTab===t.id?`2px solid ${C.info}`:"2px solid transparent",
                color:subTab===t.id?C.info:C.muted,
                cursor:"pointer", padding:"8px 4px",
                fontSize:9, fontWeight:800, letterSpacing:"0.09em",
                textTransform:"uppercase", display:"flex",
                alignItems:"center", justifyContent:"center", gap:4,
                transition:"all 0.13s",
              }}>
                <span style={{ fontSize:11 }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          {/* ── QUALITY ── */}
          {subTab==="quality"&&(
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={g("repeat(4,1fr)",6)}>
                <KpiCard label="Packet Loss"   value={L(pktLoss).toFixed(3)} unit="%" data={pktLoss} color={C.ok}   warn={0.01} crit={0.1}/>
                <KpiCard label="Jitter"        value={L(jitter).toFixed(3)}  unit="ms" data={jitter}  color={C.ok}   warn={1}    crit={5}/>
                <KpiCard label="PCR Errors"    value={L(pcrErr).toFixed(2)}  unit=""  data={pcrErr}   color={C.ok}   warn={1}    crit={5}/>
                <KpiCard label="CC Errors"     value={L(ccErr).toFixed(2)}   unit=""  data={ccErr}    color={C.ok}   warn={1}    crit={3}/>
              </div>
              <div style={g("1fr 1fr 1fr",6)}>
                <KpiCard label="Bitrate"       value={L(bitrate).toFixed(2)} unit="Mbps" data={bitrate} color={C.cyan}/>
                <KpiCard label="Services"      value="1"   unit="" color={C.ok}   sub="Active services"/>
                <KpiCard label="PID Count"     value="5"   unit="" color={C.text} sub="Active PIDs"/>
              </div>

              <PBox>
                <SHead icon="📡" title="TS Identity / DVB SI"/>
                <div style={{ padding:"8px 12px",
                  display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
                  {[
                    { l:"TS ID",          v:"1",           c:C.text   },
                    { l:"ONID",           v:"1",           c:C.text   },
                    { l:"Bitrate Source", v:"PCR",         c:C.cyan   },
                    { l:"Jitter",         v:"0.28 ms",     c:C.ok     },
                    { l:"Service Name",   v:"LABOTECH HD", c:C.text   },
                    { l:"Provider",       v:"LABOTECH",    c:C.muted  },
                    { l:"PCR PID",        v:"#256",        c:C.accent },
                    { l:"PMT PID",        v:"#4096",       c:C.accent },
                    { l:"PAT Version",    v:"3",           c:C.muted  },
                    { l:"Scrambled",      v:"No",          c:C.ok     },
                    { l:"ETR P1",         v:"OK",          c:C.ok     },
                    { l:"ETR P2",         v:"WARN",        c:C.warn   },
                  ].map((s,i)=>(
                    <div key={i} style={{ background:C.dim, borderRadius:2,
                      padding:"4px 7px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:8, color:C.muted,
                        textTransform:"uppercase", letterSpacing:"0.07em" }}>{s.l}</div>
                      <div style={{ fontFamily:"'Courier New',monospace",
                        fontSize:10, fontWeight:700, color:s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </PBox>

              <PBox>
                <SHead icon="📈" title="IAT / Network Forensics"/>
                <div style={{ padding:"8px 12px",
                  display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4 }}>
                  {[
                    { l:"IAT MIN",  v:L(iatMin).toFixed(3),          unit:"ms", data:iatMin,                        c:C.cyan   },
                    { l:"IAT AVG",  v:(L(iatMin)+.03).toFixed(3),    unit:"ms", data:iatMin.map(x=>x+.03),          c:C.info   },
                    { l:"IAT P95",  v:(L(iatMin)+.05).toFixed(3),    unit:"ms", data:iatMin.map(x=>x+.05),          c:C.purple },
                    { l:"Jitter",   v:L(jitter).toFixed(3),          unit:"ms", data:jitter,                        c:C.warn   },
                    { l:"Pkt Loss", v:L(pktLoss).toFixed(4),         unit:"%",  data:pktLoss,                       c:C.err    },
                  ].map((s,i)=>(
                    <div key={i} style={{ background:C.panel,
                      border:`1px solid ${C.border}`, borderRadius:3, padding:"6px 8px" }}>
                      <div style={{ fontSize:8, color:C.head, fontWeight:700,
                        letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:2 }}>{s.l}</div>
                      <Spark data={s.data} color={s.c} h={22}/>
                      <div style={{ fontFamily:"'Courier New',monospace",
                        fontSize:13, fontWeight:700, color:s.c, marginTop:2 }}>
                        {s.v}<span style={{ fontSize:8, color:C.muted, marginLeft:3 }}>{s.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </PBox>
            </div>
          )}

          {/* ── RTP ── */}
          {subTab==="rtp"&&(
            <PBox>
              <SHead icon="🔬" title="RTP Header Inspector"
                right={<Badge label="LIVE" color={C.ok} small/>}/>
              <div style={{ padding:"12px 14px", display:"flex",
                flexDirection:"column", gap:8 }}>
                <div style={{ fontSize:9, color:C.muted,
                  borderBottom:`1px solid ${C.border}`, paddingBottom:6,
                  display:"flex", justifyContent:"space-between" }}>
                  <span>Last captured · <span style={{ fontFamily:"'Courier New',monospace",
                    color:C.cyan }}>{mode.toLowerCase()}://{host}:{port}</span></span>
                  <Badge label="RFC 3550" color={C.muted} small/>
                </div>
                <RTPHeaderView pkt={{ version:"2", padding:"0", extension:"0",
                  cc:"0", marker:"0", pt:"33 (MP2T)", seq:"48,291",
                  ts:"3,847,291,004", ssrc:"0x1A2B3C4D" }}/>
              </div>
            </PBox>
          )}

          {/* ── 2022-7 ── */}
          {subTab==="2022-7"&&(
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ padding:"8px 12px", background:`${C.s22}07`,
                border:`1px solid ${C.s22}44`, borderRadius:3 }}>
                <div style={{ display:"flex", alignItems:"center",
                  justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:10, fontWeight:800,
                    color:C.s22, letterSpacing:"0.08em" }}>
                    SMPTE ST 2022-7 · Seamless Protection Switching
                  </span>
                  <Badge label={use2022?"ACTIVE":"DISABLED"}
                    color={use2022?C.s22:C.muted} filled={use2022}/>
                </div>
                <div style={{ fontSize:9, color:C.muted, lineHeight:1.6 }}>
                  Two identical RTP streams over independent network paths. Seamless
                  packet reconstruction using RTP sequence numbers — zero-packet-loss on
                  single path failure. No decoder interruption.
                </div>
              </div>

              <div style={g("1fr 1fr",8)}>
                <PathCard label="PATH A — Primary" color={C.ok} active={true}
                  stats={{ nic:"eno2", srcIp:"239.100.25.29", port:"6501",
                    ssrc:"0x1A2B3C4D", pt:"33 (MP2T)",
                    pps:"2,841 pps", bitrate:"21.1 Mbps",
                    loss:"0%", jitter:"0.28ms" }}/>
                <PathCard label="PATH B — Secondary" color={C.s22} active={use2022}
                  stats={{ nic:"eno3", srcIp:"239.101.25.29", port:"6501",
                    ssrc:"0x1A2B3C4D", pt:"33 (MP2T)",
                    pps:use2022?"2,838 pps":"—",
                    bitrate:use2022?"21.0 Mbps":"—",
                    loss:use2022?"0%":"—",
                    jitter:use2022?"0.31ms":"—" }}/>
              </div>

              <PBox>
                <SHead icon="📐" title="Offset & Reconstruction"/>
                <div style={{ padding:"8px 12px",
                  display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:4 }}>
                  {[
                    { l:"Configured Offset", v:`${offset} ms`,  c:C.s22  },
                    { l:"Measured Offset",   v:"76.3 ms",        c:C.ok   },
                    { l:"Buffer Size",       v:`${bufSz} ms`,   c:C.text },
                    { l:"Switch Count",      v:"0",              c:C.ok   },
                    { l:"Last Switch",       v:"—",              c:C.muted},
                    { l:"Reconstruct OK",    v:"100%",           c:C.ok   },
                    { l:"Path Skew",         v:"3.7 ms",         c:C.ok   },
                    { l:"Mode",              v:"Seamless",       c:C.s22  },
                  ].map((s,i)=>(
                    <div key={i} style={{ background:C.dim, borderRadius:2,
                      padding:"4px 7px", border:`1px solid ${C.border}` }}>
                      <div style={{ fontSize:8, color:C.muted,
                        textTransform:"uppercase", letterSpacing:"0.07em" }}>{s.l}</div>
                      <div style={{ fontFamily:"'Courier New',monospace",
                        fontSize:11, fontWeight:700, color:s.c }}>{s.v}</div>
                    </div>
                  ))}
                </div>
              </PBox>
            </div>
          )}

          {/* ── INTERFACES ── */}
          {subTab==="iface"&&(
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[
                { name:"eno2", ip:"239.100.25.29", subnet:"239.100.25.0/26",
                  speed:"10 GbE", rx:"21.1 Mbps", tx:"0.1 Mbps",
                  pps:"2,841", drops:"0", errors:"0",
                  status:"UP", mtu:"1500", mac:"aa:bb:cc:dd:ee:ff", role:"Primary" },
                { name:"eno3", ip:"239.101.25.29", subnet:"239.101.25.0/26",
                  speed:"10 GbE", rx:use2022?"21.0 Mbps":"0 Mbps", tx:"0 Mbps",
                  pps:use2022?"2,838":"0", drops:"0", errors:"0",
                  status:use2022?"UP":"STANDBY", mtu:"1500",
                  mac:"aa:bb:cc:dd:ee:01", role:"2022-7 Secondary" },
              ].map((iface,i)=>(
                <PBox key={i}>
                  <div style={{ display:"flex", alignItems:"center",
                    justifyContent:"space-between", padding:"7px 12px",
                    background:C.panelAlt, borderBottom:`1px solid ${C.borderHi}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <Dot color={iface.status==="UP"?C.ok:C.muted}
                        pulse={iface.status==="UP"} size={8}/>
                      <span style={{ fontFamily:"'Courier New',monospace",
                        fontSize:12, fontWeight:800,
                        color:iface.status==="UP"?C.ok:C.muted }}>{iface.name}</span>
                      <Badge label={iface.status}
                        color={iface.status==="UP"?C.ok:C.muted} small/>
                      <Badge label={iface.speed} color={C.cyan} small/>
                      <Badge label={iface.role}
                        color={i===0?C.ok:C.s22} small/>
                    </div>
                    <span style={{ fontFamily:"'Courier New',monospace",
                      fontSize:8.5, color:C.muted }}>{iface.mac}</span>
                  </div>
                  <div style={{ padding:"8px 12px",
                    display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:4 }}>
                    {[
                      { l:"IP",      v:iface.ip,     c:C.ok   },
                      { l:"Subnet",  v:iface.subnet, c:C.text },
                      { l:"MTU",     v:iface.mtu,    c:C.muted},
                      { l:"RX",      v:iface.rx,     c:C.cyan },
                      { l:"TX",      v:iface.tx,     c:C.muted},
                      { l:"Pkts/s",  v:iface.pps,    c:C.text },
                      { l:"Drops",   v:iface.drops,  c:iface.drops==="0"?C.ok:C.err },
                      { l:"Errors",  v:iface.errors, c:iface.errors==="0"?C.ok:C.err },
                      { l:"2022-7",  v:use2022&&i===1?"Active":"—", c:use2022&&i===1?C.s22:C.muted },
                      { l:"State",   v:iface.status, c:iface.status==="UP"?C.ok:C.muted },
                    ].map((s,j)=>(
                      <div key={j} style={{ background:C.dim, borderRadius:2,
                        padding:"4px 7px", border:`1px solid ${C.border}` }}>
                        <div style={{ fontSize:8, color:C.muted,
                          textTransform:"uppercase", letterSpacing:"0.07em" }}>{s.l}</div>
                        <div style={{ fontFamily:"'Courier New',monospace",
                          fontSize:10, fontWeight:700, color:s.c }}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </PBox>
              ))}
            </div>
          )}
        </div>

        {/* COL 3: Summary */}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <PBox>
            <SHead icon="❤" title="Decoder Health"/>
            <div style={{ padding:"8px 12px", display:"flex",
              flexDirection:"column", gap:2 }}>
              {[
                { l:"State",       v:"RUNNING",                              c:C.ok   },
                { l:"Protocol",    v:mode,                                   c:C.cyan },
                { l:"Uptime",      v:"4h 22m 11s",                          c:C.text },
                { l:"Stream Lock", v:"YES",                                  c:C.ok   },
                { l:"Bitrate",     v:`${L(bitrate).toFixed(2)} Mbps`,       c:C.cyan },
                { l:"Services",    v:"1",                                    c:C.ok   },
                { l:"PIDs",        v:"5",                                    c:C.text },
                { l:"CC Errors",   v:L(ccErr).toFixed(0),                   c:L(ccErr)>0?C.err:C.ok  },
                { l:"PCR Errors",  v:L(pcrErr).toFixed(0),                  c:L(pcrErr)>0?C.err:C.ok },
                { l:"Pkt Loss",    v:`${L(pktLoss).toFixed(4)}%`,           c:L(pktLoss)>0.01?C.warn:C.ok },
                { l:"2022-7",      v:use2022?"ACTIVE":"OFF",                c:use2022?C.s22:C.muted },
                { l:"RTP Inspect", v:rtpInspect?"ON":"OFF",                 c:rtpInspect?C.purple:C.muted },
                { l:"Multiview",   v:mv?"LINKED":"OFF",                     c:mv?C.ok:C.muted },
              ].map((s,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  padding:"2px 0", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:9, color:C.muted,
                    textTransform:"uppercase", letterSpacing:"0.07em" }}>{s.l}</span>
                  <span style={{ fontFamily:"'Courier New',monospace",
                    fontSize:10, fontWeight:700, color:s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          </PBox>

          <PBox>
            <SHead icon="📋" title="ETR 290 Summary"/>
            <div style={{ padding:"8px 12px" }}>
              <div style={g("1fr 1fr",4)}>
                {[
                  { l:"P1",    v:"5/5", c:C.ok   },
                  { l:"P2",    v:"3/4", c:C.warn },
                  { l:"P3",    v:"2/2", c:C.ok   },
                  { l:"Score", v:"94%", c:C.ok   },
                ].map((s,i)=>(
                  <div key={i} style={{ background:C.dim, borderRadius:2,
                    padding:"5px 8px", border:`1px solid ${C.border}`,
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:9, color:C.muted }}>{s.l}</span>
                    <span style={{ fontFamily:"'Courier New',monospace",
                      fontSize:14, fontWeight:800, color:s.c }}>{s.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </PBox>

          <PBox>
            <SHead icon="⊞" title="Multiview"
              right={<Badge label={mv?"LINKED":"OFF"} color={mv?C.ok:C.muted} small/>}/>
            <div style={{ padding:"8px 12px" }}>
              {mv ? (
                <div style={{ padding:"6px 8px", background:`${C.ok}0d`,
                  border:`1px solid ${C.ok}44`, borderRadius:2,
                  fontSize:9, color:C.muted }}>
                  Output linked → Multiview tile{" "}
                  <span style={{ color:C.ok, fontWeight:700 }}>#1</span>
                </div>
              ) : (
                <div style={{ fontSize:9, color:C.muted, fontStyle:"italic",
                  padding:"4px 0" }}>
                  Enable "Add to Multiview" to link.
                </div>
              )}
              <div style={{ marginTop:6 }}>
                <Label>Refresh interval</Label>
                <Sel value={refresh} onChange={e=>setRefresh(e.target.value)}
                  options={["1","2","5","10"].map(v=>({ value:v, label:`${v}s` }))}/>
              </div>
            </div>
          </PBox>
        </div>
      </div>

      {/* FOOTER */}
      <div style={{ borderTop:`1px solid ${C.border}`, padding:"4px 14px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:C.surface, flexShrink:0 }}>
        <span style={{ fontSize:9, color:C.muted }}>
          LABOTECH · Broadcast Engine · Decoder
        </span>
        <div style={{ display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:9, color:C.muted }}>
            Input: <span style={{ color:C.cyan, fontFamily:"'Courier New',monospace" }}>
              {mode.toLowerCase()}://{host}:{port}
            </span>
          </span>
          {use2022&&<Badge label="2022-7 SEAMLESS" color={C.s22} small/>}
          {rtpInspect&&<Badge label="RTP INSPECT" color={C.purple} small/>}
        </div>
      </div>
    </div>
  );
}
