'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');

class TSAnalyser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id        = options.id || `analyser-${Date.now()}`;
    this.url       = options.url;
    this.interval  = options.interval || 5000; // ms between continuous probes

    this._timer    = null;
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

      proc.on('exit', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe exited ${code}: ${stderr.trim()}`));
        }
        try {
          const raw = JSON.parse(stdout);
          const result = this.parseStructure(raw);
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
    const programs = (raw.programs || []).map(prog => ({
      programId:  prog.program_id,
      pmtPid:     prog.pmt_pid,
      pcrPid:     prog.pcr_pid,
      name:       prog.tags && prog.tags['service_name'] || null,
      streams:    (prog.streams || []).map(s => this._mapStream(s)),
    }));

    // Streams not in any program
    const programStreamIds = new Set(
      programs.flatMap(p => p.streams.map(s => s.index))
    );
    const orphanStreams = (raw.streams || [])
      .filter(s => !programStreamIds.has(s.index))
      .map(s => this._mapStream(s));

    return {
      url:           this.url,
      probeTime:     Date.now(),
      programs,
      orphanStreams,
    };
  }

  _mapStream(s) {
    return {
      index:       s.index,
      codecType:   s.codec_type,
      codecName:   s.codec_name,
      pid:         s.id !== undefined ? s.id : null,
      width:       s.width  || null,
      height:      s.height || null,
      fps:         s.avg_frame_rate || null,
      bitrate:     s.bit_rate ? parseInt(s.bit_rate) : null,
      sampleRate:  s.sample_rate || null,
      channels:    s.channels || null,
      language:    s.tags && s.tags['language'] || null,
    };
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
      id:         this.id,
      url:        this.url,
      isRunning:  this.isRunning,
      lastResult: this.lastResult,
    };
  }
}

module.exports = TSAnalyser;
