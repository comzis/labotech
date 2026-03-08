'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

class SRTEncoder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id;
    this.input = options.input;
    this.host = options.host;
    this.port = options.port;
    this.latency = options.latency || 2000;
    this.passphrase = options.passphrase || null;
    this.streamId = options.streamId || null;
    this.videoBitrate = options.videoBitrate || '8M';
    this.audioBitrate = options.audioBitrate || '256k';
    this.videoCodec = options.videoCodec || 'libx264';
    this.audioCodec = options.audioCodec || 'aac';
    this.preset = options.preset || 'medium';
    this.pixFmt = options.pixFmt || 'yuv420p';

    this.process = null;
    this.isRunning = false;
    this.lastStats = null;
    this.startTime = null;
  }

  detectInputType(url) {
    if (!url) return 'file';
    if (url.startsWith('rtp://')) return 'rtp';
    if (url.startsWith('udp://')) return 'udp';
    if (url.startsWith('rtsp://')) return 'rtsp';
    if (url.startsWith('srt://')) return 'srt';
    if (url.startsWith('/dev/')) return 'device';
    return 'file';
  }

  buildInputArgs() {
    const type = this.detectInputType(this.input);
    const args = [];

    if (type === 'rtp' || type === 'udp') {
      // No -re for live multicast/UDP — consume at wire speed
      args.push('-fflags', '+genpts+discardcorrupt');
      args.push('-i', this.input);
    } else if (type === 'rtsp') {
      args.push('-rtsp_transport', 'tcp');
      args.push('-i', this.input);
    } else if (type === 'device') {
      args.push('-f', 'v4l2');
      args.push('-i', this.input);
    } else if (type === 'srt') {
      args.push('-i', this.input);
    } else {
      // file — rate-controlled playback
      args.push('-re', '-i', this.input);
    }

    return args;
  }

  buildSRTUrl() {
    let url = `srt://${this.host}:${this.port}?mode=caller&latency=${this.latency}`;
    if (this.passphrase) {
      url += `&passphrase=${encodeURIComponent(this.passphrase)}&pbkeylen=16`;
    }
    if (this.streamId) {
      url += `&streamid=${encodeURIComponent(this.streamId)}`;
    }
    return url;
  }

  buildFFmpegArgs() {
    const bitrateNum = parseInt(this.videoBitrate);
    const bufsize = isNaN(bitrateNum) ? this.videoBitrate : `${bitrateNum * 2}M`;

    return [
      '-hide_banner',
      '-loglevel', 'warning',
      '-stats',
      ...this.buildInputArgs(),
      '-c:v', this.videoCodec,
      '-preset', this.preset,
      '-b:v', this.videoBitrate,
      '-maxrate', this.videoBitrate,
      '-bufsize', bufsize,
      '-pix_fmt', this.pixFmt,
      '-c:a', this.audioCodec,
      '-b:a', this.audioBitrate,
      '-f', 'mpegts',
      this.buildSRTUrl(),
    ];
  }

  start() {
    if (this.isRunning) {
      throw new Error(`Encoder ${this.id} is already running`);
    }

    const args = this.buildFFmpegArgs();
    this.process = spawn('ffmpeg', args);
    this.isRunning = true;
    this.startTime = Date.now();

    this.process.stderr.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (line.trim()) this.parseStats(line);
      });
    });

    this.process.on('exit', (code, signal) => {
      this.isRunning = false;
      this.process = null;
      if (signal === 'SIGTERM' || code === 0) {
        this.emit('stopped', { id: this.id, code, signal });
      } else {
        this.emit('error', new Error(`FFmpeg exited with code ${code}`));
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
      this.process.kill('SIGTERM');
    }
  }

  parseStats(line) {
    // FFmpeg stderr progress line:
    // frame=  123 fps= 25 q=28.0 size=   4096kB time=00:00:05.00 bitrate=6710.2kbits/s speed=1.00x
    const stats = {};

    const m = {
      frame:       line.match(/frame=\s*(\d+)/),
      fps:         line.match(/fps=\s*([\d.]+)/),
      bitrate:     line.match(/bitrate=\s*([\d.]+)kbits\/s/),
      speed:       line.match(/speed=\s*([\d.]+)x/),
      dropFrames:  line.match(/drop=\s*(\d+)/),
    };

    if (m.frame)      stats.frame      = parseInt(m.frame[1]);
    if (m.fps)        stats.fps        = parseFloat(m.fps[1]);
    if (m.bitrate)    stats.bitrate    = parseFloat(m.bitrate[1]);
    if (m.speed)      stats.speed      = parseFloat(m.speed[1]);
    if (m.dropFrames) stats.dropFrames = parseInt(m.dropFrames[1]);

    if (Object.keys(stats).length > 0) {
      this.lastStats = stats;
      this.emit('stats', stats);
    }
  }

  toJSON() {
    return {
      id:        this.id,
      input:     this.input,
      host:      this.host,
      port:      this.port,
      isRunning: this.isRunning,
      startTime: this.startTime,
      lastStats: this.lastStats,
    };
  }
}

module.exports = SRTEncoder;
