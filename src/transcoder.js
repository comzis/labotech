'use strict';

const path = require('path');
const SRTEncoder = require('./encoder');
const BROADCAST_PRESETS = require('../config/presets.json');
const { THUMBNAIL_DIR, sanitizeStreamId } = require('./monitoring');

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
    // 1× bitrate buffer: tighter CBR, less jitter. 2× was too loose for broadcast.
    const bufsize = vbps ? `${Math.round(vbps / 1e6)}M` : this.videoBitrate;

    // Thumbnail interval
    const thumbPath = path.join(THUMBNAIL_DIR, `${sanitizeStreamId(this.id)}.jpg`);
    const thumbInterval = parseInt(process.env.THUMBNAIL_INTERVAL_SEC) || 5;

    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-stats',
      ...this.buildInputArgs(),
    ];

    // Passthrough mode: preserve original video/audio payloads and remux only.
    if (this.videoCodec === 'copy') {
      args.push('-map', '0:v', '-map', '0:a?', '-c', 'copy');
      args.push(...this._buildOutputArgs(this.outputMode || (this.host ? 'srt' : 'null')));
      args.push('-map', '0:v', '-vf', `fps=1/${thumbInterval},scale=320:-2`, '-f', 'image2', '-update', '1', '-q:v', '5', '-y', thumbPath);
      return args;
    }

    args.push(
      // filter_complex: interlace/deinterlace filter + split for thumbnail tee
      '-filter_complex',
      `[0:v]${p.videoFilter},scale=trunc(iw/2)*2:trunc(ih/2)*2,setpts=PTS,split=2[vout][vthumb];` +
      `[vthumb]fps=1/${thumbInterval},scale=320:-2[thumbout]`,
      '-map', '[vout]',
    );
    if (this.audioPairs) {
      this.audioPairs.forEach((pair) => args.push('-map', `0:a:${pair.sourceIndex}?`));
    } else {
      args.push('-map', '0:a?');
    }

    args.push(
      '-c:v', this.videoCodec,
      '-preset', this.preset,
      '-g', this.gopSize.toString(),
      '-keyint_min', this.gopSize.toString(),
      '-sc_threshold', '0',
      '-b:v', this.videoBitrate,
      '-pix_fmt', this.pixFmt,
    );

    const x265Params = [];
    if (this.rateMode === 'cbr') {
      args.push('-maxrate', this.videoBitrate, '-bufsize', bufsize);
      if (this.videoCodec === 'libx264') {
        args.push('-x264-params', 'nal-hrd=cbr:force-cfr=1:scenecut=0');
      } else if (this.videoCodec === 'libx265') {
        x265Params.push(`hrd=1:nal-hrd=cbr:no-scenecut=1:vbv-bufsize=${Math.round(vbps / 1e3)}`);
      }
    } else {
      args.push('-bufsize', bufsize);
    }

    if (this.profile) {
      args.push('-profile:v', this.profile);
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

    if (p.fieldOrder) {
      args.push('-field_order', p.fieldOrder);
    }

    if (p.interlaced) {
      args.push('-flags', '+ildct+ilme');
      args.push('-top', '1');
    }

    if (this.audioPairs) {
      this.audioPairs.forEach((pair, i) => {
        if (pair.codec === 'copy') {
          args.push(`-c:a:${i}`, 'copy');
        } else {
          args.push(`-c:a:${i}`, pair.codec, `-b:a:${i}`, pair.bitrate, `-ac:a:${i}`, String(pair.channels));
        }
        if (pair.language) args.push(`-metadata:s:a:${i}`, `language=${pair.language}`);
      });
    } else if (this.audioCodec === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', this.audioCodec, '-b:a', this.audioBitrate, '-ac', String(this.audioChannels));
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
