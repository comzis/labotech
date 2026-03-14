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
const GUARDRAIL_ENABLED = String(process.env.ENCAP_CPU_GUARDRAIL_ENABLED || 'true').toLowerCase() !== 'false';
const GUARDRAIL_WARN_CPU_PCT = Number.isFinite(Number(process.env.ENCAP_CPU_WARN_PCT))
  ? Number(process.env.ENCAP_CPU_WARN_PCT)
  : 70;
const GUARDRAIL_BLOCK_CPU_PCT = Number.isFinite(Number(process.env.ENCAP_CPU_BLOCK_PCT))
  ? Number(process.env.ENCAP_CPU_BLOCK_PCT)
  : 75;
const GUARDRAIL_CAPACITY_PER_CORE = Number.isFinite(Number(process.env.ENCAP_CAPACITY_PER_CORE))
  ? Number(process.env.ENCAP_CAPACITY_PER_CORE)
  : 20;
const GUARDRAIL_STREAM_MBPS = Number.isFinite(Number(process.env.ENCAP_CAPACITY_STREAM_MBPS))
  ? Number(process.env.ENCAP_CAPACITY_STREAM_MBPS)
  : 22;

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
    const proc = spawn('ffmpeg', ['-hide_banner', '-protocols']);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => resolve({ ok: false, libsrt: false, details: 'ffmpeg not available' }));
    proc.on('exit', (code) => {
      const hasProtocolSrt = /(^|\s)srt(\s|$)/im.test(out);
      const details = hasProtocolSrt
        ? 'ffmpeg protocol srt available'
        : 'ffmpeg protocol srt missing';
      resolve({ ok: code === 0, libsrt: hasProtocolSrt, details });
    });
  });
}

function cpusetCoreCount(cpusetValue) {
  const raw = String(cpusetValue || '').trim();
  if (!raw) return null;
  let total = 0;
  for (const seg of raw.split(',')) {
    const part = seg.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((v) => parseInt(v, 10));
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a) total += (b - a + 1);
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n)) total += 1;
    }
  }
  return total > 0 ? total : null;
}

function configuredEncapCoreCount() {
  const byCpus = Number(process.env.ENCAPSULATOR_CPUS);
  if (Number.isFinite(byCpus) && byCpus > 0) return byCpus;
  const bySet = cpusetCoreCount(process.env.ENCAPSULATOR_CPUSET);
  if (Number.isFinite(bySet) && bySet > 0) return bySet;
  return os.cpus()?.length || 1;
}

function evaluateGuardrail() {
  const cpuPercent = sampleCpuPercent();
  const configuredCores = configuredEncapCoreCount();
  const estimatedMaxStreams = Math.max(1, Math.floor(configuredCores * GUARDRAIL_CAPACITY_PER_CORE));
  const projectedStreams = channels.size + 1;
  const projectedLoadPct = Number(((projectedStreams / estimatedMaxStreams) * 100).toFixed(1));
  const cpuWarn = Number.isFinite(cpuPercent) && cpuPercent >= GUARDRAIL_WARN_CPU_PCT;
  const cpuBlock = Number.isFinite(cpuPercent) && cpuPercent >= GUARDRAIL_BLOCK_CPU_PCT;
  const streamWarn = projectedLoadPct >= 85;
  const streamBlock = projectedStreams > estimatedMaxStreams;
  const warn = GUARDRAIL_ENABLED && (cpuWarn || streamWarn);
  const block = GUARDRAIL_ENABLED && (cpuBlock || streamBlock);
  const reasons = [];
  if (cpuWarn) reasons.push(`cpu ${cpuPercent}%`);
  if (streamWarn) reasons.push(`projected stream load ${projectedLoadPct}%`);
  if (streamBlock) reasons.push(`projected streams ${projectedStreams} exceed estimated max ${estimatedMaxStreams}`);
  return {
    enabled: GUARDRAIL_ENABLED,
    warn,
    block,
    reasons,
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : null,
    warnCpuPct: GUARDRAIL_WARN_CPU_PCT,
    blockCpuPct: GUARDRAIL_BLOCK_CPU_PCT,
    configuredCores,
    capacityPerCore: GUARDRAIL_CAPACITY_PER_CORE,
    streamMbpsBaseline: GUARDRAIL_STREAM_MBPS,
    estimatedMaxStreams,
    projectedStreams,
    projectedLoadPct,
  };
}

function createHealthPayload(capability) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const guardrail = evaluateGuardrail();
  return {
    status: capability.libsrt ? 'ok' : 'degraded',
    service: 'labotech-encapsulator',
    uptime: process.uptime(),
    channels: channels.size,
    host: ENCAPSULATOR_HOST,
    port: ENCAPSULATOR_PORT,
    capabilities: capability,
    guardrail,
    telemetry: {
      cpuPercent: guardrail.cpuPercent,
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
    const guardrail = evaluateGuardrail();
    if (guardrail.block) {
      return res.status(429).json({
        error: `Encapsulator guardrail blocked start: ${guardrail.reasons.join(' | ') || 'threshold reached'}`,
        guardrail,
      });
    }

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
      const payload = channel.toJSON();
      if (guardrail.warn) {
        payload.guardrailWarning = `Guardrail warning: ${guardrail.reasons.join(' | ') || 'approaching threshold'}`;
      }
      res.status(201).json(payload);
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
