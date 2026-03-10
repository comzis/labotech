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
  }, [refreshActives]);

  useEffect(() => {
    if (lastMessage) {
      onWsResult(lastMessage);
      etr.onWsMessage(lastMessage);
    }
  }, [lastMessage, onWsResult, etr]);

  const builtUrl = buildProbeUrl({ mode, host, port, latency, passphrase });
  const metrics = qualityMetrics(etr.status);

  const selectedResult = useMemo(() => {
    if (selectedId && resultsById[selectedId]) return resultsById[selectedId];
    if (result) return result;
    if (activeIds[0] && resultsById[activeIds[0]]) return resultsById[activeIds[0]];
    return null;
  }, [selectedId, resultsById, result, activeIds]);

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
      if (!etr.activeId) {
        await etr.start(`etr-${id}`, builtUrl);
      }
      setDecoderId('');
    } catch (_) {
      // Errors are surfaced by hooks; keep form state so operator can retry.
    }
  };

  const stopDecoder = async () => {
    if (selectedId) await stop(selectedId);
    await etr.stop();
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
          <Stat label="Service Count" value={String(selectedResult?.dvb?.serviceCount || selectedResult?.programs?.length || 0)} />
          <Stat label="PID Count" value={String(selectedResult?.dvb?.pidCount || 0)} />
          <Stat label="Bitrate" value={`${(((selectedResult?.dvb?.bitrateBps || 0) / 1e6)).toFixed(2)} Mbps`} />
        </div>

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
      </BentoCard>
    </div>
  );
}
