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
const RECOMMENDED_THRESHOLDS = {
  ts_sync: 1,
  sync_byte: 1,
  pat_error: 1,
  cc_error: 1,
  pmt_error: 1,
  pid_error: 1,
  transport_error: 1,
  crc_error: 1,
  pcr_disc: 1,
  pcr_acc: 40,
  pcr_rep: 100,
  pts_error: 1,
  cat_error: 1,
  nit_error: 10,
  sdt_error: 1,
  eit_error: 1,
  rst_error: 100,
  tdt_error: 1,
  empty_buf: 1,
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
  (result?.structure?.streams || []).forEach((s) => push(s.pid));
  (result?.programs || []).forEach((p) => (p.streams || []).forEach((s) => push(s.pid)));
  (result?.orphanStreams || []).forEach((s) => push(s.pid));
  (result?.dvb?.services || []).forEach((svc) => {
    push(svc.pmtPid);
    push(svc.pcrPid);
    push(svc.videoPid);
  });
  return Array.from(pids).sort((a, b) => a - b);
}

function qualityMetrics(status) {
  const counts = status?.counts || {};
  return {
    packetLoss: (counts.ts_sync || 0) + (counts.transport_error || 0),
    jitter: (counts.pcr_acc || 0) + (counts.pcr_disc || 0),
    pcrErrors: (counts.pcr_acc || 0) + (counts.pcr_rep || 0) + (counts.pcr_disc || 0),
    ccErrors: counts.cc_error || 0,
  };
}

