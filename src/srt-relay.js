// Labotech — Open Source Broadcast Stream Monitor
// Copyright (c) 2026 Milorad Stevanovic
// MIT Licence — github.com/comzis/labotech

'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

/**
 * SRTRelay
 * --------
 * Holds a single SRT caller connection and re-outputs the MPEG-TS stream
 * as local UDP so all internal consumers (thumbnail, ffprobe, tsanalyze, ETR)
 * share the UDP copy rather than competing for the single SRT listener slot.
 *
 * Architecture: one long-lived ffmpeg process per SRT source.
 *   ffmpeg -i srt://source:port?... -c copy -f mpegts udp://127.0.0.1:PORT?pkt_size=1316
 *
 * Optional thumbnail output: when thumbPath is set, ffmpeg writes a JPEG on every
 * ~100-frame window directly from the SRT connection (which has SPS/PPS from stream
 * start — separate processes joining the UDP copy mid-stream cannot decode H.264
 * without those initial headers).
 *
 * Port allocation: deterministic djb2 hash of srtUrl, range 5500–5599.
 * Same URL always gets same port — stable across restarts.
 *
 * Emits: 'started', 'stopped', 'error', 'ready'
 */

const RELAY_PORT_MIN   = 5500;
const RELAY_PORT_RANGE = 100; // ports 5500–5599

/**
 * Deterministic port from URL string (djb2-style).
 * @param {string} url
 * @returns {number} port in [RELAY_PORT_MIN, RELAY_PORT_MIN + RELAY_PORT_RANGE)
 */
