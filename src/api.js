'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

const persistence = require('./state-persistence');
const eventLog = require('./event-log');

const API_HOST = process.env.API_HOST || '10.67.18.29';
const API_PORT = parseInt(process.env.API_PORT, 10) || 4000;

// Shared state maps
const streams = new Map();       // id → SRTEncoder
const transcoders = new Map();   // id → Transcoder
const forwarders = new Map();    // id → MulticastForwarder
const analysers = new Map();     // id → TSAnalyser
const etr290monitors = new Map(); // id → ETR290Analyser

let _lastCpuSample = null;

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
  };
}

function createApp(wss) {
  const app = express();
  app.use(express.json());

  // Serve built frontend
  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));

  // Mount routes
  app.use('/streams', require('../routes/streams')(streams, wss));
  app.use('/transcode', require('../routes/transcode')(transcoders, wss));
  app.use('/multicast', require('../routes/multicast')(forwarders, wss));
  app.use('/analyse', require('../routes/analyse')(analysers, wss));
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
  persistence.save(streams, transcoders, forwarders);
}

// ─── Restore persisted engines after boot ────────────────────────────────────
async function restoreState(broadcast) {
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
}

function start() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  // Rebuild app with wss injected
  app.use(express.json());

  const webDist = path.join(__dirname, '..', 'web', 'dist');
  app.use(express.static(webDist));

  // Serve thumbnails for Confidence Monitor
  const { THUMBNAIL_DIR } = require('./monitoring');
  app.use('/logs/thumbnails', express.static(THUMBNAIL_DIR));

  function broadcast(msg) {
    if (!msg || typeof msg !== 'object') return;
    eventLog.push(msg);
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  app.use('/streams',   require('../routes/streams')(streams, wss, saveState, broadcast));
  app.use('/transcode', require('../routes/transcode')(transcoders, wss, saveState, broadcast));
  app.use('/multicast', require('../routes/multicast')(forwarders, wss, saveState, broadcast));
  app.use('/analyse',   require('../routes/analyse')(analysers, wss, broadcast));
  app.use('/etr290',    require('../routes/etr290')(etr290monitors, wss, broadcast));
  app.use('/pipeline',  require('../routes/pipelines')(streams, transcoders, forwarders, wss, saveState, broadcast));
  app.use('/scte35',    require('../routes/scte35')());
  app.use('/api/events', require('../routes/events')(eventLog));

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
    // Restore engines after a short delay to let the event loop settle
    setTimeout(() => restoreState(broadcast), 2000);
  });

  return { server, wss, streams, transcoders, forwarders, analysers, etr290monitors };
}

module.exports = { start, broadcastStats, saveState, streams, transcoders, forwarders, analysers, etr290monitors };
