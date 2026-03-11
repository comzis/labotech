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
      // Merge with global stream entry by index so PID inventory remains complete.
      streams: (prog.streams || []).map((s) => this._mapStream({ ...(globalByIndex.get(s.index) || {}), ...s })),
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
    const bitrateBps = allStreams.reduce((acc, s) => acc + (s.bitrate || 0), 0);

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
      bitrate: s.bit_rate ? parseInt(s.bit_rate) : null,
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
    if (/^0x[0-9a-f]+$/i.test(str)) return parseInt(str, 16);
    if (/^[0-9]+$/.test(str)) return parseInt(str, 10);
    if (/^[0-9a-f]+$/i.test(str)) return parseInt(str, 16);
    return null;
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
