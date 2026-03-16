'use strict';

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'config', 'state.json');

// ─── Serialise only constructor options (not runtime state) ──────────────────

function _encoderConfig(e) {
  return {
    id: e.id, input: e.input, inputLocalAddr: e.inputLocalAddr,
    host: e.host, port: e.port, latency: e.latency, rateMode: e.rateMode,
    videoBitrate: e.videoBitrate, videoCodec: e.videoCodec,
    preset: e.preset, profile: e.profile, gopSize: e.gopSize, pixFmt: e.pixFmt,
    passphrase: e.passphrase, pbkeylen: e.pbkeylen,
    streamId: e.streamId, adapter: e.adapter,
    outputMode: e.outputMode, ttl: e.ttl, localAddr: e.localAddr,
    serviceId: e.serviceId, transportStreamId: e.transportStreamId,
    originalNetworkId: e.originalNetworkId,
    pmtPid: e.pmtPid, videoPid: e.videoPid,
    serviceName: e.serviceName, serviceProvider: e.serviceProvider,
    audioPairs: e.audioPairs,
    audioBitrate: e.audioBitrate, audioCodec: e.audioCodec, audioChannels: e.audioChannels,
  };
}

function _transcoderConfig(t) {
  return {
    ..._encoderConfig(t),
    transcodePreset: t.transcodePreset,
    broadcastPresetSlot: t.broadcastPresetSlot,
  };
}

function _forwarderConfig(f) {
  return {
    id: f.id, sourceUrl: f.sourceUrl,
    destIp: f.destIp, destPort: f.destPort,
    nic: f.nic, ttl: f.ttl,
  };
}

function _analyserConfig(a) {
  return {
    id: a.id, url: a.url,
    interval: a.interval, nicName: a.nicName,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

function save(streams, transcoders, forwarders, analysers) {
  const state = {
    streams:     [...streams.values()]    .filter(e => e.isRunning).map(_encoderConfig),
    transcoders: [...transcoders.values()].filter(t => t.isRunning).map(_transcoderConfig),
    forwarders:  [...forwarders.values()] .filter(f => f.isRunning).map(_forwarderConfig),
    analysers:   analysers ? [...analysers.values()].filter(a => a.isRunning).map(_analyserConfig) : [],
  };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[state] Save failed:', err.message);
  }
}

function load() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[state] Load failed:', err.message);
    return null;
  }
}

module.exports = { save, load };
