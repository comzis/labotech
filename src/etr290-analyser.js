'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

// ETR 290 (ETSI TR 101 290) check definitions by priority
const CHECKS = {
  p1: [
    { id: 'ts_sync',   label: 'TS Sync Loss',   pattern: /Lost sync|sync byte.*(0x47|not found)/i },
    { id: 'sync_byte', label: 'Sync Byte Error', pattern: /Sync byte is not 0x47/i },
    { id: 'pat_error', label: 'PAT Error',       pattern: /no PAT found|PAT.*error|PAT.*missing/i },
    { id: 'cc_error',  label: 'CC Error',        pattern: /continuity.*(check failed|error)|CC error/i },
    { id: 'pmt_error', label: 'PMT Error',       pattern: /no PMT found|PMT.*error|PMT.*missing/i },
    { id: 'pid_error', label: 'PID Error',       pattern: /Unknown pid|PID.*not found|pid.*missing/i },
  ],
  p2: [
    { id: 'transport_error', label: 'Transport Error',   pattern: /transport_error_indicator/i },
    { id: 'crc_error',       label: 'CRC Error',         pattern: /CRC check failed|crc.*error/i },
    { id: 'pcr_disc',        label: 'PCR Discontinuity', pattern: /PCR.*discontinu/i },
    { id: 'pcr_acc',         label: 'PCR Accuracy',      pattern: /PCR.*inaccur|PCR.*jitter/i },
    { id: 'pcr_rep',         label: 'PCR Repetition',    pattern: /PCR.*repeat/i },
    { id: 'pts_error',       label: 'PTS Error',         pattern: /DTS .*, out of order|PTS.*error|pts.*wrong/i },
    { id: 'cat_error',       label: 'CAT Error',         pattern: /CAT.*error/i },
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

class ETR290Analyser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `etr290-${Date.now()}`;
    this.url = options.url;
    this.isRunning = false;
    this._proc = null;
    this._statusTimer = null;
    this._alarms = [];   // { time, priority, checkId, label, message }
    this._counts = {};   // checkId → count
    this._status = {};   // checkId → 'ok' | 'error'

    for (const checks of Object.values(CHECKS)) {
      for (const c of checks) {
        this._counts[c.id] = 0;
        this._status[c.id] = 'ok';
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-err_detect', '+crccheck+careful',
      '-fflags', '+genpts',
      '-i', this.url,
      '-f', 'null', '-',
    ];

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

    this._proc.on('exit', (code) => {
      this.isRunning = false;
      this._proc = null;
      if (this._statusTimer) {
        clearInterval(this._statusTimer);
        this._statusTimer = null;
      }
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`FFmpeg exited with code ${code}`));
      }
      this.emit('stopped', { id: this.id });
    });

    this._proc.on('error', (err) => {
      this.isRunning = false;
      this.emit('error', err);
    });

    // Broadcast status every 5 seconds
    this._statusTimer = setInterval(() => {
      if (this.isRunning) this.emit('etr290', this._buildStatus());
    }, 5000);

    this.emit('started', { id: this.id });
    // Emit initial status immediately
    this.emit('etr290', this._buildStatus());
  }

  _parseLine(line) {
    for (const [priority, checks] of Object.entries(CHECKS)) {
      for (const c of checks) {
        if (c.pattern.test(line)) {
          this._counts[c.id]++;
          this._status[c.id] = 'error';
          const alarm = {
            time: Date.now(),
            priority,
            checkId: c.id,
            label: c.label,
            message: line.trim().slice(0, 240),
          };
          this._alarms.unshift(alarm);
          if (this._alarms.length > 300) this._alarms.pop();
          this.emit('alarm', alarm);
          this.emit('etr290', this._buildStatus());
          break;
        }
      }
    }
  }

  _buildStatus() {
    return {
      id: this.id,
      url: this.url,
      isRunning: this.isRunning,
      counts: { ...this._counts },
      status: { ...this._status },
      recentAlarms: this._alarms.slice(0, 50),
    };
  }

  stop() {
    if (this._statusTimer) {
      clearInterval(this._statusTimer);
      this._statusTimer = null;
    }
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
    this.isRunning = false;
    this.emit('stopped', { id: this.id });
  }

  toJSON() {
    return this._buildStatus();
  }
}

ETR290Analyser.CHECKS = CHECKS;

module.exports = ETR290Analyser;
