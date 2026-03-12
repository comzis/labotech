import { useState, useEffect, useRef, useCallback } from "react";

// ── Design tokens ──────────────────────────────────────────────
const C = {
  bg:       "#06080c",
  surface:  "#0b0e15",
  panel:    "#0e1219",
  border:   "#161d2b",
  borderHi: "#243045",
  text:     "#c4d0e8",
  muted:    "#3e506a",
  dim:      "#283548",
  ok:       "#00e676",
  nominal:  "#29b6f6",
  warn:     "#ffab00",
  crit:     "#ff3d57",
  incident: "#cc44ff",
  etr:      "#ff8c00",
  runtime:  "#00e5ff",
  analyse:  "#44ff88",
  cyan:     "#00e5ff",
  accent:   "#2d5fff",
  head:     "#6b82aa",
};

// ── Tiny helpers ───────────────────────────────────────────────
const px = n => `${n}px`;

const Dot = ({ color, size = 7, glow = true }) => (
  <span style={{
    display: "inline-block", width: size, height: size,
    borderRadius: "50%", background: color, flexShrink: 0,
    boxShadow: glow ? `0 0 ${size}px ${color}88` : "none",
  }} />
);

const Badge = ({ label, color = C.ok, filled }) => (
  <span style={{
    fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
    color: filled ? C.bg : color,
    background: filled ? color : "transparent",
    border: `1px solid ${color}`,
    borderRadius: 2, padding: "1px 6px", textTransform: "uppercase",
    display: "inline-flex", alignItems: "center",
  }}>{label}</span>
);

const NavTab = ({ label, icon, active, onClick }) => (
  <button onClick={onClick} style={{
    background: "none", border: "none", cursor: "pointer",
    padding: "6px 10px", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 2, opacity: active ? 1 : 0.45,
    borderBottom: active ? `2px solid ${C.cyan}` : "2px solid transparent",
    transition: "all 0.15s",
  }}>
    <span style={{ fontSize: 14 }}>{icon}</span>
    <span style={{
      fontSize: 8.5, fontWeight: 700, letterSpacing: "0.12em",
      color: active ? C.cyan : C.head, textTransform: "uppercase",
    }}>{label}</span>
  </button>
);

