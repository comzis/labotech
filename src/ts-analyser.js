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
  }

  probe() {
    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_programs',
        '-show_streams',
        '-show_format',
        this.url,
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
          const result = this.parseStructure(raw);
          result.audioLevels = await this._probeAudioLevels();
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
    const bitrateBps = formatBitrateBps && Number.isFinite(formatBitrateBps) && formatBitrateBps > 0
      ? formatBitrateBps
      : streamBitrateBps;

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

  startContinuous() {
    if (this.isRunning) return;
    this.isRunning = true;

    const run = async () => {
      try {
        await this.probe();
      } catch (err) {
        this.emit('error', err);
      }
      if (this.isRunning) {
        this._timer = setTimeout(run, this.interval);
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
