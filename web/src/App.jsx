import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Radio, Network, Search, ShieldCheck, Monitor, Cpu, Terminal, LineChart, LogIn, Lock } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import StreamsPanel from './components/StreamsPanel';
import TranscodePanel from './components/TranscodePanel';
import MulticastPanel from './components/MulticastPanel';
import TSAnalyser from './components/TSAnalyser';
import DecoderPanel from './components/DecoderPanelRevamp';
import DecoderMultiviewPanel from './components/DecoderMultiviewPanel';
import StreamViewPanel from './components/StreamViewPanel';
import APIPanel from './components/APIPanel';
import EventLogPanel from './components/EventLogPanel';
import useWebSocket from './hooks/useWebSocket';
import { clearEvents, getEvents, getHealth } from './api';
import { ServiceStatusBadge } from './components/BroadcastUI';

// Per-tab LED colours (Evertz-style coloured buttons)
const TABS = [
  { id: 'analyse',    label: 'TS Analyser',      icon: Search,      led: '#cc44ff' },
  { id: 'streams',    label: 'SRT Encapsulator', icon: Activity,    led: '#00dd55' },
  { id: 'transcode',  label: 'Transcoder',       icon: Radio,       led: '#ffaa00' },
  { id: 'multicast',  label: 'Forwarding',       icon: Network,     led: '#2299ff' },
  { id: 'decoder',    label: 'Decoder',          icon: Cpu,         led: '#00ddff' },
  { id: 'decoders',   label: 'Multiview',        icon: Monitor,     led: '#00ddaa' },
  { id: 'streamView', label: 'Live View',        icon: LineChart,   led: '#66ccff' },
  { id: 'alarms',     label: 'Alarm Log',        icon: ShieldCheck, led: '#ff5577' },
  { id: 'api',        label: 'API',              icon: Terminal,    led: '#aaaaaa' },
];

function cpuColor(pct) {
  if (pct == null)  return '#555';
  if (pct >= 85)    return '#ff2233';
  if (pct >= 65)    return '#ffaa00';
  return '#00dd55';
}

