// Labotech — Open Source Broadcast Stream Monitor
// Copyright (c) 2026 Milorad Stevanovic
// MIT Licence — github.com/comzis/labotech

'use strict';

/**
 * TSDuckProcess — thin wrapper around a `tsp` pipeline.
 *
 * Spawns:
 *   tsp -I ip[/srt|/rtp] <addr:port> \
 *       -P continuity --json-line    \
 *       -P analyze -i 1 --json-line  \
 *       -O drop
 *
 * Emits:
 *   'data'    (object) — parsed JSON line from tsp stdout
 *   'error'   (Error)  — process spawn failure
 *   'stopped' ()       — clean stop after stop() call
 *
 * Restart behaviour:
 *   Unexpected exits trigger exponential backoff restart (5 s → 10 → 20 → … → 60 s cap).
 *   For SRT sources the initial restart delay is 30 s to avoid hammering a
 *   single-listener endpoint while competing processes may hold the slot.
 */

const { EventEmitter } = require('events');
const { spawn }        = require('child_process');
const readline         = require('readline');

const RESTART_DELAY_BASE_MS = 5000;
const RESTART_DELAY_SRT_MS  = 30000;   // SRT single-listener: back off longer
const RESTART_DELAY_MAX_MS  = 60000;

class TSDuckProcess extends EventEmitter {
  constructor() {
    super();
    this._proc         = null;
    this._rl           = null;
    this._epoch        = 0;
    this._stopping     = false;
    this._restartTimer = null;
    this._url          = null;
    this._restartDelay = RESTART_DELAY_BASE_MS;
  }

  /**
   * Start tsp against the given URL.
   * No-op if already running.
   */
  start(url) {
    if (this._proc) return;
    this._url      = url;
    this._stopping = false;
    this._restartDelay = url.startsWith('srt://') ? RESTART_DELAY_SRT_MS : RESTART_DELAY_BASE_MS;
    this._spawnTsp();
  }

  /**
   * Stop the tsp process and cancel any pending restart.
   */
  stop() {
    this._stopping = true;
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }
    if (this._proc) {
      this._epoch++;
      try { this._proc.kill('SIGTERM'); } catch (_) {}
      this._proc = null;
    }
  }

  // ─── internal ────────────────────────────────────────────────────────────

  _spawnTsp() {
    if (this._stopping) return;
    const epoch = ++this._epoch;
    const args  = this._buildArgs(this._url);

    console.log(`[TSDuck] Starting: tsp ${args.join(' ')}`);

    const proc = spawn('tsp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this._proc = proc;

    // Line-by-line JSON parsing from tsp stdout.
    const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
    this._rl = rl;

    rl.on('line', (line) => {
      if (this._epoch !== epoch) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const json = JSON.parse(trimmed);
        this.emit('data', json);
      } catch (_) {
        // tsp occasionally prints human-readable info lines; skip silently.
      }
    });

    proc.stderr.on('data', (chunk) => {
      if (this._epoch !== epoch) return;
      // Log tsp diagnostics at one line per chunk to avoid log spam while
      // still surfacing startup errors and plugin warnings.
      const text = chunk.toString().replace(/\n+$/, '');
      if (text) console.log(`[TSDuck] tsp: ${text}`);
    });

    proc.on('exit', (code, signal) => {
      if (this._epoch !== epoch) return; // killed by stop() — stale handler
      this._proc = null;
      if (this._rl) { this._rl.close(); this._rl = null; }

      if (this._stopping) {
        console.log(`[TSDuck] tsp stopped cleanly (code=${code} signal=${signal})`);
        this.emit('stopped');
        return;
      }

      console.log(
        `[TSDuck] tsp exited unexpectedly (code=${code} signal=${signal}) ` +
        `— restarting in ${this._restartDelay}ms`
      );

      this._restartTimer = setTimeout(() => {
        this._restartTimer = null;
        if (!this._stopping) {
          console.log(`[TSDuck] Restarting tsp…`);
          this._restartDelay = Math.min(this._restartDelay * 2, RESTART_DELAY_MAX_MS);
          this._spawnTsp();
        }
      }, this._restartDelay);
    });

    proc.on('error', (err) => {
      if (this._epoch !== epoch) return;
      console.error(`[TSDuck] tsp spawn error: ${err.message}`);
      this.emit('error', err);
    });
  }

  /**
   * Build the tsp argument array for the given stream URL.
   *
   * Input plugin selection:
   *   srt://host:port[?…]  →  -I ip/srt  host:port
   *   rtp://[addr:]port    →  -I ip/rtp  [addr:]port
   *   udp://[addr:]port    →  -I ip      [addr:]port
   *
   * Then:
   *   -P continuity --json-line        (immediate per-PID CC events)
   *   -P analyze -i 1 --json-line      (periodic 1-second summary)
   *   -O drop
   */
  _buildArgs(url) {
    const args = [];

    if (url.startsWith('srt://')) {
      const hostPort = this._extractHostPort(url, 'srt');
      args.push('-I', 'ip/srt', hostPort);
    } else if (url.startsWith('rtp://')) {
      const hostPort = this._extractHostPort(url, 'rtp');
      args.push('-I', 'ip/rtp', hostPort);
    } else if (url.startsWith('udp://')) {
      const hostPort = this._extractHostPort(url, 'udp');
      args.push('-I', 'ip', hostPort);
    } else {
      // Unknown scheme — pass as-is and let tsp complain if unsupported.
      args.push('-I', 'ip', url);
    }

    args.push(
      '-P', 'continuity', '--json-line',
      '-P', 'analyze', '-i', '1', '--json-line',
      '-O', 'drop'
    );

    return args;
  }

  /**
   * Extract host:port from a URL string, discarding the scheme and any
   * query string / fragment.  Handles both IPv4 and bare-port forms.
   *
   * 'srt://192.168.1.10:4900?latency=200'  →  '192.168.1.10:4900'
   * 'udp://239.0.0.1:1234'                 →  '239.0.0.1:1234'
   */
  _extractHostPort(url, scheme) {
    const withoutScheme = url.slice(scheme.length + 3); // remove 'srt://' etc.
    return withoutScheme.split('?')[0].split('#')[0];
  }
}

module.exports = TSDuckProcess;
