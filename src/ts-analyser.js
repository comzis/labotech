'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { captureThumbnail, THUMBNAIL_DIR, sanitizeStreamId } = require('./monitoring');
const IATSniffer = require('./iat-sniffer');
const DolbyEAdapter = require('./dolbye-adapter');
let _multicastConfig = null;

function _envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const HEALTH_THRESHOLDS = {
  scoreWarning: _envNumber('TS_HEALTH_SCORE_WARNING', 65),
  scoreOk: _envNumber('TS_HEALTH_SCORE_OK', 85),
  lossWarnPct: _envNumber('TS_HEALTH_LOSS_WARN_PCT', 0.1),
  lossCriticalPct: _envNumber('TS_HEALTH_LOSS_CRITICAL_PCT', 1.0),
  jitterWarnMs: _envNumber('TS_HEALTH_JITTER_WARN_MS', 5),
  jitterCriticalMs: _envNumber('TS_HEALTH_JITTER_CRITICAL_MS', 15),
  iatP95WarnMs: _envNumber('TS_HEALTH_IAT_P95_WARN_MS', 50),
  iatP95CriticalMs: _envNumber('TS_HEALTH_IAT_P95_CRITICAL_MS', 150),
  tsDiscWarnCount: _envNumber('TS_HEALTH_TS_DISC_WARN_COUNT', 1),
  tsDiscCriticalCount: _envNumber('TS_HEALTH_TS_DISC_CRITICAL_COUNT', 3),
  ccWarnCount: _envNumber('TS_HEALTH_CC_WARN_COUNT', 1),
  ccCriticalCount: _envNumber('TS_HEALTH_CC_CRITICAL_COUNT', 3),
  dolbyEMissingPenalty: _envNumber('TS_HEALTH_DOLBYE_MISSING_PENALTY', 10),
  dolbyEDecodeFailurePenalty: _envNumber('TS_HEALTH_DOLBYE_DECODE_FAIL_PENALTY', 18),
};
const SMPTE_2022_7_THRESHOLDS = {
  minSamples: _envNumber('TS_20227_MIN_SAMPLES', 50),
  maxLossPct: _envNumber('TS_20227_MAX_LOSS_PCT', 0.0),
  maxGapEvents: _envNumber('TS_20227_MAX_GAP_EVENTS', 0),
  maxDuplicateEvents: _envNumber('TS_20227_MAX_DUPLICATE_EVENTS', 0),
  maxReorderedEvents: _envNumber('TS_20227_MAX_REORDER_EVENTS', 0),
  requireNicCapture: String(process.env.TS_20227_REQUIRE_NIC_CAPTURE || 'true').toLowerCase() !== 'false',
};
const AUDIO_LEVEL_HOLD_MS = Math.max(1000, Math.floor(_envNumber('AUDIO_LEVEL_HOLD_MS', 15000)));
const LIVE_INPUT_HINTS = {
  // Conservative defaults avoid ENOMEM on constrained hosts.
  fifoSize: Math.max(1, Math.floor(_envNumber('TS_INPUT_FIFO_SIZE', 524288))),
  timeoutUs: Math.max(1, Math.floor(_envNumber('TS_INPUT_TIMEOUT_US', 7000000))),
  reorderQueueSize: Math.max(1, Math.floor(_envNumber('TS_INPUT_REORDER_QUEUE_SIZE', 256))),
};
function _getNicName() {
  if (_multicastConfig) return _multicastConfig.nic || 'eno2';
  try {
    _multicastConfig = require('../config/multicast.json');
    return _multicastConfig.nic || 'eno2';
  } catch (_) {
    return 'eno2';
  }
}