function hashPort(url) {
  const s = String(url || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return RELAY_PORT_MIN + (h % RELAY_PORT_RANGE);
}

class SRTRelay extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  opts.srtUrl   - Source SRT URL (srt://host:port?latency=N...)
   * @param {string}  [opts.id]     - Human-readable identifier for logging
   * @param {number}  [opts.port]   - Override UDP output port (default: hash of srtUrl)
   * @param {string}  [opts.thumbPath] - Absolute path for relay-written JPEG thumbnail.
   *                                     When set, ffmpeg writes a thumbnail on every I-frame
   *                                     window (no separate capture process needed).
   */
  constructor({ srtUrl, id, port, thumbPath } = {}) {
    super();
    if (!srtUrl || !String(srtUrl).startsWith('srt://')) {
      throw new Error(`SRTRelay: srtUrl must be a srt:// URL, got: ${srtUrl}`);
    }
    this.srtUrl    = srtUrl;
    this.id        = id || `relay-${Date.now()}`;
    this.port      = Number.isFinite(Number(port)) && Number(port) > 0
      ? Number(port)
      : hashPort(srtUrl);
    this.localUrl  = `udp://127.0.0.1:${this.port}`;
    this.thumbPath = (typeof thumbPath === 'string' && thumbPath) ? thumbPath : null;

    this._proc         = null;
    this._running      = false;
    this._restartTimer = null;
    this._restartDelay = 5000; // ms; doubles on each crash, capped at 30 s
    this._epoch        = 0;    // stale-close guard
    this._ready        = false;
  }

  /** Start the relay. Idempotent — safe to call multiple times. */
  start() {
    if (this._running) return this;
    this._running = true;
    this._restartDelay = 5000; // reset backoff on explicit start
    this._spawn();
    return this;
  }

  /** Stop the relay permanently. */
  stop() {
    this._running = false;
    this._ready   = false;
    this._epoch++;
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    if (this._proc) {
      try { this._proc.kill('SIGTERM'); } catch (_) {}
      this._proc = null;
    }
    this.emit('stopped', { id: this.id });
  }

  /** Returns the local UDP URL consumers should connect to. */
  getLocalUrl() { return this.localUrl; }

  /** True once the relay has fired its first 'ready' event. */
  isReady() { return this._ready; }

  // ─────────────────────────────────────────────────────────────────────────

  _buildInputUrl() {
    let src = this.srtUrl;
    const sep = src.includes('?') ? '&' : '?';
    // Ensure caller mode and eno1 binding (same convention as monitoring.js _buildSrtSrc)
    if (!src.includes('mode='))    src += `${sep}mode=caller`;
    if (!src.includes('adapter=')) src += `&adapter=${process.env.MANAGEMENT_IP || '0.0.0.0'}`;
    if (!src.includes('timeout=')) src += '&timeout=8000000';
    // Give the SRT receive buffer 500 ms headroom unless the URL already sets a
    // latency value via any of the accepted SRT parameter names (latency=, rcvlatency=,
    // tsbpddelay= — the last is the legacy libsrt option name accepted by some encoders).
    if (!src.includes('latency=') && !src.includes('rcvlatency=') && !src.includes('tsbpddelay=')) src += '&rcvlatency=500';
    return src;
  }

  _spawn() {
    if (!this._running) return;
    const epoch = ++this._epoch;

    const inputUrl  = this._buildInputUrl();
    const outputUrl = `${this.localUrl}?pkt_size=1316`;

    const args = [
      '-loglevel', 'verbose',
      '-fflags', '+discardcorrupt',
      // Force MPEG-TS demux on the SRT input — prevents ffmpeg opening a bare
      // H.264 parser context. The relay has SPS/PPS from initial SRT connection
      // start (unlike a mid-stream UDP joiner that never sees them).
      '-f', 'mpegts',
      '-i', inputUrl,
      // Output 1 — MPEG-TS UDP relay (stream copy, no decode)
      '-c', 'copy',
      '-f', 'mpegts',
      outputUrl,
    ];

    // Output 2 — JPEG thumbnail (only when thumbPath is configured).
    // THUMBNAIL_KEYFRAME_ONLY=true (default): select=key,fps=N — clean I-frames only.
    // THUMBNAIL_KEYFRAME_ONLY=false: fps=N on all frames — near-live regardless of GOP.
    // -update 1: overwrite the same file on every frame (rolling thumbnail).
    // format=yuv420p: mjpeg has no 10-bit support; required for HEVC 4:2:2 sources.
    if (this.thumbPath) {
      const thumbFps   = Math.min(25, Math.max(0.1, parseFloat(process.env.THUMBNAIL_FPS) || 5));
      const keyOnly    = process.env.THUMBNAIL_KEYFRAME_ONLY !== 'false';
      const thumbVf    = keyOnly
        ? `select=key,fps=${thumbFps},scale=480:-2,format=yuv420p`
        : `fps=${thumbFps},scale=480:-2,format=yuv420p`;
      args.push(
        '-map', '0:v:0',
        '-vf', thumbVf,
        '-update', '1',
        '-f', 'image2',
        '-q:v', '3',
        this.thumbPath,
      );
    }

    const proc = spawn('ffmpeg', args);
    this._proc  = proc;
    this._ready = false;

    // Emit 'ready' after 600 ms — by then the SRT handshake has completed
    // and the first packets are flowing into the UDP output buffer.
    const readyTimer = setTimeout(() => {
      if (this._epoch !== epoch || !this._running) return;
      if (!this._ready) {
        this._ready = true;
        this.emit('ready', { id: this.id, localUrl: this.localUrl });
      }
    }, 600);

    proc.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (/error|warning|failed|reject|refused/i.test(t)) {
          // Suppress known-harmless H.264 parser noise from mid-GOP SRT join.
          if (/decode_slice_header|non.existing PPS|mmco:|non existing PPS/i.test(t)) continue;
          console.error(`[srt-relay:${this.id}] ${t.slice(0, 200)}`);
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(readyTimer);
      if (this._epoch !== epoch) return;
      this.emit('error', err);
      this._scheduleRestart();
    });

    proc.on('close', (code) => {
      clearTimeout(readyTimer);
      if (this._epoch !== epoch) return;
      this._proc  = null;
      this._ready = false;
      if (this._running) {
        console.warn(`[srt-relay:${this.id}] ffmpeg exited (${code}); restart in ${this._restartDelay}ms`);
        this._scheduleRestart();
      }
    });

    this.emit('started', { id: this.id, localUrl: this.localUrl });
  }

  _scheduleRestart() {
    if (!this._running || this._restartTimer) return;
    const delay = this._restartDelay;
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._running) this._spawn();
    }, delay);
    this._restartDelay = Math.min(this._restartDelay * 2, 30000);
  }
}

SRTRelay.hashPort = hashPort;

module.exports = SRTRelay;
