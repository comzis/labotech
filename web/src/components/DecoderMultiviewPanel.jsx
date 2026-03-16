import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Plus, Pencil } from 'lucide-react';
import useTSAnalysis from '../hooks/useTSAnalysis';
import StatusDot from './StatusDot';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';
import { resolveTransportBitrate, formatMbps } from '../utils/transportBitrate';
const MULTIVIEW_STATE_KEY = 'labotech:decoder-multiview:state:v1';
const DEFAULT_PANEL_ID = 'panel-default';
const DEFAULT_PANEL_NAME = 'BES';
const DEFAULT_ENGINEER_MODE_LABEL = 'MRC';
const MULTIVIEW_REFRESH_MS = 5000;   // match probe cadence so stale data is replaced promptly
const MULTIVIEW_CLOCK_TICK_MS = 3000;
// After mount, if active analysers have no results yet, retry quickly up to this many times.
const MOUNT_RETRY_MAX = 6;
const MOUNT_RETRY_INTERVAL_MS = 2000;

function normalizePanelName(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function normalizePersistedPanelName(raw, fallback) {
  const normalized = normalizePanelName(raw || fallback);
  // Session compatibility: migrate legacy default label automatically.
  if (normalized === 'MCR-WALL-A' || normalized === 'WALL-A') return DEFAULT_PANEL_NAME;
  return normalized;
}

function countPids(result) {
  if (!result) return 0;
  const programCount = (result.programs || []).reduce((acc, p) => acc + ((p.streams || []).length), 0);
  return programCount + ((result.orphanStreams || []).length);
}

// Map dBFS value (-60..0) to bar percentage
function dbToPercent(db) {
  if (db == null || !Number.isFinite(db)) return 0;
  return Math.round(((Math.max(-60, Math.min(0, db)) + 60) / 60) * 100);
}

// Broadcast-standard meter zone colours
function meterColor(db) {
  if (db == null || !Number.isFinite(db)) return '#00dd55';
  if (db > -9)  return '#ff2233'; // red: clip risk
  if (db > -18) return '#ffaa00'; // amber: hot
  return '#00dd55';               // green: nominal
}

// Single horizontal VU bar: rmsDb = moving bar, peakDb = peak hold marker
function VuBar({ label, rmsDb, peakDb, showPeak = true }) {
  const rmsPct  = dbToPercent(rmsDb);
  const peakPct = dbToPercent(peakDb);
  const active  = Number.isFinite(rmsDb);
  const color   = meterColor(rmsDb);
  const peakColor = meterColor(peakDb);
  return (
    <div className="grid items-center gap-1" style={{ gridTemplateColumns: '16px 1fr 44px' }}>
      <span className="text-[9px] font-mono font-bold" style={{ color: active ? color : '#555' }}>{label}</span>
      <div style={{ position: 'relative', height: '6px', background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: '1px', overflow: 'visible' }}>
        {/* Zone demarcation ticks at -18 dBFS (50%) and -9 dBFS (85%) */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: '#1e1e1e', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: '85%', top: 0, bottom: 0, width: '1px', background: '#1e1e1e', pointerEvents: 'none' }} />
        {/* RMS moving bar */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${active ? Math.max(rmsPct, 2) : 8}%`,
          background: active ? color : '#2a3a4a',
          boxShadow: active && rmsPct > 5 ? `0 0 5px ${color}88` : 'none',
          transition: 'width 0.15s linear',
          overflow: 'hidden',
          borderRadius: '1px',
        }} />
        {/* Peak hold marker */}
        {showPeak && peakDb != null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${Math.min(peakPct, 98)}%`,
            width: '2px',
            background: peakColor,
            boxShadow: `0 0 3px ${peakColor}`,
          }} />
        )}
      </div>
      <span className="text-[9px] font-mono text-right" style={{ color: active ? color : '#555' }}>
        {active ? `${rmsDb.toFixed(1)}` : 'n/a'}
      </span>
    </div>
  );
}

function buildProbeUrl({ mode, host, port, latency, passphrase }) {
  if (!host || !port) return '';
  if (mode === 'udp') return `udp://${host}:${port}`;
  if (mode === 'rtp') return `rtp://${host}:${port}`;
  let url = `srt://${host}:${port}`;
  const params = ['stats=1', 'statsintvl=1'];
  if (latency) params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join('&')}`;
  return url;
}

function getMultiviewDisplayName(id) {
  const raw = String(id || '');
  const m = raw.match(/^2022-7-consolidated(?:-(\d+))?$/i);
  if (!m) return raw;
  return m[1] ? `2022-7 consolidated #${m[1]}` : '2022-7 consolidated';
}

