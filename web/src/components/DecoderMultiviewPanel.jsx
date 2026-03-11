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

function resolveDisplayBitrateMbps(result) {
  // dvb.bitrateBps is the backend's best value: measured TS rate > format rate > ES sum.
  // Never use formatBitrateBps directly — ffprobe's format-level estimate is unreliable
  // for live RTP/UDP multicast (typically reports only decoded ES bitrate, not full TS rate).
  const bps = result?.dvb?.bitrateBps;
  if (bps != null && bps > 0) return bps / 1e6;
  // Last-resort: sum individual ES bitrates (always an undercount)
  const total = (result?.programs || [])
    .flatMap(p => p.streams || [])
    .reduce((sum, s) => sum + (s.bitrate || 0), 0);
  return total > 0 ? total / 1e6 : null;
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
    <div
      className="px-2 py-1.5"
      style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '2px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}
    >
      <div className="text-[9px] uppercase tracking-widest engraved mb-0.5">{label}</div>
      <div className="text-gray-300 font-mono text-[11px]">{value}</div>
    </div>
  );
}

function updateAgeInfo(probeTime, nowMs, engineerMode = true) {
  if (!probeTime) {
    return { ageSec: null, label: engineerMode ? 'awaiting telemetry' : 'no sample yet', color: '#777' };
  }
  const ageSec = Math.max(0, Math.floor((nowMs - probeTime) / 1000));
  if (ageSec <= 2) return { ageSec, label: engineerMode ? 'fresh silicon' : 'live', color: '#00dd55' };
  if (ageSec <= 6) return { ageSec, label: engineerMode ? 'cache warming' : 'delayed', color: '#ffaa00' };
  return { ageSec, label: engineerMode ? 'radio silence' : 'stale', color: '#ff2233' };
}

function DecoderCard({ id, meta, result, onStop, nowMs, engineerMode }) {
  const primaryService = result?.dvb?.services?.[0]?.serviceName || result?.programs?.[0]?.name || 'Unknown';
  const serviceProvider = result?.dvb?.services?.[0]?.serviceProvider || null;
  const levelPct = audioPercent(result?.audioLevels);
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbSrc = result?.thumbnailUrl
    ? `${result.thumbnailUrl}${result.thumbnailUrl.includes('?') ? '&' : '?'}r=${result?.probeTime || Date.now()}`
    : null;
  useEffect(() => {
    setThumbFailed(false);
  }, [result?.thumbnailUrl, result?.probeTime]);

  const hasThumb = thumbSrc && !thumbFailed;
  const freshness = updateAgeInfo(result?.probeTime, nowMs, engineerMode);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ background: '#111', border: '1px solid #252525', borderRadius: '3px', boxShadow: '0 4px 16px rgba(0,0,0,0.6)' }}
    >
      {/* Bezel header */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 shrink-0"
        style={{ background: 'linear-gradient(180deg, #242424 0%, #1a1a1a 100%)', borderBottom: '1px solid #0a0a0a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
      >
        <StatusDot status="live" pulse />
        <span className="font-mono text-[10px] text-gray-400 truncate flex-1">{id}</span>
        <button
          onClick={onStop}
          className="text-[9px] font-bold uppercase px-2 py-0.5 shrink-0"
          style={{ background: 'rgba(180,30,30,0.3)', border: '1px solid rgba(220,50,50,0.3)', color: '#f87171', borderRadius: '2px' }}
        >
          Stop
        </button>
      </div>

      {/* Thumbnail monitor — explicit 16:9 with visible frame */}
      <div
        className="relative w-full overflow-hidden shrink-0"
        style={{ aspectRatio: '16/9', background: '#080808', borderBottom: '1px solid #1a1a1a', outline: '2px solid #1a1a1a' }}
      >
        {hasThumb ? (
          <img
            src={thumbSrc}
            alt={`${id} thumbnail`}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: 'cover', display: 'block' }}
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: '#1a1a1a', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)' }} />
            <span className="text-[9px] engraved uppercase tracking-widest">No Signal</span>
          </div>
        )}
        {/* CRT scanline overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 4px)' }}
        />
      </div>

      {/* Info panel */}
      <div className="p-2.5 space-y-2" style={{ background: '#141414' }}>
        <div className="text-[10px] font-mono truncate engraved">{meta?.url || result?.url || '-'}</div>
        <div
          className="text-[10px] font-mono uppercase tracking-wider"
          style={{ color: freshness.color }}
        >
          update age: {freshness.ageSec == null ? '-' : `${freshness.ageSec}s`} - {freshness.label}
        </div>
        <div className="text-[11px] text-gray-300 font-mono truncate">
          <span className="engraved">SVC </span>{primaryService}
          {serviceProvider ? <span className="engraved"> · {serviceProvider}</span> : null}
        </div>

        {/* Audio bar */}
        <div>
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="engraved uppercase tracking-widest">Audio</span>
            <span className="font-mono" style={{ color: levelPct > 75 ? '#ff2233' : levelPct > 45 ? '#ffaa00' : '#00dd55' }}>
              {result?.audioLevels?.meanDb != null ? `${result.audioLevels.meanDb.toFixed(1)} dB` : 'n/a'}
            </span>
          </div>
          <div style={{ height: '4px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '1px', overflow: 'hidden' }}>
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${levelPct}%`,
                background: levelPct > 75 ? '#ff2233' : levelPct > 45 ? '#ffaa00' : '#00dd55',
                boxShadow: levelPct > 5 ? `0 0 5px ${levelPct > 75 ? '#ff223388' : levelPct > 45 ? '#ffaa0088' : '#00dd5588'}` : 'none',
              }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-1">
          <Stat label="Programs" value={String(result?.programs?.length || 0)} />
          <Stat label="PIDs"     value={String(countPids(result))} />
          <Stat label="Bitrate"  value={resolveDisplayBitrateMbps(result) != null ? `${resolveDisplayBitrateMbps(result).toFixed(2)} Mbps` : '-'} />
          <Stat label="Last Probe" value={result?.probeTime ? new Date(result.probeTime).toLocaleTimeString() : '-'} />
        </div>
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
  const [nowMs, setNowMs] = useState(Date.now());
  const [engineerMode, setEngineerMode] = useState(true);

  useEffect(() => {
    refreshActives();
  }, [refreshActives]);

  useEffect(() => {
    if (lastMessage) onWsResult(lastMessage);
  }, [lastMessage, onWsResult]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
              onClick={() => setEngineerMode((v) => !v)}
              className={`text-xs px-2 py-1 rounded border ${
                engineerMode
                  ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              Engineer Mode: {engineerMode ? 'ON' : 'OFF'}
            </button>
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
            <div className="text-[10px] text-gray-500">
              Continuous probe cadence is target-based. Heavy bitrate/SI sampling runs every few cycles to reduce multiview lag.
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
              nowMs={nowMs}
              engineerMode={engineerMode}
            />
          ))}
        </div>
      </BentoCard>
    </div>
  );
}
