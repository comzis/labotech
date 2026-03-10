import React, { useEffect, useState } from 'react';
import { Monitor, Plus } from 'lucide-react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import StatusDot from './StatusDot';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';

function countPids(result) {
  if (!result) return 0;
  const programCount = (result.programs || []).reduce((acc, p) => acc + ((p.streams || []).length), 0);
  return programCount + ((result.orphanStreams || []).length);
}

function audioPercent(levels) {
  if (!levels || levels.meanDb == null) return 0;
  const v = Math.max(-60, Math.min(0, levels.meanDb));
  return Math.round(((v + 60) / 60) * 100);
}

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

function Stat({ label, value }) {
  return (
    <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-gray-200 font-mono mt-1">{value}</div>
    </div>
  );
}

function DecoderCard({ id, meta, result, onStop }) {
  const primaryService = result?.dvb?.services?.[0]?.serviceName || result?.programs?.[0]?.name || 'Unknown';
  const serviceProvider = result?.dvb?.services?.[0]?.serviceProvider || null;
  const levelPct = audioPercent(result?.audioLevels);

  return (
    <div className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot status="live" pulse />
          <span className="font-mono text-sm text-gray-200">{id}</span>
        </div>
        <button
          onClick={onStop}
          className="text-[10px] font-bold uppercase bg-red-900/40 hover:bg-red-800/60 text-red-300 px-2 py-1 rounded border border-red-500/20"
        >
          Stop
        </button>
      </div>
      <div className="relative aspect-video bg-gray-950 rounded-xl overflow-hidden border border-white/5">
        {result?.thumbnailUrl ? (
          <img
            src={result.thumbnailUrl}
            alt={`${id} thumbnail`}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">
            No thumbnail yet
          </div>
        )}
      </div>
      <div className="text-[11px] text-gray-500 font-mono truncate">{meta?.url || result?.url || '-'}</div>
      <div className="text-xs text-gray-300">
        <span className="text-gray-500">Service:</span> {primaryService}
        {serviceProvider ? <span className="text-gray-500"> · {serviceProvider}</span> : null}
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
          <span>Audio Level</span>
          <span className="font-mono">
            {result?.audioLevels?.meanDb != null ? `${result.audioLevels.meanDb.toFixed(1)} dB` : 'n/a'}
          </span>
        </div>
        <div className="h-2 rounded bg-black/30 border border-white/10 overflow-hidden">
          <div
            className={`h-full ${levelPct > 75 ? 'bg-red-500' : levelPct > 45 ? 'bg-amber-400' : 'bg-green-500'}`}
            style={{ width: `${levelPct}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Programs" value={String(result?.programs?.length || 0)} />
        <Stat label="PIDs" value={String(countPids(result))} />
        <Stat label="Last Probe" value={result?.probeTime ? new Date(result.probeTime).toLocaleTimeString() : '-'} />
      </div>
    </div>
  );
}

export default function DecoderMultiviewPanel({ lastMessage }) {
  const { activeIds, resultsById, decoderMeta, refreshActives, startContinuous, stop, onWsResult } = useTSAnalysis();
  const [openCreate, setOpenCreate] = useState(false);
  const [mode, setMode] = useState('rtp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('6501');
  const [decoderId, setDecoderId] = useState('');
  const [interval, setInterval] = useState('5000');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    refreshActives();
  }, [refreshActives]);

  useEffect(() => {
    if (lastMessage) onWsResult(lastMessage);
  }, [lastMessage, onWsResult]);

  const probeUrl = buildProbeUrl({ mode, host, port, latency, passphrase });

  const handleCreate = async () => {
    if (!probeUrl) return;
    const id = decoderId || `decoder-${Date.now()}`;
    try {
      await startContinuous(id, probeUrl, parseInt(interval, 10) || 5000);
      setOpenCreate(false);
      setDecoderId('');
    } catch (_) {
      // Hook exposes error state; keep form open for correction/retry.
    }
  };

  return (
    <div className="space-y-6 font-sans">
      <BentoCard icon={Monitor} title="Decoder Multiview">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold">All Active Decoders</h2>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-gray-500 font-mono">Active: {activeIds.length}</div>
            <button
              onClick={() => setOpenCreate(v => !v)}
              className="inline-flex items-center gap-1 text-xs bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 px-2 py-1 rounded"
            >
              <Plus className="w-3 h-3" />
              Decoder
            </button>
          </div>
        </div>

        {openCreate && (
          <div className="mt-4 p-3 rounded-xl border border-white/10 bg-black/20 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {['rtp', 'srt', 'udp'].map(v => (
                <button
                  key={v}
                  onClick={() => setMode(v)}
                  className={`px-3 py-2 rounded-lg text-xs border ${mode === v ? 'bg-neon-cyan/20 border-neon-cyan/50 text-white' : 'bg-black/30 border-white/10 text-gray-400'}`}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Host / IP" value={host} onChange={setHost} placeholder="239.100.25.29" />
              <Field label="Port" value={port} onChange={setPort} type="number" placeholder="6501" />
              <Field label="Decoder ID" value={decoderId} onChange={setDecoderId} placeholder="decoder-a" />
              <Field label="Refresh (ms)" value={interval} onChange={setInterval} type="number" placeholder="5000" />
            </div>
            {mode === 'srt' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
                <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="optional" />
              </div>
            )}
            <div className="text-[11px] text-gray-500 font-mono truncate">{probeUrl || 'Fill host/port to build decoder URL'}</div>
            <div className="flex justify-end">
              <button
                onClick={handleCreate}
                disabled={!probeUrl}
                className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
              >
                Add Tile
              </button>
            </div>
          </div>
        )}

        {activeIds.length === 0 && (
          <p className="text-gray-500 text-sm mt-4">No active decoders. Start decoders from Decoder tab.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-4 mt-4">
          {activeIds.map((id) => (
            <DecoderCard
              key={id}
              id={id}
              meta={decoderMeta[id]}
              result={resultsById[id]}
              onStop={() => stop(id)}
            />
          ))}
        </div>
      </BentoCard>
    </div>
  );
}
