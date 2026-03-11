import React, { useEffect, useMemo, useState } from 'react';
import { Radio, Plus, ShieldAlert } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import StatusDot from './StatusDot';
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

function qualityMetrics(status) {
  const counts = status?.counts || {};
  const packetLoss = (counts.ts_sync || 0) + (counts.transport_error || 0);
  const jitter = (counts.pcr_acc || 0) + (counts.pcr_disc || 0);
  const pcrErrors = (counts.pcr_acc || 0) + (counts.pcr_rep || 0) + (counts.pcr_disc || 0);
  const ccErrors = counts.cc_error || 0;
  return { packetLoss, jitter, pcrErrors, ccErrors };
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

export default function DecoderPanel({ lastMessage }) {
  const [mode, setMode] = useState('rtp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6501');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const [decoderId, setDecoderId] = useState('');
  const [interval, setInterval] = useState(5000);
  const [addToMultiview, setAddToMultiview] = useState(true);
  const [selectedId, setSelectedId] = useState('');

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
    }
  }, [lastMessage, onWsResult, etr]);

  const builtUrl = buildProbeUrl({ mode, host, port, latency, passphrase });
  const metrics = qualityMetrics(etr.status);
  const etrCounts = etr.status?.counts || {};
  const etrState = etr.status?.status || {};
  const p1Critical = ETR_CHECKS.p1.some((c) => etrState[c.id] === 'error');
  const p2Warning = ETR_CHECKS.p2.some((c) => etrState[c.id] === 'error');

  const selectedResult = useMemo(() => {
    if (selectedId && resultsById[selectedId]) return resultsById[selectedId];
    if (result) return result;
    return null;
  }, [selectedId, resultsById, result]);

  const startDecoder = async () => {
    if (!builtUrl) return;
    const id = decoderId || `decoder-${Date.now()}`;
    setSelectedId(id);
    try {
      if (addToMultiview) {
        await startContinuous(id, builtUrl, parseInt(interval, 10) || 5000);
      } else {
        await probe(builtUrl);
      }
      await etr.start(`etr-${id}`, builtUrl);
      setDecoderId('');
    } catch (_) {
      // Errors are surfaced by hooks; keep form state so operator can retry.
    }
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Field label="Host / IP" value={host} onChange={setHost} placeholder="239.100.25.29" />
          <Field label="Port" value={port} onChange={setPort} type="number" placeholder="6501" />
          <Field label="Decoder ID" value={decoderId} onChange={setDecoderId} placeholder="decoder-a" />
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
          <div className="text-[11px] text-gray-500 font-mono truncate max-w-[60%]">{builtUrl || 'Fill host/port to build decoder URL'}</div>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            onClick={startDecoder}
            disabled={!builtUrl}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-neon-purple to-purple-600 text-white text-sm font-bold disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Provision Decoder
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
          <Stat label="PID Count" value={selectedResult ? String(selectedResult?.dvb?.pidCount || 0) : '-'} />
          <Stat label="Bitrate" value={selectedResult ? `${(((selectedResult?.dvb?.bitrateBps || 0) / 1e6)).toFixed(2)} Mbps` : '-'} />
        </div>

        {!selectedResult && (
          <div className="mt-3 text-xs text-gray-500">
            Select a decoder chip above or provision a decoder in this tab to display DVB metrics.
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

        {etr.activeId && (
          <div className="mt-3 flex items-center gap-2 text-xs text-neon-cyan font-mono">
            <StatusDot status="live" pulse />
            ETR monitor active: {etr.activeId}
          </div>
        )}

        {etr.status && (
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
                {(etr.status?.recentAlarms || []).length} alarm{(etr.status?.recentAlarms || []).length === 1 ? '' : 's'}
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
                {(etr.status?.recentAlarms || []).length === 0 ? (
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
                      {(etr.status?.recentAlarms || []).map((alarm, idx) => (
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
            </div>
          </>
        )}
      </BentoCard>
    </div>
  );
}
