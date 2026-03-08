'use strict';

const express    = require('express');
const WebSocket  = require('ws');
const SRTEncoder = require('../src/encoder');
const Transcoder = require('../src/transcoder');
const { MulticastForwarder } = require('../src/multicast-forward');

module.exports = function(streams, transcoders, forwarders, wss) {
  const router = express.Router();

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
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
      audioBitrate, passphrase,
    } = req.body;

    if (!id || !input || !srtHost || !srtPort) {
      return res.status(400).json({ error: 'id, input, srtHost and srtPort are required' });
    }

    const results = { id, stages: [] };

    // Stage 1: SRT encoder
    const encId = `${id}-enc`;
    if (!streams.has(encId)) {
      const enc = new SRTEncoder({
        id: encId, input, host: srtHost, port: srtPort,
        videoBitrate, audioBitrate, passphrase,
      });
      enc.on('stats', s => broadcast({ type: 'stats', id: encId, ...s }));
      enc.on('error', e => broadcast({ type: 'error', id: encId, message: e.message }));
      enc.start();
      streams.set(encId, enc);
      results.stages.push({ stage: 'encoder', id: encId });
    }

    // Stage 2: Transcoder (optional)
    if (transcodePreset) {
      const tcId = `${id}-tc`;
      if (!transcoders.has(tcId)) {
        const srtInputUrl = `srt://${srtHost}:${srtPort}?mode=listener&latency=2000`;
        try {
          const tc = new Transcoder({
            id: tcId, input: srtInputUrl, host: srtHost, port: parseInt(srtPort) + 1,
            transcodePreset, videoBitrate, audioBitrate, passphrase,
          });
          tc.on('stats', s => broadcast({ type: 'transcode_stats', id: tcId, ...s }));
          tc.on('error', e => broadcast({ type: 'error', id: tcId, message: e.message }));
          tc.start();
          transcoders.set(tcId, tc);
          results.stages.push({ stage: 'transcoder', id: tcId });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }
    }

    // Stage 3: Multicast forward (optional)
    if (multicastDestIp) {
      const fwdId = `${id}-fwd`;
      if (!forwarders.has(fwdId)) {
        const sourcePort = transcodePreset ? parseInt(srtPort) + 1 : srtPort;
        const sourceUrl = `udp://${srtHost}:${sourcePort}`;
        try {
          const fwd = new MulticastForwarder({
            id: fwdId, sourceUrl, destIp: multicastDestIp, destPort: multicastPort,
          });
          fwd.on('stats', s => broadcast({ type: 'multicast_stats', id: fwdId, ...s }));
          fwd.on('error', e => broadcast({ type: 'error', id: fwdId, message: e.message }));
          await fwd.start();
          forwarders.set(fwdId, fwd);
          results.stages.push({ stage: 'multicast', id: fwdId });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
      }
    }

    res.status(201).json(results);
  });

  return router;
};
