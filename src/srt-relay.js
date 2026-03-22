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
 * Architecture: srt-live-transmit as the SRT connection holder + optional ffmpeg for thumbnails.
 *
 *   srt-live-transmit srt://source:port?... udp://127.0.0.1:PORT
 *   (stdout: JSON stats every ~1000 packets — RTT, BW, loss, NAK, ACK)
 *
 *   ffmpeg -i udp://127.0.0.1:PORT ...thumbnail... (spawned after relay is ready)
 *
 * Using srt-live-transmit (not ffmpeg) as the SRT connection holder is necessary because:
 *   - ffmpeg 5.x/Debian Bookworm does not call srt_bistats() periodically, so
 *     no libsrt stats lines appear in ffmpeg stderr even with statsintvl=N.
 *   - srt-live-transmit 1.5.3 emits full JSON stats (RTT, bandwidth, loss, NAK, ACK)
 *     on stdout every N packets via -s N -pf json.
 *   - The thumbnail ffmpeg connects to the UDP loopback (not the SRT source directly),
 *     so a second SRT caller slot is not required.
 *
 * Port allocation: deterministic djb2 hash of srtUrl, range 5500–5599.
 * Same URL always gets same port — stable across restarts.
 *
 * Emits: 'started', 'stopped', 'error', 'ready', 'srt_stats'
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
   *                                     When set, a separate ffmpeg process reads from the
   *                                     UDP loopback and writes thumbnails on each I-frame.
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

    this._proc         = null;   // srt-live-transmit process
    this._thumbProc    = null;   // ffmpeg thumbnail process
    this._running      = false;
    this._restartTimer = null;
    this._restartDelay = 5000;   // ms; doubles on each crash, capped at 30 s
    this._epoch        = 0;      // stale-close guard
    this._ready        = false;
    this.lastStats     = null;   // latest parsed srt-live-transmit JSON stats object
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
    this._killThumb();
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
    // Give the SRT receive buffer 500 ms headroom unless the URL already sets a
    // latency value via any of the accepted SRT parameter names (latency=, rcvlatency=,
    // tsbpddelay= — the last is the legacy libsrt option name accepted by some encoders).
    if (!src.includes('latency=') && !src.includes('rcvlatency=') && !src.includes('tsbpddelay=')) {
      src += '&rcvlatency=500';
    }
    return src;
  }

  _spawn() {
    if (!this._running) return;
    const epoch = ++this._epoch;

    const inputUrl  = this._buildInputUrl();
    const outputUrl = `udp://127.0.0.1:${this.port}`;

    // srt-live-transmit: holds the SRT caller connection, re-outputs as UDP loopback,
    // and emits full JSON stats (RTT, bandwidth, packet loss, NAK, ACK) on stdout.
    // -a no:     disable auto-reconnect — we manage restarts with exponential backoff.
    // -s 1000:   emit stats every 1000 packets (~0.75 s at 16 Mbps).
    // -pf json:  machine-readable JSON stats format (recv.mbitRate, link.rtt, etc.).
    const proc = spawn('srt-live-transmit', [
      '-a', 'no',
      '-s', '1000',
      '-pf', 'json',
      inputUrl,
      outputUrl,
    ]);
    this._proc  = proc;
    this._ready = false;

    // Parse JSON stats from stdout — one object per line after each stats interval.
    let _stdoutBuf = '';
    proc.stdout.on('data', (d) => {
      _stdoutBuf += d.toString();
      const lines = _stdoutBuf.split('\n');
      _stdoutBuf = lines.pop(); // hold the last (potentially incomplete) line
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj && (obj.recv || obj.link)) {
            this.lastStats = obj;
            this.emit('srt_stats', obj);
          }
        } catch (_) {}
      }
    });

    // Emit 'ready' after 800 ms — by then the SRT handshake has completed
    // and the first packets are flowing into the UDP output buffer.
    const readyTimer = setTimeout(() => {
      if (this._epoch !== epoch || !this._running) return;
      if (!this._ready) {
        this._ready = true;
        this.emit('ready', { id: this.id, localUrl: this.localUrl });
        if (this.thumbPath) this._spawnThumb(epoch);
      }
    }, 800);

    proc.stderr.on('data', (d) => {
      for (const line of d.toString().split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (/error|failed|reject|refused/i.test(t)) {
          console.error(`[srt-relay:${this.id}] ${t.slice(0, 200)}`);
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(readyTimer);
      if (this._epoch !== epoch) return;
      this._killThumb();
      this.emit('error', err);
      this._scheduleRestart();
    });

    proc.on('close', (code) => {
      clearTimeout(readyTimer);
      if (this._epoch !== epoch) return;
      this._proc  = null;
      this._ready = false;
      this._killThumb();
      if (this._running) {
        console.warn(`[srt-relay:${this.id}] srt-live-transmit exited (${code}); restart in ${this._restartDelay}ms`);
        this._scheduleRestart();
      }
    });

    this.emit('started', { id: this.id, localUrl: this.localUrl });
  }

  /**
   * Spawn a separate ffmpeg process to write JPEG thumbnails from the UDP loopback.
   * Called after the relay is ready so the UDP stream is already flowing.
   * Restarts automatically if it crashes while the relay epoch is still active.
   */
  _spawnThumb(epoch) {
    if (!this.thumbPath || !this._running || this._epoch !== epoch) return;

    // UDP input hints match monitoring.js LIVE_INPUT_HINTS for multicast/loopback consumers.
    const udpInput = `udp://127.0.0.1:${this.port}?overrun_nonfatal=1&fifo_size=5000000&timeout=3000000`;

    // thumbnail=100: buffer 100 frames and pick the sharpest — at 25 fps that is ~4 s per JPEG.
    // Joining the UDP stream mid-GOP is fine: the first IDR frame arrives within one GOP period
    // and thumbnail=100 tolerates the initial corrupt/partial frames before then.
    const thumbProc = spawn('ffmpeg', [
      '-fflags', '+discardcorrupt',
      '-f', 'mpegts',
      '-i', udpInput,
      '-map', '0:v:0',
      '-vf', 'thumbnail=100,scale=480:-2',
      '-vsync', 'vfr',
      '-update', '1',
      '-f', 'image2',
      '-q:v', '3',
      this.thumbPath,
    ]);
    this._thumbProc = thumbProc;

    thumbProc.stderr.on('data', () => {});
    thumbProc.on('error', () => { this._thumbProc = null; });
    thumbProc.on('close', () => {
      if (this._thumbProc !== thumbProc) return;
      this._thumbProc = null;
      // Restart after 3 s if the relay is still in the same epoch
      if (this._running && this._epoch === epoch) {
        setTimeout(() => this._spawnThumb(epoch), 3000);
      }
    });
  }

  _killThumb() {
    if (this._thumbProc) {
      try { this._thumbProc.kill('SIGTERM'); } catch (_) {}
      this._thumbProc = null;
    }
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
