import React, { useState, useEffect } from 'react';
import Sparkline from './Sparkline';

const MAX_HISTORY = 60;

export default function MetricsTile({ id, stats, lastMessage }) {
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(stats || null);

  useEffect(() => {
    if (!lastMessage) return;
    if ((lastMessage.type === 'stats' || lastMessage.type === 'transcode_stats') &&
        lastMessage.id === id) {
      setCurrent(lastMessage);
      setHistory(h => [...h.slice(-(MAX_HISTORY - 1)), lastMessage.bitrate || 0]);
    }
  }, [lastMessage, id]);

  const bitrate = current?.bitrate ? `${current.bitrate.toFixed(0)} kbps` : '—';
  const fps     = current?.fps     ? `${current.fps} fps`                 : '—';
  const speed   = current?.speed   ? `${current.speed}x`                  : '—';
  const frame   = current?.frame   ? current.frame                         : '—';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-mono">{id}</span>
        <Sparkline data={history} width={100} height={24} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Metric label="Bitrate" value={bitrate} color="text-blue-400" />
        <Metric label="FPS"     value={fps}     color="text-green-400" />
        <Metric label="Speed"   value={speed}   color="text-yellow-400" />
        <Metric label="Frame"   value={frame}   color="text-gray-300" />
      </div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div className="text-xs text-gray-600">{label}</div>
      <div className={`font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}
