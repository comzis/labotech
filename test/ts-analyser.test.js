'use strict';

const TSAnalyser = require('../src/ts-analyser');

describe('TSAnalyser', () => {
  let analyser;

  beforeEach(() => {
    analyser = new TSAnalyser({ id: 'test-analyser', url: 'udp://239.1.1.1:5000' });
  });

  describe('constructor', () => {
    test('sets id and url', () => {
      expect(analyser.id).toBe('test-analyser');
      expect(analyser.url).toBe('udp://239.1.1.1:5000');
    });

    test('isRunning starts false', () => {
      expect(analyser.isRunning).toBe(false);
    });

    test('auto-generates id if not provided', () => {
      const a = new TSAnalyser({ url: 'udp://1.2.3.4:5000' });
      expect(a.id).toMatch(/^analyser-/);
    });
  });

  describe('parseStructure', () => {
    const mockRaw = {
      programs: [
        {
          program_id: 1,
          pmt_pid: 256,
          pcr_pid: 257,
          tags: { service_name: 'BBC One' },
          streams: [
            {
              index: 0,
              codec_type: 'video',
              codec_name: 'h264',
              id: 0x0101,
              width: 1920,
              height: 1080,
              avg_frame_rate: '25/1',
              bit_rate: '8000000',
            },
            {
              index: 1,
              codec_type: 'audio',
              codec_name: 'aac',
              id: 0x0102,
              sample_rate: '48000',
              channels: 2,
              tags: { language: 'eng' },
            },
          ],
        },
      ],
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264', id: 0x0101 },
        { index: 1, codec_type: 'audio', codec_name: 'aac',  id: 0x0102 },
      ],
    };

    test('parses program id and pmt', () => {
      const r = analyser.parseStructure(mockRaw);
      expect(r.programs).toHaveLength(1);
      expect(r.programs[0].programId).toBe(1);
      expect(r.programs[0].pmtPid).toBe(256);
    });

    test('parses service name from tags', () => {
      const r = analyser.parseStructure(mockRaw);
      expect(r.programs[0].name).toBe('BBC One');
    });

    test('parses video stream properties', () => {
      const r = analyser.parseStructure(mockRaw);
      const video = r.programs[0].streams[0];
      expect(video.codecType).toBe('video');
      expect(video.codecName).toBe('h264');
      expect(video.width).toBe(1920);
      expect(video.height).toBe(1080);
    });

    test('parses audio language', () => {
      const r = analyser.parseStructure(mockRaw);
      const audio = r.programs[0].streams[1];
      expect(audio.language).toBe('eng');
      expect(audio.sampleRate).toBe('48000');
    });

    test('identifies orphan streams', () => {
      const rawWithOrphan = {
        programs: [],
        streams: [{ index: 5, codec_type: 'data', codec_name: 'bin_data', id: 0x01ff }],
      };
      const r = analyser.parseStructure(rawWithOrphan);
      expect(r.orphanStreams).toHaveLength(1);
      expect(r.orphanStreams[0].codecType).toBe('data');
    });

    test('uses global stream PID when program stream omits id', () => {
      const rawMissingProgramPid = {
        programs: [
          {
            program_id: 1,
            pmt_pid: 256,
            pcr_pid: 257,
            streams: [
              { index: 0, codec_type: 'video', codec_name: 'h264', id: null },
            ],
          },
        ],
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100', bit_rate: '8000000' },
        ],
      };
      const r = analyser.parseStructure(rawMissingProgramPid);
      expect(r.programs[0].streams[0].pid).toBe(0x0100);
      expect(r.dvb.pidCount).toBe(1);
    });

    test('creates orphan PID rows when pid map has unseen indexes', () => {
      const base = analyser.parseStructure({ programs: [], streams: [] });
      const patched = analyser._applyPidMap(base, { 5: 0x0200, 6: 0x0201 });
      const pids = (patched.orphanStreams || []).map((s) => s.pid).sort((a, b) => a - b);
      expect(pids).toEqual([0x0200, 0x0201]);
      expect(patched.dvb.pidCount).toBeGreaterThanOrEqual(2);
    });

    test('returns probeTime', () => {
      const before = Date.now();
      const r = analyser.parseStructure(mockRaw);
      expect(r.probeTime).toBeGreaterThanOrEqual(before);
    });

    test('applies tsduck enrichment for bitrate/services/pids', () => {
      const base = analyser.parseStructure(mockRaw);
      const enriched = analyser._applyTSDuckData(base, {
        bitrateBps: 21400000,
        services: [{ serviceId: 1, serviceName: 'BBC One HD', serviceProvider: 'BBC' }],
        pids: [
          { pid: 0x0110, codecType: 'data', codecName: 'private_data', streamType: '0x06', bitrate: 64000 },
        ],
      });
      expect(enriched.dvb.bitrateBps).toBe(21400000);
      expect(enriched.dvb.bitrateSource).toBe('tsduck');
      expect(enriched.dvb.services[0].serviceName).toBe('BBC One HD');
      expect(enriched.orphanStreams.some((s) => s.pid === 0x0110)).toBe(true);
    });

    test('maps tsduck PIDs into program streams when IDs are missing', () => {
      const base = analyser.parseStructure({
        programs: [
          {
            program_id: 1,
            streams: [
              { index: 0, codec_type: 'video', codec_name: 'h264', id: null },
              { index: 1, codec_type: 'audio', codec_name: 'mp2', id: null },
            ],
          },
        ],
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', id: null },
          { index: 1, codec_type: 'audio', codec_name: 'mp2', id: null },
        ],
      });
      const enriched = analyser._applyTSDuckData(base, {
        pids: [
          { pid: 0x0100, codecType: 'video', codecName: 'h264' },
          { pid: 0x0101, codecType: 'audio', codecName: 'mp2' },
        ],
      });
      const rows = enriched.programs[0].streams;
      expect(rows[0].pid).toBe(0x0100);
      expect(rows[1].pid).toBe(0x0101);
    });
  });

  describe('tsduck helpers', () => {
    test('builds tsduck args with raw URL (no ffmpeg query hints)', () => {
      const args = analyser._buildTSDuckArgs();
      const input = args[args.length - 1];
      expect(input).toBe('udp://239.1.1.1:5000');
      expect(input.includes('fifo_size=')).toBe(false);
      expect(input.includes('overrun_nonfatal=')).toBe(false);
      expect(input.includes('timeout=')).toBe(false);
    });

    test('extracts tsduck bitrate from mixed payload', () => {
      const payload = {
        stream: { bitrate: '900 kbits/s' },
        transport: { bitrate: '21.4 Mbps' },
      };
      expect(analyser._extractTSDuckBitrateBps(payload)).toBe(21400000);
    });

    test('extracts SI intervals and compliance-ready structure', () => {
      const payload = {
        tables: {
          nit: { repetition_interval: 9.5, unit: 's' },
          sdt: { repetition_interval: 1.8, unit: 's' },
          eit_pf: { repetition_interval_ms: 1800, unit: 'ms' },
          tdt: { repetition_interval: 28, unit: 's' },
        },
      };
      const si = analyser._extractTSDuckSIIntervalsSec(payload);
      expect(si.nit).toBe(9.5);
      expect(si.sdt).toBe(1.8);
      expect(si.eitPf).toBe(1.8);
      expect(si.tdt).toBe(28);
    });

    test('keeps previous structure when tsduck data is unavailable', () => {
      const base = analyser.parseStructure({
        programs: [],
        streams: [{ index: 0, codec_type: 'audio', codec_name: 'mp2', id: '0x0101' }],
      });
      const enriched = analyser._applyTSDuckData(base, null);
      expect(enriched.programs).toEqual(base.programs);
      expect(enriched.orphanStreams[0].pid).toBe(0x0101);
      expect(enriched.dvb.pidCount).toBe(base.dvb.pidCount);
    });
  });

  describe('rtp fallback probing', () => {
    test('builds udp fallback URL from rtp URL', () => {
      expect(analyser._rtpToUdpUrl('rtp://239.100.29.49:6501')).toBe('udp://239.100.29.49:6501');
    });

    test('detects unresolved pid rows', () => {
      const parsed = analyser.parseStructure({
        programs: [{ program_id: 1, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', id: null }] }],
        streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', id: null }],
      });
      expect(analyser._hasUnresolvedPidRows(parsed)).toBe(true);
    });

    test('applies forced-mpegts fallback rows into unresolved streams', () => {
      const parsed = analyser.parseStructure({
        programs: [
          {
            program_id: 1,
            streams: [
              { index: 0, codec_type: 'video', codec_name: 'h264', id: null },
              { index: 1, codec_type: 'audio', codec_name: 'mp2', id: null },
            ],
          },
        ],
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', id: null },
          { index: 1, codec_type: 'audio', codec_name: 'mp2', id: null },
        ],
      });
      const enriched = analyser._applyFallbackPidRows(parsed, [
        { pid: 256, pidHex: '0x0100', codecType: 'video', codecName: 'h264' },
        { pid: 257, pidHex: '0x0101', codecType: 'audio', codecName: 'mp2' },
      ]);
      expect(enriched.programs[0].streams[0].pid).toBe(256);
      expect(enriched.programs[0].streams[1].pid).toBe(257);
      expect(enriched.dvb.pidCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('toJSON', () => {
    test('returns correct fields', () => {
      const j = analyser.toJSON();
      expect(j.id).toBe('test-analyser');
      expect(j.isRunning).toBe(false);
      expect(j.url).toBe('udp://239.1.1.1:5000');
    });
  });

  describe('stop', () => {
    test('sets isRunning to false', () => {
      analyser.isRunning = true;
      analyser.stop();
      expect(analyser.isRunning).toBe(false);
    });
  });
});