// ── Sparkline ─────────────────────────────────────────────────
function Sparkline({ data, color, height = 40, fill }) {
  if (!data.length) return null;
  const w = 200, h = height;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  const areaClose = `${(data.length - 1) / (data.length - 1) * w},${h} 0,${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height }} preserveAspectRatio="none">
      {fill && (
        <polygon
          points={`0,${h} ${pts} ${areaClose}`}
          fill={color} opacity={0.12}
        />
      )}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"/>
      {/* last point dot */}
      {(() => {
        const last = data[data.length - 1];
        const x = w;
        const y = h - ((last - min) / range) * (h - 4) - 2;
        return <circle cx={x} cy={y} r={2.5} fill={color}/>;
      })()}
    </svg>
  );
}

// ── Timeline Lane ─────────────────────────────────────────────
function TimelineLane({ name, events, hoverPos, onHover, timeRange }) {
  const ref = useRef();
  const [width, setWidth] = useState(1000);

  useEffect(() => {
    const obs = new ResizeObserver(e => setWidth(e[0].contentRect.width));
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const [start, end] = timeRange;
  const duration = end - start;

  return (
    <div
      ref={ref}
      style={{ position: "relative", height: 28, cursor: "crosshair" }}
      onMouseMove={e => {
        const rect = ref.current.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        onHover(new Date(start + frac * duration), name, frac);
      }}
      onMouseLeave={() => onHover(null, null, null)}
    >
      {/* background nominal bar */}
      <div style={{
        position: "absolute", top: 8, left: 0, right: 0, height: 12,
        background: `${C.ok}22`, border: `1px solid ${C.ok}44`, borderRadius: 2,
      }}/>
      {/* nominal fill */}
      <div style={{
        position: "absolute", top: 8, left: 0, right: 0, height: 12,
        background: `linear-gradient(90deg, ${C.ok}cc, ${C.ok}99)`,
        borderRadius: 2,
      }}/>
      {/* events */}
      {events.map((ev, i) => {
        const left = ((ev.t - start) / duration) * 100;
        const evColor = ev.type === "warn" ? C.warn :
                        ev.type === "crit" ? C.crit :
                        ev.type === "incident" ? C.incident : C.etr;
        return (
          <div key={i} style={{
            position: "absolute", top: 6, left: `${left}%`,
            width: 3, height: 16, borderRadius: 1,
            background: evColor,
            boxShadow: `0 0 6px ${evColor}`,
          }}/>
        );
      })}
      {/* hover cursor */}
      {hoverPos !== null && (
        <div style={{
          position: "absolute", top: 0, left: `${hoverPos * 100}%`,
          width: 1, height: "100%", background: C.cyan, opacity: 0.8,
          pointerEvents: "none",
        }}/>
      )}
      {/* lane label */}
      <div style={{
        position: "absolute", top: 9, left: 6,
        fontSize: 9, color: C.bg, fontWeight: 700,
        letterSpacing: "0.05em", pointerEvents: "none",
        textShadow: "0 1px 2px #00000088",
      }}>{name}</div>
    </div>
  );
}

// ── Forensic Card ─────────────────────────────────────────────
function ForensicCard({ label, value, unit, data, color, warn, crit }) {
  const isWarn = warn !== undefined && value >= warn;
  const isCrit = crit !== undefined && value >= crit;
  const displayColor = isCrit ? C.crit : isWarn ? C.warn : color;

  return (
    <div style={{
      background: C.panel, border: `1px solid ${isCrit ? C.crit + "66" : isWarn ? C.warn + "44" : C.border}`,
      borderRadius: 3, padding: "8px 10px", flex: 1, minWidth: 0,
      boxShadow: isCrit ? `inset 0 0 20px ${C.crit}11` : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 9, color: C.head, fontWeight: 700,
          letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
        {isCrit && <Badge label="CRIT" color={C.crit}/>}
        {isWarn && !isCrit && <Badge label="WARN" color={C.warn}/>}
      </div>
      <div style={{ height: 38, marginBottom: 4 }}>
        <Sparkline data={data} color={displayColor} height={38} fill/>
      </div>
      <div style={{ fontFamily: "'Courier New',monospace",
        fontSize: 18, fontWeight: 700, color: displayColor, lineHeight: 1 }}>
        {value.toFixed(3)}
        <span style={{ fontSize: 9, color: C.muted, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
}

// ── Mock data generator ────────────────────────────────────────
function mkHistory(base, noise, len = 60) {
  const arr = [];
  let v = base;
  for (let i = 0; i < len; i++) {
    v = Math.max(0, v + (Math.random() - 0.5) * noise);
    arr.push(v);
  }
  return arr;
}

// ── Main ──────────────────────────────────────────────────────
export default function LiveView() {
  const [activeTab, setActiveTab] = useState("live");
  const [timeWindow, setTimeWindow] = useState(15); // minutes
  const [frozen, setFrozen] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverLane, setHoverLane] = useState(null);
  const [hoverFrac, setHoverFrac] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Forensic histories
  const [iatMin,  setIatMin]  = useState(() => mkHistory(0.31, 0.02));
  const [iatAvg,  setIatAvg]  = useState(() => mkHistory(0.34, 0.02));
  const [iatP95,  setIatP95]  = useState(() => mkHistory(0.35, 0.025));
  const [jitter,  setJitter]  = useState(() => mkHistory(0.011, 0.005));
  const [pktLoss, setPktLoss] = useState(() => mkHistory(0, 0.001));

  useEffect(() => {
    if (frozen) return;
    const t = setInterval(() => {
      setNow(Date.now());
      setIatMin(h  => [...h.slice(1), Math.max(0, h[h.length-1] + (Math.random()-.5)*.02)]);
      setIatAvg(h  => [...h.slice(1), Math.max(0, h[h.length-1] + (Math.random()-.5)*.02)]);
      setIatP95(h  => [...h.slice(1), Math.max(0, h[h.length-1] + (Math.random()-.5)*.025)]);
      setJitter(h  => [...h.slice(1), Math.max(0, h[h.length-1] + (Math.random()-.5)*.005)]);
      setPktLoss(h => [...h.slice(1), Math.max(0, h[h.length-1] + (Math.random()-.5)*.001)]);
    }, 1000);
    return () => clearInterval(t);
  }, [frozen]);

  const fmtUTC = ms => {
    const d = new Date(ms);
    return d.toISOString().replace("T"," ").replace("Z"," UTC").slice(0,27);
  };
  const fmtTime = ms => new Date(ms).toTimeString().slice(0,8);

  const endMs   = now;
  const startMs = endMs - timeWindow * 60 * 1000;
  const timeRange = [startMs, endMs];

  // Synthetic events on the lane
  const laneEvents = [
    { t: startMs + (endMs-startMs)*0.22, type:"warn"     },
    { t: startMs + (endMs-startMs)*0.47, type:"etr"      },
    { t: startMs + (endMs-startMs)*0.81, type:"incident" },
  ];

  const tabs = [
    { id:"analyser",    label:"TS Analyser",  icon:"📡" },
    { id:"runtime",     label:"Runtime",      icon:"⚡" },
    { id:"transcoder",  label:"Transcoder",   icon:"🔄" },
    { id:"forwarding",  label:"Forwarding",   icon:"➡️"  },
    { id:"decoder",     label:"Decoder",      icon:"📺" },
    { id:"multiview",   label:"Multiview",    icon:"⊞"  },
    { id:"live",        label:"Live View",    icon:"🔴" },
    { id:"alarms",      label:"Alarm Log",    icon:"🔔" },
    { id:"api",         label:"API",          icon:"⚙️"  },
  ];

  return (
    <div style={{
      fontFamily: "'Courier New',monospace",
      background: C.bg, color: C.text,
      minHeight: "100vh", display: "flex", flexDirection: "column",
      fontSize: 11,
    }}>

      {/* ── TOPBAR ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: C.surface, borderBottom: `1px solid ${C.borderHi}`,
        padding: "0 12px", height: 52, flexShrink: 0,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 140 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.ok,
            letterSpacing: "0.15em" }}>LABOTECH</span>
          <span style={{ fontSize: 8, color: C.muted, letterSpacing: "0.1em" }}>
            BROADCAST ENGINE
          </span>
          <span style={{ fontSize: 7, color: C.dim, letterSpacing: "0.08em" }}>
            HPE DL360 · Docker
          </span>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(t => (
            <NavTab key={t.id} label={t.label} icon={t.icon}
              active={activeTab === t.id} onClick={() => setActiveTab(t.id)}/>
          ))}
        </div>

        {/* System status */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 200,
          justifyContent: "flex-end" }}>
          <div style={{ fontSize: 9, textAlign: "right" }}>
            <div style={{ color: C.muted }}>CPU <span style={{ color: C.warn, fontWeight: 700 }}>1.3%</span>
              {"  "}MEM <span style={{ color: C.warn, fontWeight: 700 }}>8.4%</span></div>
            <div style={{ color: C.dim }}>5404/64038MB</div>
          </div>
          <Badge label="● ONLINE" color={C.ok} filled/>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>

        {/* ── STREAM VIEW ── */}
        <div style={{
          background: C.surface, border: `1px solid ${C.borderHi}`,
          borderRadius: 3,
        }}>
          {/* Panel header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 12px", borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: C.ok, fontSize: 10 }}>〜</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
                color: C.head, textTransform: "uppercase" }}>Stream View</span>
              <span style={{ fontSize: 9, color: C.muted }}>
                Horizontal UTC timeline · monitor / analyser lane
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Dot color={C.ok} size={8}/>
              <span style={{ fontSize: 9, color: C.ok }}>LIVE</span>
            </div>
          </div>

          {/* Controls row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
            borderBottom: `1px solid ${C.border}`, flexWrap: "wrap",
          }}>
            {/* Time window buttons */}
            <div style={{ display: "flex", gap: 2 }}>
              {[5, 15, 60, 360, 720, 1440].map(m => (
                <button key={m} onClick={() => setTimeWindow(m)} style={{
                  background: timeWindow === m ? C.accent : "transparent",
                  border: `1px solid ${timeWindow === m ? C.accent : C.border}`,
                  color: timeWindow === m ? "#fff" : C.muted,
                  borderRadius: 2, padding: "2px 7px", cursor: "pointer",
                  fontSize: 9, fontWeight: 700, fontFamily: "'Courier New',monospace",
                }}>
                  {m >= 60 ? `${m/60}h` : `${m}m`}
                </button>
              ))}
            </div>

            <div style={{ width: 1, height: 14, background: C.border }}/>

            {/* Custom range */}
            <span style={{ fontSize: 9, color: C.muted, letterSpacing:"0.08em" }}>RANGE</span>
            <input defaultValue={fmtTime(startMs)} style={{
              background: C.panel, border: `1px solid ${C.border}`, color: C.text,
              borderRadius: 2, padding: "2px 6px", fontSize: 9,
              fontFamily: "'Courier New',monospace", width: 80,
            }}/>
            <span style={{ fontSize: 9, color: C.muted }}>→</span>
            <input defaultValue={fmtTime(endMs)} style={{
              background: C.panel, border: `1px solid ${C.border}`, color: C.text,
              borderRadius: 2, padding: "2px 6px", fontSize: 9,
              fontFamily: "'Courier New',monospace", width: 80,
            }}/>
            <button style={{
              background: C.accent, border: "none", color: "#fff",
              borderRadius: 2, padding: "2px 10px", cursor: "pointer",
              fontSize: 9, fontWeight: 700, fontFamily: "'Courier New',monospace",
            }}>APPLY</button>

            <div style={{ flex: 1 }}/>

            {/* Scale + Freeze + Live */}
            <button style={{
              background: "transparent", border: `1px solid ${C.border}`,
              color: C.muted, borderRadius: 2, padding: "2px 8px",
              cursor: "pointer", fontSize: 9, fontFamily: "'Courier New',monospace",
            }}>Scale: Normalized</button>
            <button onClick={() => setFrozen(f => !f)} style={{
              background: frozen ? C.warn + "22" : "transparent",
              border: `1px solid ${frozen ? C.warn : C.border}`,
              color: frozen ? C.warn : C.muted, borderRadius: 2,
              padding: "2px 8px", cursor: "pointer",
              fontSize: 9, fontFamily: "'Courier New',monospace",
            }}>❄ {frozen ? "Frozen" : "Freeze"}</button>
            <Badge label="● Live" color={C.ok} filled/>
          </div>

          {/* Legend */}
          <div style={{
            display: "flex", gap: 14, padding: "4px 12px",
            borderBottom: `1px solid ${C.border}`, flexWrap: "wrap",
          }}>
            {[
              ["alarm",    C.crit],
              ["nominal",  C.nominal],
              ["warning",  C.warn],
              ["critical", C.crit],
              ["incident", C.incident],
            ].map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: C.muted }}>
                <Dot color={c} size={6} glow={false}/>{l}
              </span>
            ))}
            <div style={{ width: 1, height: 10, background: C.border, alignSelf: "center" }}/>
            <span style={{ fontSize: 9, color: C.muted, fontWeight: 700 }}>TYPE</span>
            {[
              ["ETR alarm", C.etr],
              ["incident",  C.incident],
              ["runtime",   C.runtime],
              ["analyse",   C.analyse],
            ].map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
                <span style={{ display: "inline-block", width: 18, height: 3,
                  background: c, borderRadius: 2 }}/>
                <span style={{ color: C.muted }}>{l}</span>
              </span>
            ))}
          </div>

          {/* Timeline */}
          <div style={{ padding: "8px 12px 4px" }}>
            {/* Time axis */}
            <div style={{ display: "flex", justifyContent: "space-between",
              marginBottom: 4 }}>
              <span style={{ fontSize: 8, color: C.muted }}>{fmtUTC(startMs)}</span>
              <span style={{ fontSize: 8, color: C.muted }}>{fmtUTC(endMs)}</span>
            </div>

            {/* Tick marks */}
            <div style={{ position: "relative", height: 10, marginBottom: 2 }}>
              {Array.from({ length: 11 }).map((_, i) => (
                <div key={i} style={{
                  position: "absolute", left: `${i * 10}%`,
                  top: 0, width: 1, height: i % 5 === 0 ? 8 : 4,
                  background: C.dim,
                }}/>
              ))}
            </div>

            {/* Lanes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
              <TimelineLane
                name="decoder-1773309037146"
                events={laneEvents}
                hoverPos={hoverLane === "decoder-1773309037146" ? hoverFrac : null}
                onHover={(t, name, frac) => { setHoverTime(t); setHoverLane(name); setHoverFrac(frac); }}
                timeRange={timeRange}
              />
              {/* room for more lanes */}
              <div style={{ height: 28, background: `${C.dim}22`,
                border: `1px dashed ${C.border}`, borderRadius: 2,
                display: "flex", alignItems: "center", paddingLeft: 8 }}>
                <span style={{ fontSize: 8, color: C.dim }}>+ add analyser lane</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── POINTER + SELECTED EVENT ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 3, padding: "8px 12px",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
              color: C.head, textTransform: "uppercase", marginBottom: 4 }}>
              Pointer UTC
            </div>
            <div style={{ fontFamily: "'Courier New',monospace",
              fontSize: 12, color: hoverTime ? C.cyan : C.muted }}>
              {hoverTime ? fmtUTC(hoverTime) : "—"}
            </div>
            {hoverLane && (
              <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
                Lane: <span style={{ color: C.text }}>{hoverLane}</span>
              </div>
            )}
          </div>

          <div style={{
            background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 3, padding: "8px 12px",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
              color: C.head, textTransform: "uppercase", marginBottom: 4 }}>
              Selected Event
            </div>
            {hoverTime ? (
              <div>
                <div style={{ fontSize: 11, color: C.text }}>
                  Nominal — no events at pointer
                </div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>
                  {fmtUTC(hoverTime)}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>
                Move mouse over a lane
              </div>
            )}
          </div>
        </div>

        {/* ── LANE STATUS ── */}
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 3, padding: "8px 12px",
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
            color: C.head, textTransform: "uppercase", marginBottom: 6 }}>
            Lane Status at Pointer
          </div>
          {hoverTime ? (
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { label:"Stream",   value:"decoder-1773309037146", ok:true  },
                { label:"Status",   value:"NOMINAL",               ok:true  },
                { label:"Bitrate",  value:"36.1 Mbps",             ok:true  },
                { label:"CC Err",   value:"0",                     ok:true  },
                { label:"PCR Jit",  value:"0.28ms",                ok:true  },
                { label:"PktLoss",  value:"0%",                    ok:true  },
              ].map((s, i) => (
                <div key={i}>
                  <div style={{ fontSize: 8, color: C.muted, letterSpacing:"0.08em",
                    textTransform:"uppercase", marginBottom: 1 }}>{s.label}</div>
                  <div style={{ fontFamily:"'Courier New',monospace", fontSize: 11,
                    color: s.ok ? C.ok : C.err }}>{s.value}</div>
                </div>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 10, color: C.muted }}>No active lanes in selected window.</span>
          )}
        </div>

        {/* ── IAT / JITTER FORENSICS ── */}
        <div style={{
          background: C.surface, border: `1px solid ${C.borderHi}`,
          borderRadius: 3, padding: "8px 12px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 6, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.15em",
                color: C.head, textTransform: "uppercase" }}>IAT / Jitter Forensics</span>
              <span style={{ fontFamily: "'Courier New',monospace",
                fontSize: 10, color: C.cyan }}>decoder-1773309037146</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Badge label="NIC-capture" color={C.nominal}/>
              <Badge label="tcpdump" color={C.accent}/>
            </div>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <ForensicCard
              label="IAT MIN"  unit="ms"
              data={iatMin}
              value={iatMin[iatMin.length - 1]}
              color={C.cyan}
              warn={1.0} crit={5.0}
            />
            <ForensicCard
              label="IAT AVG"  unit="ms"
              data={iatAvg}
              value={iatAvg[iatAvg.length - 1]}
              color={C.nominal}
              warn={1.0} crit={5.0}
            />
            <ForensicCard
              label="IAT P95"  unit="ms"
              data={iatP95}
              value={iatP95[iatP95.length - 1]}
              color={C.incident}
              warn={1.0} crit={5.0}
            />
            <ForensicCard
              label="JITTER"   unit="ms"
              data={jitter}
              value={jitter[jitter.length - 1]}
              color={C.warn}
              warn={0.5} crit={2.0}
            />
            <ForensicCard
              label="PKT LOSS" unit="%"
              data={pktLoss}
              value={pktLoss[pktLoss.length - 1]}
              color={C.crit}
              warn={0.01} crit={0.1}
            />
          </div>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        borderTop: `1px solid ${C.border}`, padding: "4px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: C.surface, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, color: C.muted }}>
          LABOTECH · Broadcast Engine · Live View
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {frozen && <Badge label="❄ FROZEN" color={C.warn}/>}
          <span style={{ fontFamily: "'Courier New',monospace",
            fontSize: 9, color: C.muted }}>{fmtUTC(now)}</span>
        </div>
      </div>
    </div>
  );
}
