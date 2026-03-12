import React, { useEffect, useMemo, useState } from "react";
import useTSAnalysis from "../hooks/useTSAnalysis";
import useETR290 from "../hooks/useETR290";
import { Badge, C, Dot, Field, Input, PanelBox, SectionHead, Select } from "./BroadcastUI";

const PROBE_MODES = [
  { value: "rtp", label: "RTP" },
  { value: "srt", label: "SRT" },
  { value: "udp", label: "UDP" },
];

const REFRESH_OPTIONS_MS = [
  { value: 1000, label: "1 second" },
  { value: 2000, label: "2 seconds" },
  { value: 5000, label: "5 seconds" },
  { value: 10000, label: "10 seconds" },
  { value: 15000, label: "15 seconds" },
  { value: 30000, label: "30 seconds" },
];

const ETR_CHECK_FIELDS = [
  { id: "ts_sync", label: "TS Sync" },
  { id: "sync_byte", label: "Sync Byte" },
  { id: "pat_error", label: "PAT Error" },
  { id: "cc_error", label: "CC Error" },
  { id: "pmt_error", label: "PMT Error" },
  { id: "pid_error", label: "PID Error" },
  { id: "transport_error", label: "Transport Error" },
  { id: "crc_error", label: "CRC Error" },
  { id: "pcr_disc", label: "PCR Discontinuity" },
  { id: "pcr_acc", label: "PCR Accuracy" },
  { id: "pcr_rep", label: "PCR Repetition" },
  { id: "pts_error", label: "PTS Error" },
  { id: "cat_error", label: "CAT Error" },
  { id: "nit_error", label: "NIT Error" },
  { id: "sdt_error", label: "SDT Error" },
  { id: "eit_error", label: "EIT Error" },
  { id: "rst_error", label: "RST Error" },
  { id: "tdt_error", label: "TDT Error" },
  { id: "empty_buf", label: "Empty Buffer" },
];

const RECOMMENDED_DECODER_PORT = "6501";
// ETSI TR 101 290 compliant default alarm thresholds.
// Value = number of consecutive violations before incident is created.
// P1: any single occurrence is critical. P2: small debounce where FFmpeg noise is known.
const RECOMMENDED_THRESHOLDS = {
  // P1 — Service not receivable (threshold=1: any single violation fires)
  ts_sync: 1,         // 1.1 — TS sync loss: any occurrence
  sync_byte: 1,       // 1.2 — Sync byte error: any occurrence
  pat_error: 1,       // 1.3 — PAT missing/interval >500 ms
  cc_error: 1,        // 1.4 — Continuity counter error: any
  pmt_error: 1,       // 1.5 — PMT missing/interval >500 ms
  pid_error: 1,       // 1.6 — Unreferenced PID for >5 s
  // P2 — Quality impairment
  transport_error: 1, // 2.1 — TEI bit set in TS packet
  crc_error: 1,       // 2.2 — CRC error in PSI section
  pcr_disc: 1,        // 2.3 — PCR discontinuity >100 ms
  pcr_acc: 3,         // 2.4 — PCR jitter >500 ns; debounce=3 to reduce FFmpeg noise
  pcr_rep: 1,         // 2.5 — PCR interval >40 ms
  pts_error: 1,       // 2.6 — PTS error in video/audio
  cat_error: 1,       // 2.7 — CAT missing/interval >500 ms (optional table)
  // P3 — Informational
  nit_error: 1,       // 3.1/3.2 — NIT error
  sdt_error: 1,       // 3.5 — SDT error
  eit_error: 1,       // 3.6 — EIT error
  rst_error: 1,       // 3.7 — RST error
  tdt_error: 1,       // 3.8 — TDT/TOT missing/interval >30 s
  empty_buf: 1,       // Buffer empty (informational)
};

function newDecoderRow(seed = Date.now()) {
  return {
    key: `${seed}-${Math.random().toString(36).slice(2, 8)}`,
    host: "",
    port: RECOMMENDED_DECODER_PORT,
    decoderId: "",
  };
}

function normalizeLaneId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return "unknown";
  return id.replace(/^etr[-_:]/i, "") || id;
}

