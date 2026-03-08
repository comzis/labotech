'use strict';

const express     = require('express');
const WebSocket   = require('ws');
const SRTEncoder  = require('../src/encoder');

module.exports = function(streams, wss) {
  const router = express.Router();

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
      id, input, host, port, latency,
      videoBitrate, audioBitrate, videoCodec, audioCodec,
      preset, pixFmt, passphrase, streamId,
    } = req.body;

    if (!id || !input || !host || !port) {
      return res.status(400).json({ error: 'id, input, host and port are required' });
    }
    if (streams.has(id)) {
      return res.status(409).json({ error: `Stream ${id} already exists` });
    }

    const encoder = new SRTEncoder({
      id, input, host, port, latency,
      videoBitrate, audioBitrate, videoCodec, audioCodec,
      preset, pixFmt, passphrase, streamId,
    });

    encoder.on('stats', stats => broadcast({ type: 'stats', id, ...stats }));
    encoder.on('error', err  => broadcast({ type: 'error', id, message: err.message }));
    encoder.on('stopped',   () => broadcast({ type: 'stopped', id }));

    try {
      encoder.start();
      streams.set(id, encoder);
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
  router.delete('/:id', (req, res) => {
    const encoder = streams.get(req.params.id);
    if (!encoder) return res.status(404).json({ error: 'Stream not found' });
    encoder.stop();
    streams.delete(req.params.id);
    res.json({ stopped: req.params.id });
  });

  return router;
};
