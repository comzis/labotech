'use strict';

require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const { spawn } = require('child_process');
const SRTEncapsulatorChannel = require('./encapsulator-channel');

const ENCAPSULATOR_HOST = process.env.ENCAPSULATOR_HOST || '127.0.0.1';
const ENCAPSULATOR_PORT = parseInt(process.env.ENCAPSULATOR_PORT, 10) || 4100;

const channels = new Map();
let _lastCpuSample = null;

function sampleCpuPercent() {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return null;
  const totals = cpus.map((c) => {
    const t = c.times;
    return { total: t.user + t.nice + t.sys + t.idle + t.irq, idle: t.idle };
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

function ffmpegCapabilities() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve({ ok: false, libsrt: false, details: 'ffmpeg not available' }));
    proc.on('exit', (code) => {
      const libsrt = /enable-libsrt/i.test(out);
      const firstLine = (out.split('\n')[0] || '').trim();
      resolve({ ok: code === 0, libsrt, details: firstLine || 'unknown ffmpeg version' });
    });
  });
}

function createHealthPayload(capability) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    status: capability.libsrt ? 'ok' : 'degraded',
    service: 'labotech-encapsulator',
    uptime: process.uptime(),
    channels: channels.size,
    host: ENCAPSULATOR_HOST,
    port: ENCAPSULATOR_PORT,
    capabilities: capability,
    telemetry: {
      cpuPercent: sampleCpuPercent(),
      load1m: Number(os.loadavg()[0].toFixed(2)),
      memoryPercent: Number(((usedMem / totalMem) * 100).toFixed(1)),
      memoryUsedMB: Math.round(usedMem / (1024 * 1024)),
      memoryTotalMB: Math.round(totalMem / (1024 * 1024)),
      processRssMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    },
  };
}

function startEncapsulatorApi() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  app.get('/health', async (req, res) => {
    const capability = await ffmpegCapabilities();
    res.json(createHealthPayload(capability));
  });

  app.get('/channels', (req, res) => {
    res.json([...channels.values()].map((c) => c.toJSON()));
  });

  app.get('/channels/:id', (req, res) => {
    const channel = channels.get(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json(channel.toJSON());
  });

  app.post('/channels', (req, res) => {
    const {
      id, input, inputLocalAddr, host, port, latency,
      passphrase, pbkeylen, streamId, adapter,
      serviceId, transportStreamId, originalNetworkId,
      pmtPid, videoPid, serviceName, serviceProvider, audioPairs,
    } = req.body || {};

    if (!id || !input) return res.status(400).json({ error: 'id and input are required' });
    if (!host || !port) return res.status(400).json({ error: 'host and port are required' });
    if (channels.has(id)) return res.status(409).json({ error: `Channel ${id} already exists` });

    const channel = new SRTEncapsulatorChannel({
      id, input, inputLocalAddr, host, port, latency,
      passphrase, pbkeylen, streamId, adapter,
      serviceId, transportStreamId, originalNetworkId,
      pmtPid, videoPid, serviceName, serviceProvider, audioPairs,
    });

    channel.on('started', () => broadcast({ type: 'encap_started', id }));
    channel.on('stopped', () => broadcast({ type: 'encap_stopped', id }));
    channel.on('stats', (stats) => broadcast({ type: 'encap_stats', id, ...stats }));
    channel.on('srtStats', (srt) => broadcast({ type: 'encap_srtStats', id, ...srt }));
    channel.on('error', (err) => broadcast({ type: 'encap_error', id, message: err.message }));

    try {
      channel.start();
      channels.set(id, channel);
      res.status(201).json(channel.toJSON());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/channels/:id', async (req, res) => {
    const channel = channels.get(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    try { channel.stop(); } catch (_) {}
    channels.delete(req.params.id);
    res.json({ stopped: req.params.id });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connected', service: 'encapsulator', uptime: process.uptime() }));
  });

  server.listen(ENCAPSULATOR_PORT, ENCAPSULATOR_HOST, () => {
    console.log(`Labotech encapsulator listening on http://${ENCAPSULATOR_HOST}:${ENCAPSULATOR_PORT}`);
  });

  return { app, server, wss, channels };
}

module.exports = { startEncapsulatorApi };
