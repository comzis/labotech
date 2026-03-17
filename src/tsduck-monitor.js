'use strict';

/**
 * TSDuckMonitor — periodic PCR + SI table sampler using available tsp plugins.
 *
 * Phase 0a spike (2026-03-17) confirmed that `monitor` and `etr290` plugins are
 * NOT present on gva-boro-probe TSDuck 3.44-4581.  This class uses only the
 * confirmed-available plugins:
 *
 *   pcrverify     — PCR monotonicity / jitter / repetition violations (stdout/stderr)
 *   tables        — SI/PSI table collection with --json-line JSON events
 *   bitrate_monitor — per-stream bitrate sampling
 *
 * Architecture: periodic sampler, NOT a persistent process.  Each sample run
 * spawns tsp for a fixed capture window (default 5 s), parses its output, emits
 * structured events, then exits.  This avoids the SRT single-connection conflict
 * (no persistent tsp competing with the probe loop) and is robust to tsp crashes.
 *
 * Events emitted:
 *   'pcr'     { repetitionMaxMs, accuracyMaxMs, discontErrors, crcErrors, ts }
 *   'si'      { tables: Map<tableType, { count, lastTs }>, intervals: {}, ts }
 *   'bitrate' { bps, ts }
 *   'alarm'   { priority: 'p1'|'p2'|'p3', checkId, message, ts }
 *   'error'   { message }
 *   'sample'  { durationMs, exitCode }   — fired after each sample run completes
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

// ETR 290 thresholds used for alarm generation from raw tsp output.
const ETR_PCR_REPETITION_MAX_MS  = 40;    // P2.1 — PCR interval ≤ 40 ms
const ETR_PCR_ACCURACY_MAX_US    = 500;   // P2.2 — PCR accuracy ≤ 500 ns (0.5 µs)
const ETR_SI_PAT_MAX_MS          = 500;   // P3   — PAT interval ≤ 500 ms
const ETR_SI_PMT_MAX_MS          = 500;   // P3   — PMT interval ≤ 500 ms
const ETR_SI_NIT_MAX_MS          = 10000; // P3   — NIT interval ≤ 10 s
const ETR_SI_SDT_MAX_MS          = 2000;  // P3   — SDT interval ≤ 2 s

// Default sample window: capture tsp output for this many ms then SIGTERM.
const DEFAULT_SAMPLE_WINDOW_MS = 5000;

// Minimum gap between sample runs regardless of sample window result.
const MIN_INTER_SAMPLE_MS = 500;

class TSDuckMonitor extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.id          — stream ID (for logging)
   * @param {string} opts.url         — stream URL (srt://, rtp://, udp://)
   * @param {number} [opts.intervalMs=10000]   — ms between sample run starts
   * @param {number} [opts.sampleWindowMs=5000] — ms each tsp run captures for
   */
  constructor({ id, url, intervalMs = 10000, sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS }) {
    super();
    this.id             = id;
    this.url            = url;
    this.intervalMs     = Math.max(1000, intervalMs);
    this.sampleWindowMs = Math.max(1000, Math.min(sampleWindowMs, this.intervalMs - MIN_INTER_SAMPLE_MS));
    this.isRunning      = false;
    this._timer         = null;
    this._proc          = null;
    this._epoch         = 0;          // guard against stale process callbacks
    this._siTableTimes  = new Map();  // tableType → last seen timestamp (ms)
  }

  // ── public API ──────────────────────────────────────────────────────────────

  start() {
    if (this.isRunning) return this;
    this.isRunning = true;
    this._epoch++;
    this._schedule(0);
    return this;
  }

  stop() {
    this.isRunning = false;
    this._epoch++;
    this._cancelTimer();
    this._killProc();
    return this;
  }

  /** Release tsp connection slot temporarily (for SRT probe turns). */
  suspend() {
    this._cancelTimer();
    this._killProc();
  }

  /** Resume sampling after a suspend(). */
  resume() {
    if (!this.isRunning) return;
    this._schedule(MIN_INTER_SAMPLE_MS);
  }

  // ── scheduling ──────────────────────────────────────────────────────────────

  _schedule(delayMs) {
    this._cancelTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this.isRunning) this._runSample();
    }, delayMs);
  }

  _cancelTimer() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  _killProc() {
    if (this._proc) {
      try { this._proc.kill('SIGTERM'); } catch (_) {}
      this._proc = null;
    }
  }

  // ── sample run ──────────────────────────────────────────────────────────────

  _runSample() {
    const epoch = this._epoch;
    const startMs = Date.now();

    const args = this._buildTspArgs();
    if (!args) {
      // URL type not supported (e.g. file://) — silently skip
      this._schedule(this.intervalMs);
      return;
    }

    let proc;
    try {
      proc = spawn('tsp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.emit('error', { message: `tsp spawn failed: ${err.message}` });
      this._schedule(this.intervalMs);
      return;
    }

    this._proc = proc;

    const stdoutChunks = [];
    const stderrChunks = [];
    proc.stdout.on('data', (d) => stdoutChunks.push(d));
    proc.stderr.on('data', (d) => stderrChunks.push(d));

    // Kill after sample window — tsp runs indefinitely otherwise
    const killTimer = setTimeout(() => {
      if (this._proc === proc) {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }
    }, this.sampleWindowMs);

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      if (this._proc === proc) this._proc = null;
      if (epoch !== this._epoch) return;  // stale — stop() called during run

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const durationMs = Date.now() - startMs;

      this._parseOutput(stdout, stderr);
      this.emit('sample', { durationMs, exitCode: code });

      if (this.isRunning) {
        const nextDelay = Math.max(MIN_INTER_SAMPLE_MS, this.intervalMs - durationMs);
        this._schedule(nextDelay);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      if (epoch !== this._epoch) return;
      this.emit('error', { message: `tsp error: ${err.message}` });
      if (this.isRunning) this._schedule(this.intervalMs);
    });
  }

  // ── tsp argument builder ─────────────────────────────────────────────────────

  _buildTspArgs() {
    const url = this.url;
    if (!url) return null;

    const inputArgs = this._inputPluginArgs(url);
    if (!inputArgs) return null;

    // Plugin chain:
    //   pcrverify   — detects PCR repetition, accuracy, and discontinuity violations
    //   tables      — collects SI/PSI tables as --json-line JSON events on stdout
    //   bitrate_monitor — periodic bitrate report on stdout
    //   drop        — discard TS packets (we only want metadata)
    return [
      ...inputArgs,
      '-P', 'pcrverify', '--log-level', 'error',
      '-P', 'tables', '--json-line', '--all-sections',
      '-P', 'bitrate_monitor', '--interval', String(Math.floor(this.sampleWindowMs / 2)),
      '-O', 'drop',
    ];
  }

  _inputPluginArgs(url) {
    if (url.startsWith('srt://')) {
      // tsp SRT input: -I srt <host> <port> [options]
      try {
        const u = new URL(url);
        const args = ['-I', 'srt', '--listener',
          '--local-port', u.port || '9001'];
        const latency = u.searchParams.get('latency');
        if (latency) args.push('--latency', latency);
        return args;
      } catch (_) { return null; }
    }
    if (url.startsWith('udp://') || url.startsWith('rtp://')) {
      try {
        const u = new URL(url);
        const args = ['-I', 'ip', u.hostname, u.port || '1234'];
        return args;
      } catch (_) { return null; }
    }
    return null;
  }

  // ── output parser ────────────────────────────────────────────────────────────

  _parseOutput(stdout, stderr) {
    const ts = Date.now();
    this._parsePcrVerifyStderr(stderr, ts);
    this._parseTableJsonLines(stdout, ts);
    this._parseBitrateMonitor(stdout, ts);
  }

  /**
   * pcrverify writes violations to stderr in the form:
   *   * Error: PID 0x0100: PCR discontinuity ...
   *   * Error: PID 0x0100: PCR interval 42.3 ms > 40 ms
   *   * Error: PID 0x0100: PCR accuracy 1.2 µs > 500 ns
   *
   * We parse these and emit 'pcr' + 'alarm' events.
   */
  _parsePcrVerifyStderr(stderr, ts) {
    if (!stderr) return;

    let repetitionMaxMs    = null;
    let accuracyMaxUs      = null;
    let discontErrors      = 0;

    for (const line of stderr.split('\n')) {
      const l = line.trim();
      if (!l) continue;

      // PCR interval violation: "PCR interval 42.3 ms > 40 ms"
      const intervalMatch = l.match(/PCR interval ([\d.]+)\s*ms/i);
      if (intervalMatch) {
        const val = parseFloat(intervalMatch[1]);
        if (!repetitionMaxMs || val > repetitionMaxMs) repetitionMaxMs = val;
        if (val > ETR_PCR_REPETITION_MAX_MS) {
          this.emit('alarm', {
            priority: 'p2', checkId: 'pcr_interval',
            message: `PCR interval ${val.toFixed(1)} ms (ETR 290 P2.1 limit: ${ETR_PCR_REPETITION_MAX_MS} ms)`,
            ts,
          });
        }
        continue;
      }

      // PCR accuracy violation: "PCR accuracy 1.2 µs"
      const accuracyMatch = l.match(/PCR accuracy ([\d.]+)\s*[uµ]s/i);
      if (accuracyMatch) {
        const val = parseFloat(accuracyMatch[1]);
        if (!accuracyMaxUs || val > accuracyMaxUs) accuracyMaxUs = val;
        if (val > ETR_PCR_ACCURACY_MAX_US) {
          this.emit('alarm', {
            priority: 'p2', checkId: 'pcr_accuracy',
            message: `PCR accuracy ${val.toFixed(2)} µs (ETR 290 P2.2 limit: ${ETR_PCR_ACCURACY_MAX_US} ns)`,
            ts,
          });
        }
        continue;
      }

      // PCR discontinuity
      if (/PCR discontinuity|pcr.*discont/i.test(l)) {
        discontErrors++;
        this.emit('alarm', {
          priority: 'p1', checkId: 'pcr_discont',
          message: 'PCR discontinuity detected (ETR 290 P1.3)',
          ts,
        });
      }
    }

    if (repetitionMaxMs !== null || accuracyMaxUs !== null || discontErrors > 0) {
      this.emit('pcr', {
        repetitionMaxMs,
        accuracyMaxMs:  accuracyMaxUs !== null ? accuracyMaxUs / 1000 : null,
        discontErrors,
        crcErrors: 0,
        ts,
      });
    }
  }

  /**
   * tables --json-line emits one JSON object per line on stdout:
   *   { "type": "table", "table_type": "PAT", "pid": 0, ... }
   *   { "type": "table", "table_type": "PMT", ... }
   * We track last-seen timestamps to detect missing/delayed tables.
   */
  _parseTableJsonLines(stdout, ts) {
    if (!stdout) return;

    const tablesSeen = new Map();

    for (const line of stdout.split('\n')) {
      const l = line.trim();
      if (!l || !l.startsWith('{')) continue;
      let obj;
      try { obj = JSON.parse(l); } catch (_) { continue; }

      // Route by type
      if (obj.type === 'table' && obj.table_type) {
        const tt = String(obj.table_type).toUpperCase();
        tablesSeen.set(tt, (tablesSeen.get(tt) || 0) + 1);
        this._siTableTimes.set(tt, ts);
      }
    }

    if (tablesSeen.size > 0) {
      // Check SI intervals against ETR 290 P3 limits
      this._checkSiIntervals(ts);

      this.emit('si', {
        tables: Object.fromEntries(tablesSeen),
        ts,
      });
    }
  }

  _checkSiIntervals(ts) {
    const limits = {
      PAT: ETR_SI_PAT_MAX_MS,
      PMT: ETR_SI_PMT_MAX_MS,
      NIT: ETR_SI_NIT_MAX_MS,
      SDT: ETR_SI_SDT_MAX_MS,
    };
    for (const [table, limitMs] of Object.entries(limits)) {
      const lastSeen = this._siTableTimes.get(table);
      if (lastSeen == null) {
        // Table never seen during this sample window
        if (this.sampleWindowMs >= limitMs) {
          this.emit('alarm', {
            priority: 'p3', checkId: `si_absent_${table.toLowerCase()}`,
            message: `${table} table absent in ${this.sampleWindowMs} ms window (ETR 290 P3)`,
            ts,
          });
        }
      }
    }
  }

  /**
   * bitrate_monitor outputs lines like:
   *   Bitrate: 18,432,000 bits/s
   * We parse the most recent and emit 'bitrate'.
   */
  _parseBitrateMonitor(stdout, ts) {
    if (!stdout) return;
    let bps = null;
    for (const line of stdout.split('\n')) {
      const m = line.match(/Bitrate[:\s]+([\d,]+)\s*bits\/s/i);
      if (m) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (Number.isFinite(val) && val > 0) bps = val;
      }
    }
    if (bps !== null) this.emit('bitrate', { bps, ts });
  }
}

module.exports = TSDuckMonitor;
