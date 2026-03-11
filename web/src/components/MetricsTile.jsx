import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';

const MAX_HISTORY = 60;

// Broadcast-standard thresholds (EBU / SMPTE)
const rttColor  = ms  => !ms  ? 'text-gray-500' : ms  < 30  ? 'text-green-400' : ms  < 80  ? 'text-yellow-400' : 'text-red-400';
const lossColor = pct => !pct && pct !== 0 ? 'text-gray-500' : pct === 0 ? 'text-green-400' : pct < 1 ? 'text-yellow-400' : 'text-red-400';

export default function MetricsTile({ id, stats, inputBitrate: initInputBr, inputBitrateMeasuring: initInputBitrateMeasuring = false, lastMessage }) {
  const [history,      setHistory]      = useState([]);
  const [current,      setCurrent]      = useState(stats || null);
  const [srtStats,     setSrtStats]     = useState(null);
  const [inputBitrate, setInputBitrate] = useState(initInputBr || null);
  const [inputBitrateMeasuring, setInputBitrateMeasuring] = useState(Boolean(initInputBitrateMeasuring));
  const [inputStreams, setInputStreams] = useState(null);
  const [ffmpegError,  setFfmpegError]  = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);

  useEffect(() => {
    if (!lastMessage) return;
    if ((lastMessage.type === 'stats' || lastMessage.type === 'transcode_stats') && lastMessage.id === id) {
      setCurrent(lastMessage);
      setHistory(h => [...h.slice(-(MAX_HISTORY - 1)), { t: h.length, v: lastMessage.bitrate || 0 }]);
      if (lastMessage.inputBitrate) {
        setInputBitrate(lastMessage.inputBitrate);
        setInputBitrateMeasuring(false);
      }
      if (lastMessage.inputBitrateMeasuring != null) {
        setInputBitrateMeasuring(Boolean(lastMessage.inputBitrateMeasuring));
      }
      if (lastMessage.inputStreams) setInputStreams(lastMessage.inputStreams);
    }
    if (lastMessage.type === 'srtStats' && lastMessage.id === id) {
      setSrtStats(lastMessage);
    }
    if (lastMessage.type === 'error' && lastMessage.id === id) {
      setFfmpegError(lastMessage.message);
    }
    if (lastMessage.type === 'info' && lastMessage.id === id) {
      setInfoMessage(lastMessage.message);
      setTimeout(() => setInfoMessage(null), 8000);
    }
  }, [lastMessage, id]);

  useEffect(() => {
    if (initInputBr != null && Number.isFinite(initInputBr) && initInputBr > 0) {
      setInputBitrate(initInputBr);
    }
  }, [initInputBr]);
  useEffect(() => {
    setInputBitrateMeasuring(Boolean(initInputBitrateMeasuring));
  }, [initInputBitrateMeasuring]);

  // Broadcast standard: display TS bitrate in Mbps
  const mbps      = current?.bitrate ? (current.bitrate / 1000).toFixed(2) : null;
  const inputMbps = inputBitrate ? (inputBitrate / 1000).toFixed(2) : null;
  const fps    = current?.fps     ? current.fps     : null;
  const speed  = current?.speed   ? current.speed   : null;
  const frame  = current?.frame   ? current.frame   : null;

  const inputLocked  = fps > 0;
  const outputActive = current?.bitrate > 0;

  return (
    <div className="bg-[#0d1117] border border-white/8 rounded-2xl p-4 flex flex-col gap-3 backdrop-blur-sm shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_24px_rgba(0,0,0,0.45)]">

      {/* Input / Output status row */}
      <div className="grid grid-cols-2 gap-2">
        <StatusPill label="INPUT"  locked={inputLocked}  activeLabel="LOCKED"    idleLabel="NO SIGNAL" />
        <StatusPill label="OUTPUT" locked={outputActive} activeLabel="ACTIVE"    idleLabel="IDLE"      />
      </div>

      {/* FFmpeg error banner */}
      {ffmpegError && (
        <div className="bg-red-950/60 border border-red-700/40 rounded-lg px-3 py-2 text-[10px] text-red-300 font-mono break-all">
          {ffmpegError}
        </div>
      )}
      {infoMessage && (
        <div className="bg-sky-950/60 border border-sky-700/40 rounded-lg px-3 py-2 text-[10px] text-sky-300 font-mono break-all">
          {infoMessage}
        </div>
      )}

      {/* Input / Output bitrates */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Input</span>
          <span className={`font-mono text-xl font-bold tracking-tight ${inputMbps ? 'text-emerald-400' : inputBitrateMeasuring ? 'text-gray-400' : 'text-gray-600'}`}>
            {inputMbps
              ? `${inputMbps} Mbps`
              : inputBitrateMeasuring
                ? 'measuring...'
                : '-'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Output</span>
          <span className={`font-mono text-xl font-bold tracking-tight ${mbps ? 'text-sky-400' : 'text-gray-600'}`}>
            {mbps ? `${mbps} Mbps` : '—'}
          </span>
        </div>
      </div>

      {/* Output bitrate sparkline */}
      <div className="space-y-1">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Transport Bitrate</span>
        <ResponsiveContainer width="100%" height={36}>
          <AreaChart data={history} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <YAxis domain={[0, 'auto']} hide />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 10 }}
              formatter={v => [`${(v / 1000).toFixed(2)} Mbps`, 'Bitrate']}
              labelFormatter={() => ''}
            />
            <Area
              type="monotone" dataKey="v"
              stroke="#22d3ee" strokeWidth={1.5}
              fill={`url(#grad-${id})`}
              dot={false} isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Encode metrics row */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="FPS"   value={fps   ? `${fps} fps`   : '—'} color="text-green-400"  />
        <Metric label="Speed" value={speed ? `${speed}x`    : '—'} color="text-yellow-400" />
        <Metric label="Frame" value={frame ? frame           : '—'} color="text-gray-300"   />
      </div>

      {/* Haivision SRT Health Panel — only shown when SRT caller is active */}
      <AnimatePresence>
        {srtStats && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-white/5 pt-3 space-y-2"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Wifi className="w-3.5 h-3.5 text-neon-cyan" strokeWidth={2} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-neon-cyan">SRT Link</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <Metric label="RTT"       value={srtStats.rttMs    != null ? `${srtStats.rttMs}ms`       : '—'} color={rttColor(srtStats.rttMs)}    />
              <Metric label="BW Avail"  value={srtStats.bwMbps   != null ? `${srtStats.bwMbps}Mbps`    : '—'} color="text-sky-300"                 />
              <Metric label="Send Rate" value={srtStats.rateMbps != null ? `${srtStats.rateMbps}Mbps`  : '—'} color="text-indigo-300"              />
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <Metric label="Total"   value={srtStats.pktTotal   ?? '—'} color="text-gray-400"   />
              <Metric label="Retrans" value={srtStats.pktRetrans ?? '—'} color="text-orange-400" />
              <Metric label="Loss"    value={srtStats.pktLoss    ?? '—'} color={lossColor(srtStats.lossPercent)} />
              <Metric label="NAK"     value={srtStats.pktNak     ?? '—'} color="text-red-400"    />
            </div>

            {/* Loss % bar — broadcast-standard traffic light */}
            {srtStats.lossPercent != null && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Packet Loss</span>
                  <span className={lossColor(srtStats.lossPercent)}>
                    {srtStats.lossPercent.toFixed(2)}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      srtStats.lossPercent === 0 ? 'bg-green-500'
                      : srtStats.lossPercent < 1 ? 'bg-yellow-500'
                      : 'bg-red-500'
                    }`}
                    animate={{ width: `${Math.min(srtStats.lossPercent * 10, 100)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div>
      <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function StatusPill({ label, locked, activeLabel, idleLabel }) {
  return (
    <div className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg border text-[9px] font-semibold uppercase tracking-wide min-w-0
      ${locked
        ? 'bg-green-950/60 border-green-700/40 text-green-400'
        : 'bg-gray-900/60  border-gray-700/40  text-gray-500'
      }`}
    >
      <span className="flex items-center gap-1 shrink-0 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${locked ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
        <span className="text-gray-500">{label}</span>
      </span>
      <span className="truncate">{locked ? activeLabel : idleLabel}</span>
    </div>
  );
}
