'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const pkg = require('../package.json');
const { getMonitoringPolicySummary } = require('./monitoring-policy');
const { getToolingPreflightSnapshot, startToolingPreflightAutoRefresh } = require('./tooling-preflight');

const persistence = require('./state-persistence');
const eventLog = require('./event-log');
const { ThumbnailWorkerClient } = require('./thumbnail-worker-client');

const API_HOST = process.env.API_HOST || '0.0.0.0';
const API_PORT = parseInt(process.env.API_PORT, 10) || 4000;
const APP_VERSION = pkg.version || '0.0.0';
const RELEASE_VERSION = process.env.LABOTECH_RELEASE || `v${APP_VERSION}`;

// Shared state maps
const streams = new Map();       // id → SRTEncoder
const transcoders = new Map();   // id → Transcoder
const forwarders = new Map();    // id → MulticastForwarder
const analysers = new Map();     // id → TSAnalyser
const etr290monitors = new Map(); // id → ETR290Analyser

let _lastCpuSample = null;
let _etrOrphanWatchdog = null;
let _thumbnailClient = null;


function _sampleCpuPercent() {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return null;

  const totals = cpus.map(c => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { total, idle: t.idle };
  });

  if (!_lastCpuSample) {
    _lastCpuSample = totals;
    return null;
  }

  let totalDiff = 0;
  let idleDiff = 0;
  for (let i = 0; i < totals.length; i++) {
    totalDiff += (totals[i].total - _lastCpuSample[i].total);
    idleDiff += (totals[i].idle - _lastCpuSample[i].idle);
  }
  _lastCpuSample = totals;
  if (totalDiff <= 0) return null;
  return Number((((totalDiff - idleDiff) / totalDiff) * 100).toFixed(1));
}

function getHealthPayload() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpuPercent = _sampleCpuPercent();

  return {
    status: 'ok',
    version: APP_VERSION,
    release: RELEASE_VERSION,
    uptime: process.uptime(),
    streams: streams.size + transcoders.size,
    telemetry: {
      cpuPercent,
      load1m: Number(os.loadavg()[0].toFixed(2)),
      memoryPercent: Number(((usedMem / totalMem) * 100).toFixed(1)),
      memoryUsedMB: Math.round(usedMem / (1024 * 1024)),
      memoryTotalMB: Math.round(totalMem / (1024 * 1024)),
      processRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
    },
    tooling: getToolingPreflightSnapshot(),
    monitoringPolicy: getMonitoringPolicySummary(),
  };
}

function createApp(wss) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Serve built frontend
  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));

  // Mount routes
  app.use('/streams', require('../routes/streams')(streams, wss));
  app.use('/transcode', require('../routes/transcode')(transcoders, wss));
  app.use('/multicast', require('../routes/multicast')(forwarders, wss));
  app.use('/analyse', require('../routes/analyse')(analysers, wss, null, null, null, etr290monitors));
  app.use('/etr290', require('../routes/etr290')(etr290monitors, wss));
  app.use('/pipeline', require('../routes/pipelines')(streams, transcoders, forwarders, wss, saveState));
  app.use('/scte35', require('../routes/scte35')());

  app.get('/health', (req, res) => {
    res.json(getHealthPayload());
  });

  // Fallback → SPA
  app.get('*', (req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });

  return app;
}