function extractPidRows(selectedResult) {
  const streams = selectedResult?.structure?.streams || [];
  return streams
    .map((s) => ({
      pid: s.pid,
      pidHex: s.pidHex,
      codecType: s.codecType || s.type || "unknown",
      codec: s.codec || s.description || "-",
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
  const etrConfig = useMemo(
    () => ({
      // PID scope is always auto-derived from analysed TS input.
      includePids: autoIncludePids,
      excludePids: [],
      allowUnknownPid,
      // Thresholds tune alarm triggering only, never measured values.
      thresholds: Object.fromEntries(
        Object.entries(thresholds)
          .map(([k, v]) => [k, parseInt(v, 10)])
          .filter(([, v]) => Number.isFinite(v) && v > 0)
      ),
    }),
    [autoIncludePids, allowUnknownPid, thresholds]
  );

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

  const m = qualityMetrics(selectedEtrStatus);
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
    await startRows(validRowPlans);
  };

  const startSingleDecoderRow = async (rowKey) => {
    const rowPlan = rowPlans.find((r) => r.key === rowKey && r.url);
    if (!rowPlan) return;
    await startRows([rowPlan]);
  };

  const stopDecoder = async () => {
    if (!selectedId) return;
    try {
      await stop(selectedId);
    } catch (_) {}
    try {
      await refreshActives();
    } catch (_) {}
  };

  const startEtrForSelected = async () => {
    if (!selectedId) {
      setEtrActionNote({ type: "warn", text: "Select a decoder first." });
      return;
    }
    if (selectedEtrExists) {
      await etr.updateConfig(selectedEtrMonitorId, etrConfig, selectedProfileName || null);
      await etr.refreshActives();
      setEtrActionNote({ type: "info", text: `ETR already running for ${selectedId}. Config updated.` });
      return;
    }
    if (!selectedDecoderUrl) {
      setEtrActionNote({ type: "warn", text: "Start decoder first so ETR can attach to a live URL." });
      return;
    }
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
    }
  };

  const stopEtrForSelected = async () => {
    if (!selectedId) {
      setEtrActionNote({ type: "warn", text: "Select a decoder first." });
      return;
    }
    if (!selectedEtrExists) {
      setEtrActionNote({ type: "info", text: `No ETR monitor is running for ${selectedId}.` });
      return;
    }
    await etr.stop(selectedEtrMonitorId);
    await etr.refreshActives();
    setEtrActionNote({ type: "ok", text: `ETR stopped for ${selectedId}.` });
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

      <div style={{ padding: 10, display: "grid", gridTemplateColumns: "560px 1fr 320px", gap: 10 }}>
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
                    <Input value={row.host} onChange={(e) => updateRow(row.key, { host: e.target.value })} placeholder="239.100.25.29" mono />
                  </Field>
                  <Field label="Port">
                    <Input
                      value={row.port}
                      onChange={(e) => updateRow(row.key, { port: e.target.value })}
                      placeholder={RECOMMENDED_DECODER_PORT}
                      mono
                      style={{ color: row.port === RECOMMENDED_DECODER_PORT ? C.muted : C.text }}
                    />
                  </Field>
                  <Field label="Decoder ID (optional)">
                    <Input value={row.decoderId} onChange={(e) => updateRow(row.key, { decoderId: e.target.value })} placeholder="decoder-a" mono />
                  </Field>
                  <button
                    onClick={() => startSingleDecoderRow(row.key)}
                    disabled={!row.host || !row.port}
                    style={{
                      height: 34,
                      borderRadius: 2,
                      border: `1px solid ${row.host && row.port ? C.ok : C.border}`,
                      color: row.host && row.port ? C.bg : C.muted,
                      background: row.host && row.port ? C.ok : "transparent",
                      boxShadow: row.host && row.port ? `0 0 8px ${C.ok}44` : "none",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: row.host && row.port ? "pointer" : "not-allowed",
                    }}
                  >
                    Start
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
                  disabled={!validRowPlans.length}
                  style={{
                    borderRadius: 2,
                    border: `1px solid ${validRowPlans.length ? C.ok : C.border}`,
                    color: validRowPlans.length ? C.bg : C.muted,
                    background: validRowPlans.length ? C.ok : "transparent",
                    padding: "6px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: validRowPlans.length ? "pointer" : "not-allowed",
                    boxShadow: validRowPlans.length ? `0 0 10px ${C.ok}55` : "none",
                  }}
                >
                  ▶ START BATCH
                </button>
                <button
                  onClick={stopDecoder}
                  disabled={!selectedId}
                  style={{
                    borderRadius: 2,
                    border: `1px solid ${selectedId ? C.err : C.border}`,
                    color: selectedId ? C.err : C.muted,
                    background: "transparent",
                    padding: "6px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: selectedId ? "pointer" : "not-allowed",
                  }}
                >
                  ■ STOP DECODER
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

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <Field label="Input PIDs (auto-derived)">
                      <Input
                        value={autoIncludePidsText}
                        onChange={() => {}}
                        readOnly
                        placeholder="Awaiting TS input..."
                        mono
                        style={{ color: C.muted }}
                      />
                    </Field>
                    <Field label="Excluded PIDs">
                      <Input
                        value="None (automatic mode)"
                        onChange={() => {}}
                        readOnly
                        placeholder="None"
                        mono
                        style={{ color: C.muted }}
                      />
                    </Field>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, color: allowUnknownPid ? C.ok : C.warn, fontSize: 10 }}>
                    <input type="checkbox" checked={allowUnknownPid} onChange={(e) => setAllowUnknownPid(e.target.checked)} style={{ accentColor: C.ok }} />
                    Allow alarms without PID evidence
                  </label>
                  <div style={{ fontSize: 9, color: C.muted }}>
                    ETR tuning changes alarm trigger thresholds only; measured TS/PID values remain untouched.
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
                    {ETR_CHECK_FIELDS.map((c) => (
                      <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 60px", gap: 5, alignItems: "center", background: C.dim, border: `1px solid ${C.border}`, borderRadius: 2, padding: "4px 6px" }}>
                        <span style={{ fontSize: 9, color: C.muted }}>{c.label}</span>
                        <Input
                          value={thresholds[c.id]}
                          onChange={(e) => setThresholds((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          mono
                          style={{ color: Number(thresholds[c.id]) === Number(RECOMMENDED_THRESHOLDS[c.id] || 1) ? C.muted : C.text }}
                        />
                      </div>
                    ))}
                  </div>

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
                      disabled={!selectedId || !selectedDecoderUrl}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        border: `1px solid ${selectedId && selectedDecoderUrl ? C.info : C.border}`,
                        color: selectedId && selectedDecoderUrl ? C.info : C.muted,
                        background: selectedEtrExists ? `${C.info}10` : "transparent",
                        padding: "5px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: selectedId && selectedDecoderUrl ? "pointer" : "not-allowed",
                      }}
                    >
                      {selectedEtrExists ? "Enable ETR (Apply)" : "Enable ETR"}
                    </button>
                    <button
                      onClick={stopEtrForSelected}
                      disabled={!selectedId}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        border: `1px solid ${selectedId ? C.err : C.border}`,
                        color: selectedId ? C.err : C.muted,
                        background: "transparent",
                        padding: "5px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: selectedId ? "pointer" : "not-allowed",
                      }}
                    >
                      Stop ETR
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

          {subTab === "quality" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                <StatBox label="Packet Loss" value={m.packetLoss} color={m.packetLoss > 0 ? C.warn : C.ok} />
                <StatBox label="Jitter" value={m.jitter} color={m.jitter > 0 ? C.warn : C.ok} />
                <StatBox label="PCR Errors" value={m.pcrErrors} color={m.pcrErrors > 0 ? C.warn : C.ok} />
                <StatBox label="CC Errors" value={m.ccErrors} color={m.ccErrors > 0 ? C.err : C.ok} />
              </div>

              <PanelBox>
                <SectionHead icon="📋" title="PID Table" />
                <div style={{ padding: "8px 12px", maxHeight: 260, overflowY: "auto" }}>
                  {pids.length === 0 ? (
                    <div style={{ color: C.muted, fontSize: 10 }}>No PID information available yet.</div>
                  ) : (
                    pids.map((p, idx) => (
                      <div key={`${p.pid || idx}-${idx}`} style={{ display: "grid", gridTemplateColumns: "90px 100px 1fr", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                        {renderPidRef(p.pid, p.pidHex)}
                        <Badge label={p.codecType || "unknown"} color={p.codecType === "video" ? C.purple : p.codecType === "audio" ? C.info : C.muted} small />
                        <span style={{ color: C.text, fontSize: 10 }}>{p.codec}</span>
                      </div>
                    ))
                  )}
                </div>
              </PanelBox>
            </>
          )}

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

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PanelBox>
            <SectionHead icon="❤" title="Decoder Health" />
            <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { l: "Selected", v: selectedId || "-", c: selectedId ? C.cyan : C.muted },
                { l: "State", v: selectedId ? "RUNNING" : "IDLE", c: selectedId ? C.ok : C.muted },
                { l: "ETR Monitor", v: selectedEtrStatus ? "ATTACHED" : "OFF", c: selectedEtrStatus ? C.ok : C.muted },
                { l: "ST 2022-7", v: use20227 ? "ENABLED" : "OFF", c: use20227 ? C.s22 : C.muted },
                { l: "Monitored IDs", v: String(activeIds.length), c: C.text },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{s.l}</span>
                  <span style={{ fontFamily: "'Courier New',monospace", fontSize: 10, fontWeight: 700, color: s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          </PanelBox>

          <PanelBox>
            <SectionHead icon="📋" title="Active Decoders" />
            <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
              {activeIds.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 10 }}>No active decoders yet.</div>
              ) : (
                activeIds.map((id) => (
                  <div key={id} style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 6 }}>
                    <button
                      onClick={() => setSelectedId(id)}
                      style={{
                        textAlign: "left",
                        borderRadius: 2,
                        border: `1px solid ${selectedId === id ? C.cyan : C.border}`,
                        background: selectedId === id ? `${C.cyan}12` : "transparent",
                        color: selectedId === id ? C.cyan : C.text,
                        padding: "5px 8px",
                        fontFamily: "'Courier New',monospace",
                        fontSize: 10,
                      }}
                    >
                      {id}
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await stop(id);
                        } catch (_) {}
                        try {
                          await refreshActives();
                        } catch (_) {}
                      }}
                      style={{
                        borderRadius: 2,
                        border: `1px solid ${C.err}`,
                        color: C.err,
                        background: "transparent",
                        fontSize: 9,
                        fontWeight: 700,
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
        </div>
      </div>
    </div>
  );
}
