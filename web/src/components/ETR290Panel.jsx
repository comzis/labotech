import React, { useEffect } from 'react';
import useETR290 from '../hooks/useETR290';
import StatusDot from './StatusDot';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';
import { ShieldAlert, Activity } from 'lucide-react';
import { useState } from 'react';

const PRIORITY_META = {
  p1: { label: 'Priority 1', desc: 'Service not receivable', color: 'red',    border: 'border-red-500/30',    bg: 'bg-red-900/20',    text: 'text-red-400',    dot: 'bg-red-400'    },
  p2: { label: 'Priority 2', desc: 'Quality impaired',       color: 'amber',  border: 'border-amber-500/30',  bg: 'bg-amber-900/20',  text: 'text-amber-400',  dot: 'bg-amber-400'  },
  p3: { label: 'Priority 3', desc: 'Informational',          color: 'sky',    border: 'border-sky-500/30',    bg: 'bg-sky-900/20',    text: 'text-sky-400',    dot: 'bg-sky-400'    },
};

const ETR_CHECKS = {
  p1: [
    { id: 'ts_sync',   label: 'TS Sync Loss'   },
    { id: 'sync_byte', label: 'Sync Byte Error' },
    { id: 'pat_error', label: 'PAT Error'       },
    { id: 'cc_error',  label: 'CC Error'        },
    { id: 'pmt_error', label: 'PMT Error'       },
    { id: 'pid_error', label: 'PID Error'       },
  ],
  p2: [
    { id: 'transport_error', label: 'Transport Error'   },
    { id: 'crc_error',       label: 'CRC Error'         },
    { id: 'pcr_disc',        label: 'PCR Discontinuity' },
    { id: 'pcr_acc',         label: 'PCR Accuracy'      },
    { id: 'pcr_rep',         label: 'PCR Repetition'    },
    { id: 'pts_error',       label: 'PTS Error'         },
    { id: 'cat_error',       label: 'CAT Error'         },
  ],
  p3: [
    { id: 'nit_error', label: 'NIT Error'    },
    { id: 'sdt_error', label: 'SDT Error'    },
    { id: 'eit_error', label: 'EIT Error'    },
    { id: 'rst_error', label: 'RST Error'    },
    { id: 'tdt_error', label: 'TDT Error'    },
    { id: 'empty_buf', label: 'Empty Buffer' },
  ],
};

function TrafficLight({ ok }) {
  return (
    <div className="flex gap-1 items-center">
      <span className={`w-3 h-3 rounded-full ${ok ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-gray-700'}`} />
      <span className={`w-3 h-3 rounded-full ${!ok ? 'bg-red-500 shadow-[0_0_6px_#ef4444] animate-pulse' : 'bg-gray-700'}`} />
    </div>
  );
}

function CheckRow({ check, status, count }) {
  const ok = status !== 'error';
  return (
    <div className={`flex items-center justify-between py-1.5 px-3 rounded-lg mb-1 ${ok ? 'bg-white/[0.02]' : 'bg-red-900/20 border border-red-500/20'}`}>
      <div className="flex items-center gap-3">
        <TrafficLight ok={ok} />
        <span className={`text-xs font-mono ${ok ? 'text-gray-400' : 'text-red-300 font-semibold'}`}>
          {check.label}
        </span>
      </div>
      {count > 0 && (
        <span className="text-[10px] font-mono text-red-400 bg-red-900/40 px-1.5 py-0.5 rounded">
          {count}
        </span>
      )}
    </div>
  );
}

function PriorityBlock({ priorityKey, meta, checks, status, counts }) {
  const hasError = checks.some(c => status?.[c.id] === 'error');
  return (
    <div className={`rounded-2xl border p-4 ${hasError ? meta.border + ' ' + meta.bg : 'border-white/5 bg-midnight-glass'}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className={`text-xs font-bold uppercase tracking-widest ${hasError ? meta.text : 'text-gray-400'}`}>
            {meta.label}
          </span>
          <span className="text-[10px] text-gray-600 ml-2">{meta.desc}</span>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full ${hasError ? meta.dot + ' animate-pulse shadow-lg' : 'bg-green-500'}`} />
      </div>
      <div>
        {checks.map(c => (
          <CheckRow
            key={c.id}
            check={c}
            status={status?.[c.id] || 'ok'}
            count={counts?.[c.id] || 0}
          />
        ))}
      </div>
    </div>
  );
}

