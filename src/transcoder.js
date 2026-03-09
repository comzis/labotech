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
    const vbps = this._parseBps(this.videoBitrate);
    const bufsize = vbps ? `${Math.round(vbps / 1e6 * 2)}M` : this.videoBitrate;

    // Thumbnail interval
    const { THUMBNAIL_DIR } = require('./monitoring');
    const thumbPath = require('path').join(THUMBNAIL_DIR, `${this.id}.jpg`);
    const thumbInterval = parseInt(process.env.THUMBNAIL_INTERVAL_SEC) || 5;

    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-stats',
      ...this.buildInputArgs(),
      // filter_complex: interlace/deinterlace filter + split for thumbnail tee
      '-filter_complex',
      `[0:v]${p.videoFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,split=2[vout][vthumb];` +
      `[vthumb]fps=1/${thumbInterval},scale=320:-2[thumbout]`,
      '-map', '[vout]',
      '-map', '0:a?',
      '-c:v', this.videoCodec,
      '-preset', this.preset,
      '-b:v', this.videoBitrate,
      '-pix_fmt', this.pixFmt,
      '-flags', '+ildct+ilme',
    ];

    if (this.rateMode === 'cbr') {
      args.push('-maxrate', this.videoBitrate, '-bufsize', bufsize);
      if (this.videoCodec === 'libx264') {
        args.push('-x264-params', 'nal-hrd=cbr:force-cfr=1');
      } else if (this.videoCodec === 'libx265') {
        args.push('-x265-params', 'hrd=1:nal-hrd=cbr:vbv-bufsize=' + Math.round(vbps / 1e3));
      }
    } else {
      args.push('-bufsize', bufsize);
    }

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

    args.push(...this._buildOutputArgs(this.outputMode || (this.host ? 'srt' : 'null')));

    // Thumbnail output — from split filter defined in filter_complex above
    args.push('-map', '[thumbout]', '-f', 'image2', '-update', '1', '-q:v', '5', '-y', thumbPath);

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
