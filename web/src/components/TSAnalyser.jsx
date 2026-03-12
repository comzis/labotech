import React, { useState, useEffect } from 'react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import PidBadge from './PidBadge';
import { motion } from 'framer-motion';
import { Search, Activity, ShieldAlert } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';

const PROBE_MODES = [
  { value: 'rtp', label: 'RTP',  desc: 'RTP/MPEG-TS' },
  { value: 'srt', label: 'SRT',  desc: 'Haivision SRT' },
  { value: 'udp', label: 'UDP',  desc: 'Legacy Multicast/Unicast' },
];
const ETR_P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
const ETR_P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];
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

function toneClass(state) {
  const s = String(state || '').toLowerCase();
  if (s === 'critical' || s === 'non_compliant' || s === 'false') return 'text-red-300';
  if (s === 'warning' || s === 'insufficient_data') return 'text-amber-300';
  if (s === 'ok' || s === 'compliant' || s === 'true') return 'text-green-300';
  return 'text-gray-400';
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

  const { loading, error, probe, onWsResult } = useTSAnalysis();

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

  return (
    <div className="space-y-4 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Search className="w-5 h-5 text-neon-cyan" strokeWidth={1.5} />
          TS Analysis
        </h1>
        <p className="text-[11px] text-gray-500 mt-1 uppercase tracking-wider font-medium opacity-80">Compact professional TS probe and DVB evidence</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* Left: compact input/probe */}
        <div className="xl:col-span-2">
          <BentoCard icon={Activity} title="Probe Input">
            <form onSubmit={handleProbe} className="space-y-3">

            {/* Protocol selector */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider pl-1 mb-1 block">Protocol</label>
              <div className="flex items-center gap-1.5">
                {PROBE_MODES.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setProbeMode(m.value)}
                    className={`px-2 py-1 rounded border text-center transition-all text-[10px] ${probeMode === m.value
                      ? 'bg-neon-cyan/15 border-neon-cyan/40 text-white'
                      : 'bg-black/20 border-white/10 text-gray-500 hover:border-white/20'
                    }`}
                  >
                    <div className="font-semibold">{m.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Host + Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
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
            <div className="grid grid-cols-1 gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={dualLeg}
                  onChange={(e) => setDualLeg(e.target.checked)}
                  className="accent-cyan-400"
                />
                Enable SMPTE ST 2022-7 dual-leg consolidation check (A + B IP)
              </label>
            </div>
            {dualLeg && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
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
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
                <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="Optional" />
              </div>
            )}

            {/* Built URL preview */}
            {builtUrl && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-gray-500 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
                <span className="text-gray-600 shrink-0">URL:</span>
                <span className="text-neon-cyan/70 truncate">{builtUrl}</span>
              </div>
            )}
            {dualLeg && builtUrlB && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-gray-500 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
                <span className="text-gray-600 shrink-0">URL B:</span>
                <span className="text-cyan-300/80 truncate">{builtUrlB}</span>
              </div>
            )}

          <div className="flex gap-2 items-center">
            <button
              type="submit"
              disabled={loading || !builtUrl || (dualLeg && !builtUrlB)}
              className="bg-neon-cyan/15 hover:bg-neon-cyan/25 text-neon-cyan border border-neon-cyan/30 px-3 py-1.5 rounded-lg font-semibold text-xs transition-all disabled:opacity-50"
            >
              {loading ? 'Probing…' : (dualLeg ? 'Probe A+B Consolidation' : 'Provision Probe')}
            </button>
            <button
              type="button"
              onClick={() => setProbeHistory([])}
              className="px-3 py-1.5 rounded-lg border border-white/15 text-gray-400 hover:text-gray-300 text-xs"
            >
              Clear Log
            </button>
          </div>
          {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
        </form>
      </BentoCard>
        </div>

        {/* Right: compact ETR view */}
        <div className="xl:col-span-1">
          <BentoCard icon={ShieldAlert} title="ETR View">
            <div className="grid grid-cols-2 gap-2 text-xs mb-2">
              <Stat label="State" value={etrView.severity} />
              <Stat label="Last ETR" value={etrView.lastEventTs ? new Date(etrView.lastEventTs).toLocaleTimeString() : '-'} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Active Checks</div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-gray-300 font-mono min-h-[34px]">
              {etrView.activeChecks.length > 0 ? etrView.activeChecks.join(', ') : 'No active ETR checks'}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-2 mb-1">Recent ETR Alarms</div>
            <div className="max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/20">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-1 px-2">Time</th>
                    <th className="text-left py-1 px-2">Pri</th>
                    <th className="text-left py-1 px-2">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {alarmLog.slice(0, 12).map((a) => (
                    <tr key={a.key} className="border-b border-white/5">
                      <td className="py-1 px-2 text-gray-400">{new Date(a.ts).toLocaleTimeString()}</td>
                      <td className={`py-1 px-2 ${toneClass(a.priority === 'p1' ? 'critical' : a.priority === 'p2' ? 'warning' : 'ok')}`}>{String(a.priority || '-').toUpperCase()}</td>
                      <td className="py-1 px-2 text-gray-300 truncate max-w-[120px]">{a.check}</td>
                    </tr>
                  ))}
                  {alarmLog.length === 0 && (
                    <tr><td colSpan={3} className="py-2 px-2 text-gray-500">No ETR alarms in session.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </BentoCard>
        </div>
      </div>

      <BentoCard icon={ShieldAlert} title="Probe Log">
        {probeHistory.length === 0 ? (
          <div className="text-xs text-gray-500">No probe runs yet.</div>
        ) : (
          <div className="max-h-40 overflow-auto rounded-lg border border-white/10 bg-black/20">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Mode</th>
                  <th className="text-left py-2 px-2">Target</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Services</th>
                  <th className="text-left py-2 px-2">PIDs</th>
                  <th className="text-left py-2 px-2">Health</th>
                  <th className="text-left py-2 px-2">2022-7</th>
                </tr>
              </thead>
              <tbody>
                {probeHistory.map((row, idx) => (
                  <tr key={`${row.at}-${idx}`} className="border-b border-white/5">
                    <td className="py-1.5 px-2 text-gray-400">{new Date(row.at).toLocaleTimeString()}</td>
                    <td className="py-1.5 px-2 text-gray-300 uppercase">{row.mode}</td>
                    <td className="py-1.5 px-2 text-gray-400 truncate max-w-[260px]">{row.url}</td>
                    <td className={`py-1.5 px-2 ${row.status === 'ok' ? 'text-green-300' : 'text-red-300'}`}>{row.status}</td>
                    <td className="py-1.5 px-2 text-gray-300">{row.serviceCount ?? '-'}</td>
                    <td className="py-1.5 px-2 text-gray-300">{row.pidCount ?? '-'}</td>
                    <td className="py-1.5 px-2 text-gray-300">{row.health != null ? `${row.health}/100` : '-'}</td>
                    <td className={`py-1.5 px-2 ${toneClass(row.dualState || '-')}`}>{row.dualState || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      {dualLeg && dualConsolidation && (
        <BentoCard icon={ShieldAlert} title="SMPTE ST 2022-7 Consolidation (A/B)">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs mb-3">
            <Stat label="State" value={dualConsolidation.state} />
            <Stat label="PID Matched" value={`${dualConsolidation.mapping.matchedPids}/${dualConsolidation.mapping.totalPids}`} />
            <Stat label="IAT Offset" value={dualConsolidation.timing.iatOffsetMs != null ? `${dualConsolidation.timing.iatOffsetMs} ms` : '-'} />
            <Stat label="Bitrate Offset" value={dualConsolidation.timing.bitrateOffsetPct != null ? `${dualConsolidation.timing.bitrateOffsetPct}%` : '-'} />
            <Stat label="Codec Mismatch" value={String(dualConsolidation.mapping.codecMismatch)} />
          </div>
          <div className="text-xs text-gray-400 mb-2">Assessment: {dualConsolidation.reason}</div>
          <div className="max-h-56 overflow-auto rounded-lg border border-white/10 bg-black/20">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-1.5 px-2">PID</th>
                  <th className="text-left py-1.5 px-2">PID Hex</th>
                  <th className="text-left py-1.5 px-2">Leg A Codec</th>
                  <th className="text-left py-1.5 px-2">Leg B Codec</th>
                  <th className="text-left py-1.5 px-2">A Program</th>
                  <th className="text-left py-1.5 px-2">B Program</th>
                  <th className="text-left py-1.5 px-2">Match</th>
                </tr>
              </thead>
              <tbody>
                {dualConsolidation.pidRows.map((r) => (
                  <tr key={`pid-${r.pid}`} className="border-b border-white/5">
                    <td className="py-1.5 px-2 text-gray-300">{r.pid}</td>
                    <td className="py-1.5 px-2 text-gray-400">{r.pidHex}</td>
                    <td className={`py-1.5 px-2 ${r.presentA ? 'text-gray-300' : 'text-red-300'}`}>{r.aCodec}</td>
                    <td className={`py-1.5 px-2 ${r.presentB ? 'text-gray-300' : 'text-red-300'}`}>{r.bCodec}</td>
                    <td className="py-1.5 px-2 text-gray-400">{r.aProgram}</td>
                    <td className="py-1.5 px-2 text-gray-400">{r.bProgram}</td>
                    <td className={`py-1.5 px-2 ${r.codecMatch === false || !r.presentA || !r.presentB ? 'text-red-300' : 'text-green-300'}`}>
                      {r.presentA && r.presentB ? (r.codecMatch ? 'OK' : 'Mismatch') : 'Missing'}
                    </td>
                  </tr>
                ))}
                {dualConsolidation.pidRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-2 px-2 text-gray-500">No PID rows available to compare.</td>
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
          className="space-y-4"
        >
            <BentoCard icon={ShieldAlert} title="Broadcast Operations Matrix">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs mb-3">
                <Stat label="Net Bitrate" value={toMbps(resultLocal?.dvb?.bitrateBps)} />
                <Stat label="Curr Bitrate" value={toMbps(resultLocal?.dvb?.measuredBitrateBps || resultLocal?.dvb?.bitrateBps)} />
                <Stat label="Services" value={String(resultLocal?.dvb?.serviceCount ?? resultLocal?.programs?.length ?? 0)} />
                <Stat label="PIDs" value={String(resultLocal?.dvb?.pidCount ?? countPids(resultLocal))} />
                <Stat label="CC Errors" value={String(resultLocal?.dvb?.continuityCounterErrors?.count ?? 0)} />
                <Stat label="TS Discont" value={String(resultLocal?.dvb?.timestampDiscontinuity?.count ?? 0)} />
              </div>

              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Joined Multicasts / Services</div>
              <div className="max-h-44 overflow-auto rounded-lg border border-white/10 bg-black/20">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/10">
                      <th className="text-left py-1.5 px-2">Thumb</th>
                      <th className="text-left py-1.5 px-2">Name</th>
                      <th className="text-left py-1.5 px-2">Service ID</th>
                      <th className="text-left py-1.5 px-2">Mapping</th>
                      <th className="text-left py-1.5 px-2">PMT</th>
                      <th className="text-left py-1.5 px-2">PAT</th>
                      <th className="text-left py-1.5 px-2">PCR</th>
                      <th className="text-left py-1.5 px-2">CC Errs</th>
                      <th className="text-left py-1.5 px-2">Curr Bitrate</th>
                      <th className="text-left py-1.5 px-2">Min Bitrate</th>
                      <th className="text-left py-1.5 px-2">Max Bitrate</th>
                      <th className="text-left py-1.5 px-2">Src Address</th>
                      <th className="text-left py-1.5 px-2">Dest Address</th>
                      <th className="text-left py-1.5 px-2">TOS</th>
                      <th className="text-left py-1.5 px-2">TTL</th>
                      <th className="text-left py-1.5 px-2">VLAN ID</th>
                      <th className="text-left py-1.5 px-2">IAT Avg</th>
                      <th className="text-left py-1.5 px-2">IAT Min</th>
                      <th className="text-left py-1.5 px-2">IAT Max</th>
                      <th className="text-left py-1.5 px-2">RTP Drops</th>
                      <th className="text-left py-1.5 px-2">RTP OOO</th>
                      <th className="text-left py-1.5 px-2">FEC Mode</th>
                      <th className="text-left py-1.5 px-2">Health</th>
                      <th className="text-left py-1.5 px-2">2022-7</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(resultLocal?.dvb?.services || []).map((s, idx) => {
                      const target = parseTargetFromUrl(resultLocal?.url);
                      const program = (resultLocal?.programs || []).find((p) => Number(p.programId) === Number(s.serviceId));
                      const mapping = program ? `program-${program.programId}` : (s.serviceId != null ? `service-${s.serviceId}` : '-');
                      return (
                        <tr key={`${s.serviceId}-${idx}`} className="border-b border-white/5">
                          <td className="py-1.5 px-2">
                            {resultLocal?.thumbnailUrl ? (
                              <img
                                src={resultLocal.thumbnailUrl}
                                alt="thumb"
                                className="w-10 h-6 object-cover rounded border border-white/10"
                              />
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-gray-300">{s.serviceName || `service-${s.serviceId || idx + 1}`}</td>
                          <td className="py-1.5 px-2 text-gray-300">{s.serviceId ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{mapping}</td>
                          <td className="py-1.5 px-2 text-gray-400">{s.pmtPid ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">0</td>
                          <td className="py-1.5 px-2 text-gray-400">{s.pcrPid ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-300">{resultLocal?.dvb?.continuityCounterErrors?.count ?? 0}</td>
                          <td className="py-1.5 px-2 text-gray-300">{toMbps(resultLocal?.dvb?.bitrateBps)}</td>
                          <td className="py-1.5 px-2 text-gray-400">{minBitrateMbps != null ? `${minBitrateMbps.toFixed(3)} Mbps` : '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{maxBitrateMbps != null ? `${maxBitrateMbps.toFixed(3)} Mbps` : '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.network?.sourceIp || '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">
                            {resultLocal?.dvb?.arrival?.network?.destIp || (target.host && target.port ? `${target.host}:${target.port}` : '-')}
                          </td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.network?.tos || '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.network?.ttl ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.network?.vlanId ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.iatMs?.avg != null ? `${resultLocal.dvb.arrival.iatMs.avg} ms` : '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.iatMs?.min != null ? `${resultLocal.dvb.arrival.iatMs.min} ms` : '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{resultLocal?.dvb?.arrival?.iatMs?.max != null ? `${resultLocal.dvb.arrival.iatMs.max} ms` : '-'}</td>
                          <td className="py-1.5 px-2 text-gray-300">{resultLocal?.dvb?.arrival?.rtpDrops ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-300">{resultLocal?.dvb?.arrival?.rtpOutOfOrder ?? '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{inferFecMode(resultLocal?.url)}</td>
                          <td className={`py-1.5 px-2 ${toneClass(resultLocal?.dvb?.health?.severity)}`}>{resultLocal?.dvb?.health?.severity || '-'}</td>
                          <td className={`py-1.5 px-2 ${toneClass(resultLocal?.dvb?.smpte20227?.state)}`}>{resultLocal?.dvb?.smpte20227?.state || '-'}</td>
                        </tr>
                      );
                    })}
                    {(resultLocal?.dvb?.services || []).length === 0 && (
                      <tr>
                        <td colSpan={24} className="py-2 px-2 text-gray-500">No service rows available for current probe.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-3 mb-1">VBC Alarms</div>
              <div className="max-h-36 overflow-auto rounded-lg border border-white/10 bg-black/20">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/10">
                      <th className="text-left py-1.5 px-2">Time</th>
                      <th className="text-left py-1.5 px-2">Priority</th>
                      <th className="text-left py-1.5 px-2">Check</th>
                      <th className="text-left py-1.5 px-2">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alarmLog.map((a) => (
                      <tr key={a.key} className="border-b border-white/5">
                        <td className="py-1.5 px-2 text-gray-400">{new Date(a.ts).toLocaleTimeString()}</td>
                        <td className={`py-1.5 px-2 ${toneClass(a.priority === 'p1' ? 'critical' : a.priority === 'p2' ? 'warning' : 'ok')}`}>{String(a.priority || '-').toUpperCase()}</td>
                        <td className="py-1.5 px-2 text-gray-300">{a.check}</td>
                        <td className="py-1.5 px-2 text-gray-400 truncate max-w-[440px]">{a.description}</td>
                      </tr>
                    ))}
                    {alarmLog.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-2 px-2 text-gray-500">No active alarms logged in this session.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </BentoCard>

            <div className="flex items-center justify-between">
              <h2 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold">
                Packet Structure
              </h2>
              <div className="text-[10px] text-gray-500 font-mono">
                PID count: {countPids(resultLocal)}
              </div>
            </div>

            <BentoCard icon={ShieldAlert} title="DVB Professional Summary">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <Stat label="Standard" value={resultLocal?.dvb?.standard || 'MPEG-TS / DVB-SI'} />
                <Stat label="Service Count" value={String(resultLocal?.dvb?.serviceCount ?? (resultLocal.programs?.length || 0))} />
                <Stat label="PID Count" value={String(resultLocal?.dvb?.pidCount ?? countPids(resultLocal))} />
                <Stat label="Aggregate Bitrate" value={`${((resultLocal?.dvb?.bitrateBps || 0) / 1e6).toFixed(2)} Mbps`} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <Stat label="TS ID" value={String(resultLocal?.dvb?.transportStreamId ?? '-')} />
                <Stat label="ONID" value={String(resultLocal?.dvb?.originalNetworkId ?? '-')} />
                <Stat label="Bitrate Source" value={resultLocal?.dvb?.bitrateSource || '-'} />
                <Stat label="Jitter" value={resultLocal?.dvb?.arrival?.jitterMs != null ? `${resultLocal.dvb.arrival.jitterMs} ms` : '-'} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <Stat label="SMPTE 2022-7" value={resultLocal?.dvb?.smpte20227?.state ? String(resultLocal.dvb.smpte20227.state).replace('_', ' ') : '-'} />
                <Stat label="2022-7 Checked" value={String(Boolean(resultLocal?.dvb?.smpte20227?.checked))} />
                <Stat label="RTP Seq Gaps" value={String(resultLocal?.dvb?.smpte20227?.metrics?.gapEvents ?? 0)} />
                <Stat label="RTP Reorder" value={String(resultLocal?.dvb?.smpte20227?.metrics?.reorderedEvents ?? 0)} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <Stat label="Health Score" value={resultLocal?.dvb?.health?.score != null ? `${resultLocal.dvb.health.score}/100` : '-'} />
                <Stat label="Health State" value={String(resultLocal?.dvb?.health?.severity || '-').toUpperCase()} />
                <Stat label="Source Confidence" value={resultLocal?.dvb?.health?.sourceConfidence != null ? String(resultLocal.dvb.health.sourceConfidence) : '-'} />
                <Stat label="TS Discontinuities" value={String(resultLocal?.dvb?.timestampDiscontinuity?.count ?? 0)} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <Stat label="CC Errors" value={String(resultLocal?.dvb?.continuityCounterErrors?.count ?? 0)} />
                <Stat label="CC PID-scoped" value={String(resultLocal?.dvb?.continuityCounterErrors?.pidScopedCount ?? 0)} />
                <Stat label="CC Generic" value={String(resultLocal?.dvb?.continuityCounterErrors?.genericCount ?? 0)} />
                <Stat label="CC Last Message" value={(resultLocal?.dvb?.continuityCounterErrors?.lastMessages || []).slice(-1)[0] || '-'} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <Stat label="Dolby E Detected" value={String(Boolean(resultLocal?.dvb?.dolbyE?.detected))} />
                <Stat label="Dolby E Decoded" value={String(Boolean(resultLocal?.dvb?.dolbyE?.decoded))} />
                <Stat label="Dolby E Frames" value={resultLocal?.dvb?.dolbyE?.frameCount != null ? String(resultLocal.dvb.dolbyE.frameCount) : '-'} />
                <Stat label="Dolby E Error" value={resultLocal?.dvb?.dolbyE?.error || '-'} />
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs mt-2">
                <Stat label="Health Notes" value={(resultLocal?.dvb?.health?.reasons || []).slice(0, 1)[0] || '-'} />
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs mt-2">
                <Stat label="2022-7 Notes" value={resultLocal?.dvb?.smpte20227?.reason || '-'} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mt-2">
                <Stat label="SI NIT" value={resultLocal?.dvb?.si?.compliance?.nit === undefined ? '-' : String(resultLocal.dvb.si.compliance.nit)} />
                <Stat label="SI SDT" value={resultLocal?.dvb?.si?.compliance?.sdt === undefined ? '-' : String(resultLocal.dvb.si.compliance.sdt)} />
                <Stat label="SI EIT p/f" value={resultLocal?.dvb?.si?.compliance?.eitPf === undefined ? '-' : String(resultLocal.dvb.si.compliance.eitPf)} />
                <Stat label="SI TDT" value={resultLocal?.dvb?.si?.compliance?.tdt === undefined ? '-' : String(resultLocal.dvb.si.compliance.tdt)} />
              </div>
              {(resultLocal?.dvb?.services?.length || 0) > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-gray-500 border-b border-white/10">
                        <th className="text-left py-1.5">SID</th>
                        <th className="text-left py-1.5">Service</th>
                        <th className="text-left py-1.5">Provider</th>
                        <th className="text-left py-1.5">PMT PID</th>
                        <th className="text-left py-1.5">PCR PID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultLocal.dvb.services.map((s, i) => (
                        <tr key={`${s.serviceId}-${i}`} className="border-b border-white/5">
                          <td className="py-1.5 text-gray-300">{s.serviceId}</td>
                          <td className="py-1.5 text-gray-300">{s.serviceName || '-'}</td>
                          <td className="py-1.5 text-gray-400">{s.serviceProvider || '-'}</td>
                          <td className="py-1.5"><PidBadge pid={s.pmtPid} pidHex={s.pmtPidHex} /></td>
                          <td className="py-1.5"><PidBadge pid={s.pcrPid} pidHex={s.pcrPidHex} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BentoCard>

            <BentoCard icon={ShieldAlert} title="Full DVB PID Table">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Explicit PID inventory (PAT/PMT/PCR + elementary streams)
              </div>
              <div className="max-h-72 overflow-auto rounded-lg border border-white/10 bg-black/20">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/10">
                      <th className="text-left py-1.5 px-2">PID</th>
                      <th className="text-left py-1.5 px-2">PID Hex</th>
                      <th className="text-left py-1.5 px-2">Roles</th>
                      <th className="text-left py-1.5 px-2">Service / Program</th>
                      <th className="text-left py-1.5 px-2">Codec</th>
                      <th className="text-left py-1.5 px-2">Stream Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildDvbPidInventory(resultLocal).map((row) => (
                      <tr key={`full-pid-${row.pid}`} className="border-b border-white/5">
                        <td className="py-1.5 px-2 text-gray-300">{row.pid}</td>
                        <td className="py-1.5 px-2"><PidBadge pid={row.pid} pidHex={row.pidHex} /></td>
                        <td className="py-1.5 px-2 text-gray-300">{row.roles}</td>
                        <td className="py-1.5 px-2 text-gray-400">{row.serviceRefs || '-'}</td>
                        <td className="py-1.5 px-2 text-gray-300">{row.codecName || '-'}</td>
                        <td className="py-1.5 px-2 text-gray-400">{row.streamType || '-'}</td>
                      </tr>
                    ))}
                    {buildDvbPidInventory(resultLocal).length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-2 px-2 text-gray-500">No PID inventory available from this probe.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </BentoCard>

            <div className="grid grid-cols-1 gap-3">
              {resultLocal.programs?.map(prog => (
                <ProgramBlock key={prog.programId} prog={prog} />
              ))}

              {resultLocal.orphanStreams?.length > 0 && (
                <div className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-5 relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                  <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4">Orphan Matrix</h3>
                  <div className="space-y-1 relative z-10">
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
    <div className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-xl p-3 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="flex items-center justify-between mb-2 relative z-10">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">
            Program {prog.programId}
            {prog.name && <span className="ml-2 text-gray-400 opacity-70">— {prog.name}</span>}
          </span>
        </div>
        <div className="flex gap-3 text-[10px] font-mono text-gray-500">
          <span className="flex items-center gap-1.5">PMT <PidBadge pid={prog.pmtPid} pidHex={prog.pmtPidHex} /></span>
          <span className="flex items-center gap-1.5">PCR <PidBadge pid={prog.pcrPid} pidHex={prog.pcrPidHex} /></span>
        </div>
      </div>
      <div className="space-y-1 relative z-10">
        {prog.streams?.map(s => <StreamRow key={s.index} stream={s} />)}
      </div>
    </div>
  );
}

function StreamRow({ stream: s }) {
  const typeColor = {
    video: 'text-blue-400',
    audio: 'text-green-400',
    data: 'text-yellow-400',
  }[s.codecType] || 'text-gray-400';

  return (
    <div className="flex items-center gap-2 text-xs py-0.5 border-b border-gray-800 last:border-0">
      <PidBadge pid={s.pid} pidHex={s.pidHex} />
      <span className={`w-12 font-semibold ${typeColor}`}>{s.codecType}</span>
      <span className="text-gray-300 w-16">{s.codecName}</span>
      {s.width && <span className="text-gray-500">{s.width}×{s.height}</span>}
      {s.fps && <span className="text-gray-500">{formatFps(s.fps)} fps</span>}
      {s.sampleRate && <span className="text-gray-500">{s.sampleRate}Hz {s.channels}ch</span>}
      {s.bitrate && <span className="text-gray-500">{(s.bitrate / 1000000).toFixed(2)} Mbps</span>}
      {s.streamType && <span className="text-gray-600">{s.streamType}</span>}
      {s.language && <span className="text-gray-600">[{s.language}]</span>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-black/20 border border-white/10 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-gray-200 font-mono mt-0.5">{value}</div>
    </div>
  );
}
