import React, { useState, useEffect } from 'react';
import { getStreams, getTranscoders } from '../api';
import StatusDot from './StatusDot';

const THUMB_BASE = '/logs/thumbnails';
const REFRESH_MS = parseInt(import.meta.env?.VITE_THUMB_INTERVAL_MS) || 5000;

export default function ConfidenceMonitor() {
  const [streams,     setStreams]     = useState([]);
  const [transcoders, setTranscoders] = useState([]);
  const [tick,        setTick]        = useState(0);

  const load = async () => {
    try {
      const [s, t] = await Promise.all([getStreams(), getTranscoders()]);
      setStreams(s);
      setTranscoders(t);
    } catch (_) {}
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      setTick(t => t + 1);
      load();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const all = [
    ...streams.map(s => ({ ...s, _type: 'encoder' })),
    ...transcoders.map(t => ({ ...t, _type: 'transcoder' })),
  ].filter(s => s.isRunning);

  return (
    <div className="space-y-4">
      <h2 className="text-sm text-gray-400 uppercase tracking-widest">
        Confidence Monitor ({all.length} active)
      </h2>

      {all.length === 0 && (
        <p className="text-gray-600 text-sm">No active streams to monitor.</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {all.map(s => (
          <ThumbnailCard key={s.id} stream={s} tick={tick} />
        ))}
      </div>
    </div>
  );
}

function ThumbnailCard({ stream: s, tick }) {
  const [imgError, setImgError] = useState(false);
  const thumbUrl = `${THUMB_BASE}/${s.id}.jpg?t=${tick}`;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div className="relative aspect-video bg-gray-950">
        {imgError ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-700 text-xs">
            No thumbnail
          </div>
        ) : (
          <img
            src={thumbUrl}
            alt={s.id}
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
            className="w-full h-full object-contain"
          />
        )}
      </div>
      <div className="p-2 flex items-center gap-2">
        <StatusDot status="live" pulse />
        <span className="text-xs font-mono text-gray-300 truncate">{s.id}</span>
        {s.lastStats?.bitrate && (
          <span className="ml-auto text-xs text-blue-400 font-mono">
            {s.lastStats.bitrate.toFixed(0)} kbps
          </span>
        )}
      </div>
    </div>
  );
}
