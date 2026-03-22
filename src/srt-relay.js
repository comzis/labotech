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
   * @param {string}  [opts.thumbPath] - Absolute path for relay-written JPEG thumbnail
   *                                     When set, ffmpeg writes a thumbnail on every I-frame
   *                                     (no separate capture process needed).
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
    if (!src.includes('adapter=')) src += '&adapter=10.67.18.29';
    if (!src.includes('timeout=')) src += '&timeout=8000000';
    // Give the SRT receive buffer 500 ms headroom unless the URL already sets a
    // latency value via any of the accepted SRT parameter names (latency=, rcvlatency=,
    // tsbpddelay= — the last is the legacy libsrt option name accepted by some encoders).
    if (!src.includes('latency=') && !src.includes('rcvlatency=') && !src.includes('tsbpddelay=')) src += '&rcvlatency=500';
    // Enable periodic libsrt statistics output (every 1 s) so the relay can emit
    // 'srt_stats_line' events with RTT, bandwidth and loss data for the UI.
    // Override any existing statsintvl < 500 ms — statsintvl=1 (1 ms) would
    // emit ~1000 stats lines/second and flood stderr unnecessarily.
    const statsintvlMatch = src.match(/statsintvl=(\d+)/i);
    if (!statsintvlMatch) {
      src += '&statsintvl=1000';
    } else if (Number(statsintvlMatch[1]) < 500) {
      src = src.replace(/statsintvl=\d+/i, 'statsintvl=1000');
    }
    return src;
  }

  _spawn() {
    if (!this._running) return;
    const epoch = ++this._epoch;

    const inputUrl  = this._buildInputUrl();
    const outputUrl = `${this.localUrl}?pkt_size=1316`;

    const args = [
      // verbose: enables libsrt statistics lines (msRTT=, mbpsRecvRate=, etc.)
      // that are emitted to stderr and collected via the 'srt_stats_line' event.
      '-loglevel', 'verbose',
      '-fflags', '+discardcorrupt',
      // Force MPEG-TS demux on the SRT input — prevents ffmpeg opening a bare
      // H.264 parser context. The relay decodes video only when thumbPath is set;
      // the demuxer has the full elementary stream so SPS/PPS are in-context from
      // connection start (unlike a mid-stream joiner that never sees them).
      '-f', 'mpegts',
      '-i', inputUrl,
      // Output 1 — MPEG-TS UDP relay (stream copy, no decode)
      '-c', 'copy',
      '-f', 'mpegts',
      outputUrl,
    ];

    // Output 2 — JPEG thumbnail (only when thumbPath is configured).
    // thumbnail=100 buffers 100 frames and picks the sharpest one — at 25 fps
    // that is ~1 JPEG every 4 s. No select=I-frame filter: feeding thumbnail
    // only I-frames would require 100 × GOP interval (≈ 1000 s) before the
    // first output. thumbnail tolerates a mix of corrupt/valid frames from the
    // initial mid-GOP probe window and writes once a good frame arrives.
    // -vsync vfr (deprecated alias for -fps_mode vfr) is required so image2
    // -update 1 can receive frames at irregular intervals without duplicating.
    if (this.thumbPath) {
      args.push(
        '-map', '0:v:0',
        '-vf', 'thumbnail=100,scale=480:-2',
        '-vsync', 'vfr',
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

    // Debug: log first N stderr lines so we can inspect the exact ffmpeg
    // verbose format for this build and confirm stats line shape.
    // Disable by setting SRT_RELAY_STDERR_DEBUG=0 in the environment.
    const debugLines = process.env.SRT_RELAY_STDERR_DEBUG !== '0' ? 30 : 0;
    let _debugCount = 0;

    proc.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        // Emit libsrt statistics lines as events so TSAnalyser can surface SRT
        // transport stats (RTT, bandwidth, packet loss) in the decoder panel.
        // libsrt periodic stats (statsintvl=N) use key=value format: msRTT=X
        // ffmpeg verbose log uses key:value format: msRTT:X
        // Match both so the pipeline works regardless of which layer emits first.
        if (/msRTT[:=]|mbpsRecvRate[:=]|mbpsSendRate[:=]|mbpsBandwidth[:=]/i.test(t)) {
          this.emit('srt_stats_line', t);
        } else if (/error|warning|failed|reject|refused/i.test(t)) {
          // Suppress known-harmless H.264 parser noise from mid-GOP SRT join.
          // These appear at -loglevel verbose when ffmpeg parses stream headers
          // before the relay has received a full keyframe — they are not errors.
          if (/decode_slice_header|non.existing PPS|mmco:|non existing PPS/i.test(t)) continue;
          // Only surface genuine errors — suppress verbose info noise.
          console.error(`[srt-relay:${this.id}] ${t.slice(0, 200)}`);
        }
        // Debug: print first N lines verbatim so we can see the actual ffmpeg
        // output format for SRT stats on this build.
        if (_debugCount < debugLines) {
          _debugCount++;
          console.log(`[srt-relay:${this.id}:stderr:${_debugCount}] ${t.slice(0, 300)}`);
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
