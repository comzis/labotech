'use strict';

const { EventEmitter } = require('events');
const { spawn, execSync } = require('child_process');

class IATSniffer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `iat-${Date.now()}`;
    this.url = options.url || null;
    this.nicName = options.nicName || 'eno2';
    this.windowSize = options.windowSize || 300;

    this.isRunning = false;
    this.captureMethod = null; // tshark | tcpdump | unavailable
    this._proc = null;
    this._metricsTimer = null;
    this._iats = [];
    this._prevTs = null;
    this._prevSeq = null;
    this._lostPackets = 0;
    this._totalPackets = 0;
    this._jitterMs = 0;
    this.lastError = null;
  }

  static _detectCaptureMethod() {
    try {
      execSync('which tshark', { stdio: 'ignore' });
      return 'tshark';
    } catch (_) {}
    try {
      execSync('which tcpdump', { stdio: 'ignore' });
      return 'tcpdump';
    } catch (_) {}
    return 'unavailable';
  }

  static _parseUrl(url) {
    if (!url) return null;
    const m = String(url).match(/^(?:udp|rtp|srt):\/\/([^/:?#]+):(\d+)/i);
    if (!m) return null;
    return { host: m[1], port: parseInt(m[2], 10) };
  }

  start(url) {
    if (url) this.url = url;
    if (this.isRunning) return this;

    this.captureMethod = IATSniffer._detectCaptureMethod();
    if (this.captureMethod === 'unavailable') {
      this.lastError = 'tshark and tcpdump not found';
      this.emit('unavailable', { id: this.id, reason: this.lastError });
      return this;
    }

    const target = IATSniffer._parseUrl(this.url);
    if (!target) {
      this.captureMethod = 'unavailable';
      this.lastError = `Cannot parse URL: ${this.url}`;
      this.emit('unavailable', { id: this.id, reason: this.lastError });
      return this;
    }

    this.isRunning = true;
    this.lastError = null;
    this._iats = [];
    this._prevTs = null;
    this._prevSeq = null;
    this._lostPackets = 0;
    this._totalPackets = 0;
    this._jitterMs = 0;

    this._spawnCapture(target);
    this._metricsTimer = setInterval(() => {
      this.emit('metrics', this.getMetrics());
    }, 2000);
    return this;
  }

  stop() {
    this.isRunning = false;
    if (this._metricsTimer) {
      clearInterval(this._metricsTimer);
      this._metricsTimer = null;
    }
    if (this._proc) {
      try { this._proc.kill('SIGTERM'); } catch (_) {}
      this._proc = null;
    }
    this.emit('stopped', { id: this.id });
  }

  getMetrics() {
    const iats = this._iats.slice();
    if (iats.length === 0) {
      return {
        iatMs: { min: null, max: null, avg: null, p95: null },
        jitterMs: null,
        packetLossPct: null,
        sampleCount: 0,
        captureMethod: this.captureMethod,
      };
    }

    const sorted = [...iats].sort((a, b) => a - b);
    const sum = iats.reduce((s, v) => s + v, 0);
    const p95idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * 0.95)));
    const lossPct = this._totalPackets > 0
      ? parseFloat(((this._lostPackets / this._totalPackets) * 100).toFixed(2))
      : null;

    return {
      iatMs: {
        min: parseFloat(sorted[0].toFixed(3)),
        max: parseFloat(sorted[sorted.length - 1].toFixed(3)),
        avg: parseFloat((sum / iats.length).toFixed(3)),
        p95: parseFloat(sorted[p95idx].toFixed(3)),
      },
      jitterMs: parseFloat(this._jitterMs.toFixed(3)),
      packetLossPct: lossPct,
      sampleCount: iats.length,
      captureMethod: this.captureMethod,
    };
  }

  toJSON() {
    return {
      id: this.id,
      url: this.url,
      isRunning: this.isRunning,
      captureMethod: this.captureMethod,
    };
  }

  _spawnCapture(target) {
    let args;
    let parser;

    if (this.captureMethod === 'tshark') {
      args = [
        '-i', this.nicName,
        '-f', `udp dst port ${target.port}`,
        '-T', 'fields',
        '-e', 'frame.time_epoch',
        '-e', 'rtp.seq',
        '-l',
      ];
      parser = (line) => this._parseTsharkLine(line);
    } else {
      args = [
        '-i', this.nicName,
        '-n', '-tt', '-u',
        `udp dst port ${target.port}`,
      ];
      parser = (line) => this._parseTcpdumpLine(line);
    }

    const proc = spawn(this.captureMethod, args);
    this._proc = proc;
    let buf = '';
    let stderrBuf = '';

    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) parser(trimmed);
      }
    });
    proc.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
    });
    proc.on('error', (err) => {
      this.captureMethod = 'unavailable';
      this.lastError = err && err.message ? err.message : 'capture process error';
      this.emit('unavailable', { id: this.id, reason: this.lastError });
      if (this.listenerCount('error') > 0) this.emit('error', err);
      this.stop();
    });
    proc.on('exit', (code) => {
      if (this.isRunning && code !== 0) {
        const reason = (stderrBuf || '').trim().split('\n').slice(-1)[0];
        this.lastError = reason
          ? `${this.captureMethod} exited ${code}: ${reason}`
          : `${this.captureMethod} exited ${code}`;
        this.emit('unavailable', { id: this.id, reason: this.lastError });
        if (this.listenerCount('error') > 0) this.emit('error', new Error(this.lastError));
        this.stop();
      }
    });
  }

  _parseTsharkLine(line) {
    const parts = line.split('\t');
    const epoch = parseFloat(parts[0]);
    const seq = parts[1] != null && parts[1] !== '' ? parseInt(parts[1], 10) : null;
    if (!Number.isFinite(epoch) || epoch <= 0) return;

    this._totalPackets += 1;
    if (this._prevTs != null) {
      const iatMs = (epoch - this._prevTs) * 1000;
      if (iatMs > 0 && iatMs < 10000) {
        this._iats.push(iatMs);
        if (this._iats.length > this.windowSize) this._iats.shift();
        const prevIat = this._iats.length > 1 ? this._iats[this._iats.length - 2] : iatMs;
        const d = Math.abs(iatMs - prevIat);
        this._jitterMs += (d - this._jitterMs) / 16;
      }
    }
    this._prevTs = epoch;

    if (Number.isFinite(seq) && this._prevSeq != null) {
      const gap = (seq - this._prevSeq + 65536) % 65536;
      if (gap > 1 && gap < 1000) this._lostPackets += gap - 1;
    }
    if (Number.isFinite(seq)) this._prevSeq = seq;
  }

  _parseTcpdumpLine(line) {
    const m = line.match(/^([\d]+\.[\d]+)\s/);
    if (!m) return;
    const epoch = parseFloat(m[1]);
    if (!Number.isFinite(epoch) || epoch <= 0) return;

    this._totalPackets += 1;
    if (this._prevTs != null) {
      const iatMs = (epoch - this._prevTs) * 1000;
      if (iatMs > 0 && iatMs < 10000) {
        this._iats.push(iatMs);
        if (this._iats.length > this.windowSize) this._iats.shift();
        const prevIat = this._iats.length > 1 ? this._iats[this._iats.length - 2] : iatMs;
        const d = Math.abs(iatMs - prevIat);
        this._jitterMs += (d - this._jitterMs) / 16;
      }
    }
    this._prevTs = epoch;
  }
}

module.exports = IATSniffer;