function buildProbeUrl({ mode, host, port, latency, passphrase }) {
  if (!host || !port) return "";
  if (mode === "udp") return `udp://${host}:${port}`;
  if (mode === "rtp") return `rtp://${host}:${port}`;
  let url = `srt://${host}:${port}`;
  const params = [];
  if (latency) params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join("&")}`;
  return url;
}

function collectAutoPids(result) {
  const pids = new Set();
  const push = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) pids.add(n);
  };
  (result?.programs || []).forEach((p) => (p.streams || []).forEach((s) => push(s.pid)));
  (result?.orphanStreams || []).forEach((s) => push(s.pid));
  (result?.dvb?.services || []).forEach((svc) => {
    push(svc.pmtPid);
    push(svc.pcrPid);
    push(svc.videoPid);
  });
  return Array.from(pids).sort((a, b) => a - b);
}

function qualityMetrics(etrStatus, tsResult) {
  const counts = etrStatus?.counts || {};
  const dvb = tsResult?.dvb || {};
  // Prefer live ETR290 incident counts when ETR is running; fall back to TS probe data.
  return {
    packetLoss: (counts.ts_sync || 0) + (counts.transport_error || 0)
      || Math.round(Number(dvb.arrival?.packetLossPct) || 0),
    jitter: (counts.pcr_acc || 0) + (counts.pcr_disc || 0)
      || (dvb.timestampDiscontinuity?.pcrDiscontinuity || 0),
    pcrErrors: (counts.pcr_acc || 0) + (counts.pcr_rep || 0) + (counts.pcr_disc || 0)
      || (dvb.timestampDiscontinuity?.count || 0),
    ccErrors: (counts.cc_error || 0) || (dvb.continuityCounterErrors?.count || 0),
  };
}

function extractPidRows(selectedResult) {
  const rows = [];
  (selectedResult?.programs || []).forEach((p) => (p.streams || []).forEach((s) => rows.push(s)));
  (selectedResult?.orphanStreams || []).forEach((s) => rows.push(s));
  return rows
    .map((s) => ({
      pid: s.pid,
      pidHex: s.pidHex,
      codecType: s.codecType || s.type || "unknown",
      codec: s.codecName || s.codec || s.description || "-",
      bitrate: Number(s.bitrate || 0),
    }))
    .slice(0, 20);
}

function makeUniqueDecoderId(baseId, usedSet) {
  const cleanBase = String(baseId || "decoder").trim() || "decoder";
  if (!usedSet.has(cleanBase)) {
    usedSet.add(cleanBase);
    return cleanBase;
  }
  let i = 2;
  while (usedSet.has(`${cleanBase}-${i}`)) i += 1;
  const candidate = `${cleanBase}-${i}`;
  usedSet.add(candidate);
  return candidate;
}

function renderPidRef(pid, pidHex) {
  const hasDec = Number.isFinite(Number(pid));
  const dec = hasDec ? Number(pid) : null;
  const hex = pidHex || (hasDec ? `0x${Number(pid).toString(16).toUpperCase().padStart(4, "0")}` : null);
  if (dec == null && !hex) return <span style={{ color: C.muted }}>-</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      {dec != null ? <span style={{ color: C.accent, fontFamily: "'Courier New',monospace", fontSize: 10 }}>{dec}</span> : null}
      {hex ? <span style={{ color: C.muted, fontFamily: "'Courier New',monospace", fontSize: 9 }}>{hex}</span> : null}
    </span>
  );
}

function StatBox({ label, value, color = C.text }) {
  return (
    <div
      style={{
        background: C.dim,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        padding: "4px 8px",
      }}
    >
      <div
        style={{
          fontSize: 8,
          color: C.muted,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Courier New',monospace",
          fontSize: 11,
          color,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function DecoderPanel({ lastMessage, selectedDecoderRequest }) {
  const [mode, setMode] = useState("rtp");
  const [decoderRows, setDecoderRows] = useState([newDecoderRow()]);
  const [latency, setLatency] = useState("2000");
  const [passphrase, setPassphrase] = useState("");
  const [intervalMs, setIntervalMs] = useState(5000);
  const [addToMultiview, setAddToMultiview] = useState(true);
  const [captureNic, setCaptureNic] = useState("");
  const [use20227, setUse20227] = useState(false);
  const [legBHost, setLegBHost] = useState("");
  const [legBPort, setLegBPort] = useState("6502");
  const [legBNic, setLegBNic] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [provisionSummary, setProvisionSummary] = useState(null);
  const [forensicById, setForensicById] = useState({});
  const [subTab, setSubTab] = useState("quality");
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("Broadcast baseline profile");
  const [selectedProfileName, setSelectedProfileName] = useState("");
  const [allowUnknownPid, setAllowUnknownPid] = useState(true);
  const [enableEtrOnProvision, setEnableEtrOnProvision] = useState(false);
  const [etrActionNote, setEtrActionNote] = useState(null);
  const [thresholds, setThresholds] = useState(() =>
    ETR_CHECK_FIELDS.reduce((acc, c) => ({ ...acc, [c.id]: String(RECOMMENDED_THRESHOLDS[c.id] || 1) }), {})
  );
  const [etrP1Enabled, setEtrP1Enabled] = useState(true);
  const [etrP2Enabled, setEtrP2Enabled] = useState(true);
  const [etrP3Enabled, setEtrP3Enabled] = useState(true);
  const [excludePidsText, setExcludePidsText] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState([]);
  const [busy, setBusy] = useState(false);

  const {
    result,
    error,
    activeIds,
    resultsById,
    probe,
    refreshActives,
    startContinuous,
    stop,
    onWsResult,
  } = useTSAnalysis();
  const etr = useETR290();

  useEffect(() => {
    refreshActives();
    etr.refreshActives();
    etr.loadProfiles();
  }, [refreshActives, etr.refreshActives, etr.loadProfiles]);

  useEffect(() => {
    if (!lastMessage) return;
    onWsResult(lastMessage);
    etr.onWsMessage(lastMessage);

    if (lastMessage.type === "analyse_result" && lastMessage.id) {
      const decoderId = normalizeLaneId(lastMessage.id);
      const arrival = lastMessage?.dvb?.arrival || {};
      const iat = arrival?.iatMs || {};
      const sample = {
        ts: lastMessage.time ? new Date(lastMessage.time).getTime() : Date.now(),
        iatMin: Number(iat.min) || 0,
        iatAvg: Number(iat.avg) || 0,
        iatP95: Number(iat.p95) || 0,
        jitter: Number(arrival.jitterMs) || 0,
        loss: Number(arrival.packetLossPct) || 0,
      };
      setForensicById((prev) => ({
        ...prev,
        [decoderId]: [...(prev[decoderId] || []), sample].slice(-120),
      }));
    }
  }, [lastMessage, onWsResult, etr.onWsMessage]);

  useEffect(() => {
    if (!selectedId && activeIds.length > 0) setSelectedId(activeIds[0]);
  }, [activeIds, selectedId]);

  useEffect(() => {
    const requested = selectedDecoderRequest?.id;
    if (requested) setSelectedId(requested);
  }, [selectedDecoderRequest]);

  const rowPlans = useMemo(
    () =>
      decoderRows.map((row, idx) => ({
        ...row,
        rowIndex: idx + 1,
        url: buildProbeUrl({
          mode,
          host: row.host,
          port: row.port,
          latency,
          passphrase,
        }),
      })),
    [decoderRows, mode, latency, passphrase]
  );

  const validRowPlans = rowPlans.filter((r) => r.url);
  const legAUrl = validRowPlans[0]?.url || "";
  const legBUrl = buildProbeUrl({
    mode,
    host: legBHost,
    port: legBPort,
    latency,
    passphrase,
  });
  const selectedResult = useMemo(() => {
    if (selectedId) return resultsById[selectedId] || (result?.id === selectedId ? result : null);
    return result;
  }, [selectedId, resultsById, result]);
  const autoIncludePids = useMemo(() => collectAutoPids(selectedResult), [selectedResult]);
  const autoIncludePidsText = useMemo(
    () => (autoIncludePids.length ? autoIncludePids.join(", ") : "Awaiting TS input..."),
    [autoIncludePids]
  );
  // Map service ID → list of PIDs belonging to that service
  const servicePidsByServiceId = useMemo(() => {
    const map = {};
    (selectedResult?.dvb?.services || []).forEach((svc) => {
      const pids = [];
      if (svc.pmtPid != null) pids.push(svc.pmtPid);
      if (svc.pcrPid != null) pids.push(svc.pcrPid);
      const prog = (selectedResult?.programs || []).find((p) => p.programId === svc.serviceId);
      if (prog) (prog.streams || []).forEach((s) => { if (s.pid != null) pids.push(s.pid); });
      map[svc.serviceId] = [...new Set(pids)];
    });
    return map;
  }, [selectedResult]);

  const parsedExcludePids = useMemo(
    () =>
      excludePidsText
        .split(/[,\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 0),
    [excludePidsText]
  );

  const etrConfig = useMemo(() => {
    const includePids =
      selectedServiceIds.length > 0
        ? [...new Set(selectedServiceIds.flatMap((sid) => servicePidsByServiceId[sid] || []))]
        : autoIncludePids;
    // Build thresholds: disabled priorities get threshold=99999 (effectively silenced)
    const P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
    const P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];
    const P3_KEYS = ['nit_error', 'sdt_error', 'eit_error', 'rst_error', 'tdt_error', 'empty_buf'];
    const parsedThresholds = Object.fromEntries(
      Object.entries(thresholds)
        .map(([k, v]) => [k, parseInt(v, 10)])
        .filter(([, v]) => Number.isFinite(v) && v > 0)
    );
    if (!etrP1Enabled) P1_KEYS.forEach((k) => { parsedThresholds[k] = 99999; });
    if (!etrP2Enabled) P2_KEYS.forEach((k) => { parsedThresholds[k] = 99999; });
    if (!etrP3Enabled) P3_KEYS.forEach((k) => { parsedThresholds[k] = 99999; });
    return {
      includePids,
      excludePids: parsedExcludePids,
      allowUnknownPid,
      thresholds: parsedThresholds,
    };
  }, [autoIncludePids, allowUnknownPid, thresholds, selectedServiceIds, servicePidsByServiceId, parsedExcludePids, etrP1Enabled, etrP2Enabled, etrP3Enabled]);

  const selectedEtrStatus = useMemo(() => {
    if (!selectedId) return etr.status;
    return etr.statusById?.[`etr-${selectedId}`] || etr.statusById?.[selectedId] || etr.status;
  }, [selectedId, etr.statusById, etr.status]);
  const selectedEtrMonitorId = selectedId ? `etr-${selectedId}` : "";
  const selectedEtrExists = selectedEtrMonitorId ? Boolean(etr.statusById?.[selectedEtrMonitorId] || etr.statusById?.[selectedId]) : false;
  const selectedDecoderUrl = useMemo(() => {
    if (!selectedId) return "";
    const fromResult = (resultsById[selectedId] || selectedResult)?.url;
    if (fromResult) return fromResult;
    const fromRow = rowPlans.find((r) => r.decoderId?.trim() === selectedId)?.url;
    return fromRow || "";
  }, [selectedId, resultsById, selectedResult, rowPlans]);

  const m = qualityMetrics(selectedEtrStatus, selectedResult);
  const pids = extractPidRows(selectedResult);
  const forensic = forensicById[selectedId] || [];
  const latestForensic = forensic.length ? forensic[forensic.length - 1] : null;

  const updateRow = (rowKey, patch) => {
    setDecoderRows((rows) => rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)));
  };

  const addDecoderRow = () => setDecoderRows((rows) => [...rows, newDecoderRow()]);
  const removeDecoderRow = (rowKey) => {
    setDecoderRows((rows) => (rows.length <= 1 ? rows : rows.filter((r) => r.key !== rowKey)));
  };

  const startRows = async (plansToStart) => {
    if (!plansToStart.length) return;
    const runStamp = Date.now();
    const started = [];
    const failed = [];
    const etrStarted = [];
    const etrFailed = [];
    setEtrActionNote(null);
    const usedIds = new Set([...(activeIds || [])]);
    for (let i = 0; i < plansToStart.length; i += 1) {
      const row = plansToStart[i];
      const requestedId = row.decoderId?.trim() || `decoder-${runStamp}`;
      const id = makeUniqueDecoderId(requestedId, usedIds);
      try {
        if (addToMultiview) {
          await startContinuous(id, row.url, parseInt(intervalMs, 10) || 5000, captureNic || undefined);
          try {
            await probe(row.url);
          } catch (_) {}
        } else {
          await probe(row.url);
        }
        started.push(id);
        if (enableEtrOnProvision) {
          try {
            await etr.start(`etr-${id}`, row.url, captureNic || undefined, {
              profileName: selectedProfileName || undefined,
              config: etrConfig,
            });
            etrStarted.push(id);
          } catch (etrErr) {
            etrFailed.push({ id, message: `ETR attach warning: ${etrErr?.message || "failed"}` });
          }
        }
      } catch (err) {
        failed.push({ id, message: err?.message || "Provision failed" });
      }
    }
    if (started.length) setSelectedId(started[started.length - 1]);
    try {
      await refreshActives();
      await etr.refreshActives();
    } catch (_) {}
    setProvisionSummary({ started, failed: [...failed, ...etrFailed], etrStarted, at: Date.now() });
  };

  const startDecoder = async () => {
    if (busy) return;
    setBusy(true);
    try { await startRows(validRowPlans); } finally { setBusy(false); }
  };

  const startSingleDecoderRow = async (rowKey) => {
    if (busy) return;
    const rowPlan = rowPlans.find((r) => r.key === rowKey && r.url);
    if (!rowPlan) return;
    setBusy(true);
    try { await startRows([rowPlan]); } finally { setBusy(false); }
  };

  const stopDecoder = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await stop(selectedId);
      try { await refreshActives(); } catch (_) {}
    } finally { setBusy(false); }
  };

  const startEtrForSelected = async () => {
    if (!selectedId) {
      setEtrActionNote({ type: "warn", text: "Select a decoder first." });
      return;
    }
    if (busy) return;
    if (selectedEtrExists) {
      setBusy(true);
      try {
        await etr.updateConfig(selectedEtrMonitorId, etrConfig, selectedProfileName || null);
        await etr.refreshActives();
        setEtrActionNote({ type: "info", text: `ETR already running for ${selectedId}. Config updated.` });
      } finally { setBusy(false); }
      return;
    }
    if (!selectedDecoderUrl) {
      setEtrActionNote({ type: "warn", text: "Start decoder first so ETR can attach to a live URL." });
      return;
    }
    setBusy(true);
    try {
      await etr.start(selectedEtrMonitorId, selectedDecoderUrl, captureNic || undefined, {
        profileName: selectedProfileName || undefined,
        config: etrConfig,
      });
      await etr.refreshActives();
      setEtrActionNote({ type: "ok", text: `ETR enabled for ${selectedId}.` });
    } catch (err) {
      const msg = err?.message || "Failed to start ETR monitor.";
      if (String(msg).toLowerCase().includes("already exists")) {
        await etr.updateConfig(selectedEtrMonitorId, etrConfig, selectedProfileName || null);
        await etr.refreshActives();
        setEtrActionNote({ type: "info", text: `ETR already existed for ${selectedId}. Config updated.` });
        return;
      }
      setEtrActionNote({ type: "err", text: msg });
    } finally { setBusy(false); }
  };

  const stopEtrForSelected = async () => {
    if (!selectedId) {
      setEtrActionNote({ type: "warn", text: "Select a decoder first." });
      return;
    }
    if (!selectedEtrExists || busy) return;
    setBusy(true);
    try {
      await etr.stop(selectedEtrMonitorId);
      await etr.refreshActives();
      setEtrActionNote({ type: "ok", text: `ETR stopped for ${selectedId}.` });
    } finally { setBusy(false); }
  };

  const applyProfileToForm = (name) => {
    setSelectedProfileName(name);
    const p = (etr.profiles || []).find((row) => row.name === name);
    if (!p) return;
    const cfg = p.config || {};
    setAllowUnknownPid(cfg.allowUnknownPid !== false);
    setThresholds((prev) => {
      const next = { ...prev };
      for (const c of ETR_CHECK_FIELDS) {
        next[c.id] = String(cfg.thresholds?.[c.id] || RECOMMENDED_THRESHOLDS[c.id] || 1);
      }
      return next;
    });
    if (Array.isArray(cfg.excludePids) && cfg.excludePids.length > 0) {
      setExcludePidsText(cfg.excludePids.join(", "));
    }
  };

  const saveCurrentProfile = async () => {
    if (!profileName.trim()) return;
    await etr.saveProfile(profileName.trim(), etrConfig, profileDescription.trim());
    setSelectedProfileName(profileName.trim());
  };

  const deleteCurrentProfile = async () => {
    if (!selectedProfileName) return;
    await etr.deleteProfile(selectedProfileName);
    setSelectedProfileName("");
  };

  const applyConfigToRunning = async () => {
    if (!selectedId) {
      setEtrActionNote({ type: "warn", text: "Select a decoder first." });
      return;
    }
    if (!selectedEtrExists) {
      setEtrActionNote({ type: "warn", text: "ETR is not running for selected decoder. Use Enable ETR first." });
      return;
    }
    await etr.updateConfig(selectedEtrMonitorId, etrConfig, selectedProfileName || null);
    setEtrActionNote({ type: "ok", text: "ETR runtime config applied." });
  };

  return (
    <div style={{ fontFamily: "'Segoe UI',sans-serif", background: C.bg, color: C.text, minHeight: "100vh" }}>
      <div style={{ padding: "8px 10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Dot c={C.cyan} />
          <span style={{ fontSize: 10, color: C.head, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>Decoder Operations</span>
        </div>
        <Badge label="RUNNING" color={C.ok} filled />
      </div>

      <div style={{ padding: 10, display: "grid", gridTemplateColumns: "720px 1fr", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PanelBox>
            <SectionHead icon="⚙" title="Decoder Provisioning" />
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {PROBE_MODES.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => setMode(v.value)}
                    style={{
                      flex: 1,
                      borderRadius: 2,
                      border: `1px solid ${mode === v.value ? C.cyan : C.border}`,
                      background: mode === v.value ? `${C.cyan}14` : "transparent",
                      color: mode === v.value ? C.cyan : C.muted,
                      padding: "5px 0",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {decoderRows.map((row) => (
                <div key={row.key} style={{ display: "grid", gridTemplateColumns: "1.45fr 100px 1.1fr 86px 86px", gap: 8, alignItems: "end" }}>
                  <Field label="Host / IP">
                    <Input value={row.host} onChange={(e) => updateRow(row.key, { host: e.target.value })} placeholder="239.100.25.29" mono style={{ color: C.muted }} />
                  </Field>
                  <Field label="Port">
                    <Input
                      value={row.port}
                      onChange={(e) => updateRow(row.key, { port: e.target.value })}
                      placeholder={RECOMMENDED_DECODER_PORT}
                      mono
                      style={{ color: C.muted }}
                    />
                  </Field>
                  <Field label="Decoder ID (optional)">
                    <Input value={row.decoderId} onChange={(e) => updateRow(row.key, { decoderId: e.target.value })} placeholder="decoder-a" mono style={{ color: C.muted }} />
                  </Field>
                  <button
                    onClick={() => startSingleDecoderRow(row.key)}
                    disabled={!row.host || !row.port || busy}
                    style={{
                      height: 34,
                      borderRadius: 2,
                      border: `1px solid ${row.host && row.port && !busy ? C.ok : C.border}`,
                      color: row.host && row.port && !busy ? C.bg : C.muted,
                      background: row.host && row.port && !busy ? C.ok : "transparent",
                      boxShadow: row.host && row.port && !busy ? `0 0 8px ${C.ok}44` : "none",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: row.host && row.port && !busy ? "pointer" : "not-allowed",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    {busy ? "…" : "Start"}
                  </button>
                  <button
                    onClick={() => removeDecoderRow(row.key)}
                    disabled={decoderRows.length <= 1}
                    style={{
                      height: 34,
                      borderRadius: 2,
                      border: `1px solid ${C.err}`,
                      color: C.err,
                      background: "transparent",
                      fontSize: 10,
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <button
                  onClick={addDecoderRow}
                  style={{
                    borderRadius: 2,
                    border: `1px solid ${C.cyan}`,
                    color: C.cyan,
                    background: `${C.cyan}10`,
                    padding: "6px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  + Add row
                </button>
                <button
                  onClick={startDecoder}
                  disabled={!validRowPlans.length || busy}
                  style={{
                    borderRadius: 2,
                    border: `1px solid ${validRowPlans.length && !busy ? C.ok : C.border}`,
                    color: validRowPlans.length && !busy ? C.bg : C.muted,
                    background: validRowPlans.length && !busy ? C.ok : "transparent",
                    padding: "6px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: validRowPlans.length && !busy ? "pointer" : "not-allowed",
                    boxShadow: validRowPlans.length && !busy ? `0 0 10px ${C.ok}55` : "none",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? "STARTING…" : "▶ START BATCH"}
                </button>
                <button
                  onClick={stopDecoder}
                  disabled={!selectedId || busy}
                  style={{
                    borderRadius: 2,
                    border: `1px solid ${selectedId && !busy ? C.err : C.border}`,
                    color: selectedId && !busy ? C.err : C.muted,
                    background: "transparent",
                    padding: "6px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: selectedId && !busy ? "pointer" : "not-allowed",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? "STOPPING…" : "■ STOP DECODER"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Capture NIC (optional)">
                  <Input value={captureNic} onChange={(e) => setCaptureNic(e.target.value)} placeholder="eno2 (recommended)" mono />
                </Field>
                <Field label="Refresh">
                  <Select
                    value={String(intervalMs)}
                    onChange={(e) => setIntervalMs(parseInt(e.target.value, 10))}
                    options={REFRESH_OPTIONS_MS.map((opt) => ({ value: String(opt.value), label: opt.label }))}
                  />
                </Field>
              </div>

              {mode === "srt" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Latency (ms)">
                    <Input value={latency} onChange={(e) => setLatency(e.target.value)} mono />
                  </Field>
                  <Field label="Passphrase">
                    <Input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  </Field>
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 7, color: addToMultiview ? C.ok : C.muted, fontSize: 10 }}>
                <input type="checkbox" checked={addToMultiview} onChange={(e) => setAddToMultiview(e.target.checked)} style={{ accentColor: C.ok }} />
                Add to Multiview
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 7, color: use20227 ? C.s22 : C.muted, fontSize: 10 }}>
                <input type="checkbox" checked={use20227} onChange={(e) => setUse20227(e.target.checked)} style={{ accentColor: C.s22 }} />
                Enable SMPTE ST 2022-7 dual-path monitoring
              </label>

              {use20227 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 1fr", gap: 10 }}>
                  <Field label="Leg B Host / IP">
                    <Input value={legBHost} onChange={(e) => setLegBHost(e.target.value)} placeholder="239.100.25.30" mono />
                  </Field>
                  <Field label="Leg B Port">
                    <Input value={legBPort} onChange={(e) => setLegBPort(e.target.value)} placeholder="6502" mono />
                  </Field>
                  <Field label="Leg B NIC (optional)">
                    <Input value={legBNic} onChange={(e) => setLegBNic(e.target.value)} placeholder="eno3" mono />
                  </Field>
                </div>
              )}

              <PanelBox style={{ borderColor: C.borderHi }}>
                <SectionHead icon="🧪" title="ETR 290 Tuning" right={<Badge label="LIVE CONFIG" color={C.warn} small />} />
                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 9 }}>
                  {/* Per-priority enable/disable */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, color: C.muted, marginRight: 2 }}>Monitor priorities:</span>
                    {[
                      { label: "P1 Critical", enabled: etrP1Enabled, set: setEtrP1Enabled, color: C.err },
                      { label: "P2 Quality",  enabled: etrP2Enabled, set: setEtrP2Enabled, color: C.warn },
                      { label: "P3 Info",     enabled: etrP3Enabled, set: setEtrP3Enabled, color: C.info },
                    ].map(({ label, enabled, set, color }) => (
                      <button key={label} onClick={() => set((v) => !v)} style={{
                        padding: "2px 8px", fontSize: 9, fontWeight: 700,
                        border: `1px solid ${enabled ? color : C.border}`,
                        color: enabled ? color : C.muted,
                        background: enabled ? `${color}18` : "transparent",
                        borderRadius: 2, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 4,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: enabled ? color : C.dim, display: "inline-block" }} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div style={{ fontSize: 9, color: C.muted }}>
                      Recommended baseline is preloaded for broadcast ingest (PCR/CC strict, SI timing tuned).
                    </div>
                    <button
                      onClick={() => {
                        setThresholds(ETR_CHECK_FIELDS.reduce((acc, c) => ({ ...acc, [c.id]: String(RECOMMENDED_THRESHOLDS[c.id] || 1) }), {}));
                        setEtrActionNote({ type: "info", text: "Recommended DVB/ETR baseline values restored." });
                      }}
                      style={{
                        justifySelf: "end",
                        border: `1px solid ${C.border}`,
                        background: "transparent",
                        color: C.muted,
                        borderRadius: 2,
                        padding: "4px 8px",
                        fontSize: 9,
                        cursor: "pointer",
                      }}
                    >
                      Restore recommended values
                    </button>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, color: enableEtrOnProvision ? C.ok : C.muted, fontSize: 10 }}>
                    <input type="checkbox" checked={enableEtrOnProvision} onChange={(e) => setEnableEtrOnProvision(e.target.checked)} style={{ accentColor: C.ok }} />
                    Auto-enable ETR when starting decoder
                  </label>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <StatBox label="Selected decoder" value={selectedId || "-"} color={selectedId ? C.cyan : C.muted} />
                    <StatBox label="ETR state" value={selectedEtrExists ? "RUNNING" : "STOPPED"} color={selectedEtrExists ? C.ok : C.muted} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <Field label="Saved profile">
                      <Select
                        value={selectedProfileName}
                        onChange={(e) => applyProfileToForm(e.target.value)}
                        options={[{ value: "", label: "Manual config" }, ...(etr.profiles || []).map((p) => ({ value: p.name, label: p.name }))]}
                      />
                    </Field>
                    <Field label="Apply to running">
                      <button
                        onClick={applyConfigToRunning}
                        disabled={!selectedId || !selectedEtrExists}
                        style={{
                          border: `1px solid ${selectedId && selectedEtrExists ? C.cyan : C.border}`,
                          background: selectedId && selectedEtrExists ? `${C.cyan}12` : "transparent",
                          color: selectedId && selectedEtrExists ? C.cyan : C.muted,
                          borderRadius: 2,
                          padding: "6px 8px",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        Apply ETR config
                      </button>
                    </Field>
                  </div>

                  {/* Service filter — restrict ETR to specific services */}
                  {(selectedResult?.dvb?.services || []).length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>
                        Service Filter (unchecked = monitor all services)
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(selectedResult.dvb.services || []).map((svc) => {
                          const checked = selectedServiceIds.includes(svc.serviceId);
                          return (
                            <label
                              key={svc.serviceId}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 9,
                                color: checked ? C.cyan : C.muted,
                                background: checked ? `${C.cyan}12` : C.dim,
                                border: `1px solid ${checked ? C.cyan : C.border}`,
                                borderRadius: 2,
                                padding: "3px 6px",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setSelectedServiceIds((prev) =>
                                    e.target.checked
                                      ? [...prev, svc.serviceId]
                                      : prev.filter((id) => id !== svc.serviceId)
                                  )
                                }
                                style={{ accentColor: C.cyan }}
                              />
                              {svc.serviceName || `SID ${svc.serviceId}`}
                              {(servicePidsByServiceId[svc.serviceId] || []).length > 0 && (
                                <span style={{ color: C.muted }}>
                                  ({(servicePidsByServiceId[svc.serviceId] || []).length} PIDs)
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <Field label="Input PIDs (auto-derived)">
                      <Input
                        value={
                          selectedServiceIds.length > 0
                            ? [...new Set(selectedServiceIds.flatMap((sid) => servicePidsByServiceId[sid] || []))].join(", ") || "No PIDs for selection"
                            : autoIncludePidsText
                        }
                        onChange={() => {}}
                        readOnly
                        placeholder="Awaiting TS input..."
                        mono
                        style={{ color: C.muted }}
                      />
                    </Field>
                    <Field label="Excluded PIDs (comma-separated)">
                      <Input
                        value={excludePidsText}
                        onChange={(e) => setExcludePidsText(e.target.value)}
                        placeholder="e.g. 8191, 0x1FFF"
                        mono
                      />
                    </Field>
                  </div>

                  {/* Active ETR thresholds on running monitor */}
                  {selectedEtrStatus?.config?.thresholds && (
                    <div style={{ fontSize: 9, color: C.muted, background: C.dim, border: `1px solid ${C.border}`, borderRadius: 2, padding: "4px 6px" }}>
                      <span style={{ color: C.head }}>Active on monitor: </span>
                      {Object.entries(selectedEtrStatus.config.thresholds)
                        .filter(([, v]) => Number(v) !== 1)
                        .map(([k, v]) => `${k}=${v}`)
                        .join("  ·  ") || "all thresholds = 1 (default)"}
                    </div>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 6, color: allowUnknownPid ? C.ok : C.warn, fontSize: 10 }}>
                    <input type="checkbox" checked={allowUnknownPid} onChange={(e) => setAllowUnknownPid(e.target.checked)} style={{ accentColor: C.ok }} />
                    Allow alarms without PID evidence
                  </label>
                  <div style={{ fontSize: 9, color: C.muted }}>
                    ETR tuning changes alarm trigger thresholds only; measured TS/PID values remain untouched.
                  </div>

                  {[
                    { p: 1, label: "P1 — Critical (Service not receivable)", color: C.err, enabled: etrP1Enabled, keys: ['ts_sync','sync_byte','pat_error','cc_error','pmt_error','pid_error'] },
                    { p: 2, label: "P2 — Quality impairment", color: C.warn, enabled: etrP2Enabled, keys: ['transport_error','crc_error','pcr_disc','pcr_acc','pcr_rep','pts_error','cat_error'] },
                    { p: 3, label: "P3 — Informational", color: C.info, enabled: etrP3Enabled, keys: ['nit_error','sdt_error','eit_error','rst_error','tdt_error','empty_buf'] },
                  ].map(({ p, label, color, enabled, keys }) => (
                    <div key={p}>
                      <div style={{ fontSize: 8, color: enabled ? color : C.muted, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4, opacity: enabled ? 1 : 0.5 }}>
                        {label}{!enabled ? " — DISABLED" : ""}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 4, opacity: enabled ? 1 : 0.35 }}>
                        {ETR_CHECK_FIELDS.filter((c) => keys.includes(c.id)).map((c) => (
                          <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 52px", gap: 4, alignItems: "center", background: C.dim, border: `1px solid ${enabled ? C.border : C.dim}`, borderRadius: 2, padding: "3px 6px" }}>
                            <span style={{ fontSize: 8, color: C.muted }}>{c.label}</span>
                            <Input
                              value={thresholds[c.id] ?? String(RECOMMENDED_THRESHOLDS[c.id] || 1)}
                              onChange={(e) => setThresholds((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              mono
                              disabled={!enabled}
                              style={{ color: Number(thresholds[c.id]) === Number(RECOMMENDED_THRESHOLDS[c.id] || 1) ? C.muted : color }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <Field label="Profile name">
                      <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="sports-low-latency" />
                    </Field>
                    <Field label="Profile description">
                      <Input
                        value={profileDescription}
                        onChange={(e) => setProfileDescription(e.target.value)}
                        placeholder="P1 strict, only PCR/video PIDs"
                        style={{ color: profileDescription === "Broadcast baseline profile" ? C.muted : C.text }}
                      />
                    </Field>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={startEtrForSelected}
                      disabled={!selectedId || !selectedDecoderUrl || busy}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        border: `1px solid ${selectedId && selectedDecoderUrl && !busy ? C.info : C.border}`,
                        color: selectedId && selectedDecoderUrl && !busy ? C.info : C.muted,
                        background: selectedEtrExists ? `${C.info}10` : "transparent",
                        padding: "5px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: selectedId && selectedDecoderUrl && !busy ? "pointer" : "not-allowed",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {busy ? "WORKING…" : selectedEtrExists ? "Enable ETR (Apply)" : "Enable ETR"}
                    </button>
                    <button
                      onClick={stopEtrForSelected}
                      disabled={!selectedId || busy}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        border: `1px solid ${selectedId && !busy ? C.err : C.border}`,
                        color: selectedId && !busy ? C.err : C.muted,
                        background: "transparent",
                        padding: "5px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: selectedId && !busy ? "pointer" : "not-allowed",
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      {busy ? "WORKING…" : "Stop ETR"}
                    </button>
                  </div>

                  {etrActionNote && (
                    <div style={{ fontSize: 10, color: etrActionNote.type === "err" ? C.err : etrActionNote.type === "warn" ? C.warn : etrActionNote.type === "ok" ? C.ok : C.cyan }}>
                      {etrActionNote.text}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={saveCurrentProfile}
                      disabled={!profileName.trim()}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        border: `1px solid ${profileName.trim() ? C.ok : C.border}`,
                        color: profileName.trim() ? C.ok : C.muted,
                        background: "transparent",
                        padding: "5px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      Save profile
                    </button>
                    <button
                      onClick={deleteCurrentProfile}
                      disabled={!selectedProfileName}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        border: `1px solid ${selectedProfileName ? C.err : C.border}`,
                        color: selectedProfileName ? C.err : C.muted,
                        background: "transparent",
                        padding: "5px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      Delete profile
                    </button>
                  </div>
                </div>
              </PanelBox>

              {provisionSummary && (
                <div style={{ fontSize: 10, color: C.muted }}>
                  Started: <span style={{ color: C.ok }}>{provisionSummary.started.length}</span> · Failed:{" "}
                  <span style={{ color: C.err }}>{provisionSummary.failed.length}</span>
                  {provisionSummary.etrStarted?.length ? (
                    <>
                      {" "}· ETR: <span style={{ color: C.info }}>{provisionSummary.etrStarted.length}</span>
                    </>
                  ) : null}
                </div>
              )}
              {error && <div style={{ fontSize: 10, color: C.err }}>Decoder analyser error: {error}</div>}
              {etr.error && <div style={{ fontSize: 10, color: C.warn }}>ETR monitor warning: {etr.error}</div>}
            </div>
          </PanelBox>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
            {[
              { id: "quality", label: "Quality Dashboard", icon: "📊" },
              { id: "rtp", label: "RTP Header", icon: "🔬" },
              { id: "st20227", label: "SMPTE 2022-7", icon: "⚡" },
              { id: "iface", label: "Interfaces", icon: "🖧" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                style={{
                  flex: 1,
                  border: "none",
                  borderBottom: subTab === t.id ? `2px solid ${C.info}` : "2px solid transparent",
                  background: subTab === t.id ? C.panel : "transparent",
                  color: subTab === t.id ? C.info : C.muted,
                  padding: "8px 4px",
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {subTab === "quality" && (() => {
            // Extract video and audio streams from programs
            const allStreams = [
              ...((selectedResult?.programs || []).flatMap((p) => p.streams || [])),
              ...(selectedResult?.orphanStreams || []),
            ];
            const videoStream = allStreams.find((s) => s.codecType === "video");
            const audioStreams = allStreams.filter((s) => s.codecType === "audio");
            const firstAudio = audioStreams[0] || null;

            // Chroma subsampling label from pixFmt
            const chromaLabel = (pixFmt) => {
              if (!pixFmt) return "-";
              const f = String(pixFmt).toLowerCase();
              if (/444/.test(f)) return "4:4:4";
              if (/422/.test(f)) return "4:2:2";
              if (/420/.test(f)) return "4:2:0";
              if (/400/.test(f)) return "4:0:0";
              return pixFmt;
            };

            const scanLabel = (fieldOrder) => {
              if (!fieldOrder || fieldOrder === "progressive") return "Progressive";
              if (/interlac/i.test(fieldOrder)) return "Interlaced";
              if (/top/i.test(fieldOrder)) return "TFF";
              if (/bottom/i.test(fieldOrder)) return "BFF";
              return fieldOrder;
            };

            const bpsFmt = (bps) => {
              const n = Number(bps);
              if (!n) return "-";
              return n >= 1e6 ? `${(n / 1e6).toFixed(2)} Mbps` : `${(n / 1e3).toFixed(1)} kbps`;
            };

            const svc = selectedResult?.dvb?.services?.[0];
            const totalBitrate = selectedResult?.dvb?.bitrateBps || selectedResult?.dvb?.measuredBitrateBps;

            return (
              <>
                {/* ── Decoder Health strip ─────────────────────────────── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                  <StatBox label="Selected" value={selectedId || "-"} color={selectedId ? C.cyan : C.muted} />
                  <StatBox label="State" value={selectedId ? "RUNNING" : "IDLE"} color={selectedId ? C.ok : C.muted} />
                  <StatBox label="ETR Monitor" value={selectedEtrStatus ? "ATTACHED" : "OFF"} color={selectedEtrStatus ? C.ok : C.muted} />
                  <StatBox label="ST 2022-7" value={use20227 ? "ON" : "OFF"} color={use20227 ? C.s22 : C.muted} />
                  <StatBox label="Monitored" value={String(activeIds.length)} color={activeIds.length ? C.ok : C.muted} />
                </div>

                {/* ── Top row: ETR counters + thumbnail ───────────────── */}
                <div style={{ display: "grid", gridTemplateColumns: selectedResult?.thumbnailUrl ? "1fr 200px" : "1fr", gap: 8, alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                      <StatBox label="Packet Loss" value={m.packetLoss} color={m.packetLoss > 0 ? C.warn : C.ok} />
                      <StatBox label="Jitter" value={m.jitter} color={m.jitter > 0 ? C.warn : C.ok} />
                      <StatBox label="PCR Errors" value={m.pcrErrors} color={m.pcrErrors > 0 ? C.warn : C.ok} />
                      <StatBox label="CC Errors" value={m.ccErrors} color={m.ccErrors > 0 ? C.err : C.ok} />
                    </div>
                    {/* IAT / Network */}
                    {selectedResult?.dvb?.arrival && (() => {
                      const arr = selectedResult.dvb.arrival;
                      const iat = arr.iatMs || {};
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                          <StatBox label="IAT avg" value={iat.avg != null ? `${Number(iat.avg).toFixed(2)} ms` : "-"} color={Number(iat.avg) > 50 ? C.warn : C.ok} />
                          <StatBox label="IAT p95" value={iat.p95 != null ? `${Number(iat.p95).toFixed(2)} ms` : "-"} color={Number(iat.p95) > 150 ? C.err : C.ok} />
                          <StatBox label="Net Jitter" value={arr.jitterMs != null ? `${Number(arr.jitterMs).toFixed(2)} ms` : "-"} color={Number(arr.jitterMs) > 5 ? C.warn : C.ok} />
                          <StatBox label="Pkt Loss %" value={arr.packetLossPct != null ? `${Number(arr.packetLossPct).toFixed(3)}%` : "-"} color={Number(arr.packetLossPct) > 0.01 ? C.err : C.ok} />
                        </div>
                      );
                    })()}
                  </div>

                  {/* Live thumbnail */}
                  {selectedResult?.thumbnailUrl && (
                    <div style={{ background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ fontSize: 8, color: C.muted, padding: "4px 6px", borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: "0.08em" }}>Live Frame</div>
                      <img src={selectedResult.thumbnailUrl} alt="Stream frame" style={{ width: "100%", display: "block" }} onError={(e) => { e.target.parentElement.style.display = "none"; }} />
                      {svc?.serviceName && (
                        <div style={{ fontSize: 9, color: C.cyan, padding: "3px 6px", background: C.dim, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                          {svc.serviceName}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Stream Profile ───────────────────────────────────── */}
                <PanelBox>
                  <SectionHead icon="📡" title="Stream Profile" />
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Service / Transport */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                      <StatBox label="Service Name" value={svc?.serviceName || "-"} color={svc?.serviceName ? C.cyan : C.muted} />
                      <StatBox label="Provider" value={svc?.serviceProvider || "-"} color={C.text} />
                      <StatBox label="Total Bitrate" value={bpsFmt(totalBitrate)} color={totalBitrate ? C.ok : C.muted} />
                      <StatBox label="Services" value={String(selectedResult?.dvb?.serviceCount ?? selectedResult?.programs?.length ?? "-")} color={C.text} />
                    </div>

                    {/* Video profile */}
                    {videoStream && (
                      <div>
                        <div style={{ fontSize: 8, color: C.purple, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Video</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
                          <StatBox label="Codec" value={videoStream.codecName || "-"} color={C.purple} />
                          <StatBox
                            label="Resolution"
                            value={videoStream.width && videoStream.height ? `${videoStream.width}×${videoStream.height}` : "-"}
                            color={C.text}
                          />
                          <StatBox label="Frame Rate" value={videoStream.fps ? `${Number(videoStream.fps).toFixed(2)} fps` : "-"} color={C.text} />
                          <StatBox label="Scan" value={scanLabel(videoStream.fieldOrder)} color={C.text} />
                          <StatBox label="Chroma" value={chromaLabel(videoStream.pixFmt)} color={C.text} />
                          <StatBox label="Bitrate" value={bpsFmt(videoStream.bitrate)} color={C.text} />
                        </div>
                      </div>
                    )}

                    {/* Audio profile(s) */}
                    {audioStreams.length > 0 && (
                      <div>
                        <div style={{ fontSize: 8, color: C.info, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                          Audio ({audioStreams.length} track{audioStreams.length !== 1 ? "s" : ""})
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {audioStreams.slice(0, 4).map((s, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                              <StatBox label={`Track ${i + 1} Codec`} value={s.codecName || "-"} color={C.info} />
                              <StatBox label="Channels" value={s.channels ? `${s.channels}ch` : "-"} color={C.text} />
                              <StatBox label="Layout" value={s.channelLayout || (s.channels === 2 ? "stereo" : s.channels === 1 ? "mono" : "-")} color={C.text} />
                              <StatBox label="Sample Rate" value={s.sampleRate ? `${(Number(s.sampleRate) / 1000).toFixed(1)} kHz` : "-"} color={C.text} />
                              <StatBox label="Bitrate" value={bpsFmt(s.bitrate)} color={C.text} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {!selectedResult && (
                      <div style={{ color: C.muted, fontSize: 10 }}>No stream data yet. Start a decoder to see profile.</div>
                    )}
                  </div>
                </PanelBox>

                {/* ── PID Table ────────────────────────────────────────── */}
                <PanelBox>
                  <SectionHead icon="📋" title="PID Table" />
                  <div style={{ padding: "8px 12px", maxHeight: 200, overflowY: "auto" }}>
                    {pids.length === 0 ? (
                      <div style={{ color: C.muted, fontSize: 10 }}>No PID information available yet.</div>
                    ) : (
                      pids.map((p, idx) => (
                        <div key={`${p.pid || idx}-${idx}`} style={{ display: "grid", gridTemplateColumns: "90px 100px 1fr 90px", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                          {renderPidRef(p.pid, p.pidHex)}
                          <Badge label={p.codecType || "unknown"} color={p.codecType === "video" ? C.purple : p.codecType === "audio" ? C.info : C.muted} small />
                          <span style={{ color: C.text, fontSize: 10 }}>{p.codec}</span>
                          <span style={{ color: C.muted, fontSize: 9, textAlign: "right", fontFamily: "'Courier New',monospace" }}>{bpsFmt(p.bitrate)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </PanelBox>

                {/* ── Active Decoders ──────────────────────────────────── */}
                <PanelBox>
                  <SectionHead icon="📋" title="Active Decoders" right={<Badge label={`${activeIds.length} running`} color={activeIds.length ? C.ok : C.muted} small />} />
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {activeIds.length === 0 ? (
                      <div style={{ color: C.muted, fontSize: 10 }}>No active decoders yet.</div>
                    ) : (
                      activeIds.map((id) => (
                        <div key={id} style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 6 }}>
                          <button
                            onClick={() => setSelectedId(id)}
                            style={{
                              textAlign: "left", borderRadius: 2,
                              border: `1px solid ${selectedId === id ? C.cyan : C.border}`,
                              background: selectedId === id ? `${C.cyan}12` : "transparent",
                              color: selectedId === id ? C.cyan : C.text,
                              padding: "5px 8px", fontFamily: "'Courier New',monospace", fontSize: 10,
                            }}
                          >
                            {id}
                          </button>
                          <button
                            onClick={async () => {
                              try { await stop(id); } catch (_) {}
                              try { await refreshActives(); } catch (_) {}
                            }}
                            style={{
                              borderRadius: 2, border: `1px solid ${C.err}`, color: C.err,
                              background: "transparent", fontSize: 9, fontWeight: 700,
                              fontFamily: "'Courier New',monospace",
                            }}
                          >
                            STOP
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </PanelBox>
              </>
            );
          })()}

          {subTab === "rtp" && (
            <PanelBox>
              <SectionHead icon="🔬" title="RTP Header Inspector" right={<Badge label="LIVE" color={C.ok} small />} />
              <div style={{ padding: "10px 12px", fontFamily: "'Courier New',monospace", color: C.muted, fontSize: 10 }}>
                RTP details are available during active stream monitoring.
              </div>
            </PanelBox>
          )}

          {subTab === "st20227" && (
            <PanelBox>
              <SectionHead icon="⚡" title="SMPTE ST 2022-7 Path Selection" right={<Badge label={use20227 ? "ENABLED" : "DISABLED"} color={use20227 ? C.s22 : C.muted} small />} />
              <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <StatBox label="Mode" value={use20227 ? "Dual Path (A/B)" : "Single Path"} color={use20227 ? C.s22 : C.muted} />
                <StatBox label="Checked by probe" value={String(Boolean(selectedResult?.dvb?.smpte20227?.checked))} color={selectedResult?.dvb?.smpte20227?.checked ? C.ok : C.muted} />
                <StatBox label="2022-7 state" value={selectedResult?.dvb?.smpte20227?.state || "-"} color={selectedResult?.dvb?.smpte20227?.state === "ok" ? C.ok : selectedResult?.dvb?.smpte20227?.state ? C.warn : C.muted} />
                <StatBox label="Gap events" value={String(selectedResult?.dvb?.smpte20227?.metrics?.gapEvents ?? 0)} color={Number(selectedResult?.dvb?.smpte20227?.metrics?.gapEvents || 0) > 0 ? C.warn : C.ok} />
                <div style={{ gridColumn: "1 / -1", background: C.dim, border: `1px solid ${C.border}`, borderRadius: 2, padding: "6px 8px" }}>
                  <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Leg A URL</div>
                  <div style={{ fontFamily: "'Courier New',monospace", fontSize: 10, color: legAUrl ? C.cyan : C.muted }}>{legAUrl || "-"}</div>
                </div>
                <div style={{ gridColumn: "1 / -1", background: C.dim, border: `1px solid ${C.border}`, borderRadius: 2, padding: "6px 8px" }}>
                  <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Leg B URL</div>
                  <div style={{ fontFamily: "'Courier New',monospace", fontSize: 10, color: legBUrl ? C.s22 : C.muted }}>{legBUrl || "-"}</div>
                </div>
                <div style={{ gridColumn: "1 / -1", fontSize: 10, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 2, padding: "6px 8px", background: `${C.s22}08` }}>
                  {selectedResult?.dvb?.smpte20227?.reason || "Choose dual-path mode to track A/B leg evidence and consolidation notes."}
                  {use20227 && legBNic ? ` Leg B NIC: ${legBNic}.` : ""}
                </div>
              </div>
            </PanelBox>
          )}

          {subTab === "iface" && (
            <PanelBox>
              <SectionHead icon="🖧" title="Interfaces" />
              <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <StatBox label="Capture NIC" value={captureNic || "auto"} color={C.cyan} />
                <StatBox label="Active Decoders" value={activeIds.length} color={activeIds.length ? C.ok : C.muted} />
                <StatBox label="Latest IAT avg" value={latestForensic ? `${latestForensic.iatAvg.toFixed(3)} ms` : "-"} color={C.text} />
                <StatBox label="Latest Loss" value={latestForensic ? `${latestForensic.loss.toFixed(3)} %` : "-"} color={latestForensic && latestForensic.loss > 0 ? C.warn : C.ok} />
              </div>
            </PanelBox>
          )}
        </div>

      </div>
    </div>
  );
}
