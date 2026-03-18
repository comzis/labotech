'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
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
      parser: 'ffmpeg-log',
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

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const args = this._buildFFmpegArgs();

    this._proc = spawn('ffmpeg', args);

    let buf = '';
    this._proc.stderr.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.trim()) this._parseLine(line);
      }
    });

    this._proc.on('exit', (code, signal) => {
      this.isRunning = false;
      this._proc = null;
      if (this._statusTimer) {
        clearInterval(this._statusTimer);
        this._statusTimer = null;
      }
      // FFmpeg handles SIGTERM internally and exits with code 255 — treat as clean stop
      if (code !== 0 && code !== null && !(this._stopping && code === 255) && signal !== 'SIGTERM') {
        this.emit('error', new Error(`FFmpeg exited with code ${code}`));
      }
      this._stopping = false;
      this.emit('stopped', { id: this.id });
    });

    this._proc.on('error', (err) => {
      this.isRunning = false;
      this.emit('error', err);
    });

    // Broadcast status every second for near-real-time operator feedback.
    this._statusTimer = setInterval(() => {
      if (!this.isRunning) return;
      const changed = this._clearStaleIncidents(Date.now());
      if (changed) {
        this.emit('etr290', this._buildStatus());
        return;
      }
      this.emit('etr290', this._buildStatus());
    }, 1000);

    this._startedAt = Date.now();
    this.emit('started', { id: this.id });
    // Emit initial status immediately
    this.emit('etr290', this._buildStatus());
  }

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
          const now = Date.now();
          const evidence = this._extractEvidence(lineTrim);
          if (!this._pidAllowed(evidence.pid)) {
            continue;
          }
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
            lastMessage: lineTrim,
          };

          const existing = this._activeIncidents[c.id];
          const threshold = this._config.thresholds[c.id] || 1;
          // Startup grace: absorb multicast join noise (RTP: missed N packets,
          // first-GOP artefacts) without raising incidents. Counts still accumulate.
          const inGrace = this._startedAt !== null && (now - this._startedAt) < STARTUP_GRACE_MS;
          if (inGrace && !existing) {
            matched = true;
            break;
          }
          if (!existing && this._pendingCounts[c.id] < threshold) {
            matched = true;
            break;
          }
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
              lastMessage: lineTrim.slice(0, 240),
              messages: [lineTrim.slice(0, 240)],
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
            existing.lastMessage = lineTrim.slice(0, 240);
            existing.messages = [...(existing.messages || []), lineTrim.slice(0, 240)].slice(-INCIDENT_SAMPLE_LINES);
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
            message: lineTrim.slice(0, 240),
            incidentId: this._activeIncidents[c.id]?.incidentId || null,
            pid: this._activeIncidents[c.id]?.pid ?? null,
            pidHex: this._activeIncidents[c.id]?.pidHex || null,
          };
          this._alarms.unshift(alarm);
          if (this._alarms.length > 300) this._alarms.pop();
          this.emit('alarm', alarm);
          this.emit('etr290', this._buildStatus());
          matched = true;
          break;
        }
      }
      if (matched) break;
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
      // Bind SRT caller socket to eno1 (10.67.18.29) — same invariant as ffprobe
      // and thumbnail (SNAG-019/020). Without adapter= ffmpeg routes via eno2 (no IP).
      const sep = this.url.includes('?') ? '&' : '?';
      args.push('-i', `${this.url}${sep}adapter=10.67.18.29`);
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
    if (this._statusTimer) {
      clearInterval(this._statusTimer);
      this._statusTimer = null;
    }
    if (this._proc) {
      this._stopping = true;
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
