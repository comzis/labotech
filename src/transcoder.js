'use strict';

const SRTEncoder = require('./encoder');

// PAL/NTSC/HFR interlacing presets
const INTERLACE_PRESETS = {
  // Progressive PAL → Interlaced PAL
  'pal': {
    name: '1080p25 → 1080i50 (PAL)',
    inputFps: 25,
    outputFps: 50,
    interlaced: true,
    videoFilter: 'interlace=scan=tff:lowpass=1',
    fieldOrder: 'tt',
  },
  // Progressive NTSC → Interlaced NTSC
  'ntsc': {
    name: '1080p29.97 → 1080i59.94 (NTSC)',
    inputFps: 29.97,
    outputFps: 59.94,
    interlaced: true,
    videoFilter: 'interlace=scan=tff:lowpass=1',
    fieldOrder: 'tt',
  },
  // HFR PAL → Interlaced PAL
  'hfr-pal': {
    name: '1080p50 → 1080i50 (HFR-PAL)',
    inputFps: 50,
    outputFps: 50,
    interlaced: true,
    videoFilter: 'interlace=scan=tff:lowpass=1',
    fieldOrder: 'tt',
  },
  // Interlaced PAL → Progressive (deinterlace/OTT)
  'deinterlace': {
    name: '1080i50 → 1080p25 (Deinterlace/OTT)',
    inputFps: 50,
    outputFps: 25,
    interlaced: false,
    videoFilter: 'yadif=mode=send_frame:parity=tff:deint=all',
    fieldOrder: null,
  },
};

class Transcoder extends SRTEncoder {
  constructor(options = {}) {
    super(options);
    this.transcodePreset = options.transcodePreset || 'pal';

    const preset = INTERLACE_PRESETS[this.transcodePreset];
    if (!preset) {
      throw new Error(
        `Unknown transcode preset: "${this.transcodePreset}". ` +
        `Valid: ${Object.keys(INTERLACE_PRESETS).join(', ')}`
      );
    }
    this._preset = preset;
  }

  buildFFmpegArgs() {
    const p = this._preset;
    const bitrateNum = parseInt(this.videoBitrate);
    const bufsize = isNaN(bitrateNum) ? this.videoBitrate : `${bitrateNum * 2}M`;

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-stats',
      ...this.buildInputArgs(),
      '-vf', p.videoFilter,
      '-c:v', this.videoCodec,
      '-preset', this.preset,
      '-b:v', this.videoBitrate,
      '-maxrate', this.videoBitrate,
      '-bufsize', bufsize,
      '-pix_fmt', 'yuv420p',
      '-flags', '+ildct+ilme',
    ];

    if (p.fieldOrder) {
      args.push('-field_order', p.fieldOrder);
    }

    if (p.interlaced) {
      args.push('-top', '1');
    }

    args.push(
      '-c:a', this.audioCodec,
      '-b:a', this.audioBitrate,
      '-f', 'mpegts',
      this.buildSRTUrl()
    );

    return args;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      transcodePreset: this.transcodePreset,
      presetName: this._preset.name,
    };
  }
}

Transcoder.PRESETS = INTERLACE_PRESETS;

module.exports = Transcoder;
