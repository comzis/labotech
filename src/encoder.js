'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

// ─── Bitrate normalisation ───────────────────────────────────────────────────
// Accepts plain numbers and appends the correct unit so FFmpeg never sees
// a bare integer (which it would interpret as bits/s, not Mbps/kbps).
//
//   normBitrate('10',     'M') → '10M'      (10 Mbps)
//   normBitrate('11.502', 'M') → '11502k'   (11.502 Mbps → kbps for precision)
//   normBitrate('256',    'k') → '256k'     (256 kbps for audio)
//   normBitrate('8M',     'M') → '8M'       (already has unit — untouched)
//   normBitrate('256k',   'k') → '256k'     (already has unit — untouched)
// ─── NIC / localaddr helper ──────────────────────────────────────────────────
// FFmpeg UDP/RTP URLs support two ways to bind the outgoing socket:
//   interface=eno2     — by NIC name (works even with no IP on the NIC)
//   localaddr=x.x.x.x — by IP address
// Detect which to use based on whether the value looks like an IP or a name.
function _nicParam(val) {
  return /^\d+\.\d+/.test(val) ? `&localaddr=${val}` : `&interface=${val}`;
}

function normBitrate(val, defaultUnit = 'M') {
  if (!val) return val;
  const s = String(val).trim();
  if (/[a-zA-Z]/.test(s)) return s;          // already has a unit suffix
  const num = parseFloat(s);
  if (isNaN(num)) return s;
  if (defaultUnit === 'M') {
    // Integer Mbps → append M; decimal Mbps → convert to kbps for FFmpeg precision
    return Number.isInteger(num) ? `${num}M` : `${Math.round(num * 1000)}k`;
  }
  return `${Math.round(num)}${defaultUnit}`;  // audio: plain number = kbps
}

