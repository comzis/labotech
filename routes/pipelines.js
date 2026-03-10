'use strict';

const express    = require('express');
const WebSocket  = require('ws');
const SRTEncoder = require('../src/encoder');
const Transcoder = require('../src/transcoder');
const { MulticastForwarder } = require('../src/multicast-forward');

module.exports = function(streams, transcoders, forwarders, wss, saveState = () => {}) {
  const router = express.Router();

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

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

  /**
   * POST /pipeline
   * Creates a linked ingest → transcode → forward pipeline.
   *
   * Body:
   * {
   *   id:              string   (pipeline id prefix)
   *   input:           string   (source URL)
   *   srtHost:         string
   *   srtPort:         number
   *   transcodePreset: string   ('pal'|'ntsc'|'hfr-pal'|'deinterlace')
   *   multicastDestIp: string   (239.100.25.x)
   *   multicastPort:   number
   *   videoBitrate:    string
   *   passphrase:      string
   * }
   */
  router.post('/', async (req, res) => {
    const {
      id, input, srtHost, srtPort, transcodePreset,
      multicastDestIp, multicastPort, videoBitrate,
      audioBitrate, passphrase, enableForward,
    } = req.body;

    if (!id || !input || !srtHost || !srtPort) {
      return res.status(400).json({ error: 'id, input, srtHost and srtPort are required' });
    }

    const results = { id, stages: [] };
    const started = [];
    const srtPortNum = parseInt(srtPort);
    if (!Number.isFinite(srtPortNum)) {
      return res.status(400).json({ error: 'srtPort must be a valid number' });
    }

    async function rollback(err) {
      for (let i = started.length - 1; i >= 0; i--) {
        const s = started[i];
        try {
          await stopAndWait(s.instance);
        } catch (_) {}
        s.map.delete(s.id);
      }
      saveState();
      return res.status(400).json({ error: err.message });
    }

    // Stage 1: SRT encoder
    const encId = `${id}-enc`;
    if (!streams.has(encId)) {
      const enc = new SRTEncoder({
        id: encId, input, host: srtHost, port: srtPortNum, outputMode: 'srt',
        videoBitrate, audioBitrate, passphrase,
      });
      enc.on('stats', s => broadcast({ type: 'stats', id: encId, ...s }));
      enc.on('error', e => broadcast({ type: 'error', id: encId, message: e.message }));
      try {
        enc.start();
        streams.set(encId, enc);
        started.push({ id: encId, instance: enc, map: streams });
        results.stages.push({ stage: 'encoder', id: encId });
      } catch (err) {
        return rollback(err);
      }
    }

    // Stage 2: Transcoder (optional)
    if (transcodePreset) {
      const tcId = `${id}-tc`;
      if (!transcoders.has(tcId)) {
        const srtInputUrl = `srt://${srtHost}:${srtPortNum}?mode=listener&latency=2000`;
        try {
          const tc = new Transcoder({
            id: tcId, input: srtInputUrl, host: srtHost, port: srtPortNum + 1, outputMode: 'srt',
            transcodePreset, videoBitrate, audioBitrate, passphrase,
          });
          tc.on('stats', s => broadcast({ type: 'transcode_stats', id: tcId, ...s }));
          tc.on('error', e => broadcast({ type: 'error', id: tcId, message: e.message }));
          tc.start();
          transcoders.set(tcId, tc);
          started.push({ id: tcId, instance: tc, map: transcoders });
          results.stages.push({ stage: 'transcoder', id: tcId });
        } catch (err) {
          return rollback(err);
        }
      }
    }

    // Stage 3: Multicast forward (explicit opt-in only)
    if (multicastDestIp && enableForward === true) {
      const fwdId = `${id}-fwd`;
      if (!forwarders.has(fwdId)) {
        const sourcePort = transcodePreset ? srtPortNum + 1 : srtPortNum;
        const sourceUrl = `srt://${srtHost}:${sourcePort}?mode=listener&latency=2000`;
        try {
          const fwd = new MulticastForwarder({
            id: fwdId, sourceUrl, destIp: multicastDestIp, destPort: multicastPort,
          });
          fwd.on('stats', s => broadcast({ type: 'multicast_stats', id: fwdId, ...s }));
          fwd.on('error', e => broadcast({ type: 'error', id: fwdId, message: e.message }));
          await fwd.start();
          forwarders.set(fwdId, fwd);
          started.push({ id: fwdId, instance: fwd, map: forwarders });
          results.stages.push({ stage: 'multicast', id: fwdId });
        } catch (err) {
          return rollback(err);
        }
      }
    } else if (multicastDestIp && enableForward !== true) {
      results.stages.push({ stage: 'multicast', skipped: true, reason: 'enableForward must be true to start forwarding' });
    }

    saveState();
    res.status(201).json(results);
  });

  return router;
};