function Stat({ label, value }) {
  return (
    <div
      className="px-2 py-1.5"
      style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: '2px', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)' }}
    >
      <div className="text-[9px] uppercase tracking-widest engraved mb-0.5">{label}</div>
      <div className="text-gray-300 font-mono text-[11px]">{value}</div>
    </div>
  );
}

function updateAgeInfo(probeTime, nowMs, engineerMode = true) {
  if (!probeTime) {
    return { ageSec: null, label: engineerMode ? 'awaiting telemetry' : 'no sample yet', color: '#777' };
  }
  const ageSec = Math.max(0, Math.floor((nowMs - probeTime) / 1000));
  if (ageSec <= 2) return { ageSec, label: engineerMode ? 'fresh silicon' : 'live', color: '#00dd55' };
  if (ageSec <= 6) return { ageSec, label: engineerMode ? 'cache warming' : 'delayed', color: '#ffaa00' };
  return { ageSec, label: engineerMode ? 'radio silence' : 'stale', color: '#ff2233' };
}

function extractThumbTimestamp(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  const m = String(thumbnailUrl).match(/[?&]t=(\d{10,})/);
  if (!m) return null;
  const ts = Number(m[1]);
  return Number.isFinite(ts) ? ts : null;
}

function DecoderCard({ id, displayName, meta, result, onStop, nowMs, engineerMode, isStopping = false }) {
  const primaryService = result?.dvb?.services?.[0]?.serviceName || result?.programs?.[0]?.name || 'Unknown';
  const serviceProvider = result?.dvb?.services?.[0]?.serviceProvider || null;
  const transportRate = resolveTransportBitrate(result);
  // Per-channel audio levels from astats probe
  const currentChannels = Array.isArray(result?.audioLevels?.channels) ? result.audioLevels.channels : [];
  const currentMeanDb = Number.isFinite(result?.audioLevels?.meanDb) ? result.audioLevels.meanDb : null;
  const [audioSnapshot, setAudioSnapshot] = useState(null);
  useEffect(() => {
    const hasChannels = currentChannels.length > 0;
    const hasMean = Number.isFinite(currentMeanDb);
    if (!hasChannels && !hasMean) return;
    setAudioSnapshot({
      channels: hasChannels ? currentChannels : [],
      meanDb: hasMean ? currentMeanDb : null,
      maxDb: Number.isFinite(result?.audioLevels?.maxDb) ? result.audioLevels.maxDb : null,
      atMs: Date.now(),
    });
  }, [currentChannels, currentMeanDb, result?.audioLevels?.maxDb]);
  const displayChannels = currentChannels.length > 0 ? currentChannels : (audioSnapshot?.channels || []);
  const displayMeanDb = Number.isFinite(currentMeanDb)
    ? currentMeanDb
    : (Number.isFinite(audioSnapshot?.meanDb) ? audioSnapshot.meanDb : null);
  const displayMaxDb = Number.isFinite(result?.audioLevels?.maxDb)
    ? result.audioLevels.maxDb
    : (Number.isFinite(audioSnapshot?.maxDb) ? audioSnapshot.maxDb : null);
  // Peak hold: { ch: number, peakDb: number, heldAt: number }[]
  const peakHoldRef = useRef({});
  const PEAK_HOLD_MS = 3000;
  // Update peak hold on new level data
  if (displayChannels.length > 0) {
    const now = Date.now();
    displayChannels.forEach((ch) => {
      const key = ch.ch;
      const existing = peakHoldRef.current[key];
      const peakDb = ch.peakDb ?? ch.rmsDb;
      if (peakDb == null) return;
      if (!existing || peakDb > existing.peakDb || (now - existing.heldAt) > PEAK_HOLD_MS) {
        peakHoldRef.current[key] = { peakDb, heldAt: now };
      }
    });
  }
  // Keep the last successfully loaded src so the tile doesn't blank during
  // the write gap between probe cycles (atomic rename means the old file
  // stays readable until the new one is ready).
  const [displaySrc, setDisplaySrc] = useState(null);
  const [thumbRetry, setThumbRetry] = useState(0);
  // Keep browser cache-busting tied to backend thumbnail token only.
  // result.thumbnailUrl already includes ?t=... when a new frame is written.
  const candidateBaseSrc = result?.thumbnailUrl || null;
  const candidateSrc = candidateBaseSrc ? `${candidateBaseSrc}&retry=${thumbRetry}` : null;

  // Reset retry budget and force reload when backend publishes a new thumbnail token.
  useEffect(() => {
    setThumbRetry(0);
    setDisplaySrc(null);
  }, [candidateBaseSrc]);

  // Keep showing the last known-good image even if a newer refresh token fails.
  const hasThumb = Boolean(displaySrc || candidateSrc);
  const freshness = updateAgeInfo(result?.probeTime, nowMs, engineerMode);
  const thumbTs = extractThumbTimestamp(result?.thumbnailUrl);
  const thumbAgeSec = thumbTs ? Math.max(0, Math.floor((nowMs - thumbTs) / 1000)) : null;
  const thumbFresh = thumbAgeSec != null ? thumbAgeSec <= 8 : false;
  const hasTelemetry = Boolean(result?.probeTime);
  const hasProbeError = !hasTelemetry && Boolean(result?.probeError);
  const staleMs = hasTelemetry ? (nowMs - result.probeTime) : Number.POSITIVE_INFINITY;
  const isRunning = Boolean(meta?.isRunning);
  const telemetryFresh = hasTelemetry && staleMs <= 15000;
  // Operator preference: active running decoders remain green while lock/telemetry warms up.
  // If telemetry exists and goes stale, downgrade to warning.
  const signalOk = isRunning && (!hasTelemetry || telemetryFresh);

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ background: '#111', border: '1px solid #252525', borderRadius: '3px', boxShadow: '0 4px 16px rgba(0,0,0,0.6)', minWidth: 0 }}
    >
      {/* Bezel header */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 shrink-0"
        style={{ background: 'linear-gradient(180deg, #242424 0%, #1a1a1a 100%)', borderBottom: '1px solid #0a0a0a', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
      >
        <StatusDot status={signalOk ? 'live' : 'warning'} pulse={signalOk} />
        <span className="font-mono text-[10px] text-gray-400 truncate flex-1" title={id}>{displayName || id}</span>
        <span
          className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0"
          style={signalOk
            ? { background: 'rgba(0,120,50,0.25)', borderColor: 'rgba(0,221,85,0.35)', color: '#86efac' }
            : { background: 'rgba(120,80,0,0.25)', borderColor: 'rgba(255,170,0,0.35)', color: '#facc15' }}
        >
          {signalOk ? (hasTelemetry ? 'Live' : 'Running') : 'Monitoring'}
        </span>
        <button
          onClick={onStop}
          disabled={isStopping}
          className="text-[9px] font-bold uppercase px-2 py-0.5 shrink-0"
          style={{
            background: 'rgba(180,30,30,0.3)',
            border: '1px solid rgba(220,50,50,0.3)',
            color: '#f87171',
            borderRadius: '2px',
            opacity: isStopping ? 0.55 : 1,
            cursor: isStopping ? 'not-allowed' : 'pointer',
          }}
        >
          {isStopping ? 'Stopping…' : 'Stop'}
        </button>
      </div>

      {/* Thumbnail monitor — keep full frame without artificial overlays */}
      <div
        className="relative w-full overflow-hidden shrink-0"
        style={{ aspectRatio: '16/9', background: '#080808', borderBottom: '1px solid #1a1a1a', outline: '2px solid #1a1a1a' }}
      >
        {hasThumb ? (
          <img
            src={displaySrc || candidateSrc}
            alt={`${id} thumbnail`}
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: 'cover', objectPosition: 'center', display: 'block' }}
            onLoad={(e) => {
              const loaded = e?.currentTarget?.currentSrc || e?.currentTarget?.src || null;
              if (loaded) setDisplaySrc(loaded);
            }}
            onError={() => {
              // Keep last good frame; when none exists, retry a few times for transient file-write gaps.
              if (displaySrc) return;
              if (thumbRetry < 3) {
                setTimeout(() => setThumbRetry((v) => v + 1), 700);
              }
            }}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ background: '#1a1a1a', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)' }} />
            <span className="text-[9px] engraved uppercase tracking-widest">Awaiting Frame</span>
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="p-2 space-y-1.5" style={{ background: '#141414' }}>
        <div
          className="text-[10px] font-mono engraved"
          style={{ color: '#8c97aa', whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: 1.2 }}
        >
          {meta?.url || result?.url || '-'}
        </div>
        <div
          className="text-[10px] font-mono uppercase tracking-wider"
          style={{ color: hasProbeError ? '#ff5555' : freshness.color }}
        >
          {hasProbeError
            ? `probe error: ${String(result.probeError).slice(0, 60)}`
            : `update age: ${freshness.ageSec == null ? '-' : `${freshness.ageSec}s`} - ${freshness.label}`}
        </div>
        <div
          className="text-[10px] font-mono uppercase tracking-wider"
          style={{ color: thumbFresh ? '#00dd55' : '#ffaa00' }}
        >
          thumbnail age: {thumbAgeSec == null ? '-' : `${thumbAgeSec}s`}
        </div>
        <div className="text-[11px] text-gray-300 font-mono" style={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
          <span className="engraved">SVC </span>{primaryService}
          {serviceProvider ? <span className="engraved"> · {serviceProvider}</span> : null}
        </div>

        {/* Audio meters — per-channel L/R with peak hold (EBU-style dBFS scale) */}
        <div>
          <div className="flex items-center justify-between text-[10px] mb-1.5">
            <span className="engraved uppercase tracking-widest">Audio Levels</span>
            <span className="font-mono text-[9px]" style={{ color: Number.isFinite(displayMeanDb) ? meterColor(displayMeanDb) : '#555' }}>
              {Number.isFinite(displayMeanDb) ? `${displayMeanDb.toFixed(1)} dBFS` : 'n/a'}
            </span>
          </div>
          {displayChannels.length > 0 ? (
            <div className="space-y-1">
              {/* Scale markers */}
              <div className="grid items-center gap-1 text-[8px] font-mono text-gray-600" style={{ gridTemplateColumns: '16px 1fr 44px' }}>
                <span />
                <div style={{ position: 'relative', paddingTop: '1px' }}>
                  <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>-18</span>
                  <span style={{ position: 'absolute', left: '85%', transform: 'translateX(-50%)' }}>-9</span>
                  <span style={{ position: 'absolute', right: 0 }}>0</span>
                </div>
                <span />
              </div>
              {displayChannels.map((ch) => {
                const held = peakHoldRef.current[ch.ch];
                const heldPeak = held && (Date.now() - held.heldAt) < PEAK_HOLD_MS ? held.peakDb : ch.peakDb;
                return (
                  <VuBar
                    key={ch.ch}
                    label={ch.label || `Ch${ch.ch + 1}`}
                    rmsDb={ch.rmsDb}
                    peakDb={heldPeak}
                    showPeak
                  />
                );
              })}
            </div>
          ) : displayMeanDb != null ? (
            // Fallback: only aggregate available (mono or older probe)
            <VuBar label="Mix" rmsDb={displayMeanDb} peakDb={displayMaxDb} showPeak />
          ) : (
            <div className="text-[9px] font-mono" style={{ color: '#555' }}>Awaiting audio probe…</div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-1">
          <Stat label="Programs" value={String(result?.programs?.length || 0)} />
          <Stat label="PIDs"     value={String(countPids(result))} />
          <Stat label="TS Rate"  value={formatMbps(transportRate.mbps, 2)} />
          <Stat label="Last Probe" value={result?.probeTime ? new Date(result.probeTime).toLocaleTimeString() : '-'} />
        </div>
        <div className="text-[9px] font-mono" style={{ color: transportRate.trusted ? '#86efac' : '#777' }}>
          TS source: {transportRate.source.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

export default function DecoderMultiviewPanel({ lastMessage }) {
  const { activeIds, resultsById, decoderMeta, error, refreshActives, startContinuous, stop, onWsResult } = useTSAnalysis();
  const [openCreate, setOpenCreate] = useState(false);
  const [openPanelCommission, setOpenPanelCommission] = useState(false);
  const [mode, setMode] = useState('rtp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [decoderId, setDecoderId] = useState('');
  const [interval, setInterval] = useState('5000');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const [engineerMode, setEngineerMode] = useState(true);
  const [engineerModeLabel, setEngineerModeLabel] = useState(DEFAULT_ENGINEER_MODE_LABEL);
  const [isEditingEngineerModeLabel, setIsEditingEngineerModeLabel] = useState(false);
  const [engineerModeLabelDraft, setEngineerModeLabelDraft] = useState(DEFAULT_ENGINEER_MODE_LABEL);
  const [panels, setPanels] = useState([{ id: DEFAULT_PANEL_ID, name: DEFAULT_PANEL_NAME, decoderIds: [] }]);
  const [activePanelId, setActivePanelId] = useState(DEFAULT_PANEL_ID);
  const [newPanelName, setNewPanelName] = useState('');
  const [stoppingIds, setStoppingIds] = useState(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MULTIVIEW_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.openCreate === 'boolean') setOpenCreate(parsed.openCreate);
      if (parsed?.mode) setMode(parsed.mode);
      if (parsed?.host != null) setHost(String(parsed.host));
      if (parsed?.port != null) setPort(String(parsed.port));
      if (parsed?.decoderId != null) setDecoderId(String(parsed.decoderId));
      if (parsed?.interval != null) setInterval(String(parsed.interval));
      if (parsed?.latency != null) setLatency(String(parsed.latency));
      if (parsed?.passphrase != null) setPassphrase(String(parsed.passphrase));
      if (typeof parsed?.engineerMode === 'boolean') setEngineerMode(parsed.engineerMode);
      if (parsed?.engineerModeLabel != null) {
        const nextLabel = String(parsed.engineerModeLabel).trim();
        if (nextLabel) setEngineerModeLabel(nextLabel.slice(0, 32));
      }
      if (Array.isArray(parsed?.panels) && parsed.panels.length > 0) {
        const sanitized = parsed.panels
          .map((p, idx) => ({
            id: String(p?.id || `panel-${idx + 1}`),
            name: normalizePersistedPanelName(p?.name, `PANEL-${idx + 1}`) || `PANEL-${idx + 1}`,
            decoderIds: Array.isArray(p?.decoderIds) ? p.decoderIds.map((id) => String(id)) : [],
          }))
          .filter((p) => p.id);
        if (sanitized.length > 0) setPanels(sanitized);
      }
      if (parsed?.activePanelId != null) setActivePanelId(String(parsed.activePanelId));
    } catch (_) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        MULTIVIEW_STATE_KEY,
        JSON.stringify({
          openCreate,
          mode,
          host,
          port,
          decoderId,
          interval,
          latency,
          passphrase,
          engineerMode,
          engineerModeLabel,
          panels,
          activePanelId,
        })
      );
    } catch (_) {}
  }, [openCreate, mode, host, port, decoderId, interval, latency, passphrase, engineerMode, engineerModeLabel, panels, activePanelId]);

  const beginEngineerModeLabelEdit = () => {
    setEngineerModeLabelDraft(engineerModeLabel);
    setIsEditingEngineerModeLabel(true);
  };

  const commitEngineerModeLabelEdit = () => {
    const trimmed = String(engineerModeLabelDraft || '').trim();
    setEngineerModeLabel(trimmed ? trimmed.slice(0, 32) : DEFAULT_ENGINEER_MODE_LABEL);
    setIsEditingEngineerModeLabel(false);
  };

  const cancelEngineerModeLabelEdit = () => {
    setEngineerModeLabelDraft(engineerModeLabel);
    setIsEditingEngineerModeLabel(false);
  };

  useEffect(() => {
    refreshActives();
  }, [refreshActives]);

  useEffect(() => {
    const t = setInterval(() => {
      refreshActives();
    }, MULTIVIEW_REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshActives]);

  // Mount-phase rapid retry: when active analysers exist but resultsById is still
  // empty (server probe not yet complete or first WS message hasn't arrived),
  // re-poll until data appears or retry budget is exhausted.
  const mountRetryCountRef = React.useRef(0);
  useEffect(() => {
    mountRetryCountRef.current = 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // reset on mount only

  useEffect(() => {
    if (activeIds.length === 0) return; // nothing running yet
    const hasData = activeIds.some((id) => resultsById[id]?.probeTime);
    if (hasData) { mountRetryCountRef.current = MOUNT_RETRY_MAX; return; } // satisfied
    if (mountRetryCountRef.current >= MOUNT_RETRY_MAX) return;
    mountRetryCountRef.current += 1;
    const t = setTimeout(() => refreshActives(), MOUNT_RETRY_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [activeIds, resultsById, refreshActives]);

  useEffect(() => {
    if (lastMessage) onWsResult(lastMessage);
  }, [lastMessage, onWsResult]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), MULTIVIEW_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (panels.length === 0) {
      setPanels([{ id: DEFAULT_PANEL_ID, name: DEFAULT_PANEL_NAME, decoderIds: [] }]);
      setActivePanelId(DEFAULT_PANEL_ID);
      return;
    }
    if (!panels.some((p) => p.id === activePanelId)) {
      setActivePanelId(panels[0].id);
    }
  }, [panels, activePanelId]);

  useEffect(() => {
    // Runtime migration: force legacy default labels to BES even when state is already loaded.
    const hasLegacyName = panels.some((p) => {
      const n = normalizePanelName(p?.name || '');
      return n === 'MCR-WALL-A' || n === 'WALL-A';
    });
    if (!hasLegacyName) return;
    setPanels((prev) => prev.map((p) => {
      const n = normalizePanelName(p?.name || '');
      if (n === 'MCR-WALL-A' || n === 'WALL-A') return { ...p, name: DEFAULT_PANEL_NAME };
      return p;
    }));
  }, [panels]);

  useEffect(() => {
    setPanels((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      if (activeIds.length === 0) return prev; // no active analysers yet — wait
      const assignedCount = prev.reduce((acc, p) => acc + (p.decoderIds?.length || 0), 0);
      // Check if any stored decoder ID is still in the active set.
      // If assignedCount > 0 but ALL stored IDs are stale (server restart with new IDs),
      // treat as empty and reseed — otherwise zero tiles would render permanently.
      const anyActive = prev.some((p) => (p.decoderIds || []).some((id) => activeIds.includes(id)));
      if (assignedCount > 0 && anyActive) return prev; // routing is valid, keep it
      // No valid routing: first-time seed or full stale-ID recovery.
      return prev.map((p, idx) => (idx === 0 ? { ...p, decoderIds: [...activeIds] } : p));
    });
  }, [activeIds]);

  const probeUrl = buildProbeUrl({ mode, host, port, latency, passphrase });
  const activePanel = panels.find((p) => p.id === activePanelId) || panels[0] || null;
  const visibleIds = activeIds.filter((id) => (activePanel?.decoderIds || []).includes(id));
  const normalizedDraftPanelName = normalizePanelName(newPanelName);
  const panelNameInUse = panels.some((p) => p.name.toUpperCase() === normalizedDraftPanelName);
  const panelNameValid = normalizedDraftPanelName.length >= 3 && !panelNameInUse;

  const toggleDecoderInActivePanel = (id) => {
    if (!activePanel) return;
    setPanels((prev) => prev.map((p) => {
      if (p.id !== activePanel.id) return p;
      const has = (p.decoderIds || []).includes(id);
      const decoderIds = has ? p.decoderIds.filter((x) => x !== id) : [...p.decoderIds, id];
      return { ...p, decoderIds };
    }));
  };

  const createPanel = () => {
    const name = normalizedDraftPanelName;
    if (!name || name.length < 3) return;
    if (panelNameInUse) return;
    const id = `panel-${Date.now()}`;
    const panel = { id, name, decoderIds: [] };
    setPanels((prev) => [...prev, panel]);
    setActivePanelId(id);
    setNewPanelName('');
    setOpenPanelCommission(false);
  };

  const removePanel = (id) => {
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== id);
      return next.length > 0 ? next : [{ id: DEFAULT_PANEL_ID, name: DEFAULT_PANEL_NAME, decoderIds: [] }];
    });
    if (activePanelId === id) {
      const remaining = panels.filter((p) => p.id !== id);
      setActivePanelId(remaining[0]?.id || DEFAULT_PANEL_ID);
    }
  };

  const handleCreate = async () => {
    if (!probeUrl) return;
    const id = decoderId || `decoder-${Date.now()}`;
    try {
      await startContinuous(id, probeUrl, parseInt(interval, 10) || 5000);
      setPanels((prev) => prev.map((p) => {
        if (p.id !== activePanelId) return p;
        if ((p.decoderIds || []).includes(id)) return p;
        return { ...p, decoderIds: [...(p.decoderIds || []), id] };
      }));
      setOpenCreate(false);
      setDecoderId('');
      // Sync in background; do not block first-tile render.
      refreshActives();
    } catch (_) {
      // Hook exposes error state; keep form open for correction/retry.
    }
  };

  return (
    <div className="space-y-6 broadcast-legacy">
      <BentoCard icon={Monitor} title="Decoder Multiview">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold">Multiview Workspaces</h2>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-gray-500 font-mono">
              Active: {activeIds.length} · Panel: {activePanel?.name || '-'} ({visibleIds.length})
            </div>
            {isEditingEngineerModeLabel ? (
              <div className="inline-flex items-center gap-1">
                <input
                  value={engineerModeLabelDraft}
                  onChange={(e) => setEngineerModeLabelDraft(e.target.value)}
                  onBlur={commitEngineerModeLabelEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEngineerModeLabelEdit();
                    if (e.key === 'Escape') cancelEngineerModeLabelEdit();
                  }}
                  maxLength={32}
                  autoFocus
                  className="text-xs px-2 py-1 rounded border border-neon-cyan/50 text-gray-200 bg-black/40 min-w-[96px]"
                  title="Enter to save, Esc to cancel"
                />
              </div>
            ) : (
              <div className="inline-flex items-center gap-1">
                <button
                  onClick={() => setEngineerMode((v) => !v)}
                  onDoubleClick={beginEngineerModeLabelEdit}
                  className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1 ${
                    engineerMode
                      ? 'border-neon-cyan/50 bg-neon-cyan/10'
                      : 'border-white/10 bg-black/20'
                  }`}
                  title="Click to toggle mode. Double-click text to edit label."
                >
                  <span className="text-gray-400">{engineerModeLabel}</span>
                  <span className="text-gray-500">:</span>
                  <span className={engineerMode ? 'text-neon-cyan' : 'text-gray-400'}>
                    {engineerMode ? 'ON' : 'OFF'}
                  </span>
                </button>
                <button
                  onClick={beginEngineerModeLabelEdit}
                  className="inline-flex items-center justify-center w-6 h-6 rounded border border-white/15 text-gray-300 bg-black/20 hover:bg-black/35"
                  title="Edit mode label"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              </div>
            )}
            <button
              onClick={() => setOpenPanelCommission((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded border transition-all duration-150"
              style={{
                color: '#a5f3fc',
                borderColor: 'rgba(34, 211, 238, 0.45)',
                background: 'rgba(34, 211, 238, 0.12)',
                boxShadow: '0 0 10px rgba(34,211,238,0.22), inset 0 1px 0 rgba(255,255,255,0.10)',
              }}
            >
              <Plus className="w-3 h-3" />
              Panel
            </button>
            <button
              onClick={() => setOpenCreate(v => !v)}
              className="inline-flex items-center gap-1 text-xs bg-neon-cyan/20 hover:bg-neon-cyan/30 text-neon-cyan border border-neon-cyan/40 px-2 py-1 rounded"
            >
              <Plus className="w-3 h-3" />
              Decoder
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {panels.map((panel) => (
            <div key={panel.id} className="inline-flex items-center">
              <button
                onClick={() => setActivePanelId(panel.id)}
                className={`text-[10px] font-mono uppercase tracking-[0.1em] px-2.5 py-1 rounded-l border ${
                  activePanelId === panel.id
                    ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                    : 'border-white/15 text-gray-400 bg-black/20'
                }`}
                title={panel.name}
              >
                {panel.name}
              </button>
              {panels.length > 1 && (
                <button
                  onClick={() => removePanel(panel.id)}
                  className="text-[9px] px-1.5 py-1 rounded-r border border-l-0 transition-colors"
                  style={{
                    borderColor: 'rgba(255,255,255,0.12)',
                    color: '#6b7280',
                    background: 'rgba(0,0,0,0.22)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#9ca3af';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)';
                    e.currentTarget.style.background = 'rgba(0,0,0,0.34)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#6b7280';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                    e.currentTarget.style.background = 'rgba(0,0,0,0.22)';
                  }}
                  title="Remove panel"
                >
                  x
                </button>
              )}
            </div>
          ))}
        </div>

        {openPanelCommission && (
          <div className="mt-3 p-3 rounded-xl border border-white/10 bg-black/20 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-bold">Panel Commissioning</div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
              <Field
                label="Panel Callsign"
                value={newPanelName}
                onChange={(v) => setNewPanelName(v)}
                placeholder="e.g. BES"
              />
              <button
                onClick={createPanel}
                disabled={!panelNameValid}
                className="text-xs px-3 py-2 rounded border disabled:opacity-50 border-neon-cyan/40 text-neon-cyan bg-neon-cyan/10"
              >
                Rack Panel
              </button>
              <button
                onClick={() => {
                  setOpenPanelCommission(false);
                  setNewPanelName('');
                }}
                className="text-xs px-3 py-2 rounded border border-white/15 text-gray-400 bg-black/20"
              >
                Abort
              </button>
            </div>
            <div className="text-[10px] font-mono text-gray-500">
              TAB PREVIEW: [{normalizedDraftPanelName || '---'}]
            </div>
            {!panelNameValid && newPanelName ? (
              <div className="text-[10px] text-amber-300">
                {panelNameInUse ? 'Callsign already in use.' : 'Use 3-24 chars: A-Z, 0-9, -'}
              </div>
            ) : null}
          </div>
        )}

        {activeIds.length > 0 && activePanel && (
          <div className="mt-3 p-3 rounded-xl border border-white/10 bg-black/20">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-bold mb-2">
              Panel Routing - {activePanel.name}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeIds.map((id) => {
                const assigned = (activePanel.decoderIds || []).includes(id);
                return (
                  <button
                    key={`route-${activePanel.id}-${id}`}
                    onClick={() => toggleDecoderInActivePanel(id)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border ${
                      assigned
                        ? 'border-neon-cyan/60 text-neon-cyan bg-neon-cyan/10'
                        : 'border-white/15 text-gray-500 bg-black/20'
                    }`}
                  >
                    {id}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {openCreate && (
          <div className="mt-4 p-3 rounded-xl border border-white/10 bg-black/20 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {['rtp', 'srt', 'udp'].map(v => (
                <button
                  key={v}
                  onClick={() => setMode(v)}
                  className={`px-3 py-2 rounded-lg text-xs border ${mode === v ? 'bg-neon-cyan/20 border-neon-cyan/50 text-white' : 'bg-black/30 border-white/10 text-gray-400'}`}
                >
                  {v.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Host / IP" value={host} onChange={setHost} placeholder="Host / IP" />
              <Field label="Port" value={port} onChange={setPort} type="number" placeholder="Port" />
              <Field label="Decoder ID" value={decoderId} onChange={setDecoderId} placeholder="decoder-a" />
              <Field label="Refresh (ms)" value={interval} onChange={setInterval} type="number" placeholder="5000" />
            </div>
            {mode === 'srt' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
                <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="optional" />
              </div>
            )}
            <div className="text-[11px] text-gray-500 font-mono truncate">{probeUrl || 'Fill host/port to build decoder URL'}</div>
            <div className="flex justify-end">
              <button
                onClick={handleCreate}
                disabled={!probeUrl}
              className="text-xs bg-purple-700 hover:bg-purple-600 text-white px-3 py-1.5 rounded disabled:opacity-50"
              >
                Add Tile
              </button>
            </div>
            <div className="text-[10px] text-gray-500">
              Continuous probe cadence is target-based. Heavy bitrate/SI sampling runs every few cycles to reduce multiview lag.
            </div>
          </div>
        )}

        {activeIds.length === 0 && (
          <p className="text-gray-500 text-sm mt-4">No active decoders. Start decoders from Decoder tab.</p>
        )}
        {activeIds.length > 0 && visibleIds.length === 0 && (
          <p className="text-gray-500 text-sm mt-4">No decoders assigned to panel {activePanel?.name || '-'}. Route decoders above.</p>
        )}
        {error && (
          <p className="text-amber-300 text-xs mt-2">Multiview warning: {error}</p>
        )}

        <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {visibleIds.map((id) => (
            <DecoderCard
              key={id}
              id={id}
              displayName={getMultiviewDisplayName(id)}
              meta={decoderMeta[id]}
              result={resultsById[id]}
              onStop={async () => {
                if (stoppingIds.has(id)) return;
                setStoppingIds((prev) => {
                  const next = new Set(prev);
                  next.add(id);
                  return next;
                });
                try {
                  await stop(id);
                } finally {
                  // Background refresh keeps UI responsive while stop settles.
                  refreshActives();
                  setStoppingIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }
              }}
              nowMs={nowMs}
              engineerMode={engineerMode}
              isStopping={stoppingIds.has(id)}
            />
          ))}
        </div>
      </BentoCard>
    </div>
  );
}
