'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const { THUMBNAIL_DIR, sanitizeStreamId } = require('./monitoring');

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
    this.videoBitrate = normBitrate(options.videoBitrate || '10M', 'M');
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
    this.inputBitrate = null;
    this.inputBitrateSource = null;
    this._stopInputBitrateWatcher = null;
    this._bitrateWatcherProc = null;
    this._inputBitrateMeasuring = false;
  }

  _setInputBitrateMeasuring(measuring) {
    const next = Boolean(measuring);
    if (this._inputBitrateMeasuring === next) return;
    this._inputBitrateMeasuring = next;
    this.emit('stats', { inputBitrateMeasuring: next });
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
    // Host is sanitized in constructor; always build canonical SRT URL here.
    // stats=1 + statsintvl=1 tells libsrt to emit periodic [srt-stats] lines.
    let url = `srt://${this.host}:${this.port}?mode=caller&latency=${this.latency}&stats=1&statsintvl=1`;

    if (this.passphrase) url += `&passphrase=${encodeURIComponent(this.passphrase)}&pbkeylen=${this.pbkeylen}`;
    if (this.streamId) url += `&streamid=${encodeURIComponent(this.streamId)}`;
    if (this.adapter) url += `&adapter=${encodeURIComponent(this.adapter)}`;
    return url;
  }

  // ─── Full FFmpeg argument chain ─────────────────────────────────────────────
  buildFFmpegArgs() {
    // bufsize = 1× video bitrate (tighter CBR, less jitter — 2× was too loose for broadcast).
    const vbps = this._parseBps(this.videoBitrate);
    const bufsize = vbps ? `${Math.round(vbps / 1e6)}M` : this.videoBitrate;

    const effectiveMode = this.outputMode || (this.host ? 'srt' : 'null');
    // 'info' loglevel required for libsrt [srt-stats] lines; 'warning' elsewhere
    const loglevel = effectiveMode === 'srt' ? 'info' : 'warning';

    const args = [
      '-hide_banner',
      '-loglevel', loglevel,
      '-stats',
      ...this.buildInputArgs(),
    ];

    const thumbPath = path.join(THUMBNAIL_DIR, `${sanitizeStreamId(this.id)}.jpg`);
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
      // setpts=PTS: pass input timestamps through unchanged — prevents DTS-out-of-order
      // PTS errors (ETR290 P2) caused by filtergraph generating synthetic timestamps
      `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setpts=PTS,split=2[vout][vthumb];` +
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
      '-keyint_min', this.gopSize.toString(), // prevent early keyframes between GOPs
      '-sc_threshold', '0',                   // disable scene-cut keyframes — CBR requires fixed GOP
      '-b:v', this.videoBitrate,
      '-pix_fmt', this.pixFmt,
    );

    const x265Params = [];
    if (this.rateMode === 'cbr') {
      // True CBR — VBV + HRD signalling (broadcast standard)
      args.push('-maxrate', this.videoBitrate, '-bufsize', bufsize);
      if (this.videoCodec === 'libx264') {
        args.push('-x264-params', 'nal-hrd=cbr:force-cfr=1:scenecut=0');
      } else if (this.videoCodec === 'libx265') {
        x265Params.push(`hrd=1:nal-hrd=cbr:no-scenecut=1:vbv-bufsize=${Math.round(vbps / 1e3)}`);
      }
      // Other codecs (e.g. libx262, mpeg2video) rely on -maxrate + -bufsize alone
    } else {
      // VBR — constrained by bufsize only
      args.push('-bufsize', bufsize);
    }

    // ─── Professional Metadata & HDR Signaling (DVB TS 101 154) ────────────
    if (this.videoCodec === 'libx265' && this.pixFmt && this.pixFmt.includes('10le')) {
      const colorPrimaries = this.colorPrimaries || 'bt2020';
      const colorTrc = this.colorTransfer || 'smpte2084';
      const colorSpace = this.colorSpace || 'bt2020nc';
      args.push(
        '-color_primaries', colorPrimaries,
        '-color_trc', colorTrc,
        '-colorspace', colorSpace
      );
      x265Params.push(`hdr-opt=1:repeat-headers=1:colorprim=${colorPrimaries}:transfer=${colorTrc}:colormatrix=${colorSpace}`);
    }
    if (x265Params.length > 0) {
      args.push('-x265-params', x265Params.join(':'));
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

    // Prevent muxing queue overflow on high-bitrate streams (>= 10 Mbps)
    args.push('-max_muxing_queue_size', '4096');

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
      // PCR every 20 ms — well within the ETR290 2.3a 40 ms limit.
      // Explicit period prevents drift under encoder load that would push
      // the interval past 40 ms and trigger PCR repetition alarms.
      '-pcr_period', '20',
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
      if (typeof this._stopInputBitrateWatcher === 'function') {
        this._stopInputBitrateWatcher();
      }
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
    const inputType = this.detectInputType(this.input);
    if ((inputType === 'udp' || inputType === 'rtp' || inputType === 'srt') && !this.inputBitrate) {
      this._startInputBitrateWatcher();
    }
    return this;
  }

  stop() {
    if (this.process && this.isRunning) {
      if (typeof this._stopInputBitrateWatcher === 'function') {
        this._stopInputBitrateWatcher();
      }
      this._stopping = true;
      this.process.kill('SIGTERM');
    }
  }

  _startInputBitrateWatcher() {
    const self = this;
    if (typeof self._stopInputBitrateWatcher === 'function') return;

    let watcherProc = null;
    let watcherTimer = null;
    let cancelled = false;

    const runOnce = () => {
      if (cancelled || !self.isRunning) return;
      const watchInputType = self.detectInputType(self.input);
      const inputFflags = (watchInputType === 'udp' || watchInputType === 'rtp')
        ? ['-fflags', '+discardcorrupt+genpts']
        : ['-fflags', '+discardcorrupt'];
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        ...inputFflags,
        '-analyzeduration', '1000000',
        '-probesize', '2000000',
        '-progress', 'pipe:2',
        '-t', '4',
        '-i', self.input,
        '-map', '0',
        '-c', 'copy',
        '-f', 'mpegts',
        '-y', '/dev/null',
      ];
      watcherProc = spawn('ffmpeg', args);
      self._bitrateWatcherProc = watcherProc;
      let stderr = '';
      const killTimer = setTimeout(() => {
        try { watcherProc.kill('SIGTERM'); } catch (_) {}
      }, 12000);
      watcherProc.stderr.on('data', (d) => { stderr += d.toString(); });
      watcherProc.on('error', () => {
        clearTimeout(killTimer);
      });
      watcherProc.on('exit', () => {
        clearTimeout(killTimer);
        self._bitrateWatcherProc = null;
        if (cancelled) return;
        let totalSize = 0;
        let outTimeUs = 0;
        let progressKbps = 0;
        for (const line of stderr.split('\n')) {
          const eq = line.indexOf('=');
          if (eq < 0) continue;
          const k = line.slice(0, eq).trim();
          const v = line.slice(eq + 1).trim();
          if (k === 'total_size') totalSize = parseInt(v, 10) || totalSize;
          if (k === 'out_time_us') outTimeUs = parseInt(v, 10) || outTimeUs;
          if (k === 'bitrate') {
            const m = v.match(/([\d.]+)\s*kbits/i);
            if (m) progressKbps = parseFloat(m[1]) || progressKbps;
          }
        }
        let kbps = null;
        if (totalSize > 0 && outTimeUs > 0) {
          const secs = outTimeUs / 1e6;
          if (Number.isFinite(secs) && secs > 0.5) kbps = Math.round((totalSize * 8) / secs / 1000);
        }
        if (!kbps && progressKbps > 0) kbps = Math.round(progressKbps);
        if (
          kbps &&
          kbps > 0 &&
          self.isRunning &&
          self.inputBitrateSource !== 'stream-descriptor'
        ) {
          self.inputBitrate = kbps;
          self.inputBitrateSource = 'bitrate-watcher';
          self.emit('stats', { inputBitrate: kbps });
        }
        self._setInputBitrateMeasuring(false);
        // Only reschedule if measurement was inconclusive (kbps still null).
        // Once a value is confirmed, stop consuming resources.
        if (!cancelled && self.isRunning && !self.inputBitrate) {
          self._setInputBitrateMeasuring(true);
          watcherTimer = setTimeout(runOnce, 30000);
        } else if (typeof self._stopInputBitrateWatcher === 'function') {
          self._stopInputBitrateWatcher();
        }
      });
    };

    self._setInputBitrateMeasuring(true);
    runOnce();
    self._stopInputBitrateWatcher = () => {
      cancelled = true;
      self._setInputBitrateMeasuring(false);
      if (watcherTimer) {
        clearTimeout(watcherTimer);
        watcherTimer = null;
      }
      if (watcherProc) {
        try { watcherProc.kill('SIGTERM'); } catch (_) {}
        watcherProc = null;
      }
      self._bitrateWatcherProc = null;
      self._stopInputBitrateWatcher = null;
    };
  }

  // ─── Stats parsing ──────────────────────────────────────────────────────────
  parseStats(line) {
    // ── 0. Input bitrate — parsed from FFmpeg demuxer startup lines ──────────
    // Examples:
    // "Duration: N/A, start: 1234.56, bitrate: 8192 kb/s"
    // "Input #0, mpegts, from ... bitrate: 7.0 Mb/s"
    const mInputBr = line.match(/bitrate:\s*([\d.]+)\s*(kbits\/s|kb\/s|mbits\/s|mb\/s)/i);
    if (mInputBr) {
      const raw = parseFloat(mInputBr[1]);
      const unit = (mInputBr[2] || '').toLowerCase();
      let kbps = raw;
      if (unit.startsWith('m')) kbps = raw * 1000;
      if (Number.isFinite(kbps) && kbps > 0) {
        this.inputBitrate = kbps;
        this.inputBitrateSource = 'stream-descriptor';
        this.emit('stats', { inputBitrate: this.inputBitrate });
        if (typeof this._stopInputBitrateWatcher === 'function') this._stopInputBitrateWatcher();
      }
    }

    // ── 0b. Input stream detection — parsed from FFmpeg stream info lines ────
    // "  Stream #0:0[0x100]: Video: h264 (High), yuv420p, 1920x1080, 25 fps"
    // "  Stream #0:1[0x101]: Audio: mp2, 48000 Hz, stereo, fltp, 256 kb/s"
    const mStream = line.match(/Stream #0:(\d+).*?:\s*(Video|Audio|Data):\s*([^\s,]+)(.*)/i);
    if (mStream) {
      if (!this.inputStreams) this.inputStreams = [];
      const sourceIndex = parseInt(mStream[1], 10);
      const kind = mStream[2].toLowerCase();
      const codec = mStream[3];
      const detail = mStream[4].trim();
      const entry = { sourceIndex, kind, codec, detail };
      // Resolution + fps for video
      const mRes = detail.match(/(\d{3,4})x(\d{3,4})/);
      const mFpsD = detail.match(/([\d.]+)\s*fps/);
      if (mRes) { entry.width = parseInt(mRes[1]); entry.height = parseInt(mRes[2]); }
      if (mFpsD) entry.fps = parseFloat(mFpsD[1]);
      // Sample rate + channels for audio
      const mSr = detail.match(/([\d]+)\s*Hz/);
      if (mSr) entry.sampleRate = parseInt(mSr[1]);
      const mBrK = detail.match(/([\d.]+)\s*kb\/s/i) || detail.match(/([\d.]+)\s*kbits\/s/i);
      const mBrM = detail.match(/([\d.]+)\s*mb\/s/i) || detail.match(/([\d.]+)\s*mbits\/s/i);
      if (mBrK) entry.bitrateKbps = parseFloat(mBrK[1]);
      if (mBrM) entry.bitrateKbps = parseFloat(mBrM[1]) * 1000;
      // Replace existing entry for same source stream index or append.
      // This preserves multiple audio tracks from the same input.
      const idx = this.inputStreams.findIndex(s => s.sourceIndex === sourceIndex);
      if (idx >= 0) this.inputStreams[idx] = entry; else this.inputStreams.push(entry);
      const summedKbps = this.inputStreams.reduce((acc, s) => acc + (s.bitrateKbps || 0), 0);
      if (summedKbps > 0) {
        this.inputBitrate = summedKbps;
        this.inputBitrateSource = 'stream-descriptor';
        if (typeof this._stopInputBitrateWatcher === 'function') this._stopInputBitrateWatcher();
      }
      this.emit('stats', { inputStreams: this.inputStreams });
      if (this.inputBitrate) this.emit('stats', { inputBitrate: this.inputBitrate });
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
    if (
      this.videoCodec === 'copy' &&
      encStats.bitrate &&
      encStats.bitrate > 0 &&
      !this.inputBitrate
    ) {
      this.inputBitrate = Math.round(encStats.bitrate);
      this.inputBitrateSource = 'proxy-output';
      this.emit('stats', { inputBitrate: this.inputBitrate });
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
        // srt-stats rateMbps is the OUTPUT SRT send rate.
        // Only use it as an input-bitrate proxy when no direct measurement is available.
        if (srt.rateMbps && srt.rateMbps > 0) {
          const kbps = Math.round(srt.rateMbps * 1000);
          const noDirectMeasure = !this.inputBitrateSource || this.inputBitrateSource === 'srt-stats';
          if (noDirectMeasure && kbps !== this.inputBitrate) {
            this.inputBitrate = kbps;
            this.inputBitrateSource = 'srt-stats';
            this.emit('stats', { inputBitrate: this.inputBitrate });
          }
        }
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
      inputBitrateSource: this.inputBitrateSource || null,
      inputBitrateMeasuring: Boolean(this._inputBitrateMeasuring),
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
