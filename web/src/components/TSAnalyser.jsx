import { useEffect, useMemo, useState } from "react";
import useTSAnalysis from "../hooks/useTSAnalysis";
import useETR290 from "../hooks/useETR290";

const C = {
  bg: "#07090d",
  panel: "#0d1017",
  panelB: "#0b0e14",
  border: "#1a2030",
  borderHi: "#253044",
  text: "#c8d4e8",
  muted: "#3e4f6e",
  dim: "#2a3650",
  ok: "#00e676",
  warn: "#ffab00",
  err: "#ff3d57",
  info: "#29b6f6",
  cyan: "#00e5ff",
  accent: "#3d6bff",
  blue: "#2979ff",
  red: "#f50057",
  purple: "#aa00ff",
  gold: "#ffd740",
  head: "#6a7fa8",
};

const TABS = ["ETR 290", "ST 2022-7", "DVB Tables", "PIDs", "Programs", "Event Log"];
const STORAGE_KEY = "labotech:ts-analyser:v2";

const ETR_CHECK_DEFS = [
  { p: 1, id: "1.1", label: "TS sync loss", key: "ts_sync" },
  { p: 1, id: "1.2", label: "Sync byte error", key: "sync_byte" },
  { p: 1, id: "1.3", label: "PAT error", key: "pat_error" },
  { p: 1, id: "1.4", label: "Continuity count error", key: "cc_error" },
  { p: 1, id: "1.5", label: "PMT error", key: "pmt_error" },
  { p: 1, id: "1.6", label: "PID error", key: "pid_error" },
  { p: 2, id: "2.1", label: "Transport error", key: "transport_error" },
  { p: 2, id: "2.2", label: "CRC error", key: "crc_error" },
  { p: 2, id: "2.3", label: "PCR discontinuity", key: "pcr_disc" },
  { p: 2, id: "2.4", label: "PCR accuracy", key: "pcr_acc" },
  { p: 2, id: "2.5", label: "PTS error", key: "pts_error" },
  { p: 2, id: "2.6", label: "CAT error", key: "cat_error" },
  { p: 3, id: "3.1", label: "NIT actual error", key: null },
  { p: 3, id: "3.2", label: "NIT other error", key: null },
  { p: 3, id: "3.3", label: "SI repetition rate", key: "si_rep" },
  { p: 3, id: "3.4", label: "Unreferenced PID", key: null },
  { p: 3, id: "3.5", label: "SDT actual error", key: null },
  { p: 3, id: "3.6", label: "EIT actual error", key: null },
  { p: 3, id: "3.7", label: "RST error", key: null },
  { p: 3, id: "3.8", label: "TDT error", key: null },
];

const Dot = ({ c, size = 7 }) => (
  <span
    style={{
      display: "inline-block",
      width: size,
      height: size,
      borderRadius: "50%",
      background: c,
      boxShadow: `0 0 5px ${c}99`,
      flexShrink: 0,
    }}
  />
);

