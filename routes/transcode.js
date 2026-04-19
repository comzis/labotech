'use strict';

const express = require('express');
const WebSocket = require('ws');
const Transcoder = require('../src/transcoder');
const { isSupportedVideoCodec, isSupportedAudioCodec, SUPPORTED_VIDEO_CODECS, SUPPORTED_AUDIO_CODECS } = require('../src/codec-support');

module.exports = function (transcoders, wss, saveState = () => {}, broadcastFn = null) {
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
    if (typeof broadcastFn === 'function') return broadcastFn(msg);
    const data = JSON.stringify(msg);
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(data);
    });
  }

  // GET /transcode/presets (Interlace/Transformation)
  router.get('/presets', (req, res) => {
    const presets = Object.entries(Transcoder.PRESETS).map(([key, val]) => ({
      key,
      name: val.name,
      inputFps: val.inputFps,
      outputFps: val.outputFps,
      interlaced: val.interlaced,
    }));
    res.json(presets);
  });

  // GET /transcode/broadcast-presets (Output Formats)
  router.get('/broadcast-presets', (req, res) => {
    const presets = require('../config/presets.json');
    res.json(presets.slots);
  });

  // GET /transcode
  router.get('/', (req, res) => {
    res.json([...transcoders.values()].map(t => t.toJSON()));
  });

  // POST /transcode
  router.post('/', (req, res) => {
    const {
      id, input, host, port, latency,
      transcodePreset, broadcastPresetSlot,
      videoBitrate, audioBitrate, audioPairs, audioChannels,
      videoCodec, audioCodec, preset, profile, pixFmt, rateMode, gopSize, passphrase, streamId,
      serviceId, transportStreamId, originalNetworkId, pmtPid, videoPid, serviceName, serviceProvider,
      outputMode, localAddr, ttl,
    } = req.body;

    if (!id || !input || !host || !port) {
      return res.status(400).json({ error: 'id, input, host and port are required' });
    }
    if (transcoders.has(id)) {
      return res.status(409).json({ error: `Transcoder ${id} already exists` });
    }

    const validModes = ['srt', 'udp', 'rtp'];
    if (outputMode && !validModes.includes(outputMode)) {
      return res.status(400).json({ error: `outputMode must be one of: ${validModes.join(', ')}` });
    }
    if (videoCodec && !isSupportedVideoCodec(videoCodec)) {
      return res.status(400).json({ error: `videoCodec must be one of: ${SUPPORTED_VIDEO_CODECS.join(', ')}` });
    }
    if (audioCodec && !isSupportedAudioCodec(audioCodec)) {
      return res.status(400).json({ error: `audioCodec must be one of: ${SUPPORTED_AUDIO_CODECS.join(', ')}` });
    }
    if (Array.isArray(audioPairs)) {
      const invalidPair = audioPairs.find((p) => p && p.codec && !isSupportedAudioCodec(p.codec));
      if (invalidPair) {
        return res.status(400).json({ error: `audioPairs codec must be one of: ${SUPPORTED_AUDIO_CODECS.join(', ')}` });
      }
    }

    let transcoder;
    try {
      transcoder = new Transcoder({
        id, input, host, port, latency,
        transcodePreset, broadcastPresetSlot,
        videoBitrate, audioBitrate, audioPairs, audioChannels,
        videoCodec, audioCodec, preset, profile, pixFmt, rateMode, gopSize, passphrase, streamId,
        serviceId, transportStreamId, originalNetworkId, pmtPid, videoPid, serviceName, serviceProvider,
        outputMode, localAddr, ttl,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    transcoder.on('stats', stats => broadcast({ type: 'transcode_stats', id, ...stats }));
    transcoder.on('info', msg => broadcast({ type: 'info', id, message: msg.message, inputBitrate: msg.inputBitrate, inputBitrateWatchAttempts: msg.inputBitrateWatchAttempts }));
    transcoder.on('error', err => broadcast({ type: 'error', id, message: err.message }));
    transcoder.on('stopped', () => broadcast({ type: 'transcode_stopped', id }));

    try {
      transcoder.start();
      transcoders.set(id, transcoder);
      saveState();
      res.status(201).json(transcoder.toJSON());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /transcode/:id
  router.get('/:id', (req, res) => {
    const t = transcoders.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Transcoder not found' });
    res.json(t.toJSON());
  });

  // DELETE /transcode/:id
  router.delete('/:id', async (req, res) => {
    const t = transcoders.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Transcoder not found' });
    await stopAndWait(t);
    transcoders.delete(req.params.id);
    saveState();
    res.json({ stopped: req.params.id });
  });

  return router;
};
