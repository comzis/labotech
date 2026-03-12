import React, { useState, useEffect } from 'react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import PidBadge from './PidBadge';
import { motion } from 'framer-motion';
import { Search, Activity, ShieldAlert } from 'lucide-react';
import { PanelBox, SectionHead, Field as UIField, Input, C } from './BroadcastUI';

const PROBE_MODES = [
  { value: 'rtp', label: 'RTP',  desc: 'RTP/MPEG-TS' },
  { value: 'srt', label: 'SRT',  desc: 'Haivision SRT' },
  { value: 'udp', label: 'UDP',  desc: 'Legacy Multicast/Unicast' },
];
const ETR_P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
const ETR_P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];
const STORAGE_KEY = 'labotech:ts-analyser:state:v1';
const ACTIVE_ID_KEY = 'labotech:ts-analyser:active-id:v1';
function buildProbeUrl({ mode, host, port, latency, passphrase }) {
  if (!host || !port) return '';
  if (mode === 'udp') return `udp://${host}:${port}`;
  if (mode === 'rtp') return `rtp://${host}:${port}`;
  // SRT
  let url = `srt://${host}:${port}`;
  const params = [];
  if (latency)    params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join('&')}`;
  return url;
}

function formatFps(raw) {
  if (!raw || typeof raw !== 'string' || !raw.includes('/')) return raw || null;
  const [n, d] = raw.split('/').map(Number);
  if (!d) return raw;
  return (n / d).toFixed(3).replace(/\.?0+$/, '');
}

function countPids(result) {
  if (!result) return 0;
  const programCount = (result.programs || []).reduce((acc, p) => acc + ((p.streams || []).length), 0);
  return programCount + ((result.orphanStreams || []).length);
}

function toMbps(bps) {
  const n = Number(bps || 0);
  return Number.isFinite(n) && n > 0 ? `${(n / 1e6).toFixed(3)} Mbps` : '-';
}

function toneColor(state) {
  const s = String(state || '').toLowerCase();
  if (s === 'critical' || s === 'non_compliant' || s === 'false') return C.err;
  if (s === 'warning' || s === 'insufficient_data') return C.warn;
  if (s === 'ok' || s === 'compliant' || s === 'true') return C.ok;
  return C.muted;
}


function BentoCard({ icon: Icon, title, children }) {
  return (
    <PanelBox>
      <SectionHead icon={Icon ? <Icon size={12} style={{ color: C.cyan }} /> : null} title={title} />
      <div style={{ display: 'grid', gap: 8, padding: '8px 10px' }}>{children}</div>
    </PanelBox>
  );
}

function Field({ label, value, onChange, placeholder, required, type = 'text' }) {
  return (
    <UIField label={label} required={required}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        mono
      />
    </UIField>
  );
}

function parseTargetFromUrl(url) {
  if (!url) return { host: null, port: null };
  try {
    const u = new URL(url);
    return { host: u.hostname || null, port: u.port || null };
  } catch (_) {
    const m = String(url).match(/^[a-z]+:\/\/([^/:?#]+):(\d+)/i);
    if (!m) return { host: null, port: null };
    return { host: m[1], port: m[2] };
  }
}

function inferFecMode(url) {
  const s = String(url || '').toLowerCase();
  if (!s) return '-';
  if (s.includes('fec=')) {
    const m = s.match(/[?&]fec=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : 'enabled';
  }
  if (s.includes('rtp://')) return 'none';
  return '-';
}

function collectPidRows(result) {
  if (!result) return [];
  const rows = [];
  (result.programs || []).forEach((p) => {
    (p.streams || []).forEach((s) => {
      rows.push({
        pid: s.pid ?? null,
        pidHex: s.pidHex || (s.pid != null ? `0x${Number(s.pid).toString(16).toUpperCase().padStart(4, '0')}` : null),
        codecType: s.codecType || 'unknown',
        codecName: s.codecName || '-',
        streamType: s.streamType || '-',
        programId: p.programId,
      });
    });
  });
  (result.orphanStreams || []).forEach((s) => {
    rows.push({
      pid: s.pid ?? null,
      pidHex: s.pidHex || (s.pid != null ? `0x${Number(s.pid).toString(16).toUpperCase().padStart(4, '0')}` : null),
      codecType: s.codecType || 'unknown',
      codecName: s.codecName || '-',
      streamType: s.streamType || '-',
      programId: 'orphan',
    });
  });
  return rows
    .filter((r) => r.pid != null)
    .sort((a, b) => (a.pid ?? 99999) - (b.pid ?? 99999));
}

function buildDual20227Assessment(legA, legB) {
  if (!legA || !legB) {
    return {
      state: 'insufficient_data',
      reason: 'Both RTP legs are required for 2022-7 consolidation check',
      checked: false,
      mapping: { totalPids: 0, matchedPids: 0, missingOnA: 0, missingOnB: 0, codecMismatch: 0 },
      timing: { iatAvgA: null, iatAvgB: null, iatOffsetMs: null, bitrateA: null, bitrateB: null, bitrateOffsetPct: null },
      pidRows: [],
    };
  }

  const pidsA = collectPidRows(legA);
  const pidsB = collectPidRows(legB);
  const byA = new Map(pidsA.map((r) => [r.pid, r]));
  const byB = new Map(pidsB.map((r) => [r.pid, r]));
  const allPids = Array.from(new Set([...byA.keys(), ...byB.keys()])).sort((a, b) => a - b);
  const pidRows = allPids.map((pid) => {
    const a = byA.get(pid) || null;
    const b = byB.get(pid) || null;
    const codecMatch = (a && b) ? `${a.codecType}:${a.codecName}` === `${b.codecType}:${b.codecName}` : null;
    return {
      pid,
      pidHex: a?.pidHex || b?.pidHex || `0x${Number(pid).toString(16).toUpperCase().padStart(4, '0')}`,
      aCodec: a ? `${a.codecType}/${a.codecName}` : '-',
      bCodec: b ? `${b.codecType}/${b.codecName}` : '-',
      aProgram: a?.programId ?? '-',
      bProgram: b?.programId ?? '-',
      presentA: Boolean(a),
      presentB: Boolean(b),
      codecMatch,
    };
  });

  const mapping = {
    totalPids: pidRows.length,
    matchedPids: pidRows.filter((r) => r.presentA && r.presentB).length,
    missingOnA: pidRows.filter((r) => !r.presentA && r.presentB).length,
    missingOnB: pidRows.filter((r) => r.presentA && !r.presentB).length,
    codecMismatch: pidRows.filter((r) => r.presentA && r.presentB && r.codecMatch === false).length,
  };

  const iatAvgA = Number(legA?.dvb?.arrival?.iatMs?.avg);
  const iatAvgB = Number(legB?.dvb?.arrival?.iatMs?.avg);
  const iatOffsetMs = Number.isFinite(iatAvgA) && Number.isFinite(iatAvgB) ? Number(Math.abs(iatAvgA - iatAvgB).toFixed(3)) : null;
  const bitrateA = Number(legA?.dvb?.bitrateBps || 0);
  const bitrateB = Number(legB?.dvb?.bitrateBps || 0);
  const bitrateOffsetPct = bitrateA > 0 && bitrateB > 0
    ? Number((Math.abs(bitrateA - bitrateB) / Math.max(bitrateA, bitrateB) * 100).toFixed(3))
    : null;
  const timing = { iatAvgA, iatAvgB, iatOffsetMs, bitrateA: bitrateA || null, bitrateB: bitrateB || null, bitrateOffsetPct };

  const sA = legA?.dvb?.smpte20227?.state || null;
  const sB = legB?.dvb?.smpte20227?.state || null;
  let state = 'insufficient_data';
  let reason = 'Insufficient evidence for consolidated 2022-7 decision';
  if (sA === 'non_compliant' || sB === 'non_compliant') {
    state = 'non_compliant';
    reason = 'At least one leg fails 2022-7 sequence/loss criteria';
  } else if (sA === 'compliant' && sB === 'compliant') {
    if (mapping.missingOnA === 0 && mapping.missingOnB === 0 && mapping.codecMismatch === 0) {
      state = 'compliant';
      reason = 'Both legs compliant with aligned PID mapping';
    } else {
      state = 'non_compliant';
      reason = 'Leg mapping mismatch detected between A/B';
    }
  }

  return {
    state,
    reason,
    checked: true,
    mapping,
    timing,
    pidRows,
  };
}

function buildDvbPidInventory(result) {
  if (!result) return [];
  const byPid = new Map();
  const upsert = (pid, patch = {}) => {
    if (pid == null || !Number.isFinite(Number(pid))) return;
    const key = Number(pid);
    const prev = byPid.get(key) || {
      pid: key,
      pidHex: `0x${key.toString(16).toUpperCase().padStart(4, '0')}`,
      roles: new Set(),
      serviceRefs: new Set(),
      codecName: '-',
      streamType: '-',
    };
    if (patch.role) prev.roles.add(patch.role);
    if (patch.serviceRef) prev.serviceRefs.add(String(patch.serviceRef));
    if (patch.codecName && prev.codecName === '-') prev.codecName = patch.codecName;
    if (patch.streamType && prev.streamType === '-') prev.streamType = patch.streamType;
    byPid.set(key, prev);
  };

  // PAT is mandatory in compliant MPEG-TS.
  upsert(0, { role: 'PAT', serviceRef: 'global' });

  (result?.dvb?.services || []).forEach((s) => {
    upsert(Number(s.pmtPid), { role: 'PMT', serviceRef: s.serviceId ?? s.serviceName ?? 'service' });
    upsert(Number(s.pcrPid), { role: 'PCR', serviceRef: s.serviceId ?? s.serviceName ?? 'service' });
  });

  (result.programs || []).forEach((p) => {
    (p.streams || []).forEach((st) => {
      upsert(Number(st.pid), {
        role: `ES-${String(st.codecType || 'data').toUpperCase()}`,
        serviceRef: p.programId,
        codecName: st.codecName || '-',
        streamType: st.streamType || '-',
      });
    });
  });
  (result.orphanStreams || []).forEach((st) => {
    upsert(Number(st.pid), {
      role: `ES-${String(st.codecType || 'data').toUpperCase()}`,
      serviceRef: 'orphan',
      codecName: st.codecName || '-',
      streamType: st.streamType || '-',
    });
  });

  return Array.from(byPid.values())
    .map((r) => ({
      ...r,
      roles: Array.from(r.roles).join(', '),
      serviceRefs: Array.from(r.serviceRefs).join(', '),
    }))
    .sort((a, b) => a.pid - b.pid);
}

export default function TSAnalyser({ lastMessage }) {
  const [probeMode, setProbeMode] = useState('rtp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [dualLeg, setDualLeg] = useState(false);
  const [hostB, setHostB] = useState('');
  const [portB, setPortB] = useState('');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const [resultLocal, setResultLocal] = useState(null);
  const [resultLegB, setResultLegB] = useState(null);
  const [dualConsolidation, setDualConsolidation] = useState(null);
  const [probeHistory, setProbeHistory] = useState([]);
  const [alarmLog, setAlarmLog] = useState([]);
  const [etrView, setEtrView] = useState({
    severity: 'unknown',
    activeChecks: [],
    lastEventTs: null,
  });
  const [persistentMonitorId, setPersistentMonitorId] = useState(() => {
    try { return localStorage.getItem(ACTIVE_ID_KEY) || ''; } catch (_) { return ''; }
  });

  const {
    loading,
    error,
    probe,
    onWsResult,
    activeIds,
    resultsById,
    refreshActives,
    startContinuous,
    stop,
  } = useTSAnalysis();

  useEffect(() => {
    refreshActives();
  }, [refreshActives]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.resultLocal) setResultLocal(parsed.resultLocal);
      if (parsed?.resultLegB) setResultLegB(parsed.resultLegB);
      if (parsed?.dualConsolidation) setDualConsolidation(parsed.dualConsolidation);
      if (Array.isArray(parsed?.probeHistory)) setProbeHistory(parsed.probeHistory.slice(0, 30));
      if (Array.isArray(parsed?.alarmLog)) setAlarmLog(parsed.alarmLog.slice(0, 60));
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          resultLocal,
          resultLegB,
          dualConsolidation,
          probeHistory: probeHistory.slice(0, 30),
          alarmLog: alarmLog.slice(0, 60),
        })
      );
    } catch (_) {}
  }, [resultLocal, resultLegB, dualConsolidation, probeHistory, alarmLog]);

  useEffect(() => {
    try {
      if (persistentMonitorId) localStorage.setItem(ACTIVE_ID_KEY, persistentMonitorId);
      else localStorage.removeItem(ACTIVE_ID_KEY);
    } catch (_) {}
  }, [persistentMonitorId]);

  useEffect(() => {
    if (!persistentMonitorId) return;
    const persisted = resultsById[persistentMonitorId];
    if (persisted) setResultLocal(persisted);
  }, [resultsById, persistentMonitorId]);

  useEffect(() => {
    if (lastMessage) onWsResult(lastMessage);
  }, [lastMessage, onWsResult]);

  useEffect(() => {
    if (!lastMessage) return;
    const isAlarm =
      lastMessage.type === 'etr290_alarm' ||
      lastMessage.type === 'etr290_incident_started' ||
      lastMessage.type === 'etr290_incident_updated' ||
      lastMessage.type === 'error' ||
      lastMessage.type === 'switched';
    if (!isAlarm) return;
    const ts = lastMessage.time ? new Date(lastMessage.time).getTime() : Date.now();
    const priority = lastMessage.priority || (lastMessage.type === 'error' ? 'p1' : 'p2');
    const description = lastMessage.message || lastMessage.lastMessage || '-';
    const check = lastMessage.label || lastMessage.checkId || lastMessage.type;
    setAlarmLog((prev) => ([
      {
        key: `${ts}-${lastMessage.type}-${lastMessage.id || 'system'}-${check}`,
        ts,
        priority,
        check,
        description,
      },
      ...prev,
    ]).slice(0, 60));
  }, [lastMessage]);

  useEffect(() => {
    if (!lastMessage) return;
    const ts = lastMessage.time ? new Date(lastMessage.time).getTime() : Date.now();
    if (lastMessage.type === 'etr290_status') {
      const status = lastMessage.status || {};
      const activeChecks = Object.keys(status).filter((k) => status[k] === 'error');
      const hasP1 = ETR_P1_KEYS.some((k) => status[k] === 'error');
      const hasP2 = ETR_P2_KEYS.some((k) => status[k] === 'error');
      setEtrView({
        severity: hasP1 ? 'critical' : hasP2 ? 'warning' : 'ok',
        activeChecks,
        lastEventTs: ts,
      });
      return;
    }
    if (lastMessage.type === 'etr290_alarm') {
      setEtrView((prev) => ({
        ...prev,
        severity: lastMessage.priority === 'p1' ? 'critical' : 'warning',
        lastEventTs: ts,
      }));
    }
  }, [lastMessage]);

  const builtUrl = buildProbeUrl({ mode: probeMode, host, port, latency, passphrase });
  const builtUrlB = buildProbeUrl({ mode: probeMode, host: hostB, port: portB, latency, passphrase });
  const successfulBitrates = probeHistory
    .filter((r) => r.status === 'ok' && Number.isFinite(r.bitrateMbps))
    .map((r) => r.bitrateMbps);
  const minBitrateMbps = successfulBitrates.length ? Math.min(...successfulBitrates) : null;
  const maxBitrateMbps = successfulBitrates.length ? Math.max(...successfulBitrates) : null;

  const handleProbe = async (e) => {
    e.preventDefault();
    if (!builtUrl) return;
    if (dualLeg && !builtUrlB) return;
    const startedAt = Date.now();
    try {
      const r = await probe(builtUrl);
      let rB = null;
      if (dualLeg) {
        rB = await probe(builtUrlB);
      }
      setResultLocal(r);
      setResultLegB(rB);
      setDualConsolidation(dualLeg ? buildDual20227Assessment(r, rB) : null);
      setProbeHistory((prev) => ([
        {
          at: startedAt,
          mode: probeMode,
          url: dualLeg ? `${builtUrl} | ${builtUrlB}` : builtUrl,
          status: 'ok',
          pidCount: r?.dvb?.pidCount ?? countPids(r),
          serviceCount: r?.dvb?.serviceCount ?? (r?.programs?.length || 0),
          health: r?.dvb?.health?.score ?? null,
          bitrateMbps: Number(r?.dvb?.bitrateBps) > 0 ? Number((r.dvb.bitrateBps / 1e6).toFixed(3)) : null,
          dualState: dualLeg ? (buildDual20227Assessment(r, rB)?.state || null) : null,
        },
        ...prev,
      ]).slice(0, 30));
      if (!dualLeg) {
        const id = persistentMonitorId || `analyser-${Date.now()}`;
        await startContinuous(id, builtUrl, 5000);
        setPersistentMonitorId(id);
        try { await refreshActives(); } catch (_) {}
      }
    } catch (_) {
      setResultLocal(null);
      setResultLegB(null);
      setDualConsolidation(null);
      setProbeHistory((prev) => ([
        {
          at: startedAt,
          mode: probeMode,
          url: builtUrl,
          status: 'error',
          pidCount: null,
          serviceCount: null,
          health: null,
          bitrateMbps: null,
        },
        ...prev,
      ]).slice(0, 30));
    }
  };

  const handleStopPersistent = async () => {
    if (!persistentMonitorId) return;
    try {
      await stop(persistentMonitorId);
    } catch (_) {}
    setPersistentMonitorId('');
    try { await refreshActives(); } catch (_) {}
  };

  return (
    <div style={{ fontFamily: "'Courier New',monospace", color: C.text, display: 'grid', gap: 16  }}>
      {/* Header */}
      <div>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 700, letterSpacing: '0.01em', color: C.text  }}>
          <Search style={{ width: 20, height: 20, color: C.cyan  }} strokeWidth={1.5} />
          TS Analysis
        </h1>
        <p style={{ fontSize: 11, color: C.muted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, opacity: 0.8  }}>Compact professional TS probe and DVB evidence</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12  }}>
        {/* Left: compact input/probe */}
        <div style={{ gridColumn: '1 / span 1'  }}>
          <BentoCard icon={Activity} title="Probe Input">
            <form onSubmit={handleProbe} style={{ display: 'grid', gap: 12  }}>

            {/* Protocol selector */}
            <div>
              <label style={{ fontSize: 9, fontWeight: 600, color: C.head, textTransform: 'uppercase', letterSpacing: '0.1em', paddingLeft: 4, marginBottom: 4, display: 'block'  }}>Protocol</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6  }}>
                {PROBE_MODES.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setProbeMode(m.value)}
                    style={{ padding: '4px 8px', borderRadius: 3, border: `1px solid ${probeMode === m.value ? C.cyan : C.border}`, textAlign: 'center', fontSize: 9, color: probeMode === m.value ? C.text : C.muted, background: probeMode === m.value ? 'rgba(0,229,255,0.12)' : C.dim, minWidth: 56 }}
                  >
                    <div style={{ fontWeight: 600  }}>{m.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Host + Port */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8  }}>
              <div style={{ gridColumn: '1 / span 1'  }}>
                <Field
                  label={probeMode === 'udp' || probeMode === 'rtp' ? 'Multicast / Unicast IP *' : 'Host *'}
                  value={host}
                  onChange={setHost}
                  placeholder={probeMode === 'udp' || probeMode === 'rtp' ? '239.100.25.29' : '10.67.18.29'}
                  required
                />
              </div>
              <Field label="Port *" value={port} onChange={setPort} type="number" placeholder="5000" required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8  }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.text  }}>
                <input
                  type="checkbox"
                  checked={dualLeg}
                  onChange={(e) => setDualLeg(e.target.checked)}
                  style={{ accentColor: C.cyan  }}
                />
                Enable SMPTE ST 2022-7 dual-leg consolidation check (A + B IP)
              </label>
            </div>
            {dualLeg && (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8  }}>
                <div style={{ gridColumn: '1 / span 1'  }}>
                  <Field
                    label={probeMode === 'udp' || probeMode === 'rtp' ? 'Leg B Multicast / Unicast IP *' : 'Leg B Host *'}
                    value={hostB}
                    onChange={setHostB}
                    placeholder={probeMode === 'udp' || probeMode === 'rtp' ? '239.100.25.30' : '10.67.18.30'}
                    required
                  />
                </div>
                <Field label="Leg B Port *" value={portB} onChange={setPortB} type="number" placeholder="5000" required />
              </div>
            )}

            {/* SRT-only options */}
            {probeMode === 'srt' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8  }}>
                <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
                <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="Optional" />
              </div>
            )}

            {/* Built URL preview */}
            {builtUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: "'Courier New',monospace", color: C.muted, background: C.dim, padding: '8px 12px', borderRadius: 3, border: `1px solid ${C.border}` }}>
                <span style={{ color: C.head, flexShrink: 0  }}>URL:</span>
                <span style={{ color: C.cyan, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'  }}>{builtUrl}</span>
              </div>
            )}
            {dualLeg && builtUrlB && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontFamily: "'Courier New',monospace", color: C.muted, background: C.dim, padding: '8px 12px', borderRadius: 3, border: `1px solid ${C.border}` }}>
                <span style={{ color: C.head, flexShrink: 0  }}>URL B:</span>
                <span style={{ color: C.cyan, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'  }}>{builtUrlB}</span>
              </div>
            )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'  }}>
            <button
              type="submit"
              disabled={loading || !builtUrl || (dualLeg && !builtUrlB)}
              style={{ background: 'rgba(0,229,255,0.15)', color: C.cyan, border: `1px solid ${C.cyan}`, padding: '6px 12px', borderRadius: 3, fontWeight: 600, fontSize: 12 }}
            >
              {loading ? 'Probing…' : (dualLeg ? 'Probe A+B Consolidation' : 'Start Persistent Probe')}
            </button>
            <button
              type="button"
              onClick={handleStopPersistent}
              disabled={!persistentMonitorId}
              style={{ padding: '6px 12px', borderRadius: 3, border: `1px solid ${C.err}`, color: C.err, background: 'transparent', fontSize: 12 }}
            >
              Stop Probe
            </button>
            <button
              type="button"
              onClick={() => setProbeHistory([])}
              style={{ padding: '6px 12px', borderRadius: 3, border: `1px solid ${C.border}`, color: C.muted, background: 'transparent', fontSize: 12 }}
            >
              Clear Log
            </button>
            <span style={{ fontSize: 9, fontFamily: "'Courier New',monospace", color: persistentMonitorId ? C.ok : C.muted }}>
              {persistentMonitorId ? `running: ${persistentMonitorId}` : 'no persistent probe'}
            </span>
          </div>
          {error && <p style={{ color: C.err, fontSize: 14, fontWeight: 500  }}>{error}</p>}
        </form>
      </BentoCard>
        </div>

        {/* Right: compact ETR view */}
        <div style={{ gridColumn: '2 / span 1'  }}>
          <BentoCard icon={ShieldAlert} title="ETR View">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, fontSize: 12, marginBottom: 8  }}>
              <Stat label="State" value={etrView.severity} />
              <Stat label="Last ETR" value={etrView.lastEventTs ? new Date(etrView.lastEventTs).toLocaleTimeString() : '-'} />
            </div>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.head, marginBottom: 4  }}>Active Checks</div>
            <div style={{ border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3, padding: '6px 8px', fontSize: 12, color: C.text, fontFamily: "'Courier New',monospace", minHeight: 34 }}>
              {etrView.activeChecks.length > 0 ? etrView.activeChecks.join(', ') : 'No active ETR checks'}
            </div>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.head, marginTop: 8, marginBottom: 4  }}>Recent ETR Alarms</div>
            <div style={{ maxHeight: 160, overflow: 'auto', border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3 }}>
              <table style={{ width: '100%', fontSize: 11, fontFamily: "'Courier New',monospace"  }}>
                <thead>
                  <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px'  }}>Time</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px'  }}>Pri</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px'  }}>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {alarmLog.slice(0, 12).map((a) => (
                    <tr key={a.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '4px 8px', color: C.muted  }}>{new Date(a.ts).toLocaleTimeString()}</td>
                      <td style={{ padding: '4px 8px', color: toneColor(a.priority === 'p1' ? 'critical' : a.priority === 'p2' ? 'warning' : 'ok') }}>{String(a.priority || '-').toUpperCase()}</td>
                      <td style={{ padding: '4px 8px', color: C.text, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'  }}>{a.check}</td>
                    </tr>
                  ))}
                  {alarmLog.length === 0 && (
                    <tr><td colSpan={3} style={{ padding: '8px 8px', color: C.muted  }}>No ETR alarms in session.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </BentoCard>
        </div>
      </div>

      <BentoCard icon={ShieldAlert} title="Probe Log">
        {probeHistory.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted  }}>No probe runs yet.</div>
        ) : (
          <div style={{ maxHeight: 160, overflow: 'auto', border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3 }}>
            <table style={{ width: '100%', fontSize: 12, fontFamily: "'Courier New',monospace"  }}>
              <thead>
                <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>Time</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>Mode</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>Target</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>Services</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>PIDs</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>Health</th>
                  <th style={{ textAlign: 'left', padding: '8px 8px'  }}>2022-7</th>
                </tr>
              </thead>
              <tbody>
                {probeHistory.map((row, idx) => (
                  <tr key={`${row.at}-${idx}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px', color: C.muted  }}>{new Date(row.at).toLocaleTimeString()}</td>
                    <td style={{ padding: '6px 8px', color: C.text, textTransform: 'uppercase'  }}>{row.mode}</td>
                    <td style={{ padding: '6px 8px', color: C.muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'  }}>{row.url}</td>
                    <td style={{ padding: '6px 8px', color: row.status === 'ok' ? C.ok : C.err }}>{row.status}</td>
                    <td style={{ padding: '6px 8px', color: C.text  }}>{row.serviceCount ?? '-'}</td>
                    <td style={{ padding: '6px 8px', color: C.text  }}>{row.pidCount ?? '-'}</td>
                    <td style={{ padding: '6px 8px', color: C.text  }}>{row.health != null ? `${row.health}/100` : '-'}</td>
                    <td style={{ padding: '6px 8px', color: toneColor(row.dualState || '-') }}>{row.dualState || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      {dualLeg && dualConsolidation && (
        <BentoCard icon={ShieldAlert} title="SMPTE ST 2022-7 Consolidation (A/B)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 8, fontSize: 12, marginBottom: 12  }}>
            <Stat label="State" value={dualConsolidation.state} />
            <Stat label="PID Matched" value={`${dualConsolidation.mapping.matchedPids}/${dualConsolidation.mapping.totalPids}`} />
            <Stat label="IAT Offset" value={dualConsolidation.timing.iatOffsetMs != null ? `${dualConsolidation.timing.iatOffsetMs} ms` : '-'} />
            <Stat label="Bitrate Offset" value={dualConsolidation.timing.bitrateOffsetPct != null ? `${dualConsolidation.timing.bitrateOffsetPct}%` : '-'} />
            <Stat label="Codec Mismatch" value={String(dualConsolidation.mapping.codecMismatch)} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8  }}>Assessment: {dualConsolidation.reason}</div>
          <div style={{ maxHeight: 224, overflow: 'auto', border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3 }}>
            <table style={{ width: '100%', fontSize: 12, fontFamily: "'Courier New',monospace"  }}>
              <thead>
                <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PID</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PID Hex</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Leg A Codec</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Leg B Codec</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>A Program</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>B Program</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Match</th>
                </tr>
              </thead>
              <tbody>
                {dualConsolidation.pidRows.map((r) => (
                  <tr key={`pid-${r.pid}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '6px 8px', color: C.text  }}>{r.pid}</td>
                    <td style={{ padding: '6px 8px', color: C.muted  }}>{r.pidHex}</td>
                    <td style={{ padding: '6px 8px', color: r.presentA ? C.text : C.err }}>{r.aCodec}</td>
                    <td style={{ padding: '6px 8px', color: r.presentB ? C.text : C.err }}>{r.bCodec}</td>
                    <td style={{ padding: '6px 8px', color: C.muted  }}>{r.aProgram}</td>
                    <td style={{ padding: '6px 8px', color: C.muted  }}>{r.bProgram}</td>
                    <td style={{ padding: '6px 8px', color: (r.codecMatch === false || !r.presentA || !r.presentB) ? C.err : C.ok }}>
                      {r.presentA && r.presentB ? (r.codecMatch ? 'OK' : 'Mismatch') : 'Missing'}
                    </td>
                  </tr>
                ))}
                {dualConsolidation.pidRows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '8px 8px', color: C.muted  }}>No PID rows available to compare.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </BentoCard>
      )}

      {/* Structure Matrix */}
      {resultLocal && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'grid', gap: 16  }}
        >
            <BentoCard icon={ShieldAlert} title="Broadcast Operations Matrix">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gap: 8, fontSize: 12, marginBottom: 12  }}>
                <Stat label="Net Bitrate" value={toMbps(resultLocal?.dvb?.bitrateBps)} />
                <Stat label="Curr Bitrate" value={toMbps(resultLocal?.dvb?.measuredBitrateBps || resultLocal?.dvb?.bitrateBps)} />
                <Stat label="Services" value={String(resultLocal?.dvb?.serviceCount ?? resultLocal?.programs?.length ?? 0)} />
                <Stat label="PIDs" value={String(resultLocal?.dvb?.pidCount ?? countPids(resultLocal))} />
                <Stat label="CC Errors" value={String(resultLocal?.dvb?.continuityCounterErrors?.count ?? 0)} />
                <Stat label="TS Discont" value={String(resultLocal?.dvb?.timestampDiscontinuity?.count ?? 0)} />
              </div>

              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.head, marginBottom: 4  }}>Joined Multicasts / Services</div>
              <div style={{ maxHeight: 176, overflow: 'auto', border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3 }}>
                <table style={{ width: '100%', fontSize: 11, fontFamily: "'Courier New',monospace"  }}>
                  <thead>
                    <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Thumb</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Service ID</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Mapping</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PMT</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PAT</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PCR</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>CC Errs</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Curr Bitrate</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Min Bitrate</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Max Bitrate</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Src Address</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Dest Address</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>TOS</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>TTL</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>VLAN ID</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>IAT Avg</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>IAT Min</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>IAT Max</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>RTP Drops</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>RTP OOO</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>FEC Mode</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Health</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>2022-7</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(resultLocal?.dvb?.services || []).map((s, idx) => {
                      const target = parseTargetFromUrl(resultLocal?.url);
                      const program = (resultLocal?.programs || []).find((p) => Number(p.programId) === Number(s.serviceId));
                      const mapping = program ? `program-${program.programId}` : (s.serviceId != null ? `service-${s.serviceId}` : '-');
                      return (
                        <tr key={`${s.serviceId}-${idx}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '6px 8px'  }}>
                            {resultLocal?.thumbnailUrl ? (
                              <img
                                src={resultLocal.thumbnailUrl}
                                alt="thumb"
                                style={{ width: 40, height: 24, objectFit: 'cover', borderRadius: 3, border: `1px solid ${C.border}` }}
                              />
                            ) : (
                              <span style={{ color: C.muted  }}>-</span>
                            )}
                          </td>
                          <td style={{ padding: '6px 8px', color: C.text  }}>{s.serviceName || `service-${s.serviceId || idx + 1}`}</td>
                          <td style={{ padding: '6px 8px', color: C.text  }}>{s.serviceId ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{mapping}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{s.pmtPid ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>0</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{s.pcrPid ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.text  }}>{resultLocal?.dvb?.continuityCounterErrors?.count ?? 0}</td>
                          <td style={{ padding: '6px 8px', color: C.text  }}>{toMbps(resultLocal?.dvb?.bitrateBps)}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{minBitrateMbps != null ? `${minBitrateMbps.toFixed(3)} Mbps` : '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{maxBitrateMbps != null ? `${maxBitrateMbps.toFixed(3)} Mbps` : '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.network?.sourceIp || '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>
                            {resultLocal?.dvb?.arrival?.network?.destIp || (target.host && target.port ? `${target.host}:${target.port}` : '-')}
                          </td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.network?.tos || '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.network?.ttl ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.network?.vlanId ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.iatMs?.avg != null ? `${resultLocal.dvb.arrival.iatMs.avg} ms` : '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.iatMs?.min != null ? `${resultLocal.dvb.arrival.iatMs.min} ms` : '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{resultLocal?.dvb?.arrival?.iatMs?.max != null ? `${resultLocal.dvb.arrival.iatMs.max} ms` : '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.text  }}>{resultLocal?.dvb?.arrival?.rtpDrops ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.text  }}>{resultLocal?.dvb?.arrival?.rtpOutOfOrder ?? '-'}</td>
                          <td style={{ padding: '6px 8px', color: C.muted  }}>{inferFecMode(resultLocal?.url)}</td>
                          <td style={{ padding: '6px 8px', color: toneColor(resultLocal?.dvb?.health?.severity) }}>{resultLocal?.dvb?.health?.severity || '-'}</td>
                          <td style={{ padding: '6px 8px', color: toneColor(resultLocal?.dvb?.smpte20227?.state) }}>{resultLocal?.dvb?.smpte20227?.state || '-'}</td>
                        </tr>
                      );
                    })}
                    {(resultLocal?.dvb?.services || []).length === 0 && (
                      <tr>
                        <td colSpan={24} style={{ padding: '8px 8px', color: C.muted  }}>No service rows available for current probe.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.head, marginTop: 12, marginBottom: 4  }}>VBC Alarms</div>
              <div style={{ maxHeight: 144, overflow: 'auto', border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3 }}>
                <table style={{ width: '100%', fontSize: 11, fontFamily: "'Courier New',monospace"  }}>
                  <thead>
                    <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Time</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Priority</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Check</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alarmLog.map((a) => (
                      <tr key={a.key} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '6px 8px', color: C.muted  }}>{new Date(a.ts).toLocaleTimeString()}</td>
                        <td style={{ padding: '6px 8px', color: toneColor(a.priority === 'p1' ? 'critical' : a.priority === 'p2' ? 'warning' : 'ok') }}>{String(a.priority || '-').toUpperCase()}</td>
                        <td style={{ padding: '6px 8px', color: C.text  }}>{a.check}</td>
                        <td style={{ padding: '6px 8px', color: C.muted, maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'  }}>{a.description}</td>
                      </tr>
                    ))}
                    {alarmLog.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: '8px 8px', color: C.muted  }}>No active alarms logged in this session.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </BentoCard>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between'  }}>
              <h2 style={{ fontSize: 9, color: C.head, textTransform: 'uppercase', letterSpacing: '0.3em', fontWeight: 700  }}>
                Packet Structure
              </h2>
              <div style={{ fontSize: 9, color: C.head, fontFamily: "'Courier New',monospace"  }}>
                PID count: {countPids(resultLocal)}
              </div>
            </div>

            <BentoCard icon={ShieldAlert} title="DVB Professional Summary">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12  }}>
                <Stat label="Standard" value={resultLocal?.dvb?.standard || 'MPEG-TS / DVB-SI'} />
                <Stat label="Service Count" value={String(resultLocal?.dvb?.serviceCount ?? (resultLocal.programs?.length || 0))} />
                <Stat label="PID Count" value={String(resultLocal?.dvb?.pidCount ?? countPids(resultLocal))} />
                <Stat label="Aggregate Bitrate" value={`${((resultLocal?.dvb?.bitrateBps || 0) / 1e6).toFixed(2)} Mbps`} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="TS ID" value={String(resultLocal?.dvb?.transportStreamId ?? '-')} />
                <Stat label="ONID" value={String(resultLocal?.dvb?.originalNetworkId ?? '-')} />
                <Stat label="Bitrate Source" value={resultLocal?.dvb?.bitrateSource || '-'} />
                <Stat label="Jitter" value={resultLocal?.dvb?.arrival?.jitterMs != null ? `${resultLocal.dvb.arrival.jitterMs} ms` : '-'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="SMPTE 2022-7" value={resultLocal?.dvb?.smpte20227?.state ? String(resultLocal.dvb.smpte20227.state).replace('_', ' ') : '-'} />
                <Stat label="2022-7 Checked" value={String(Boolean(resultLocal?.dvb?.smpte20227?.checked))} />
                <Stat label="RTP Seq Gaps" value={String(resultLocal?.dvb?.smpte20227?.metrics?.gapEvents ?? 0)} />
                <Stat label="RTP Reorder" value={String(resultLocal?.dvb?.smpte20227?.metrics?.reorderedEvents ?? 0)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="Health Score" value={resultLocal?.dvb?.health?.score != null ? `${resultLocal.dvb.health.score}/100` : '-'} />
                <Stat label="Health State" value={String(resultLocal?.dvb?.health?.severity || '-').toUpperCase()} />
                <Stat label="Source Confidence" value={resultLocal?.dvb?.health?.sourceConfidence != null ? String(resultLocal.dvb.health.sourceConfidence) : '-'} />
                <Stat label="TS Discontinuities" value={String(resultLocal?.dvb?.timestampDiscontinuity?.count ?? 0)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="CC Errors" value={String(resultLocal?.dvb?.continuityCounterErrors?.count ?? 0)} />
                <Stat label="CC PID-scoped" value={String(resultLocal?.dvb?.continuityCounterErrors?.pidScopedCount ?? 0)} />
                <Stat label="CC Generic" value={String(resultLocal?.dvb?.continuityCounterErrors?.genericCount ?? 0)} />
                <Stat label="CC Last Message" value={(resultLocal?.dvb?.continuityCounterErrors?.lastMessages || []).slice(-1)[0] || '-'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="Dolby E Detected" value={String(Boolean(resultLocal?.dvb?.dolbyE?.detected))} />
                <Stat label="Dolby E Decoded" value={String(Boolean(resultLocal?.dvb?.dolbyE?.decoded))} />
                <Stat label="Dolby E Frames" value={resultLocal?.dvb?.dolbyE?.frameCount != null ? String(resultLocal.dvb.dolbyE.frameCount) : '-'} />
                <Stat label="Dolby E Error" value={resultLocal?.dvb?.dolbyE?.error || '-'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="Health Notes" value={(resultLocal?.dvb?.health?.reasons || []).slice(0, 1)[0] || '-'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="2022-7 Notes" value={resultLocal?.dvb?.smpte20227?.reason || '-'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, fontSize: 12, marginTop: 8  }}>
                <Stat label="SI NIT" value={resultLocal?.dvb?.si?.compliance?.nit === undefined ? '-' : String(resultLocal.dvb.si.compliance.nit)} />
                <Stat label="SI SDT" value={resultLocal?.dvb?.si?.compliance?.sdt === undefined ? '-' : String(resultLocal.dvb.si.compliance.sdt)} />
                <Stat label="SI EIT p/f" value={resultLocal?.dvb?.si?.compliance?.eitPf === undefined ? '-' : String(resultLocal.dvb.si.compliance.eitPf)} />
                <Stat label="SI TDT" value={resultLocal?.dvb?.si?.compliance?.tdt === undefined ? '-' : String(resultLocal.dvb.si.compliance.tdt)} />
              </div>
              {(resultLocal?.dvb?.services?.length || 0) > 0 && (
                <div style={{ marginTop: 12, overflowX: 'auto'  }}>
                  <table style={{ width: '100%', fontSize: 12, fontFamily: "'Courier New',monospace"  }}>
                    <thead>
                      <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                        <th style={{ textAlign: 'left', padding: '6px 0'  }}>SID</th>
                        <th style={{ textAlign: 'left', padding: '6px 0'  }}>Service</th>
                        <th style={{ textAlign: 'left', padding: '6px 0'  }}>Provider</th>
                        <th style={{ textAlign: 'left', padding: '6px 0'  }}>PMT PID</th>
                        <th style={{ textAlign: 'left', padding: '6px 0'  }}>PCR PID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultLocal.dvb.services.map((s, i) => (
                        <tr key={`${s.serviceId}-${i}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '6px 0', color: C.text  }}>{s.serviceId}</td>
                          <td style={{ padding: '6px 0', color: C.text  }}>{s.serviceName || '-'}</td>
                          <td style={{ padding: '6px 0', color: C.muted  }}>{s.serviceProvider || '-'}</td>
                          <td style={{ padding: '6px 0' }}><PidBadge pid={s.pmtPid} pidHex={s.pmtPidHex} /></td>
                          <td style={{ padding: '6px 0' }}><PidBadge pid={s.pcrPid} pidHex={s.pcrPidHex} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BentoCard>

            <BentoCard icon={ShieldAlert} title="Full DVB PID Table">
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.head, marginBottom: 4  }}>
                Explicit PID inventory (PAT/PMT/PCR + elementary streams)
              </div>
              <div style={{ maxHeight: 288, overflow: 'auto', border: `1px solid ${C.border}`, background: C.dim, borderRadius: 3 }}>
                <table style={{ width: '100%', fontSize: 12, fontFamily: "'Courier New',monospace"  }}>
                  <thead>
                    <tr style={{ color: C.head, borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PID</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>PID Hex</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Roles</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Service / Program</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Codec</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px'  }}>Stream Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildDvbPidInventory(resultLocal).map((row) => (
                      <tr key={`full-pid-${row.pid}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '6px 8px', color: C.text  }}>{row.pid}</td>
                        <td style={{ padding: '6px 8px'  }}><PidBadge pid={row.pid} pidHex={row.pidHex} /></td>
                        <td style={{ padding: '6px 8px', color: C.text  }}>{row.roles}</td>
                        <td style={{ padding: '6px 8px', color: C.muted  }}>{row.serviceRefs || '-'}</td>
                        <td style={{ padding: '6px 8px', color: C.text  }}>{row.codecName || '-'}</td>
                        <td style={{ padding: '6px 8px', color: C.muted  }}>{row.streamType || '-'}</td>
                      </tr>
                    ))}
                    {buildDvbPidInventory(resultLocal).length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: '8px 8px', color: C.muted  }}>No PID inventory available from this probe.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </BentoCard>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12  }}>
              {resultLocal.programs?.map(prog => (
                <ProgramBlock key={prog.programId} prog={prog} />
              ))}

              {resultLocal.orphanStreams?.length > 0 && (
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: 20, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.05), transparent)', opacity: 0, pointerEvents: 'none'  }} />
                  <h3 style={{ fontSize: 11, fontWeight: 700, color: C.head, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16  }}>Orphan Matrix</h3>
                  <div style={{ display: 'grid', gap: 4, position: 'relative', zIndex: 10  }}>
                    {resultLocal.orphanStreams.map(s => <StreamRow key={s.index} stream={s} />)}
                  </div>
                </div>
              )}
            </div>
        </motion.div>
      )}

    </div>
  );
}

