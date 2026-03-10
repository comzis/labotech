import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { getStreams, getTranscoders } from '../api';
import StatusDot from './StatusDot';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Monitor } from 'lucide-react';

const THUMB_BASE = '/logs/thumbnails';
const REFRESH_MS = parseInt(import.meta.env?.VITE_THUMB_INTERVAL_MS) || 5000;

export default function ConfidenceMonitor({ lastMessage }) {
  const [streams, setStreams] = useState([]);
  const [transcoders, setTranscoders] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [tick, setTick] = useState(0);

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
    ...streams.map(s => ({ ...s, _type: 'encoder' })),
    ...transcoders.map(t => ({ ...t, _type: 'transcoder' })),
  ].filter(s => s.isRunning);

  return (
    <div className="space-y-8 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-neon-blue" strokeWidth={1.5} />
            Confidence Monitor
          </h1>
          <p className="text-xs text-gray-500 mt-1 uppercase tracking-widest font-medium opacity-80">Real-time Visual QC & Signal Integrity</p>
        </div>
        {loadError && (
          <span className="text-xs text-red-400 font-mono bg-red-900/20 border border-red-500/20 px-3 py-1.5 rounded-full animate-pulse">
            ⚠ {loadError}
          </span>
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

  // Reset error on every tick so we retry the file after it's been written
  useEffect(() => { setImgError(false); }, [tick]);

  // Prefer live WS bitrate; fall back to last REST-polled value
  const bitrate = liveBitrate ?? s.lastStats?.bitrate;
  const mbps = bitrate ? (bitrate / 1000).toFixed(2) : null;

  const dvb = s.dvb;
  const mode = s.outputMode || 'srt';

  const MODE_DOT = {
    srt: 'bg-sky-500',
    udp: 'bg-orange-500',
    rtp: 'bg-violet-500',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-midnight-glass border border-white/5 backdrop-blur-xl rounded-2xl overflow-hidden group"
    >
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
      <div className="p-3 space-y-2 relative z-10">
        <div className="flex items-center gap-3">
          <StatusDot status="live" pulse />
          <span className="text-[11px] font-mono text-gray-200 truncate font-semibold flex-1 tracking-tight">{s.id}</span>
          {mbps && (
            <span className={`text-[11px] font-mono font-bold ${parseFloat(mbps) > 0 ? 'text-neon-cyan' : 'text-red-400'}`}>
              {mbps} Mbps
            </span>
          )}
        </div>

        <div className="flex flex-col gap-0.5 opacity-60">
          {/* DVB service name if declared */}
          {dvb?.serviceName && (
            <div className="text-[9px] text-gray-400 truncate uppercase tracking-wider font-bold">
              {dvb.serviceName}
              {dvb.serviceProvider ? ` · ${dvb.serviceProvider}` : ''}
            </div>
          )}

          {/* SID + Video PID */}
          {dvb && (
            <div className="text-[9px] text-gray-500 font-mono">
              SID {dvb.serviceId} • VPID 0x{dvb.videoPid?.toString(16).toUpperCase().padStart(4, '0')}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
