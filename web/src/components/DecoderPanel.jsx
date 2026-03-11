import React, { useEffect, useMemo, useState } from 'react';
import { Radio, Plus, ShieldAlert } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import StatusDot from './StatusDot';
import Sparkline from './Sparkline';
import { Field } from './ui/MatrixField';
import useTSAnalysis from '../hooks/useTSAnalysis';
import useETR290 from '../hooks/useETR290';

const PROBE_MODES = [
  { value: 'rtp', label: 'RTP' },
  { value: 'srt', label: 'SRT' },
  { value: 'udp', label: 'UDP' },
];

const REFRESH_OPTIONS_MS = [
  { value: 1000, label: '1 second' },
  { value: 2000, label: '2 seconds' },
  { value: 5000, label: '5 seconds' },
  { value: 10000, label: '10 seconds' },
  { value: 15000, label: '15 seconds' },
  { value: 30000, label: '30 seconds' },
];
const MAX_FORENSIC_SAMPLES = 120;
const MAX_DECODER_EVENTS = 200;

const ETR_CHECKS = {
  p1: [
    { id: 'ts_sync', label: 'TS Sync Loss' },
    { id: 'sync_byte', label: 'Sync Byte Error' },
    { id: 'pat_error', label: 'PAT Error' },
    { id: 'cc_error', label: 'CC Error' },
    { id: 'pmt_error', label: 'PMT Error' },
    { id: 'pid_error', label: 'PID Error' },
  ],
  p2: [
    { id: 'transport_error', label: 'Transport Error' },
    { id: 'crc_error', label: 'CRC Error' },
    { id: 'pcr_disc', label: 'PCR Discontinuity' },
    { id: 'pcr_acc', label: 'PCR Accuracy' },
    { id: 'pcr_rep', label: 'PCR Repetition' },
    { id: 'pts_error', label: 'PTS Error' },
    { id: 'cat_error', label: 'CAT Error' },
  ],
  p3: [
    { id: 'nit_error', label: 'NIT Error' },
    { id: 'sdt_error', label: 'SDT Error' },
    { id: 'eit_error', label: 'EIT Error' },
    { id: 'rst_error', label: 'RST Error' },
    { id: 'tdt_error', label: 'TDT Error' },
    { id: 'empty_buf', label: 'Empty Buffer' },
  ],
};