function formatUptime(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return 'n/a';
  const total = Math.floor(s);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const INACTIVE_TAB_COLOR = '#7a7a7a';
const ROLE_STORAGE_KEY = 'labotech:role:v1';
const AUTH_STORAGE_KEY = 'labotech:auth-user:v1';
const ROLES = {
  BES: 'bes',
  OPS: 'ops',
};
const LOGIN_PROFILES = {
  admin: { password: '', role: ROLES.BES },
  evc: { password: '', role: ROLES.OPS },
};
const OPS_HIDDEN_TABS = new Set(['streams', 'transcode', 'multicast', 'api']);
const PARTNER_LOGO_SRC = '/eurovision-services.png';
const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';
const RELEASE_VERSION = import.meta.env.VITE_RELEASE_VERSION || `v${APP_VERSION}`;
const BUILD_TIME_UTC = import.meta.env.VITE_BUILD_TIME_UTC || null;
const RACK_LOBBY_PUNCHLINES = [
  'check PCR before panic',
  'blame cables only after coffee',
  'if in doubt, inspect CC',
  'first fix timing, then feelings',
  'engineering starts with clean timing',
  'operations win with calm dashboards',
  'teamwork is the shortest path to green',
  'SLA is a promise measured every minute',
  'measure once, alert once, recover fast',
  'good handovers save great broadcasts',
  'if alarms are loud, make runbooks louder',
  'stable clocks build stable trust',
  'packets do not lie, logs do not guess',
  'great ops is boring for the right reasons',
  'test failover before failover tests you',
  'clear ownership beats heroic firefighting',
  'latency is a budget, spend it wisely',
  'every dropped packet is a customer story',
  'watch trends, not just incidents',
  'quality starts at ingest and ends at viewer',
  'no blame, just better telemetry',
  'resilience is a team sport',
  'SLA lives in every shift handoff',
  'document today to save tomorrow',
  'fast recovery beats perfect prediction',
  'precision in config prevents chaos on air',
  'one dashboard, one truth, one team',
  'alerts should guide, not surprise',
  'broadcast confidence is engineered daily',
  'consistency scales better than urgency',
  'when in doubt, verify on wire',
  'calm operations are built, not wished',
  'team first, signal first, viewer first',
  'better RCA means fewer 3am calls',
  'strong SLAs are earned in quiet hours',
];

function LandingAuth({ onLogin, punchline }) {
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const res = onLogin(username, password);
    if (!res?.ok) {
      setError('Invalid credentials');
      return;
    }
    setError('');
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-3 xl:px-6"
      style={{
        backgroundImage:
          'linear-gradient(180deg, rgba(8,12,18,0.45), rgba(7,10,16,0.78)), url("/broadcast-rack-bays.svg")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div
        className="w-full max-w-[1800px] min-h-[700px] rounded-md border relative overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(180deg, #1a1d22 0%, #12161c 58%, #0c1016 100%)',
          borderColor: '#2e3642',
          boxShadow: '0 20px 70px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.6)',
        }}
      >
        {/* Rack ears */}
        <div
          className="absolute left-0 top-0 bottom-0"
          style={{ width: 22, background: 'linear-gradient(180deg, #202833, #161c26)', borderRight: '1px solid #2a3340' }}
        />
        <div
          className="absolute right-0 top-0 bottom-0"
          style={{ width: 22, background: 'linear-gradient(180deg, #202833, #161c26)', borderLeft: '1px solid #2a3340' }}
        />
        {/* Rack screws */}
        {[
          { t: 10, l: 10 }, { t: 10, r: 10 }, { b: 10, l: 10 }, { b: 10, r: 10 },
        ].map((p, idx) => (
          <span
            key={`screw-${idx}`}
            className="absolute rounded-full"
            style={{
              width: 9,
              height: 9,
              background: 'radial-gradient(circle at 35% 30%, #9aa3b3, #505968 55%, #2b3240)',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.2), 0 0 2px rgba(0,0,0,0.5)',
              ...p,
            }}
          />
        ))}
        {[84, 196, 308, 420, 532, 644].map((top, i) => (
          <React.Fragment key={`ear-bolts-${i}`}>
            <span
              className="absolute rounded-full"
              style={{
                width: 8, height: 8, left: 7, top,
                background: 'radial-gradient(circle at 35% 30%, #a5adbb, #5a6270 55%, #303845)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.18), 0 0 2px rgba(0,0,0,0.45)',
              }}
            />
            <span
              className="absolute rounded-full"
              style={{
                width: 8, height: 8, right: 7, top,
                background: 'radial-gradient(circle at 35% 30%, #a5adbb, #5a6270 55%, #303845)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.18), 0 0 2px rgba(0,0,0,0.45)',
              }}
            />
          </React.Fragment>
        ))}

        {/* Rack rail top LEDs */}
        <div className="px-8 pt-3 pb-1 flex items-center gap-2">
          {['#8aa2c5', '#7f93b2', '#a8b3c6', '#6e819f', '#93a2b8', '#7489a9'].map((c, i) => (
            <span
              key={`rail-led-${i}`}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: c,
                boxShadow: `0 0 4px ${c}aa`,
                opacity: 0.65,
              }}
            />
          ))}
          <span className="ml-auto text-[8px] uppercase tracking-[0.16em] text-gray-500">Rack Interface MkII</span>
          <span className="text-[8px] uppercase tracking-[0.12em]" style={{ color: '#7f99bf' }}>{RELEASE_VERSION}</span>
        </div>
        <div style={{ height: '2px', background: 'linear-gradient(90deg, #1a1f27, #3a4656 20%, #3a4656 80%, #1a1f27)' }} />

        <div className="p-6 md:p-8 flex-1 flex flex-col">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <div className="text-[13px] font-black uppercase tracking-[0.3em] leading-none mb-2" style={{ color: '#e0e0e0' }}>
                LABOTECH
              </div>
              <div
                className="text-[9px] uppercase tracking-[0.22em]"
                style={{ color: '#8ea9d1', textShadow: '0 1px 0 rgba(0,0,0,0.35)' }}
              >
                Team Work · Engineering · Operations · SLA
              </div>
              <div className="text-[8px] uppercase tracking-[0.14em] mt-2" style={{ color: '#4f5f78' }}>
                Secure operator access
              </div>
            </div>
            <img
              src={PARTNER_LOGO_SRC}
              alt="Eurovision Services"
              className="shrink-0"
              style={{ height: 30, width: 'auto', opacity: 0.92, filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.14))' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
          <div className="mb-10 border-t" style={{ borderColor: '#212c3d' }} />

          <div className="my-6 rounded-sm border p-5" style={{ borderColor: '#2c3b52', background: 'linear-gradient(180deg, #162233, #101a29)' }}>
            {!showForm ? (
              <div className="flex flex-col items-start gap-4">
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: '#8ba3c7' }}>
                  Secure access gate
                </div>
                <div className="text-[20px] font-black uppercase tracking-[0.12em] leading-none" style={{ color: '#c8dcff' }}>
                  Control Room Access
                </div>
                <div className="text-[11px] text-gray-300 max-w-[720px]">
                  Use your operator credentials to enter the shared engineering and operations workspace.
                </div>
                <button
                  onClick={() => setShowForm(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-sm text-[10px] uppercase tracking-[0.14em] font-bold border rack-button-glow"
                  style={{
                    color: '#d4e5ff',
                    borderColor: '#3a5a86',
                    background: 'linear-gradient(180deg, #183151, #12243b)',
                  }}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Enter Labotech
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="grid md:grid-cols-3 gap-3 items-end">
                <label className="block">
                  <div className="text-[9px] uppercase tracking-[0.14em] mb-1" style={{ color: '#7f99bf' }}>Username</div>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full px-3 py-2 rounded-sm border text-[11px] bg-black/30 text-gray-200"
                    style={{ borderColor: '#2f425f' }}
                    placeholder="admin or evc"
                    autoFocus
                  />
                </label>
                <label className="block">
                  <div className="text-[9px] uppercase tracking-[0.14em] mb-1" style={{ color: '#7f99bf' }}>Password</div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-sm border text-[11px] bg-black/30 text-gray-200"
                    style={{ borderColor: '#2f425f' }}
                    placeholder="••••••••"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-sm text-[10px] uppercase tracking-[0.14em] font-bold border"
                    style={{
                      color: '#d4e5ff',
                      borderColor: '#3a5a86',
                      background: 'linear-gradient(180deg, #183151, #12243b)',
                    }}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Unlock
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); setError(''); }}
                    className="px-3 py-2 rounded-sm text-[9px] uppercase tracking-[0.12em] border"
                    style={{ color: '#8ca5ca', borderColor: '#2b3a50', background: '#0b1320' }}
                  >
                    Cancel
                  </button>
                </div>
                {error && (
                  <div className="md:col-span-3 text-[10px]" style={{ color: '#ff7686' }}>
                    {error}
                  </div>
                )}
              </form>
            )}
          </div>

          <div
            className="mt-auto rounded-sm border px-4 py-3 text-[10px] uppercase tracking-[0.12em]"
            style={{ borderColor: '#2a3448', background: '#0a0f17', color: '#7fa1d8', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}
          >
            Punchline: {punchline || RACK_LOBBY_PUNCHLINES[0]}.
          </div>
        </div>
      </div>
    </div>
  );
}

