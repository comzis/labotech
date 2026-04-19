'use strict';

const Transcoder = require('../src/transcoder');

describe('Transcoder', () => {
  const baseOpts = {
    id: 'tc-test',
    input: 'udp://239.1.1.1:5000',
    host: '10.0.0.1',
    port: 9999,
    videoBitrate: '8M',
  };

  describe('PRESETS', () => {
    test('exports all four presets', () => {
      const keys = Object.keys(Transcoder.PRESETS);
      expect(keys).toContain('pal');
      expect(keys).toContain('ntsc');
      expect(keys).toContain('hfr-pal');
      expect(keys).toContain('deinterlace');
    });

    test('PAL preset is interlaced', () => {
      expect(Transcoder.PRESETS.pal.interlaced).toBe(true);
    });

    test('deinterlace preset is progressive', () => {
      expect(Transcoder.PRESETS.deinterlace.interlaced).toBe(false);
    });

    test('PAL uses 25/50 fps', () => {
      expect(Transcoder.PRESETS.pal.inputFps).toBe(25);
      expect(Transcoder.PRESETS.pal.outputFps).toBe(50);
    });

    test('NTSC uses 29.97/59.94 fps', () => {
      expect(Transcoder.PRESETS.ntsc.inputFps).toBe(29.97);
      expect(Transcoder.PRESETS.ntsc.outputFps).toBe(59.94);
    });
  });

  describe('constructor', () => {
    test('defaults to pal preset', () => {
      const tc = new Transcoder({ ...baseOpts });
      expect(tc.transcodePreset).toBe('pal');
    });

    test('accepts valid preset', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'ntsc' });
      expect(tc.transcodePreset).toBe('ntsc');
    });

    test('throws on unknown preset', () => {
      expect(() => new Transcoder({ ...baseOpts, transcodePreset: 'bogus' })).toThrow();
    });
  });

  describe('buildFFmpegArgs', () => {
    test('PAL includes interlace filter in filter_complex', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'pal' });
      const args = tc.buildFFmpegArgs();
      const fcIdx = args.indexOf('-filter_complex');
      expect(fcIdx).toBeGreaterThan(-1);
      expect(args[fcIdx + 1]).toContain('interlace');
    });

    test('deinterlace includes yadif filter in filter_complex', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'deinterlace' });
      const args = tc.buildFFmpegArgs();
      const fcIdx = args.indexOf('-filter_complex');
      expect(fcIdx).toBeGreaterThan(-1);
      expect(args[fcIdx + 1]).toContain('yadif');
    });

    test('includes -flags +ildct+ilme for interlaced presets', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'pal' });
      const args = tc.buildFFmpegArgs();
      expect(args).toContain('+ildct+ilme');
    });

    test('does not include interlace flags for deinterlace preset', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'deinterlace' });
      const args = tc.buildFFmpegArgs();
      expect(args).not.toContain('+ildct+ilme');
    });

    test('sets fixed GOP controls in transcoder args', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'pal' });
      const args = tc.buildFFmpegArgs();
      expect(args).toContain('-keyint_min');
      expect(args).toContain('-sc_threshold');
      expect(args).toContain('0');
    });

    test('contains SRT URL', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'ntsc' });
      const args = tc.buildFFmpegArgs();
      expect(args.some(a => /^srt:\/\//.test(a))).toBe(true);
    });

    test('ends with thumbnail path', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'ntsc' });
      const args = tc.buildFFmpegArgs();
      expect(args[args.length - 1]).toMatch(/\.jpg$/);
    });
  });

  describe('toJSON', () => {
    test('includes transcodePreset and presetName', () => {
      const tc = new Transcoder({ ...baseOpts, transcodePreset: 'pal' });
      const j = tc.toJSON();
      expect(j.transcodePreset).toBe('pal');
      expect(j.presetName).toContain('PAL');
    });
  });
});
