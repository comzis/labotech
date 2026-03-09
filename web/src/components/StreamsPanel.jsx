import React, { useEffect } from 'react';
import { toast } from 'sonner';
import useStreams from '../hooks/useStreams';
import { stopStream, stopTranscoder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import EncoderForm from './EncoderForm';
import { motion } from 'framer-motion';

// Output mode pill — colour-coded for quick identification at a glance
const MODE_STYLE = {
  srt: 'bg-sky-900/60    text-sky-300    border-sky-700/40',
  udp: 'bg-orange-900/60 text-orange-300 border-orange-700/40',
  rtp: 'bg-violet-900/60 text-violet-300 border-violet-700/40',
};

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
      refresh();
    } catch (err) {
      toast.error(`Failed to stop ${id}: ${err.message}`);
    }
  };

  const all = [
    ...streams.map(s => ({ ...s, _type: 'encoder' })),
    ...transcoders.map(t => ({ ...t, _type: 'transcoder' })),
  ];

  return (
    <div className="space-y-6">
      <EncoderForm onStarted={refresh} />

      <section>
        <h2 className="text-sm text-gray-400 mb-3 uppercase tracking-widest">
          Active Streams ({all.length})
        </h2>

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
                className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl p-4 space-y-3 relative overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={s.isRunning ? 'live' : 'stopped'} pulse />
                    <span className="font-mono text-sm font-semibold truncate">{s.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Output mode badge */}
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${MODE_STYLE[mode] || MODE_STYLE.srt}`}>
                      {mode}
                    </span>
                    {s._type === 'transcoder' && (
                      <span className="text-[10px] bg-purple-900 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/40">
                        {s.presetName || 'transcode'}
                      </span>
                    )}
                    {s.isRunning && (
                      <button
                        onClick={() => handleStop(s.id, s._type === 'transcoder')}
                        className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded transition-colors"
                      >
                        Stop
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

                {/* Input source */}
                <div className="text-xs text-gray-500 truncate">{s.input}</div>

                {/* Destination + PIDs */}
                <div className="flex items-center gap-3 text-xs text-gray-600 font-mono">
                  <span>→ {s.host}:{s.port}</span>
                  {dvb && (
                    <span className="text-gray-700">
                      SID {dvb.serviceId} · V:{`0x${dvb.videoPid?.toString(16).toUpperCase().padStart(4, '0')}`}
                    </span>
                  )}
                </div>

                {/* Audio pairs summary */}
                {s.audioPairs?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.audioPairs.map((p, i) => (
                      <span key={i} className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                        A{i} {p.codec} {`0x${p.pid?.toString(16).toUpperCase().padStart(4, '0')}`}
                        {p.language ? ` [${p.language}]` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {s.isRunning && (
                  <MetricsTile id={s.id} stats={s.lastStats} inputBitrate={s.inputBitrate} lastMessage={lastMessage} />
                )}
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