function ProgramBlock({ prog }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: 12, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.05), transparent)', opacity: 0, pointerEvents: 'none'  }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, position: 'relative', zIndex: 10  }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12  }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.1em'  }}>
            Program {prog.programId}
            {prog.name && <span style={{ marginLeft: 8, color: C.muted, opacity: 0.7  }}>— {prog.name}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 9, fontFamily: "'Courier New',monospace", color: C.head  }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6  }}>PMT <PidBadge pid={prog.pmtPid} pidHex={prog.pmtPidHex} /></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6  }}>PCR <PidBadge pid={prog.pcrPid} pidHex={prog.pcrPidHex} /></span>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 4, position: 'relative', zIndex: 10  }}>
        {prog.streams?.map(s => <StreamRow key={s.index} stream={s} />)}
      </div>
    </div>
  );
}

function StreamRow({ stream: s }) {
  const typeColor = {
    video: C.accent,
    audio: C.ok,
    data: C.warn,
  }[s.codecType] || C.muted;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '2px 0', borderBottom: `1px solid ${C.border}` }}>
      <PidBadge pid={s.pid} pidHex={s.pidHex} />
      <span style={{ width: 48, fontWeight: 600, color: typeColor }}>{s.codecType}</span>
      <span style={{ color: C.text, width: 64  }}>{s.codecName}</span>
      {s.width && <span style={{ color: C.muted  }}>{s.width}×{s.height}</span>}
      {s.fps && <span style={{ color: C.muted  }}>{formatFps(s.fps)} fps</span>}
      {s.sampleRate && <span style={{ color: C.muted  }}>{s.sampleRate}Hz {s.channels}ch</span>}
      {s.bitrate && <span style={{ color: C.muted  }}>{(s.bitrate / 1000000).toFixed(2)} Mbps</span>}
      {s.streamType && <span style={{ color: C.head  }}>{s.streamType}</span>}
      {s.language && <span style={{ color: C.head  }}>[{s.language}]</span>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: C.dim, border: `1px solid ${C.border}`, borderRadius: 2, padding: '4px 8px' }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.head }}>{label}</div>
      <div style={{ fontFamily: "'Courier New',monospace", color: C.text, marginTop: 2 }}>{value}</div>
    </div>
  );
}
