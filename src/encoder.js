'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

class SRTEncoder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id;
    this.input = options.input;
    this.host = options.host || null;
    this.port = options.port || 9999;
    this.latency = options.latency || 2000;
    this.passphrase = options.passphrase || null;
    this.pbkeylen = options.pbkeylen || 16;
    this.adapter = options.adapter || null;
    this.streamId = options.streamId || null;
    this.videoBitrate = options.videoBitrate || '8M';
    this.videoCodec = options.videoCodec || 'libx264';
    this.preset = options.preset || 'medium';
    this.profile = options.profile || 'high';
    this.gopSize = options.gopSize || 50;
    this.pixFmt = options.pixFmt || 'yuv420p';
    this.rateMode = options.rateMode || 'cbr'; // 'cbr' | 'vbr'

    // ── Output transport ─────────────────────────────────────────────────────
    // outputMode: 'srt' | 'udp' | 'rtp' | null (auto: 'srt' when host is set)
    this.outputMode = options.outputMode || null;
    this.ttl = options.ttl != null ? parseInt(options.ttl) : 16;
    this.localAddr = options.localAddr || null;
    this.inputLocalAddr = options.inputLocalAddr || null;

    // ── DVB/MPEG-TS muxer parameters (ETSI EN 300 468 / ISO 13818-1) ────────
    // PMT PID default 0x1000 (4096), video PID default 0x100 (256)
    this.serviceId = options.serviceId != null ? parseInt(options.serviceId) : 1;
    this.transportStreamId = options.transportStreamId != null ? parseInt(options.transportStreamId) : 1;
    this.originalNetworkId = options.originalNetworkId != null ? parseInt(options.originalNetworkId) : 1;
    this.pmtPid = options.pmtPid != null ? parseInt(options.pmtPid) : 0x1000;
    this.videoPid = options.videoPid != null ? parseInt(options.videoPid) : 0x100;
    this.serviceName = options.serviceName || '';
    this.serviceProvider = options.serviceProvider || '';

    // ── Audio configuration ───────────────────────────────────────────────────
    // Preferred: audioPairs array — each entry controls one independent audio track
    // Fallback: legacy flat fields (audioBitrate / audioCodec / audioChannels)
    if (Array.isArray(options.audioPairs) && options.audioPairs.length > 0) {
      this.audioPairs = options.audioPairs.map((p, i) => ({
        sourceIndex: p.sourceIndex != null ? parseInt(p.sourceIndex) : 0,
        codec: p.codec || 'aac',
        bitrate: p.bitrate || '256k',
        channels: p.channels != null ? parseInt(p.channels) : 2,
        language: p.language || null,
        // Per-pair PID; defaults to videoPid+1, videoPid+2, ... if not declared
        pid: p.pid != null && p.pid !== '' ? parseInt(p.pid) : (this.videoPid + 1 + i),
      }));
    } else {
      this.audioPairs = null;
      // Legacy flat config — kept for backward compatibility
      this.audioBitrate = options.audioBitrate || '256k';
      this.audioCodec = options.audioCodec || 'aac';
      const ac = options.audioChannels || 'stereo';
      if (ac === 'mono') this.audioChannels = 1;
      else if (ac === '5.1') this.audioChannels = 6;
      else {
        const m = String(ac).match(/^(\d+)\s*pair/i);
        this.audioChannels = m ? parseInt(m[1]) * 2 : 2;
      }
    }

    this.isRunning = false;
    this.lastStats = null;   // FFmpeg encode metrics
    this.srtStats = null;   // Haivision libsrt connection stats
    this.startTime = null;
  }

  // ─── Input type detection ───────────────────────────────────────────────────
  detectInputType(url) {
    if (!url) return 'file';
    if (url.startsWith('rtp://')) return 'rtp';
    if (url.startsWith('udp://')) return 'udp';
    if (url.startsWith('rtsp://')) return 'rtsp';
    if (url.startsWith('srt://')) return 'srt';
    if (url.startsWith('/dev/')) return 'device';
    return 'file';
  }

  // ─── FFmpeg input flags ─────────────────────────────────────────────────────
  buildInputArgs() {
    const type = this.detectInputType(this.input);
    const args = [];
    if (type === 'rtp' || type === 'udp') {
      const sep = this.input.includes('?') ? '&' : '?';
      // fifo_size: 10 MB receive buffer to handle bursts; overrun_nonfatal: keep
      // running on overflow rather than crashing (logs a warning instead)
      let inputUrl = `${this.input}${sep}fifo_size=10000000&overrun_nonfatal=1`;
      if (this.inputLocalAddr) inputUrl += `&localaddr=${this.inputLocalAddr}`;
      args.push('-fflags', '+genpts+discardcorrupt', '-i', inputUrl);
    } else if (type === 'rtsp') {
      args.push('-rtsp_transport', 'tcp', '-i', this.input);
    } else if (type === 'device') {
      args.push('-f', 'v4l2', '-i', this.input);
    } else if (type === 'srt') {
      args.push('-i', this.input);
    } else {
      // File — rate-limited playback
      args.push('-re', '-i', this.input);
    }
    return args;
  }

  // ─── SRT caller URL with Haivision stats parameters ────────────────────────
  buildSRTUrl() {
    let url;

    if (this.host && this.host.startsWith('srt://')) {
      // User supplied a full SRT URL — use it directly, inject stats params
      const separator = this.host.includes('?') ? '&' : '?';
      url = `${this.host}${separator}stats=1&statsintvl=1`;
    } else {
      // Build URL from host + port
      // stats=1 + statsintvl=1 tells libsrt to emit periodic [srt-stats] lines
      url = `srt://${this.host}:${this.port}?mode=caller&latency=${this.latency}&stats=1&statsintvl=1`;
    }

    if (this.passphrase) url += `&passphrase=${encodeURIComponent(this.passphrase)}&pbkeylen=${this.pbkeylen}`;
    if (this.streamId) url += `&streamid=${encodeURIComponent(this.streamId)}`;
    if (this.adapter) url += `&adapter=${encodeURIComponent(this.adapter)}`;
    return url;
  }

  // ─── Full FFmpeg argument chain ─────────────────────────────────────────────
  buildFFmpegArgs() {
    const bitrateNum = parseInt(this.videoBitrate);
    const bufsize = isNaN(bitrateNum) ? this.videoBitrate : `${bitrateNum * 2}M`;

    const effectiveMode = this.outputMode || (this.host ? 'srt' : 'null');
    // 'info' loglevel required for libsrt [srt-stats] lines; 'warning' elsewhere
    const loglevel = effectiveMode === 'srt' ? 'info' : 'warning';

    const args = [
      '-hide_banner',
      '-loglevel', loglevel,
      '-stats',
      ...this.buildInputArgs(),
    ];

    // ─── Filter complex: even-dimension scale + split for thumbnail tee ─────
    // Using filter_complex with split avoids the two-vf conflict (FFmpeg cannot
    // apply two separate simple filtergraphs to the same input stream).
    const { THUMBNAIL_DIR } = require('./monitoring');
    const thumbPath = require('path').join(THUMBNAIL_DIR, `${this.id}.jpg`);
    const thumbInterval = parseInt(process.env.THUMBNAIL_INTERVAL_SEC) || 5;

    args.push(
      '-filter_complex',
      `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,split=2[vout][vthumb];` +
      `[vthumb]fps=1/${thumbInterval},scale=320:trunc(320/dar/2)*2[thumbout]`,
    );

    // Map video for main output via filter_complex, plus per-pair audio
    args.push('-map', '[vout]');
    if (this.audioPairs) {
      this.audioPairs.forEach(p => args.push('-map', `0:a:${p.sourceIndex}`));
    }

    args.push(
      '-c:v', this.videoCodec,
      '-preset', this.preset,
      '-profile:v', this.profile,
      '-g', this.gopSize.toString(),
      '-b:v', this.videoBitrate,
      '-pix_fmt', this.pixFmt,
    );

    if (this.rateMode === 'cbr') {
      // True CBR — VBV + HRD signalling (broadcast standard)
      args.push(
        '-maxrate', this.videoBitrate,
        '-bufsize', bufsize,
        '-x264-params', 'nal-hrd=cbr:force-cfr=1',
      );
    } else {
      // VBR — constrained by bufsize only
      args.push('-bufsize', bufsize);
    }

    // ─── Professional Metadata & HDR Signaling (DVB TS 101 154) ────────────
    if (this.pixFmt && this.pixFmt.includes('10le')) {
      const colorPrimaries = this.colorPrimaries || 'bt2020';
      const colorTrc = this.colorTransfer || 'smpte2084';
      const colorSpace = this.colorSpace || 'bt2020nc';
      args.push(
        '-color_primaries', colorPrimaries,
        '-color_trc', colorTrc,
        '-colorspace', colorSpace,
        '-x265-params', `hdr-opt=1:repeat-headers=1:colorprim=${colorPrimaries}:transfer=${colorTrc}:colormatrix=${colorSpace}`
      );
    }

    // ─── Audio encoding ─────────────────────────────────────────────────────
    if (this.audioPairs) {
      this.audioPairs.forEach((p, i) => {
        args.push(`-c:a:${i}`, p.codec, `-b:a:${i}`, p.bitrate, `-ac:a:${i}`, String(p.channels));
        if (p.language) args.push(`-metadata:s:a:${i}`, `language=${p.language}`);
      });
    } else {
      args.push('-c:a', this.audioCodec, '-b:a', this.audioBitrate, '-ac', this.audioChannels.toString());
    }

    // ─── DVB-compliant output ────────────────────────────────────────────────
    args.push(...this._buildOutputArgs(effectiveMode));

    // ─── Thumbnail output — from split filter, update every N seconds ────────
    args.push('-map', '[thumbout]', '-update', '1', '-q:v', '5', '-y', thumbPath);

    return args;
  }

  // ─── DVB MPEG-TS muxer options (ISO 13818-1 / ETSI EN 300 468) ─────────────
  // Sets PAT/PMT service structure, original network ID, and transport stream ID.
  _buildDvbMuxerArgs() {
    const args = [
      '-mpegts_service_id',         String(this.serviceId),
      '-mpegts_pmt_start_pid',      String(this.pmtPid),
      '-mpegts_start_pid',          String(this.videoPid),  // base for any un-mapped PIDs
      '-mpegts_original_network_id', String(this.originalNetworkId),
      '-mpegts_transport_stream_id', String(this.transportStreamId),
    ];
    if (this.serviceName)    args.push('-metadata', `service_name=${this.serviceName}`);
    if (this.serviceProvider) args.push('-metadata', `service_provider=${this.serviceProvider}`);
    return args;
  }

  // ─── Per-stream PID assignment via -streamid ─────────────────────────────────
  // Output stream 0 = video (always first after -map 0:v:0 or FFmpeg auto-select).
  // Output streams 1..N = audio pairs in declaration order.
  _buildStreamIdArgs() {
    const args = ['-streamid', `0:${this.videoPid}`];
    if (this.audioPairs) {
      this.audioPairs.forEach((p, i) => args.push('-streamid', `${i + 1}:${p.pid}`));
    }
    return args;
  }

  // ─── Output URL + format selection ───────────────────────────────────────────
  _buildOutputArgs(mode) {
    if (mode === 'null') return ['-f', 'null', '-'];

    const dvb = this._buildDvbMuxerArgs();
    const pids = this._buildStreamIdArgs();

    if (mode === 'udp') {
      // UDP multicast — pkt_size=1316 aligns TS packets (7 × 188 bytes) per UDP datagram
      let url = `udp://${this.host}:${this.port}?pkt_size=1316&ttl=${this.ttl}`;
      if (this.localAddr) url += `&localaddr=${this.localAddr}`;
      return ['-f', 'mpegts', ...dvb, ...pids, url];
    }

    if (mode === 'rtp') {
      // RTP encapsulation of full MPEG-TS (rtp_mpegts muxer)
      let url = `rtp://${this.host}:${this.port}?ttl=${this.ttl}`;
      if (this.localAddr) url += `&localaddr=${this.localAddr}`;
      return ['-f', 'rtp_mpegts', ...dvb, ...pids, url];
    }

    // SRT (default) — Haivision encapsulation with libsrt stats
    return ['-f', 'mpegts', ...dvb, ...pids, this.buildSRTUrl()];
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────
  start() {
    if (this.isRunning) throw new Error(`Encoder ${this.id} is already running`);

    const args = this.buildFFmpegArgs();
    this.process = spawn('ffmpeg', args);
    this.isRunning = true;
    this.startTime = Date.now();
    this._stderrBuffer = [];

    this.process.stderr.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (!line.trim()) return;
        this._stderrBuffer = [...this._stderrBuffer.slice(-9), line];
        this.parseStats(line);
      });
    });

    this.process.on('exit', (code, signal) => {
      this.isRunning = false;
      this.process = null;
      if (signal === 'SIGTERM' || code === 0) {
        this.emit('stopped', { id: this.id, code, signal });
      } else {
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
    if (this.process && this.isRunning) this.process.kill('SIGTERM');
  }

  // ─── Stats parsing ──────────────────────────────────────────────────────────
  parseStats(line) {
    // ── 0. Input bitrate — parsed from FFmpeg demuxer startup line ───────────
    // "  Duration: N/A, start: 1234.56, bitrate: 8192 kb/s"
    const mInputBr = line.match(/Duration:.*bitrate:\s*([\d.]+)\s*kb\/s/);
    if (mInputBr) {
      this.inputBitrate = parseFloat(mInputBr[1]);
      this.emit('stats', { inputBitrate: this.inputBitrate });
    }

    // ── 0b. Input stream detection — parsed from FFmpeg stream info lines ────
    // "  Stream #0:0[0x100]: Video: h264 (High), yuv420p, 1920x1080, 25 fps"
    // "  Stream #0:1[0x101]: Audio: mp2, 48000 Hz, stereo, fltp, 256 kb/s"
    const mStream = line.match(/Stream #0:(\d+).*?:\s*(Video|Audio|Data):\s*([^\s,]+)(.*)/i);
    if (mStream) {
      if (!this.inputStreams) this.inputStreams = [];
      const kind = mStream[2].toLowerCase();
      const codec = mStream[3];
      const detail = mStream[4].trim();
      const entry = { kind, codec, detail };
      // Resolution + fps for video
      const mRes = detail.match(/(\d{3,4})x(\d{3,4})/);
      const mFpsD = detail.match(/([\d.]+)\s*fps/);
      if (mRes) { entry.width = parseInt(mRes[1]); entry.height = parseInt(mRes[2]); }
      if (mFpsD) entry.fps = parseFloat(mFpsD[1]);
      // Sample rate + channels for audio
      const mSr = detail.match(/([\d]+)\s*Hz/);
      if (mSr) entry.sampleRate = parseInt(mSr[1]);
      // Replace existing entry for same stream index or append
      const idx = this.inputStreams.findIndex(s => s.kind === kind);
      if (idx >= 0) this.inputStreams[idx] = entry; else this.inputStreams.push(entry);
      this.emit('stats', { inputStreams: this.inputStreams });
    }

    // ── 1. FFmpeg encode progress ────────────────────────────────────────────
    // frame=  123 fps= 25 q=28.0 size=N/A time=00:00:05.00 bitrate=6710.2kbits/s speed=1.00x
    const mFrame = line.match(/frame=\s*(\d+)/);
    const mFps = line.match(/fps=\s*([\d.]+)/);
    const mBitrate = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
    const mSpeed = line.match(/speed=\s*([\d.]+)x/);
    const mDrop = line.match(/dup=\s*(\d+).*?drop=\s*(\d+)/);

    const encStats = {};
    if (mFrame) encStats.frame = parseInt(mFrame[1]);
    if (mFps) encStats.fps = parseFloat(mFps[1]);
    if (mBitrate) encStats.bitrate = parseFloat(mBitrate[1]);
    if (mSpeed) encStats.speed = parseFloat(mSpeed[1]);
    if (mDrop) encStats.dropFrames = parseInt(mDrop[2]);

    if (Object.keys(encStats).length > 0) {
      this.lastStats = { ...this.lastStats, ...encStats };
      this.emit('stats', { ...encStats });
    }

    // ── 2. Haivision libsrt statistics ──────────────────────────────────────
    // Format (emitted by libsrt when stats=1 is set):
    // [srt-stats] rate=12.34Mbps bw=50.00Mbps rtt=42.1ms total=1234pkts retrans=0pkts loss=0pkts nak=0pkts
    if (line.includes('srt-stats')) {
      const mRate = line.match(/rate=([\d.]+)Mbps/i);
      const mBw = line.match(/bw=([\d.]+)Mbps/i);
      const mRtt = line.match(/rtt=([\d.]+)ms/i);
      const mTotal = line.match(/total=(\d+)/i);
      const mRetrans = line.match(/retrans=(\d+)/i);
      const mLoss = line.match(/loss=(\d+)/i);
      const mNak = line.match(/nak=(\d+)/i);   // NAK counter

      const srt = {};
      if (mRate) srt.rateMbps = parseFloat(mRate[1]);
      if (mBw) srt.bwMbps = parseFloat(mBw[1]);
      if (mRtt) srt.rttMs = parseFloat(mRtt[1]);
      if (mTotal) srt.pktTotal = parseInt(mTotal[1]);
      if (mRetrans) srt.pktRetrans = parseInt(mRetrans[1]);
      if (mLoss) srt.pktLoss = parseInt(mLoss[1]);
      if (mNak) srt.pktNak = parseInt(mNak[1]);  // Negative Acknowledgements

      // Derived loss %
      if (srt.pktTotal > 0 && srt.pktLoss !== undefined) {
        srt.lossPercent = parseFloat(
          ((srt.pktLoss / srt.pktTotal) * 100).toFixed(2)
        );
      }

      if (Object.keys(srt).length > 0) {
        this.srtStats = srt;
        this.emit('srtStats', srt);
      }
    }
  }

  // ─── Serialisation ──────────────────────────────────────────────────────────
  toJSON() {
    return {
      id: this.id,
      input: this.input,
      outputMode: this.outputMode || (this.host ? 'srt' : 'null'),
      host: this.host,
      port: this.port,
      isRunning: this.isRunning,
      startTime: this.startTime,
      lastStats: this.lastStats,
      inputBitrate: this.inputBitrate || null,
      inputStreams: this.inputStreams || null,
      srtStats: this.srtStats,
      encodeProfile: {
        videoCodec: this.videoCodec,
        videoBitrate: this.videoBitrate,
        preset: this.preset,
        profile: this.profile,
        gopSize: this.gopSize,
        rateMode: this.rateMode,
      },
      audioPairs: this.audioPairs || null,
      dvb: {
        serviceId: this.serviceId,
        transportStreamId: this.transportStreamId,
        originalNetworkId: this.originalNetworkId,
        pmtPid: this.pmtPid,
        videoPid: this.videoPid,
        serviceName: this.serviceName,
        serviceProvider: this.serviceProvider,
      },
    };
  }
}

module.exports = SRTEncoder;
