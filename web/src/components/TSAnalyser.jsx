import React, { useState, useEffect } from 'react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import PidBadge from './PidBadge';
import StatusDot from './StatusDot';

export default function TSAnalyser({ lastMessage }) {
  const [url,      setUrl]      = useState('');
  const [contId,   setContId]   = useState('');
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
    <div className="space-y-6">
      {/* Input */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
        <h2 className="text-sm text-gray-400 mb-4 uppercase tracking-widest">TS Analyser</h2>
        <form onSubmit={handleProbe} className="flex gap-3 flex-wrap">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="udp://239.x.x.x:port or srt://..."
            className="flex-1 min-w-64 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={loading || !url}
            className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white text-sm px-4 py-2 rounded"
          >
            {loading ? 'Probing…' : 'One-shot Probe'}
          </button>
          <button
            type="button"
            onClick={handleContinuous}
            disabled={!url && !activeId}
            className={`text-sm px-4 py-2 rounded transition-colors ${
              activeId
                ? 'bg-red-800 hover:bg-red-700 text-red-200'
                : 'bg-yellow-800 hover:bg-yellow-700 text-yellow-200'
            } disabled:opacity-50`}
          >
            {activeId ? 'Stop Continuous' : 'Start Continuous'}
          </button>
        </form>
        {activeId && (
          <div className="mt-3 flex items-center gap-2 text-xs text-green-400">
            <StatusDot status="live" pulse />
            Continuous probe: {activeId}
          </div>
        )}
        {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className="text-xs text-gray-500">
            Probed: <span className="text-gray-300">{result.url}</span>
            {result.probeTime && (
              <span className="ml-3 text-gray-600">
                at {new Date(result.probeTime).toLocaleTimeString()}
              </span>
            )}
          </div>

          {result.programs?.map(prog => (
            <ProgramBlock key={prog.programId} prog={prog} />
          ))}

          {result.orphanStreams?.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h3 className="text-xs text-gray-500 mb-2">Orphan Streams (not in any program)</h3>
              <div className="space-y-1">
                {result.orphanStreams.map(s => <StreamRow key={s.index} stream={s} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgramBlock({ prog }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm font-semibold text-white">
          Program {prog.programId}
          {prog.name && <span className="ml-2 text-gray-400">— {prog.name}</span>}
        </span>
        <div className="flex gap-2 text-xs text-gray-600">
          <span>PMT: <PidBadge pid={prog.pmtPid} /></span>
          <span>PCR: <PidBadge pid={prog.pcrPid} /></span>
        </div>
      </div>
      <div className="space-y-1">
        {prog.streams?.map(s => <StreamRow key={s.index} stream={s} />)}
      </div>
    </div>
  );
}

function StreamRow({ stream: s }) {
  const typeColor = {
    video: 'text-blue-400',
    audio: 'text-green-400',
    data:  'text-yellow-400',
  }[s.codecType] || 'text-gray-400';

  return (
    <div className="flex items-center gap-3 text-xs py-1 border-b border-gray-800 last:border-0">
      <PidBadge pid={s.pid} />
      <span className={`w-12 font-semibold ${typeColor}`}>{s.codecType}</span>
      <span className="text-gray-300 w-16">{s.codecName}</span>
      {s.width      && <span className="text-gray-500">{s.width}×{s.height}</span>}
      {s.fps        && <span className="text-gray-500">{s.fps}</span>}
      {s.sampleRate && <span className="text-gray-500">{s.sampleRate}Hz {s.channels}ch</span>}
      {s.bitrate    && <span className="text-gray-500">{(s.bitrate / 1000000).toFixed(2)} Mbps</span>}
      {s.language   && <span className="text-gray-600">[{s.language}]</span>}
    </div>
  );
}
