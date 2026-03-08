'use strict';

const SRTEncoder = require('../src/encoder');

describe('SRTEncoder', () => {
  let enc;

  beforeEach(() => {
    enc = new SRTEncoder({
      id: 'test-enc',
      input: 'udp://239.1.1.1:5000',
      host: '10.0.0.1',
      port: 9999,
      latency: 2000,
      videoBitrate: '8M',
      audioBitrate: '256k',
      videoCodec: 'libx264',
      preset: 'medium',
      pixFmt: 'yuv420p',
    });
  });

  describe('detectInputType', () => {
    test('detects rtp://', () => expect(enc.detectInputType('rtp://239.1.1.1:5000')).toBe('rtp'));
    test('detects udp://', () => expect(enc.detectInputType('udp://239.1.1.1:5000')).toBe('udp'));
    test('detects rtsp://', () => expect(enc.detectInputType('rtsp://cam.local/stream')).toBe('rtsp'));
    test('detects srt://', () => expect(enc.detectInputType('srt://host:9000')).toBe('srt'));
    test('detects /dev/ device', () => expect(enc.detectInputType('/dev/video0')).toBe('device'));
    test('defaults to file', () => expect(enc.detectInputType('/path/to/file.ts')).toBe('file'));
    test('returns file for null', () => expect(enc.detectInputType(null)).toBe('file'));
  });

  describe('buildInputArgs', () => {
    test('UDP input has no -re flag', () => {
      const args = enc.buildInputArgs();
      expect(args).not.toContain('-re');
      expect(args).toContain('-fflags');
    });

    test('file input has -re flag', () => {
      enc.input = '/tmp/test.ts';
      const args = enc.buildInputArgs();
      expect(args).toContain('-re');
    });

    test('RTSP input has -rtsp_transport tcp', () => {
      enc.input = 'rtsp://cam.local/stream';
      const args = enc.buildInputArgs();
      expect(args).toContain('-rtsp_transport');
      expect(args).toContain('tcp');
    });
  });

  describe('buildSRTUrl', () => {
    test('includes mode=caller', () => {
      expect(enc.buildSRTUrl()).toContain('mode=caller');
    });

    test('includes latency', () => {
      expect(enc.buildSRTUrl()).toContain('latency=2000');
    });

    test('includes passphrase when set', () => {
      enc.passphrase = 'secret';
      expect(enc.buildSRTUrl()).toContain('passphrase=secret');
      expect(enc.buildSRTUrl()).toContain('pbkeylen=16');
    });

    test('includes streamid when set', () => {
      enc.streamId = 'chan1';
      expect(enc.buildSRTUrl()).toContain('streamid=chan1');
    });

    test('formats correctly', () => {
      expect(enc.buildSRTUrl()).toBe(
        'srt://10.0.0.1:9999?mode=caller&latency=2000'
      );
    });
  });

  describe('buildFFmpegArgs', () => {
    test('starts with -hide_banner', () => {
      expect(enc.buildFFmpegArgs()[0]).toBe('-hide_banner');
    });

    test('includes video codec', () => {
      const args = enc.buildFFmpegArgs();
      expect(args).toContain('libx264');
    });

    test('includes output format mpegts', () => {
      const args = enc.buildFFmpegArgs();
      expect(args).toContain('mpegts');
    });

    test('ends with SRT URL', () => {
      const args = enc.buildFFmpegArgs();
      expect(args[args.length - 1]).toMatch(/^srt:\/\//);
    });
  });

  describe('parseStats', () => {
    test('parses frame, fps, bitrate, speed', () => {
      const received = [];
      enc.on('stats', s => received.push(s));
      enc.parseStats('frame= 1234 fps= 25 q=28.0 size=   12345kB time=00:00:49.40 bitrate=2048.0kbits/s speed=1.00x');
      expect(received).toHaveLength(1);
      expect(received[0].frame).toBe(1234);
      expect(received[0].fps).toBe(25);
      expect(received[0].bitrate).toBe(2048);
      expect(received[0].speed).toBe(1);
    });

    test('ignores lines without stats', () => {
      const received = [];
      enc.on('stats', s => received.push(s));
      enc.parseStats('Input #0, mpegts, from ...');
      expect(received).toHaveLength(0);
    });
  });

  describe('isRunning', () => {
    test('starts as false', () => {
      expect(enc.isRunning).toBe(false);
    });
  });

  describe('toJSON', () => {
    test('returns correct fields', () => {
      const j = enc.toJSON();
      expect(j.id).toBe('test-enc');
      expect(j.isRunning).toBe(false);
      expect(j.host).toBe('10.0.0.1');
    });
  });
});
