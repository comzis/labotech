import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity, Radio, Network, Search, ShieldCheck, Monitor, Cpu, Terminal, LineChart } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import StreamsPanel from './components/StreamsPanel';
import TranscodePanel from './components/TranscodePanel';
import MulticastPanel from './components/MulticastPanel';
import TSAnalyser from './components/TSAnalyser';
import DecoderPanel from './components/DecoderPanel';
import DecoderMultiviewPanel from './components/DecoderMultiviewPanel';
import StreamViewPanel from './components/StreamViewPanel';
import APIPanel from './components/APIPanel';
import EventLogPanel from './components/EventLogPanel';
import useWebSocket from './hooks/useWebSocket';
import { clearEvents, getEvents, getHealth } from './api';

// Per-tab LED colours (Evertz-style coloured buttons)
const TABS = [
  { id: 'streams',    label: 'Runtime',     icon: Activity,    led: '#00dd55' },
  { id: 'transcode',  label: 'Transcoder',  icon: Radio,       led: '#ffaa00' },
  { id: 'multicast',  label: 'Forwarding',  icon: Network,     led: '#2299ff' },
  { id: 'decoder',    label: 'Decoder',     icon: Cpu,         led: '#00ddff' },
  { id: 'analyse',    label: 'TS Analyser', icon: Search,      led: '#cc44ff' },
  { id: 'decoders',   label: 'Multiview',   icon: Monitor,     led: '#00ddaa' },
  { id: 'streamView', label: 'Live View',   icon: LineChart,   led: '#66ccff' },
  { id: 'alarms',     label: 'Alarm Log',   icon: ShieldCheck, led: '#ff5577' },
  { id: 'api',        label: 'API',         icon: Terminal,    led: '#aaaaaa' },
];

function cpuColor(pct) {
  if (pct == null)  return '#555';
  if (pct >= 85)    return '#ff2233';
  if (pct >= 65)    return '#ffaa00';
  return '#00dd55';
}

const INACTIVE_TAB_COLOR = '#7a7a7a';

function isExpectedNoSignalError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('ffprobe exited 1') ||
    m.includes('connection refused') ||
    m.includes('input/output error') ||
    m.includes('server returned 404') ||
    m.includes('immediate exit requested')
  );
}

function classifySeverity(msg) {
  if (!msg || !msg.type) return 'info';
  if (msg.type === 'etr290_alarm') {
    if (msg.priority === 'p1') return 'critical';
    if (msg.priority === 'p2') return 'warning';
    return 'info';
  }
  if (msg.type === 'error') {
    return isExpectedNoSignalError(msg.message) ? 'warning' : 'critical';
  }
  if (msg.type === 'switched') return 'warning';
  if (msg.type === 'info') return 'info';
  return 'info';
}

function toLogEntry(msg) {
  if (!msg || !msg.type) return null;
  const parsedWhen = msg.time ? new Date(msg.time).getTime() : Date.now();
  const when = Number.isFinite(parsedWhen) ? parsedWhen : Date.now();
  const id = msg.id || 'system';
  const severity = classifySeverity(msg);
  let status = 'active';
  let title = msg.type;
  let details = msg.message || '';

  if (msg.type === 'started') {
    status = 'started';
    title = 'Stream started';
    details = `${id} is running`;
  } else if (msg.type === 'stopped' || msg.type === 'transcode_stopped' || msg.type === 'multicast_stopped') {
    status = 'stopped';
    title = 'Instance stopped';
    details = `${id} stopped`;
  } else if (msg.type === 'error') {
    status = isExpectedNoSignalError(msg.message) ? 'no-signal' : 'error';
    title = isExpectedNoSignalError(msg.message) ? 'Input signal missing' : 'Engine error';
    details = msg.message || 'Unknown error';
  } else if (msg.type === 'etr290_alarm') {
    status = 'alarm';
    title = `ETR ${(msg.priority || 'p3').toUpperCase()} - ${msg.label || 'Alarm'}`;
    details = msg.message || '';
  } else if (msg.type === 'switched') {
    status = 'failover';
    title = 'Failover switch';
    details = msg.message || 'Primary input switched to backup';
  } else if (msg.type === 'info') {
    status = 'info';
    title = 'Engine info';
    details = msg.message || '';
  }

  return {
    key: `${msg.type}-${id}-${when}-${msg.label || msg.message || ''}`,
    when,
    id,
    type: msg.type,
    severity,
    status,
    title,
    details,
  };
}

