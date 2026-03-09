import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { getStreams, getTranscoders } from '../api';
import StatusDot from './StatusDot';

const THUMB_BASE  = '/logs/thumbnails';
const REFRESH_MS  = parseInt(import.meta.env?.VITE_THUMB_INTERVAL_MS) || 5000;

export default function ConfidenceMonitor({ lastMessage }) {
  const [streams,     setStreams]     = useState([]);
  const [transcoders, setTranscoders] = useState([]);
  const [loadError,   setLoadError]   = useState(null);
  const [tick,        setTick]        = useState(0);

  // Per-stream live bitrate fed from WebSocket — avoids stale REST poll values
  const [liveBitrates, setLiveBitrates] = useState({});

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([getStreams(), getTranscoders()]);
      setStreams(s);
      setTranscoders(t);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
      toast.error(`Confidence Monitor: ${err.message}`, { id: 'conf-load-err' });
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => { setTick(t => t + 1); load(); }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Update live bitrates from WS stats messages
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'stats' || lastMessage.type === 'transcode_stats') {
      const { id, bitrate } = lastMessage;
      if (id && bitrate != null) {
        setLiveBitrates(b => ({ ...b, [id]: bitrate }));
      }
    }
    if (lastMessage.type === 'stopped' || lastMessage.type === 'transcode_stopped') {
      load();
    }
  }, [lastMessage, load]);

  const all = [
    ...streams.map(s    => ({ ...s, _type: 'encoder'    })),
    ...transcoders.map(t => ({ ...t, _type: 'transcoder' })),
  ].filter(s => s.isRunning);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-gray-400 uppercase tracking-widest">
          Confidence Monitor ({all.length} active)
        </h2>
        {loadError && (
          <span className="text-xs text-red-400 font-mono">⚠ {loadError}</span>
        )}
      </div>

      {all.length === 0 && !loadError && (
        <p className="text-gray-600 text-sm">No active streams to monitor.</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {all.map(s => (
          <ThumbnailCard
            key={s.id}
            stream={s}
            tick={tick}
            liveBitrate={liveBitrates[s.id]}
          />
        ))}
      </div>
    </div>
  );
}

function ThumbnailCard({ stream: s, tick, liveBitrate }) {
  const [imgError, setImgError] = useState(false);
  const thumbUrl = `${THUMB_BASE}/${s.id}.jpg?t=${tick}`;

  // Prefer live WS bitrate; fall back to last REST-polled value
  const bitrate = liveBitrate ?? s.lastStats?.bitrate;
  const mbps    = bitrate ? (bitrate / 1000).toFixed(2) : null;

  const dvb = s.dvb;
  const mode = s.outputMode || 'srt';

  const MODE_DOT = {
    srt: 'bg-sky-500',
    udp: 'bg-orange-500',
    rtp: 'bg-violet-500',
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Thumbnail frame */}
      <div className="relative aspect-video bg-gray-950">
        {imgError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-700 text-xs">
            <span className="text-lg">📺</span>
            <span>No thumbnail</span>
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

        {/* Output mode dot — top-right overlay */}
        <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${MODE_DOT[mode] || MODE_DOT.srt}`} title={mode.toUpperCase()} />
      </div>

      {/* Service identity + metrics */}
      <div className="p-2 space-y-1">
        <div className="flex items-center gap-2">
          <StatusDot status="live" pulse />
          <span className="text-xs font-mono text-gray-300 truncate flex-1">{s.id}</span>
          {mbps && (
            <span className={`text-xs font-mono font-bold ${parseFloat(mbps) > 0 ? 'text-sky-400' : 'text-red-400'}`}>
              {mbps} Mbps
            </span>
          )}
        </div>

        {/* DVB service name if declared */}
        {dvb?.serviceName && (
          <div className="text-[10px] text-gray-500 truncate font-mono">
            {dvb.serviceName}
            {dvb.serviceProvider ? ` · ${dvb.serviceProvider}` : ''}
          </div>
        )}

        {/* SID + Video PID */}
        {dvb && (
          <div className="text-[10px] text-gray-700 font-mono">
            SID {dvb.serviceId} · VPID 0x{dvb.videoPid?.toString(16).toUpperCase().padStart(4,'0')}
          </div>
        )}
      </div>
    </div>
  );
}