const Badge = ({ label, color = C.ok, small }) => (
  <span
    style={{
      fontSize: small ? 8 : 9,
      fontWeight: 700,
      letterSpacing: "0.08em",
      color,
      border: `1px solid ${color}66`,
      borderRadius: 2,
      padding: small ? "0px 4px" : "1px 5px",
      background: `${color}12`,
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </span>
);

const Mono = ({ v, c = C.cyan, size = 11 }) => (
  <span style={{ fontFamily: "'Courier New',monospace", color: c, fontSize: size }}>{v}</span>
);

const TH = ({ children, right }) => (
  <th
    style={{
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: "0.1em",
      color: C.muted,
      textAlign: right ? "right" : "left",
      padding: "0 4px 4px",
      borderBottom: `1px solid ${C.borderHi}`,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </th>
);

const TD = ({ children, right, mono, color, small }) => (
  <td
    style={{
      fontSize: small ? 9 : 10,
      color: color || C.text,
      padding: "2px 4px",
      borderBottom: `1px solid ${C.border}`,
      fontFamily: mono ? "'Courier New',monospace" : "inherit",
      textAlign: right ? "right" : "left",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </td>
);

const Panel = ({ children, style, title, status, right }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden", ...style }}>
    {title && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 8px",
          borderBottom: `1px solid ${C.borderHi}`,
          background: C.panelB,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: C.head, textTransform: "uppercase" }}>{title}</span>
          {status && <Badge label={status} color={status === "OK" ? C.ok : status === "WARN" ? C.warn : C.err} small />}
        </div>
        {right && <span style={{ fontSize: 9, color: C.muted }}>{right}</span>}
      </div>
    )}
    <div style={{ padding: "6px 8px" }}>{children}</div>
  </div>
);

const KV = ({ k, v, vc }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", borderBottom: `1px solid ${C.border}` }}>
    <span style={{ fontSize: 9, color: C.muted }}>{k}</span>
    <Mono v={v} c={vc || C.text} size={10} />
  </div>
);

function parseTargetFromUrl(url) {
  if (!url) return { host: "-", port: "-", protocol: "-" };
  try {
    const u = new URL(url);
    return { host: u.hostname || "-", port: u.port || "-", protocol: (u.protocol || "").replace(":", "").toUpperCase() || "-" };
  } catch (_) {
    return { host: "-", port: "-", protocol: "-" };
  }
}

function buildProbeUrl({ mode, host, port, latency, passphrase }) {
  if (!host || !port) return "";
  if (mode === "udp") return `udp://${host}:${port}`;
  if (mode === "rtp") return `rtp://${host}:${port}`;
  let url = `srt://${host}:${port}`;
  const params = ["stats=1", "statsintvl=1"];
  if (latency) params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join("&")}`;
  return url;
}

function countPids(result) {
  if (!result) return 0;
  const fromPrograms = (result.programs || []).reduce((acc, p) => acc + ((p.streams || []).length), 0);
  return fromPrograms + ((result.orphanStreams || []).length);
}

function toMbpsNumber(bps) {
  const n = Number(bps || 0);
  return Number.isFinite(n) && n > 0 ? Number((n / 1e6).toFixed(3)) : 0;
}

function toPidParts(pidLike) {
  if (pidLike == null) return { dec: null, hex: null };
  if (Number.isFinite(Number(pidLike))) {
    const dec = Number(pidLike);
    return { dec, hex: `0x${dec.toString(16).toUpperCase().padStart(4, "0")}` };
  }
  if (typeof pidLike === "string" && /^0x[0-9a-f]+$/i.test(pidLike.trim())) {
    const dec = parseInt(pidLike, 16);
    return { dec, hex: pidLike.toUpperCase() };
  }
  return { dec: null, hex: null };
}

function PidRef({ pidLike, color = C.accent }) {
  const p = toPidParts(pidLike);
  if (p.dec == null && !p.hex) {
    return <span style={{ color: C.muted, fontFamily: "'Courier New',monospace", fontSize: 9 }}>{pidLike != null ? String(pidLike) : "-"}</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      {p.dec != null ? <span style={{ color, fontFamily: "'Courier New',monospace" }}>{p.dec}</span> : null}
      {p.hex ? <span style={{ color: C.muted, fontFamily: "'Courier New',monospace", fontSize: 9 }}>{p.hex}</span> : null}
    </span>
  );
}

export default function TSAnalyser({ lastMessage }) {
  const [tab, setTab] = useState("ETR 290");
  const [expanded, setExpanded] = useState({});
  const [mode, setMode] = useState("rtp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [hostB, setHostB] = useState("");
  const [portB, setPortB] = useState("");
  const [dualLeg, setDualLeg] = useState(false);
  const [latency, setLatency] = useState("2000");
  const [passphrase, setPassphrase] = useState("");
  const [activeId, setActiveId] = useState("");
  const [activeIdB, setActiveIdB] = useState("");
  const [monitorLabel, setMonitorLabel] = useState("");
  const [eventRows, setEventRows] = useState([]);
  const [actionNote, setActionNote] = useState(null); // { type: 'ok'|'warn'|'err'|'info', text: string }
  // ETR per-priority enable/disable and per-check thresholds
  const [etrP1, setEtrP1] = useState(true);
  const [etrP2, setEtrP2] = useState(true);
  const [etrP3, setEtrP3] = useState(true);
  // ETSI TR 101 290 compliant default thresholds
  const [etrThresholds, setEtrThresholds] = useState({
    ts_sync: 1, sync_byte: 1, pat_error: 1, cc_error: 1, pmt_error: 1, pid_error: 1,
    transport_error: 1, crc_error: 1, pcr_disc: 1, pcr_acc: 3, pcr_rep: 1,
    pts_error: 1, cat_error: 1, nit_error: 1, sdt_error: 1, eit_error: 1,
    rst_error: 1, tdt_error: 1, empty_buf: 1,
  });

  const {
    result,
    loading,
    error,
    activeIds,
    resultsById,
    probe,
    onWsResult,
    refreshActives,
    startContinuous,
    stop,
  } = useTSAnalysis();
  const etr = useETR290();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.mode) setMode(parsed.mode);
      if (parsed?.host != null) setHost(parsed.host);
      if (parsed?.port != null) setPort(parsed.port);
      if (parsed?.hostB != null) setHostB(parsed.hostB);
      if (parsed?.portB != null) setPortB(parsed.portB);
      if (typeof parsed?.dualLeg === "boolean") setDualLeg(parsed.dualLeg);
      if (parsed?.latency != null) setLatency(parsed.latency);
      if (parsed?.passphrase != null) setPassphrase(parsed.passphrase);
      if (parsed?.activeId) setActiveId(parsed.activeId);
      if (parsed?.activeIdB) setActiveIdB(parsed.activeIdB);
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode, host, port, hostB, portB, dualLeg, latency, passphrase, activeId, activeIdB })
      );
    } catch (_) {}
  }, [mode, host, port, hostB, portB, dualLeg, latency, passphrase, activeId, activeIdB]);

  useEffect(() => {
    refreshActives();
    etr.refreshActives();
    etr.loadProfiles();
  }, [refreshActives, etr.refreshActives, etr.loadProfiles]);

  useEffect(() => {
    if (!lastMessage) return;
    onWsResult(lastMessage);
    etr.onWsMessage(lastMessage);
    const t = lastMessage.time ? new Date(lastMessage.time).getTime() : Date.now();
    if (["etr290_alarm", "etr290_status", "error", "switched"].includes(lastMessage.type)) {
      const sev = lastMessage.priority === "p1" ? "ERROR" : lastMessage.priority === "p2" ? "WARN" : "INFO";
      setEventRows((prev) => ([
        {
          key: `${t}-${lastMessage.type}-${lastMessage.id || "global"}`,
          t,
          sev,
          src: lastMessage.id || "system",
          msg: lastMessage.message || lastMessage.label || lastMessage.type,
        },
        ...prev,
      ]).slice(0, 60));
    }
  }, [lastMessage, onWsResult, etr.onWsMessage]);

  const activeResult = useMemo(() => {
    if (activeId && resultsById[activeId]) return resultsById[activeId];
    // Only use the one-shot probe result when no continuous monitor is selected —
    // never fall through to a stale global result when a decoder is active, as
    // that would show another decoder's data.
    if (!activeId && result) return result;
    if (activeIds.length > 0 && resultsById[activeIds[0]]) return resultsById[activeIds[0]];
    return null;
  }, [activeId, activeIds, result, resultsById]);

  const activeResultB = useMemo(() => {
    if (!activeIdB) return null;
    return resultsById[activeIdB] || null;
  }, [activeIdB, resultsById]);

  const monitoredIds = useMemo(() => {
    const ids = new Set();
    (activeIds || []).forEach((id) => ids.add(id));
    Object.keys(resultsById || {}).forEach((id) => ids.add(id));
    return Array.from(ids).sort();
  }, [activeIds, resultsById]);

  useEffect(() => {
    if (!activeId && monitoredIds.length > 0) setActiveId(monitoredIds[0]);
    if (activeId && monitoredIds.length > 0 && !monitoredIds.includes(activeId)) {
      setActiveId(monitoredIds[0]);
    }
    if (monitoredIds.length === 0) setActiveId("");
  }, [activeId, monitoredIds]);

  const activeUrl = activeResult?.url || buildProbeUrl({ mode, host, port, latency, passphrase });
  const target = parseTargetFromUrl(activeUrl);
  const bps = toMbpsNumber(activeResult?.dvb?.bitrateBps || activeResult?.dvb?.measuredBitrateBps);
  const packets = Number(activeResult?.dvb?.packets || activeResult?.packetCount || 0);
  const ccErrors = Number(activeResult?.dvb?.continuityCounterErrors?.count || 0);
  const pcrJitter = activeResult?.dvb?.pcr?.jitterMs;
  const nullPct = activeResult?.dvb?.nullPackets?.percent;
  const servicesCount = Number(activeResult?.dvb?.serviceCount ?? activeResult?.programs?.length ?? 0);
  const pidsCount = Number(activeResult?.dvb?.pidCount ?? countPids(activeResult));
  const score = activeResult?.dvb?.health?.score;

  const etrStatus = useMemo(() => {
    const byMain = activeId ? (etr.statusById[`etr-${activeId}`] || etr.statusById[activeId]) : null;
    return byMain || etr.status || null;
  }, [activeId, etr.status, etr.statusById]);

  const etrChecks = useMemo(() => {
    const statusMap = etrStatus?.status || {};
    const alarms = etrStatus?.recentAlarms || [];
    return ETR_CHECK_DEFS.map((d) => {
      const count = alarms.filter((a) => String(a.checkId || "") === d.id || String(a.label || "").toLowerCase().includes(d.label.toLowerCase())).length;
      const keyState = d.key ? statusMap[d.key] : undefined;
      const ok = keyState != null ? keyState !== "error" : count === 0;
      return { ...d, count, ok };
    });
  }, [etrStatus]);

  const p1fail = etrChecks.filter((r) => r.p === 1 && !r.ok).length;
  const p2fail = etrChecks.filter((r) => r.p === 2 && !r.ok).length;
  const p3fail = etrChecks.filter((r) => r.p === 3 && !r.ok).length;

  const pidRows = useMemo(() => {
    const rows = [];
    (activeResult?.programs || []).forEach((p) => {
      (p.streams || []).forEach((s) => {
        rows.push({
          pid: Number.isFinite(Number(s.pid)) ? Number(s.pid) : null,
          pidHex: s.pidHex || null,
          type: (s.codecType || "data").toUpperCase(),
          label: s.codecName || s.streamType || "-",
          bps: s.bitrateBps ? `${(Number(s.bitrateBps) / 1000).toFixed(1)} kbps` : "-",
          cc: 0,
          ok: true,
        });
      });
    });
    if (rows.length === 0) return [];
    return rows;
  }, [activeResult]);

  const programs = useMemo(() => {
    return (activeResult?.programs || []).map((p) => ({
      num: Number.isFinite(Number(p.programId)) ? Number(p.programId) : null,
      name: p.name || p.serviceName || `Service ${p.programId}`,
      provider: p.provider || p.providerName || "-",
      running: 4,
      scrambled: Boolean(p.scrambled),
      eit: true,
      streams: (p.streams || []).map((s) => ({
        pid: Number.isFinite(Number(s.pid)) ? Number(s.pid) : null,
        pidHex: s.pidHex || null,
        type: (s.codecType || "data").toUpperCase(),
        codec: s.codecName || "-",
        kbps: s.bitrateBps ? Math.round(Number(s.bitrateBps) / 1000) : "-",
      })),
    }));
  }, [activeResult]);

  const dvbTables = useMemo(() => {
    const services = activeResult?.dvb?.services || [];
    return [
      {
        pid: "0x0000",
        table: "PAT",
        name: "Program Association Table",
        ver: activeResult?.dvb?.patVersion ?? "-",
        interval_ms: "-",
        last_ms: "-",
        ok: services.length > 0,
        tsid: activeResult?.dvb?.tsid || "-",
        desc: "Program map and PMT routing for current transport stream.",
        entries: services.map((s) => ({ num: s.serviceId, pid: s.pmtPid, label: s.serviceName || "-" })),
      },
      {
        pid: "0x0011",
        table: "SDT",
        name: "Service Description Table",
        ver: "-",
        interval_ms: "-",
        last_ms: "-",
        ok: services.length > 0,
        tsid: activeResult?.dvb?.tsid || "-",
        desc: "Service names/provider and running status from parsed service list.",
        entries: services.map((s) => ({ num: s.serviceId, pid: "run:4", label: `${s.serviceName || "-"} / ${s.serviceProvider || s.providerName || "-"}` })),
      },
      {
        pid: "0x00PM",
        table: "PMT",
        name: "Program Map Tables",
        ver: "-",
        interval_ms: "-",
        last_ms: "-",
        ok: programs.length > 0,
        tsid: "-",
        desc: "Elementary stream inventory grouped by program.",
        entries: programs.map((p) => ({ num: p.num, pid: `${p.streams.length} ES`, label: p.name })),
      },
    ];
  }, [activeResult, programs]);

  const st20227Rows = useMemo(() => {
    const a = activeResult;
    const b = activeResultB;
    const rows = [];
    if (a) {
      rows.push({
        leg: "A",
        name: "Primary leg",
        color: C.blue,
        net: `${toMbpsNumber(a?.dvb?.bitrateBps)} Mbps`,
        pids: Number(a?.dvb?.pidCount ?? countPids(a)),
        svcs: Number(a?.dvb?.serviceCount ?? a?.programs?.length ?? 0),
        src: parseTargetFromUrl(a?.url).host,
        dst: parseTargetFromUrl(a?.url).host + ":" + parseTargetFromUrl(a?.url).port,
        iat: a?.dvb?.arrival?.iatMs?.avg != null ? `${a.dvb.arrival.iatMs.avg} ms` : "-",
        ok: String(a?.dvb?.smpte20227?.state || "").toLowerCase() !== "non_compliant",
      });
    }
    if (b) {
      rows.push({
        leg: "B",
        name: "Secondary leg",
        color: C.red,
        net: `${toMbpsNumber(b?.dvb?.bitrateBps)} Mbps`,
        pids: Number(b?.dvb?.pidCount ?? countPids(b)),
        svcs: Number(b?.dvb?.serviceCount ?? b?.programs?.length ?? 0),
        src: parseTargetFromUrl(b?.url).host,
        dst: parseTargetFromUrl(b?.url).host + ":" + parseTargetFromUrl(b?.url).port,
        iat: b?.dvb?.arrival?.iatMs?.avg != null ? `${b.dvb.arrival.iatMs.avg} ms` : "-",
        ok: String(b?.dvb?.smpte20227?.state || "").toLowerCase() !== "non_compliant",
      });
    }
    if (a && b) {
      rows.push({
        leg: "2022-7",
        name: "Merged stream",
        color: C.gold,
        net: `${toMbpsNumber(a?.dvb?.bitrateBps)} Mbps`,
        pids: "-",
        svcs: "-",
        src: "-",
        dst: "-",
        iat: "-",
        ok: rows.every((r) => r.ok),
      });
    }
    return rows;
  }, [activeResult, activeResultB]);

  const makeMonitorId = (base = "analyser") => {
    const clean = String(base || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const stem = clean || "analyser";
    return `${stem}-${Date.now()}`;
  };

  // Build ETR config respecting per-priority enables.
  // Disabled priority checks get threshold=99999 (effectively disabled).
  const buildEtrConfig = () => {
    const P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
    const P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];
    const P3_KEYS = ['nit_error', 'sdt_error', 'eit_error', 'rst_error', 'tdt_error', 'empty_buf'];
    const thresholds = { ...etrThresholds };
    if (!etrP1) P1_KEYS.forEach((k) => { thresholds[k] = 99999; });
    if (!etrP2) P2_KEYS.forEach((k) => { thresholds[k] = 99999; });
    if (!etrP3) P3_KEYS.forEach((k) => { thresholds[k] = 99999; });
    return { thresholds };
  };

  const handleProbe = async (e) => {
    e.preventDefault();
    const urlA = buildProbeUrl({ mode, host, port, latency, passphrase });
    if (!urlA) {
      setActionNote({ type: "warn", text: "Enter valid Host/IP and Port before starting probe." });
      return;
    }
    try {
      await probe(urlA);
      const idA = makeMonitorId(monitorLabel || "analyser");
      let idB = "";
      await startContinuous(idA, urlA, 5000);
      setActiveId(idA);
      await etr.start(`etr-${idA}`, urlA, undefined, { config: buildEtrConfig() });
      if (dualLeg) {
        const urlB = buildProbeUrl({ mode, host: hostB, port: portB, latency, passphrase });
        if (urlB) {
          await probe(urlB);
          idB = makeMonitorId(`${monitorLabel || "analyser"}-b`);
          await startContinuous(idB, urlB, 5000);
          setActiveIdB(idB);
        }
      }
      await refreshActives();
      await etr.refreshActives();
      setActionNote({ type: "ok", text: dualLeg ? `Probe started (A+B): ${idA}${idB ? `, ${idB}` : ""}` : `Probe started: ${idA}` });
    } catch (err) {
      setActionNote({ type: "err", text: err?.message || "Failed to start probe." });
    }
  };

  const handleStopSelected = async () => {
    if (!activeId) {
      setActionNote({ type: "warn", text: "Select an active monitor first." });
      return;
    }
    try {
      await stop(activeId);
      try { await etr.stop(`etr-${activeId}`); } catch (_) {}
      if (activeId === activeIdB) setActiveIdB("");
      setActiveId("");
      setActionNote({ type: "ok", text: "Selected monitor stopped." });
    } catch (err) {
      setActionNote({ type: "err", text: err?.message || "Failed to stop selected monitor." });
    }
  };

  const handleStopAll = async () => {
    if (monitoredIds.length === 0) {
      setActionNote({ type: "warn", text: "No active monitors to stop." });
      return;
    }
    for (const id of monitoredIds) {
      try { await stop(id); } catch (_) {}
      try { await etr.stop(`etr-${id}`); } catch (_) {}
    }
    setActiveId("");
    setActiveIdB("");
    setActionNote({ type: "ok", text: "All monitors stopped." });
  };

  const [applyConfigStatus, setApplyConfigStatus] = useState(null); // null | 'ok' | 'err'
  const handleApplyEtrConfig = async () => {
    const cfg = buildEtrConfig();
    const targets = activeId
      ? [`etr-${activeId}`]
      : monitoredIds.map((id) => `etr-${id}`);
    let ok = 0;
    let fail = 0;
    for (const monId of targets) {
      try {
        await etr.updateConfig(monId, cfg);
        ok += 1;
      } catch (_) {
        fail += 1;
      }
    }
    setApplyConfigStatus(fail === 0 ? 'ok' : 'err');
    setTimeout(() => setApplyConfigStatus(null), 2000);
  };

  const ts = new Date().toTimeString().slice(0, 8);

  return (
    <div style={{ fontFamily: "'Courier New',monospace", background: C.bg, color: C.text, minHeight: "100vh", padding: 8, boxSizing: "border-box", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.borderHi}`, marginBottom: 8, paddingBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: C.cyan }}>ETR ANALYSIS</span>
          <Badge label={activeResult ? "LIVE" : "IDLE"} color={activeResult ? C.ok : C.warn} />
          <Badge label={target.protocol || "TS/IP"} color={C.accent} />
          <Badge label={dualLeg ? "ST 2022-7" : "SINGLE LEG"} color={dualLeg ? C.gold : C.muted} />
          <span style={{ color: C.muted, fontSize: 9 }}>{target.host} : {target.port} · {servicesCount} services</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {[["P1", p1fail === 0 ? C.ok : C.err], ["P2", p2fail === 0 ? C.ok : C.warn], ["P3", p3fail === 0 ? C.ok : C.warn], ["PCR", pcrJitter != null ? C.ok : C.warn], ["2022-7", dualLeg ? C.ok : C.muted]].map(([l, c]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9 }}>
              <Dot c={c} />
              <span style={{ color: C.muted }}>{l}</span>
            </span>
          ))}
          <Mono v={ts} c={C.warn} size={10} />
        </div>
      </div>

      <form onSubmit={handleProbe} style={{ display: "grid", gridTemplateColumns: dualLeg ? "96px 1fr 90px 1fr 90px 150px 80px 116px auto auto" : "96px 1fr 90px 150px 80px 116px auto auto", gap: 6, marginBottom: 8 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28 }}>
          <option value="rtp">RTP</option>
          <option value="udp">UDP</option>
          <option value="srt">SRT</option>
        </select>
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Host/IP A" style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28, padding: "0 8px" }} />
        <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="Port A" style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28, padding: "0 8px" }} />
        {dualLeg && <input value={hostB} onChange={(e) => setHostB(e.target.value)} placeholder="Host/IP B" style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28, padding: "0 8px" }} />}
        {dualLeg && <input value={portB} onChange={(e) => setPortB(e.target.value)} placeholder="Port B" style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28, padding: "0 8px" }} />}
        <input value={monitorLabel} onChange={(e) => setMonitorLabel(e.target.value)} placeholder="Monitor ID prefix (optional)" style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28, padding: "0 8px" }} />
        <button type="button" onClick={() => setDualLeg((v) => !v)} style={{ height: 28, borderRadius: 3, border: `1px solid ${dualLeg ? C.gold : C.border}`, color: dualLeg ? C.gold : C.muted, background: "transparent" }}>{dualLeg ? "A+B" : "Single"}</button>
        <button type="submit" disabled={loading} style={{ height: 28, borderRadius: 3, border: `1px solid ${C.cyan}`, color: C.cyan, background: `${C.cyan}14` }}>{loading ? "Probing..." : "Start Probe"}</button>
        <button type="button" onClick={handleStopSelected} disabled={!activeId} style={{ height: 28, borderRadius: 3, border: `1px solid ${activeId ? C.err : C.border}`, color: activeId ? C.err : C.muted, background: "transparent" }}>Stop Selected</button>
        <button type="button" onClick={handleStopAll} disabled={monitoredIds.length === 0} style={{ height: 28, borderRadius: 3, border: `1px solid ${monitoredIds.length ? C.warn : C.border}`, color: monitoredIds.length ? C.warn : C.muted, background: "transparent" }}>Stop All</button>
      </form>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 6, marginBottom: 8 }}>
        <select value={activeId} onChange={(e) => setActiveId(e.target.value)} style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 3, height: 28, padding: "0 8px" }}>
          <option value="">Select active monitor</option>
          {monitoredIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <div style={{ border: `1px solid ${C.border}`, background: C.panel, borderRadius: 3, height: 28, display: "flex", alignItems: "center", padding: "0 8px", fontSize: 10, color: C.muted }}>
          Active monitors: <span style={{ color: C.cyan, marginLeft: 6 }}>{monitoredIds.length}</span>
          {activeId ? <span style={{ marginLeft: 10 }}>Viewing: <span style={{ color: C.text }}>{activeId}</span></span> : null}
        </div>
      </div>

      {error && <div style={{ color: C.err, marginBottom: 8 }}>{error}</div>}
      {actionNote && (
        <div
          style={{
            color: actionNote.type === "err" ? C.err : actionNote.type === "warn" ? C.warn : actionNote.type === "ok" ? C.ok : C.cyan,
            marginBottom: 8,
            fontSize: 10,
          }}
        >
          {actionNote.text}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(8,1fr)", gap: 5, marginBottom: 8 }}>
        {[{ l: "BITRATE", v: `${bps.toFixed(3)} Mbps`, c: C.cyan }, { l: "PACKETS", v: packets.toLocaleString(), c: C.text }, { l: "CC ERRORS", v: String(ccErrors), c: ccErrors > 0 ? C.err : C.ok }, { l: "PCR JITTER", v: pcrJitter != null ? `${pcrJitter} ms` : "-", c: pcrJitter != null ? C.ok : C.muted }, { l: "NULL PKT", v: nullPct != null ? `${nullPct} %` : "-", c: C.text }, { l: "SERVICES", v: String(servicesCount), c: C.ok }, { l: "PIDs", v: String(pidsCount), c: C.text }, { l: "SCORE", v: score != null ? `${score} %` : "-", c: score != null && score >= 90 ? C.ok : C.warn }].map((s) => (
          <div key={s.l} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: "4px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: C.muted, marginBottom: 1 }}>{s.l}</div>
            <div style={{ fontSize: 12, color: s.c, fontWeight: 700 }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.borderHi}`, marginBottom: 8 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? C.borderHi : "transparent", border: "none", borderBottom: tab === t ? `2px solid ${C.cyan}` : "2px solid transparent", color: tab === t ? C.cyan : C.muted, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", padding: "5px 10px", cursor: "pointer", textTransform: "uppercase" }}>
            {t}
          </button>
        ))}
      </div>

      {tab === "ETR 290" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 6 }}>
          {/* LEFT: Priority checks table */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Per-priority enable/disable header */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 8px", background: C.panelB, border: `1px solid ${C.border}`, borderRadius: 3 }}>
              <span style={{ fontSize: 9, color: C.head, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginRight: 4 }}>Monitor:</span>
              {[
                { key: 'p1', label: 'P1 Critical', color: C.err, enabled: etrP1, set: setEtrP1 },
                { key: 'p2', label: 'P2 Quality', color: C.warn, enabled: etrP2, set: setEtrP2 },
                { key: 'p3', label: 'P3 Info', color: C.info, enabled: etrP3, set: setEtrP3 },
              ].map(({ key, label, color, enabled, set }) => (
                <button key={key} onClick={() => set((v) => !v)} style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "2px 8px",
                  border: `1px solid ${enabled ? color : C.border}`,
                  background: enabled ? `${color}18` : "transparent",
                  borderRadius: 2, cursor: "pointer",
                  color: enabled ? color : C.muted, fontSize: 9, fontWeight: 700,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: enabled ? color : C.dim, display: "inline-block" }} />
                  {label}
                </button>
              ))}
              <button
                onClick={handleApplyEtrConfig}
                disabled={monitoredIds.length === 0}
                style={{
                  marginLeft: "auto", height: 22, padding: "0 10px", borderRadius: 2, cursor: "pointer",
                  border: `1px solid ${applyConfigStatus === 'ok' ? C.ok : applyConfigStatus === 'err' ? C.err : C.cyan}`,
                  color: applyConfigStatus === 'ok' ? C.ok : applyConfigStatus === 'err' ? C.err : C.cyan,
                  background: "transparent", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                  opacity: monitoredIds.length === 0 ? 0.4 : 1,
                }}
              >
                {applyConfigStatus === 'ok' ? 'APPLIED' : applyConfigStatus === 'err' ? 'FAILED' : 'APPLY CONFIG'}
              </button>
            </div>

            <Panel title="ETR 290 Priority Checks" right="ETSI TR 101 290">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><TH>ID</TH><TH>Priority</TH><TH>Description</TH><TH right>Count</TH><TH right>Threshold</TH><TH>Status</TH></tr></thead>
                <tbody>
                  {[
                    { p: 1, enabled: etrP1, color: C.err },
                    { p: 2, enabled: etrP2, color: C.warn },
                    { p: 3, enabled: etrP3, color: C.info },
                  ].map(({ p, enabled, color }) => {
                    const rows = etrChecks.filter((r) => r.p === p);
                    if (!rows.length) return null;
                    return [
                      <tr key={`hdr-${p}`}>
                        <td colSpan={6} style={{ background: C.panelB, padding: "3px 4px", fontSize: 8, fontWeight: 800, color: enabled ? color : C.muted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                          Priority {p} {enabled ? "" : "— DISABLED"}
                        </td>
                      </tr>,
                      ...rows.map((r) => (
                        <tr key={r.id} style={{ background: !r.ok && enabled ? `${color}0a` : "transparent", opacity: enabled ? 1 : 0.4 }}>
                          <TD mono small>{r.id}</TD>
                          <TD><span style={{ color, fontSize: 9 }}>P{p}</span></TD>
                          <TD>{r.label}</TD>
                          <TD right mono><span style={{ color: r.count > 0 ? color : C.muted }}>{r.count}</span></TD>
                          <TD right>
                            <input
                              type="number" min={1} max={9999}
                              value={etrThresholds[r.key] ?? 1}
                              onChange={(e) => r.key && setEtrThresholds((prev) => ({ ...prev, [r.key]: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                              disabled={!r.key || !enabled}
                              style={{ width: 44, background: C.dim, border: `1px solid ${C.border}`, borderRadius: 2, color: C.text, fontSize: 9, padding: "1px 3px", textAlign: "right" }}
                            />
                          </TD>
                          <TD><Badge label={!enabled ? "OFF" : r.ok ? "PASS" : "FAIL"} color={!enabled ? C.muted : r.ok ? C.ok : color} small /></TD>
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </Panel>
          </div>

          {/* RIGHT: Timing + IAT + Thumbnail */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Panel title="PCR / Timing">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 9, color: C.muted }}>PCR PID</span>
                <PidRef pidLike={activeResult?.dvb?.pcr?.pid ?? activeResult?.dvb?.pcr?.pidHex} color={C.accent} />
              </div>
              <KV k="PCR Interval" v={activeResult?.dvb?.pcr?.intervalMs != null ? `${activeResult.dvb.pcr.intervalMs} ms` : "-"} vc={C.ok} />
              <KV k="PCR Jitter" v={pcrJitter != null ? `${pcrJitter} ms` : "-"} vc={pcrJitter != null && pcrJitter > 5 ? C.warn : C.ok} />
              <KV k="CC Errors" v={String(ccErrors)} vc={ccErrors > 0 ? C.err : C.ok} />
            </Panel>

            {/* IAT / Network panel */}
            <Panel title="IAT / Network">
              {(() => {
                const arr = activeResult?.dvb?.arrival || {};
                const iat = arr.iatMs || {};
                const hasIat = iat.avg != null;
                const jitter = arr.jitterMs;
                const loss = arr.packetLossPct;
                return hasIat || jitter != null || loss != null ? (
                  <div>
                    {hasIat && <>
                      <KV k="IAT avg" v={`${Number(iat.avg).toFixed(2)} ms`} vc={Number(iat.avg) > 50 ? C.warn : C.ok} />
                      <KV k="IAT min" v={iat.min != null ? `${Number(iat.min).toFixed(2)} ms` : "-"} />
                      <KV k="IAT max" v={iat.max != null ? `${Number(iat.max).toFixed(2)} ms` : "-"} />
                      <KV k="IAT p95" v={iat.p95 != null ? `${Number(iat.p95).toFixed(2)} ms` : "-"} vc={Number(iat.p95) > 150 ? C.err : C.ok} />
                    </>}
                    {jitter != null && <KV k="Jitter" v={`${Number(jitter).toFixed(2)} ms`} vc={Number(jitter) > 5 ? C.warn : C.ok} />}
                    {loss != null && <KV k="Pkt Loss" v={`${Number(loss).toFixed(3)} %`} vc={Number(loss) > 0.01 ? C.err : C.ok} />}
                  </div>
                ) : (
                  <span style={{ fontSize: 9, color: C.muted }}>IAT sniffer not active (set Capture NIC)</span>
                );
              })()}
            </Panel>

            <Panel title="Stream Info" status={activeResult ? "OK" : "WARN"}>
              <KV k="Source" v={target.host} />
              <KV k="Protocol" v={target.protocol} vc={C.accent} />
              <KV k="Port" v={target.port} />
              <KV k="SMPTE 2022-7" v={dualLeg ? "Enabled" : "Disabled"} vc={dualLeg ? C.gold : C.muted} />
              {activeResult?.dvb?.services?.[0]?.serviceName && (
                <KV k="Service" v={activeResult.dvb.services[0].serviceName} vc={C.cyan} />
              )}
            </Panel>

            {/* Live thumbnail */}
            {activeResult?.thumbnailUrl && (
              <Panel title="Thumbnail">
                <img
                  src={activeResult.thumbnailUrl}
                  alt="Stream thumbnail"
                  style={{ width: "100%", borderRadius: 2, display: "block" }}
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              </Panel>
            )}
          </div>
        </div>
      )}

      {tab === "ST 2022-7" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Panel title="Joined Multicasts" right={`${st20227Rows.length} entries`}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><TH>Leg</TH><TH>Name</TH><TH>Net bitrate</TH><TH right>PIDs</TH><TH right>Svcs</TH><TH>Source</TH><TH>Destination</TH><TH>IAT avg</TH><TH>Status</TH></tr></thead>
              <tbody>
                {st20227Rows.map((s, i) => (
                  <tr key={`${s.leg}-${i}`} style={{ borderLeft: `3px solid ${s.color}`, background: `${s.color}10` }}>
                    <TD><span style={{ display: "flex", alignItems: "center", gap: 4 }}><Dot c={s.color} /><span style={{ color: s.color }}>{s.leg}</span></span></TD>
                    <TD>{s.name}</TD><TD mono>{s.net}</TD><TD right mono>{s.pids}</TD><TD right mono>{s.svcs}</TD><TD mono>{s.src}</TD><TD mono>{s.dst}</TD><TD mono>{s.iat}</TD><TD><Badge label={s.ok ? "OK" : "FAIL"} color={s.ok ? C.ok : C.err} small /></TD>
                  </tr>
                ))}
                {st20227Rows.length === 0 && <tr><TD colSpan={9}>No A/B leg data yet. Start probe in dual-leg mode.</TD></tr>}
              </tbody>
            </table>
          </Panel>
        </div>
      )}

      {tab === "DVB Tables" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {dvbTables.map((t) => {
            const open = Boolean(expanded[t.table]);
            return (
              <div key={t.table} style={{ background: C.panel, border: `1px solid ${open ? C.borderHi : C.border}`, borderRadius: 3, overflow: "hidden" }}>
                <div onClick={() => setExpanded((e) => ({ ...e, [t.table]: !e[t.table] }))} style={{ display: "grid", gridTemplateColumns: "22px 60px 1fr 80px 90px 90px 80px 60px", gap: 8, padding: "5px 8px", cursor: "pointer", alignItems: "center", background: open ? C.panelB : C.panel }}>
                  <span style={{ fontSize: 9, color: C.muted }}>{open ? "v" : ">"}</span>
                  <span style={{ fontSize: 10 }}><PidRef pidLike={t.pid} /></span>
                  <div><span style={{ fontSize: 10, fontWeight: 700, color: t.ok ? C.cyan : C.err, marginRight: 8 }}>{t.table}</span><span style={{ fontSize: 9, color: C.muted }}>{t.name}</span></div>
                  <span style={{ fontSize: 9, color: C.muted }}>ver {t.ver}</span>
                  <span style={{ fontSize: 9, color: C.muted }}>int {t.interval_ms}</span>
                  <span style={{ fontSize: 9, color: C.muted }}>last {t.last_ms}</span>
                  <Badge label={t.ok ? "PRESENT" : "ABSENT"} color={t.ok ? C.ok : C.err} small />
                  <span style={{ fontSize: 8, color: C.muted }}>{t.tsid !== "-" ? `TSID ${t.tsid}` : ""}</span>
                </div>
                {open && (
                  <div style={{ borderTop: `1px solid ${C.borderHi}`, padding: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div><div style={{ fontSize: 8, color: C.muted, marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>Description</div><div style={{ fontSize: 10, color: C.text, lineHeight: 1.5 }}>{t.desc}</div></div>
                    <div><div style={{ fontSize: 8, color: C.muted, marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>Entries</div>{t.entries.length === 0 ? <span style={{ fontSize: 9, color: C.muted }}>No entries parsed</span> : t.entries.map((e, j) => <div key={`${t.table}-${j}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "2px 0", borderBottom: `1px solid ${C.border}` }}><PidRef pidLike={e.num} /><PidRef pidLike={e.pid} color={C.muted} /><span style={{ fontSize: 9, color: C.text }}>{e.label}</span></div>)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "PIDs" && (
        <Panel title="PID Table" right={`${pidRows.length} PIDs`}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><TH>PID</TH><TH>Type</TH><TH>Description</TH><TH right>Bitrate</TH><TH right>CC Errs</TH><TH>Status</TH></tr></thead>
            <tbody>
              {pidRows.map((p, i) => (
                <tr key={`pid-${i}`}>
                  <TD mono><PidRef pidLike={p.pid ?? p.pidHex} /></TD><TD><Badge label={p.type} color={p.type === "VIDEO" ? C.purple : p.type === "AUDIO" ? C.info : C.head} small /></TD><TD>{p.label}</TD><TD right mono><Mono v={p.bps} c={C.cyan} size={10} /></TD><TD right mono><span style={{ color: p.cc > 0 ? C.err : C.muted }}>{p.cc}</span></TD><TD><Badge label={p.ok ? "OK" : "ERR"} color={p.ok ? C.ok : C.err} small /></TD>
                </tr>
              ))}
              {pidRows.length === 0 && <tr><TD colSpan={6}>No PID inventory yet.</TD></tr>}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "Programs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {programs.map((p) => (
            <Panel key={String(p.num)} title={`${p.name} · ${p.num ?? "-"}`} status={p.scrambled ? "SCRAMBLED" : "FTA"} right={p.provider}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 12 }}>
                <div><KV k="Program Num" v={p.num != null ? String(p.num) : "-"} vc={C.accent} /><KV k="Service Name" v={p.name} vc={C.cyan} /><KV k="Provider" v={p.provider} /><KV k="Running" v={p.running === 4 ? "Running" : "Not running"} vc={C.ok} /><KV k="Scrambled" v={p.scrambled ? "YES" : "NO"} vc={p.scrambled ? C.err : C.ok} /></div>
                <div>
                  <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Elementary Streams</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr><TH>PID</TH><TH>Stream Type</TH><TH>Codec</TH><TH right>Bitrate</TH></tr></thead>
                    <tbody>{p.streams.map((s, j) => <tr key={`${p.num}-${j}`}><TD mono><PidRef pidLike={s.pid ?? s.pidHex} /></TD><TD><Badge label={s.type} color={s.type === "VIDEO" ? C.purple : s.type === "AUDIO" ? C.info : C.gold} small /></TD><TD>{s.codec}</TD><TD right mono><Mono v={s.kbps === "-" ? "-" : `${s.kbps} kbps`} c={C.cyan} size={10} /></TD></tr>)}</tbody>
                  </table>
                </div>
              </div>
            </Panel>
          ))}
          {programs.length === 0 && <Panel title="Programs"><span style={{ color: C.muted }}>No program map parsed yet.</span></Panel>}
        </div>
      )}

      {tab === "Event Log" && (
        <Panel title="Event Log" right="live">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><TH>Time</TH><TH>Severity</TH><TH>Source</TH><TH>Event</TH></tr></thead>
            <tbody>
              {eventRows.map((e) => {
                const c = e.sev === "ERROR" ? C.err : e.sev === "WARN" ? C.warn : C.info;
                return <tr key={e.key}><TD mono><Mono v={new Date(e.t).toLocaleTimeString()} c={C.muted} size={9} /></TD><TD><Badge label={e.sev} color={c} small /></TD><TD><span style={{ fontSize: 9, color: C.muted }}>{e.src}</span></TD><TD><span style={{ fontSize: 10, color: C.text }}>{e.msg}</span></TD></tr>;
              })}
              {eventRows.length === 0 && <tr><TD colSpan={4}>No events yet.</TD></tr>}
            </tbody>
          </table>
        </Panel>
      )}

      <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.muted }}>LABOTECH ETR · SMPTE ST 2022-7 · ETSI TR 101 290 · DVB SI/PSI</span>
        <Mono v={`upd ${ts} · pkts ${packets.toLocaleString()}`} c={C.dim} size={9} />
      </div>
    </div>
  );
}
