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
        'srt://10.0.0.1:9999?mode=caller&latency=2000&stats=1&statsintvl=1'
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

  describe('audioPairs', () => {
    test('uses legacy flat audio when audioPairs not supplied', () => {
      const args = enc.buildFFmpegArgs();
      expect(args).toContain('-c:a');
      expect(args).toContain('-b:a');
      expect(args).toContain('-ac');
      expect(args).not.toContain('-map');
    });

    test('generates per-pair args and explicit maps when audioPairs supplied', () => {
      const enc2 = new SRTEncoder({
        id: 'pair-test',
        input: 'udp://239.1.1.1:5000',
        host: '10.0.0.1',
        port: 9999,
        latency: 2000,
        videoBitrate: '8M',
        videoCodec: 'libx264',
        preset: 'medium',
        pixFmt: 'yuv420p',
        audioPairs: [
          { sourceIndex: 0, codec: 'aac', bitrate: '256k', channels: 2, language: 'eng' },
          { sourceIndex: 1, codec: 'mp2', bitrate: '192k', channels: 2, language: 'fra' },
        ],
      });
      const args = enc2.buildFFmpegArgs();
      // Explicit stream mapping
      expect(args).toContain('-map');
      expect(args).toContain('0:v:0');
      expect(args).toContain('0:a:0');
      expect(args).toContain('0:a:1');
      // Per-pair codec
      expect(args).toContain('-c:a:0');
      expect(args).toContain('aac');
      expect(args).toContain('-c:a:1');
      expect(args).toContain('mp2');
      // Per-pair bitrate
      expect(args).toContain('-b:a:0');
      expect(args).toContain('256k');
      expect(args).toContain('-b:a:1');
      expect(args).toContain('192k');
      // Language metadata
      expect(args).toContain('-metadata:s:a:0');
      expect(args).toContain('language=eng');
      expect(args).toContain('-metadata:s:a:1');
      expect(args).toContain('language=fra');
      // No legacy flat audio args
      expect(args.indexOf('-c:a')).toBe(-1);
    });

    test('skips language metadata when language is empty', () => {
      const enc3 = new SRTEncoder({
        id: 'no-lang',
        input: 'udp://239.1.1.1:5000',
        host: '10.0.0.1',
        port: 9999,
        audioPairs: [{ sourceIndex: 0, codec: 'aac', bitrate: '256k', channels: 2, language: '' }],
      });
      const args = enc3.buildFFmpegArgs();
      expect(args).not.toContain('-metadata:s:a:0');
    });

    test('audioPairs are exposed in toJSON', () => {
      const enc4 = new SRTEncoder({
        id: 'json-test',
        input: 'udp://239.1.1.1:5000',
        audioPairs: [{ sourceIndex: 0, codec: 'aac', bitrate: '256k', channels: 2 }],
      });
      expect(enc4.toJSON().audioPairs).toHaveLength(1);
      expect(enc4.toJSON().audioPairs[0].codec).toBe('aac');
    });

    test('toJSON returns null audioPairs when using legacy flat config', () => {
      expect(enc.toJSON().audioPairs).toBeNull();
    });
  });

  describe('DVB muxer', () => {
    let dvbEnc;
    beforeEach(() => {
      dvbEnc = new SRTEncoder({
        id: 'dvb-test',
        input: 'udp://239.1.1.1:5000',
        host: '10.0.0.1',
        port: 9999,
        videoBitrate: '8M',
        videoCodec: 'libx264',
        preset: 'medium',
        pixFmt: 'yuv420p',
        serviceId: 1001,
        transportStreamId: 7,
        originalNetworkId: 8442,
        pmtPid: 0x100,
        videoPid: 0x200,
        serviceName: 'News HD',
        serviceProvider: 'BroadcastCo',
        audioPairs: [
          { sourceIndex: 0, codec: 'mp2', bitrate: '192k', channels: 2, language: 'eng', pid: 0x201 },
          { sourceIndex: 1, codec: 'mp2', bitrate: '192k', channels: 2, language: 'fra', pid: 0x202 },
        ],
      });
    });

    test('includes mpegts_service_id', () => {
      const args = dvbEnc.buildFFmpegArgs();
      const idx = args.indexOf('-mpegts_service_id');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('1001');
    });

    test('includes mpegts_pmt_start_pid', () => {
      const args = dvbEnc.buildFFmpegArgs();
      const idx = args.indexOf('-mpegts_pmt_start_pid');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('256');  // 0x100
    });

    test('includes mpegts_original_network_id', () => {
      const args = dvbEnc.buildFFmpegArgs();
      const idx = args.indexOf('-mpegts_original_network_id');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('8442');
    });

    test('includes mpegts_transport_stream_id', () => {
      const args = dvbEnc.buildFFmpegArgs();
      const idx = args.indexOf('-mpegts_transport_stream_id');
      expect(idx).toBeGreaterThan(-1);
      expect(args[idx + 1]).toBe('7');
    });

    test('sets service_name and service_provider metadata', () => {
      const args = dvbEnc.buildFFmpegArgs();
      expect(args).toContain('service_name=News HD');
      expect(args).toContain('service_provider=BroadcastCo');
    });

    test('assigns video PID via -streamid 0', () => {
      const args = dvbEnc.buildFFmpegArgs();
      const idx = args.indexOf('-streamid');
      expect(idx).toBeGreaterThan(-1);
      // first -streamid entry is video
      expect(args[idx + 1]).toBe('0:512');  // 0x200
    });

    test('assigns audio PIDs via -streamid 1 and 2', () => {
      const args = dvbEnc.buildFFmpegArgs();
      const streamIds = [];
      args.forEach((a, i) => { if (a === '-streamid') streamIds.push(args[i + 1]); });
      expect(streamIds).toContain('1:513');  // 0x201
      expect(streamIds).toContain('2:514');  // 0x202
    });

    test('audio PID auto-defaults to videoPid+1+index when not specified', () => {
      const enc2 = new SRTEncoder({
        id: 'pid-auto',
        input: 'udp://239.1.1.1:5000',
        videoPid: 256,
        audioPairs: [
          { sourceIndex: 0, codec: 'aac', bitrate: '256k', channels: 2 },
          { sourceIndex: 1, codec: 'aac', bitrate: '256k', channels: 2 },
        ],
      });
      expect(enc2.audioPairs[0].pid).toBe(257);
      expect(enc2.audioPairs[1].pid).toBe(258);
    });

    test('toJSON includes dvb object', () => {
      const j = dvbEnc.toJSON();
      expect(j.dvb).toBeDefined();
      expect(j.dvb.serviceId).toBe(1001);
      expect(j.dvb.videoPid).toBe(512);  // 0x200
      expect(j.dvb.serviceName).toBe('News HD');
    });
  });

  describe('output modes', () => {
    const base = {
      id: 'out-test', input: 'udp://239.1.1.1:5000',
      host: '239.100.25.29', port: 5000,
      videoBitrate: '8M', videoCodec: 'libx264', preset: 'medium', pixFmt: 'yuv420p',
    };

    test('UDP mode: uses -f mpegts with udp:// URL', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'udp' });
      const args = enc2.buildFFmpegArgs();
      expect(args).toContain('mpegts');
      const url = args[args.length - 1];
      expect(url).toMatch(/^udp:\/\//);
      expect(url).toContain('pkt_size=1316');
    });

    test('UDP mode: includes TTL in URL', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'udp', ttl: 32 });
      const url = enc2.buildFFmpegArgs()[enc2.buildFFmpegArgs().length - 1];
      expect(url).toContain('ttl=32');
    });

    test('UDP mode: includes localaddr when set', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'udp', localAddr: '10.67.18.30' });
      const url = enc2.buildFFmpegArgs()[enc2.buildFFmpegArgs().length - 1];
      expect(url).toContain('localaddr=10.67.18.30');
    });

    test('RTP mode: uses -f rtp_mpegts with rtp:// URL', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'rtp' });
      const args = enc2.buildFFmpegArgs();
      expect(args).toContain('rtp_mpegts');
      const url = args[args.length - 1];
      expect(url).toMatch(/^rtp:\/\//);
    });

    test('null mode: uses -f null -', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'null', host: null });
      const args = enc2.buildFFmpegArgs();
      expect(args).toContain('null');
      expect(args[args.length - 1]).toBe('-');
    });

    test('loglevel is warning for UDP (no SRT stats)', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'udp' });
      const args = enc2.buildFFmpegArgs();
      const idx = args.indexOf('-loglevel');
      expect(args[idx + 1]).toBe('warning');
    });

    test('loglevel is info for SRT (for libsrt stats lines)', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'srt' });
      const args = enc2.buildFFmpegArgs();
      const idx = args.indexOf('-loglevel');
      expect(args[idx + 1]).toBe('info');
    });

    test('toJSON reflects outputMode', () => {
      const enc2 = new SRTEncoder({ ...base, outputMode: 'udp' });
      expect(enc2.toJSON().outputMode).toBe('udp');
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
