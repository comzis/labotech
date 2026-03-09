import React, { useState, useEffect } from 'react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import PidBadge from './PidBadge';
import StatusDot from './StatusDot';
import { motion } from 'framer-motion';
import { Search, Zap, Activity } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';

export default function TSAnalyser({ lastMessage }) {
  const [url, setUrl] = useState('');
  const [contId, setContId] = useState('');
  const [interval, setInterval] = useState(5000);

  // Single hook instance — onWsResult must come from the same instance as result/loading/etc.
  const { result, loading, error, activeId, probe, startContinuous, stop, onWsResult } = useTSAnalysis();

  // Feed WS analyse_result messages into the hook
  useEffect(() => {
    if (lastMessage) onWsResult(lastMessage);
  }, [lastMessage, onWsResult]);

  const handleProbe = (e) => {
    e.preventDefault();
    if (url) probe(url);
  };

  const handleContinuous = (e) => {
    e.preventDefault();
    if (activeId) {
      stop();
    } else {
      startContinuous(contId || `analyser-${Date.now()}`, url, parseInt(interval));
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <Search className="w-6 h-6 text-neon-cyan" strokeWidth={1.5} />
          Analysis Matrix
        </h1>
        <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-medium opacity-80">Deep Packet Inspection & Service Validation</p>
      </div>

      {/* Control Bento Card */}
      <BentoCard icon={Activity} title="Probe Configuration">
        <form onSubmit={handleProbe} className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Field
                label="Source URL *"
                value={url}
                onChange={setUrl}
                placeholder="udp://239.x.x.x:port or srt://..."
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !url}
              className="bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/30 px-6 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
            >
              {loading ? 'Probing…' : 'One-shot'}
            </button>
            <button
              type="button"
              onClick={handleContinuous}
              disabled={!url && !activeId}
              className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${activeId
                ? 'bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-500/30'
                : 'bg-gradient-to-r from-neon-purple to-purple-600 text-white shadow-lg shadow-neon-purple/20'
                } disabled:opacity-50`}
            >
              {activeId ? 'Stop Continuous' : 'Start Continuous'}
            </button>
          </div>

          {activeId && (
            <div className="flex items-center gap-2 text-xs text-neon-cyan font-mono animate-pulse">
              <StatusDot status="live" pulse />
              Active Analysis: {activeId}
            </div>
          )}
          {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
        </form>
      </BentoCard>

      {/* Results Matrix */}
      {result && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold">
              Packet Structure
            </h2>
            <div className="text-[10px] text-gray-500 font-mono">
              PID count: {result.programs?.reduce((acc, p) => acc + (p.streams?.length || 0), 0) + (result.orphanStreams?.length || 0)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {result.programs?.map(prog => (
              <ProgramBlock key={prog.programId} prog={prog} />
            ))}

            {result.orphanStreams?.length > 0 && (
              <div className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-5 relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4">Orphan Matrix</h3>
                <div className="space-y-1 relative z-10">
                  {result.orphanStreams.map(s => <StreamRow key={s.index} stream={s} />)}
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
    <div className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-5 relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-white uppercase tracking-wider">
            Program {prog.programId}
            {prog.name && <span className="ml-2 text-gray-400 opacity-70">— {prog.name}</span>}
          </span>
        </div>
        <div className="flex gap-3 text-[10px] font-mono text-gray-500">
          <span className="flex items-center gap-1.5">PMT <PidBadge pid={prog.pmtPid} /></span>
          <span className="flex items-center gap-1.5">PCR <PidBadge pid={prog.pcrPid} /></span>
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
    <div className="flex items-center gap-3 text-xs py-1 border-b border-gray-800 last:border-0">
      <PidBadge pid={s.pid} />
      <span className={`w-12 font-semibold ${typeColor}`}>{s.codecType}</span>
      <span className="text-gray-300 w-16">{s.codecName}</span>
      {s.width && <span className="text-gray-500">{s.width}×{s.height}</span>}
      {s.fps && <span className="text-gray-500">{s.fps}</span>}
      {s.sampleRate && <span className="text-gray-500">{s.sampleRate}Hz {s.channels}ch</span>}
      {s.bitrate && <span className="text-gray-500">{(s.bitrate / 1000000).toFixed(2)} Mbps</span>}
      {s.language && <span className="text-gray-600">[{s.language}]</span>}
    </div>
  );
}
