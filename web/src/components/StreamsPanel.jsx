import React, { useEffect } from 'react';
import useStreams from '../hooks/useStreams';
import { stopStream, stopTranscoder } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import EncoderForm from './EncoderForm';

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
      alert(err.message);
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
        {error   && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && all.length === 0 && (
          <p className="text-gray-600 text-sm">No active streams.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {all.map(s => (
            <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot status={s.isRunning ? 'live' : 'stopped'} pulse />
                  <span className="font-mono text-sm font-semibold">{s.id}</span>
                  {s._type === 'transcoder' && (
                    <span className="text-xs bg-purple-900 text-purple-300 px-1.5 rounded">
                      {s.presetName || 'transcode'}
                    </span>
                  )}
                </div>
                {s.isRunning && (
                  <button
                    onClick={() => handleStop(s.id, s._type === 'transcoder')}
                    className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>

              <div className="text-xs text-gray-500 truncate">{s.input}</div>
              <div className="text-xs text-gray-600">
                → {s.host}:{s.port}
              </div>

              {s.isRunning && (
                <MetricsTile id={s.id} stats={s.lastStats} lastMessage={lastMessage} />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
