'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const {
  buildHaivisionCallerUrl,
  parseHaivisionStatsLine,
  classifyHaivisionLink,
} = require('./haivision-srt');

function envInt(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIVE_INPUT_FIFO_SIZE = envInt('TS_INPUT_FIFO_SIZE', 10000000);
const LIVE_INPUT_TIMEOUT_US = envInt('TS_INPUT_TIMEOUT_US', 7000000);
const LIVE_INPUT_REORDER_QUEUE = envInt('TS_INPUT_REORDER_QUEUE_SIZE', 512);

function nicParam(val) {
  return /^\d+\.\d+/.test(val) ? `&localaddr=${val}` : `&interface=${val}`;
}

class SRTEncapsulatorChannel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id;
    this.input = options.input;
    this.inputLocalAddr = options.inputLocalAddr || null;
    this.host = (options.host || '').trim();
    this.port = options.port || 9999;
    this.latency = options.latency || 2000;
    this.passphrase = options.passphrase || null;
    this.pbkeylen = options.pbkeylen || 16;
    this.adapter = options.adapter || null;
    this.streamId = options.streamId || null;

    this.serviceId = options.serviceId != null ? parseInt(options.serviceId, 10) : 1;
    this.transportStreamId = options.transportStreamId != null ? parseInt(options.transportStreamId, 10) : 1;
    this.originalNetworkId = options.originalNetworkId != null ? parseInt(options.originalNetworkId, 10) : 1;
    this.pmtPid = options.pmtPid != null ? parseInt(options.pmtPid, 10) : 0x1000;
    this.videoPid = options.videoPid != null ? parseInt(options.videoPid, 10) : 0x100;
    this.serviceName = options.serviceName || '';
    this.serviceProvider = options.serviceProvider || '';

    this.audioPairs = Array.isArray(options.audioPairs) ? options.audioPairs : [];

    this.isRunning = false;
    this.startTime = null;
    this.lastStats = null;
    this.srtStats = null;
    this.srtLink = { status: 'unknown', reason: 'not started', updatedAt: null };
    this.inputBitrate = null;
    this.inputStreams = null;
  }

  detectInputType(url) {
    if (!url) return 'file';
    if (url.startsWith('rtp://')) return 'rtp';
    if (url.startsWith('udp://')) return 'udp';
    if (url.startsWith('rtsp://')) return 'rtsp';
    if (url.startsWith('srt://')) return 'srt';
    return 'file';
  }

  buildInputArgs() {
    const type = this.detectInputType(this.input);
    const args = [];
    if (type === 'rtp' || type === 'udp') {
      const sep = this.input.includes('?') ? '&' : '?';
      let inputUrl = `${this.input}${sep}fifo_size=${LIVE_INPUT_FIFO_SIZE}&overrun_nonfatal=1&timeout=${LIVE_INPUT_TIMEOUT_US}&reorder_queue_size=${LIVE_INPUT_REORDER_QUEUE}`;
      const validIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(this.inputLocalAddr);
      if (this.inputLocalAddr && validIp) inputUrl += `&localaddr=${this.inputLocalAddr}`;
      args.push('-fflags', '+discardcorrupt', '-f', 'mpegts', '-i', inputUrl);
    } else if (type === 'rtsp') {
      args.push('-rtsp_transport', 'tcp', '-i', this.input);
    } else {
      args.push('-i', this.input);
    }
    return args;
  }

  buildSrtOutputUrl() {
    return buildHaivisionCallerUrl({
      host: this.host,
      port: this.port,
      latency: this.latency,
      passphrase: this.passphrase,
      pbkeylen: this.pbkeylen,
      streamId: this.streamId,
      adapter: this.adapter,
    });
  }

  buildMuxerArgs() {
    const args = [
      '-mpegts_service_id', String(this.serviceId),
      '-mpegts_pmt_start_pid', String(this.pmtPid),
      '-mpegts_start_pid', String(this.videoPid),
      '-mpegts_original_network_id', String(this.originalNetworkId),
      '-mpegts_transport_stream_id', String(this.transportStreamId),
      '-pat_period', '0.1',
      '-pcr_period', '20',
    ];
    if (this.serviceName) args.push('-metadata', `service_name=${this.serviceName}`);
    if (this.serviceProvider) args.push('-metadata', `service_provider=${this.serviceProvider}`);
    return args;
  }

  buildStreamIdArgs() {
    const args = ['-streamid', `0:${this.videoPid}`];
    this.audioPairs.forEach((p, i) => {
      const pid = p.pid != null && p.pid !== '' ? parseInt(p.pid, 10) : (this.videoPid + 1 + i);
      args.push('-streamid', `${i + 1}:${pid}`);
    });
    return args;
  }

  buildFFmpegArgs() {
    return [
      '-hide_banner',
      '-loglevel', 'info',
      '-stats',
      ...this.buildInputArgs(),
      '-map', '0:v?',
      '-map', '0:a?',
      '-c', 'copy',
      '-max_muxing_queue_size', '4096',
      '-f', 'mpegts',
      ...this.buildMuxerArgs(),
      ...this.buildStreamIdArgs(),
      this.buildSrtOutputUrl(),
    ];
  }

  start() {
    if (this.isRunning) throw new Error(`Encapsulator ${this.id} is already running`);
    const args = this.buildFFmpegArgs();
    this.process = spawn('ffmpeg', args);
    this.isRunning = true;
    this.startTime = Date.now();
    this._stderrBuffer = [];
    this.srtLink = { status: 'starting', reason: 'awaiting first haivision sample', updatedAt: new Date().toISOString() };

    this.process.stderr.on('data', (data) => {
      data.toString().split('\n').forEach((line) => {
        if (!line.trim()) return;
        this._stderrBuffer = [...this._stderrBuffer.slice(-9), line];
        this.parseStats(line);
      });
    });

    this.process.on('exit', (code, signal) => {
      this.isRunning = false;
      this.srtLink = { status: 'stopped', reason: 'process exited', updatedAt: new Date().toISOString() };
      this.process = null;
      if (signal === 'SIGTERM' || code === 0 || (this._stopping && code === 255)) {
        this._stopping = false;
        this.emit('stopped', { id: this.id, code, signal });
      } else {
        this._stopping = false;
        const context = (this._stderrBuffer || []).slice(-5).join(' | ');
        this.emit('error', new Error(`FFmpeg exited with code ${code}: ${context}`));
      }
    });

    this.process.on('error', (err) => {
      this.isRunning = false;
      this.emit('error', err);
    });

    this.emit('started', { id: this.id, input: this.input });
    return this;
  }

  stop() {
    if (this.process && this.isRunning) {
      this._stopping = true;
      this.process.kill('SIGTERM');
    }
  }

  parseStats(line) {
    const mInputBr = line.match(/bitrate:\s*([\d.]+)\s*(kbits\/s|kb\/s|mbits\/s|mb\/s)/i);
    if (mInputBr) {
      const raw = parseFloat(mInputBr[1]);
      const unit = (mInputBr[2] || '').toLowerCase();
      let kbps = raw;
      if (unit.startsWith('m')) kbps = raw * 1000;
      if (Number.isFinite(kbps) && kbps > 0) {
        this.inputBitrate = kbps;
        this.emit('stats', { inputBitrate: kbps });
      }
    }

    const mStream = line.match(/Stream #0:(\d+).*?:\s*(Video|Audio|Data):\s*([^\s,]+)(.*)/i);
    if (mStream) {
      if (!this.inputStreams) this.inputStreams = [];
      const sourceIndex = parseInt(mStream[1], 10);
      const kind = mStream[2].toLowerCase();
      const codec = mStream[3];
      const detail = mStream[4].trim();
      const entry = { sourceIndex, kind, codec, detail };
      const idx = this.inputStreams.findIndex((s) => s.sourceIndex === sourceIndex);
      if (idx >= 0) this.inputStreams[idx] = entry; else this.inputStreams.push(entry);
      this.emit('stats', { inputStreams: this.inputStreams });
    }

    const mFrame = line.match(/frame=\s*(\d+)/);
    const mFps = line.match(/fps=\s*([\d.]+)/);
    const mBitrate = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
    const mSpeed = line.match(/speed=\s*([\d.]+)x/);
    const encStats = {};
    if (mFrame) encStats.frame = parseInt(mFrame[1], 10);
    if (mFps) encStats.fps = parseFloat(mFps[1]);
    if (mBitrate) encStats.bitrate = parseFloat(mBitrate[1]);
    if (mSpeed) encStats.speed = parseFloat(mSpeed[1]);
    if (Object.keys(encStats).length > 0) {
      this.lastStats = { ...this.lastStats, ...encStats };
      this.emit('stats', { ...encStats });
    }

    const srt = parseHaivisionStatsLine(line);
    if (srt) {
      this.srtStats = srt;
      const link = classifyHaivisionLink(srt);
      this.srtLink = { status: link.status, reason: link.reason, updatedAt: new Date().toISOString() };
      this.emit('srtStats', { ...srt, link: this.srtLink });
    }
  }

  toJSON() {
    return {
      id: this.id,
      input: this.input,
      outputMode: 'srt',
      host: this.host,
      port: this.port,
      isRunning: this.isRunning,
      startTime: this.startTime,
      inputBitrate: this.inputBitrate || null,
      inputStreams: this.inputStreams || null,
      lastStats: this.lastStats,
      srtStats: this.srtStats,
      srtLink: this.srtLink,
      encodeProfile: {
        videoCodec: 'copy',
        audioCodec: 'copy',
        mode: 'encapsulation',
      },
      dvb: {
        serviceId: this.serviceId,
        transportStreamId: this.transportStreamId,
        originalNetworkId: this.originalNetworkId,
        pmtPid: this.pmtPid,
        videoPid: this.videoPid,
        serviceName: this.serviceName,
        serviceProvider: this.serviceProvider,
      },
      audioPairs: this.audioPairs,
    };
  }
}

module.exports = SRTEncapsulatorChannel;