class TSAnalyser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `analyser-${Date.now()}`;
    this.url = options.url;
    this.interval = options.interval || 5000; // ms between continuous probes

    this._timer = null;
    this._thumbnailTimer = null;
    this._lastThumbnailUrl = null;
    this._thumbnailCapturing = false;
    this.isRunning = false;
    this.lastResult = null;
    this._continuousProbeCount = 0;
    this._lastThumbnailAt = 0;
    this.nicName = options.nicName || _getNicName();
    this._iatSniffer = null;
  }

  probe(options = {}) {
    const isContinuous = Boolean(options.continuous);
    if (isContinuous) this._continuousProbeCount += 1;
    // Heavy transport/tsduck probing is expensive on live multicast.
    // In continuous mode, run it every 3rd cycle to keep UI responsive.
    const runHeavyProbe = !isContinuous || (this._continuousProbeCount % 3 === 1);
    // In continuous mode thumbnails are managed by a separate timer (startContinuous).
    // For one-shot probes only, capture synchronously here.
    const runThumbnailCapture = !isContinuous;

    return new Promise((resolve, reject) => {
      const runFfprobeJson = (probeUrl, extraArgs = []) => new Promise((resolveProbe, rejectProbe) => {
        const args = [
          '-v', 'quiet',
          '-analyzeduration', '7000000',
          '-probesize', '7000000',
          ...extraArgs,
          '-print_format', 'json',
          '-show_programs',
          '-show_streams',
          '-show_format',
          probeUrl,
        ];
        const proc = spawn('ffprobe', args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('error', (err) => {
          rejectProbe(new Error(`ffprobe spawn failed: ${err && err.message ? err.message : 'unknown error'}`));
        });
        proc.on('exit', (code) => {
          if (code !== 0) {
            return rejectProbe(new Error(`ffprobe exited ${code}: ${stderr.trim()}`));
          }
          const out = String(stdout || '').trim();
          if (!out) {
            return rejectProbe(new Error(`ffprobe returned empty probe payload (no input packets observed during probe window)${stderr && stderr.trim() ? `: ${stderr.trim()}` : ''}`));
          }
          try {
            const raw = JSON.parse(out);
            return resolveProbe(raw);
          } catch (_) {
            return rejectProbe(new Error(`ffprobe returned invalid JSON payload${stderr && stderr.trim() ? `: ${stderr.trim()}` : ''}`));
          }
        });
      });

      (async () => {
        try {
          const primaryUrl = this._withLiveInputHints(this.url);
          let raw = null;
          try {
            raw = await runFfprobeJson(primaryUrl);
          } catch (primaryErr) {
            if (this._isLiveInputHintMemoryError(primaryErr)) {
              // Host cannot allocate hinted UDP buffers; retry without hints.
              raw = await runFfprobeJson(this.url);
            } else {
              // RTP multicast feeds often need UDP/mpegts probing for one-shot ffprobe.
              if (!this._isRtpUrl(this.url)) throw primaryErr;
              const udpUrl = this._withLiveInputHints(this._rtpToUdpUrl(this.url) || '');
              if (!udpUrl) throw primaryErr;
              try {
                raw = await runFfprobeJson(udpUrl, ['-fflags', '+discardcorrupt', '-f', 'mpegts']);
              } catch (fallbackErr) {
                if (this._isLiveInputHintMemoryError(fallbackErr)) {
                  const plainUdp = this._rtpToUdpUrl(this.url) || '';
                  raw = await runFfprobeJson(plainUdp, ['-fflags', '+discardcorrupt', '-f', 'mpegts']);
                } else {
                  throw new Error(`${primaryErr.message} | RTP UDP fallback failed: ${fallbackErr.message}`);
                }
              }
            }
          }

          let result = this.parseStructure(raw);
          // Some RTP/TS sources omit ids for all or part of program streams.
          // Always attempt PID backfill from ffmpeg banner lines and patch any gaps.
          const pidProbe = await this._probeStreamPidsFromFfmpeg();
          result = this._applyPidMap(result, pidProbe || {});
          result = this._applyFallbackPidRows(result, pidProbe.rows || []);
          const [tsduckProbe, transportProbe, audioLevels, tsDiscontinuityProbe, ccProbe, dolbyEProbe] = await Promise.all([
            runHeavyProbe ? this._probeTSDuck() : Promise.resolve(null),
            runHeavyProbe ? this._probeTransportBitrateBps() : Promise.resolve(null),
            this._probeAudioLevels(),
            runHeavyProbe ? this._probeTimestampDiscontinuities() : Promise.resolve(null),
            runHeavyProbe ? this._probeContinuityCounterErrors() : Promise.resolve(null),
            runHeavyProbe ? this._probeDolbyE() : Promise.resolve(null),
          ]);
          const nicMetrics = this._iatSniffer && this._iatSniffer.isRunning
            ? this._iatSniffer.getMetrics()
            : null;
          result = this._applyTSDuckData(result, tsduckProbe?.data || null, nicMetrics);
          result.dvb.smpte20227 = this._buildSmpte20227Assessment(result);
          result.dvb.probeDiagnostics = {
            ...(result.dvb.probeDiagnostics || {}),
            tsduck: {
              attempted: runHeavyProbe,
              available: tsduckProbe?.available === true,
              ok: tsduckProbe?.ok === true,
              used: result?.dvb?.bitrateSource === 'tsduck',
              error: tsduckProbe?.error || null,
            },
            iatSniffer: {
              attempted: Boolean(this._iatSniffer),
              captureMethod: nicMetrics?.captureMethod ?? (this._iatSniffer?.captureMethod || 'unavailable'),
              sampleCount: nicMetrics?.sampleCount ?? 0,
              error: this._iatSniffer?.lastError || null,
            },
            timestampDiscontinuity: {
              attempted: runHeavyProbe,
              ok: tsDiscontinuityProbe ? tsDiscontinuityProbe.ok === true : null,
              error: tsDiscontinuityProbe?.error || null,
            },
            continuityCounter: {
              attempted: runHeavyProbe,
              ok: ccProbe ? ccProbe.ok === true : null,
              error: ccProbe?.error || null,
            },
            dolbyE: {
              attempted: runHeavyProbe,
              enabled: DolbyEAdapter.isEnabled(),
              configured: DolbyEAdapter.isConfigured(),
              ok: dolbyEProbe ? dolbyEProbe.ok === true : null,
              error: dolbyEProbe?.error || null,
            },
          };
          result.dvb.timestampDiscontinuity = tsDiscontinuityProbe?.data || {
            count: 0,
            pcrDiscontinuity: 0,
            ptsDiscontinuity: 0,
            dtsDiscontinuity: 0,
            nonMonotonousDts: 0,
            lastMessages: [],
          };
          result.dvb.continuityCounterErrors = ccProbe?.data || {
            count: 0,
            pidScopedCount: 0,
            genericCount: 0,
            lastMessages: [],
          };
          result.dvb.dolbyE = dolbyEProbe || {
            available: false,
            ok: false,
            detected: false,
            decoded: false,
            frameCount: null,
            programConfig: null,
            error: null,
          };
          const measuredBitrateBps = Number(transportProbe && transportProbe.bitrateBps);
          if (Number.isFinite(measuredBitrateBps) && measuredBitrateBps > 0) {
            result.dvb.measuredBitrateBps = measuredBitrateBps;
            // tsduck is preferred when available, otherwise use measured remux bitrate.
            if (!result.dvb.bitrateBps || result.dvb.bitrateSource !== 'tsduck') {
              result.dvb.bitrateBps = measuredBitrateBps;
              result.dvb.bitrateSource = 'measured';
            }
          }
          if (transportProbe && transportProbe.srtStats) {
            result.dvb.srtStats = transportProbe.srtStats;
          } else if (this.lastResult?.dvb?.srtStats) {
            // Keep last known libsrt counters between heavy probe intervals.
            result.dvb.srtStats = this.lastResult.dvb.srtStats;
          }
          // When transport-level probes are skipped, avoid jumping back to low-confidence
          // container/stream-derived values in CBR operational views.
          if (
            !runHeavyProbe &&
            this.lastResult?.dvb?.bitrateBps > 0 &&
            ['format', 'streams'].includes(String(result.dvb.bitrateSource || '').toLowerCase()) &&
            ['tsduck', 'measured'].includes(String(this.lastResult?.dvb?.bitrateSource || '').toLowerCase())
          ) {
            result.dvb.bitrateBps = this.lastResult.dvb.bitrateBps;
            result.dvb.bitrateSource = this.lastResult.dvb.bitrateSource;
            result.dvb.bitrateHeldFromPrevious = true;
          }
          const hasFreshAudioLevels = Boolean(
            audioLevels && (
              (Array.isArray(audioLevels.channels) && audioLevels.channels.length > 0) ||
              Number.isFinite(Number(audioLevels.meanDb)) ||
              Number.isFinite(Number(audioLevels.maxDb))
            )
          );
          if (hasFreshAudioLevels) {
            result.audioLevels = audioLevels;
          } else {
            const lastAudio = this.lastResult?.audioLevels || null;
            const lastProbeTime = Number(this.lastResult?.probeTime || 0);
            const ageMs = lastProbeTime > 0 ? (Date.now() - lastProbeTime) : Number.POSITIVE_INFINITY;
            if (lastAudio && ageMs <= AUDIO_LEVEL_HOLD_MS) {
              // Keep last valid meter sample briefly to avoid VU bar blink/drop
              // on occasional astats probe misses under load.
              result.audioLevels = lastAudio;
              result.dvb.probeDiagnostics = {
                ...(result.dvb.probeDiagnostics || {}),
                audioLevels: {
                  attempted: true,
                  heldFromPrevious: true,
                  holdMs: AUDIO_LEVEL_HOLD_MS,
                  ageMs,
                },
              };
            } else {
              result.audioLevels = audioLevels;
            }
          }
          if (runThumbnailCapture) {
            // One-shot probe: capture synchronously so the caller gets a fresh frame.
            try {
              await captureThumbnail(this.id, this.url);
              result.thumbnailUrl = `/logs/thumbnails/${sanitizeStreamId(this.id)}.jpg?t=${Date.now()}`;
              this._lastThumbnailUrl = result.thumbnailUrl;
            } catch (err) {
              if (this._lastThumbnailUrl) {
                result.thumbnailUrl = this._lastThumbnailUrl;
              } else if (this.lastResult?.thumbnailUrl) {
                result.thumbnailUrl = this.lastResult.thumbnailUrl;
              } else {
                const cachedUrl = this._resolveCachedThumbnailUrl();
                if (cachedUrl) result.thumbnailUrl = cachedUrl;
              }
              result.dvb.probeDiagnostics = {
                ...(result.dvb.probeDiagnostics || {}),
                thumbnail: {
                  attempted: true,
                  ok: false,
                  error: err && err.message ? err.message : 'thumbnail capture failed',
                },
              };
            }
          } else {
            // Continuous mode: thumbnails are captured by the independent timer.
            // Just attach the most recently completed thumbnail URL.
            if (this._lastThumbnailUrl) {
              result.thumbnailUrl = this._lastThumbnailUrl;
            } else if (this.lastResult?.thumbnailUrl) {
              result.thumbnailUrl = this.lastResult.thumbnailUrl;
            } else {
              const cachedUrl = this._resolveCachedThumbnailUrl();
              if (cachedUrl) result.thumbnailUrl = cachedUrl;
            }
          }
          result = this._normalizeAndSortResult(result);
          result = this._attachHealthAssessment(result);
          this.lastResult = result;
          this.emit('result', result);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      })();

    });
  }

  parseStructure(raw) {
    const globalByIndex = new Map((raw.streams || []).map((s) => [s.index, s]));
    const programs = (raw.programs || []).map(prog => ({
      programId: prog.program_id,
      pmtPid: prog.pmt_pid,
      pcrPid: prog.pcr_pid,
      // ffprobe uses 'service_name' for DVB-SI SDT entries; some streams expose 'title' or 'name'.
      name: (prog.tags && (prog.tags['service_name'] || prog.tags['SERVICE_NAME'] || prog.tags['title'] || prog.tags['name'])) || null,
      provider: (prog.tags && (prog.tags['service_provider'] || prog.tags['SERVICE_PROVIDER'] || prog.tags['service_provider_name'])) || null,
      // ffprobe program-level stream objects can omit PID/id fields depending on input.
      // Merge carefully with global stream entry by index so empty program values do not
      // clobber valid global PID metadata.
      streams: (prog.streams || []).map((s) => this._mapStream(this._mergeStreamInfo(globalByIndex.get(s.index), s))),
    }));

    // Streams not in any program
    const programStreamIds = new Set(
      programs.flatMap(p => p.streams.map(s => s.index))
    );
    const orphanStreams = (raw.streams || [])
      .filter(s => !programStreamIds.has(s.index))
      .map(s => this._mapStream(s));

    const allStreams = programs.flatMap(p => p.streams).concat(orphanStreams);
    const pidCount = allStreams.filter(s => s.pid != null).length;
    const serviceCount = programs.length;
    const videoCount = allStreams.filter(s => s.codecType === 'video').length;
    const audioCount = allStreams.filter(s => s.codecType === 'audio').length;
    const dataCount = allStreams.filter(s => s.codecType === 'data').length;
    const streamBitrateBps = allStreams.reduce((acc, s) => acc + (s.bitrate || 0), 0);
    const formatBitrateBps = raw?.format?.bit_rate ? parseInt(raw.format.bit_rate, 10) : null;
    // Prefer container/transport bitrate when available (closer to on-wire TS rate),
    // then fall back to summed elementary stream bitrates.
    const hasFormatRate = formatBitrateBps && Number.isFinite(formatBitrateBps) && formatBitrateBps > 0;
    const bitrateBps = hasFormatRate ? formatBitrateBps : streamBitrateBps;
    const bitrateSource = hasFormatRate ? 'format' : 'streams';

    return {
      url: this.url,
      probeTime: Date.now(),
      programs,
      orphanStreams,
      audioLevels: null,
      dvb: {
        standard: 'ISO/IEC 13818-1 MPEG-TS + ETSI EN 300 468 DVB-SI',
        patPid: 0,
        serviceCount,
        pidCount,
        streamBreakdown: { video: videoCount, audio: audioCount, data: dataCount },
        bitrateBps,
        bitrateSource,
        streamBitrateBps,
        formatBitrateBps,
        services: programs.map(p => ({
          serviceId: p.programId,
          serviceName: p.name,
          serviceProvider: p.provider,
          pmtPid: p.pmtPid,
          pcrPid: p.pcrPid,
        })),
      },
    };
  }

  _probeAudioLevels() {
    return new Promise((resolve) => {
      // astats WITHOUT metadata=1 prints a channel summary to stderr on exit.
      // metadata=1 stores stats as frame AVDictionary entries which are never
      // printed to stderr with -f null, so the old approach always returned null.
      const args = [
        '-hide_banner',
        '-nostats',
        '-loglevel', 'info',
        '-t', '2.0',
        '-i', this._withLiveInputHints(this.url),
        '-vn',
        '-af', 'astats=reset=1',
        '-f', 'null',
        '-',
      ];

      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 6000);

      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      proc.on('exit', () => {
        clearTimeout(timeout);
        // astats summary format (FFmpeg 4.x–7.x):
        //   "[Parsed_astats_0 @ 0x...] Channel: 1"
        //   "[Parsed_astats_0 @ 0x...]   Peak level dB: -20.00"
        //   "[Parsed_astats_0 @ 0x...]   RMS level dB: -26.00"
        //   "[Parsed_astats_0 @ 0x...] Overall:"
        const channelPeak = {};
        const channelRms = {};
        let currentCh = null;
        for (const line of stderr.split('\n')) {
          // "Channel: N" — 1-indexed, convert to 0-indexed
          const chM = line.match(/Channel:\s*(\d+)/i);
          if (chM) { currentCh = parseInt(chM[1], 10) - 1; continue; }
          // "Overall:" resets channel tracking
          if (/Overall:/i.test(line)) { currentCh = null; continue; }
          if (currentCh == null) continue;
          const peakM = line.match(/Peak level dB:\s*(-?[\d.]+|inf|-inf)/i);
          if (peakM) {
            const val = parseFloat(peakM[1]);
            if (Number.isFinite(val)) channelPeak[currentCh] = val;
          }
          const rmsM = line.match(/RMS level dB:\s*(-?[\d.]+|inf|-inf)/i);
          if (rmsM) {
            const val = parseFloat(rmsM[1]);
            if (Number.isFinite(val)) channelRms[currentCh] = val;
          }
        }
        const channels = [...new Set([...Object.keys(channelPeak), ...Object.keys(channelRms)])]
          .map(Number).sort((a, b) => a - b);
        if (channels.length === 0) {
          // Fallback: volumedetect aggregate (older FFmpeg or streams without astats support)
          const mean = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/i);
          const max  = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
          if (!mean && !max) return resolve(null);
          return resolve({
            meanDb: mean ? parseFloat(mean[1]) : null,
            maxDb:  max  ? parseFloat(max[1])  : null,
            channels: [],
          });
        }
        const channelData = channels.map((ch) => ({
          ch,
          label: ch === 0 ? 'L' : ch === 1 ? 'R' : `Ch${ch + 1}`,
          peakDb: channelPeak[ch] ?? null,
          rmsDb:  channelRms[ch]  ?? null,
        }));
        const allRms  = channelData.map((c) => c.rmsDb).filter((v) => v != null && Number.isFinite(v));
        const allPeak = channelData.map((c) => c.peakDb).filter((v) => v != null && Number.isFinite(v));
        resolve({
          meanDb:   allRms.length  > 0 ? allRms.reduce((s, v) => s + v, 0) / allRms.length : null,
          maxDb:    allPeak.length > 0 ? Math.max(...allPeak) : null,
          channels: channelData,
        });
      });
    });
  }

  _probeTransportBitrateBps() {
    return new Promise((resolve) => {
      const inputUrl = this._withLiveInputHints(this.url);
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        // Ensure live TS is received without stalling on analysis
        '-fflags', '+discardcorrupt+genpts',
        '-analyzeduration', '1000000',   // 1 s — enough for MPEG-TS PAT/PMT lock
        '-probesize', '2000000',
        '-progress', 'pipe:2',
        '-t', '3.0',
        '-i', inputUrl,
        '-map', '0',
        '-c', 'copy',
        '-f', 'mpegts',
        '-y',
        '/dev/null',
      ];
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 12000);
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      proc.on('exit', () => {
        clearTimeout(timeout);
        let totalSize = 0;
        let outTimeUs = 0;
        let progressKbps = 0;   // bitrate= line from -progress (kbits/s)
        for (const line of stderr.split('\n')) {
          const eq = line.indexOf('=');
          if (eq < 0) continue;
          const k = line.slice(0, eq).trim();
          const v = line.slice(eq + 1).trim();
          if (k === 'total_size')  totalSize    = parseInt(v, 10)   || totalSize;
          // out_time_us is always in microseconds (all FFmpeg versions).
          // out_time_ms was microseconds in old FFmpeg but is milliseconds in ≥5.x.
          // Prefer out_time_us; only fall back to out_time_ms when out_time_us was never set.
          if (k === 'out_time_us') { const n = parseInt(v, 10); if (n > 0) outTimeUs = n; }
          if (k === 'out_time_ms' && outTimeUs === 0) { const n = parseInt(v, 10); if (n > 0) outTimeUs = n; }
          if (k === 'bitrate') {
            // "bitrate=21234.6kbits/s"  or  "bitrate=N/A"
            const m = v.match(/([\d.]+)\s*kbits/i);
            if (m) progressKbps = parseFloat(m[1]) || progressKbps;
          }
        }

        let bitrateBps = null;
        // Primary: size/time calculation (most accurate for MPEG-TS remux)
        if (totalSize > 0 && outTimeUs > 0) {
          const seconds = outTimeUs / 1e6;
          if (Number.isFinite(seconds) && seconds > 0) {
            const bps = Math.round((totalSize * 8) / seconds);
            if (Number.isFinite(bps) && bps > 0) bitrateBps = bps;
          }
        }
        // Fallback: bitrate= field reported directly by FFmpeg
        if (progressKbps > 0) bitrateBps = Math.round(progressKbps * 1000);

        const srtStats = this._extractSrtStatsFromLog(stderr);
        if (bitrateBps || srtStats) {
          return resolve({
            bitrateBps: bitrateBps || null,
            srtStats: srtStats || null,
          });
        }
        resolve(null);
      });
    });
  }

  _extractSrtStatsFromLog(stderr) {
    if (!stderr) return null;
    const last = (rx) => {
      const matches = Array.from(String(stderr).matchAll(rx));
      if (!matches.length) return null;
      return matches[matches.length - 1][1];
    };
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const srt = {};
    const rateMbps = num(last(/(?:^|[\s,])rate=([\d.]+)\s*mbps/ig));
    const bwMbps = num(last(/(?:^|[\s,])bw=([\d.]+)\s*mbps/ig));
    const rttMs = num(last(/(?:^|[\s,])rtt=([\d.]+)\s*ms/ig));
    const pktTotal = num(last(/(?:^|[\s,])total=(\d+)\s*pkts?/ig));
    const pktRetrans = num(last(/(?:^|[\s,])retrans=(\d+)\s*pkts?/ig));
    const pktLost = num(last(/(?:^|[\s,])(?:loss|lost)=(\d+)\s*pkts?/ig));
    const pktDropped = num(last(/(?:^|[\s,])(?:drop|dropped)=(\d+)\s*pkts?/ig));
    const pktNak = num(last(/(?:^|[\s,])nak=(\d+)\s*pkts?/ig));
    const pktAck = num(last(/(?:^|[\s,])ack=(\d+)\s*pkts?/ig));
    if (rateMbps != null) srt.rateMbps = rateMbps;
    if (bwMbps != null) srt.bwMbps = bwMbps;
    if (rttMs != null) srt.rttMs = rttMs;
    if (pktTotal != null) srt.pktTotal = pktTotal;
    if (pktRetrans != null) srt.pktRetrans = pktRetrans;
    if (pktLost != null) srt.pktLost = pktLost;
    if (pktDropped != null) srt.pktDropped = pktDropped;
    if (pktNak != null) srt.pktNak = pktNak;
    if (pktAck != null) srt.pktAck = pktAck;
    if (srt.pktTotal > 0 && srt.pktLost != null) {
      srt.lossPercent = parseFloat(((srt.pktLost / srt.pktTotal) * 100).toFixed(3));
    }
    return Object.keys(srt).length > 0 ? srt : null;
  }

  _probeTimestampDiscontinuities() {
    return new Promise((resolve) => {
      const inputUrl = this._withLiveInputHints(this.url);
      const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-fflags', '+discardcorrupt+genpts',
        '-err_detect', '+crccheck+careful',
        '-analyzeduration', '2000000',
        '-probesize', '3000000',
        '-t', '2.5',
        '-i', inputUrl,
        '-map', '0',
        '-c', 'copy',
        '-f', 'null',
        '-',
      ];
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 8000);
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          data: null,
          error: err && err.message ? err.message : 'timestamp discontinuity probe failed',
        });
      });
      proc.on('exit', () => {
        clearTimeout(timeout);
        const lines = String(stderr || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const patterns = {
          pcrDiscontinuity: /pcr.*discontinu/i,
          ptsDiscontinuity: /pts.*discontinu|timestamp.*discontinu/i,
          dtsDiscontinuity: /dts.*discontinu/i,
          nonMonotonousDts: /non.?monoton(?:ic|ous).*dts/i,
        };
        const counts = {
          pcrDiscontinuity: 0,
          ptsDiscontinuity: 0,
          dtsDiscontinuity: 0,
          nonMonotonousDts: 0,
        };
        const matches = [];
        for (const line of lines) {
          let matched = false;
          for (const [key, rx] of Object.entries(patterns)) {
            if (rx.test(line)) {
              counts[key] += 1;
              matched = true;
            }
          }
          if (matched) matches.push(line.slice(0, 220));
        }
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        resolve({
          ok: true,
          data: {
            count: total,
            ...counts,
            lastMessages: matches.slice(-6),
          },
          error: null,
        });
      });
    });
  }

  _probeContinuityCounterErrors() {
    return new Promise((resolve) => {
      const inputUrl = this._withLiveInputHints(this.url);
      const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-fflags', '+discardcorrupt+genpts',
        '-err_detect', '+crccheck+careful',
        '-analyzeduration', '2000000',
        '-probesize', '3000000',
        '-t', '2.5',
        '-i', inputUrl,
        '-map', '0',
        '-c', 'copy',
        '-f', 'null',
        '-',
      ];
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 8000);
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          data: null,
          error: err && err.message ? err.message : 'continuity counter probe failed',
        });
      });
      proc.on('exit', () => {
        clearTimeout(timeout);
        const lines = String(stderr || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const pidScopedRx = /\bcontinuity(?:\s+counter)?.*(?:check failed|error|mismatch|discontinuity).*\bpid\b/i;
        const genericRx = /\bcontinuity(?:\s+counter)?.*(?:check failed|error|mismatch|discontinuity)|\bcc\b.*error/i;
        let pidScopedCount = 0;
        let genericCount = 0;
        const matches = [];
        for (const line of lines) {
          if (pidScopedRx.test(line)) {
            pidScopedCount += 1;
            matches.push(line.slice(0, 220));
            continue;
          }
          if (genericRx.test(line)) {
            genericCount += 1;
            matches.push(line.slice(0, 220));
          }
        }
        resolve({
          ok: true,
          data: {
            count: pidScopedCount + genericCount,
            pidScopedCount,
            genericCount,
            lastMessages: matches.slice(-6),
          },
          error: null,
        });
      });
    });
  }

  _probeDolbyE() {
    return DolbyEAdapter.probe(this.url)
      .catch((err) => ({
        available: DolbyEAdapter.isConfigured(),
        ok: false,
        detected: false,
        decoded: false,
        frameCount: null,
        programConfig: null,
        error: err && err.message ? err.message : 'Dolby E probe failed',
      }));
  }

  _probeTSDuck() {
    return new Promise((resolve) => {
      const args = this._buildTSDuckArgs();
      const proc = spawn('tsanalyze', args);
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 9000);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          available: false,
          ok: false,
          data: null,
          error: err && err.message ? err.message : 'tsanalyze unavailable',
        });
      });
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 || !stdout.trim()) {
          return resolve({
            available: true,
            ok: false,
            data: null,
            error: stderr.trim() || `tsanalyze exited ${code}`,
          });
        }
        try {
          const raw = JSON.parse(stdout);
          const bitrateBps = this._extractTSDuckBitrateBps(raw);
          const services = this._extractTSDuckServices(raw);
          const pids = this._extractTSDuckPidRows(raw);
          const siIntervalsSec = this._extractTSDuckSIIntervalsSec(raw);
          const arrivalMetrics = this._extractTSDuckArrivalMetrics(raw);
          resolve({
            available: true,
            ok: true,
            data: {
              bitrateBps,
              services,
              pids,
              siIntervalsSec,
              arrivalMetrics,
              stderr: stderr.trim() || null,
            },
            error: null,
          });
        } catch (_) {
          resolve({
            available: true,
            ok: false,
            data: null,
            error: 'tsanalyze returned invalid JSON',
          });
        }
      });
    });
  }

  _buildTSDuckArgs() {
    return ['--json', '--input-timeout', '5000', this.url];
  }

  _mapStream(s) {
    const pid = this._normalizePid(s.id);
    let streamType = null;
    if (s.codec_tag_string && /^0x[0-9a-f]+$/i.test(s.codec_tag_string)) {
      streamType = s.codec_tag_string;
    }

    return {
      index: s.index,
      codecType: s.codec_type,
      codecName: s.codec_name,
      pid,
      pidHex: pid != null ? `0x${Number(pid).toString(16).toUpperCase().padStart(4, '0')}` : null,
      streamType,
      width: s.width || null,
      height: s.height || null,
      fps: this._parseFrameRate(s.avg_frame_rate || s.r_frame_rate),
      bitrate: this._parseBitrate(s.bit_rate),
      sampleRate: s.sample_rate || null,
      channels: s.channels || null,
      language: s.tags && s.tags['language'] || null,
      fieldOrder: s.field_order || null,
      scanType: this._scanTypeFromFieldOrder(s.field_order),
      pixFmt: s.pix_fmt || null,
      colorSpace: s.color_space || null,
      colorTrc: s.color_transfer || null,
      colorPrimaries: s.color_primaries || null,
    };
  }

  _normalizePid(rawId) {
    if (rawId === undefined || rawId === null) return null;
    if (typeof rawId === 'number' && Number.isFinite(rawId)) return rawId;
    const str = String(rawId).trim();
    if (!str) return null;
    // ffprobe can return IDs like "0x100", "256", or occasionally hex without 0x.
    const hexMatch = str.match(/0x([0-9a-f]+)/i);
    if (hexMatch) return parseInt(hexMatch[1], 16);
    if (/^0x[0-9a-f]+$/i.test(str)) return parseInt(str, 16);
    if (/^[0-9]+$/.test(str)) return parseInt(str, 10);
    if (/^[0-9a-f]+$/i.test(str)) return parseInt(str, 16);
    // Handles forms like "256[0x100]" or "pid=0x0100".
    const decMatch = str.match(/(^|[^\d])(\d{2,5})(?!\d)/);
    if (decMatch) return parseInt(decMatch[2], 10);
    return null;
  }

  _parseBitrate(raw) {
    if (raw === undefined || raw === null) return null;
    const str = String(raw).trim();
    if (!str || str.toUpperCase() === 'N/A') return null;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    const n = parseInt(str.replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  _parseFrameRate(raw) {
    if (raw === undefined || raw === null) return null;
    const str = String(raw).trim();
    if (!str || str.toUpperCase() === 'N/A') return null;
    if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
    const frac = str.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (frac) {
      const num = Number(frac[1]);
      const den = Number(frac[2]);
      if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
        return num / den;
      }
    }
    return null;
  }

  _scanTypeFromFieldOrder(fieldOrder) {
    if (!fieldOrder) return null;
    const f = String(fieldOrder).toLowerCase();
    if (f === 'progressive') return 'progressive';
    if (f.includes('tt') || f.includes('tb') || f.includes('top')) return 'interlaced_tff';
    if (f.includes('bb') || f.includes('bt') || f.includes('bottom')) return 'interlaced_bff';
    if (f.includes('interlac')) return 'interlaced';
    return null;
  }

  _mergeStreamInfo(globalStream, programStream) {
    const g = globalStream || {};
    const p = programStream || {};
    const merged = { ...g, ...p };

    // Global stream analysis is authoritative for codec identification.
    // Program PMT entries can contain stale/incomplete codec_type that overrides
    // the correctly-analyzed global value, causing e.g. video showing on audio PIDs.
    if (g.codec_type) merged.codec_type = g.codec_type;
    if (g.codec_name) merged.codec_name = g.codec_name;

    const pPid = this._normalizePid(p.id);
    const gPid = this._normalizePid(g.id);
    merged.id = pPid != null ? p.id : (gPid != null ? g.id : (p.id ?? g.id ?? null));

    const pBitrate = this._parseBitrate(p.bit_rate);
    const gBitrate = this._parseBitrate(g.bit_rate);
    merged.bit_rate = pBitrate != null ? p.bit_rate : (gBitrate != null ? g.bit_rate : (p.bit_rate ?? g.bit_rate ?? null));

    return merged;
  }

  _applyTSDuckData(result, tsduckData, nicMetrics = null) {
    if (!result) return result;
    const next = {
      ...result,
      programs: [...(result.programs || [])],
      orphanStreams: [...(result.orphanStreams || [])],
      dvb: { ...(result.dvb || {}) },
    };

    if (tsduckData && tsduckData.bitrateBps && tsduckData.bitrateBps > 0) {
      next.dvb.tsduckBitrateBps = tsduckData.bitrateBps;
      next.dvb.bitrateBps = tsduckData.bitrateBps;
      next.dvb.bitrateSource = 'tsduck';
    }

    if (tsduckData && Array.isArray(tsduckData.services) && tsduckData.services.length > 0) {
      const byId = new Map((next.dvb.services || []).map((s) => [s.serviceId, s]));
      for (const svc of tsduckData.services) {
        const prev = byId.get(svc.serviceId) || {};
        byId.set(svc.serviceId, {
          serviceId: svc.serviceId ?? prev.serviceId ?? null,
          serviceName: svc.serviceName || prev.serviceName || null,
          serviceProvider: svc.serviceProvider || prev.serviceProvider || null,
          pmtPid: svc.pmtPid ?? prev.pmtPid ?? null,
          pcrPid: svc.pcrPid ?? prev.pcrPid ?? null,
        });
      }
      const mergedServices = [...byId.values()];
      next.dvb.services = mergedServices;
      next.dvb.serviceCount = mergedServices.length;
    }

    if (tsduckData && Array.isArray(tsduckData.pids) && tsduckData.pids.length > 0) {
      const allExisting = next.programs.flatMap((p) => p.streams || []).concat(next.orphanStreams || []);
      const existingPidSet = new Set(allExisting.map((s) => s.pid).filter((v) => v != null));
      const available = tsduckData.pids.filter((r) => r && r.pid != null && !existingPidSet.has(r.pid));
      // Do not "guess-assign" tsduck PID rows onto PID-less streams by codec type.
      // That heuristic can mis-bind video/audio between cycles under unstable probes.
      // Keep existing rows untouched and append only verified PID rows as orphans.
      for (const row of available) {
        if (existingPidSet.has(row.pid)) continue;
        existingPidSet.add(row.pid);
        next.orphanStreams.push({
          index: `tsduck-${row.pid}`,
          codecType: row.codecType || 'data',
          codecName: row.codecName || 'unknown',
          pid: row.pid,
          pidHex: `0x${Number(row.pid).toString(16).toUpperCase().padStart(4, '0')}`,
          streamType: row.streamType || null,
          width: null,
          height: null,
          fps: null,
          bitrate: row.bitrate || null,
          sampleRate: null,
          channels: null,
          language: row.language || null,
          colorSpace: null,
          colorTrc: null,
          colorPrimaries: null,
        });
      }
    }

    const allStreams = next.programs.flatMap((p) => p.streams || []).concat(next.orphanStreams || []);
    next.dvb.pidCount = allStreams.filter((s) => s.pid != null).length;
    next.dvb.streamBreakdown = {
      video: allStreams.filter((s) => s.codecType === 'video').length,
      audio: allStreams.filter((s) => s.codecType === 'audio').length,
      data: allStreams.filter((s) => s.codecType === 'data').length,
    };
    if (tsduckData && tsduckData.siIntervalsSec) {
      const si = tsduckData.siIntervalsSec;
      const compliance = {
        nit: si.nit != null ? si.nit <= 10 : null,
        sdt: si.sdt != null ? si.sdt <= 2 : null,
        eitPf: si.eitPf != null ? si.eitPf <= 2 : null,
        tdt: si.tdt != null ? si.tdt <= 30 : null,
      };
      next.dvb.si = { intervalsSec: si, compliance };
    }
    if (nicMetrics && nicMetrics.sampleCount > 0) {
      next.dvb.arrival = {
        iatMs: nicMetrics.iatMs,
        jitterMs: nicMetrics.jitterMs,
        packetLossPct: nicMetrics.packetLossPct,
        captureMethod: nicMetrics.captureMethod,
        sampleCount: nicMetrics.sampleCount,
        rtpDrops: Number.isFinite(nicMetrics.rtpDrops) ? nicMetrics.rtpDrops : null,
        rtpOutOfOrder: Number.isFinite(nicMetrics.rtpOutOfOrder) ? nicMetrics.rtpOutOfOrder : null,
        network: nicMetrics.network || null,
        rtpSequence: nicMetrics.rtpSequence || null,
      };
    } else if (tsduckData && tsduckData.arrivalMetrics) {
      next.dvb.arrival = {
        ...tsduckData.arrivalMetrics,
        captureMethod: 'tsduck',
      };
    }
    return next;
  }

  _extractTSDuckBitrateBps(raw) {
    const candidates = [];
    const push = (v, score = 1) => {
      const bps = this._parseBitrateValue(v);
      if (bps && Number.isFinite(bps) && bps > 0) candidates.push({ bps, score });
    };

    const walk = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => walk(v, `${path}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        const key = String(k).toLowerCase();
        const p = `${path}.${key}`;
        if (key.includes('bitrate')) {
          let score = 1;
          if (/(transport|overall|total|global|ts)/i.test(key) || /(transport|overall|total|global|\.ts\.)/i.test(p)) {
            score = 3;
          } else if (/(service|program|pid|stream)/i.test(p)) {
            score = 0;
          }
          if (score > 0) push(v, score);
        }
        walk(v, p);
      }
    };
    walk(raw, 'root');
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.score - a.score) || (b.bps - a.bps));
    return candidates[0].bps;
  }

  _extractTSDuckServices(raw) {
    const out = [];
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v) && /services?/i.test(k)) {
          for (const svc of v) {
            if (!svc || typeof svc !== 'object') continue;
            const serviceId = this._parseInteger(svc.service_id ?? svc.serviceId ?? svc.id ?? svc.sid);
            if (serviceId == null) continue;
            out.push({
              serviceId,
              serviceName: svc.service_name || svc.serviceName || svc.name || null,
              serviceProvider: svc.service_provider || svc.provider || null,
              pmtPid: this._parseInteger(svc.pmt_pid ?? svc.pmtPid),
              pcrPid: this._parseInteger(svc.pcr_pid ?? svc.pcrPid),
            });
          }
        } else {
          walk(v);
        }
      }
    };
    walk(raw);
    return out;
  }

  _extractTSDuckPidRows(raw) {
    const out = [];
    const seen = new Set();
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach(walk);
        return;
      }
      const maybePid = this._parseInteger(obj.pid ?? obj.PID ?? obj.id);
      if (maybePid != null && maybePid >= 0 && maybePid <= 8191) {
        if (!seen.has(maybePid)) {
          seen.add(maybePid);
          out.push({
            pid: maybePid,
            streamType: obj.stream_type || obj.streamType || obj.type || null,
            codecType: obj.codec_type || obj.codecType || null,
            codecName: obj.codec_name || obj.codecName || null,
            language: obj.language || obj.lang || null,
            bitrate: this._parseBitrateValue(obj.bitrate ?? obj.bitrate_bps ?? obj.bit_rate),
          });
        }
      }
      Object.values(obj).forEach(walk);
    };
    walk(raw);
    return out;
  }

  _extractTSDuckSIIntervalsSec(raw) {
    const out = { nit: null, sdt: null, eitPf: null, tdt: null };
    const unitToSec = (v, unitHint = '') => {
      if (v == null) return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return null;
      const u = String(unitHint || '').toLowerCase();
      if (u.includes('ms') || u.includes('msec') || u.includes('millisecond')) return n / 1000;
      if (u.includes('us') || u.includes('micro')) return n / 1e6;
      return n;
    };
    const visitObj = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => visitObj(v, `${path}[${i}]`));
        return;
      }
      const keys = Object.keys(obj);
      for (const k of keys) {
        const v = obj[k];
        const key = String(k).toLowerCase();
        const p = `${path}.${key}`;
        if (typeof v === 'number' || typeof v === 'string') {
          const isInterval = /(interval|period|repetition|cycle)/i.test(key) || /(interval|period|repetition|cycle)/i.test(p);
          if (!isInterval) continue;
          let unitHint = key;
          if (obj.unit) unitHint += ` ${obj.unit}`;
          if (obj.units) unitHint += ` ${obj.units}`;
          if (obj.time_unit) unitHint += ` ${obj.time_unit}`;
          const sec = unitToSec(v, unitHint);
          if (sec == null) continue;
          if ((/nit/i.test(p) || /nit/i.test(key)) && out.nit == null) out.nit = sec;
          if ((/sdt/i.test(p) || /sdt/i.test(key)) && out.sdt == null) out.sdt = sec;
          if ((/eit/i.test(p) || /eit/i.test(key)) && (/pf|present|following/i.test(p) || /pf/i.test(key)) && out.eitPf == null) out.eitPf = sec;
          if ((/tdt/i.test(p) || /tdt/i.test(key)) && out.tdt == null) out.tdt = sec;
        } else {
          visitObj(v, p);
        }
      }
    };
    visitObj(raw, 'root');
    if (out.nit == null && out.sdt == null && out.eitPf == null && out.tdt == null) return null;
    return out;
  }

  _extractTSDuckArrivalMetrics(raw) {
    const metrics = {
      iatMs: { min: null, max: null, avg: null, p95: null },
      jitterMs: null,
      packetLossPct: null,
    };
    const setIfNull = (container, key, value) => {
      if (container[key] == null && value != null && Number.isFinite(value)) container[key] = value;
    };
    const parseNumber = (v) => {
      if (v == null) return null;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const m = String(v).match(/-?[\d.]+/);
      if (!m) return null;
      const n = parseFloat(m[0]);
      return Number.isFinite(n) ? n : null;
    };
    const maybeMs = (v, unitHint = '') => {
      const n = parseNumber(v);
      if (n == null) return null;
      const u = String(unitHint || '').toLowerCase();
      if (u.includes('us') || u.includes('micro')) return n / 1000;
      if (u.includes('s') && !u.includes('ms')) return n * 1000;
      return n;
    };
    const visit = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => visit(v, `${path}[${i}]`));
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        const key = String(k).toLowerCase();
        const p = `${path}.${key}`;
        if (typeof v === 'number' || typeof v === 'string') {
          const unitHint = `${key} ${obj.unit || ''} ${obj.units || ''} ${obj.time_unit || ''}`;
          if (/jitter/.test(key) || /jitter/.test(p)) setIfNull(metrics, 'jitterMs', maybeMs(v, unitHint));
          if (/packet.*loss/.test(key) || /loss.*pct/.test(key) || /loss/.test(p)) setIfNull(metrics, 'packetLossPct', parseNumber(v));
          if (/(iat|inter.?packet.?arrival)/.test(key) || /(iat|inter.?packet.?arrival)/.test(p)) {
            if (/min/.test(key) || /\.min/.test(p)) setIfNull(metrics.iatMs, 'min', maybeMs(v, unitHint));
            else if (/max/.test(key) || /\.max/.test(p)) setIfNull(metrics.iatMs, 'max', maybeMs(v, unitHint));
            else if (/p95|95/.test(key) || /p95|95/.test(p)) setIfNull(metrics.iatMs, 'p95', maybeMs(v, unitHint));
            else if (/avg|mean/.test(key) || /avg|mean/.test(p)) setIfNull(metrics.iatMs, 'avg', maybeMs(v, unitHint));
          }
        } else {
          visit(v, p);
        }
      }
    };
    visit(raw, 'root');
    const hasIat = Object.values(metrics.iatMs).some((v) => v != null);
    if (!hasIat && metrics.jitterMs == null && metrics.packetLossPct == null) return null;
    return metrics;
  }

  _parseBitrateValue(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1000 ? Math.round(raw) : null;
    const str = String(raw).trim();
    if (!str || /^n\/a$/i.test(str)) return null;
    const m = str.match(/([\d.]+)\s*([kmg]?)(?:bits?\/s|bps)?/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = (m[2] || '').toLowerCase();
    let mult = 1;
    if (unit === 'k') mult = 1e3;
    if (unit === 'm') mult = 1e6;
    if (unit === 'g') mult = 1e9;
    return Math.round(n * mult);
  }

  _parseInteger(raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    const str = String(raw).trim();
    if (!str) return null;
    if (/^0x[0-9a-f]+$/i.test(str)) return parseInt(str, 16);
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    const m = str.match(/0x([0-9a-f]+)/i);
    if (m) return parseInt(m[1], 16);
    const d = str.match(/\d+/);
    return d ? parseInt(d[0], 10) : null;
  }

  _probeStreamPidsFromFfmpeg() {
    // Single consolidated PID probe path:
    // 1) ffprobe on original URL
    // 2) for RTP only, fallback ffprobe on equivalent UDP with forced mpegts demux
    // Then return both pid-by-index map and parsed stream rows for row-level backfill.
    const tryFfprobeStreams = (url, extraArgs = []) => new Promise((resolve) => {
      const args = [
        '-v', 'quiet',
        '-analyzeduration', '5000000',
        '-probesize', '5000000',
        ...extraArgs,
        '-print_format', 'json',
        '-show_streams',
        url,
      ];
      const proc = spawn('ffprobe', args);
      let stdout = '';
      const killTimer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 9000);
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('error', () => { clearTimeout(killTimer); resolve([]); });
      proc.on('exit', () => {
        clearTimeout(killTimer);
        try {
          const parsed = JSON.parse(stdout);
          const rows = (parsed.streams || [])
            .map((s) => this._mapStream(s))
            .filter((s) => s && s.pid != null);
          return resolve(rows);
        } catch (_) {
          return resolve([]);
        }
      });
    });

    const primaryUrl = this._withLiveInputHints(this.url);
    return tryFfprobeStreams(primaryUrl).then((rows) => {
      if (rows.length > 0) return this._buildPidProbeResult(rows);
      if (this._isRtpUrl(this.url)) {
        const udpUrl = this._withLiveInputHints(this._rtpToUdpUrl(this.url) || '');
        if (udpUrl) {
          return tryFfprobeStreams(udpUrl, ['-fflags', '+discardcorrupt', '-f', 'mpegts'])
            .then((udpRows) => this._buildPidProbeResult(udpRows));
        }
      }
      return this._buildPidProbeResult([]);
    });
  }

  _buildPidProbeResult(rows) {
    const cleanRows = Array.isArray(rows) ? rows.filter((r) => r && r.pid != null) : [];
    const pidByIndex = {};
    const rowByIndex = {};
    cleanRows.forEach((r) => {
      if (typeof r.index === 'number' && r.pid != null) {
        pidByIndex[r.index] = r.pid;
        rowByIndex[r.index] = r;
      }
    });
    return { pidByIndex, rowByIndex, rows: cleanRows };
  }

  _applyPidMap(result, pidProbe) {
    if (!result || !pidProbe || typeof pidProbe !== 'object') return result;
    const hasWrappedProbe = Object.prototype.hasOwnProperty.call(pidProbe, 'pidByIndex');
    const pidMap = hasWrappedProbe ? (pidProbe.pidByIndex || {}) : pidProbe;
    const rowByIndex = hasWrappedProbe ? (pidProbe.rowByIndex || {}) : {};
    if (Object.keys(pidMap).length === 0) return result;
    const sameCodecFamily = (a, b) => {
      const ta = String(a || '').toLowerCase();
      const tb = String(b || '').toLowerCase();
      if (!ta || !tb) return true;
      return ta === tb;
    };
    const patchStream = (s) => {
      if (!s) return s;
      if (s.pid != null) return s;
      const pid = pidMap[s.index];
      if (pid == null) return s;
      const ref = rowByIndex[s.index] || null;
      // Prevent PID shuffling: only trust index mapping when stream family matches.
      if (ref && !sameCodecFamily(s.codecType, ref.codecType)) return s;
      return {
        ...s,
        pid,
        pidHex: `0x${Number(pid).toString(16).toUpperCase().padStart(4, '0')}`,
      };
    };
    const programs = (result.programs || []).map((p) => ({
      ...p,
      streams: (p.streams || []).map(patchStream),
    }));
    const orphanStreams = (result.orphanStreams || []).map(patchStream);
    const streamIndexes = new Set(
      programs.flatMap((p) => (p.streams || []).map((s) => s.index)).concat(orphanStreams.map((s) => s.index))
    );
    for (const [rawIdx, rawPid] of Object.entries(pidMap)) {
      const idx = parseInt(rawIdx, 10);
      const pid = Number(rawPid);
      if (!Number.isFinite(idx) || !Number.isFinite(pid)) continue;
      if (streamIndexes.has(idx)) continue;
      orphanStreams.push({
        index: idx,
        codecType: 'data',
        codecName: 'unknown',
        pid,
        pidHex: `0x${Number(pid).toString(16).toUpperCase().padStart(4, '0')}`,
        streamType: null,
        width: null,
        height: null,
        fps: null,
        bitrate: null,
        sampleRate: null,
        channels: null,
        language: null,
        colorSpace: null,
        colorTrc: null,
        colorPrimaries: null,
      });
    }
    const allStreams = programs.flatMap(p => p.streams).concat(orphanStreams);
    const pidCount = allStreams.filter(s => s.pid != null).length;
    return {
      ...result,
      programs,
      orphanStreams,
      dvb: {
        ...(result.dvb || {}),
        pidCount,
      },
    };
  }

  _applyFallbackPidRows(result, fallbackRows) {
    if (!result || !Array.isArray(fallbackRows) || fallbackRows.length === 0) return result;
    const programs = (result.programs || []).map((p) => ({ ...p, streams: [...(p.streams || [])] }));
    const orphanStreams = [...(result.orphanStreams || [])];
    const allExisting = programs.flatMap((p) => p.streams).concat(orphanStreams);
    const used = new Set(allExisting.map((s) => s.pid).filter((v) => v != null));
    const candidates = fallbackRows.filter((r) => r && r.pid != null && !used.has(r.pid));
    // Keep fallback rows non-destructive: append verified PID rows instead of
    // rebinding unknown streams with codec-based heuristics.
    for (const row of candidates) {
      if (used.has(row.pid)) continue;
      used.add(row.pid);
      orphanStreams.push({
        index: typeof row.index === 'number' ? row.index : `fallback-${row.pid}`,
        codecType: row.codecType || 'data',
        codecName: row.codecName || 'unknown',
        pid: row.pid,
        pidHex: row.pidHex || `0x${Number(row.pid).toString(16).toUpperCase().padStart(4, '0')}`,
        streamType: row.streamType || null,
        width: null,
        height: null,
        fps: null,
        bitrate: row.bitrate || null,
        sampleRate: null,
        channels: null,
        language: row.language || null,
        colorSpace: null,
        colorTrc: null,
        colorPrimaries: null,
      });
    }
    const allStreams = programs.flatMap((p) => p.streams).concat(orphanStreams);
    const pidCount = allStreams.filter((s) => s.pid != null).length;
    return {
      ...result,
      programs,
      orphanStreams,
      dvb: {
        ...(result.dvb || {}),
        pidCount,
      },
    };
  }

  _normalizeAndSortResult(result) {
    if (!result) return result;
    const typeOrder = { video: 0, audio: 1, subtitle: 2, data: 3, unknown: 9 };
    const normType = (v) => {
      const t = String(v || '').toLowerCase();
      if (!t) return 'unknown';
      if (t === 'video' || t === 'audio' || t === 'data' || t === 'subtitle') return t;
      return 'unknown';
    };
    const pidNum = (s) => (Number.isFinite(Number(s?.pid)) ? Number(s.pid) : Number.POSITIVE_INFINITY);
    const cmpStream = (a, b) => {
      const ta = typeOrder[normType(a?.codecType)] ?? 9;
      const tb = typeOrder[normType(b?.codecType)] ?? 9;
      if (ta !== tb) return ta - tb;
      const pa = pidNum(a);
      const pb = pidNum(b);
      if (pa !== pb) return pa - pb;
      const ca = String(a?.codecName || '').toLowerCase();
      const cb = String(b?.codecName || '').toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      const ia = Number.isFinite(Number(a?.index)) ? Number(a.index) : Number.POSITIVE_INFINITY;
      const ib = Number.isFinite(Number(b?.index)) ? Number(b.index) : Number.POSITIVE_INFINITY;
      return ia - ib;
    };
    const dedupeAndSort = (rows) => {
      const map = new Map();
      (rows || []).forEach((s) => {
        if (!s) return;
        const t = normType(s.codecType);
        const pidKey = Number.isFinite(Number(s.pid))
          ? String(Number(s.pid))
          : String(s.pidHex || `idx-${s.index ?? 'na'}`).toUpperCase();
        const codecKey = String(s.codecName || '').toLowerCase();
        const key = `${pidKey}|${t}|${codecKey}`;
        if (!map.has(key)) map.set(key, { ...s, codecType: t });
      });
      return Array.from(map.values()).sort(cmpStream);
    };

    const programs = [...(result.programs || [])]
      .map((p) => ({
        ...p,
        streams: dedupeAndSort(p.streams || []),
      }))
      .sort((a, b) => {
        const pa = Number.isFinite(Number(a?.programId)) ? Number(a.programId) : Number.POSITIVE_INFINITY;
        const pb = Number.isFinite(Number(b?.programId)) ? Number(b.programId) : Number.POSITIVE_INFINITY;
        if (pa !== pb) return pa - pb;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });
    const orphanStreams = dedupeAndSort(result.orphanStreams || []);
    return {
      ...result,
      programs,
      orphanStreams,
    };
  }

  _withLiveInputHints(url) {
    if (!url) return url;
    if (!(url.startsWith('udp://') || url.startsWith('rtp://'))) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}fifo_size=${LIVE_INPUT_HINTS.fifoSize}&overrun_nonfatal=1&timeout=${LIVE_INPUT_HINTS.timeoutUs}&reorder_queue_size=${LIVE_INPUT_HINTS.reorderQueueSize}`;
  }

  _isLiveInputHintMemoryError(err) {
    const msg = String((err && err.message) || '').toLowerCase();
    return msg.includes('cannot allocate memory') || msg.includes('enomem');
  }

  _isRtpUrl(url) {
    return typeof url === 'string' && url.startsWith('rtp://');
  }

  _rtpToUdpUrl(url) {
    if (!this._isRtpUrl(url)) return null;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname;
      const port = parsed.port;
      if (!host || !port) return null;
      return `udp://${host}:${port}`;
    } catch (_) {
      const m = String(url).match(/^rtp:\/\/([^/:?#]+):(\d+)/i);
      if (!m) return null;
      return `udp://${m[1]}:${m[2]}`;
    }
  }

  _resolveCachedThumbnailUrl() {
    try {
      const p = path.join(THUMBNAIL_DIR, `${sanitizeStreamId(this.id)}.jpg`);
      if (!fs.existsSync(p)) return null;
      return `/logs/thumbnails/${sanitizeStreamId(this.id)}.jpg?t=${Date.now()}`;
    } catch (_) {
      return null;
    }
  }

  _buildSmpte20227Assessment(result) {
    const arrival = result?.dvb?.arrival || null;
    const seq = arrival?.rtpSequence || null;
    const packetLossPct = Number(arrival?.packetLossPct);
    const sampleCount = Number(arrival?.sampleCount || 0);
    const captureMethod = String(arrival?.captureMethod || '').toLowerCase();
    const isRtpInput = this._isRtpUrl(this.url);

    const assessment = {
      standard: 'SMPTE ST 2022-7',
      checked: false,
      compliant: null,
      state: isRtpInput ? 'insufficient_data' : 'not_applicable',
      reason: isRtpInput ? 'RTP sequence evidence unavailable' : 'Input is not RTP',
      metrics: {
        sampleCount: Number.isFinite(sampleCount) ? sampleCount : 0,
        packetLossPct: Number.isFinite(packetLossPct) ? packetLossPct : null,
        seqObserved: Boolean(seq?.observed),
        gapEvents: Number(seq?.gapEvents || 0),
        duplicateEvents: Number(seq?.duplicateEvents || 0),
        reorderedEvents: Number(seq?.reorderedEvents || 0),
        lastSeq: Number.isFinite(Number(seq?.lastSeq)) ? Number(seq.lastSeq) : null,
        captureMethod: arrival?.captureMethod || null,
      },
      thresholds: {
        minSamples: SMPTE_2022_7_THRESHOLDS.minSamples,
        maxLossPct: SMPTE_2022_7_THRESHOLDS.maxLossPct,
        maxGapEvents: SMPTE_2022_7_THRESHOLDS.maxGapEvents,
        maxDuplicateEvents: SMPTE_2022_7_THRESHOLDS.maxDuplicateEvents,
        maxReorderedEvents: SMPTE_2022_7_THRESHOLDS.maxReorderedEvents,
        requireNicCapture: SMPTE_2022_7_THRESHOLDS.requireNicCapture,
      },
    };

    if (!isRtpInput) return assessment;
    if (!seq || !seq.observed) return assessment;
    if (SMPTE_2022_7_THRESHOLDS.requireNicCapture && captureMethod !== 'tshark') {
      return {
        ...assessment,
        checked: true,
        compliant: null,
        state: 'insufficient_data',
        reason: 'NIC RTP-sequence capture not available (tshark required)',
      };
    }
    if (!Number.isFinite(sampleCount) || sampleCount < SMPTE_2022_7_THRESHOLDS.minSamples) {
      return {
        ...assessment,
        checked: true,
        compliant: null,
        state: 'insufficient_data',
        reason: `Insufficient RTP sample window (${sampleCount || 0} < ${SMPTE_2022_7_THRESHOLDS.minSamples})`,
      };
    }

    const loss = Number.isFinite(packetLossPct) ? packetLossPct : 0;
    const gapEvents = Number(seq.gapEvents || 0);
    const duplicateEvents = Number(seq.duplicateEvents || 0);
    const reorderedEvents = Number(seq.reorderedEvents || 0);
    const compliant = (
      loss <= SMPTE_2022_7_THRESHOLDS.maxLossPct &&
      gapEvents <= SMPTE_2022_7_THRESHOLDS.maxGapEvents &&
      duplicateEvents <= SMPTE_2022_7_THRESHOLDS.maxDuplicateEvents &&
      reorderedEvents <= SMPTE_2022_7_THRESHOLDS.maxReorderedEvents
    );

    return {
      ...assessment,
      checked: true,
      compliant,
      state: compliant ? 'compliant' : 'non_compliant',
      reason: compliant
        ? 'RTP sequence continuity and loss are within 2022-7 consolidation thresholds'
        : 'RTP sequence/loss exceed 2022-7 consolidation thresholds',
    };
  }

  _attachHealthAssessment(result) {
    if (!result || !result.dvb) return result;
    const assessment = this._buildHealthAssessment(result);
    return {
      ...result,
      dvb: {
        ...result.dvb,
        health: assessment,
      },
    };
  }

  _buildHealthAssessment(result) {
    const dvb = result?.dvb || {};
    const audio = result?.audioLevels || null;
    const dolbyRequiredWhenDetected = String(process.env.DOLBYE_REQUIRED_WHEN_DETECTED || 'false').toLowerCase() === 'true';
    const scoreParts = [];
    const reasons = [];
    const pushPenalty = (points, reason) => {
      scoreParts.push({ type: 'penalty', points: Math.max(0, points), reason });
      if (reason) reasons.push(reason);
    };
    const pushBonus = (points) => {
      scoreParts.push({ type: 'bonus', points: Math.max(0, points), reason: null });
    };

    const source = String(dvb.bitrateSource || '').toLowerCase();
    const sourceConfidenceMap = {
      tsduck: 1.0,
      measured: 0.85,
      format: 0.65,
      streams: 0.55,
    };
    const sourceConfidence = sourceConfidenceMap[source] || 0.4;
    if (source === 'tsduck') pushBonus(2);
    if (source === 'measured') pushBonus(1);
    if (source === 'format') pushPenalty(8, 'Bitrate derived from container metadata only');
    if (source === 'streams') pushPenalty(10, 'Bitrate estimated from elementary streams only');
    if (!source) pushPenalty(12, 'Bitrate source unavailable');

    const bitrateBps = Number(dvb.bitrateBps || 0);
    if (!Number.isFinite(bitrateBps) || bitrateBps <= 0) {
      pushPenalty(16, 'No reliable transport bitrate detected');
    }

    const serviceCount = Number(dvb.serviceCount || 0);
    const pidCount = Number(dvb.pidCount || 0);
    if (serviceCount <= 0) pushPenalty(14, 'No DVB services detected');
    if (pidCount <= 0) pushPenalty(14, 'No PID inventory detected');
    if (pidCount > 0 && serviceCount > 0 && pidCount < (serviceCount * 2)) {
      pushPenalty(6, 'Low PID/service ratio suggests partial PSI/ES visibility');
    }

    const siCompliance = dvb?.si?.compliance || null;
    if (siCompliance) {
      if (siCompliance.nit === false) pushPenalty(8, 'NIT repetition out of DVB target');
      if (siCompliance.sdt === false) pushPenalty(8, 'SDT repetition out of DVB target');
      if (siCompliance.eitPf === false) pushPenalty(8, 'EIT p/f repetition out of DVB target');
      if (siCompliance.tdt === false) pushPenalty(6, 'TDT repetition out of DVB target');
    }

    const arrival = dvb.arrival || null;
    if (arrival) {
      const lossPct = Number(arrival.packetLossPct);
      if (Number.isFinite(lossPct)) {
        if (lossPct >= HEALTH_THRESHOLDS.lossCriticalPct) pushPenalty(28, `Packet loss ${lossPct}% exceeds critical threshold`);
        else if (lossPct > HEALTH_THRESHOLDS.lossWarnPct) pushPenalty(12, `Packet loss ${lossPct}% exceeds warning threshold`);
      }
      const jitterMs = Number(arrival.jitterMs);
      if (Number.isFinite(jitterMs)) {
        if (jitterMs >= HEALTH_THRESHOLDS.jitterCriticalMs) pushPenalty(20, `Jitter ${jitterMs} ms exceeds critical threshold`);
        else if (jitterMs >= HEALTH_THRESHOLDS.jitterWarnMs) pushPenalty(8, `Jitter ${jitterMs} ms exceeds warning threshold`);
      }
      const iatP95 = Number(arrival?.iatMs?.p95);
      if (Number.isFinite(iatP95)) {
        if (iatP95 >= HEALTH_THRESHOLDS.iatP95CriticalMs) pushPenalty(18, `IAT p95 ${iatP95} ms exceeds critical threshold`);
        else if (iatP95 >= HEALTH_THRESHOLDS.iatP95WarnMs) pushPenalty(8, `IAT p95 ${iatP95} ms exceeds warning threshold`);
      }
      const captureMethod = String(arrival.captureMethod || '').toLowerCase();
      if (captureMethod !== 'tshark' && captureMethod !== 'tcpdump') {
        pushPenalty(4, 'Arrival telemetry is analyser-derived, not NIC-captured');
      }
    } else {
      pushPenalty(6, 'Arrival telemetry unavailable');
    }

    const meanDb = Number(audio?.meanDb);
    if (Number.isFinite(meanDb)) {
      if (meanDb > -6) pushPenalty(8, `Audio mean level ${meanDb.toFixed(1)} dBFS indicates clipping risk`);
      if (meanDb < -50) pushPenalty(6, `Audio mean level ${meanDb.toFixed(1)} dBFS indicates near-silence`);
    }

    const tsDisc = dvb.timestampDiscontinuity || null;
    const tsDiscCount = Number(tsDisc?.count || 0);
    if (Number.isFinite(tsDiscCount) && tsDiscCount >= HEALTH_THRESHOLDS.tsDiscCriticalCount) {
      pushPenalty(24, `Timestamp discontinuities ${tsDiscCount} exceed critical threshold`);
    } else if (Number.isFinite(tsDiscCount) && tsDiscCount >= HEALTH_THRESHOLDS.tsDiscWarnCount) {
      pushPenalty(10, `Timestamp discontinuities ${tsDiscCount} exceed warning threshold`);
    }

    const cc = dvb.continuityCounterErrors || null;
    const ccCount = Number(cc?.count || 0);
    if (Number.isFinite(ccCount) && ccCount >= HEALTH_THRESHOLDS.ccCriticalCount) {
      pushPenalty(24, `CC errors ${ccCount} exceed critical threshold`);
    } else if (Number.isFinite(ccCount) && ccCount >= HEALTH_THRESHOLDS.ccWarnCount) {
      pushPenalty(10, `CC errors ${ccCount} exceed warning threshold`);
    }

    const smpte20227 = dvb.smpte20227 || null;
    if (smpte20227?.checked === true && smpte20227?.state === 'non_compliant') {
      pushPenalty(18, `SMPTE ST 2022-7 non-compliant: ${smpte20227.reason || 'RTP sequence/loss out of bounds'}`);
    } else if (smpte20227?.state === 'insufficient_data') {
      pushPenalty(4, `SMPTE ST 2022-7 not fully verified: ${smpte20227.reason || 'insufficient RTP sequence evidence'}`);
    }

    const dolbyE = dvb.dolbyE || null;
    const dolbyEnabled = DolbyEAdapter.isEnabled();
    const dolbyDetected = Boolean(dolbyE?.detected);
    const dolbyDecoded = Boolean(dolbyE?.decoded);
    const dolbyAvailable = Boolean(dolbyE?.available);
    if (dolbyEnabled && dolbyDetected) {
      if (dolbyRequiredWhenDetected && !dolbyAvailable) {
        pushPenalty(HEALTH_THRESHOLDS.dolbyEMissingPenalty, 'Dolby E detected but external decoder is unavailable');
      } else if (!dolbyDecoded) {
        pushPenalty(HEALTH_THRESHOLDS.dolbyEDecodeFailurePenalty, 'Dolby E detected but decode failed');
      } else {
        pushBonus(2);
      }
    }

    let score = 100;
    for (const part of scoreParts) {
      if (part.type === 'penalty') score -= part.points;
      if (part.type === 'bonus') score += part.points;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const severity = score >= HEALTH_THRESHOLDS.scoreOk
      ? 'ok'
      : score >= HEALTH_THRESHOLDS.scoreWarning
        ? 'warning'
        : 'critical';

    return {
      score,
      severity,
      reasons: reasons.slice(0, 8),
      sourceConfidence: Number(sourceConfidence.toFixed(2)),
      bitrateSource: source || null,
      timestampDiscontinuityCount: Number.isFinite(tsDiscCount) ? tsDiscCount : 0,
      continuityCounterErrorCount: Number.isFinite(ccCount) ? ccCount : 0,
      smpte20227: {
        checked: Boolean(smpte20227?.checked),
        compliant: smpte20227?.compliant == null ? null : Boolean(smpte20227.compliant),
        state: smpte20227?.state || null,
      },
      dolbyE: {
        enabled: dolbyEnabled,
        requiredWhenDetected: dolbyRequiredWhenDetected,
        detected: dolbyDetected,
        decoded: dolbyDecoded,
      },
      thresholds: {
        scoreWarning: HEALTH_THRESHOLDS.scoreWarning,
        scoreOk: HEALTH_THRESHOLDS.scoreOk,
        lossWarnPct: HEALTH_THRESHOLDS.lossWarnPct,
        lossCriticalPct: HEALTH_THRESHOLDS.lossCriticalPct,
        jitterWarnMs: HEALTH_THRESHOLDS.jitterWarnMs,
        jitterCriticalMs: HEALTH_THRESHOLDS.jitterCriticalMs,
        iatP95WarnMs: HEALTH_THRESHOLDS.iatP95WarnMs,
        iatP95CriticalMs: HEALTH_THRESHOLDS.iatP95CriticalMs,
        tsDiscWarnCount: HEALTH_THRESHOLDS.tsDiscWarnCount,
        tsDiscCriticalCount: HEALTH_THRESHOLDS.tsDiscCriticalCount,
        ccWarnCount: HEALTH_THRESHOLDS.ccWarnCount,
        ccCriticalCount: HEALTH_THRESHOLDS.ccCriticalCount,
        dolbyEMissingPenalty: HEALTH_THRESHOLDS.dolbyEMissingPenalty,
        dolbyEDecodeFailurePenalty: HEALTH_THRESHOLDS.dolbyEDecodeFailurePenalty,
      },
      assessedAt: Date.now(),
    };
  }

  startContinuous() {
    if (this.isRunning) return;
    this.isRunning = true;
    if (!this._iatSniffer) {
      this._iatSniffer = new IATSniffer({ id: `${this.id}-iat`, url: this.url, nicName: this.nicName });
      // Safety net: absorb any 'error' events so Node.js doesn't throw them as
      // uncaught exceptions. IATSniffer failures are non-fatal; probe() reads lastError.
      this._iatSniffer.on('error', (err) => {
        this.emit('info', { message: `IAT sniffer unavailable: ${err.message}` });
      });
      this._iatSniffer.start();
    }

    // Independent thumbnail timer — runs in parallel with the analysis loop so
    // thumbnail refresh rate is not bottlenecked by the (slow) sub-probes.
    const thumbIntervalMs = Math.max(1000, (parseInt(process.env.THUMBNAIL_INTERVAL_SEC, 10) || 5) * 1000);
    const runThumbnail = async () => {
      if (!this.isRunning) return;
      if (!this._thumbnailCapturing) {
        this._thumbnailCapturing = true;
        try {
          await captureThumbnail(this.id, this.url);
          this._lastThumbnailUrl = `/logs/thumbnails/${sanitizeStreamId(this.id)}.jpg?t=${Date.now()}`;
        } catch (_) {
          // Keep existing URL on failure; will retry next cycle.
          if (!this._lastThumbnailUrl) {
            const cached = this._resolveCachedThumbnailUrl();
            if (cached) this._lastThumbnailUrl = cached;
          }
        } finally {
          this._thumbnailCapturing = false;
        }
      }
      if (this.isRunning) {
        this._thumbnailTimer = setTimeout(runThumbnail, thumbIntervalMs);
      }
    };
    const phaseSeed = String(this.id || '');
    const phaseHash = phaseSeed.split('').reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) >>> 0, 0);
    // Stagger startup across analysers to avoid ffprobe/ffmpeg thundering herd
    // when many decoders are started in batch.
    const probeStartJitterMs = Math.min(
      Math.max(200, Math.floor(this.interval * 0.6)),
      2000
    ) > 0
      ? (phaseHash % Math.min(Math.max(200, Math.floor(this.interval * 0.6)), 2000))
      : 0;
    const thumbStartJitterMs = thumbIntervalMs > 0 ? (phaseHash % Math.min(thumbIntervalMs, 1500)) : 0;

    // First thumbnail fires quickly but with small jitter to smooth burst starts.
    if (this._thumbnailTimer) clearTimeout(this._thumbnailTimer);
    this._thumbnailTimer = setTimeout(runThumbnail, thumbStartJitterMs);

    const run = async () => {
      const startedAt = Date.now();
      try {
        await this.probe({ continuous: true });
      } catch (err) {
        this.emit('error', err);
      }
      if (this.isRunning) {
        const elapsed = Date.now() - startedAt;
        const delay = Math.max(250, this.interval - elapsed);
        this._timer = setTimeout(run, delay);
      }
    };

    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(run, probeStartJitterMs);
    this.emit('started', { id: this.id });
    return this;
  }

  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._thumbnailTimer) {
      clearTimeout(this._thumbnailTimer);
      this._thumbnailTimer = null;
    }
    if (this._iatSniffer) {
      this._iatSniffer.stop();
      this._iatSniffer = null;
    }
    this.emit('stopped', { id: this.id });
  }

  toJSON() {
    return {
      id: this.id,
      url: this.url,
      isRunning: this.isRunning,
      lastResult: this.lastResult,
    };
  }
}

module.exports = TSAnalyser;
module.exports._getNicName = _getNicName;
module.exports._resetNicNameCache = () => { _multicastConfig = null; };
