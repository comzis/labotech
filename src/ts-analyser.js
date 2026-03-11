'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { captureThumbnail } = require('./monitoring');

class TSAnalyser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `analyser-${Date.now()}`;
    this.url = options.url;
    this.interval = options.interval || 5000; // ms between continuous probes

    this._timer = null;
    this.isRunning = false;
    this.lastResult = null;
    this._continuousProbeCount = 0;
  }

  probe(options = {}) {
    const isContinuous = Boolean(options.continuous);
    if (isContinuous) this._continuousProbeCount += 1;
    // Heavy transport/tsduck probing is expensive on live multicast.
    // In continuous mode, run it every 3rd cycle to keep UI responsive.
    const runHeavyProbe = !isContinuous || (this._continuousProbeCount % 3 === 1);

    return new Promise((resolve, reject) => {
      const inputUrl = this._withLiveInputHints(this.url);
      const args = [
        '-v', 'quiet',
        '-analyzeduration', '7000000',
        '-probesize', '7000000',
        '-print_format', 'json',
        '-show_programs',
        '-show_streams',
        '-show_format',
        inputUrl,
      ];

      const proc = spawn('ffprobe', args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('exit', async (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe exited ${code}: ${stderr.trim()}`));
        }
        try {
          const raw = JSON.parse(stdout);
          let result = this.parseStructure(raw);
          // Some RTP/TS sources omit ids for all or part of program streams.
          // Always attempt PID backfill from ffmpeg banner lines and patch any gaps.
          const pidMap = await this._probeStreamPidsFromFfmpeg();
          result = this._applyPidMap(result, pidMap);
          const [tsduckData, measuredBitrateBps, audioLevels] = await Promise.all([
            runHeavyProbe ? this._probeTSDuck() : Promise.resolve(null),
            runHeavyProbe ? this._probeTransportBitrateBps() : Promise.resolve(null),
            this._probeAudioLevels(),
          ]);
          result = this._applyTSDuckData(result, tsduckData);
          if (measuredBitrateBps && measuredBitrateBps > 0) {
            result.dvb.measuredBitrateBps = measuredBitrateBps;
            // tsduck is preferred when available, otherwise use measured remux bitrate.
            if (!result.dvb.bitrateBps || result.dvb.bitrateSource !== 'tsduck') {
              result.dvb.bitrateBps = measuredBitrateBps;
              result.dvb.bitrateSource = 'measured';
            }
          }
          result.audioLevels = audioLevels;
          try {
            await captureThumbnail(this.id, this.url);
            result.thumbnailUrl = `/logs/thumbnails/${this.id}.jpg?t=${Date.now()}`;
          } catch (_) {
            // Thumbnail generation is best-effort for multiview cards.
          }
          this.lastResult = result;
          this.emit('result', result);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', reject);
    });
  }

  parseStructure(raw) {
    const globalByIndex = new Map((raw.streams || []).map((s) => [s.index, s]));
    const programs = (raw.programs || []).map(prog => ({
      programId: prog.program_id,
      pmtPid: prog.pmt_pid,
      pcrPid: prog.pcr_pid,
      name: prog.tags && prog.tags['service_name'] || null,
      provider: prog.tags && prog.tags['service_provider'] || null,
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
      const args = [
        '-hide_banner',
        '-nostats',
        '-loglevel', 'info',
        '-t', '1.0',
        '-i', this.url,
        '-vn',
        '-af', 'volumedetect',
        '-f', 'null',
        '-',
      ];

      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 3000);

      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      proc.on('exit', () => {
        clearTimeout(timeout);
        const mean = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/i);
        const max = stderr.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
        if (!mean && !max) return resolve(null);
        resolve({
          meanDb: mean ? parseFloat(mean[1]) : null,
          maxDb: max ? parseFloat(max[1]) : null,
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
          if (k === 'out_time_us') outTimeUs    = parseInt(v, 10)   || outTimeUs;
          if (k === 'out_time_ms') outTimeUs    = parseInt(v, 10)   || outTimeUs; // also µs in FFmpeg
          if (k === 'bitrate') {
            // "bitrate=21234.6kbits/s"  or  "bitrate=N/A"
            const m = v.match(/([\d.]+)\s*kbits/i);
            if (m) progressKbps = parseFloat(m[1]) || progressKbps;
          }
        }

        // Primary: size/time calculation (most accurate for MPEG-TS remux)
        if (totalSize > 0 && outTimeUs > 0) {
          const seconds = outTimeUs / 1e6;
          if (Number.isFinite(seconds) && seconds > 0) {
            const bps = Math.round((totalSize * 8) / seconds);
            if (Number.isFinite(bps) && bps > 0) return resolve(bps);
          }
        }
        // Fallback: bitrate= field reported directly by FFmpeg
        if (progressKbps > 0) return resolve(Math.round(progressKbps * 1000));
        resolve(null);
      });
    });
  }

  _probeTSDuck() {
    return new Promise((resolve) => {
      const inputUrl = this._withLiveInputHints(this.url);
      const args = ['--json', '--input-timeout', '3000', inputUrl];
      const proc = spawn('tsanalyze', args);
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 7000);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 || !stdout.trim()) return resolve(null);
        try {
          const raw = JSON.parse(stdout);
          const bitrateBps = this._extractTSDuckBitrateBps(raw);
          const services = this._extractTSDuckServices(raw);
          const pids = this._extractTSDuckPidRows(raw);
          const siIntervalsSec = this._extractTSDuckSIIntervalsSec(raw);
          const arrivalMetrics = this._extractTSDuckArrivalMetrics(raw);
          resolve({
            bitrateBps,
            services,
            pids,
            siIntervalsSec,
            arrivalMetrics,
            stderr: stderr.trim() || null,
          });
        } catch (_) {
          resolve(null);
        }
      });
    });
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
      fps: s.avg_frame_rate || null,
      bitrate: this._parseBitrate(s.bit_rate),
      sampleRate: s.sample_rate || null,
      channels: s.channels || null,
      language: s.tags && s.tags['language'] || null,
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

  _mergeStreamInfo(globalStream, programStream) {
    const g = globalStream || {};
    const p = programStream || {};
    const merged = { ...g, ...p };

    const pPid = this._normalizePid(p.id);
    const gPid = this._normalizePid(g.id);
    merged.id = pPid != null ? p.id : (gPid != null ? g.id : (p.id ?? g.id ?? null));

    const pBitrate = this._parseBitrate(p.bit_rate);
    const gBitrate = this._parseBitrate(g.bit_rate);
    merged.bit_rate = pBitrate != null ? p.bit_rate : (gBitrate != null ? g.bit_rate : (p.bit_rate ?? g.bit_rate ?? null));

    return merged;
  }

  _applyTSDuckData(result, tsduckData) {
    if (!result || !tsduckData) return result;
    const next = {
      ...result,
      programs: [...(result.programs || [])],
      orphanStreams: [...(result.orphanStreams || [])],
      dvb: { ...(result.dvb || {}) },
    };

    if (tsduckData.bitrateBps && tsduckData.bitrateBps > 0) {
      next.dvb.tsduckBitrateBps = tsduckData.bitrateBps;
      next.dvb.bitrateBps = tsduckData.bitrateBps;
      next.dvb.bitrateSource = 'tsduck';
    }

    if (Array.isArray(tsduckData.services) && tsduckData.services.length > 0) {
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

    if (Array.isArray(tsduckData.pids) && tsduckData.pids.length > 0) {
      const allExisting = next.programs.flatMap((p) => p.streams || []).concat(next.orphanStreams || []);
      const existingPidSet = new Set(allExisting.map((s) => s.pid).filter((v) => v != null));
      for (const row of tsduckData.pids) {
        if (row.pid == null || existingPidSet.has(row.pid)) continue;
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
    if (tsduckData.siIntervalsSec) {
      const si = tsduckData.siIntervalsSec;
      const compliance = {
        nit: si.nit != null ? si.nit <= 10 : null,
        sdt: si.sdt != null ? si.sdt <= 2 : null,
        eitPf: si.eitPf != null ? si.eitPf <= 2 : null,
        tdt: si.tdt != null ? si.tdt <= 30 : null,
      };
      next.dvb.si = { intervalsSec: si, compliance };
    }
    if (tsduckData.arrivalMetrics) {
      next.dvb.arrival = tsduckData.arrivalMetrics;
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
    return new Promise((resolve) => {
      const inputUrl = this._withLiveInputHints(this.url);
      const args = [
        '-hide_banner',
        '-loglevel', 'info',
        '-analyzeduration', '7000000',
        '-probesize', '7000000',
        '-t', '3.0',
        '-i', inputUrl,
        '-map', '0',
        '-f', 'null',
        '-',
      ];
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }, 9000);
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', () => {
        clearTimeout(timeout);
        resolve({});
      });
      proc.on('exit', () => {
        clearTimeout(timeout);
        const pidByIndex = {};
        const lines = stderr.split('\n');
        for (const line of lines) {
          // Example:
          // Stream #0:0[0x200]: Video: h264 ...
          // Alternative:
          // Stream #0:0(und): Video: ... [0x200]
          const m = line.match(/Stream #\d+:(\d+)\[0x([0-9a-f]+)\]/i)
            || line.match(/Stream #\d+:(\d+).*?\[0x([0-9a-f]+)\]/i);
          if (!m) continue;
          const idx = parseInt(m[1], 10);
          const pid = parseInt(m[2], 16);
          if (Number.isFinite(idx) && Number.isFinite(pid)) {
            pidByIndex[idx] = pid;
          }
        }
        resolve(pidByIndex);
      });
    });
  }

  _applyPidMap(result, pidMap) {
    if (!result || !pidMap || Object.keys(pidMap).length === 0) return result;
    const patchStream = (s) => {
      if (!s) return s;
      if (s.pid != null) return s;
      const pid = pidMap[s.index];
      if (pid == null) return s;
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

  _withLiveInputHints(url) {
    if (!url) return url;
    if (!(url.startsWith('udp://') || url.startsWith('rtp://'))) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}fifo_size=10000000&overrun_nonfatal=1&timeout=7000000`;
  }

  startContinuous() {
    if (this.isRunning) return;
    this.isRunning = true;

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

    run();
    this.emit('started', { id: this.id });
    return this;
  }

  stop() {
    this.isRunning = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
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
