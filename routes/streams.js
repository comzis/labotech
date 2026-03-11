'use strict';

const express = require('express');
const WebSocket = require('ws');
const SRTEncoder = require('../src/encoder');

module.exports = function (streams, wss, saveState = () => {}) {
  const router = express.Router();

  async function stopAndWait(instance, timeoutMs = 5000) {
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        instance.removeListener('stopped', onStopped);
        resolve();
      };
      const onStopped = () => done();
      const timer = setTimeout(done, timeoutMs);
      instance.once('stopped', onStopped);
      try { instance.stop(); } catch (_) { done(); }
    });
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  // GET /streams
  router.get('/', (req, res) => {
    res.json([...streams.values()].map(e => e.toJSON()));
  });

  // POST /streams
  router.post('/', (req, res) => {
    const {
      id, input, inputLocalAddr, host, port, latency,
      videoBitrate, videoCodec, rateMode,
      preset, profile, gopSize, pixFmt, passphrase, streamId,
      // Output transport
      outputMode, ttl, localAddr,
      // DVB/MPEG-TS service parameters
      serviceId, transportStreamId, originalNetworkId,
      pmtPid, videoPid, serviceName, serviceProvider,
      // Per-pair audio (preferred)
      audioPairs,
      // Legacy flat audio fields (fallback when audioPairs not supplied)
      audioBitrate, audioCodec, audioChannels,
    } = req.body;

    if (!id || !input) {
      return res.status(400).json({ error: 'id and input are required' });
    }
    if (streams.has(id)) {
      return res.status(409).json({ error: `Stream ${id} already exists` });
    }

    const cleanHost = typeof host === 'string' ? host.trim() : host;
    const effectiveMode = outputMode || (cleanHost ? 'srt' : 'null');
    const validModes = ['srt', 'udp', 'rtp', 'null'];
    if (!validModes.includes(effectiveMode)) {
      return res.status(400).json({ error: `outputMode must be one of: ${validModes.join(', ')}` });
    }
    if (effectiveMode !== 'null' && (!cleanHost || cleanHost === 'null')) {
      return res.status(400).json({ error: `host is required when outputMode is ${effectiveMode}` });
    }
    if (effectiveMode !== 'null' && !port) {
      return res.status(400).json({ error: `port is required when outputMode is ${effectiveMode}` });
    }

    const encoder = new SRTEncoder({
      id, input, inputLocalAddr, host: cleanHost, port, latency, rateMode,
      videoBitrate, videoCodec, rateMode,
      preset, profile, gopSize, pixFmt, passphrase, streamId,
      outputMode, ttl, localAddr,
      serviceId, transportStreamId, originalNetworkId,
      pmtPid, videoPid, serviceName, serviceProvider,
      audioPairs,
      audioBitrate, audioCodec, audioChannels,
    });

    encoder.on('stats', stats => broadcast({ type: 'stats', id, ...stats }));
    encoder.on('srtStats', srt => broadcast({ type: 'srtStats', id, ...srt }));
    encoder.on('error', err => broadcast({ type: 'error', id, message: err.message }));
    encoder.on('stopped', () => broadcast({ type: 'stopped', id }));

    try {
      encoder.start();
      streams.set(id, encoder);
      saveState();
      res.status(201).json(encoder.toJSON());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /streams/:id
  router.get('/:id', (req, res) => {
    const encoder = streams.get(req.params.id);
    if (!encoder) return res.status(404).json({ error: 'Stream not found' });
    res.json(encoder.toJSON());
  });

  // DELETE /streams/:id
  router.delete('/:id', async (req, res) => {
    const encoder = streams.get(req.params.id);
    if (!encoder) return res.status(404).json({ error: 'Stream not found' });
    await stopAndWait(encoder);
    streams.delete(req.params.id);
    saveState();
    res.json({ stopped: req.params.id });
  });

  return router;
};