// Small LCD-style readout for telemetry
function LcdValue({ label, value, color }) {
  return (
    <span className="flex items-center gap-1 font-mono text-[9px] whitespace-nowrap">
      <span style={{ color: '#444' }}>{label}</span>
      <span style={{ color, textShadow: `0 0 6px ${color}88` }}>{value ?? 'n/a'}</span>
    </span>
  );
}

export default function App() {
  const [tab, setTab] = useState('streams');
  const [decoderSelectionRequest, setDecoderSelectionRequest] = useState(null);
  const { connected, lastMessage } = useWebSocket();
  const [telemetry, setTelemetry] = useState(null);
  const [eventLog, setEventLog] = useState([]);
  const [alarmUnreadCritical, setAlarmUnreadCritical] = useState(0);
  const errorToastSeenRef = useRef(new Map());

  // ── Broadcast event toasts ────────────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const entry = toLogEntry(lastMessage);
    if (entry) {
      setEventLog((prev) => [...prev, entry].slice(-1000));
      if (entry.severity === 'critical' && tab !== 'alarms') {
        setAlarmUnreadCritical((n) => n + 1);
      }
    }
    const { type, id, message } = lastMessage;
    switch (type) {
      case 'started':
        toast.success(`Stream ${id} started`, { duration: 4000 });
        break;
      case 'stopped':
      case 'transcode_stopped':
      case 'multicast_stopped':
        toast.info(`${id} stopped`, { duration: 4000 });
        break;
      case 'error':
        // Expected transient signal/input faults are logged but not promoted as popups.
        if (isExpectedNoSignalError(message)) break;
        {
          const key = `${id || 'unknown'}:${message || ''}`;
          const now = Date.now();
          const prevTs = errorToastSeenRef.current.get(key) || 0;
          if (now - prevTs < 15000) break; // de-duplicate repeated errors
          errorToastSeenRef.current.set(key, now);
          toast.error(`${id}: ${message}`, { duration: 8000 });
        }
        break;
      case 'etr290_alarm':
        if (lastMessage.priority === 'p1') {
          toast.error(`ETR290 P1: ${lastMessage.label}`, { duration: 6000 });
        }
        break;
      case 'switched':
        toast.warning(`${id}: failover activated`, { duration: 6000 });
        break;
      default:
        break;
    }
  }, [lastMessage, tab]);

  useEffect(() => {
    if (tab === 'alarms') setAlarmUnreadCritical(0);
  }, [tab]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const seed = await getEvents();
        if (!mounted || !Array.isArray(seed)) return;
        const normalized = seed.map(toLogEntry).filter(Boolean);
        const dedup = new Map();
        normalized.forEach((e) => dedup.set(e.key, e));
        setEventLog(Array.from(dedup.values()).slice(-1000));
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const h = await getHealth();
        if (mounted) setTelemetry(h.telemetry || null);
      } catch (_) {}
    };
    load();
    const timer = setInterval(load, 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const handleSelectDecoderFromTimeline = (decoderId) => {
    const id = String(decoderId || '').trim();
    if (!id) return;
    setDecoderSelectionRequest({ id, at: Date.now() });
    setTab('decoder');
  };

  return (
    <div className="min-h-screen flex flex-col font-mono" style={{ background: 'transparent' }}>
      <Toaster
        position="top-right"
        theme="dark"
        richColors
        toastOptions={{ style: { fontFamily: 'ui-monospace, monospace', fontSize: '11px', borderRadius: '2px' } }}
      />

      {/* ── Top rail / header ──────────────────────────────────────────────── */}
      <header
        className="fixed top-0 w-full z-50"
        style={{
          background: 'linear-gradient(180deg, #1e1e1e 0%, #141414 60%, #101010 100%)',
          borderBottom: '1px solid #0a0a0a',
          boxShadow: '0 4px 24px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* Rack rail top-edge line */}
        <div style={{ height: '2px', background: 'linear-gradient(90deg, #1a1a1a, #303030 20%, #303030 80%, #1a1a1a)' }} />

        <div className="max-w-[1800px] mx-auto px-4 xl:px-6 h-[60px] flex items-center gap-3 xl:gap-4">

          {/* Logo / product ID */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Rack "power" LED */}
            <div
              className="w-3 h-3 rounded-full animate-led-pulse"
              style={{
                background: 'radial-gradient(circle at 38% 32%, #ffffff44, #00dd55bb, #00dd55)',
                boxShadow: '0 0 6px rgba(0,221,85,0.8), 0 0 14px rgba(0,221,85,0.4)',
              }}
            />
            <div>
              <div
                className="text-[13px] font-black uppercase tracking-[0.3em] leading-none"
                style={{ color: '#e0e0e0', textShadow: '0 0 12px rgba(255,255,255,0.08)' }}
              >
                LABOTECH
              </div>
              <div className="text-[8px] uppercase tracking-[0.35em] engraved leading-none mt-0.5">
                Broadcast Engine · HPE DL360
              </div>
            </div>
            <div
              className="flex flex-col px-2 py-0.5 rounded-sm font-mono"
              style={{
                background: '#0a0a0a',
                border: '1px solid #1f1f1f',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.65)',
              }}
            >
              <span className="text-[8px] uppercase tracking-widest text-amber-300">Powered by Docker</span>
              <span className="text-[8px] text-gray-500">Prod: docker compose up -d</span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '28px', background: 'linear-gradient(180deg, transparent, #333, transparent)' }} />

          {/* ── Pushbutton nav ──────────────────────────────────────────── */}
          <nav className="flex items-center gap-1.5 xl:gap-2 flex-1 overflow-x-auto">
            {TABS.map(t => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex flex-col items-center gap-1 px-2.5 xl:px-3 py-1.5 rounded-sm transition-all duration-100 shrink-0 relative"
                  style={isActive ? {
                    background: `linear-gradient(180deg, #222 0%, #181818 100%)`,
                    border: `1px solid ${t.led}44`,
                    boxShadow: `0 0 10px ${t.led}33, inset 0 1px 0 rgba(255,255,255,0.04)`,
                  } : {
                    background: 'linear-gradient(180deg, #1c1c1c 0%, #141414 100%)',
                    border: '1px solid #222',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), inset 0 -1px 0 rgba(0,0,0,0.4)',
                  }}
                >
                  {/* LED indicator above icon */}
                  <div
                    className="w-2 h-2 rounded-full"
                    style={isActive ? {
                      background: `radial-gradient(circle at 40% 30%, #ffffff55, ${t.led})`,
                      boxShadow: `0 0 4px ${t.led}, 0 0 8px ${t.led}88`,
                    } : {
                      background: '#1a1a1a',
                      boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
                    }}
                  />
                  <Icon
                    className="w-3.5 h-3.5"
                    strokeWidth={isActive ? 2 : 1.5}
                    style={{ color: isActive ? t.led : INACTIVE_TAB_COLOR }}
                  />
                  <span
                    className="text-[9px] font-bold uppercase tracking-[0.12em] leading-none whitespace-nowrap"
                    style={{ color: isActive ? t.led : INACTIVE_TAB_COLOR }}
                  >
                    {t.label}
                  </span>
                  {t.id === 'alarms' && alarmUnreadCritical > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {alarmUnreadCritical > 9 ? '9+' : alarmUnreadCritical}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Divider */}
          <div style={{ width: '1px', height: '28px', background: 'linear-gradient(180deg, transparent, #333, transparent)' }} />

          {/* ── Telemetry LCD readout ───────────────────────────────────── */}
          {telemetry && (
            <div
              className="hidden xl:flex items-center gap-2 px-2 py-1 font-mono rounded-sm shrink-0"
              style={{
                background: '#0a0a0a',
                border: '1px solid #1a1a1a',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.6)',
              }}
            >
              <LcdValue
                label="CPU"
                value={telemetry.cpuPercent != null ? `${telemetry.cpuPercent}%` : null}
                color={cpuColor(telemetry.cpuPercent)}
              />
              <span style={{ color: '#222' }}>|</span>
              <LcdValue
                label="MEM"
                value={telemetry.memoryPercent != null ? `${telemetry.memoryPercent}%` : null}
                color={cpuColor(telemetry.memoryPercent)}
              />
              <span className="hidden 2xl:inline" style={{ color: '#222' }}>|</span>
              <span className="hidden 2xl:inline">
                <LcdValue
                  label=""
                  value={`${telemetry.memoryUsedMB || 0}/${telemetry.memoryTotalMB || 0}MB`}
                  color="#555"
                />
              </span>
            </div>
          )}

          {/* ── Connection status LED ───────────────────────────────────── */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-sm shrink-0"
            style={connected ? {
              background: '#0a1a0a',
              border: '1px solid #1a3a1a',
              boxShadow: '0 0 8px rgba(0,221,85,0.15)',
            } : {
              background: '#1a0a0a',
              border: '1px solid #3a1a1a',
            }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={connected ? {
                background: 'radial-gradient(circle at 38% 32%, #ffffff44, #00dd55)',
                boxShadow: '0 0 5px #00dd55, 0 0 10px rgba(0,221,85,0.5)',
                animation: 'ledPulse 2s ease-in-out infinite alternate',
              } : {
                background: '#ff2233',
                boxShadow: '0 0 5px #ff2233',
              }}
            />
            <span
              className="text-[9px] font-bold uppercase tracking-widest"
              style={{ color: connected ? '#00dd55' : '#ff2233' }}
            >
              {connected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>

        {/* Rack rail bottom-edge line */}
        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #1a1a1a 10%, #1a1a1a 90%, transparent)' }} />
      </header>

      {/* ── Main content area ──────────────────────────────────────────────── */}
      <main className="flex-1 mt-20 mb-10 max-w-[1800px] w-full mx-auto px-4 xl:px-6 relative">
        {/* Subtle rack-rail side lines */}
        <div className="absolute left-0 top-0 bottom-0 w-1 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent, #1c1c1c 5%, #1c1c1c 95%, transparent)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-1 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, transparent, #1c1c1c 5%, #1c1c1c 95%, transparent)' }} />

        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="py-4"
        >
          {tab === 'streams'    && <StreamsPanel lastMessage={lastMessage} />}
          {tab === 'transcode'  && <TranscodePanel lastMessage={lastMessage} />}
          {tab === 'multicast'  && <MulticastPanel lastMessage={lastMessage} />}
          {tab === 'decoder'    && <DecoderPanel lastMessage={lastMessage} selectedDecoderRequest={decoderSelectionRequest} />}
          {tab === 'analyse'    && <TSAnalyser lastMessage={lastMessage} />}
          {tab === 'decoders'   && <DecoderMultiviewPanel lastMessage={lastMessage} />}
          {tab === 'streamView' && <StreamViewPanel lastMessage={lastMessage} onSelectDecoder={handleSelectDecoderFromTimeline} />}
          {tab === 'alarms'     && (
            <EventLogPanel
              events={eventLog}
              onClear={async () => {
                try { await clearEvents(); } catch (_) {}
                setEventLog([]);
                setAlarmUnreadCritical(0);
              }}
            />
          )}
          {tab === 'api'        && <APIPanel />}
        </motion.div>
      </main>
    </div>
  );
}
