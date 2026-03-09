'use strict';

const SRTEncoder = require('./encoder');
const BROADCAST_PRESETS = require('../config/presets.json');

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
    // Merge broadcast preset if slot is provided
    let mergedOptions = { ...options };
    if (options.broadcastPresetSlot) {
      const slotData = BROADCAST_PRESETS.slots.find(s => s.slot === parseInt(options.broadcastPresetSlot));
      if (slotData) {
        // Options override slot defaults ONLY if they are not empty/null
        const overrides = {};
        for (const [k, v] of Object.entries(options)) {
          if (v !== '' && v !== null && v !== undefined) overrides[k] = v;
        }
        mergedOptions = { ...slotData, ...overrides };
      }
    }

    super(mergedOptions);
    this.transcodePreset = mergedOptions.transcodePreset || 'pal';
    this.broadcastPresetSlot = mergedOptions.broadcastPresetSlot || null;

    // Use interlace preset if valid, otherwise default to PAL
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
      '-pix_fmt', this.pixFmt,
      '-flags', '+ildct+ilme',
    ];

    if (this.profile) {
      args.push('-profile:v', this.profile);
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

    if (p.fieldOrder) {
      args.push('-field_order', p.fieldOrder);
    }

    if (p.interlaced) {
      args.push('-top', '1');
    }

    // Output arguments (muxer, PIDs, etc.)
    // We can't easily call super._buildOutputArgs directly because of the logic, 
    // but SRTEncoder has it public or accessible.
    // In src/encoder.js it is _buildOutputArgs
    args.push(...this._buildOutputArgs(this.outputMode || (this.host ? 'srt' : 'null')));

    return args;
  }

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      transcodePreset: this.transcodePreset,
      broadcastPresetSlot: this.broadcastPresetSlot,
      presetName: this._preset.name,
    };
  }
}

Transcoder.PRESETS = INTERLACE_PRESETS;

module.exports = Transcoder;