function buildProbeUrl({ mode, host, port, latency, passphrase }) {
  if (!host || !port) return '';
  if (mode === 'udp') return `udp://${host}:${port}`;
  if (mode === 'rtp') return `rtp://${host}:${port}`;
  let url = `srt://${host}:${port}`;
  const params = [];
  if (latency) params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join('&')}`;
  return url;
}

function normalizeLaneId(rawId) {
  const id = String(rawId || '').trim();
  if (!id) return 'unknown';
  return id.replace(/^etr[-_:]/i, '') || id;
}

function isExpectedNoSignalError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('ffprobe exited 1') ||
    m.includes('connection refused') ||
    m.includes('input/output error') ||
    m.includes('server returned 404') ||
    m.includes('immediate exit requested')
  );
}

function toDecoderEvent(msg) {
  if (!msg?.type || !msg?.id) return null;
  const decoderId = normalizeLaneId(msg.id);
  const ts = msg.time ? new Date(msg.time).getTime() : Date.now();
  if (!Number.isFinite(ts)) return null;
  if (msg.type === 'etr290_alarm') {
    return {
      key: `evt-${ts}-${decoderId}-etr-${msg.label || ''}`,
      decoderId,
      ts,
      severity: msg.priority === 'p1' ? 'critical' : msg.priority === 'p2' ? 'warning' : 'info',
      title: `ETR ${(msg.priority || 'p3').toUpperCase()} - ${msg.label || 'Alarm'}`,
      details: msg.message || '',
    };
  }
  if (msg.type === 'error') {
    const warning = isExpectedNoSignalError(msg.message);
    return {
      key: `evt-${ts}-${decoderId}-error-${msg.message || ''}`,
      decoderId,
      ts,
      severity: warning ? 'warning' : 'critical',
      title: warning ? 'Input signal missing' : 'Runtime error',
      details: msg.message || '',
    };
  }
  if (msg.type === 'switched') {
    return {
      key: `evt-${ts}-${decoderId}-switched`,
      decoderId,
      ts,
      severity: 'warning',
      title: 'Failover switch',
      details: msg.message || 'Primary input switched to backup',
    };
  }
  if (msg.type === 'started' || msg.type === 'stopped') {
    return {
      key: `evt-${ts}-${decoderId}-${msg.type}`,
      decoderId,
      ts,
      severity: msg.type === 'started' ? 'info' : 'warning',
      title: msg.type === 'started' ? 'Decoder started' : 'Decoder stopped',
      details: msg.message || '',
    };
  }
  return null;
}

function severityClass(sev) {
  if (sev === 'critical') return 'text-red-300 border-red-500/25 bg-red-900/15';
  if (sev === 'warning') return 'text-amber-300 border-amber-500/25 bg-amber-900/15';
  return 'text-sky-300 border-sky-500/25 bg-sky-900/10';
}

function newDecoderRow(seed = Date.now()) {
  return {
    key: `${seed}-${Math.random().toString(36).slice(2, 8)}`,
    host: '',
    port: '6501',
    decoderId: '',
  };
}

function qualityMetrics(status) {
  const counts = status?.counts || {};
  const packetLoss = (counts.ts_sync || 0) + (counts.transport_error || 0);
  const jitter = (counts.pcr_acc || 0) + (counts.pcr_disc || 0);
  const pcrErrors = (counts.pcr_acc || 0) + (counts.pcr_rep || 0) + (counts.pcr_disc || 0);
  const ccErrors = counts.cc_error || 0;
  return { packetLoss, jitter, pcrErrors, ccErrors };
}

function collectPidRows(result) {
  if (!result) return [];
  const normalizePid = (pid, pidHex) => {
    if (pid != null && Number.isFinite(Number(pid))) return Number(pid);
    if (typeof pidHex === 'string') {
      if (/^0x[0-9a-f]+$/i.test(pidHex)) return parseInt(pidHex, 16);
      if (/^\d+$/.test(pidHex)) return parseInt(pidHex, 10);
    }
    return null;
  };
  const rows = [];
  (result.programs || []).forEach((program) => {
    (program.streams || []).forEach((stream) => {
      const normalizedPid = normalizePid(stream.pid, stream.pidHex);
      rows.push({
        programId: program.programId,
        pid: normalizedPid,
        pidHex: stream.pidHex || (normalizedPid != null ? `0x${normalizedPid.toString(16).toUpperCase().padStart(4, '0')}` : null),
        codecType: stream.codecType || 'unknown',
        codecName: stream.codecName || '-',
        streamType: stream.streamType || '-',
        sourceIndex: stream.index,
        language: stream.language || '-',
        bitrate: stream.bitrate || 0,
      });
    });
  });
  (result.orphanStreams || []).forEach((stream) => {
    const normalizedPid = normalizePid(stream.pid, stream.pidHex);
    rows.push({
      programId: 'orphan',
      pid: normalizedPid,
      pidHex: stream.pidHex || (normalizedPid != null ? `0x${normalizedPid.toString(16).toUpperCase().padStart(4, '0')}` : null),
      codecType: stream.codecType || 'unknown',
      codecName: stream.codecName || '-',
      streamType: stream.streamType || '-',
      sourceIndex: stream.index,
      language: stream.language || '-',
      bitrate: stream.bitrate || 0,
    });
  });
  const sorted = rows.sort((a, b) => (a.pid ?? 99999) - (b.pid ?? 99999));
  const totalBps = result?.dvb?.bitrateBps || 0;
  const knownBps = sorted.reduce((acc, row) => acc + (row.bitrate || 0), 0);
  const unresolved = Math.max(0, totalBps - knownBps);
  if (unresolved > 0) {
    const firstVideo = sorted.find((row) => row.codecType === 'video' && (!row.bitrate || row.bitrate <= 0));
    if (firstVideo) {
      firstVideo.bitrate = unresolved;
      firstVideo.bitrateEstimated = true;
    }
  }
  return sorted;
}

function formatPidDisplay(pid, pidHex) {
  if (pid == null && !pidHex) return '-';
  if (pid == null) return pidHex || '-';
  return pidHex ? `${pid} (${pidHex})` : String(pid);
}

function Stat({ label, value, alert = false }) {
  return (
    <div className={`rounded-lg px-3 py-2 border ${alert ? 'bg-red-900/20 border-red-500/20' : 'bg-black/20 border-white/10'}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`font-mono mt-1 ${alert ? 'text-red-300' : 'text-gray-200'}`}>{value}</div>
    </div>
  );
}

