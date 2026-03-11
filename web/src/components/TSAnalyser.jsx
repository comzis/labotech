import React, { useState, useEffect } from 'react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import PidBadge from './PidBadge';
import { motion } from 'framer-motion';
import { Search, Activity, ShieldAlert } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';
import ETR290Panel from './ETR290Panel';

const PROBE_MODES = [
  { value: 'rtp', label: 'RTP',  desc: 'RTP/MPEG-TS' },
  { value: 'srt', label: 'SRT',  desc: 'Haivision SRT' },
  { value: 'udp', label: 'UDP',  desc: 'Legacy Multicast/Unicast' },
];
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

export default function TSAnalyser({ lastMessage }) {
  const [probeMode, setProbeMode] = useState('rtp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const [resultLocal, setResultLocal] = useState(null);

  const { loading, error, probe, onWsResult } = useTSAnalysis();

  useEffect(() => {
    if (lastMessage) onWsResult(lastMessage);
  }, [lastMessage, onWsResult]);

  const builtUrl = buildProbeUrl({ mode: probeMode, host, port, latency, passphrase });

  const handleProbe = async (e) => {
    e.preventDefault();
    if (!builtUrl) return;
    try {
      const r = await probe(builtUrl);
      setResultLocal(r);
    } catch (_) {
      setResultLocal(null);
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
      <BentoCard icon={Activity} title="Single Decoder Probe">
        <form onSubmit={handleProbe} className="space-y-4">

            {/* Protocol selector */}
            <div>
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1 mb-1.5 block">Protocol</label>
              <div className="grid grid-cols-3 gap-2">
                {PROBE_MODES.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setProbeMode(m.value)}
                    className={`px-3 py-2.5 rounded-xl border text-center transition-all ${probeMode === m.value
                      ? 'bg-neon-cyan/20 border-neon-cyan/50 text-white ring-1 ring-neon-cyan/50'
                      : 'bg-black/30 border-white/10 text-gray-500 hover:border-white/20 hover:bg-black/40'
                    }`}
                  >
                    <div className="text-xs font-bold">{m.label}</div>
                    <div className="text-[9px] opacity-60 mt-0.5 uppercase tracking-tighter">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Host + Port */}
            <div className="grid grid-cols-3 gap-4">
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

            {/* SRT-only options */}
            {probeMode === 'srt' && (
              <div className="grid grid-cols-2 gap-4">
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

          <div className="flex gap-4 items-center">
            <button
              type="submit"
              disabled={loading || !builtUrl}
              className="bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/30 px-6 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
            >
              {loading ? 'Probing…' : 'Probe Decoder'}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
        </form>
      </BentoCard>

      {/* Comprehensive ETR290 visibility inside TS Analyser */}
      <ETR290Panel lastMessage={lastMessage} />

      {/* Structure Matrix */}
      {resultLocal && (
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
                PID count: {countPids(resultLocal)}
              </div>
            </div>

            <BentoCard icon={ShieldAlert} title="DVB Professional Summary">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <Stat label="Standard" value={resultLocal?.dvb?.standard || 'MPEG-TS / DVB-SI'} />
                <Stat label="Service Count" value={String(resultLocal?.dvb?.serviceCount ?? (resultLocal.programs?.length || 0))} />
                <Stat label="PID Count" value={String(resultLocal?.dvb?.pidCount ?? countPids(resultLocal))} />
                <Stat label="Aggregate Bitrate" value={`${((resultLocal?.dvb?.bitrateBps || 0) / 1e6).toFixed(2)} Mbps`} />
              </div>
              {(resultLocal?.dvb?.services?.length || 0) > 0 && (
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
                      {resultLocal.dvb.services.map((s, i) => (
                        <tr key={`${s.serviceId}-${i}`} className="border-b border-white/5">
                          <td className="py-2 text-gray-300">{s.serviceId}</td>
                          <td className="py-2 text-gray-300">{s.serviceName || '-'}</td>
                          <td className="py-2 text-gray-400">{s.serviceProvider || '-'}</td>
                          <td className="py-2"><PidBadge pid={s.pmtPid} /></td>
                          <td className="py-2"><PidBadge pid={s.pcrPid} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BentoCard>

            <div className="grid grid-cols-1 gap-4">
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
    <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-gray-200 font-mono mt-1">{value}</div>
    </div>
  );
}