class SRTEncoder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id;
    this.input = options.input;
    // Guard against the string "null" arriving from JSON form fields.
    // Strip any accidental URL scheme the user may have typed in the host
    // field (e.g. "rtp://239.x.x.x" → "239.x.x.x") — the scheme is added
    // by _buildOutputArgs, so a double prefix like rtp://rtp:// must be prevented.
    const rawHost = options.host;
    let cleanHost = (rawHost && rawHost !== 'null') ? rawHost.trim() : null;
    if (cleanHost) cleanHost = cleanHost.replace(/^[a-z][a-z0-9+\-.]*:\/\//i, '').split('/')[0] || null;
    this.host = cleanHost;
    this.port = options.port || 9999;
    this.latency = options.latency || 2000;
    this.passphrase = options.passphrase || null;
    this.pbkeylen = options.pbkeylen || 16;
    this.adapter = options.adapter || null;
    this.streamId = options.streamId || null;
    this.videoBitrate = normBitrate(options.videoBitrate || '8M', 'M');
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
        bitrate: normBitrate(p.bitrate || '256k', 'k'),
        channels: p.channels != null ? parseInt(p.channels) : 2,
        language: p.language || null,
        // Per-pair PID; defaults to videoPid+1, videoPid+2, ... if not declared
        pid: p.pid != null && p.pid !== '' ? parseInt(p.pid) : (this.videoPid + 1 + i),
      }));
    } else {
      this.audioPairs = null;
      // Legacy flat config — kept for backward compatibility
      this.audioBitrate = normBitrate(options.audioBitrate || '256k', 'k');
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
      // Only append localaddr if it looks like a valid IP (not a stray character)
      const validIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(this.inputLocalAddr);
      if (this.inputLocalAddr && validIp) inputUrl += `&localaddr=${this.inputLocalAddr}`;
      // -f mpegts: force MPEG-TS demuxer so PAT/PMT/PIDs are parsed correctly
      // +discardcorrupt: drop corrupt packets silently rather than crashing
      // genpts is intentionally NOT set — live broadcast UDP sources carry valid
      // PTS/DTS; regenerating them introduces small timestamp irregularities that
      // propagate as PCR jitter in the output muxer.
      args.push(
        '-fflags', '+discardcorrupt',
        '-f', 'mpegts',
        '-i', inputUrl,
      );
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
    // bufsize = 2× video bitrate. Use _parseBps() so '12000k', '8M', etc. all work.
    const vbps = this._parseBps(this.videoBitrate);
    const bufsize = vbps ? `${Math.round(vbps / 1e6 * 2)}M` : this.videoBitrate;

    const effectiveMode = this.outputMode || (this.host ? 'srt' : 'null');
    // 'info' loglevel required for libsrt [srt-stats] lines; 'warning' elsewhere
    const loglevel = effectiveMode === 'srt' ? 'info' : 'warning';

    const args = [
      '-hide_banner',
      '-loglevel', loglevel,
      '-stats',
      ...this.buildInputArgs(),
    ];

    const { THUMBNAIL_DIR } = require('./monitoring');
    const thumbPath = require('path').join(THUMBNAIL_DIR, `${this.id}.jpg`);
    const thumbInterval = parseInt(process.env.THUMBNAIL_INTERVAL_SEC) || 5;

    // ─── Copy / passthrough mode ─────────────────────────────────────────────
    // filter_complex cannot be used with -c copy (no decoding). Instead map
    // streams directly and decode only for the thumbnail second output.
    if (this.videoCodec === 'copy') {
      args.push('-map', '0:v', '-map', '0:a?', '-c', 'copy');
      args.push(...this._buildOutputArgs(effectiveMode));
      args.push(
        '-map', '0:v',
        '-vf', `fps=1/${thumbInterval},scale=320:-2`,
        '-f', 'image2', '-update', '1', '-q:v', '5', '-y', thumbPath,
      );
      return args;
    }

    // ─── Filter complex: even-dimension scale + split for thumbnail tee ─────
    // Using filter_complex with split avoids the two-vf conflict (FFmpeg cannot
    // apply two separate simple filtergraphs to the same input stream).
    args.push(
      '-filter_complex',
      `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,split=2[vout][vthumb];` +
      `[vthumb]fps=1/${thumbInterval},scale=320:-2[thumbout]`,
    );

    // Map video for main output via filter_complex, plus audio
    args.push('-map', '[vout]');
    if (this.audioPairs) {
      // Trailing '?' makes FFmpeg skip the map silently if the source index
      // doesn't exist, rather than aborting with exit code 234.
      this.audioPairs.forEach(p => args.push('-map', `0:a:${p.sourceIndex}?`));
    } else {
      args.push('-map', '0:a?'); // '?' = non-fatal if no audio stream present
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
      args.push('-maxrate', this.videoBitrate, '-bufsize', bufsize);
      if (this.videoCodec === 'libx264') {
        args.push('-x264-params', 'nal-hrd=cbr:force-cfr=1');
      } else if (this.videoCodec === 'libx265') {
        args.push('-x265-params', 'hrd=1:nal-hrd=cbr:vbv-bufsize=' + Math.round(vbps / 1e3));
      }
      // Other codecs (e.g. libx262, mpeg2video) rely on -maxrate + -bufsize alone
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
    args.push('-map', '[thumbout]', '-f', 'image2', '-update', '1', '-q:v', '5', '-y', thumbPath);

    return args;
  }

  // ─── Parse a bitrate string like '8M', '3000k', '256k' → bits/s ────────────
  _parseBps(s) {
    if (!s) return 0;
    const m = String(s).match(/^([\d.]+)\s*([kmg]?)/i);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    const u = (m[2] || '').toLowerCase();
    return u === 'g' ? v * 1e9 : u === 'm' ? v * 1e6 : u === 'k' ? v * 1e3 : v;
  }

  // ─── Calculate CBR mux rate: video + audio + 5% TS overhead ─────────────────
  _calcMuxrate() {
    const vbps = this._parseBps(this.videoBitrate);
    if (!vbps) return null;
    const abps = this.audioPairs
      ? this.audioPairs.reduce((s, p) => s + this._parseBps(p.bitrate || '256k'), 0)
      : this._parseBps(this.audioBitrate || '256k');
    return Math.round((vbps + abps) * 1.05);
  }

  // ─── DVB MPEG-TS muxer options (ISO 13818-1 / ETSI EN 300 468) ─────────────
  // Sets PAT/PMT service structure, original network ID, and transport stream ID.
  _buildDvbMuxerArgs() {
    const args = [
      '-mpegts_service_id',          String(this.serviceId),
      '-mpegts_pmt_start_pid',       String(this.pmtPid),
      '-mpegts_start_pid',           String(this.videoPid),
      '-mpegts_original_network_id', String(this.originalNetworkId),
      '-mpegts_transport_stream_id', String(this.transportStreamId),
      // DVB/ETR 290: PAT+PMT every 100 ms
      '-pat_period', '0.1',
      // PCR every 40 ms — the DVB maximum allowed interval. The FFmpeg default
      // is 20 ms which causes ETR 290 PCR_repetition_error when any packet
      // arrives slightly early (< 20 ms gap). 40 ms stays within spec and
      // gives enough margin to prevent jitter-triggered repetition alarms.
      '-pcr_period', '40',
    ];

    // Enforce CBR mux rate so the TS carries constant bitrate stuffing packets.
    // Without -muxrate the mpegts muxer runs VBR regardless of video codec settings.
    const muxrate = this._calcMuxrate();
    if (muxrate && this.rateMode === 'cbr') {
      args.push('-muxrate', String(muxrate));
    }

    if (this.serviceName)     args.push('-metadata', `service_name=${this.serviceName}`);
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
      if (this.localAddr) url += _nicParam(this.localAddr);
      return ['-f', 'mpegts', ...dvb, ...pids, url];
    }

    if (mode === 'rtp') {
      // RTP encapsulation of full MPEG-TS (rtp_mpegts muxer)
      let url = `rtp://${this.host}:${this.port}?ttl=${this.ttl}`;
      if (this.localAddr) url += _nicParam(this.localAddr);
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
      // FFmpeg handles SIGTERM internally and exits with code 255 rather than
      // propagating the signal — treat 255 as a clean stop when we requested it.
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