function isExpectedNoSignalError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('ffprobe exited 1') ||
    m.includes('empty probe payload') ||
    m.includes('no input packets observed during probe window') ||
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
  if (msg.type === 'etr290_incident_started' || msg.type === 'etr290_incident_updated') {
    if (msg.priority === 'p1') return 'critical';
    if (msg.priority === 'p2') return 'warning';
    return 'info';
  }
  if (msg.type === 'etr290_incident_cleared') return 'info';
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
  const derivedPid = msg.pid ?? (
    typeof msg.pidHex === 'string' && /^0x[0-9a-f]+$/i.test(msg.pidHex)
      ? parseInt(msg.pidHex, 16)
      : null
  );
  const evidence = {
    pid: Number.isFinite(derivedPid) ? derivedPid : null,
    pidHex: msg.pidHex || (Number.isFinite(derivedPid) ? `0x${derivedPid.toString(16).toUpperCase().padStart(4, '0')}` : null),
    checkId: msg.checkId || null,
    label: msg.label || null,
    priority: msg.priority || null,
    incidentId: msg.incidentId || null,
    hitCount: Number.isFinite(Number(msg.hitCount)) ? Number(msg.hitCount) : null,
    dvb: msg.dvb || null,
    siCompliance: msg?.dvb?.si?.compliance || msg.siCompliance || null,
    siIntervalsSec: msg?.dvb?.si?.intervalsSec || msg.siIntervalsSec || null,
  };
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
    if (Number.isFinite(evidence.pid)) {
      details = `${details}${details ? ' · ' : ''}PID ${evidence.pid}`;
    }
  } else if (msg.type === 'etr290_status') {
    // Heartbeat broadcast every 1s — not an alarm, do not add to log
    return null;
  } else if (msg.type === 'analyse_result') {
    // Routine probe result every 5s — not an alarm event
    return null;
  } else if (msg.type === 'etr290_incident_started' || msg.type === 'etr290_incident_updated') {
    status = 'alarm';
    title = `ETR incident ${msg.type.endsWith('started') ? 'started' : 'updated'} - ${msg.label || msg.checkId || 'check'}`;
    details = msg.lastMessage || msg.message || '';
    if (Number.isFinite(evidence.pid)) {
      details = `${details}${details ? ' · ' : ''}PID ${evidence.pid}`;
    }
  } else if (msg.type === 'etr290_incident_cleared') {
    status = 'info';
    title = `ETR incident cleared - ${msg.label || msg.checkId || 'check'}`;
    details = msg.lastMessage || msg.message || '';
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
    evidence,
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
  const [tab, setTab] = useState('analyse');
  const [authUser, setAuthUser] = useState(null);
  const [role, setRole] = useState(null);
  const [decoderSelectionRequest, setDecoderSelectionRequest] = useState(null);
  const { connected, lastMessage } = useWebSocket();
  const [telemetry, setTelemetry] = useState(null);
  const [serverUptimeSec, setServerUptimeSec] = useState(null);
  const [uptimeSampledAtMs, setUptimeSampledAtMs] = useState(null);
  const [uptimeNowMs, setUptimeNowMs] = useState(Date.now());
  const [eventLog, setEventLog] = useState([]);
  const [alarmUnreadCritical, setAlarmUnreadCritical] = useState(0);
  const [lobbyLineIdx, setLobbyLineIdx] = useState(() => Math.floor(Math.random() * RACK_LOBBY_PUNCHLINES.length));
  const errorToastSeenRef = useRef(new Map());
  const dismissedEventKeysRef = useRef(new Set());
  const dismissedEventSignaturesRef = useRef(new Set());

  useEffect(() => {
    const timer = setInterval(() => {
      setLobbyLineIdx((idx) => (idx + 1) % RACK_LOBBY_PUNCHLINES.length);
    }, 7000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setUptimeNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const savedUser = sessionStorage.getItem(AUTH_STORAGE_KEY);
      const saved = sessionStorage.getItem(ROLE_STORAGE_KEY);
      const profile = savedUser ? LOGIN_PROFILES[savedUser] : null;
      if (profile) setAuthUser(savedUser);
      if ((saved === ROLES.BES || saved === ROLES.OPS) && profile) setRole(saved);
      else if (profile) setRole(profile.role);
    } catch (_) {}
  }, []);

  const visibleTabs = useMemo(() => {
    if (role === ROLES.OPS) {
      return TABS.filter((t) => !OPS_HIDDEN_TABS.has(t.id));
    }
    return TABS;
  }, [role]);

  const uptimeDisplay = useMemo(() => {
    if (!Number.isFinite(serverUptimeSec)) return 'n/a';
    const elapsedSec = Number.isFinite(uptimeSampledAtMs)
      ? Math.max(0, Math.floor((uptimeNowMs - uptimeSampledAtMs) / 1000))
      : 0;
    return formatUptime(serverUptimeSec + elapsedSec);
  }, [serverUptimeSec, uptimeSampledAtMs, uptimeNowMs]);
  const activePunchline = RACK_LOBBY_PUNCHLINES[lobbyLineIdx] || RACK_LOBBY_PUNCHLINES[0];

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) {
      setTab(visibleTabs[0]?.id || 'analyse');
    }
  }, [visibleTabs, tab]);

  const handleLogin = (usernameRaw, passwordRaw) => {
    const username = String(usernameRaw || '').trim().toLowerCase();
    const password = String(passwordRaw || '');
    const profile = LOGIN_PROFILES[username];
    if (!profile || profile.password !== password) return { ok: false };
    setAuthUser(username);
    setRole(profile.role);
    try {
      sessionStorage.setItem(AUTH_STORAGE_KEY, username);
      sessionStorage.setItem(ROLE_STORAGE_KEY, profile.role);
    } catch (_) {}
    return { ok: true };
  };

  const handleResetRole = () => {
    setAuthUser(null);
    setRole(null);
    try {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(ROLE_STORAGE_KEY);
    } catch (_) {}
  };

  // ── Broadcast event toasts ────────────────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const entry = toLogEntry(lastMessage);
    if (entry) {
      const signature = `${entry.type}|${entry.id}|${entry.title}|${entry.details}`;
      if (
        !dismissedEventKeysRef.current.has(entry.key) &&
        !dismissedEventSignaturesRef.current.has(signature)
      ) {
        setEventLog((prev) => [...prev, entry].slice(-1000));
      }
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
    const hydrate = async () => {
      try {
        const seed = await getEvents();
        if (!mounted || !Array.isArray(seed)) return;
        const normalized = seed
          .map(toLogEntry)
          .filter(Boolean)
          .filter((e) => {
            const signature = `${e.type}|${e.id}|${e.title}|${e.details}`;
            return (
              !dismissedEventKeysRef.current.has(e.key) &&
              !dismissedEventSignaturesRef.current.has(signature)
            );
          });
        // Merge with existing in-session WS events so we don't lose live entries.
        setEventLog((prev) => {
          const dedup = new Map(prev.map((e) => [e.key, e]));
          normalized.forEach((e) => { if (!dedup.has(e.key)) dedup.set(e.key, e); });
          return Array.from(dedup.values())
            .sort((a, b) => (a.when || 0) - (b.when || 0))
            .slice(-1000);
        });
      } catch (_) {}
    };
    hydrate();
    const t = setInterval(hydrate, 10000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const h = await getHealth();
        if (mounted) {
          setTelemetry(h.telemetry || null);
          setServerUptimeSec(Number.isFinite(Number(h?.uptime)) ? Number(h.uptime) : null);
          setUptimeSampledAtMs(Date.now());
        }
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

  if (!authUser || !role) {
    return <LandingAuth onLogin={handleLogin} punchline={activePunchline} />;
  }

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

        <div className="max-w-[1800px] mx-auto px-3 xl:px-5 h-[66px] flex items-center gap-2 xl:gap-3">

          {/* Logo / product ID */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Rack "power" LED */}
            <div
              className="w-3 h-3 rounded-full animate-led-pulse"
              style={{
                background: 'radial-gradient(circle at 38% 32%, #ffffff44, #00dd55bb, #00dd55)',
                boxShadow: '0 0 6px rgba(0,221,85,0.8), 0 0 14px rgba(0,221,85,0.4)',
              }}
            />
            <div className="flex flex-col">
              <div
                className="text-[13px] font-black uppercase tracking-[0.3em] leading-none"
                style={{ color: '#e0e0e0', textShadow: '0 0 12px rgba(255,255,255,0.08)' }}
              >
                LABOTECH
              </div>
              <div
                className="text-[8px] uppercase tracking-[0.18em] leading-none mt-0.5 whitespace-nowrap"
                style={{ color: '#7f99bf', textShadow: '0 1px 0 rgba(0,0,0,0.4)' }}
              >
                Team Work · Engineering · Operations · SLA
              </div>
              <div className="text-[8px] leading-none mt-1 text-gray-500">
                HPE DL360 · Powered by Docker
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '28px', background: 'linear-gradient(180deg, transparent, #333, transparent)' }} />

          {/* ── Pushbutton nav ──────────────────────────────────────────── */}
          <nav className="flex items-center gap-1 xl:gap-1.5 flex-1 min-w-0 justify-start">
            {visibleTabs.map(t => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex flex-col items-center gap-0.5 px-2 xl:px-2.5 py-1 rounded-sm transition-all duration-100 shrink-0 relative"
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
                    className="w-3 h-3"
                    strokeWidth={isActive ? 2 : 1.5}
                    style={{ color: isActive ? t.led : INACTIVE_TAB_COLOR }}
                  />
                  <span
                    className="text-[8px] font-bold uppercase tracking-[0.1em] leading-none whitespace-nowrap"
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
            </div>
          )}

          <div
            className="hidden xl:flex items-center gap-2 px-2 py-1 rounded-sm shrink-0"
            style={{
              background: '#101723',
              border: '1px solid #2a3950',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            }}
            title={BUILD_TIME_UTC ? `Build: ${BUILD_TIME_UTC}` : 'Build metadata'}
          >
            <span className="text-[8px] uppercase tracking-[0.12em]" style={{ color: '#7f99bf' }}>Release</span>
            <span className="text-[9px] font-bold" style={{ color: '#cfe2ff' }}>{RELEASE_VERSION}</span>
            <span className="text-[8px]" style={{ color: '#6f86aa' }}>Uptime {uptimeDisplay}</span>
          </div>

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
            <ServiceStatusBadge connected={connected} />
          </div>

          <button
            onClick={handleResetRole}
            className="ml-1 px-3 py-1 rounded-sm text-[9px] uppercase tracking-[0.1em] shrink-0 inline-flex items-center gap-1 2xl:w-[280px] 2xl:justify-between overflow-hidden"
            style={{
              color: '#9ab4d8',
              border: '1px solid #2b3950',
              background: 'linear-gradient(180deg, #0d1520, #0a1018)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 0 8px rgba(80,120,180,0.15)',
            }}
            title={`Log out and return to landing page (${activePunchline})`}
          >
            <span className="shrink-0">↩ Logout ({authUser})</span>
            <span
              className="hidden 2xl:inline truncate text-right ml-2"
              style={{ color: '#6f86aa' }}
            >
              · {activePunchline}
            </span>
          </button>

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
              onClearGhost={(selected) => {
                if (!selected) return;
                const signature = `${selected.type}|${selected.id}|${selected.title}|${selected.details}`;
                dismissedEventKeysRef.current.add(selected.key);
                dismissedEventSignaturesRef.current.add(signature);
                setEventLog((prev) => prev.filter((e) => {
                  const rowSignature = `${e.type}|${e.id}|${e.title}|${e.details}`;
                  if (e.key === selected.key) return false;
                  if (rowSignature === signature) return false;
                  return true;
                }));
                toast.success('Ghost entry cleared', { duration: 2200 });
              }}
              onClear={async () => {
                try {
                  await clearEvents();
                  toast.success('Alarm log cleared', { duration: 3000 });
                } catch (err) {
                  toast.error(`Failed to clear alarm log: ${err?.message || 'unknown error'}`, { duration: 5000 });
                  return;
                }
                setEventLog([]);
                setAlarmUnreadCritical(0);
                dismissedEventKeysRef.current.clear();
                dismissedEventSignaturesRef.current.clear();
              }}
            />
          )}
          {tab === 'api'        && <APIPanel />}
        </motion.div>
      </main>
    </div>
  );
}
