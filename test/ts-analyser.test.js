'use strict';

const fs = require('fs');
const TSAnalyser = require('../src/ts-analyser');
const DolbyEAdapter = require('../src/dolbye-adapter');

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

  describe('phase3 scheduler cadence', () => {
    test('runs heavy probe immediately then by heavy interval', () => {
      analyser.monitoringPolicy = {
        profile: 'test',
        probeCadence: {
          baseIntervalMs: 1000,
          heavyProbeEvery: 3,
          heavyProbeIntervalMs: 3000,
          minLoopDelayMs: 200,
          startupJitterMaxMs: 1000,
        },
      };
      analyser._nextHeavyProbeAt = 0;
      expect(analyser._shouldRunHeavyProbe(true, 1000)).toBe(true);
      expect(analyser._shouldRunHeavyProbe(true, 2000)).toBe(false);
      expect(analyser._shouldRunHeavyProbe(true, 3999)).toBe(false);
      expect(analyser._shouldRunHeavyProbe(true, 4000)).toBe(true);
    });

    test('exposes cadence diagnostics in scheduler payload', () => {
      analyser.monitoringPolicy = {
        profile: 'test',
        probeCadence: {
          baseIntervalMs: 2000,
          heavyProbeEvery: 2,
          heavyProbeIntervalMs: 4000,
          minLoopDelayMs: 300,
          startupJitterMaxMs: 1200,
        },
      };
      analyser._nextHeavyProbeAt = 12345;
      analyser._nextProbeAt = 12555;
      const d = analyser._schedulerDiagnostics(false);
      expect(d.runHeavyProbe).toBe(false);
      expect(d.nextHeavyProbeAt).toBe(12345);
      expect(d.nextProbeAt).toBe(12555);
      expect(d.cadence.baseIntervalMs).toBe(2000);
      expect(d.cadence.heavyProbeIntervalMs).toBe(4000);
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

    test('merges tsduck PID into null-PID program stream for unambiguous 1:1 case', () => {
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
          { pid: 0x0100, codecType: 'video', codecName: 'h264', bitrate: 8000000 },
          { pid: 0x0101, codecType: 'audio', codecName: 'mp2', bitrate: 256000 },
        ],
      });
      // With 1:1 unambiguous match, PIDs should be patched into the existing program streams
      const rows = enriched.programs[0].streams;
      expect(rows[0].pid).toBe(0x0100);
      expect(rows[0].bitrate).toBe(8000000);
      expect(rows[1].pid).toBe(0x0101);
      expect(rows[1].bitrate).toBe(256000);
      // No duplicate orphan entries since the streams were merged in-place
      expect(enriched.orphanStreams.some((s) => s.pid === 0x0100)).toBe(false);
      expect(enriched.orphanStreams.some((s) => s.pid === 0x0101)).toBe(false);
    });

    test('keeps unresolved program rows as orphans when ambiguous (multiple null-PID streams of same type)', () => {
      const base = analyser.parseStructure({
        programs: [
          {
            program_id: 1,
            streams: [
              { index: 0, codec_type: 'audio', codec_name: 'mp2', id: null },
              { index: 1, codec_type: 'audio', codec_name: 'mp2', id: null },
            ],
          },
        ],
        streams: [
          { index: 0, codec_type: 'audio', codec_name: 'mp2', id: null },
          { index: 1, codec_type: 'audio', codec_name: 'mp2', id: null },
        ],
      });
      const enriched = analyser._applyTSDuckData(base, {
        pids: [
          { pid: 0x0101, codecType: 'audio', codecName: 'mp2' },
          { pid: 0x0102, codecType: 'audio', codecName: 'mp2' },
        ],
      });
      // Ambiguous: 2 null-PID audio streams + 2 TSDuck audio PIDs → orphan path
      const rows = enriched.programs[0].streams;
      expect(rows[0].pid).toBe(null);
      expect(rows[1].pid).toBe(null);
      expect(enriched.orphanStreams.some((s) => s.pid === 0x0101)).toBe(true);
      expect(enriched.orphanStreams.some((s) => s.pid === 0x0102)).toBe(true);
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

    test('_extractTSDuckPidRows prefers entry with bitrate when same PID appears in PMT and pid-list', () => {
      // tsanalyze JSON can have PID references inside service/PMT sections (no bitrate)
      // BEFORE the main pid-list section (with bitrate). Best-entry logic must win.
      const payload = {
        services: [
          {
            id: 1,
            name: 'Test Service',
            pids: [
              { pid: 256, stream_type: 27 },   // PMT reference — no bitrate
              { pid: 257, stream_type: 3 },
            ],
          },
        ],
        pid_list: [
          { pid: 256, bitrate: 5000000, codec_type: 'video' },  // measurement — has bitrate
          { pid: 257, bitrate: 192000,  codec_type: 'audio' },
        ],
      };
      const rows = analyser._extractTSDuckPidRows(payload);
      const v = rows.find((r) => r.pid === 256);
      expect(v).toBeDefined();
      expect(v.bitrate).toBe(5000000);
      const a = rows.find((r) => r.pid === 257);
      expect(a).toBeDefined();
      expect(a.bitrate).toBe(192000);
    });

    test('_extractTSDuckPidRows excludes PID 0 (PAT)', () => {
      const payload = {
        pid_list: [
          { pid: 0,   bitrate: 500,     codec_type: 'data' },   // PAT — must be excluded
          { pid: 256, bitrate: 8000000, codec_type: 'video' },
        ],
      };
      const rows = analyser._extractTSDuckPidRows(payload);
      expect(rows.find((r) => r.pid === 0)).toBeUndefined();
      expect(rows.find((r) => r.pid === 256)).toBeDefined();
    });

    test('prefers injected sniffer arrival metrics with capture method', () => {
      const base = analyser.parseStructure({
        programs: [],
        streams: [{ index: 0, codec_type: 'audio', codec_name: 'mp2', id: '0x0101' }],
      });
      const enriched = analyser._applyTSDuckData(
        base,
        { arrivalMetrics: null },
        {
          iatMs: { min: 1.2, max: 5.7, avg: 2.8, p95: 4.9 },
          jitterMs: 0.4,
          packetLossPct: 0,
          sampleCount: 42,
          captureMethod: 'tshark',
        }
      );
      expect(enriched.dvb.arrival.captureMethod).toBe('tshark');
      expect(enriched.dvb.arrival.sampleCount).toBe(42);
    });
  });

  describe('health assessment', () => {
    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env.DOLBYE_REQUIRED_WHEN_DETECTED;
      delete process.env.TS_20227_MIN_SAMPLES;
      delete process.env.TS_20227_MAX_LOSS_PCT;
      delete process.env.TS_20227_MAX_GAP_EVENTS;
      delete process.env.TS_20227_MAX_DUPLICATE_EVENTS;
      delete process.env.TS_20227_MAX_REORDER_EVENTS;
    });

    test('classifies nominal stream as ok with high score', () => {
      const base = analyser.parseStructure({
        programs: [
          {
            program_id: 101,
            streams: [
              { index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100', bit_rate: '8000000' },
              { index: 1, codec_type: 'audio', codec_name: 'aac', id: '0x0101', bit_rate: '192000' },
            ],
          },
        ],
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100', bit_rate: '8000000' },
          { index: 1, codec_type: 'audio', codec_name: 'aac', id: '0x0101', bit_rate: '192000' },
        ],
      });
      const result = {
        ...base,
        dvb: {
          ...base.dvb,
          bitrateBps: 10000000,
          bitrateSource: 'tsduck',
          timestampDiscontinuity: { count: 0 },
          continuityCounterErrors: { count: 0 },
          arrival: {
            iatMs: { min: 0.6, max: 2.1, avg: 1.2, p95: 2.0 },
            jitterMs: 0.4,
            packetLossPct: 0,
            sampleCount: 120,
            captureMethod: 'tshark',
          },
          si: { compliance: { nit: true, sdt: true, eitPf: true, tdt: true } },
        },
        audioLevels: { meanDb: -18, maxDb: -3 },
      };
      const health = analyser._buildHealthAssessment(result);
      expect(health.severity).toBe('ok');
      expect(health.score).toBeGreaterThanOrEqual(85);
      expect(health.timestampDiscontinuityCount).toBe(0);
      expect(health.continuityCounterErrorCount).toBe(0);
    });

    test('classifies degraded stream as critical with actionable reasons', () => {
      const base = analyser.parseStructure({ programs: [], streams: [] });
      const result = {
        ...base,
        dvb: {
          ...base.dvb,
          bitrateBps: 0,
          bitrateSource: 'format',
          serviceCount: 0,
          pidCount: 0,
          timestampDiscontinuity: { count: 6 },
          continuityCounterErrors: { count: 5 },
          arrival: {
            iatMs: { min: 1, max: 250, avg: 80, p95: 180 },
            jitterMs: 24,
            packetLossPct: 2.4,
            sampleCount: 18,
            captureMethod: 'tsduck',
          },
          si: { compliance: { nit: false, sdt: false, eitPf: true, tdt: false } },
        },
        audioLevels: { meanDb: -55, maxDb: -12 },
      };
      const health = analyser._buildHealthAssessment(result);
      expect(health.severity).toBe('critical');
      expect(health.score).toBeLessThan(65);
      expect(health.reasons.length).toBeGreaterThan(0);
      expect(health.timestampDiscontinuityCount).toBe(6);
      expect(health.continuityCounterErrorCount).toBe(5);
    });

    test('penalizes when Dolby E detected but not decoded', () => {
      jest.spyOn(DolbyEAdapter, 'isEnabled').mockReturnValue(true);
      process.env.DOLBYE_REQUIRED_WHEN_DETECTED = 'true';
      const base = analyser.parseStructure({
        programs: [{ program_id: 101, streams: [{ index: 0, codec_type: 'audio', codec_name: 'eac3', id: '0x0101' }] }],
        streams: [{ index: 0, codec_type: 'audio', codec_name: 'eac3', id: '0x0101' }],
      });
      const withDolbyFail = {
        ...base,
        dvb: {
          ...base.dvb,
          bitrateBps: 7000000,
          bitrateSource: 'measured',
          timestampDiscontinuity: { count: 0 },
          continuityCounterErrors: { count: 0 },
          dolbyE: {
            available: true,
            ok: false,
            detected: true,
            decoded: false,
            frameCount: null,
            error: 'decode failed',
          },
          arrival: {
            iatMs: { min: 1, max: 4, avg: 2, p95: 3 },
            jitterMs: 0.4,
            packetLossPct: 0,
            sampleCount: 12,
            captureMethod: 'tshark',
          },
        },
        audioLevels: { meanDb: -20, maxDb: -4 },
      };
      const health = analyser._buildHealthAssessment(withDolbyFail);
      expect(health.reasons.some((r) => /Dolby E detected but decode failed/i.test(r))).toBe(true);
      expect(health.dolbyE.detected).toBe(true);
      expect(health.dolbyE.decoded).toBe(false);
    });

    test('marks 2022-7 compliant when RTP sequence is continuous', () => {
      const base = analyser.parseStructure({
        programs: [{ program_id: 1, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100' }] }],
        streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100' }],
      });
      analyser.url = 'rtp://239.100.25.29:5000';
      const result = {
        ...base,
        dvb: {
          ...base.dvb,
          arrival: {
            iatMs: { min: 0.8, max: 2.1, avg: 1.3, p95: 1.9 },
            jitterMs: 0.3,
            packetLossPct: 0,
            sampleCount: 120,
            captureMethod: 'tshark',
            rtpSequence: {
              observed: true,
              gapEvents: 0,
              duplicateEvents: 0,
              reorderedEvents: 0,
              lastSeq: 1024,
            },
          },
        },
      };
      const s = analyser._buildSmpte20227Assessment(result);
      expect(s.checked).toBe(true);
      expect(s.compliant).toBe(true);
      expect(s.state).toBe('compliant');
    });

    // ── Hysteresis tests ──────────────────────────────────────────────────────
    // These tests exercise _attachHealthAssessment directly by stubbing
    // _buildHealthAssessment so we can control the raw severity sequence.

    function makeMinimalResult(analyserInst) {
      // Must have bitrateBps > 0, serviceCount > 0, pidCount > 0 so the
      // isInconclusiveProbe guard does not hold the hysteresis state and
      // the stub health severity is actually applied.
      const r = analyserInst.parseStructure({ programs: [], streams: [] });
      r.dvb = r.dvb || {};
      r.dvb.bitrateBps = 5000000;   // 5 Mbps — non-zero bitrate
      r.dvb.serviceCount = 1;
      r.dvb.pidCount = 4;
      return r;
    }

    function stubHealth(analyserInst, rawSeverity) {
      jest.spyOn(analyserInst, '_buildHealthAssessment').mockReturnValueOnce({
        score: rawSeverity === 'ok' ? 95 : rawSeverity === 'warning' ? 72 : 40,
        severity: rawSeverity,
        reasons: [],
        hysteresis: null,
      });
    }

    test('single warning probe does not escalate — stays ok (hysteresis gate)', () => {
      const base = makeMinimalResult(analyser);
      stubHealth(analyser, 'warning');
      const r = analyser._attachHealthAssessment(base);
      expect(r.dvb.health.severity).toBe('ok');
      expect(r.dvb.health.hysteresis.raw).toBe('warning');
      expect(r.dvb.health.hysteresis.warnCount).toBe(1);
    });

    test('two consecutive warning probes escalate to warning', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      stubHealth(analyser, 'warning');
      analyser._attachHealthAssessment(base);           // probe 1 — suppressed
      stubHealth(analyser, 'warning');
      const r = analyser._attachHealthAssessment(base); // probe 2 — escalates
      expect(r.dvb.health.severity).toBe('warning');
      expect(r.dvb.health.hysteresis.warnCount).toBe(2);
    });

    test('single critical probe does not escalate — requires 3 consecutive', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      stubHealth(analyser, 'critical');
      const r = analyser._attachHealthAssessment(base);
      expect(r.dvb.health.severity).toBe('ok');   // critCount=1 < CRIT_HYSTERESIS_N=3
      expect(r.dvb.health.hysteresis.critCount).toBe(1);
    });

    test('two consecutive critical probes do not yet escalate (need 3)', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      stubHealth(analyser, 'critical');
      analyser._attachHealthAssessment(base);      // probe 1 — critCount=1
      stubHealth(analyser, 'critical');
      const r = analyser._attachHealthAssessment(base); // probe 2 — critCount=2, still ok
      expect(r.dvb.health.severity).toBe('ok');
      expect(r.dvb.health.hysteresis.critCount).toBe(2);
    });

    test('three consecutive critical probes escalate to critical', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      stubHealth(analyser, 'critical');
      analyser._attachHealthAssessment(base);      // probe 1 — suppressed
      stubHealth(analyser, 'critical');
      analyser._attachHealthAssessment(base);      // probe 2 — suppressed
      stubHealth(analyser, 'critical');
      const r = analyser._attachHealthAssessment(base); // probe 3 — escalates
      expect(r.dvb.health.severity).toBe('critical');
      expect(r.dvb.health.hysteresis.critCount).toBe(3);
    });

    test('inconclusive probe (0 pids + 0 services + 0 bitrate) holds last reported — heavy probe', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      const inconclusiveResult = {
        ...base,
        dvb: {
          ...base.dvb,
          bitrateBps: 0,
          serviceCount: 0,
          pidCount: 0,
          probeDiagnostics: { scheduler: { runHeavyProbe: true } },
        },
      };
      stubHealth(analyser, 'critical'); // would be critical based on score
      const r = analyser._attachHealthAssessment(inconclusiveResult);
      expect(r.dvb.health.severity).toBe('ok');
      expect(r.dvb.health.hysteresis.critCount).toBe(0);
    });

    test('inconclusive probe (0 pids + 0 services + 0 bitrate) holds last reported — light probe', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      // Light probe: runHeavyProbe = false (or absent). Bug: old code only guarded heavy probes.
      const inconclusiveLight = {
        ...base,
        dvb: {
          ...base.dvb,
          bitrateBps: 0,
          serviceCount: 0,
          pidCount: 0,
          probeDiagnostics: { scheduler: { runHeavyProbe: false } },
        },
      };
      stubHealth(analyser, 'critical');
      const r = analyser._attachHealthAssessment(inconclusiveLight);
      // Must also be held — isInconclusiveProbe now applies regardless of probe type
      expect(r.dvb.health.severity).toBe('ok');
      expect(r.dvb.health.hysteresis.critCount).toBe(0);
    });

    test('ok probe after warning streak recovers immediately', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 2, critCount: 0, lastReported: 'warning' };
      stubHealth(analyser, 'ok');
      const r = analyser._attachHealthAssessment(base);
      expect(r.dvb.health.severity).toBe('ok');
      expect(r.dvb.health.hysteresis.warnCount).toBe(0);
    });

    test('warn counter resets to zero on ok, preventing stale escalation', () => {
      const base = makeMinimalResult(analyser);
      analyser._healthHysteresis = { warnCount: 0, critCount: 0, lastReported: 'ok' };
      stubHealth(analyser, 'warning');
      analyser._attachHealthAssessment(base); // warnCount = 1
      stubHealth(analyser, 'ok');
      analyser._attachHealthAssessment(base); // warnCount reset to 0
      stubHealth(analyser, 'warning');
      const r = analyser._attachHealthAssessment(base); // warnCount = 1, still suppressed
      expect(r.dvb.health.severity).toBe('ok');
      expect(r.dvb.health.hysteresis.warnCount).toBe(1);
    });

    test('penalizes health when 2022-7 is non-compliant', () => {
      const base = analyser.parseStructure({
        programs: [{ program_id: 1, streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100' }] }],
        streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', id: '0x0100' }],
      });
      const result = {
        ...base,
        dvb: {
          ...base.dvb,
          bitrateBps: 8000000,
          bitrateSource: 'measured',
          timestampDiscontinuity: { count: 0 },
          continuityCounterErrors: { count: 0 },
          arrival: {
            iatMs: { min: 1, max: 12, avg: 4, p95: 8 },
            jitterMs: 1.2,
            packetLossPct: 0,
            sampleCount: 90,
            captureMethod: 'tshark',
            rtpSequence: { observed: true, gapEvents: 3, duplicateEvents: 0, reorderedEvents: 0, lastSeq: 4096 },
          },
          smpte20227: {
            checked: true,
            compliant: false,
            state: 'non_compliant',
            reason: 'RTP sequence/loss exceed 2022-7 consolidation thresholds',
          },
        },
        audioLevels: { meanDb: -18, maxDb: -3 },
      };
      const health = analyser._buildHealthAssessment(result);
      expect(health.reasons.some((r) => /SMPTE ST 2022-7 non-compliant/i.test(r))).toBe(true);
      expect(health.smpte20227.state).toBe('non_compliant');
    });
  });

  describe('rtp fallback probing', () => {
    test('builds udp fallback URL from rtp URL', () => {
      expect(analyser._rtpToUdpUrl('rtp://239.100.29.49:6501')).toBe('udp://239.100.29.49:6501');
    });

    test('builds consolidated pid probe result from rows', () => {
      const res = analyser._buildPidProbeResult([
        { index: 0, pid: 256, codecType: 'video' },
        { index: 1, pid: 257, codecType: 'audio' },
      ]);
      expect(res.pidByIndex[0]).toBe(256);
      expect(res.pidByIndex[1]).toBe(257);
      expect(res.rows).toHaveLength(2);
    });

    test('appends forced-mpegts fallback rows without rebinding unresolved streams', () => {
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
      expect(enriched.programs[0].streams[0].pid).toBe(null);
      expect(enriched.programs[0].streams[1].pid).toBe(null);
      expect(enriched.orphanStreams.some((s) => s.pid === 256 && s.codecType === 'video')).toBe(true);
      expect(enriched.orphanStreams.some((s) => s.pid === 257 && s.codecType === 'audio')).toBe(true);
      expect(enriched.dvb.pidCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('thumbnail cache fallback', () => {
    test('returns cached thumbnail URL when a file exists', () => {
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const url = analyser._resolveCachedThumbnailUrl();
      expect(url).toMatch(/^\/logs\/thumbnails\/test-analyser\.jpg\?t=\d+$/);
      existsSpy.mockRestore();
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

  describe('_getNicName()', () => {
    afterEach(() => {
      jest.resetModules();
      jest.dontMock('../config/multicast.json');
    });

    test('returns eno2 as default when config/multicast.json is missing', () => {
      jest.resetModules();
      jest.doMock('../config/multicast.json', () => {
        throw new Error('ENOENT');
      });
      const TSA = require('../src/ts-analyser');
      TSA._resetNicNameCache();
      expect(TSA._getNicName()).toBe('eno2');
    });

    test('returns nic field from multicast config when available', () => {
      const TSA = require('../src/ts-analyser');
      TSA._resetNicNameCache();
      const result = TSA._getNicName();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('falls back to eno2 when nic field absent from config', () => {
      jest.resetModules();
      jest.doMock('../config/multicast.json', () => ({ subnet: '239.0.0.0/8' }));
      const TSA = require('../src/ts-analyser');
      TSA._resetNicNameCache();
      expect(TSA._getNicName()).toBe('eno2');
    });

    test('caches the config after first call', () => {
      const TSA = require('../src/ts-analyser');
      TSA._resetNicNameCache();
      const first = TSA._getNicName();
      const second = TSA._getNicName();
      expect(first).toBe(second);
    });
  });

  describe('_healthThresholds() SRT auto-relaxation', () => {
    test('UDP analyser returns unmodified policy thresholds', () => {
      const a = new TSAnalyser({ id: 'udp-test', url: 'udp://239.1.1.1:5000' });
      a.monitoringPolicy = { health: { iatP95CriticalMs: 150, iatP95WarnMs: 50, jitterCriticalMs: 15, jitterWarnMs: 5 } };
      const t = a._healthThresholds();
      expect(t.iatP95CriticalMs).toBe(150);
      expect(t.jitterCriticalMs).toBe(15);
    });

    test('SRT analyser relaxes IAT p95 critical to at least 400 ms', () => {
      const a = new TSAnalyser({ id: 'srt-test', url: 'srt://1.2.3.4:9000?mode=caller' });
      a.monitoringPolicy = { health: { iatP95CriticalMs: 150, iatP95WarnMs: 50, jitterCriticalMs: 15, jitterWarnMs: 5 } };
      const t = a._healthThresholds();
      expect(t.iatP95CriticalMs).toBe(400);
      expect(t.iatP95WarnMs).toBe(120);
    });

    test('SRT analyser relaxes jitter critical to at least 40 ms', () => {
      const a = new TSAnalyser({ id: 'srt-test2', url: 'srt://1.2.3.4:9000' });
      a.monitoringPolicy = { health: { iatP95CriticalMs: 150, iatP95WarnMs: 50, jitterCriticalMs: 15, jitterWarnMs: 5 } };
      const t = a._healthThresholds();
      expect(t.jitterCriticalMs).toBe(40);
      expect(t.jitterWarnMs).toBe(10);
    });

    test('SRT analyser does not lower thresholds if profile already generous', () => {
      const a = new TSAnalyser({ id: 'srt-strict', url: 'srt://1.2.3.4:9000' });
      a.monitoringPolicy = { health: { iatP95CriticalMs: 600, iatP95WarnMs: 200, jitterCriticalMs: 60, jitterWarnMs: 20 } };
      const t = a._healthThresholds();
      expect(t.iatP95CriticalMs).toBe(600);
      expect(t.jitterCriticalMs).toBe(60);
    });
  });

  describe('startup grace period', () => {
    function makeBase(a) {
      return {
        id: a.id, url: a.url,
        dvb: {
          bitrateBps: 20000000, serviceCount: 1, pidCount: 5,
          arrival: { iatMs: { avg: 5, p95: 8 }, jitterMs: 1, packetLossPct: 0 },
          health: { score: 40, severity: 'critical', reasons: ['test'] },
          probeDiagnostics: { scheduler: { runHeavyProbe: true } },
        },
      };
    }
    function stubCritical(a) {
      jest.spyOn(a, '_buildHealthAssessment').mockReturnValue({ score: 40, severity: 'critical', reasons: ['stub'] });
    }

    test('UDP analyser holds ok for first 4 continuous probes', () => {
      const a = new TSAnalyser({ id: 't', url: 'udp://239.1.1.1:5000' });
      stubCritical(a);
      // Simulate first 4 continuous probes via grace counter
      a._startupGraceRemaining = 4;
      for (let i = 0; i < 4; i++) {
        const r = a._attachHealthAssessment(makeBase(a));
        expect(r.dvb.health.severity).toBe('ok');
        expect(r.dvb.health.startupGrace).toBe(true);
      }
      // 5th probe: grace exhausted — hysteresis begins
      const r5 = a._attachHealthAssessment(makeBase(a));
      expect(r5.dvb.health.startupGrace).toBeUndefined();
    });

    test('SRT analyser gets 8 grace probes', () => {
      const a = new TSAnalyser({ id: 't', url: 'srt://10.0.0.1:9000?passphrase=test' });
      stubCritical(a);
      a._startupGraceRemaining = null; // not yet initialised
      // Simulate probe() incrementing count and initialising grace
      a._continuousProbeCount += 1;
      if (a._startupGraceRemaining === null) {
        const isSrt = a.url && String(a.url).startsWith('srt://');
        a._startupGraceRemaining = isSrt ? 8 : 4;
      }
      expect(a._startupGraceRemaining).toBe(8);
      for (let i = 0; i < 8; i++) {
        const r = a._attachHealthAssessment(makeBase(a));
        expect(r.dvb.health.severity).toBe('ok');
      }
      // After 8 grace probes, the next probe is scored normally
      const rAfter = a._attachHealthAssessment(makeBase(a));
      expect(rAfter.dvb.health.startupGrace).toBeUndefined();
    });

    test('grace does not apply to one-shot probes (_startupGraceRemaining stays null)', () => {
      const a = new TSAnalyser({ id: 't', url: 'udp://239.1.1.1:5000' });
      stubCritical(a);
      // _startupGraceRemaining is null (no continuous probe ran)
      expect(a._startupGraceRemaining).toBeNull();
      // Should score normally (hysteresis, not grace)
      const r = a._attachHealthAssessment(makeBase(a));
      expect(r.dvb.health.startupGrace).toBeUndefined();
    });
  });
});