function EtrPriorityBlock({ title, checks, status, counts }) {
  const hasError = checks.some((c) => status?.[c.id] === 'error');
  return (
    <div className={`rounded-xl border p-3 ${hasError ? 'bg-red-900/20 border-red-500/30' : 'bg-black/20 border-white/10'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-gray-400">{title}</div>
        <StatusDot status={hasError ? 'error' : 'live'} pulse={hasError} />
      </div>
      <div className="space-y-1">
        {checks.map((check) => {
          const isError = status?.[check.id] === 'error';
          return (
            <div key={check.id} className={`flex items-center justify-between text-xs px-2 py-1 rounded ${isError ? 'bg-red-950/40 text-red-300' : 'bg-black/30 text-gray-400'}`}>
              <span>{check.label}</span>
              <span className="font-mono">{counts?.[check.id] || 0}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatUtc(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function AlarmTimeline({ alarms }) {
  if (!alarms?.length) {
    return <div className="text-xs text-gray-500 px-3 py-3">No recent timeline events.</div>;
  }
  const sorted = [...alarms]
    .filter((a) => a?.time)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return (
    <div className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Live Timeline (UTC)</div>
      <div className="space-y-2">
        {sorted.map((alarm, idx) => {
          const pri = (alarm.priority || '-').toUpperCase();
          const priClass = pri === 'P1'
            ? 'text-red-300 border-red-500/30 bg-red-900/20'
            : pri === 'P2'
              ? 'text-amber-300 border-amber-500/30 bg-amber-900/20'
              : 'text-sky-300 border-sky-500/30 bg-sky-900/20';
          return (
            <div key={`${alarm.time || idx}-${idx}`} className="rounded border border-white/10 bg-black/30 p-2">
              <div className="flex items-center justify-between">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${priClass}`}>{pri}</span>
                <span className="text-[10px] text-gray-500 font-mono">{formatUtc(alarm.time)}</span>
              </div>
              <div className="text-xs text-gray-300 font-mono mt-1">{alarm.label || '-'}</div>
              <div className="text-[11px] text-gray-500">{alarm.message || '-'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DecoderPanel({ lastMessage, selectedDecoderRequest }) {
  const [mode, setMode] = useState('rtp');
  const [decoderRows, setDecoderRows] = useState([newDecoderRow()]);
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const [interval, setInterval] = useState(5000);
  const [addToMultiview, setAddToMultiview] = useState(true);
  const [captureNic, setCaptureNic] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [provisionSummary, setProvisionSummary] = useState(null);
  const [forensicHistoryById, setForensicHistoryById] = useState({});
  const [eventHistoryById, setEventHistoryById] = useState({});

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshActives]);

  useEffect(() => {
    if (lastMessage) {
      onWsResult(lastMessage);
      etr.onWsMessage(lastMessage);

      if (lastMessage.type === 'analyse_result' && lastMessage.id) {
        const decoderId = normalizeLaneId(lastMessage.id);
        const arrival = lastMessage?.dvb?.arrival || {};
        const iat = arrival?.iatMs || {};
        const sampleTs = lastMessage.time ? new Date(lastMessage.time).getTime() : Date.now();
        if (Number.isFinite(sampleTs)) {
          const sample = {
            ts: sampleTs,
            iatMin: Number(iat.min),
            iatAvg: Number(iat.avg),
            iatP95: Number(iat.p95),
            jitter: Number(arrival.jitterMs),
            loss: Number(arrival.packetLossPct),
          };
          setForensicHistoryById((prev) => {
            const existing = prev[decoderId] || [];
            const next = [...existing, sample]
              .filter((s) => Number.isFinite(s.ts))
              .slice(-MAX_FORENSIC_SAMPLES);
            return { ...prev, [decoderId]: next };
          });
        }
      }

      const evt = toDecoderEvent(lastMessage);
      if (evt) {
        setEventHistoryById((prev) => {
          const existing = prev[evt.decoderId] || [];
          const next = [...existing, evt].slice(-MAX_DECODER_EVENTS);
          return { ...prev, [evt.decoderId]: next };
        });
      }
    }
  }, [lastMessage, onWsResult, etr]);

  const rowPlans = useMemo(() => {
    return decoderRows.map((row, idx) => {
      const url = buildProbeUrl({
        mode,
        host: row.host,
        port: row.port,
        latency,
        passphrase,
      });
      return { ...row, rowIndex: idx + 1, url };
    });
  }, [decoderRows, mode, latency, passphrase]);
  const validRowPlans = rowPlans.filter((row) => row.url);
  const firstPreviewUrl = validRowPlans[0]?.url || '';
  const selectedMonitorId = selectedId ? `etr-${selectedId}` : etr.activeId;
  const selectedEtrStatus = selectedMonitorId ? (etr.statusById?.[selectedMonitorId] || null) : etr.status;
  const metrics = qualityMetrics(selectedEtrStatus);
  const etrCounts = selectedEtrStatus?.counts || {};
  const etrState = selectedEtrStatus?.status || {};
  const p1Critical = ETR_CHECKS.p1.some((c) => etrState[c.id] === 'error');
  const p2Warning = ETR_CHECKS.p2.some((c) => etrState[c.id] === 'error');

  const selectedResult = useMemo(() => {
    if (selectedId) {
      if (resultsById[selectedId]) return resultsById[selectedId];
      if (result?.id === selectedId) return result;
      return null;
    }
    if (result) return result;
    return null;
  }, [selectedId, resultsById, result]);
  const selectedPidRows = useMemo(() => collectPidRows(selectedResult), [selectedResult]);
  const resolvedPidCount = selectedPidRows.filter(r => r.pid != null).length;
  const expectedPidCount = selectedResult?.dvb?.pidCount || 0;
  const unresolvedPidGap = expectedPidCount > 0 && resolvedPidCount < expectedPidCount;
  const selectedForensic = forensicHistoryById[selectedId] || [];
  const forensicSeries = useMemo(() => {
    const pick = (k) => selectedForensic.map((s) => s[k]).filter((v) => Number.isFinite(v));
    return {
      iatMin: pick('iatMin'),
      iatAvg: pick('iatAvg'),
      iatP95: pick('iatP95'),
      jitter: pick('jitter'),
      loss: pick('loss'),
      latest: selectedForensic.length ? selectedForensic[selectedForensic.length - 1] : null,
    };
  }, [selectedForensic]);
  const selectedDecoderEvents = useMemo(
    () => (eventHistoryById[selectedId] || []).slice().sort((a, b) => b.ts - a.ts),
    [eventHistoryById, selectedId]
  );

  useEffect(() => {
    if (!selectedId) return;
    const monitorId = `etr-${selectedId}`;
    if (etr.activeIds?.includes(monitorId) && etr.activeId !== monitorId) {
      etr.setActiveId(monitorId);
    }
  }, [selectedId, etr]);

  useEffect(() => {
    if (selectedId) return;
    if (activeIds.length > 0) setSelectedId(activeIds[0]);
  }, [activeIds, selectedId]);

  useEffect(() => {
    const requested = selectedDecoderRequest?.id;
    if (!requested) return;
    setSelectedId(requested);
  }, [selectedDecoderRequest]);

  const updateRow = (rowKey, patch) => {
    setDecoderRows((rows) => rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)));
  };

  const addDecoderRow = () => {
    setDecoderRows((rows) => [...rows, newDecoderRow()]);
  };

  const removeDecoderRow = (rowKey) => {
    setDecoderRows((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((r) => r.key !== rowKey);
    });
  };

  const startDecoder = async () => {
    if (validRowPlans.length === 0) return;
    const runStamp = Date.now();
    const started = [];
    const failed = [];

    for (let i = 0; i < validRowPlans.length; i += 1) {
      const row = validRowPlans[i];
      const id = row.decoderId?.trim() || `decoder-${runStamp}-${i + 1}`;
      try {
        if (addToMultiview) {
          await startContinuous(id, row.url, parseInt(interval, 10) || 5000, captureNic || undefined);
        } else {
          await probe(row.url);
        }
        await etr.start(`etr-${id}`, row.url, captureNic || undefined);
        started.push(id);
      } catch (err) {
        failed.push({ id, message: err?.message || 'Provision failed' });
      }
    }

    if (started.length > 0) {
      setSelectedId(started[started.length - 1]);
      setDecoderRows((rows) => rows.map((r) => ({ ...r, decoderId: '' })));
    }
    setProvisionSummary({ started, failed, at: Date.now() });
  };

  const stopDecoder = async () => {
    if (selectedId) {
      await stop(selectedId);
      await etr.stop(`etr-${selectedId}`);
      setSelectedId('');
      return;
    }
    if (etr.activeId) await etr.stop(etr.activeId);
  };

  return (
    <div className="space-y-6 font-sans">
      <BentoCard icon={Radio} title="Decoder Workflow">
        <div className="grid grid-cols-3 gap-2">
          {PROBE_MODES.map(v => (
            <button
              key={v.value}
              onClick={() => setMode(v.value)}
              className={`px-3 py-2 rounded-lg text-xs border ${mode === v.value ? 'bg-neon-cyan/20 border-neon-cyan/50 text-white' : 'bg-black/30 border-white/10 text-gray-400'}`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          {decoderRows.map((row) => (
            <div key={row.key} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_140px_1fr_auto] gap-3 items-end">
              <Field
                label="Host / IP"
                value={row.host}
                onChange={(v) => updateRow(row.key, { host: v })}
                placeholder="239.100.25.29"
              />
              <Field
                label="Port"
                value={row.port}
                onChange={(v) => updateRow(row.key, { port: v })}
                type="number"
                placeholder="6501"
              />
              <Field
                label="Decoder ID (optional)"
                value={row.decoderId}
                onChange={(v) => updateRow(row.key, { decoderId: v })}
                placeholder="decoder-a"
              />
              <button
                onClick={() => removeDecoderRow(row.key)}
                disabled={decoderRows.length <= 1}
                className="h-[42px] px-3 rounded-xl border border-red-500/30 bg-red-900/20 text-red-300 text-xs font-bold disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={addDecoderRow}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            Add decoder row
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <Field
            label="Capture NIC (optional)"
            value={captureNic}
            onChange={setCaptureNic}
            placeholder="eno2 (default from config)"
          />
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">Refresh</label>
            <select
              value={String(interval)}
              onChange={(e) => setInterval(parseInt(e.target.value, 10))}
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-200"
            >
              {REFRESH_OPTIONS_MS.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-midnight-surface">{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {mode === 'srt' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
            <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="optional" />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={addToMultiview}
              onChange={(e) => setAddToMultiview(e.target.checked)}
              className="accent-cyan-400"
            />
            Add to Multiview
          </label>
          <div className="text-[11px] text-gray-500 font-mono truncate max-w-[60%]">
            {firstPreviewUrl ? `${validRowPlans.length} row(s) ready - ${firstPreviewUrl}` : 'Fill host/port rows to build decoder URLs'}
          </div>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            onClick={startDecoder}
            disabled={validRowPlans.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-neon-purple to-purple-600 text-white text-sm font-bold disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Provision {validRowPlans.length > 1 ? `${validRowPlans.length} Decoders` : 'Decoder'}
          </button>
          <button
            onClick={stopDecoder}
            disabled={!selectedId && !etr.activeId}
            className="px-4 py-2 rounded-xl bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-500/30 text-sm font-bold disabled:opacity-50"
          >
            Stop Decoder
          </button>
        </div>

        {activeIds.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {activeIds.map(id => (
              <button
                key={id}
                onClick={() => setSelectedId(id)}
                className={`text-xs px-2 py-1 rounded border ${selectedId === id ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10' : 'border-white/10 text-gray-400 bg-black/20'}`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
        {provisionSummary && (
          <div className="mt-3 text-xs rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-gray-300">
              Started: <span className="font-mono text-neon-cyan">{provisionSummary.started.length}</span>
              {' '}· Failed: <span className="font-mono text-red-300">{provisionSummary.failed.length}</span>
            </div>
            {provisionSummary.failed.length > 0 && (
              <div className="mt-1 text-red-300 font-mono">
                {provisionSummary.failed.map((f) => `${f.id}: ${f.message}`).join(' | ')}
              </div>
            )}
          </div>
        )}
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </BentoCard>

      <BentoCard icon={ShieldAlert} title="Decoder Quality Dashboard">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Packet Loss" value={String(metrics.packetLoss)} alert={metrics.packetLoss > 0} />
          <Stat label="Jitter Events" value={String(metrics.jitter)} alert={metrics.jitter > 0} />
          <Stat label="PCR Errors" value={String(metrics.pcrErrors)} alert={metrics.pcrErrors > 0} />
          <Stat label="CC Errors" value={String(metrics.ccErrors)} alert={metrics.ccErrors > 0} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Stat label="Service Count" value={selectedResult ? String(selectedResult?.dvb?.serviceCount || selectedResult?.programs?.length || 0) : '-'} />
          <Stat label="PID Count" value={selectedResult ? String(resolvedPidCount || selectedResult?.dvb?.pidCount || 0) : '-'} />
          <Stat label="Bitrate" value={selectedResult ? `${(((selectedResult?.dvb?.bitrateBps || 0) / 1e6)).toFixed(2)} Mbps` : '-'} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <Stat label="TS ID" value={selectedResult ? String(selectedResult?.dvb?.transportStreamId ?? '-') : '-'} />
          <Stat label="ONID" value={selectedResult ? String(selectedResult?.dvb?.originalNetworkId ?? '-') : '-'} />
          <Stat label="Bitrate Source" value={selectedResult ? (selectedResult?.dvb?.bitrateSource || '-') : '-'} />
          <Stat label="Jitter" value={selectedResult?.dvb?.arrival?.jitterMs != null ? `${selectedResult.dvb.arrival.jitterMs} ms` : '-'} />
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">IAT / Arrival Forensics</div>
          {forensicSeries.latest ? (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
              <div className="rounded border border-white/10 bg-black/20 p-1.5">
                <div className="text-[10px] text-gray-500 uppercase">IAT Min (ms)</div>
                <Sparkline data={forensicSeries.iatMin} width={120} height={24} color="#00ddff" />
                <div className="font-mono text-gray-300 text-[11px]">{forensicSeries.latest.iatMin ?? '-'}</div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-1.5">
                <div className="text-[10px] text-gray-500 uppercase">IAT Avg (ms)</div>
                <Sparkline data={forensicSeries.iatAvg} width={120} height={24} color="#66ccff" />
                <div className="font-mono text-gray-300 text-[11px]">{forensicSeries.latest.iatAvg ?? '-'}</div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-1.5">
                <div className="text-[10px] text-gray-500 uppercase">IAT P95 (ms)</div>
                <Sparkline data={forensicSeries.iatP95} width={120} height={24} color="#cc88ff" />
                <div className="font-mono text-gray-300 text-[11px]">{forensicSeries.latest.iatP95 ?? '-'}</div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-1.5">
                <div className="text-[10px] text-gray-500 uppercase">Jitter (ms)</div>
                <Sparkline data={forensicSeries.jitter} width={120} height={24} color="#ffaa00" />
                <div className="font-mono text-gray-300 text-[11px]">{forensicSeries.latest.jitter ?? '-'}</div>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-1.5">
                <div className="text-[10px] text-gray-500 uppercase">Packet Loss (%)</div>
                <Sparkline data={forensicSeries.loss} width={120} height={24} color="#ff5566" />
                <div className="font-mono text-gray-300 text-[11px]">{forensicSeries.latest.loss ?? '-'}</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">No IAT history yet for selected decoder.</div>
          )}
        </div>
        {selectedResult?.dvb?.bitrateSource && (
          <div className="mt-1 text-[10px] text-gray-500">
            TS bitrate source: {selectedResult.dvb.bitrateSource}
          </div>
        )}
        {unresolvedPidGap && (
          <div className="mt-1 text-[10px] text-amber-300">
            PID sample is partial ({resolvedPidCount}/{expectedPidCount} resolved). Next probe should complete missing rows.
          </div>
        )}

        {!selectedResult && (
          <div className="mt-3 text-xs text-gray-500">
            {selectedId
              ? 'Decoder selected. Waiting for first probe sample (depends on refresh interval and probe duration).'
              : 'Select a decoder chip above or provision a decoder in this tab to display DVB metrics.'}
          </div>
        )}

        {(selectedResult?.dvb?.services || []).length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-2">SID</th>
                  <th className="text-left py-2">Service</th>
                  <th className="text-left py-2">Provider</th>
                  <th className="text-left py-2">PMT PID</th>
                  <th className="text-left py-2">PCR PID</th>
                </tr>
              </thead>
              <tbody>
                {selectedResult.dvb.services.map((s, i) => (
                  <tr key={`${s.serviceId}-${i}`} className="border-b border-white/5">
                    <td className="py-2 text-gray-300">{s.serviceId}</td>
                    <td className="py-2 text-gray-300">{s.serviceName || '-'}</td>
                    <td className="py-2 text-gray-400">{s.serviceProvider || '-'}</td>
                    <td className="py-2 text-gray-300">{s.pmtPid ?? '-'}</td>
                    <td className="py-2 text-gray-300">{s.pcrPid ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedResult && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">TS PID Inventory</div>
            <div className="max-h-56 overflow-auto rounded-lg border border-white/10 bg-black/20">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-2 px-2">Program</th>
                    <th className="text-left py-2 px-2">PID</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Codec</th>
                    <th className="text-left py-2 px-2">Stream Type</th>
                    <th className="text-left py-2 px-2">Index</th>
                    <th className="text-left py-2 px-2">Lang</th>
                    <th className="text-left py-2 px-2">Bitrate</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPidRows.map((row, idx) => (
                    <tr key={`${row.programId}-${row.pid}-${idx}`} className="border-b border-white/5">
                      <td className="py-1.5 px-2 text-gray-300">{row.programId === 'orphan' ? 'Orphan' : row.programId}</td>
                      <td className="py-1.5 px-2 text-gray-300">{formatPidDisplay(row.pid, row.pidHex)}</td>
                      <td className="py-1.5 px-2 text-gray-300 uppercase">{row.codecType}</td>
                      <td className="py-1.5 px-2 text-gray-300">{row.codecName}</td>
                      <td className="py-1.5 px-2 text-gray-400">{row.streamType}</td>
                      <td className="py-1.5 px-2 text-gray-400">{row.sourceIndex ?? '-'}</td>
                      <td className="py-1.5 px-2 text-gray-400">{row.language}</td>
                      <td className="py-1.5 px-2 text-gray-400">
                        {row.bitrate > 0
                          ? <>
                              {(row.bitrate / 1e6).toFixed(2)} Mbps
                              {row.bitrateEstimated && (
                                <span
                                  className="ml-1 text-[9px] text-amber-400 font-mono"
                                  title="Estimated: TS container bitrate minus sum of resolved PID bitrates"
                                >
                                  (est.)
                                </span>
                              )}
                            </>
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {etr.activeId && (
          <div className="mt-3 flex items-center gap-2 text-xs text-neon-cyan font-mono">
            <StatusDot status="live" pulse />
            ETR monitor active: {etr.activeId}
          </div>
        )}

        {selectedEtrStatus && (
          <>
            <div className={`mt-4 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
              p1Critical
                ? 'bg-red-900/30 border-red-500/40 text-red-300'
                : p2Warning
                  ? 'bg-amber-900/30 border-amber-500/40 text-amber-300'
                  : 'bg-green-900/20 border-green-500/30 text-green-300'
            }`}>
              <StatusDot status={p1Critical ? 'error' : 'live'} pulse={p1Critical} />
              {p1Critical
                ? 'ETR290 CRITICAL - Priority 1 errors detected'
                : p2Warning
                  ? 'ETR290 WARNING - Priority 2 errors present'
                  : 'ETR290 NOMINAL - All monitored checks passing'}
              <span className="ml-auto font-mono">
                {(selectedEtrStatus?.recentAlarms || []).length} alarm{(selectedEtrStatus?.recentAlarms || []).length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
              <EtrPriorityBlock title="Priority 1" checks={ETR_CHECKS.p1} status={etrState} counts={etrCounts} />
              <EtrPriorityBlock title="Priority 2" checks={ETR_CHECKS.p2} status={etrState} counts={etrCounts} />
              <EtrPriorityBlock title="Priority 3" checks={ETR_CHECKS.p3} status={etrState} counts={etrCounts} />
            </div>

            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">ETR Alarm Log</div>
              <div className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20">
                {(selectedEtrStatus?.recentAlarms || []).length === 0 ? (
                  <div className="text-xs text-gray-500 px-3 py-3">No alarms in current window.</div>
                ) : (
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-gray-500 border-b border-white/10">
                        <th className="text-left py-2 px-2">Time</th>
                        <th className="text-left py-2 px-2">Pri</th>
                        <th className="text-left py-2 px-2">Check</th>
                        <th className="text-left py-2 px-2">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedEtrStatus?.recentAlarms || []).map((alarm, idx) => (
                        <tr key={`${alarm.time || idx}-${idx}`} className="border-b border-white/5">
                          <td className="py-1.5 px-2 text-gray-400">{alarm.time ? new Date(alarm.time).toLocaleTimeString() : '-'}</td>
                          <td className={`py-1.5 px-2 ${alarm.priority === 'p1' ? 'text-red-300' : alarm.priority === 'p2' ? 'text-amber-300' : 'text-sky-300'}`}>
                            {(alarm.priority || '-').toUpperCase()}
                          </td>
                          <td className="py-1.5 px-2 text-gray-300">{alarm.label || '-'}</td>
                          <td className="py-1.5 px-2 text-gray-400">{alarm.message || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="mt-2">
                <AlarmTimeline alarms={selectedEtrStatus?.recentAlarms || []} />
              </div>
            </div>
          </>
        )}
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Decoder Events & Alarms</div>
          <div className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2">
            {selectedDecoderEvents.length === 0 ? (
              <div className="text-xs text-gray-500 px-1 py-1">No runtime events yet for selected decoder.</div>
            ) : (
              <div className="space-y-1.5">
                {selectedDecoderEvents.slice(0, 50).map((evt) => (
                  <div key={evt.key} className={`rounded border px-2 py-1 ${severityClass(evt.severity)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-mono">{evt.title}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{formatUtc(evt.ts)}</div>
                    </div>
                    <div className="text-[11px] text-gray-400">{evt.details || '-'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </BentoCard>
    </div>
  );
}
