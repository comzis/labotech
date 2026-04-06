// Labotech — Open Source Broadcast Stream Monitor
// Copyright (c) 2026 Milorad Stevanovic
// MIT Licence — github.com/comzis/labotech

'use strict';

const { EventEmitter } = require('events');
const { spawn }        = require('child_process');
const readline         = require('readline');
// ETR290_ENGINE=tsduck (default) | ffmpeg
// Set to 'ffmpeg' in .env to fall back to the legacy FFmpeg log-scraping engine.
const ETR290_ENGINE = (process.env.ETR290_ENGINE || 'tsduck').toLowerCase();

const INCIDENT_CLEAR_GRACE_MS = parseInt(process.env.ETR290_INCIDENT_CLEAR_GRACE_MS || '12000', 10) || 12000;
const INCIDENT_SAMPLE_LINES = 6;
// Pending counts are only meaningful within a burst window. If the last match
// for a check was more than this many ms ago, reset pendingCounts before
// counting the new hit — converting threshold from "N hits ever" to "N hits
// within PENDING_BURST_WINDOW_MS". Prevents isolated single-event blips from
// slowly accumulating across minutes and crossing the threshold spuriously.
const PENDING_BURST_WINDOW_MS = parseInt(process.env.ETR290_PENDING_BURST_WINDOW_MS || '30000', 10) || 30000;
// Higher-noise checks that require a genuine burst (not a single processing
// blip) before an incident is raised. Operators can override via profile
// thresholds; these are the factory defaults.
const NOISY_CHECK_DEFAULTS = { transport_error: 3, pcr_disc: 3 };
// Suppress incident creation for this many ms after start() to absorb
// multicast join artefacts (RTP: missed N packets, first GOP noise).
const STARTUP_GRACE_MS = parseInt(process.env.ETR290_STARTUP_GRACE_MS || '5000', 10) || 5000;

// ETR 290 (ETSI TR 101 290) check definitions by priority
const CHECKS = {
  p1: [
    { id: 'ts_sync',   label: 'TS Sync Loss',   pattern: /Lost sync|sync byte.*(0x47|not found)|TS packet too short|invalid sync/i },
    { id: 'sync_byte', label: 'Sync Byte Error', pattern: /Sync byte is not 0x47|sync byte/i },
    { id: 'pat_error', label: 'PAT Error',       pattern: /no PAT found|PAT.*error|PAT.*missing|PAT.*invalid/i },
    { id: 'cc_error',  label: 'CC Error',        pattern: /continuity(?:\s+counter)?.*(check failed|error|mismatch|discontinuity)|\bcc\b.*error/i },
    { id: 'pmt_error', label: 'PMT Error',       pattern: /no PMT found|PMT.*error|PMT.*missing|PMT.*invalid/i },
    { id: 'pid_error', label: 'PID Error',       pattern: /Unknown pid|PID.*not found|pid.*missing|invalid pid/i },
  ],
  p2: [
    { id: 'transport_error', label: 'Transport Error',   pattern: /transport_error_indicator|packet corrupt|corrupt input packet|RTP: missed \d+ packets|max delay reached/i },
    { id: 'crc_error',       label: 'CRC Error',         pattern: /CRC check failed|crc.*error|invalid crc/i },
    { id: 'pcr_disc',        label: 'PCR Discontinuity', pattern: /PCR.*discontinu|DTS.*discontinu|PTS.*discontinu|non.?monoton(?:ic|ous).*dts|time.?stamp.*discontinu/i },
    { id: 'pcr_acc',         label: 'PCR Accuracy',      pattern: /PCR.*inaccur|PCR.*jitter|jitter too high|clock drift/i },
    { id: 'pcr_rep',         label: 'PCR Repetition',    pattern: /PCR.*repeat|PCR.*too (late|sparse)|PCR repetition/i },
    { id: 'pts_error',       label: 'PTS Error',         pattern: /DTS .*, out of order|PTS.*error|pts.*wrong|non.?monoton(?:ic|ous)|invalid timestamps/i },
    { id: 'cat_error',       label: 'CAT Error',         pattern: /CAT.*error|CAT.*missing/i },
  ],
  p3: [
    { id: 'nit_error', label: 'NIT Error',    pattern: /NIT.*error/i },
    { id: 'sdt_error', label: 'SDT Error',    pattern: /SDT.*error/i },
    { id: 'eit_error', label: 'EIT Error',    pattern: /EIT.*error/i },
    { id: 'rst_error', label: 'RST Error',    pattern: /RST.*error/i },
    { id: 'tdt_error', label: 'TDT Error',    pattern: /TDT.*error/i },
    { id: 'empty_buf', label: 'Empty Buffer', pattern: /empty.*buffer|buffer.*underflow/i },
  ],
};