function AlarmTable({ alarms }) {
  if (!alarms?.length) {
    return <p className="text-gray-600 text-xs text-center py-6">No alarms — stream nominal</p>;
  }
  return (
    <div className="overflow-auto max-h-64 rounded-xl border border-white/5">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-white/5 text-gray-500 uppercase tracking-widest text-[10px]">
            <th className="text-left px-3 py-2 w-36">Time</th>
            <th className="text-left px-3 py-2 w-16">Pri</th>
            <th className="text-left px-3 py-2 w-32">Check</th>
            <th className="text-left px-3 py-2">Message</th>
          </tr>
        </thead>
        <tbody>
          {alarms.map((a, i) => {
            const meta = PRIORITY_META[a.priority];
            return (
              <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="px-3 py-1.5 text-gray-500">{new Date(a.time).toLocaleTimeString()}</td>
                <td className={`px-3 py-1.5 font-bold ${meta?.text || 'text-gray-400'}`}>
                  {a.priority?.toUpperCase()}
                </td>
                <td className="px-3 py-1.5 text-gray-300">{a.label}</td>
                <td className="px-3 py-1.5 text-gray-500 truncate max-w-xs">{a.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PROBE_MODES = [
  { value: 'udp', label: 'UDP',  desc: 'Multicast/Unicast' },
  { value: 'rtp', label: 'RTP',  desc: 'RTP/MPEG-TS' },
  { value: 'srt', label: 'SRT',  desc: 'Haivision SRT' },
];

function buildMonitorUrl({ mode, host, port, latency, passphrase }) {
  if (!host || !port) return '';
  if (mode === 'udp') return `udp://${host}:${port}`;
  if (mode === 'rtp') return `rtp://${host}:${port}`;
  let url = `srt://${host}:${port}`;
  const params = [];
  if (latency)    params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join('&')}`;
  return url;
}

export default function ETR290Panel({ lastMessage }) {
  const [probeMode, setProbeMode] = useState('udp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const { status, activeId, error, start, stop, onWsMessage } = useETR290();

  useEffect(() => {
    if (lastMessage) onWsMessage(lastMessage);
  }, [lastMessage, onWsMessage]);

  const builtUrl = buildMonitorUrl({ mode: probeMode, host, port, latency, passphrase });

  const handleToggle = (e) => {
    e.preventDefault();
    if (activeId) {
      stop();
    } else if (builtUrl) {
      start(`etr290-${Date.now()}`, builtUrl);
    }
  };

  const totalAlarms = status?.recentAlarms?.length || 0;
  const p1Error = ETR_CHECKS.p1.some(c => status?.status?.[c.id] === 'error');
  const p2Error = ETR_CHECKS.p2.some(c => status?.status?.[c.id] === 'error');

  return (
    <div className="space-y-6">
      {/* Control */}
      <BentoCard icon={ShieldAlert} title="ETR 290 Monitor">
        <form onSubmit={handleToggle} className="space-y-4">

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
                label={probeMode === 'udp' ? 'Multicast / Unicast IP *' : 'Host *'}
                value={host}
                onChange={setHost}
                placeholder={probeMode === 'udp' ? '239.100.25.29' : '10.67.18.29'}
                required={!activeId}
              />
            </div>
            <Field label="Port *" value={port} onChange={setPort} type="number" placeholder="5000" required={!activeId} />
          </div>

          {/* SRT-only options */}
          {probeMode === 'srt' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
              <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="Optional" />
            </div>
          )}

          {/* URL preview */}
          {builtUrl && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-gray-500 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
              <span className="text-gray-600 shrink-0">URL:</span>
              <span className="text-neon-cyan/70 truncate">{builtUrl}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!builtUrl && !activeId}
            className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
              activeId
                ? 'bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-500/30'
                : 'bg-gradient-to-r from-neon-purple to-purple-600 text-white shadow-lg shadow-neon-purple/20'
            } disabled:opacity-50`}
          >
            {activeId ? 'Stop Monitor' : 'Start Monitor'}
          </button>
        </form>

        {activeId && (
          <div className="flex items-center gap-2 mt-3 text-xs text-neon-cyan font-mono animate-pulse">
            <StatusDot status="live" pulse />
            Monitoring: {status?.url || builtUrl}
          </div>
        )}
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </BentoCard>

      {/* Overall status banner */}
      {status && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold ${
          p1Error
            ? 'bg-red-900/30 border-red-500/40 text-red-300'
            : p2Error
              ? 'bg-amber-900/30 border-amber-500/40 text-amber-300'
              : 'bg-green-900/20 border-green-500/30 text-green-400'
        }`}>
          <Activity className="w-4 h-4" />
          {p1Error ? 'CRITICAL — Priority 1 errors detected' : p2Error ? 'WARNING — Priority 2 errors' : 'NOMINAL — All checks passing'}
          {totalAlarms > 0 && <span className="ml-auto text-xs font-mono opacity-70">{totalAlarms} alarm{totalAlarms !== 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* ETR 290 Priority Grid */}
      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Object.entries(ETR_CHECKS).map(([key, checks]) => (
            <PriorityBlock
              key={key}
              priorityKey={key}
              meta={PRIORITY_META[key]}
              checks={checks}
              status={status.status}
              counts={status.counts}
            />
          ))}
        </div>
      )}

      {/* Alarm Log */}
      {status && (
        <div>
          <h3 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold mb-3">
            Alarm Log
          </h3>
          <AlarmTable alarms={status.recentAlarms} />
        </div>
      )}
    </div>
  );
}