function broadcastStats(wss, type, id, stats) {
  const msg = JSON.stringify({ type, id, ...stats });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function saveState() {
  persistence.save(streams, transcoders, forwarders, analysers, etr290monitors);
}

function _isManagedEtrMonitorId(id) {
  // Any etr-* monitor is lifecycle-managed — auto-start creates etr-<analyserID>
  // which may not match the legacy etr-(decoder|analyser)-* pattern.
  return /^etr-/i.test(String(id || ''));
}

function _linkedAnalyserIdFromEtrId(id) {
  const v = String(id || '');
  if (!v.startsWith('etr-')) return null;
  return v.slice(4) || null;
}

function startEtrOrphanWatchdog() {
  if (_etrOrphanWatchdog) return;
  const graceMs = Math.max(5000, parseInt(process.env.ETR_ORPHAN_GRACE_MS || '15000', 10) || 15000);
  const checkEveryMs = Math.max(2000, parseInt(process.env.ETR_ORPHAN_CHECK_MS || '5000', 10) || 5000);
  const missingSince = new Map(); // monitorId -> first missing timestamp

  _etrOrphanWatchdog = setInterval(() => {
    const now = Date.now();
    for (const [monitorId, mon] of etr290monitors.entries()) {
      if (!mon || !mon.isRunning) {
        missingSince.delete(monitorId);
        continue;
      }
      if (!_isManagedEtrMonitorId(monitorId)) {
        // Keep manually managed ETR monitors untouched.
        missingSince.delete(monitorId);
        continue;
      }
      const linkedAnalyserId = _linkedAnalyserIdFromEtrId(monitorId);
      if (!linkedAnalyserId) {
        missingSince.delete(monitorId);
        continue;
      }
      const linkedAnalyser = analysers.get(linkedAnalyserId);
      if (linkedAnalyser && linkedAnalyser.isRunning) {
        missingSince.delete(monitorId);
        continue;
      }
      const firstMissingAt = missingSince.get(monitorId) || now;
      if (!missingSince.has(monitorId)) {
        missingSince.set(monitorId, firstMissingAt);
        continue;
      }
      if ((now - firstMissingAt) < graceMs) continue;
      try {
        mon.stop();
      } catch (_) {
        // best-effort cleanup
      }
      etr290monitors.delete(monitorId);
      missingSince.delete(monitorId);
      // Unlink from TSAnalyser
      const orphanAnalyser = analysers.get(linkedAnalyserId);
      if (orphanAnalyser && typeof orphanAnalyser.clearEtrMonitor === 'function') {
        orphanAnalyser.clearEtrMonitor();
      }
      console.log(`[health] Auto-stopped orphan ETR monitor ${monitorId} (linked analyser ${linkedAnalyserId} not running)`);
    }
  }, checkEveryMs);
  if (typeof _etrOrphanWatchdog.unref === 'function') _etrOrphanWatchdog.unref();
}

// ─── Restore persisted engines after boot ────────────────────────────────────
async function restoreState(broadcast, thumbnailClient) {
  const state = persistence.load();
  if (!state) return;
  const restoreStreams = process.env.RESTORE_STREAMS_ON_BOOT === 'true';
  const restoreTranscoders = process.env.RESTORE_TRANSCODERS_ON_BOOT === 'true';
  const restoreForwarders = process.env.RESTORE_FORWARDERS_ON_BOOT === 'true';

  const SRTEncoder          = require('./encoder');
  const Transcoder          = require('./transcoder');
  const { MulticastForwarder } = require('./multicast-forward');

  if (restoreStreams) {
    for (const cfg of (state.streams || [])) {
      if (streams.has(cfg.id)) continue;
      try {
        const enc = new SRTEncoder(cfg);
        enc.on('stats',    s   => broadcast({ type: 'stats',    id: cfg.id, ...s }));
        enc.on('info',     msg => broadcast({ type: 'info',     id: cfg.id, message: msg.message, inputBitrate: msg.inputBitrate, inputBitrateWatchAttempts: msg.inputBitrateWatchAttempts }));
        enc.on('srtStats', s   => broadcast({ type: 'srtStats', id: cfg.id, ...s }));
        enc.on('error',    err => broadcast({ type: 'error',    id: cfg.id, message: err.message }));
        enc.on('stopped',  ()  => broadcast({ type: 'stopped',  id: cfg.id }));
        enc.start();
        streams.set(cfg.id, enc);
        console.log(`[state] Restored stream: ${cfg.id}`);
      } catch (err) {
        console.error(`[state] Failed to restore stream ${cfg.id}:`, err.message);
      }
    }
  } else if ((state.streams || []).length > 0) {
    console.log('[state] Stream restore skipped (set RESTORE_STREAMS_ON_BOOT=true to enable)');
  }

  if (restoreTranscoders) {
    for (const cfg of (state.transcoders || [])) {
      if (transcoders.has(cfg.id)) continue;
      try {
        const t = new Transcoder(cfg);
        t.on('stats',   s   => broadcast({ type: 'transcode_stats',    id: cfg.id, ...s }));
        t.on('error',   err => broadcast({ type: 'error',              id: cfg.id, message: err.message }));
        t.on('stopped', ()  => broadcast({ type: 'transcode_stopped',  id: cfg.id }));
        t.start();
        transcoders.set(cfg.id, t);
        console.log(`[state] Restored transcoder: ${cfg.id}`);
      } catch (err) {
        console.error(`[state] Failed to restore transcoder ${cfg.id}:`, err.message);
      }
    }
  } else if ((state.transcoders || []).length > 0) {
    console.log('[state] Transcoder restore skipped (set RESTORE_TRANSCODERS_ON_BOOT=true to enable)');
  }

  if (restoreForwarders) {
    for (const cfg of (state.forwarders || [])) {
      if (forwarders.has(cfg.id)) continue;
      try {
        const fwd = new MulticastForwarder(cfg);
        fwd.on('stats',   s   => broadcast({ type: 'multicast_stats',    id: cfg.id, ...s }));
        fwd.on('error',   err => broadcast({ type: 'error',              id: cfg.id, message: err.message }));
        fwd.on('stopped', ()  => broadcast({ type: 'multicast_stopped',  id: cfg.id }));
        await fwd.start();
        forwarders.set(cfg.id, fwd);
        console.log(`[state] Restored forwarder: ${cfg.id}`);
      } catch (err) {
        console.error(`[state] Failed to restore forwarder ${cfg.id}:`, err.message);
      }
    }
  } else if ((state.forwarders || []).length > 0) {
    console.log('[state] Forwarder restore skipped (set RESTORE_FORWARDERS_ON_BOOT=true to enable)');
  }

  // Analysers always restore — decoders must survive container restarts.
  // Dedup by URL: if multiple saved analysers point to the same source URL,
  // only restore the last one (highest index = most recently started).
  // This prevents ghost thumbnail processes competing for single-listener SRT
  // slots when a user starts a new decoder without stopping the old one.
  const TSAnalyser = require('./ts-analyser');
  const savedAnalysers = state.analysers || [];
  const urlToLatestIdx = new Map();
  savedAnalysers.forEach((cfg, i) => { if (cfg.url) urlToLatestIdx.set(cfg.url, i); });

  for (let i = 0; i < savedAnalysers.length; i++) {
    const cfg = savedAnalysers[i];
    if (analysers.has(cfg.id)) continue;
    // Skip superseded duplicate — a newer analyser for this URL will be restored instead.
    if (cfg.url && urlToLatestIdx.get(cfg.url) !== i) {
      console.log(`[state] Skipping duplicate analyser ${cfg.id} (URL already claimed by a newer entry)`);
      continue;
    }
    try {
      const a = new TSAnalyser({ id: cfg.id, url: cfg.url, interval: cfg.interval, nicName: cfg.nicName, thumbnailClient: thumbnailClient || undefined });
      a.on('result',       result => broadcast({ type: 'analyse_result', id: cfg.id, ...result }));
      a.on('health_alarm', data   => broadcast({ type: 'health_alarm',   id: cfg.id, ...data }));
      a.on('error',        err    => broadcast({ type: 'error',          id: cfg.id, message: err.message }));
      a.startContinuous();
      analysers.set(cfg.id, a);
      console.log(`[state] Restored analyser: ${cfg.id}`);
    } catch (err) {
      console.error(`[state] Failed to restore analyser ${cfg.id}:`, err.message);
    }
  }

  // ETR290 monitors always restore — linked to their decoder's lifecycle.
  // Must run AFTER analysers: SRT streams need the relay (created by TSAnalyser.startContinuous())
  // to be instantiated so getRelayUrl() returns the correct UDP loopback URL.
  const ETR290Analyser = require('./etr290-analyser');
  const savedEtr = state.etr290monitors || [];
  for (const cfg of savedEtr) {
    if (etr290monitors.has(cfg.id)) continue;
    try {
      let effectiveUrl = cfg.url;
      if (cfg.url && cfg.url.startsWith('srt://')) {
        // Prefer explicit linkedAnalyserId stored at save time; fall back to
        // etr-<id> convention for entries saved before this field was added.
        const linkedId = cfg.linkedAnalyserId
          || (/^etr-/i.test(cfg.id) ? cfg.id.slice(4) : null);
        const linkedAnalyser = linkedId ? analysers.get(linkedId) : null;
        const relayUrl = linkedAnalyser && typeof linkedAnalyser.getRelayUrl === 'function'
          ? linkedAnalyser.getRelayUrl()
          : null;
        if (!relayUrl) {
          console.warn(`[state] ETR restore skipped ${cfg.id}: decoder relay not available`);
          continue;
        }
        effectiveUrl = relayUrl;
      }
      const mon = new ETR290Analyser({
        id:          cfg.id,
        url:         effectiveUrl,
        nicName:     cfg.nicName     || undefined,
        config:      cfg.config      || {},
        profileName: cfg.profileName || null,
      });
      mon.on('etr290',            status   => broadcast({ type: 'etr290_status',           id: cfg.id, ...status   }));
      mon.on('alarm',             alarm    => broadcast({ type: 'etr290_alarm',             id: cfg.id, ...alarm    }));
      mon.on('incident_started',  incident => broadcast({ type: 'etr290_incident_started',  id: cfg.id, ...incident }));
      mon.on('incident_updated',  incident => broadcast({ type: 'etr290_incident_updated',  id: cfg.id, ...incident }));
      mon.on('incident_cleared',  incident => broadcast({ type: 'etr290_incident_cleared',  id: cfg.id, ...incident }));
      mon.on('error',             err      => broadcast({ type: 'error',                    id: cfg.id, message: err.message }));
      mon.on('stopped',           ()       => broadcast({ type: 'etr290_stopped',           id: cfg.id }));
      const relinkId = cfg.linkedAnalyserId
        || (/^etr-/i.test(cfg.id) ? cfg.id.slice(4) : null);
      if (relinkId) {
        const linkedAnalyser = analysers.get(relinkId);
        if (linkedAnalyser && typeof linkedAnalyser.setEtrMonitor === 'function') {
          linkedAnalyser.setEtrMonitor(mon);
        }
      }
      mon.start(0); // relay already running — no start delay needed
      etr290monitors.set(cfg.id, mon);
      console.log(`[state] Restored ETR290 monitor: ${cfg.id}`);
    } catch (err) {
      console.error(`[state] Failed to restore ETR290 monitor ${cfg.id}:`, err.message);
    }
  }
}

function start() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // Rebuild app with wss injected
  app.use(express.json({ limit: '2mb' }));

  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));

  // Serve thumbnails for Confidence Monitor
  const { THUMBNAIL_DIR } = require('./monitoring');
  app.use('/logs/thumbnails', express.static(THUMBNAIL_DIR));

  // Message types that are routine telemetry/heartbeats — high-frequency, not alarm events.
  // These are broadcast to WebSocket clients but NOT persisted to the event log.
  const TELEMETRY_TYPES = new Set([
    'etr290_status',  // heartbeat every 1s per ETR monitor
    'analyse_result', // probe result every 5s per decoder
    'stats',          // encoder stats heartbeat
  ]);

  function broadcast(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (!TELEMETRY_TYPES.has(msg.type)) eventLog.push(msg);
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  // Thumbnail worker — start early so routes can reference it
  _thumbnailClient = new ThumbnailWorkerClient();
  _thumbnailClient.on('frame',        (id, url, filePath) => {
    const a = analysers.get(id);
    if (a) {
      const thumbUrl = `/logs/thumbnails/${path.basename(filePath)}?t=${Date.now()}`;
      a._lastThumbnailUrl = thumbUrl;
      // Merge into lastResult so toJSON() → refreshActives() restores the URL
      // on tab switch. Mirrors the same fix applied to pollRelayThumb.
      a.lastResult = a.lastResult
        ? { ...a.lastResult, thumbnailUrl: thumbUrl }
        : { id: a.id, thumbnailUrl: thumbUrl };
    }
    broadcast({ type: 'thumbnail_frame', id, url, path: filePath });
  });
  _thumbnailClient.on('worker_exit',  (e) => console.warn(`[thumbnail-worker] exited (code=${e.code} signal=${e.signal}), respawn in ${e.restartInMs}ms`));
  _thumbnailClient.on('worker_error', (e) => console.error(`[thumbnail-worker] error id=${e.id}: ${e.message}`));

  app.use('/streams',   require('../routes/streams')(streams, wss, saveState, broadcast));
  app.use('/encap',     require('../routes/encap')());
  app.use('/transcode', require('../routes/transcode')(transcoders, wss, saveState, broadcast));
  app.use('/multicast', require('../routes/multicast')(forwarders, wss, saveState, broadcast));
  app.use('/analyse',   require('../routes/analyse')(analysers, wss, broadcast, saveState, _thumbnailClient, etr290monitors));
  app.use('/etr290',    require('../routes/etr290')(etr290monitors, wss, broadcast, analysers));
  app.use('/pipeline',  require('../routes/pipelines')(streams, transcoders, forwarders, wss, saveState, broadcast));
  app.use('/scte35',    require('../routes/scte35')());
  app.use('/monitoring-policy', require('../routes/monitoring-policy')());
  app.use('/api/events', require('../routes/events')(eventLog));
  app.use('/api/multiview', require('../routes/multiview')(analysers, saveState, broadcast));

  app.get('/health', (req, res) => {
    res.json(getHealthPayload());
  });

  app.get('*', (req, res) => {
    const indexPath = path.join(webDist, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).json({ status: 'Labotech API running' });
    }
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', uptime: process.uptime() }));
  });

  server.listen(API_PORT, API_HOST, () => {
    console.log(`Labotech API listening on http://${API_HOST}:${API_PORT}`);
    startToolingPreflightAutoRefresh();
    startEtrOrphanWatchdog();
    // Restore engines after a short delay to let the event loop settle
    setTimeout(() => restoreState(broadcast, _thumbnailClient), 2000);

    process.on('SIGTERM', async () => {
      console.log('[api] SIGTERM received — shutting down');
      // Stop all analysers first: clears relay-backed SRT one-shot timers and
      // any in-process PersistentThumbnailCapture instances (fallback path).
      for (const a of analysers.values()) { try { a.stop(); } catch (_) {} }
      if (_thumbnailClient) await _thumbnailClient.shutdown();
      process.exit(0);
    });
  });

  return { server, wss, streams, transcoders, forwarders, analysers, etr290monitors };
}

module.exports = { start, broadcastStats, saveState, streams, transcoders, forwarders, analysers, etr290monitors };
