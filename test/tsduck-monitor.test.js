'use strict';

const { EventEmitter } = require('events');
const TSDuckMonitor = require('../src/tsduck-monitor');

// ── helpers ────────────────────────────────────────────────────────────────────

function makeMonitor(opts = {}) {
  return new TSDuckMonitor({
    id: 'test-stream',
    url: opts.url || 'udp://239.0.0.1:1234',
    intervalMs: opts.intervalMs || 10000,
    sampleWindowMs: opts.sampleWindowMs || 5000,
  });
}

// ── constructor ────────────────────────────────────────────────────────────────

describe('TSDuckMonitor', () => {
  describe('constructor', () => {
    test('sets id, url, intervalMs, sampleWindowMs', () => {
      const m = makeMonitor({ intervalMs: 8000, sampleWindowMs: 3000 });
      expect(m.id).toBe('test-stream');
      expect(m.url).toBe('udp://239.0.0.1:1234');
      expect(m.intervalMs).toBe(8000);
      expect(m.sampleWindowMs).toBe(3000);
      expect(m.isRunning).toBe(false);
    });

    test('enforces 1 s floor on intervalMs', () => {
      const m = new TSDuckMonitor({ id: 'x', url: 'udp://1.2.3.4:1000', intervalMs: 100 });
      expect(m.intervalMs).toBe(1000);
    });

    test('sampleWindowMs capped to intervalMs - 500', () => {
      const m = new TSDuckMonitor({ id: 'x', url: 'udp://1.2.3.4:1000', intervalMs: 3000, sampleWindowMs: 4000 });
      expect(m.sampleWindowMs).toBeLessThan(m.intervalMs);
    });

    test('extends EventEmitter', () => {
      expect(makeMonitor()).toBeInstanceOf(EventEmitter);
    });
  });

  // ── _inputPluginArgs ────────────────────────────────────────────────────────

  describe('_inputPluginArgs', () => {
    test('returns ip args for udp:// URL', () => {
      const m = makeMonitor({ url: 'udp://239.0.0.1:5000' });
      const args = m._inputPluginArgs('udp://239.0.0.1:5000');
      expect(args).toContain('-I');
      expect(args).toContain('ip');
      expect(args).toContain('239.0.0.1');
      expect(args).toContain('5000');
    });

    test('returns ip args for rtp:// URL', () => {
      const m = makeMonitor({ url: 'rtp://239.0.0.1:5000' });
      const args = m._inputPluginArgs('rtp://239.0.0.1:5000');
      expect(args).toContain('ip');
    });

    test('returns srt args for srt:// URL', () => {
      const m = makeMonitor({ url: 'srt://10.0.0.1:9001' });
      const args = m._inputPluginArgs('srt://10.0.0.1:9001');
      expect(args).toContain('-I');
      expect(args).toContain('srt');
    });

    test('returns null for unsupported scheme', () => {
      const m = makeMonitor();
      expect(m._inputPluginArgs('file:///foo.ts')).toBeNull();
      expect(m._inputPluginArgs('')).toBeNull();
    });
  });

  // ── _buildTspArgs ───────────────────────────────────────────────────────────

  describe('_buildTspArgs', () => {
    test('includes pcrverify, tables, bitrate_monitor, drop', () => {
      const m = makeMonitor({ url: 'udp://239.0.0.1:1234' });
      const args = m._buildTspArgs();
      expect(args).not.toBeNull();
      expect(args.join(' ')).toMatch(/pcrverify/);
      expect(args.join(' ')).toMatch(/tables/);
      expect(args.join(' ')).toMatch(/bitrate_monitor/);
      expect(args.join(' ')).toMatch(/drop/);
    });

    test('returns null when URL scheme is unsupported', () => {
      const m = new TSDuckMonitor({ id: 'x', url: 'file:///foo.ts' });
      expect(m._buildTspArgs()).toBeNull();
    });
  });

  // ── _parsePcrVerifyStderr ───────────────────────────────────────────────────

  describe('_parsePcrVerifyStderr', () => {
    test('emits pcr event with repetitionMaxMs from interval violation', () => {
      const m = makeMonitor();
      const events = [];
      m.on('pcr', (e) => events.push(e));

      m._parsePcrVerifyStderr('* Error: PID 0x0100: PCR interval 42.5 ms > 40 ms', Date.now());
      expect(events).toHaveLength(1);
      expect(events[0].repetitionMaxMs).toBeCloseTo(42.5);
    });

    test('emits alarm p2 for interval violation', () => {
      const m = makeMonitor();
      const alarms = [];
      m.on('alarm', (a) => alarms.push(a));

      m._parsePcrVerifyStderr('* Error: PID 0x0100: PCR interval 45.0 ms > 40 ms', Date.now());
      expect(alarms.some(a => a.checkId === 'pcr_interval' && a.priority === 'p2')).toBe(true);
    });

    test('does not emit alarm when interval is within limit', () => {
      const m = makeMonitor();
      const alarms = [];
      m.on('alarm', (a) => alarms.push(a));

      // Below threshold — interval lines not present → no alarm
      m._parsePcrVerifyStderr('* Info: PCR looks fine', Date.now());
      expect(alarms).toHaveLength(0);
    });

    test('counts PCR discontinuities and emits p1 alarm', () => {
      const m = makeMonitor();
      const alarms = [];
      m.on('alarm', (a) => alarms.push(a));

      m._parsePcrVerifyStderr(
        '* Error: PID 0x0100: PCR discontinuity\n* Error: PID 0x0101: PCR discontinuity',
        Date.now()
      );
      const discontAlarms = alarms.filter(a => a.checkId === 'pcr_discont');
      expect(discontAlarms).toHaveLength(2);
      expect(discontAlarms[0].priority).toBe('p1');
    });

    test('parses accuracy violation in µs', () => {
      const m = makeMonitor();
      const events = [];
      m.on('pcr', (e) => events.push(e));

      m._parsePcrVerifyStderr('* Error: PID 0x0100: PCR accuracy 1.2 µs > 500 ns', Date.now());
      expect(events[0].accuracyMaxMs).toBeCloseTo(0.0012);
    });

    test('emits nothing on empty stderr', () => {
      const m = makeMonitor();
      const events = [];
      m.on('pcr', (e) => events.push(e));
      m.on('alarm', (e) => events.push(e));
      m._parsePcrVerifyStderr('', Date.now());
      expect(events).toHaveLength(0);
    });
  });

  // ── _parseTableJsonLines ────────────────────────────────────────────────────

  describe('_parseTableJsonLines', () => {
    test('emits si event with table counts', () => {
      const m = makeMonitor();
      const events = [];
      m.on('si', (e) => events.push(e));

      const lines = [
        JSON.stringify({ type: 'table', table_type: 'PAT', pid: 0 }),
        JSON.stringify({ type: 'table', table_type: 'PAT', pid: 0 }),
        JSON.stringify({ type: 'table', table_type: 'PMT', pid: 256 }),
      ].join('\n');

      m._parseTableJsonLines(lines, Date.now());
      expect(events).toHaveLength(1);
      expect(events[0].tables.PAT).toBe(2);
      expect(events[0].tables.PMT).toBe(1);
    });

    test('emits p3 alarm when mandatory table absent from long window', () => {
      const m = new TSDuckMonitor({
        id: 'x', url: 'udp://1.2.3.4:1000',
        intervalMs: 15000, sampleWindowMs: 12000,  // window > NIT limit (10 s)
      });
      const alarms = [];
      m.on('alarm', (a) => alarms.push(a));

      // Send only PAT/PMT — NIT absent
      const lines = [
        JSON.stringify({ type: 'table', table_type: 'PAT' }),
        JSON.stringify({ type: 'table', table_type: 'PMT' }),
      ].join('\n');
      m._parseTableJsonLines(lines, Date.now());

      expect(alarms.some(a => a.checkId === 'si_absent_nit')).toBe(true);
    });

    test('ignores non-JSON lines gracefully', () => {
      const m = makeMonitor();
      expect(() => {
        m._parseTableJsonLines('not json\n{"type":"table","table_type":"PAT"}\n', Date.now());
      }).not.toThrow();
    });

    test('emits nothing on empty stdout', () => {
      const m = makeMonitor();
      const events = [];
      m.on('si', (e) => events.push(e));
      m._parseTableJsonLines('', Date.now());
      expect(events).toHaveLength(0);
    });
  });

  // ── _parseBitrateMonitor ────────────────────────────────────────────────────

  describe('_parseBitrateMonitor', () => {
    test('emits bitrate event from monitor output', () => {
      const m = makeMonitor();
      const events = [];
      m.on('bitrate', (e) => events.push(e));

      m._parseBitrateMonitor('Bitrate: 18,432,000 bits/s', Date.now());
      expect(events[0].bps).toBe(18432000);
    });

    test('takes the last bitrate line when multiple present', () => {
      const m = makeMonitor();
      const events = [];
      m.on('bitrate', (e) => events.push(e));

      m._parseBitrateMonitor('Bitrate: 10,000,000 bits/s\nBitrate: 20,000,000 bits/s', Date.now());
      expect(events[0].bps).toBe(20000000);
    });

    test('emits nothing when no bitrate line found', () => {
      const m = makeMonitor();
      const events = [];
      m.on('bitrate', (e) => events.push(e));
      m._parseBitrateMonitor('some other tsp output', Date.now());
      expect(events).toHaveLength(0);
    });
  });

  // ── lifecycle ───────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    test('start() sets isRunning', () => {
      const m = makeMonitor();
      m.start();
      expect(m.isRunning).toBe(true);
      m.stop();
    });

    test('start() is idempotent', () => {
      const m = makeMonitor();
      m.start();
      m.start();
      expect(m.isRunning).toBe(true);
      m.stop();
    });

    test('stop() clears isRunning and cancels timer', () => {
      const m = makeMonitor();
      m.start();
      m.stop();
      expect(m.isRunning).toBe(false);
      expect(m._timer).toBeNull();
    });

    test('suspend() then resume() keeps isRunning true', () => {
      const m = makeMonitor();
      m.start();
      m.suspend();
      expect(m.isRunning).toBe(true);
      m.resume();
      expect(m.isRunning).toBe(true);
      m.stop();
    });
  });
});