const ALL_CHECK_IDS = Object.values(CHECKS).flat().map((c) => c.id);

function normalisePidList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out.push(raw);
      continue;
    }
    const text = String(raw).trim();
    if (!text) continue;
    const parsed = text.toLowerCase().startsWith('0x') ? parseInt(text, 16) : parseInt(text, 10);
    if (Number.isFinite(parsed)) out.push(parsed);
  }
  return [...new Set(out)];
}

function normaliseThresholds(input) {
  const thresholds = {};
  for (const id of ALL_CHECK_IDS) {
    thresholds[id] = NOISY_CHECK_DEFAULTS[id] ?? 1;
  }
  if (!input || typeof input !== 'object') return thresholds;
  for (const id of ALL_CHECK_IDS) {
    const v = parseInt(input[id], 10);
    if (Number.isFinite(v) && v > 0) thresholds[id] = v;
  }
  return thresholds;
}

class ETR290Analyser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `etr290-${Date.now()}`;
    this.url = options.url;
    this.nicName = options.nicName || null;
    this.isRunning = false;
    this._proc = null;
    this._statusTimer = null;
    this._alarms = [];   // { time, priority, checkId, label, message }
    this._counts = {};   // checkId → count
    this._status = {};   // checkId → 'ok' | 'error'
    this._activeIncidents = {}; // checkId -> incident
    this._startedAt = null;     // set in start(); gates startup grace
    this._epoch = 0;            // incremented on each spawn; stale-close guard
    this._suspendTimer = null;  // set by suspend(); cleared by resume() / stop()
    this._pendingCounts = {};       // checkId -> matches not yet escalated to incident
    this._pendingLastMatchAt = {};  // checkId -> ms timestamp of last pending match (burst window)
    this._incidentSeq = 0;
    this._runtime = {
      bitrateMbps: null,
      fps: null,
      speed: null,
      dropFrames: 0,
    };
    this._diagnostics = {
      parser: ETR290_ENGINE === 'tsduck' ? 'tsduck' : 'ffmpeg-log',
      lastMatchAt: null,
      lastLines: [],
      totalMatchedLines: 0,
      perCheck: {},
    };

    for (const checks of Object.values(CHECKS)) {
      for (const c of checks) {
        this._counts[c.id] = 0;
        this._status[c.id] = 'ok';
        this._pendingCounts[c.id] = 0;
        this._pendingLastMatchAt[c.id] = 0;
        this._diagnostics.perCheck[c.id] = {
          matches: 0,
          lastMatchAt: null,
          lastMessage: null,
        };
      }
    }

    this.setConfig(options.config || {}, {
      profileName: options.profileName || null,
      silent: true,
    });
  }

  setConfig(config = {}, extra = {}) {
    const thresholds = normaliseThresholds(config.thresholds);
    this._config = {
      includePids: normalisePidList(config.includePids),
      excludePids: normalisePidList(config.excludePids),
      allowUnknownPid: config.allowUnknownPid !== false,
      thresholds,
      profileName: extra.profileName || config.profileName || this._config?.profileName || null,
    };
    this._recomputeStatuses();
  }

  _recomputeStatuses() {
    for (const id of ALL_CHECK_IDS) {
      this._status[id] = this._activeIncidents[id] ? 'error' : 'ok';
    }
  }

  _pidAllowed(pid) {
    if (pid == null) return this._config.allowUnknownPid;
    if (this._config.includePids.length > 0 && !this._config.includePids.includes(pid)) return false;
    if (this._config.excludePids.includes(pid)) return false;
    return true;
  }

  /**
   * @param {number} [delayMs=0]  Defer the first ffmpeg spawn by this many ms.
   *   Use this when starting ETR alongside a persistent SRT thumbnail capture so
   *   the thumbnail can win the SRT caller slot before ETR tries to connect.
   */
  start(delayMs = 0) {
    if (this.isRunning) return;
    this.isRunning = true;

    // Broadcast status every second for near-real-time operator feedback.
    this._statusTimer = setInterval(() => {
      if (!this.isRunning) return;
      this._clearStaleIncidents(Date.now());
      this.emit('etr290', this._buildStatus());
    }, 1000);

    this._startedAt = Date.now();
    this.emit('started', { id: this.id });
    this.emit('etr290', this._buildStatus());

    if (delayMs > 0) {
      // Use the suspend timer slot so stop() / resume() cancel it correctly.
      if (this._suspendTimer) clearTimeout(this._suspendTimer);
      this._suspendTimer = setTimeout(() => {
        this._suspendTimer = null;
        if (this.isRunning) this._spawnProc();
      }, delayMs);
    } else {
      this._spawnProc();
    }
  }

  /**
   * Temporarily yield the SRT connection slot for a competing probe.
   * Kills the current ffmpeg process (freeing the SRT caller slot) and schedules
   * a fallback restart after `durationMs`.  Call resume() as soon as the probe
   * completes to restart immediately instead of waiting for the full budget.
   * isRunning stays true — the ETR monitor is still logically active.
   */
  suspend(durationMs) {
    if (!this.isRunning || !this._proc) return;
    const proc = this._proc;
    this._proc = null;
    this._epoch++; // invalidate stale exit-handler for the killed proc
    if (this._suspendTimer) clearTimeout(this._suspendTimer);
    this._suspendTimer = setTimeout(() => {
      this._suspendTimer = null;
      if (this.isRunning) this._spawnProc();
    }, durationMs);
    try { proc.kill('SIGTERM'); } catch (_) {}
  }

  /**
   * Cancel a pending suspend and restart ffmpeg immediately.
   */
  resume() {
    if (!this.isRunning) return;
    if (this._suspendTimer) { clearTimeout(this._suspendTimer); this._suspendTimer = null; }
    if (!this._proc) this._spawnProc();
  }

  _spawnProc() {
    if (ETR290_ENGINE === 'tsduck') {
      this._spawnTsp();
    } else {
      this._spawnProcFFmpeg();
    }
  }

  _spawnProcFFmpeg() {
    if (!this.isRunning) return;
    const epoch = ++this._epoch;
    const args = this._buildFFmpegArgs();
    const proc = spawn('ffmpeg', args);
    this._proc = proc;

    let buf = '';
    proc.stderr.on('data', d => {
      if (this._epoch !== epoch) return; // stale proc
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        // FFmpeg -stats output uses \r to overwrite progress lines on the same
        // terminal row. Split on \r so each segment is parsed independently —
        // otherwise a stats update and an error in the same data chunk become
        // one combined "line" that triggers a false pattern match, and the stored
        // alarm message shows stats cruft instead of the actual error text.
        for (const seg of line.split('\r')) {
          if (seg.trim()) this._parseLine(seg);
        }
      }
    });

    proc.on('exit', (code, signal) => {
      if (this._epoch !== epoch) return; // killed by suspend() — not a real stop
      this._proc = null;
      const wasExplicitStop = this._stopping || signal === 'SIGTERM';
      this._stopping = false;

      // Unexpected exit while still enabled — auto-restart to maintain monitoring.
      // On SRT (single-listener source): use a long retry delay to avoid competing
      // with the thumbnail's persistent connection.  A short retry would cause a
      // fight loop (thumbnail ↔ ETR kicking each other) that destabilises the source.
      if (!wasExplicitStop && this.isRunning) {
        const isSrt = this.url && this.url.startsWith('srt://');
        const retryMs = isSrt ? 60000 : 5000;
        if (this._suspendTimer) clearTimeout(this._suspendTimer);
        this._suspendTimer = setTimeout(() => {
          this._suspendTimer = null;
          if (this.isRunning) this._spawnProc();
        }, retryMs);
        return; // keep isRunning = true; status timer keeps broadcasting
      }

      if (this._statusTimer) {
        clearInterval(this._statusTimer);
        this._statusTimer = null;
      }
      this.isRunning = false;
      // FFmpeg handles SIGTERM internally and exits with code 255 — treat as clean stop
      if (code !== 0 && code !== null && !(wasExplicitStop && code === 255)) {
        this.emit('error', new Error(`FFmpeg exited with code ${code}`));
      }
      this.emit('stopped', { id: this.id });
    });

    proc.on('error', (err) => {
      if (this._epoch !== epoch) return;
      this.isRunning = false;
      this.emit('error', err);
    });
  }

  // ─── TSDuck engine ──────────────────────────────────────────────────────────

  _spawnTsp() {
    if (!this.isRunning) return;
    const epoch = ++this._epoch;
    const args  = this._buildTspArgs();
    const proc  = spawn('tsp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this._proc  = proc;

    // tsp --json-line outputs to its message logger (stderr), not stdout.
    // Each line is: "* pluginName: {json}" — strip the prefix before parsing.
    // Non-JSON tsp diagnostic lines (startup banner, warnings) are logged.
    const rl = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (this._epoch !== epoch) return;
      const m = line.match(/^\* (analyze|continuity): (\{.+\})$/);
      if (m) {
        try {
          const json = JSON.parse(m[2]);
          json['plugin-name'] = m[1]; // inject so _parseTsduckLine can discriminate
          this._parseTsduckLine(json);
        } catch (_) {}
        return;
      }
      const text = line.trim();
      if (text) console.log(`[TSDuck] ${text}`);
    });

    // stdout is unused but must be drained to prevent backpressure stalling tsp.
    proc.stdout.resume();

    proc.on('exit', (code, signal) => {
      if (this._epoch !== epoch) return;
      rl.close();
      this._proc = null;
      const wasExplicitStop = this._stopping || signal === 'SIGTERM';
      this._stopping = false;

      if (!wasExplicitStop && this.isRunning) {
        const isSrt  = this.url && this.url.startsWith('srt://');
        const retryMs = isSrt ? 60000 : 5000;
        if (this._suspendTimer) clearTimeout(this._suspendTimer);
        this._suspendTimer = setTimeout(() => {
          this._suspendTimer = null;
          if (this.isRunning) this._spawnTsp();
        }, retryMs);
        return;
      }

      if (this._statusTimer) { clearInterval(this._statusTimer); this._statusTimer = null; }
      this.isRunning = false;
      if (code !== 0 && code !== null && !(wasExplicitStop && code === 255)) {
        this.emit('error', new Error(`tsp exited with code ${code}`));
      }
      this.emit('stopped', { id: this.id });
    });

    proc.on('error', (err) => {
      if (this._epoch !== epoch) return;
      this.isRunning = false;
      this.emit('error', err);
    });
  }

  /**
   * Build the tsp argument array.
   *
   *   srt://host:port[?…]   →  -I srt --caller host:port
   *   udp://239.x.x.x:port  →  -I ip  239.x.x.x:port   (multicast join)
   *   udp://host:port        →  -I ip  :port             (unicast listen on port)
   *   rtp://239.x.x.x:port  →  -I ip  239.x.x.x:port   (multicast, RTP is auto-stripped)
   *   rtp://host:port        →  -I ip  :port             (unicast RTP)
   *
   * Query strings are stripped — they carry FFmpeg/fifo options irrelevant to tsp.
   */
  _buildTspArgs() {
    const url         = this.url;
    const args        = [];
    const stripScheme = (s) => url.slice(s.length + 3).split('?')[0].split('#')[0];
    const isMulticast = (host) => {
      const first = parseInt((host || '').split('.')[0], 10);
      return first >= 224 && first <= 239;
    };

    if (url.startsWith('srt://')) {
      // Dedicated SRT input plugin — caller mode connects to the SRT source.
      args.push('-I', 'srt', '--caller', stripScheme('srt'));
    } else if (url.startsWith('udp://') || url.startsWith('rtp://')) {
      const scheme   = url.startsWith('udp://') ? 'udp' : 'rtp';
      const hostPort = stripScheme(scheme);              // 'host:port'
      const host     = hostPort.split(':')[0];
      const port     = hostPort.split(':')[1];
      // Multicast: pass the group address so tsp joins the group.
      // Unicast: pass only ':port' — tsp listens on all local interfaces.
      args.push('-I', 'ip', isMulticast(host) ? hostPort : `:${port}`);
    } else {
      args.push('-I', 'ip', url);
    }

    args.push(
      '-P', 'continuity', '--json-line',
      '-P', 'analyze', '-i', '1', '--json-line',
      '-O', 'drop'
    );
    return args;
  }

  // ─── FFmpeg engine ───────────────────────────────────────────────────────────

  _parseLine(line) {
    const lineTrim = String(line || '').trim();
    this._diagnostics.lastLines = [...this._diagnostics.lastLines.slice(-19), lineTrim];

    // Parse FFmpeg live runtime stats for operator metrics.
    const mBitrate = line.match(/bitrate=\s*([\d.]+)\s*([kmg])bits\/s/i);
    const mFps = line.match(/fps=\s*([\d.]+)/i);
    const mSpeed = line.match(/speed=\s*([\d.]+)x/i);
    const mDrop = line.match(/drop=\s*(\d+)/i);
    if (mBitrate) {
      const val = parseFloat(mBitrate[1]);
      const unit = mBitrate[2].toLowerCase();
      const mbps = unit === 'g' ? val * 1000 : unit === 'm' ? val : val / 1000;
      this._runtime.bitrateMbps = Number.isFinite(mbps) ? parseFloat(mbps.toFixed(3)) : this._runtime.bitrateMbps;
    }
    if (mFps) this._runtime.fps = parseFloat(mFps[1]);
    if (mSpeed) this._runtime.speed = parseFloat(mSpeed[1]);
    if (mDrop) this._runtime.dropFrames = parseInt(mDrop[1], 10);

    let matched = false;
    for (const [priority, checks] of Object.entries(CHECKS)) {
      for (const c of checks) {
        if (c.pattern.test(line)) {
          const now      = Date.now();
          const evidence = this._extractEvidence(lineTrim);
          if (!this._pidAllowed(evidence.pid)) continue;
          this._handleMatch(priority, c, evidence, lineTrim, now);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  /**
   * _handleMatch — shared incident model used by both FFmpeg and TSDuck engines.
   *
   * Called once a check has fired (pattern matched or TSDuck field non-zero).
   * Applies burst-window reset, startup grace, threshold gating, incident
   * create/update, alarm emit, and status broadcast.
   *
   * DO NOT alter this method independently of the existing test suite — the
   * incident model is covered by etr290-analyser.test.js.
   */
  _handleMatch(priority, c, evidence, message, now) {
    this._counts[c.id]++;
    // Burst-window reset: if the previous pending match for this check
    // was more than PENDING_BURST_WINDOW_MS ago, isolated blips that
    // slowly accumulated can no longer carry over — start a fresh count.
    if (now - (this._pendingLastMatchAt[c.id] || 0) > PENDING_BURST_WINDOW_MS) {
      this._pendingCounts[c.id] = 0;
    }
    this._pendingCounts[c.id] = (this._pendingCounts[c.id] || 0) + 1;
    this._pendingLastMatchAt[c.id] = now;
    this._diagnostics.lastMatchAt = now;
    this._diagnostics.totalMatchedLines += 1;
    this._diagnostics.perCheck[c.id] = {
      matches: (this._diagnostics.perCheck[c.id]?.matches || 0) + 1,
      lastMatchAt: now,
      lastMessage: message,
    };

    const existing  = this._activeIncidents[c.id];
    const threshold = this._config.thresholds[c.id] || 1;
    // Startup grace: absorb multicast join noise (RTP: missed N packets,
    // first-GOP artefacts) without raising incidents. Counts still accumulate.
    const inGrace = this._startedAt !== null && (now - this._startedAt) < STARTUP_GRACE_MS;
    if (inGrace && !existing) return;
    if (!existing && this._pendingCounts[c.id] < threshold) return;

    if (!existing) {
      const incident = {
        incidentId: `${this.id}-${c.id}-${++this._incidentSeq}`,
        checkId: c.id,
        label: c.label,
        priority,
        status: 'active',
        firstSeen: now,
        lastSeen: now,
        hitCount: 1,
        lastMessage: message.slice(0, 240),
        messages: [message.slice(0, 240)],
        pid: evidence.pid,
        pidHex: evidence.pidHex,
      };
      this._activeIncidents[c.id] = incident;
      this._pendingCounts[c.id] = 0;
      this._pendingLastMatchAt[c.id] = now;
      this._status[c.id] = 'error';
      this.emit('incident_started', { ...incident });
    } else {
      existing.lastSeen = now;
      existing.hitCount += 1;
      existing.lastMessage = message.slice(0, 240);
      existing.messages = [...(existing.messages || []), message.slice(0, 240)].slice(-INCIDENT_SAMPLE_LINES);
      if (existing.pid == null && evidence.pid != null) existing.pid = evidence.pid;
      if (!existing.pidHex && evidence.pidHex) existing.pidHex = evidence.pidHex;
      this._status[c.id] = 'error';
      this.emit('incident_updated', { ...existing });
    }

    const alarm = {
      time: now,
      priority,
      checkId: c.id,
      label: c.label,
      message: message.slice(0, 240),
      incidentId: this._activeIncidents[c.id]?.incidentId || null,
      pid: this._activeIncidents[c.id]?.pid ?? null,
      pidHex: this._activeIncidents[c.id]?.pidHex || null,
    };
    this._alarms.unshift(alarm);
    if (this._alarms.length > 300) this._alarms.pop();
    this.emit('alarm', alarm);
    this.emit('etr290', this._buildStatus());
  }

  /**
   * _parseTsduckLine — TSDuck JSON → incident model.
   *
   * tsp emits two interleaved JSON streams on stdout:
   *
   *   continuity plugin  →  { "plugin-name": "continuity", pid, "prev-cc", "curr-cc" }
   *   analyze plugin     →  { "plugin-name": "analyze", ts: { packets: {…} }, pids: […] }
   *
   * Field mapping (per ETSI TR 101 290):
   *   ts.packets.invalid-syncs      → ts_sync (P1)
   *   ts.packets.transport-errors   → transport_error (P2)
   *   continuity: per-PID event     → cc_error (P1)
   *   per-PID pcr-leap              → pcr_disc (P2)
   *   per-PID pts-leap              → pts_error (P2)
   *   per-PID dts-leap              → pcr_disc  (supplementary)
   */
  _parseTsduckLine(json) {
    if (!json || typeof json !== 'object') return;
    const now = Date.now();

    // ── analyze plugin output ────────────────────────────────────────────────
    const isAnalyze = json['plugin-name'] === 'analyze' ||
                      (json.ts && json.ts.packets && Array.isArray(json.pids));
    if (isAnalyze) {
      const pkts = json.ts && json.ts.packets;

      // ts_sync (P1) — invalid sync bytes at TS packet level
      if (pkts && pkts['invalid-syncs'] > 0) {
        const c = CHECKS.p1.find(x => x.id === 'ts_sync');
        if (c) {
          this._handleMatch('p1', c, { pid: null, pidHex: null },
            `TSDuck: ${pkts['invalid-syncs']} invalid sync byte(s)`, now);
        }
      }

      // transport_error (P2) — transport error indicator flag set
      if (pkts && pkts['transport-errors'] > 0) {
        const c = CHECKS.p2.find(x => x.id === 'transport_error');
        if (c) {
          this._handleMatch('p2', c, { pid: null, pidHex: null },
            `TSDuck: ${pkts['transport-errors']} transport error indicator(s)`, now);
        }
      }

      // Per-PID checks
      // All leap/discontinuity fields live under pidInfo.packets (integer counts, not booleans).
      if (Array.isArray(json.pids)) {
        for (const pidInfo of json.pids) {
          const rawPid = pidInfo.id;
          const pid    = rawPid != null && Number.isFinite(Number(rawPid)) ? Number(rawPid) : null;
          const pidHex = pid != null ? `0x${pid.toString(16)}` : null;
          const ev     = { pid, pidHex };
          if (!this._pidAllowed(pid)) continue;
          const pp = pidInfo.packets; // per-PID packet counters
          if (!pp) continue;

          // pcr_disc (P2) — PCR value leap count
          if (pp['pcr-leap'] > 0) {
            const c = CHECKS.p2.find(x => x.id === 'pcr_disc');
            if (c) this._handleMatch('p2', c, ev, `TSDuck: PCR leap on PID ${pid} (count: ${pp['pcr-leap']})`, now);
          }

          // pts_error (P2) — PTS value leap count
          if (pp['pts-leap'] > 0) {
            const c = CHECKS.p2.find(x => x.id === 'pts_error');
            if (c) this._handleMatch('p2', c, ev, `TSDuck: PTS leap on PID ${pid} (count: ${pp['pts-leap']})`, now);
          }

          // pcr_disc (P2) — DTS leap is a supplementary PCR discontinuity signal
          if (pp['dts-leap'] > 0) {
            const c = CHECKS.p2.find(x => x.id === 'pcr_disc');
            if (c) this._handleMatch('p2', c, ev, `TSDuck: DTS leap on PID ${pid} (count: ${pp['dts-leap']})`, now);
          }
        }
      }

      // Bitrate from analyze output (bps → Mbps).
      // ts.bitrate is PCR-derived and is 0 when PCR data is unavailable (e.g. UDP test streams).
      // Fall back to ts.bytes × 8 for the -i 1 reporting interval.
      if (json.ts) {
        const bps = Number(json.ts.bitrate) || Number(json.ts['pcr-bitrate']) || 0;
        if (bps > 0) {
          this._runtime.bitrateMbps = parseFloat((bps / 1e6).toFixed(3));
        } else if (json.ts.bytes > 0) {
          // bytes in the ~1 s window × 8 gives an approximate bps figure
          this._runtime.bitrateMbps = parseFloat((Number(json.ts.bytes) * 8 / 1e6).toFixed(3));
        }
      }
      return;
    }

    // ── continuity plugin output ─────────────────────────────────────────────
    // Actual format: { "index": N, "packets": N, "pid": PID, "type": "missing"|"break" }
    // No prev-cc/curr-cc fields exist — discrimination uses plugin-name (injected above)
    // or the presence of the "type" field alongside "pid".
    const isContinuity = json['plugin-name'] === 'continuity' ||
                         (json.pid != null && json.type != null && json.index != null);
    if (isContinuity) {
      const rawPid = json.pid;
      const pid    = rawPid != null && Number.isFinite(Number(rawPid)) ? Number(rawPid) : null;
      const pidHex = pid != null ? `0x${pid.toString(16)}` : null;
      if (!this._pidAllowed(pid)) return;
      const c = CHECKS.p1.find(x => x.id === 'cc_error');
      if (!c) return;
      this._handleMatch('p1', c, { pid, pidHex },
        `TSDuck: CC ${json.type || 'discontinuity'} on PID ${pid}`, now);
    }
  }

  _extractEvidence(line) {
    const out = { pid: null, pidHex: null };
    const mHex = line.match(/\bpid\b(?:\s*[:=]|\s+)(0x[0-9a-f]+)/i);
    if (mHex) {
      out.pidHex = mHex[1].toLowerCase();
      const dec = parseInt(out.pidHex, 16);
      if (Number.isFinite(dec)) out.pid = dec;
      return out;
    }
    const mDec = line.match(/\bpid\b(?:\s*[:=]|\s+)(\d{1,5})\b/i);
    if (mDec) {
      out.pid = parseInt(mDec[1], 10);
      if (Number.isFinite(out.pid)) out.pidHex = `0x${out.pid.toString(16)}`;
    }
    return out;
  }

  _clearStaleIncidents(now) {
    let changed = false;
    for (const [checkId, incident] of Object.entries(this._activeIncidents)) {
      if (!incident) continue;
      if (now - incident.lastSeen < INCIDENT_CLEAR_GRACE_MS) continue;
      const cleared = {
        ...incident,
        status: 'cleared',
        clearedAt: now,
        durationMs: Math.max(0, now - incident.firstSeen),
      };
      delete this._activeIncidents[checkId];
      this._status[checkId] = 'ok';
      this._pendingCounts[checkId] = 0;
      this._pendingLastMatchAt[checkId] = 0;
      this.emit('incident_cleared', cleared);
      changed = true;
    }
    return changed;
  }

  _buildFFmpegArgs() {
    const type = this._detectInputType(this.url);
    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-stats',
      '-err_detect', '+crccheck+careful',
      '-analyzeduration', '7000000',
      '-probesize', '7000000',
      // Keep corrupt packet discard on so monitoring survives noisy links.
      '-fflags', '+discardcorrupt',
    ];

    if (type === 'rtp' || type === 'udp') {
      const sep = this.url.includes('?') ? '&' : '?';
      const liveUrl = `${this.url}${sep}fifo_size=10000000&overrun_nonfatal=1&timeout=7000000`;
      // Force mpegts demux on live RTP/UDP to expose PAT/PMT/CC/PCR faults.
      args.push('-f', 'mpegts', '-i', liveUrl);
    } else if (type === 'srt') {
      // Bind SRT caller socket to the management NIC so ffmpeg routes via the
      // correct interface. Set MANAGEMENT_IP env var to the management NIC address.
      const sep = this.url.includes('?') ? '&' : '?';
      args.push('-i', `${this.url}${sep}adapter=${process.env.MANAGEMENT_IP || '0.0.0.0'}`);
    } else {
      args.push('-i', this.url);
    }
    args.push('-f', 'null', '-');
    return args;
  }

  _detectInputType(url) {
    if (!url) return 'file';
    if (url.startsWith('rtp://')) return 'rtp';
    if (url.startsWith('udp://')) return 'udp';
    if (url.startsWith('srt://')) return 'srt';
    return 'file';
  }

  _buildStatus() {
    return {
      id: this.id,
      url: this.url,
      isRunning: this.isRunning,
      counts: { ...this._counts },
      status: { ...this._status },
      recentAlarms: this._alarms.slice(0, 50),
      activeIncidents: Object.values(this._activeIncidents).map((i) => ({ ...i })),
      runtime: { ...this._runtime },
      diagnostics: { ...this._diagnostics },
      config: {
        includePids: [...this._config.includePids],
        excludePids: [...this._config.excludePids],
        allowUnknownPid: this._config.allowUnknownPid,
        thresholds: { ...this._config.thresholds },
        profileName: this._config.profileName || null,
      },
    };
  }

  stop() {
    if (this._suspendTimer) { clearTimeout(this._suspendTimer); this._suspendTimer = null; }
    if (this._statusTimer) {
      clearInterval(this._statusTimer);
      this._statusTimer = null;
    }
    if (this._proc) {
      this._stopping = true;
      this._epoch++; // invalidate any pending exit handler
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
    this.isRunning = false;
    this.emit('stopped', { id: this.id });
  }

  toJSON() {
    return {
      ...this._buildStatus(),
      nicName: this.nicName || null,
    };
  }
}

ETR290Analyser.CHECKS = CHECKS;
ETR290Analyser.CHECK_IDS = ALL_CHECK_IDS;

module.exports = ETR290Analyser;
