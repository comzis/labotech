import React, { useEffect, useMemo, useState } from "react";
import useTSAnalysis from "../hooks/useTSAnalysis";
import useETR290 from "../hooks/useETR290";
import { Badge, C, Dot, Field, Input, PanelBox, SectionHead, Select } from "./BroadcastUI";
import { resolveTransportBitrate } from "../utils/transportBitrate";
import { getAnalyser, getMonitoringPolicy, setMonitoringProfile } from "../api";
import { toast } from "sonner";

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
const BATCH_START_CONCURRENCY = 4;

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
    port: "",
    decoderId: "",
  };
}

function normalizeLaneId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return "unknown";
  return id.replace(/^etr[-_:]/i, "") || id;
}

function buildProbeUrl({ mode, host, port, latency, passphrase, pbkeylen }) {
  if (!host || !port) return "";
  if (mode === "udp") return `udp://${host}:${port}`;
  if (mode === "rtp") return `rtp://${host}:${port}`;
  let url = `srt://${host}:${port}`;
  const params = ["mode=caller", "stats=1", "statsintvl=1"];
  if (latency) params.push(`latency=${latency}`);
  if (passphrase) {
    params.push(`passphrase=${encodeURIComponent(passphrase)}`);
    params.push(`pbkeylen=${pbkeylen || 16}`);
  }
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

const PID_TYPE_ORDER = { video: 0, audio: 1, data: 2, subtitle: 3, unknown: 9 };

// Specificity score for codecType: video > audio > subtitle > data > unknown.
// tsduck PID rows often have codecType null/'data' fallback while ffprobe correctly
// identifies the same PID as 'video'/'audio'. Higher score wins when deduplicating
// the same PID from multiple probe sources.
function codecTypeScore(t) {
  if (t === "video")    return 4;
  if (t === "audio")    return 3;
  if (t === "subtitle") return 2;
  if (t === "data")     return 1;
  return 0; // "unknown" or anything else
}

// Vertical audio VU bar for Confidence Monitor (3 px wide, bottom-up fill, −60→0 dBFS)
function DecoderVuBar({ rmsDb, peakDb }) {
  const active = rmsDb != null && Number.isFinite(rmsDb);
  const clampRms = active ? Math.max(-60, Math.min(0, rmsDb)) : -60;
  const rmsH = active ? ((clampRms + 60) / 60) * 100 : 0;
  const peakH =
    peakDb != null && Number.isFinite(peakDb)
      ? Math.min(99, Math.max(0, ((Math.max(-60, Math.min(0, peakDb)) + 60) / 60) * 100))
      : null;
  const rmsColor = !active
    ? "#0c0c0c"
    : rmsDb > -9
    ? "#cc1020"
    : rmsDb > -18
    ? "#b87800"
    : "#007a28";
  const peakColor =
    (peakDb ?? -60) > -9 ? "#cc1020" : (peakDb ?? -60) > -18 ? "#b87800" : "#007a28";
  return (
    <div style={{ width: 3, flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, position: "relative", background: "#060606", overflow: "hidden" }}>
        {/* −18 dBFS tick (50% mark) */}
        <div style={{ position: "absolute", bottom: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.07)" }} />
        {/* −9 dBFS tick (85% mark) */}
        <div style={{ position: "absolute", bottom: "85%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.07)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${rmsH}%`, background: rmsColor, transition: "height 0.1s linear" }} />
        {peakH != null && active && (
          <div style={{ position: "absolute", bottom: `${peakH}%`, left: 0, right: 0, height: 1, background: peakColor }} />
        )}
      </div>
    </div>
  );
}

function preferredPidRow(a, b) {
  // Prefer the more specific codec type — ffprobe over tsduck/fallback.
  const ctA = codecTypeScore(a.codecType);
  const ctB = codecTypeScore(b.codecType);
  if (ctA !== ctB) return ctA > ctB ? a : b;

  // Prefer entries with a named codec string.
  const hasCodecA = a.codec && a.codec !== "-" ? 1 : 0;
  const hasCodecB = b.codec && b.codec !== "-" ? 1 : 0;
  if (hasCodecA !== hasCodecB) return hasCodecA > hasCodecB ? a : b;

  // Deterministic tie-breaker — avoid bitrate: it is volatile across probe cycles.
  const codecA = String(a.codec || "").toLowerCase();
  const codecB = String(b.codec || "").toLowerCase();
  if (codecA !== codecB) return codecA.localeCompare(codecB) <= 0 ? a : b;

  const hexA = String(a.pidHex || "").toUpperCase();
  const hexB = String(b.pidHex || "").toUpperCase();
  if (hexA !== hexB) return hexA.localeCompare(hexB) <= 0 ? a : b;

  return a;
}

function extractPidRows(selectedResult) {
  const rows = [];
  (selectedResult?.programs || []).forEach((p) => (p.streams || []).forEach((s) => rows.push(s)));
  (selectedResult?.orphanStreams || []).forEach((s) => rows.push(s));
  const normalized = rows.map((s, i) => ({
    pid: s.pid != null && Number.isFinite(Number(s.pid)) ? Number(s.pid) : null,
    pidHex: s.pidHex,
    codecType: s.codecType || s.type || "unknown",
    codec: s.codecName || s.codec || s.description || "-",
    bitrate: Number(s.bitrate || 0),
    _idx: i, // used only as tiebreaker for PID-less entries
  }));

  // If any stream of a given codecType has a valid PID, suppress null-PID rows
  // of that same type — they are ghosts (ffprobe sometimes emits the same
  // elementary stream twice: once in the program list with a PID and once in
  // the global stream list without one).
  const typesWithRealPid = new Set(normalized.filter((r) => r.pid != null).map((r) => r.codecType));
  const filtered = normalized.filter((r) => r.pid != null || !typesWithRealPid.has(r.codecType));

  // Deduplicate by PID only — not by pid+codecType.
  // The same physical PID can arrive from multiple probe sources (ffprobe program
  // streams, tsduck orphans, fallback rows) with different or missing codecType.
  // Keying by pid+codecType kept both, causing the same PID to appear twice and
  // rotate positions as heavy/light probe cycles alternated.
  const byPid = new Map();
  filtered.forEach((row) => {
    const pidKey = row.pid != null
      ? String(row.pid)
      : (row.pidHex ? String(row.pidHex).toUpperCase()
        // PID-less entries: use index so multiple null-PID streams don't collapse.
        : `unknown-${row._idx}`);
    const prev = byPid.get(pidKey);
    byPid.set(pidKey, prev ? preferredPidRow(prev, row) : row);
  });

  return Array.from(byPid.values())
    .sort((a, b) => {
      const ta = PID_TYPE_ORDER[a.codecType] ?? 9;
      const tb = PID_TYPE_ORDER[b.codecType] ?? 9;
      if (ta !== tb) return ta - tb;
      return (Number(a.pid) || 0) - (Number(b.pid) || 0);
    })
    .map((row) => {
      const pidKey = row.pid != null
        ? String(row.pid)
        : (row.pidHex ? String(row.pidHex).toUpperCase() : `unknown-${row._idx}`);
      return { ...row, rowKey: pidKey };
    })
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

function makeMultiviewDecoderId({ requestedId, use20227, usedSet }) {
  const base = use20227 ? "2022-7-consolidated" : requestedId;
  return makeUniqueDecoderId(base, usedSet);
}

function renderPidRef(pid, pidHex) {
  const hasDec = pid != null && Number.isFinite(Number(pid));
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

function PolicyChip({ policyProfile, profileMeta, policyData, policyPickerOpen, setPolicyPickerOpen, policyBusy, onSelectProfile }) {
  const label = profileMeta?.label || String(policyProfile).toUpperCase();
  const standard = profileMeta?.standard || "";
  const description = profileMeta?.description || "";
  const profiles = policyData?.profiles || [];
  const tooltipText = [standard, description].filter(Boolean).join(" — ");

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          background: C.dim,
          border: `1px solid ${policyPickerOpen ? C.info : C.border}`,
          borderRadius: 2,
          padding: "4px 8px",
          cursor: "pointer",
          userSelect: "none",
        }}
        title={tooltipText || undefined}
        onClick={() => !policyBusy && setPolicyPickerOpen((v) => !v)}
      >
        <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Policy</div>
        <div style={{ fontFamily: "'Courier New',monospace", fontSize: 11, color: policyProfile !== "-" ? C.info : C.muted, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
          {label}
          <span style={{ fontSize: 8, color: C.muted, fontWeight: 400 }}>▾</span>
        </div>
        {standard && (
          <div style={{ fontSize: 7, color: C.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{standard}</div>
        )}
      </div>

      {policyPickerOpen && profiles.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 200,
            background: "#0d1220",
            border: `1px solid ${C.info}`,
            borderRadius: 3,
            minWidth: 280,
            boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: 8, color: C.muted, padding: "4px 8px", borderBottom: `1px solid ${C.border}`, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Monitoring Policy
          </div>
          {profiles.map((p) => (
            <div
              key={p.id}
              style={{
                padding: "6px 10px",
                cursor: policyBusy ? "wait" : "pointer",
                borderBottom: `1px solid ${C.border}`,
                background: p.active ? "rgba(56,189,248,0.08)" : "transparent",
              }}
              onClick={() => !policyBusy && onSelectProfile(p.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ fontFamily: "'Courier New',monospace", fontSize: 10, color: p.active ? C.info : C.text, fontWeight: 700 }}>{p.label}</div>
                {p.active && <div style={{ fontSize: 7, color: C.info, background: "rgba(56,189,248,0.15)", borderRadius: 2, padding: "0 4px" }}>ACTIVE</div>}
              </div>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 1 }}>{p.standard}</div>
              <div style={{ fontSize: 8, color: C.muted, marginTop: 1, opacity: 0.75 }}>{p.description}</div>
            </div>
          ))}
          <div
            style={{ padding: "4px 8px", fontSize: 8, color: C.muted, cursor: "pointer", textAlign: "right" }}
            onClick={() => setPolicyPickerOpen(false)}
          >
            Close
          </div>
        </div>
      )}
    </div>
  );
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeWindowAveragedBps(samples, windowMs = 10000) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const endTs = Number(samples[samples.length - 1]?.ts);
  if (!Number.isFinite(endTs)) return null;
  const values = samples
    .filter((s) => Number.isFinite(Number(s?.ts)) && (endTs - Number(s.ts)) <= windowMs)
    .map((s) => Number(s?.tsRateBps))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  // Robust average: trim extremes to avoid single-sample probe spikes.
  if (values.length >= 5) {
    const trim = Math.max(1, Math.floor(values.length * 0.1));
    const core = values.slice(trim, values.length - trim);
    if (core.length > 0) {
      const sum = core.reduce((acc, v) => acc + v, 0);
      return sum / core.length;
    }
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function dominantRateSource(samples, windowMs = 10000) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const endTs = Number(samples[samples.length - 1]?.ts);
  if (!Number.isFinite(endTs)) return null;
  const counts = new Map();
  samples
    .filter((s) => Number.isFinite(Number(s?.ts)) && (endTs - Number(s.ts)) <= windowMs)
    .forEach((s) => {
      const src = String(s?.tsRateSource || "").toLowerCase();
      if (!src) return;
      counts.set(src, (counts.get(src) || 0) + 1);
    });
  let best = null;
  let bestCount = -1;
  for (const [src, count] of counts.entries()) {
    if (count > bestCount) {
      best = src;
      bestCount = count;
    }
  }
  return best;
}

function pickPreferredVideoStream(streams) {
  const videos = (streams || []).filter((s) => String(s?.codecType || "").toLowerCase() === "video");
  if (!videos.length) return null;
  const score = (s) => {
    let points = 0;
    if (toFiniteNumber(s?.bitrate) != null && Number(s.bitrate) > 0) points += 4;
    if (s?.scanType || s?.fieldOrder) points += 3;
    if (toFiniteNumber(s?.width) != null && toFiniteNumber(s?.height) != null) points += 2;
    if (toFiniteNumber(s?.fps) != null) points += 1;
    return points;
  };
  return videos
    .slice()
    .sort((a, b) => {
      const scoreDiff = score(b) - score(a);
      if (scoreDiff !== 0) return scoreDiff;
      // Prefer streams with a valid PID; null PID sorts last (not first).
      const pidA = a?.pid != null && Number.isFinite(Number(a.pid)) ? Number(a.pid) : Number.POSITIVE_INFINITY;
      const pidB = b?.pid != null && Number.isFinite(Number(b.pid)) ? Number(b.pid) : Number.POSITIVE_INFINITY;
      if (pidA !== pidB) return pidA - pidB;
      return String(a?.codecName || "").localeCompare(String(b?.codecName || ""));
    })[0];
}

export default function DecoderPanel({ lastMessage, selectedDecoderRequest }) {
  const [mode, setMode] = useState("rtp");
  const [decoderRows, setDecoderRows] = useState([newDecoderRow()]);
  const [latency, setLatency] = useState("2000");
  const [passphrase, setPassphrase] = useState("");
  const [pbkeylen, setPbkeylen] = useState(16);
  const [intervalMs, setIntervalMs] = useState(5000);
  const [addToMultiview, setAddToMultiview] = useState(true);
  const [captureNic, setCaptureNic] = useState("");
  const [use20227, setUse20227] = useState(false);
  const [legBHost, setLegBHost] = useState("");
  const [legBPort, setLegBPort] = useState("");
  const [legBNic, setLegBNic] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [provisionSummary, setProvisionSummary] = useState(null);
  const [forensicById, setForensicById] = useState({});
  const [tsRateById, setTsRateById] = useState({});
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
  const [policyData, setPolicyData] = useState(null);
  const [policyPickerOpen, setPolicyPickerOpen] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [selectedPickerOpen, setSelectedPickerOpen] = useState(false);

  const {
    result,
    error,
    activeIds,
    resultsById,
    decoderMeta,
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
    getMonitoringPolicy().then(setPolicyData).catch(() => {});
  }, []);

  const handleSelectProfile = (profileId) => {
    setPolicyBusy(true);
    setMonitoringProfile(profileId)
      .then(() => getMonitoringPolicy())
      .then((data) => {
        setPolicyData(data);
        setPolicyPickerOpen(false);
        toast.success(`Policy set to ${data?.current?.profileMeta?.label || profileId}`);
      })
      .catch((err) => {
        toast.error(`Policy change failed: ${err?.message || 'server error'}`);
      })
      .finally(() => setPolicyBusy(false));
  };

  useEffect(() => {
    if (!lastMessage) return;
    onWsResult(lastMessage);
    etr.onWsMessage(lastMessage);

    if (lastMessage.type === "analyse_result" && lastMessage.id) {
      const decoderId = normalizeLaneId(lastMessage.id);
      const arrival = lastMessage?.dvb?.arrival || {};
      const iat = arrival?.iatMs || {};
      const transportRate = resolveTransportBitrate(lastMessage);
      const sample = {
        ts: lastMessage.time ? new Date(lastMessage.time).getTime() : Date.now(),
        iatMin: Number(iat.min) || 0,
        iatAvg: Number(iat.avg) || 0,
        iatP95: Number(iat.p95) || 0,
        jitter: Number(arrival.jitterMs) || 0,
        loss: Number(arrival.packetLossPct) || 0,
        tsRateBps: Number.isFinite(transportRate.bps) && transportRate.bps > 0 ? transportRate.bps : 0,
        tsRateSource: transportRate.source || null,
      };
      setForensicById((prev) => ({
        ...prev,
        [decoderId]: [...(prev[decoderId] || []), sample].slice(-120),
      }));
      setTsRateById((prev) => ({
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
          pbkeylen,
        }),
      })),
    [decoderRows, mode, latency, passphrase, pbkeylen]
  );

  const validRowPlans = rowPlans.filter((r) => r.url);
  const legAUrl = validRowPlans[0]?.url || "";
  const legBUrl = buildProbeUrl({
    mode,
    host: legBHost,
    port: legBPort,
    latency,
    passphrase,
    pbkeylen,
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
    const fromMeta = decoderMeta?.[selectedId]?.url;
    if (fromMeta) return fromMeta;
    const fromRow = rowPlans.find((r) => r.decoderId?.trim() === selectedId)?.url;
    return fromRow || "";
  }, [selectedId, resultsById, selectedResult, decoderMeta, rowPlans]);
  const startBatchHint = busy
    ? "Decoder operation in progress..."
    : validRowPlans.length === 0
      ? "Fill at least one valid Host/IP + Port row to enable batch start."
      : "";
  const stopDecoderHint = busy
    ? "Decoder operation in progress..."
    : !selectedId
      ? "Select a running decoder to stop."
      : "";
  const enableEtrHint = busy
    ? "Decoder operation in progress..."
    : !selectedId
      ? "Select a decoder first."
      : !selectedDecoderUrl
        ? "Decoder URL is still syncing. You can press Enable ETR and it will retry API resolution."
        : "";
  const applyEtrHint = busy
    ? "Decoder operation in progress..."
    : !selectedId
      ? "Select a decoder first."
      : !selectedEtrExists
        ? "Enable ETR first, then apply config."
        : "";

  const m = qualityMetrics(selectedEtrStatus, selectedResult);
  const pids = extractPidRows(selectedResult);
  const forensic = forensicById[selectedId] || [];
  const latestForensic = forensic.length ? forensic[forensic.length - 1] : null;
  const tsRateSeries = tsRateById[selectedId] || [];
  const latestTsRate = tsRateSeries.length ? tsRateSeries[tsRateSeries.length - 1] : null;

  const updateRow = (rowKey, patch) => {
    setDecoderRows((rows) => rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)));
  };

  // Smart-paste: if the user pastes an srt:// URI into the Host/IP field,
  // extract host, port, passphrase, latency, and pbkeylen automatically.
  const handleHostPaste = (rowKey, e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!text.startsWith('srt://')) return; // let normal paste proceed
    e.preventDefault();
    try {
      // srt://host:port?param=value…
      const withoutScheme = text.slice('srt://'.length);
      const [hostPort, query = ''] = withoutScheme.split('?');
      const lastColon = hostPort.lastIndexOf(':');
      const host = lastColon >= 0 ? hostPort.slice(0, lastColon) : hostPort;
      const port = lastColon >= 0 ? hostPort.slice(lastColon + 1) : '';
      const params = new URLSearchParams(query);
      updateRow(rowKey, { host: host.trim(), port: port.trim() });
      setMode('srt');
      if (params.get('passphrase')) setPassphrase(decodeURIComponent(params.get('passphrase')));
      if (params.get('pbkeylen'))   setPbkeylen(Number(params.get('pbkeylen')));
      if (params.get('tsbpddelay')) setLatency(params.get('tsbpddelay'));
    } catch (_) {
      // malformed URI — fall back to default paste
    }
  };

  const addDecoderRow = () => setDecoderRows((rows) => [...rows, newDecoderRow()]);
  const removeDecoderRow = (rowKey) => {
    setDecoderRows((rows) => {
      if (rows.length <= 1) {
        // Keep one provisioning row available at all times; clear instead of removing.
        return rows.map((r) => (r.key === rowKey ? { ...r, host: "", port: "", decoderId: "" } : r));
      }
      return rows.filter((r) => r.key !== rowKey);
    });
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
    const planned = plansToStart.map((row) => {
      const requestedId = row.decoderId?.trim() || `decoder-${runStamp}`;
      const id = makeMultiviewDecoderId({ requestedId, use20227: use20227 && addToMultiview, usedSet: usedIds });
      return { row, id };
    });

    const startOne = async ({ row, id }) => {
      try {
        if (addToMultiview) {
          await startContinuous(id, row.url, parseInt(intervalMs, 10) || 5000, captureNic || undefined);
        } else {
          await probe(row.url);
        }
      } catch (err) {
        return { id, started: false, error: err?.message || "Provision failed" };
      }

      if (!enableEtrOnProvision) {
        return { id, started: true, etrStarted: false, etrError: null };
      }

      try {
        await etr.start(`etr-${id}`, row.url, captureNic || undefined, {
          profileName: selectedProfileName || undefined,
          config: etrConfig,
        });
        return { id, started: true, etrStarted: true, etrError: null };
      } catch (etrErr) {
        return {
          id,
          started: true,
          etrStarted: false,
          etrError: `ETR attach warning: ${etrErr?.message || "failed"}`,
        };
      }
    };

    for (let i = 0; i < planned.length; i += BATCH_START_CONCURRENCY) {
      const batch = planned.slice(i, i + BATCH_START_CONCURRENCY);
      // Bounded parallel startup to improve bring-up time without overwhelming host IO/process table.
      const results = await Promise.all(batch.map(startOne));
      results.forEach((r) => {
        if (!r.started) {
          failed.push({ id: r.id, message: r.error || "Provision failed" });
          return;
        }
        started.push(r.id);
        if (r.etrStarted) etrStarted.push(r.id);
        if (r.etrError) etrFailed.push({ id: r.id, message: r.etrError });
      });
      // Small inter-batch gap smooths ffprobe/thumbnail burst pressure.
      if (i + BATCH_START_CONCURRENCY < planned.length) {
        await new Promise((resolve) => setTimeout(resolve, 180));
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
    setBusy(true);
    try {
      let attachUrl = selectedDecoderUrl;
      if (!attachUrl) {
        // Running analysers can exist before first analyse_result websocket payload.
        // Resolve URL from API directly so ETR enable action is not blocked by UI timing.
        try {
          const analyser = await getAnalyser(selectedId);
          attachUrl = analyser?.url || "";
        } catch (_) {
          attachUrl = "";
        }
      }
      if (!attachUrl) {
        setEtrActionNote({ type: "warn", text: "Decoder URL not available yet. Keep decoder running and retry Enable ETR." });
        return;
      }
      await etr.start(selectedEtrMonitorId, attachUrl, captureNic || undefined, {
        profileName: selectedProfileName || undefined,
        config: etrConfig,
      });
      await etr.refreshActives();
      setEtrActionNote({ type: "ok", text: `ETR enabled for ${selectedId}.` });
    } catch (err) {
      const msg = err?.message || "Failed to start ETR monitor.";
      if (String(msg).toLowerCase().includes("already exists")) {
        try {
          await etr.updateConfig(selectedEtrMonitorId, etrConfig, selectedProfileName || null);
          await etr.refreshActives();
          setEtrActionNote({ type: "info", text: `ETR already existed for ${selectedId}. Config updated.` });
          return;
        } catch (cfgErr) {
          setEtrActionNote({ type: "err", text: cfgErr?.message || "ETR exists but config update failed." });
          return;
        }
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
      let stopped = false;
      const candidates = [selectedEtrMonitorId, selectedId].filter(Boolean);
      for (const id of candidates) {
        try {
          await etr.stop(id);
          stopped = true;
          break;
        } catch (_) {
          // try next id form for compatibility with older monitor naming
        }
      }
      if (!stopped) {
        throw new Error("Unable to stop ETR monitor (id mismatch or monitor not found).");
      }
      await etr.refreshActives();
      setEtrActionNote({ type: "ok", text: `ETR stopped for ${selectedId}.` });
    } catch (err) {
      setEtrActionNote({ type: "err", text: err?.message || "Failed to stop ETR monitor." });
      try { await etr.refreshActives(); } catch (_) {}
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
    <div style={{ fontFamily: "'Courier New',monospace", background: C.bg, color: C.text, minHeight: "100vh" }}>
      <div style={{ padding: "8px 10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Dot c={C.cyan} />
          <span style={{ fontSize: 10, color: C.head, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>Decoder Operations</span>
        </div>
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
                  <Field label="Host / IP — paste srt:// URI to auto-fill">
                    <Input
                      value={row.host}
                      onChange={(e) => updateRow(row.key, { host: e.target.value })}
                      onPaste={(e) => handleHostPaste(row.key, e)}
                      placeholder="Host / IP  or paste srt:// URI"
                      mono
                      style={{ color: row.host ? C.text : C.head }}
                    />
                  </Field>
                  <Field label="Port">
                    <Input
                      value={row.port}
                      onChange={(e) => updateRow(row.key, { port: e.target.value })}
                      placeholder="Port"
                      mono
                      style={{ color: row.port ? C.text : C.head }}
                    />
                  </Field>
                  <Field label="Decoder ID (optional)">
                    <Input value={row.decoderId} onChange={(e) => updateRow(row.key, { decoderId: e.target.value })} placeholder="decoder-a" mono style={{ color: row.decoderId ? C.text : C.head }} />
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
                    disabled={busy}
                    style={{
                      height: 34,
                      borderRadius: 2,
                      border: `1px solid ${decoderRows.length <= 1 ? "#ff7a86" : C.err}`,
                      color: decoderRows.length <= 1 ? "#ff7a86" : C.err,
                      background: "transparent",
                      fontSize: 10,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.5 : 1,
                    }}
                    title={decoderRows.length <= 1 ? "Clears this provisioning row (running decoders are stopped via STOP)." : "Removes this provisioning row."}
                  >
                    {decoderRows.length <= 1 ? "Clear" : "Remove"}
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
                  {busy ? "STARTING…" : use20227 ? "▶ START 2022-7 (A+B)" : "▶ START BATCH"}
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
              {(startBatchHint || stopDecoderHint) && (
                <div style={{ display: "grid", gap: 2, fontSize: 9, color: C.muted }}>
                  {startBatchHint ? <div>{startBatchHint}</div> : null}
                  {stopDecoderHint ? <div>{stopDecoderHint}</div> : null}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Capture NIC (optional)">
                  <Input value={captureNic} onChange={(e) => setCaptureNic(e.target.value)} placeholder={mode === "srt" ? "eno1 (SRT / management)" : "eno2 (multicast)"} mono />
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 10 }}>
                  <Field label="Latency (ms)">
                    <Input value={latency} onChange={(e) => setLatency(e.target.value)} mono />
                  </Field>
                  <Field label="Passphrase (AES key)">
                    <Input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  </Field>
                  <Field label="Key len">
                    <select
                      value={pbkeylen}
                      onChange={(e) => setPbkeylen(Number(e.target.value))}
                      style={{ width: "100%", height: 30, background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 2, fontSize: 10, padding: "0 4px" }}
                      title="AES key length: 16=AES-128, 24=AES-192, 32=AES-256"
                    >
                      <option value={16}>128</option>
                      <option value={24}>192</option>
                      <option value={32}>256</option>
                    </select>
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
                    <Input value={legBHost} onChange={(e) => setLegBHost(e.target.value)} placeholder="Host / IP B" mono />
                  </Field>
                  <Field label="Leg B Port">
                    <Input value={legBPort} onChange={(e) => setLegBPort(e.target.value)} placeholder="Port B" mono />
                  </Field>
                  <Field label="Leg B NIC (optional)">
                    <Input value={legBNic} onChange={(e) => setLegBNic(e.target.value)} placeholder="eno3" mono />
                  </Field>
                </div>
              )}

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
            </div>
          </PanelBox>

          {/* ── Confidence Monitor ─────────────────────────────── */}
          <PanelBox>
            <SectionHead icon="🎬" title="Confidence Monitor" />
            <div style={{ padding: 8 }}>
              {/* Thumbnail + vertical audio meters side by side */}
              {(() => {
                const channels = selectedResult?.audioLevels?.channels || [];
                // Count real audio ES (null-PID filtered)
                const allAudioEs = (selectedResult?.programs || [])
                  .flatMap((p) => (p.streams || []).filter((s) => s.codecType === "audio"));
                const hasRealPidAudio = allAudioEs.some((s) => s.pid != null);
                const audioEsCount = hasRealPidAudio
                  ? allAudioEs.filter((s) => s.pid != null).length
                  : allAudioEs.length;
                const measuredPairs = Math.ceil(channels.length / 2);
                const pairCount = Math.max(measuredPairs, audioEsCount, 0);
                const hasMeter = pairCount > 0;
                // audio panel: 4px per bar + 1px gap, 2 bars per pair + 1px gap between pairs
                const panelW = hasMeter ? pairCount * (3 + 3 + 2) + (pairCount - 1) * 2 + 4 : 0;
                return (
                  <div style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
                    {/* Thumbnail — flex: 1 so it takes remaining width */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {selectedResult?.thumbnailUrl ? (
                        <div style={{ width: "100%", aspectRatio: "16/9", background: "#02050a", borderRadius: 2, overflow: "hidden" }}>
                          <img
                            src={selectedResult.thumbnailUrl}
                            alt="Confidence monitor"
                            style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                        </div>
                      ) : (
                        <div style={{ width: "100%", aspectRatio: "16/9", background: "#02050a", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 2 }}>
                          <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Awaiting Frame</span>
                        </div>
                      )}
                    </div>
                    {/* Vertical audio meters */}
                    {hasMeter && (
                      <div style={{ width: panelW, flexShrink: 0, background: "#03060d", borderRadius: 2, padding: "4px 2px", display: "flex", flexDirection: "row", alignItems: "stretch", gap: 2 }}>
                        {Array.from({ length: pairCount }, (_, i) => {
                          const lCh = channels[i * 2];
                          const rCh = channels[i * 2 + 1];
                          return (
                            <div key={i} style={{ display: "flex", flexDirection: "row", gap: 1, alignItems: "stretch" }}>
                              <DecoderVuBar rmsDb={lCh?.rmsDb} peakDb={lCh?.peakDb} />
                              <DecoderVuBar rmsDb={rCh?.rmsDb} peakDb={rCh?.peakDb} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              {selectedResult?.programs?.[0]?.serviceName && (
                <div style={{ fontSize: 9, color: C.cyan, padding: "4px 0 0", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {selectedResult.programs[0].serviceName}
                </div>
              )}
            </div>
          </PanelBox>

          <PanelBox style={{ borderColor: C.borderHi }}>
            <SectionHead icon="📡" title="ETR 290 Alarm Configuration"
                  right={selectedEtrExists
                    ? <Badge label={`LIVE · ${selectedId}`} color={C.ok} small />
                    : <Badge label="NOT RUNNING" color={C.muted} small />}
                />
                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

                  {/* ── Decoder selector + ETR controls ────────────────── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, alignItems: "center" }}>
                    <Field label="Monitor decoder">
                      <select
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                        style={{ width: "100%", height: 30, background: C.panel, color: selectedId ? C.text : C.muted, border: `1px solid ${C.border}`, borderRadius: 2, fontSize: 10, padding: "0 6px" }}
                      >
                        <option value="">— select decoder —</option>
                        {activeIds.map((id) => <option key={id} value={id}>{id}</option>)}
                      </select>
                    </Field>
    <button onClick={startEtrForSelected} disabled={!selectedId || busy}
                      style={{ height: 30, marginTop: 16, padding: "0 12px", borderRadius: 2, fontSize: 10, fontWeight: 700, cursor: selectedId && !busy ? "pointer" : "not-allowed", opacity: busy ? 0.5 : 1,
                        border: `1px solid ${selectedId && !busy ? (selectedEtrExists ? C.ok : C.info) : C.border}`,
                        color: selectedId && !busy ? (selectedEtrExists ? C.ok : C.info) : C.muted,
                        background: selectedEtrExists ? `${C.ok}10` : "transparent" }}>
                      {busy ? "…" : selectedEtrExists ? "● RUNNING" : "▶ Enable ETR"}
                    </button>
                    <button onClick={stopEtrForSelected} disabled={!selectedEtrExists || busy}
                      style={{ height: 30, marginTop: 16, padding: "0 12px", borderRadius: 2, fontSize: 10, fontWeight: 700, cursor: selectedEtrExists && !busy ? "pointer" : "not-allowed", opacity: busy ? 0.5 : 1,
                        border: `1px solid ${selectedEtrExists && !busy ? C.err : C.border}`,
                        color: selectedEtrExists && !busy ? C.err : C.muted, background: "transparent" }}>
                      ■ Stop
                    </button>
                  </div>
                  {(enableEtrHint || (!selectedEtrExists && !busy ? "No running ETR monitor for selected decoder." : "")) && (
                    <div style={{ display: "grid", gap: 2, fontSize: 9, color: C.muted, marginTop: -2 }}>
                      {(enableEtrHint || "No running ETR monitor for selected decoder.") ? (
                        <div>{enableEtrHint || "No running ETR monitor for selected decoder."}</div>
                      ) : null}
                      {applyEtrHint ? <div>{applyEtrHint}</div> : null}
                    </div>
                  )}

                  {/* ── Alert priority toggles ──────────────────────────── */}
                  <div style={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 3, padding: "8px 10px" }}>
                    <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Alert priorities — click to enable / disable</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                      {[
                        { label: "P1 Critical", desc: "Service failure", enabled: etrP1Enabled, set: setEtrP1Enabled, color: C.err,  keys: ['ts_sync','sync_byte','pat_error','cc_error','pmt_error','pid_error'] },
                        { label: "P2 Quality",  desc: "Impairment",      enabled: etrP2Enabled, set: setEtrP2Enabled, color: C.warn, keys: ['transport_error','crc_error','pcr_disc','pcr_acc','pcr_rep','pts_error','cat_error'] },
                        { label: "P3 Info",     desc: "SI / metadata",   enabled: etrP3Enabled, set: setEtrP3Enabled, color: C.info, keys: ['nit_error','sdt_error','eit_error','rst_error','tdt_error','empty_buf'] },
                      ].map(({ label, desc, enabled, set, color, keys }) => {
                        const hasAlarm = enabled && keys.some((k) => selectedEtrStatus?.status?.[k] === 'error');
                        return (
                          <button key={label} onClick={() => set((v) => !v)} style={{
                            padding: "6px 8px", borderRadius: 2, cursor: "pointer", textAlign: "left",
                            border: `2px solid ${hasAlarm ? color : enabled ? "rgba(255,255,255,0.12)" : C.border}`,
                            background: hasAlarm ? `${color}14` : enabled ? "rgba(255,255,255,0.04)" : "transparent",
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: enabled ? color : C.dim, display: "inline-block", flexShrink: 0, boxShadow: enabled ? `0 0 5px ${color}99` : "none" }} />
                              <span style={{ fontSize: 10, fontWeight: 700, color: hasAlarm ? color : enabled ? C.text : C.muted }}>{label}</span>
                            </div>
                            <div style={{ fontSize: 9, color: enabled ? C.muted : C.dim }}>{enabled ? desc : "DISABLED"}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Per-check threshold table ─────────────────────── */}
                  {[
                    { p: 1, label: "Priority 1 — Service not receivable (critical alarms)", color: C.err, enabled: etrP1Enabled, keys: ['ts_sync','sync_byte','pat_error','cc_error','pmt_error','pid_error'] },
                    { p: 2, label: "Priority 2 — Quality impairment", color: C.warn, enabled: etrP2Enabled, keys: ['transport_error','crc_error','pcr_disc','pcr_acc','pcr_rep','pts_error','cat_error'] },
                    { p: 3, label: "Priority 3 — Informational (SI/metadata)", color: C.info, enabled: etrP3Enabled, keys: ['nit_error','sdt_error','eit_error','rst_error','tdt_error','empty_buf'] },
                  ].map(({ p, label, color, enabled, keys }) => {
                    const groupHasAlarm = enabled && keys.some((k) => selectedEtrStatus?.status?.[k] === 'error');
                    const headerColor = groupHasAlarm ? color : enabled ? C.muted : C.dim;
                    return (<div key={p} style={{ opacity: enabled ? 1 : 0.4 }}>
                      <div style={{ fontSize: 8, color: headerColor, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                        {label}{!enabled ? " — DISABLED" : ""}
                      </div>
                      {/* header row */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 56px 48px", gap: 4, padding: "2px 6px", marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: C.dim }}>Check</span>
                        <span style={{ fontSize: 8, color: C.dim, textAlign: "right" }}>Hits</span>
                        <span style={{ fontSize: 8, color: C.dim, textAlign: "center" }}>Alarm after</span>
                        <span style={{ fontSize: 8, color: C.dim, textAlign: "center" }}>Status</span>
                      </div>
                      {ETR_CHECK_FIELDS.filter((c) => keys.includes(c.id)).map((c) => {
                        const liveCount = selectedEtrStatus?.counts?.[c.id] ?? 0;
                        const liveStatus = selectedEtrStatus?.status?.[c.id];
                        const isFailing = liveStatus === 'error';
                        const rowColor = isFailing ? color : enabled ? C.text : C.muted;
                        return (
                          <div key={c.id} style={{
                            display: "grid", gridTemplateColumns: "1fr 48px 56px 48px", gap: 4,
                            padding: "4px 6px", marginBottom: 2, borderRadius: 2,
                            background: isFailing ? `${color}0d` : C.dim,
                            border: `1px solid ${isFailing ? color : C.border}`,
                            alignItems: "center",
                          }}>
                            <span style={{ fontSize: 9, color: rowColor, fontWeight: isFailing ? 700 : 400 }}>{c.label}</span>
                            <span style={{ fontSize: 9, color: liveCount > 0 ? color : C.muted, fontFamily: "'Courier New',monospace", textAlign: "right", fontWeight: liveCount > 0 ? 700 : 400 }}>
                              {liveCount > 0 ? liveCount : "—"}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                              <Input
                                value={thresholds[c.id] ?? String(RECOMMENDED_THRESHOLDS[c.id] || 1)}
                                onChange={(e) => setThresholds((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                mono disabled={!enabled}
                                style={{ width: "100%", textAlign: "center", color: Number(thresholds[c.id]) !== Number(RECOMMENDED_THRESHOLDS[c.id] || 1) ? color : C.muted }}
                              />
                            </div>
                            <div style={{ textAlign: "center" }}>
                              {!enabled
                                ? <span style={{ fontSize: 8, color: C.dim }}>off</span>
                                : isFailing
                                  ? <span style={{ fontSize: 8, color, fontWeight: 700 }}>FAIL</span>
                                  : <span style={{ fontSize: 8, color: C.ok }}>PASS</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>);
                  })}

                  {/* ── Apply config CTA ────────────────────────────────── */}
                  <button
                    onClick={applyConfigToRunning}
                    disabled={!selectedId || !selectedEtrExists || busy}
                    style={{
                      width: "100%", padding: "8px", borderRadius: 2, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${selectedId && selectedEtrExists && !busy ? C.cyan : C.border}`,
                      color: selectedId && selectedEtrExists && !busy ? C.bg : C.muted,
                      background: selectedId && selectedEtrExists && !busy ? C.cyan : "transparent",
                      boxShadow: selectedId && selectedEtrExists && !busy ? `0 0 10px ${C.cyan}44` : "none",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    {busy ? "APPLYING…" : "↻  APPLY CONFIG TO RUNNING MONITOR"}
                  </button>
                  {applyEtrHint && !enableEtrHint && <div style={{ fontSize: 9, color: C.muted }}>{applyEtrHint}</div>}

                  {etrActionNote && (
                    <div style={{ fontSize: 10, padding: "4px 8px", borderRadius: 2, background: C.dim,
                      color: etrActionNote.type === "err" ? C.err : etrActionNote.type === "warn" ? C.warn : etrActionNote.type === "ok" ? C.ok : C.cyan }}>
                      {etrActionNote.text}
                    </div>
                  )}

                  {/* ── Service filter ──────────────────────────────────── */}
                  {(selectedResult?.dvb?.services || []).length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Service filter — leave all unchecked to monitor everything</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(selectedResult.dvb.services || []).map((svc) => {
                          const checked = selectedServiceIds.includes(svc.serviceId);
                          return (
                            <label key={svc.serviceId} style={{
                              display: "flex", alignItems: "center", gap: 4, fontSize: 9, cursor: "pointer",
                              color: checked ? C.cyan : C.muted, background: checked ? `${C.cyan}12` : C.dim,
                              border: `1px solid ${checked ? C.cyan : C.border}`, borderRadius: 2, padding: "3px 8px",
                            }}>
                              <input type="checkbox" checked={checked}
                                onChange={(e) => setSelectedServiceIds((prev) => e.target.checked ? [...prev, svc.serviceId] : prev.filter((id) => id !== svc.serviceId))}
                                style={{ accentColor: C.cyan }} />
                              {svc.serviceName || `SID ${svc.serviceId}`}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Advanced: PID scope + profile ───────────────────── */}
                  <details>
                    <summary style={{ fontSize: 9, color: C.muted, cursor: "pointer", userSelect: "none", padding: "2px 0" }}>Advanced — PID scope &amp; profiles</summary>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <Field label="Monitored PIDs (auto)">
                          <Input value={selectedServiceIds.length > 0
                            ? [...new Set(selectedServiceIds.flatMap((sid) => servicePidsByServiceId[sid] || []))].join(", ") || "none"
                            : autoIncludePidsText} onChange={() => {}} readOnly mono style={{ color: C.muted }} />
                        </Field>
                        <Field label="Excluded PIDs">
                          <Input value={excludePidsText} onChange={(e) => setExcludePidsText(e.target.value)} placeholder="e.g. 8191, 0x1FFF" mono />
                        </Field>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, color: allowUnknownPid ? C.ok : C.warn, fontSize: 10 }}>
                        <input type="checkbox" checked={allowUnknownPid} onChange={(e) => setAllowUnknownPid(e.target.checked)} style={{ accentColor: C.ok }} />
                        Allow alarms without PID evidence
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, color: enableEtrOnProvision ? C.ok : C.muted, fontSize: 10 }}>
                        <input type="checkbox" checked={enableEtrOnProvision} onChange={(e) => setEnableEtrOnProvision(e.target.checked)} style={{ accentColor: C.ok }} />
                        Auto-enable ETR when starting a decoder
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <Field label="Load profile">
                          <Select value={selectedProfileName} onChange={(e) => applyProfileToForm(e.target.value)}
                            options={[{ value: "", label: "Manual config" }, ...(etr.profiles || []).map((p) => ({ value: p.name, label: p.name }))]} />
                        </Field>
                        <button onClick={() => { setThresholds(ETR_CHECK_FIELDS.reduce((acc, c) => ({ ...acc, [c.id]: String(RECOMMENDED_THRESHOLDS[c.id] || 1) }), {})); setEtrActionNote({ type: "info", text: "Recommended values restored." }); }}
                          style={{ height: 30, marginTop: 16, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, borderRadius: 2, fontSize: 9, cursor: "pointer" }}>
                          Reset to recommended
                        </button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        <Field label="Profile name">
                          <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="sports-live" />
                        </Field>
                        <button onClick={saveCurrentProfile} disabled={!profileName.trim()}
                          style={{ height: 30, marginTop: 16, border: `1px solid ${profileName.trim() ? C.ok : C.border}`, color: profileName.trim() ? C.ok : C.muted, background: "transparent", borderRadius: 2, fontSize: 9, cursor: "pointer", fontWeight: 700 }}>
                          Save profile
                        </button>
                        <button onClick={deleteCurrentProfile} disabled={!selectedProfileName}
                          style={{ height: 30, marginTop: 16, border: `1px solid ${selectedProfileName ? C.err : C.border}`, color: selectedProfileName ? C.err : C.muted, background: "transparent", borderRadius: 2, fontSize: 9, cursor: "pointer" }}>
                          Delete profile
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              {etr.error && <div style={{ fontSize: 10, color: C.warn, padding: "4px 12px" }}>ETR monitor warning: {etr.error}</div>}
              </PanelBox>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
            {[
              { id: "quality", label: "Quality Dashboard", icon: "📊" },
              { id: "srt",     label: "SRT Transport",     icon: "🔒" },
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
            const videoStream = pickPreferredVideoStream(allStreams);
            // Keep audio rows stable across probe cycles to avoid perceived "rotation".
            const audioStreams = allStreams
              .filter((s) => s.codecType === "audio")
              // Ghost suppression: ffprobe emits each ES twice — once in the
              // program list (with PID) and once in the global stream array
              // (without PID). If any audio stream has a real PID, suppress
              // all null-PID audio rows — they are duplicates.
              .filter((() => {
                const hasRealPid = allStreams.some((s) => s.codecType === "audio" && s.pid != null);
                return hasRealPid ? (s) => s.pid != null : () => true;
              })())
              .slice()
              .sort((a, b) => {
                const pidA = a?.pid != null && Number.isFinite(Number(a.pid)) ? Number(a.pid) : Number.POSITIVE_INFINITY;
                const pidB = b?.pid != null && Number.isFinite(Number(b.pid)) ? Number(b.pid) : Number.POSITIVE_INFINITY;
                if (pidA !== pidB) return pidA - pidB;
                const codecA = String(a?.codecName || a?.codec || "");
                const codecB = String(b?.codecName || b?.codec || "");
                if (codecA !== codecB) return codecA.localeCompare(codecB);
                const srA = Number(a?.sampleRate || 0);
                const srB = Number(b?.sampleRate || 0);
                if (srA !== srB) return srA - srB;
                return Number(a?.channels || 0) - Number(b?.channels || 0);
              });
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

            // H.264/H.265 level: integer 40 → "4.0", 41 → "4.1"
            const levelFmt = (l) => {
              const n = Number(l);
              if (!Number.isFinite(n) || n <= 0) return "-";
              return `${Math.floor(n / 10)}.${n % 10}`;
            };

            // Color gamut / HDR label from colorTrc + colorSpace + colorPrimaries
            const colorLabel = (trc, space, primaries) => {
              const t = String(trc || "").toLowerCase();
              const s = String(space || "").toLowerCase();
              const p = String(primaries || "").toLowerCase();
              if (t === "smpte2084" || t === "smpte st 2084") return "HDR10";
              if (t === "hlg" || t === "arib-std-b67") return "HLG";
              if (t === "smpte428" || t === "smpte428_1") return "DCI-P3";
              if (p.includes("bt2020") || s.includes("bt2020")) return "BT.2020";
              if (p.includes("bt709") || s.includes("bt709") || t.includes("bt709")) return "BT.709";
              if (trc || space || primaries) return String(trc || space || primaries).toUpperCase();
              return "-";
            };

            // Color range: 'tv' → "Limited", 'pc' → "Full"
            const rangeLabel = (r) => {
              if (!r) return "-";
              const s = String(r).toLowerCase();
              if (s === "tv" || s === "limited" || s === "mpeg") return "Limited";
              if (s === "pc" || s === "full" || s === "jpeg") return "Full";
              return String(r).toUpperCase();
            };

            const scanLabel = (fieldOrder) => {
              if (!fieldOrder) return "-";
              const f = String(fieldOrder).toLowerCase();
              if (f === "progressive") return "Progressive";
              if (f.includes("tt") || f.includes("tb") || f.includes("top")) return "Interlaced (TFF)";
              if (f.includes("bb") || f.includes("bt") || f.includes("bottom")) return "Interlaced (BFF)";
              if (/interlac/i.test(f)) return "Interlaced";
              return String(fieldOrder);
            };

            const bpsFmt = (bps) => {
              const n = Number(bps);
              if (!n) return "-";
              return n >= 1e6 ? `${(n / 1e6).toFixed(2)} Mbps` : `${(n / 1e3).toFixed(1)} kbps`;
            };

            const fpsNumber = (fpsLike) => {
              if (fpsLike === undefined || fpsLike === null) return null;
              if (Number.isFinite(Number(fpsLike)) && Number(fpsLike) > 0) return Number(fpsLike);
              const s = String(fpsLike).trim();
              if (!s || s.toUpperCase() === "N/A" || s === "0/0") return null;
              const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
              if (!m) return null;
              const num = Number(m[1]);
              const den = Number(m[2]);
              if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
              const out = num / den;
              return Number.isFinite(out) && out > 0 ? out : null;
            };

            const svc = selectedResult?.dvb?.services?.[0];
            const videoFps = fpsNumber(videoStream?.fps);
            const transportRate = resolveTransportBitrate(selectedResult);
            const instantTsInputRateBps = Number(transportRate.bps || 0);
            const averagedTsInputRateBps = computeWindowAveragedBps(tsRateSeries, 10000);
            const tsInputRateBps = Number(averagedTsInputRateBps || instantTsInputRateBps || 0);
            const tsRateSource = dominantRateSource(tsRateSeries, 10000) || transportRate.source || latestTsRate?.tsRateSource || "-";
            const rateConfidence = transportRate.trusted ? "TRUSTED" : (transportRate.bps ? "FALLBACK" : "UNKNOWN");
            const captureMethodRaw = String(selectedResult?.dvb?.arrival?.captureMethod || selectedResult?.dvb?.probeDiagnostics?.iatSniffer?.captureMethod || "").toLowerCase();
            const captureMethod = captureMethodRaw === "tshark" || captureMethodRaw === "tcpdump"
              ? `NIC-${captureMethodRaw}`
              : (captureMethodRaw === "tsduck" ? "ANALYSER" : "UNAVAILABLE");
            const policyProfile = policyData?.current?.profile || selectedResult?.dvb?.monitoringPolicy?.profile || "-";
            const policyProfileMeta = policyData?.current?.profileMeta || selectedResult?.dvb?.monitoringPolicy?.profileMeta || null;
            const schedulerCadence = selectedResult?.dvb?.probeDiagnostics?.scheduler?.cadence || null;

            // Estimate video bitrate from total TS rate minus known audio bitrates when
            // per-PID bitrate is unavailable (tsanalyze window too short for NIC capture).
            const videoStreamBitrate = (() => {
              const direct = toFiniteNumber(videoStream?.bitrate);
              if (direct > 0) return direct;
              const audioTotalBps = audioStreams.reduce((acc, s) => acc + (toFiniteNumber(s.bitrate) || 0), 0);
              if (instantTsInputRateBps > 0 && audioTotalBps > 0) {
                const est = instantTsInputRateBps - audioTotalBps;
                return est > 0 ? -est : null; // negative sentinel = estimated
              }
              return null;
            })();
            const videoStreamBitrateIsEstimated = videoStreamBitrate !== null && videoStreamBitrate < 0;
            const videoStreamBitrateAbs = videoStreamBitrate !== null ? Math.abs(videoStreamBitrate) : null;

            return (
              <>
                {/* ── Decoder Health strip ─────────────────────────────── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6 }}>
                  {/* Decoder selector dropdown */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setSelectedPickerOpen((v) => !v)}
                      style={{
                        width: "100%", height: "100%", minHeight: 48,
                        padding: "4px 8px", borderRadius: 2, cursor: "pointer", textAlign: "left",
                        background: C.dim, border: `1px solid ${selectedId ? C.cyan + "55" : C.border}`,
                        display: "flex", flexDirection: "column", justifyContent: "center", gap: 2,
                      }}
                    >
                      <div style={{ fontSize: 8, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>Selected</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
                        <span style={{ fontSize: 9, fontFamily: "'Courier New',monospace", color: selectedId ? C.cyan : C.muted, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {selectedId || (activeIds.length ? "pick decoder ▾" : "-")}
                        </span>
                        {activeIds.length > 0 && <span style={{ fontSize: 8, color: C.muted, flexShrink: 0 }}>▾</span>}
                      </div>
                    </button>
                    {selectedPickerOpen && activeIds.length > 0 && (
                      <div style={{
                        position: "absolute", top: "calc(100% + 2px)", left: 0, zIndex: 50,
                        background: "#0f1520", border: `1px solid ${C.cyan}55`, borderRadius: 3,
                        minWidth: "100%", maxWidth: 280, boxShadow: "0 8px 24px rgba(0,0,0,0.7)",
                      }}>
                        {activeIds.map((id) => (
                          <button key={id} onClick={() => { setSelectedId(id); setSelectedPickerOpen(false); }} style={{
                            display: "block", width: "100%", padding: "6px 10px", textAlign: "left",
                            fontSize: 9, fontFamily: "'Courier New',monospace", fontWeight: id === selectedId ? 700 : 400,
                            color: id === selectedId ? C.cyan : C.text,
                            background: id === selectedId ? `${C.cyan}11` : "transparent",
                            border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer",
                          }}>
                            {id}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <StatBox label="State" value={selectedId ? "RUNNING" : "IDLE"} color={selectedId ? C.ok : C.muted} />
                  <StatBox label="ETR Monitor" value={selectedEtrStatus ? "ATTACHED" : "OFF"} color={selectedEtrStatus ? C.ok : C.muted} />
                  <StatBox label="ST 2022-7" value={use20227 ? "ON" : "OFF"} color={use20227 ? C.s22 : C.muted} />
                  <StatBox label="Monitored" value={String(activeIds.length)} color={activeIds.length ? C.ok : C.muted} />
                </div>

                {/* ── ETR counters + IAT ──────────────────────────────── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 6 }}>
                    <StatBox label="Packet Loss" value={m.packetLoss} color={m.packetLoss > 0 ? C.warn : C.ok} />
                    <StatBox label="Jitter" value={m.jitter} color={m.jitter > 0 ? C.warn : C.ok} />
                    <StatBox label="PCR Errors" value={m.pcrErrors} color={m.pcrErrors > 0 ? C.warn : C.ok} />
                    <StatBox label="CC Errors" value={m.ccErrors} color={m.ccErrors > 0 ? C.err : C.ok} />
                  </div>
                  {/* IAT / Network */}
                  {selectedResult?.dvb?.arrival && (() => {
                    const arr = selectedResult.dvb.arrival;
                    const iat = arr.iatMs || {};
                    const iatAvg = toFiniteNumber(iat.avg);
                    const iatP95 = toFiniteNumber(iat.p95);
                    const netJitter = toFiniteNumber(arr.jitterMs);
                    const lossPct = toFiniteNumber(arr.packetLossPct);
                    return (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 6 }}>
                        <StatBox label="IAT avg" value={iatAvg != null ? `${iatAvg.toFixed(2)} ms` : "-"} color={iatAvg != null && iatAvg > 50 ? C.warn : C.ok} />
                        <StatBox label="IAT p95" value={iatP95 != null ? `${iatP95.toFixed(2)} ms` : "-"} color={iatP95 != null && iatP95 > 150 ? C.err : C.ok} />
                        <StatBox label="Net Jitter" value={netJitter != null ? `${netJitter.toFixed(2)} ms` : "-"} color={netJitter != null && netJitter > 5 ? C.warn : C.ok} />
                        <StatBox label="Pkt Loss %" value={lossPct != null ? `${lossPct.toFixed(3)}%` : "-"} color={lossPct != null && lossPct > 0.01 ? C.err : C.ok} />
                      </div>
                    );
                  })()}
                </div>

                {/* ── Stream Profile ───────────────────────────────────── */}
                <PanelBox style={{ overflow: "visible" }}>
                  <SectionHead icon="📡" title="Stream Profile" />
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Service / Transport */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                      <StatBox label="Service Name" value={svc?.serviceName || "-"} color={svc?.serviceName ? C.cyan : C.muted} />
                      <StatBox label="Provider" value={svc?.serviceProvider || "-"} color={C.text} />
                      <StatBox label="TS Input Rate (10s avg)" value={bpsFmt(tsInputRateBps)} color={tsInputRateBps ? C.ok : C.muted} />
                      <StatBox label="Services" value={String(selectedResult?.dvb?.serviceCount ?? selectedResult?.programs?.length ?? "-")} color={C.text} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                      <StatBox
                        label={videoStreamBitrateIsEstimated ? "Video Bitrate (est)" : "Video Bitrate"}
                        value={videoStreamBitrateAbs != null ? bpsFmt(videoStreamBitrateAbs) : "-"}
                        color={videoStreamBitrateAbs != null ? (videoStreamBitrateIsEstimated ? C.warn : C.purple) : C.muted}
                      />
                      <StatBox label="TS Input Source" value={String(tsRateSource).toUpperCase()} color={transportRate.trusted ? C.ok : C.warn} />
                      <StatBox label="Rate Hold" value={selectedResult?.dvb?.bitrateHeldFromPrevious ? "ON" : "OFF"} color={selectedResult?.dvb?.bitrateHeldFromPrevious ? C.info : C.muted} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
                      <StatBox label="Rate Confidence" value={rateConfidence} color={rateConfidence === "TRUSTED" ? C.ok : rateConfidence === "FALLBACK" ? C.warn : C.muted} />
                      <StatBox label="Probe Method" value={captureMethod} color={captureMethod.startsWith("NIC-") ? C.cyan : captureMethod === "ANALYSER" ? C.warn : C.muted} />
                      <PolicyChip
                        policyProfile={policyProfile}
                        profileMeta={policyProfileMeta}
                        policyData={policyData}
                        policyPickerOpen={policyPickerOpen}
                        setPolicyPickerOpen={setPolicyPickerOpen}
                        policyBusy={policyBusy}
                        onSelectProfile={handleSelectProfile}
                      />
                      <StatBox
                        label="Heavy Probe"
                        value={schedulerCadence?.heavyProbeIntervalMs ? `${Math.round(Number(schedulerCadence.heavyProbeIntervalMs) / 1000)}s` : "-"}
                        color={schedulerCadence?.heavyProbeIntervalMs ? C.text : C.muted}
                      />
                    </div>

                    {/* Video profile */}
                    {videoStream && (
                      <div>
                        <div style={{ fontSize: 8, color: C.purple, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Video</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
                          <StatBox label="Codec" value={videoStream.codecName || "-"} color={C.purple} />
                          <StatBox label="Profile" value={videoStream.profile || "-"} color={videoStream.profile ? C.purple : C.muted} />
                          <StatBox label="Level" value={levelFmt(videoStream.level)} color={videoStream.level != null ? C.text : C.muted} />
                          <StatBox
                            label="Resolution"
                            value={videoStream.width && videoStream.height ? `${videoStream.width}×${videoStream.height}` : "-"}
                            color={C.text}
                          />
                          <StatBox label="Frame Rate" value={videoFps != null ? `${videoFps.toFixed(2)} fps` : "-"} color={C.text} />
                          <StatBox label="Scan" value={scanLabel(videoStream.scanType || videoStream.fieldOrder)} color={C.text} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6, marginTop: 4 }}>
                          <StatBox label="Chroma" value={chromaLabel(videoStream.pixFmt)} color={C.text} />
                          <StatBox label="Colour" value={colorLabel(videoStream.colorTrc, videoStream.colorSpace, videoStream.colorPrimaries)} color={videoStream.colorTrc === "smpte2084" || videoStream.colorTrc === "hlg" ? C.warn : C.text} />
                          <StatBox label="Range" value={rangeLabel(videoStream.colorRange)} color={videoStream.colorRange ? C.text : C.muted} />
                          <StatBox
                            label={videoStreamBitrateIsEstimated ? "ES Bitrate (est)" : "ES Bitrate"}
                            value={videoStreamBitrateAbs != null ? bpsFmt(videoStreamBitrateAbs) : "-"}
                            color={videoStreamBitrateAbs != null ? (videoStreamBitrateIsEstimated ? C.warn : C.text) : C.muted}
                          />
                          <StatBox label="PID" value={renderPidRef(videoStream.pid, videoStream.pidHex)} color={C.accent} />
                          <StatBox label="Stream Type" value={videoStream.streamType || "-"} color={videoStream.streamType ? C.text : C.muted} />
                        </div>
                      </div>
                    )}

                    {/* Audio profile(s) */}
                    {audioStreams.length > 0 && (
                      <div>
                        <div style={{ fontSize: 8, color: C.info, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                          Audio ({audioStreams.length} track{audioStreams.length !== 1 ? "s" : ""})
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 6 }}>
                          {audioStreams.map((s, i) => (
                            <div key={`${s.pid || "audio"}-${i}`} style={{ border: `1px solid ${C.border}`, borderRadius: 2, background: C.dim, padding: "6px 8px" }}>
                              <div style={{ fontSize: 8, color: C.info, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                                Track {i + 1}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                                <StatBox label="PID" value={renderPidRef(s.pid, s.pidHex)} color={C.accent} />
                                <StatBox label="Codec" value={s.codecName || "-"} color={C.info} />
                                <StatBox label="Bitrate" value={bpsFmt(s.bitrate)} color={C.text} />
                                <StatBox label="Channels" value={s.channels ? `${s.channels}ch` : "-"} color={C.text} />
                                <StatBox label="Layout" value={s.channelLayout || (s.channels === 2 ? "stereo" : s.channels === 1 ? "mono" : "-")} color={C.text} />
                                <StatBox label="Sample Rate" value={(() => { const sr = toFiniteNumber(s.sampleRate); return sr != null ? `${(sr / 1000).toFixed(1)} kHz` : "-"; })()} color={C.text} />
                              </div>
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
                  <div style={{ padding: "8px 12px", maxHeight: 260, overflowY: "auto", display: "grid", gap: 6 }}>
                    {pids.length === 0 ? (
                      <div style={{ color: C.muted, fontSize: 10 }}>No PID information available yet.</div>
                    ) : (
                      pids.map((p) => (
                        <div
                          key={p.rowKey}
                          style={{
                            border: `1px solid ${C.border}`,
                            borderRadius: 2,
                            background: C.dim,
                            padding: "6px 8px",
                            display: "grid",
                            gridTemplateColumns: "minmax(120px,0.8fr) minmax(95px,0.7fr) minmax(0,1.4fr) minmax(110px,0.8fr)",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>PID</div>
                            {renderPidRef(p.pid, p.pidHex)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Type</div>
                            <Badge label={p.codecType || "unknown"} color={p.codecType === "video" ? C.purple : p.codecType === "audio" ? C.info : C.muted} small />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Description</div>
                            <span style={{ color: C.text, fontSize: 10, display: "block", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.25 }}>{p.codec}</span>
                          </div>
                          <div style={{ minWidth: 0, textAlign: "right" }}>
                            <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Bitrate</div>
                            <span style={{ color: C.muted, fontSize: 9, fontFamily: "'Courier New',monospace" }}>{bpsFmt(p.bitrate)}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </PanelBox>

                {/* ── Active Decoders ──────────────────────────────────── */}
                <PanelBox>
                  <SectionHead icon="📋" title="Active Decoders" right={
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Badge label={`${activeIds.length} running`} color={activeIds.length ? C.ok : C.muted} small />
                      {activeIds.length > 0 && (
                        <button
                          onClick={async () => {
                            for (const id of activeIds) {
                              try { await stop(id); } catch (_) {}
                            }
                            try { await refreshActives(); } catch (_) {}
                          }}
                          style={{
                            borderRadius: 2, border: `1px solid ${C.err}`, color: C.err,
                            background: "transparent", fontSize: 9, fontWeight: 700,
                            fontFamily: "'Courier New',monospace", padding: "2px 7px", cursor: "pointer",
                          }}
                        >
                          STOP ALL
                        </button>
                      )}
                    </div>
                  } />
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

          {subTab === "srt" && (() => {
            const srt = selectedResult?.dvb?.srtStats || null;
            const isSrtUrl = String(legAUrl || "").startsWith("srt://");
            const rttMs = toFiniteNumber(srt?.rttMs);
            const lossPercent = toFiniteNumber(srt?.lossPercent);
            const rateMbps = toFiniteNumber(srt?.rateMbps);
            const bwMbps = toFiniteNumber(srt?.bwMbps);
            const nak = srt?.pktNak ?? null;
            const ack = srt?.pktAck ?? null;
            const retrans = srt?.pktRetrans ?? null;
            const dropped = srt?.pktDropped ?? null;
            const lost = srt?.pktLost ?? null;
            const total = srt?.pktTotal ?? null;
            const nakColor = nak > 0 ? C.warn : C.ok;
            const retransColor = retrans > 0 ? C.warn : C.ok;
            const droppedColor = dropped > 0 ? C.err : C.ok;
            const lostColor = lossPercent > 0.1 ? C.err : lossPercent > 0 ? C.warn : C.ok;
            const rttColor = rttMs != null ? (rttMs > 200 ? C.err : rttMs > 80 ? C.warn : C.ok) : C.muted;
            return (
              <PanelBox>
                <SectionHead icon="🔒" title="SRT Transport"
                  right={
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {isSrtUrl
                        ? <Badge label="SRT INPUT" color={C.info} small />
                        : <Badge label="NOT SRT" color={C.muted} small />}
                      {srt
                        ? <Badge label="STATS OK" color={C.ok} small />
                        : <Badge label="AWAITING STATS" color={C.muted} small />}
                    </div>
                  }
                />
                {!isSrtUrl && (
                  <div style={{ padding: "8px 12px", fontSize: 9, color: C.muted }}>
                    SRT transport stats are only available when the decoder input URL uses the <span style={{ color: C.info }}>srt://</span> scheme.
                  </div>
                )}
                {isSrtUrl && (
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

                    {/* Link quality row */}
                    <div>
                      <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Link Quality</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                        <StatBox label="RTT" value={rttMs != null ? `${rttMs.toFixed(1)} ms` : "-"} color={rttColor} />
                        <StatBox label="Rate" value={rateMbps != null ? `${rateMbps.toFixed(3)} Mbps` : "-"} color={C.ok} />
                        <StatBox label="Bandwidth" value={bwMbps != null ? `${bwMbps.toFixed(3)} Mbps` : "-"} color={C.text} />
                        <StatBox label="Loss" value={lossPercent != null ? `${lossPercent.toFixed(3)} %` : "-"} color={lostColor} />
                      </div>
                    </div>

                    {/* ARQ counters */}
                    <div>
                      <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>ARQ Counters (cumulative since session start)</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        <StatBox label="NAK sent" value={nak ?? "-"} color={nakColor}
                          title="Negative acknowledgements — receiver requested retransmit" />
                        <StatBox label="ACK sent" value={ack ?? "-"} color={C.ok}
                          title="Positive acknowledgements" />
                        <StatBox label="Retransmitted" value={retrans ?? "-"} color={retransColor}
                          title="Packets re-sent by sender after NAK" />
                        <StatBox label="Dropped (too late)" value={dropped ?? "-"} color={droppedColor}
                          title="Packets dropped because retransmit arrived after playout deadline" />
                        <StatBox label="Lost (unrecovered)" value={lost ?? "-"} color={lostColor}
                          title="Packets that could not be recovered by ARQ" />
                        <StatBox label="Total received" value={total ?? "-"} color={C.text} />
                      </div>
                    </div>

                    {/* SRT threshold note */}
                    <div style={{ fontSize: 9, color: C.muted, background: C.dim, borderRadius: 2, padding: "6px 8px", border: `1px solid ${C.border}` }}>
                      <span style={{ color: C.info, fontWeight: 700 }}>Note:</span> SRT ARQ retransmissions produce higher IAT P95 and jitter than UDP multicast.
                      Health thresholds are automatically relaxed for SRT streams (IAT P95 critical ≥ 400 ms, jitter critical ≥ 40 ms).
                    </div>

                    {!srt && (
                      <div style={{ fontSize: 9, color: C.muted }}>
                        No libsrt counters yet — SRT stats appear after the first transport bitrate probe completes on an active stream.
                      </div>
                    )}
                  </div>
                )}
              </PanelBox>
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
                {(() => {
                  const s = selectedResult?.dvb?.smpte20227 || {};
                  const m = s.metrics || {};
                  const arrival = selectedResult?.dvb?.arrival || {};
                  const iat = arrival.iatMs || {};
                  const seq = arrival.rtpSequence || {};
                  const iatMin = Number(iat.min);
                  const iatAvg = Number(iat.avg);
                  const iatP95 = Number(iat.p95);
                  const iatMax = Number(iat.max);
                  const timingSkewMs = Number.isFinite(iatMax) && Number.isFinite(iatMin) ? Math.max(0, iatMax - iatMin) : null;
                  const p95AvgDeltaMs = Number.isFinite(iatP95) && Number.isFinite(iatAvg) ? Math.max(0, iatP95 - iatAvg) : null;
                  const gapEvents = Number(seq.gapEvents ?? m.gapEvents ?? 0);
                  const duplicateEvents = Number(seq.duplicateEvents ?? m.duplicateEvents ?? 0);
                  const reorderedEvents = Number(seq.reorderedEvents ?? m.reorderedEvents ?? 0);
                  const packetLossPct = Number(arrival.packetLossPct ?? m.packetLossPct ?? 0);
                  const inOrder = Boolean(seq.observed) && gapEvents === 0 && duplicateEvents === 0 && reorderedEvents === 0;
                  return (
                    <>
                      <StatBox label="Mode" value={use20227 ? "Dual Path (A/B)" : "Single Path"} color={use20227 ? C.s22 : C.muted} />
                      <StatBox label="Checked by probe" value={String(Boolean(s.checked))} color={s.checked ? C.ok : C.muted} />
                      <StatBox label="2022-7 state" value={s.state || "-"} color={s.state === "compliant" ? C.ok : s.state ? C.warn : C.muted} />
                      <StatBox label="SMPTE compliant" value={s.compliant == null ? "-" : s.compliant ? "YES" : "NO"} color={s.compliant == null ? C.muted : s.compliant ? C.ok : C.err} />
                      <StatBox label="RTP sequence observed" value={String(Boolean(seq.observed ?? m.seqObserved))} color={seq.observed || m.seqObserved ? C.ok : C.warn} />
                      <StatBox label="Sequence order" value={inOrder ? "IN ORDER" : "OUT OF ORDER"} color={inOrder ? C.ok : C.warn} />
                      <StatBox label="Gap events" value={String(gapEvents)} color={gapEvents > 0 ? C.warn : C.ok} />
                      <StatBox label="Duplicate events" value={String(duplicateEvents)} color={duplicateEvents > 0 ? C.warn : C.ok} />
                      <StatBox label="Reordered events" value={String(reorderedEvents)} color={reorderedEvents > 0 ? C.warn : C.ok} />
                      <StatBox label="Packet loss %" value={Number.isFinite(packetLossPct) ? `${packetLossPct.toFixed(3)}%` : "-"} color={packetLossPct > 0 ? C.err : C.ok} />
                      <StatBox label="Inter-packet delay avg" value={Number.isFinite(iatAvg) ? `${iatAvg.toFixed(3)} ms` : "-"} color={Number.isFinite(iatAvg) && iatAvg > 10 ? C.warn : C.ok} />
                      <StatBox label="Inter-packet delay p95" value={Number.isFinite(iatP95) ? `${iatP95.toFixed(3)} ms` : "-"} color={Number.isFinite(iatP95) && iatP95 > 25 ? C.err : C.ok} />
                      <StatBox label="Packet-arrival skew" value={Number.isFinite(timingSkewMs) ? `${timingSkewMs.toFixed(3)} ms` : "-"} color={Number.isFinite(timingSkewMs) && timingSkewMs > 20 ? C.warn : C.ok} />
                      <StatBox label="P95-AVG delta" value={Number.isFinite(p95AvgDeltaMs) ? `${p95AvgDeltaMs.toFixed(3)} ms` : "-"} color={Number.isFinite(p95AvgDeltaMs) && p95AvgDeltaMs > 10 ? C.warn : C.ok} />
                    </>
                  );
                })()}
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
                <div style={{ gridColumn: "1 / -1", border: `1px solid ${C.border}`, borderRadius: 2, background: C.dim, padding: "6px 8px" }}>
                  <div style={{ fontSize: 8, color: C.head, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                    SRT Transport Stats (Haivision/libsrt)
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                    {(() => {
                      const rttMs = toFiniteNumber(selectedResult?.dvb?.srtStats?.rttMs);
                      return (
                        <>
                    <StatBox label="NAK" value={selectedResult?.dvb?.srtStats?.pktNak ?? "-"} color={Number(selectedResult?.dvb?.srtStats?.pktNak || 0) > 0 ? C.warn : C.ok} />
                    <StatBox label="Retransmitted" value={selectedResult?.dvb?.srtStats?.pktRetrans ?? "-"} color={Number(selectedResult?.dvb?.srtStats?.pktRetrans || 0) > 0 ? C.warn : C.ok} />
                    <StatBox label="Dropped" value={selectedResult?.dvb?.srtStats?.pktDropped ?? "-"} color={Number(selectedResult?.dvb?.srtStats?.pktDropped || 0) > 0 ? C.err : C.ok} />
                    <StatBox label="Lost" value={selectedResult?.dvb?.srtStats?.pktLost ?? "-"} color={Number(selectedResult?.dvb?.srtStats?.pktLost || 0) > 0 ? C.err : C.ok} />
                    <StatBox label="ACK" value={selectedResult?.dvb?.srtStats?.pktAck ?? "-"} color={C.text} />
                    <StatBox label="RTT" value={rttMs != null ? `${rttMs.toFixed(2)} ms` : "-"} color={C.text} />
                        </>
                      );
                    })()}
                  </div>
                  {!selectedResult?.dvb?.srtStats && (
                    <div style={{ marginTop: 6, fontSize: 9, color: C.muted }}>
                      No libsrt counters detected yet. Start SRT input with active traffic to populate NAK/ACK/retransmit metrics.
                    </div>
                  )}
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
                <StatBox label="Latest IAT avg" value={Number.isFinite(latestForensic?.iatAvg) ? `${latestForensic.iatAvg.toFixed(3)} ms` : "-"} color={C.text} />
                <StatBox label="Latest Loss" value={Number.isFinite(latestForensic?.loss) ? `${latestForensic.loss.toFixed(3)} %` : "-"} color={Number.isFinite(latestForensic?.loss) && latestForensic.loss > 0 ? C.warn : C.ok} />
              </div>
            </PanelBox>
          )}
        </div>

      </div>
    </div>
  );
}
