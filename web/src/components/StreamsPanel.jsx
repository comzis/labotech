import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import useStreams from '../hooks/useStreams';
import { stopStream, stopTranscoder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import EncoderForm from './EncoderForm';
import { motion } from 'framer-motion';
import { C } from './BroadcastUI';

const THUMB_BASE = '/logs/thumbnails';
const EMBED_REFRESH_MS = parseInt(import.meta.env?.VITE_THUMB_INTERVAL_MS, 10) || 5000;
// Output mode pill — colour-coded for quick identification at a glance
const MODE_STYLE = {
  srt: 'bg-sky-900/60    text-sky-300    border-sky-700/40',
  udp: 'bg-orange-900/60 text-orange-300 border-orange-700/40',
  rtp: 'bg-violet-900/60 text-violet-300 border-violet-700/40',
};
const formatPidHex = (pid) => (pid == null ? 'N/A' : `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`);
const PidRef = ({ pid }) => (
  pid == null ? <span style={{ color: C.muted }}>N/A</span> : (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ color: C.text }}>{pid}</span>
      <span style={{ color: C.muted }}>{formatPidHex(pid)}</span>
    </span>
  )
);

export default function StreamsPanel({ lastMessage }) {
  const { streams, transcoders, loading, error, refresh } = useStreams();

  useEffect(() => {
    if (lastMessage?.type === 'stopped' || lastMessage?.type === 'transcode_stopped') {
      refresh();
    }
  }, [lastMessage, refresh]);

  const handleStop = async (id, isTranscoder) => {
    try {
      if (isTranscoder) await stopTranscoder(id);
      else await stopStream(id);
    } catch (err) {
      if (!err.message.includes('404') && !err.message.toLowerCase().includes('not found')) {
        toast.error(`Failed to stop ${id}: ${err.message}`);
      }
    }
    refresh();
  };

  const all = [
    ...streams.map(s => ({ ...s, _type: 'encoder' })),
    ...transcoders.map(t => ({ ...t, _type: 'transcoder' })),
  ];

  const running = all.filter(s => s.isRunning);
  const stopped = all.filter(s => !s.isRunning);

  const clearStopped = async () => {
    await Promise.all(stopped.map(s => handleStop(s.id, s._type === 'transcoder')));
  };

  return (
    <div className="broadcast-legacy" style={{ fontFamily: "'Courier New',monospace", color: C.text, display: 'grid', gap: 16 }}>
      <EncoderForm onStarted={refresh} />

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm text-gray-400 uppercase tracking-widest">
            Runtime Processes (Running {running.length} / Total {all.length})
          </h2>
          {stopped.length > 0 && (
            <button
              onClick={clearStopped}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 px-3 py-1 rounded transition-colors"
            >
              Clear Stopped ({stopped.length})
            </button>
          )}
        </div>

        {loading && <p className="text-gray-600 text-sm">Loading…</p>}
        {error && <p className="text-red-400  text-sm">{error}</p>}

        {!loading && all.length === 0 && (
          <p className="text-gray-600 text-sm">No active streams.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {all.map(s => {
            const mode = s.outputMode || 'srt';
            const dvb = s.dvb;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`bg-midnight-glass backdrop-blur-xl rounded-2xl p-4 space-y-3 relative overflow-hidden group transition-shadow duration-500
                  ${s.isRunning
                    ? 'border border-transparent ring-1 ring-cyan-500/20 shadow-[0_0_32px_-6px_rgba(34,211,238,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  }`}
              >
                {/* State accent strip — top edge colour coding */}
                <div className={`absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl ${
                  s.isRunning
                    ? 'bg-gradient-to-r from-cyan-500/80 via-cyan-400/40 to-transparent'
                    : 'bg-gradient-to-r from-gray-700/50 to-transparent'
                }`} />
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                {/* Header row */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={s.isRunning ? 'live' : 'stopped'} pulse />
                    <span className="font-mono text-sm font-semibold truncate">{s.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {/* Output mode badge */}
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${MODE_STYLE[mode] || MODE_STYLE.srt}`}>
                      {mode}
                    </span>
                    {s._type === 'transcoder' && (
                      <span className="text-[10px] bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/40">
                        {s.presetName || 'transcode'}
                      </span>
                    )}
                    {s.isRunning ? (
                      <button
                        onClick={() => handleStop(s.id, s._type === 'transcoder')}
                        className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded transition-colors"
                      >
                        Stop Process
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStop(s.id, s._type === 'transcoder')}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 px-2 py-1 rounded transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* DVB service identity */}
                {dvb?.serviceName && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Service:</span>
                    <span className="text-white font-semibold">{dvb.serviceName}</span>
                    {dvb.serviceProvider && <span className="text-gray-600">/ {dvb.serviceProvider}</span>}
                  </div>
                )}

                {/* Input source + detected streams */}
                <div className="text-xs text-gray-500 truncate">{s.input}</div>
                {s.inputStreams?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.inputStreams.map((st, i) => (
                      <span key={i} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        st.kind === 'video' ? 'bg-blue-900/40 text-blue-300 border-blue-700/40' : 'bg-green-900/40 text-green-300 border-green-700/40'
                      }`}>
                        {st.kind === 'video'
                          ? `${st.codec} ${st.width ? `${st.width}×${st.height}` : ''} ${st.fps ? `${st.fps}fps` : ''}`.trim()
                          : `${st.codec} ${st.sampleRate ? `${st.sampleRate}Hz` : ''}`.trim()
                        }
                      </span>
                    ))}
                  </div>
                )}

                {/* Destination + PIDs */}
                <div className="flex items-center gap-2 text-xs text-gray-600 font-mono flex-wrap">
                  <span>→ {s.host}:{s.port}</span>
                  {dvb && (
                    <span className="text-gray-700">
                      SID {dvb.serviceId} · V:<PidRef pid={dvb.videoPid} /> · PMT:<PidRef pid={dvb.pmtPid} />
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-gray-500">
                  Input bitrate: {s.inputBitrate
                    ? `${(s.inputBitrate / 1000).toFixed(2)} Mbps${s.inputBitrateSource ? ` (${s.inputBitrateSource})` : ''}`
                    : s.inputBitrateMeasuring
                      ? 'measuring...'
                      : s.isRunning
                        ? 'pending'
                        : '-'
                  } · Output bitrate: {s.lastStats?.bitrate
                    ? `${(s.lastStats.bitrate / 1000).toFixed(2)} Mbps`
                    : s.isRunning ? 'pending' : '-'}
                </div>

                {/* Audio pairs summary */}
                {s.audioPairs?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.audioPairs.map((p, i) => (
                      <span key={i} className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                        A{i} {p.codec} <PidRef pid={p.pid} />
                        {p.language ? ` [${p.language}]` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {/* Encoding profile */}
                {s.encodeProfile && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] font-mono bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/40">
                      {s.encodeProfile.videoCodec}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                      {s.encodeProfile.videoBitrate}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                      {s.encodeProfile.preset}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                      GOP {s.encodeProfile.gopSize}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      s.encodeProfile.rateMode === 'cbr'
                        ? 'bg-amber-900/40 text-amber-300 border-amber-700/40'
                        : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {(s.encodeProfile.rateMode || 'cbr').toUpperCase()}
                    </span>
                  </div>
                )}

                {s.isRunning && (
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-3 items-start">
                    <MetricsTile
                      id={s.id}
                      stats={s.lastStats}
                      inputBitrate={s.inputBitrate}
                      inputBitrateMeasuring={s.inputBitrateMeasuring}
                      lastMessage={lastMessage}
                    />
                    <ConfidenceEmbed stream={s} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ConfidenceEmbed({ stream }) {
  const [imgError, setImgError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), EMBED_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // Retry thumbnail load each refresh tick.
    setImgError(false);
  }, [tick, stream.id]);
  const thumbUrl = `${THUMB_BASE}/${stream.id}.jpg?t=${tick}`;
  const outputMbps = stream?.lastStats?.bitrate ? (stream.lastStats.bitrate / 1000).toFixed(2) : null;
  const inputBr = Number(stream?.inputBitrate);
  const inputMbps = Number.isFinite(inputBr) && inputBr > 0 ? (inputBr / 1000).toFixed(2) : null;

  return (
    <div className="bg-black/20 border border-white/5 rounded-2xl p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">Confidence (Embedded)</div>
      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40 aspect-video">
        {imgError ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">No thumbnail</div>
        ) : (
          <img
            src={thumbUrl}
            alt={stream.id}
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
            className="w-full h-full object-contain"
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="rounded border border-white/10 bg-black/30 px-2 py-1">
          <span className="text-gray-500">Input</span>{' '}
          <span className={inputMbps ? 'text-emerald-300' : 'text-gray-600'}>{inputMbps ? `${inputMbps} Mbps` : '-'}</span>
        </div>
        <div className="rounded border border-white/10 bg-black/30 px-2 py-1">
          <span className="text-gray-500">Output</span>{' '}
          <span className={outputMbps ? 'text-neon-cyan' : 'text-gray-600'}>{outputMbps ? `${outputMbps} Mbps` : '-'}</span>
        </div>
      </div>
    </div>
  );
}
