'use strict';

const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');

const SRTRelay = require('../src/srt-relay');

function makeFakeProc({ exitCode = null } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = jest.fn((sig) => {
    setImmediate(() => proc.emit('close', 0, sig));
  });
  if (exitCode !== null) {
    setImmediate(() => proc.emit('close', exitCode));
  }
  return proc;
}

beforeEach(() => {
  spawn.mockReset();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

const BASE_URL = 'srt://203.0.113.10:40065?latency=4000&passphrase=TESTKEY&pbkeylen=256';

// ── Group 1: Constructor ────────────────────────────────────────────────────
describe('SRTRelay — constructor', () => {
  test('hashPort is deterministic', () => {
    expect(SRTRelay.hashPort(BASE_URL)).toBe(SRTRelay.hashPort(BASE_URL));
  });

  test('hashPort result in [5500, 5599]', () => {
    const urls = [BASE_URL, 'srt://10.0.0.1:5000', 'srt://a:1', 'srt://z:9999', 'srt://b:2'];
    urls.forEach(u => {
      const p = SRTRelay.hashPort(u);
      expect(p).toBeGreaterThanOrEqual(5500);
      expect(p).toBeLessThanOrEqual(5599);
    });
  });

  test('localUrl matches udp://127.0.0.1:{port}', () => {
    const r = new SRTRelay({ srtUrl: BASE_URL });
    expect(r.localUrl).toBe(`udp://127.0.0.1:${r.port}`);
    expect(r.port).toBeGreaterThanOrEqual(5500);
    expect(r.port).toBeLessThanOrEqual(5599);
  });

  test('explicit port override', () => {
    const r = new SRTRelay({ srtUrl: BASE_URL, port: 5510 });
    expect(r.port).toBe(5510);
    expect(r.localUrl).toBe('udp://127.0.0.1:5510');
  });

  test('throws on non-SRT URL', () => {
    expect(() => new SRTRelay({ srtUrl: 'udp://239.0.0.1:1234' })).toThrow('srt://');
    expect(() => new SRTRelay({ srtUrl: 'rtp://10.0.0.1:5000' })).toThrow('srt://');
  });

  test('throws when srtUrl omitted', () => {
    expect(() => new SRTRelay({})).toThrow();
  });
});

// ── Group 2: Spawn args ─────────────────────────────────────────────────────
describe('SRTRelay — spawn args', () => {
  let relay, proc;

  beforeEach(() => {
    proc = makeFakeProc();
    spawn.mockReturnValue(proc);
    relay = new SRTRelay({ srtUrl: BASE_URL });
    relay.start();
  });

  afterEach(() => relay.stop());

  test('spawns ffmpeg', () => {
    expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array));
  });

  test('args include -c copy -f mpegts', () => {
    const args = spawn.mock.calls[0][1];
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('-f');
    expect(args).toContain('mpegts');
  });

  test('input URL has mode=caller', () => {
    const args = spawn.mock.calls[0][1];
    const iIdx = args.indexOf('-i');
    expect(args[iIdx + 1]).toContain('mode=caller');
  });

  test('input URL has adapter matching MANAGEMENT_IP env var', () => {
    const args = spawn.mock.calls[0][1];
    const iIdx = args.indexOf('-i');
    expect(args[iIdx + 1]).toContain(`adapter=${process.env.MANAGEMENT_IP || '0.0.0.0'}`);
  });

  test('output URL has pkt_size=1316', () => {
    const args = spawn.mock.calls[0][1];
    const last = args[args.length - 1];
    expect(last).toContain('pkt_size=1316');
  });

  test('output URL is udp://127.0.0.1:PORT', () => {
    const args = spawn.mock.calls[0][1];
    const last = args[args.length - 1];
    expect(last).toMatch(/^udp:\/\/127\.0\.0\.1:\d+/);
  });
});

// ── Group 3: Lifecycle ──────────────────────────────────────────────────────
describe('SRTRelay — lifecycle', () => {
  let relay, proc;

  beforeEach(() => {
    proc = makeFakeProc();
    spawn.mockReturnValue(proc);
    relay = new SRTRelay({ srtUrl: BASE_URL });
  });

  afterEach(() => relay.stop());

  test('start() is idempotent — only one spawn', () => {
    relay.start();
    relay.start();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('start() emits started event', () => {
    const cb = jest.fn();
    relay.on('started', cb);
    relay.start();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ localUrl: relay.localUrl }));
  });

  test('ready fires after 600ms', () => {
    const cb = jest.fn();
    relay.on('ready', cb);
    relay.start();
    expect(cb).not.toHaveBeenCalled();
    jest.advanceTimersByTime(600);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ localUrl: relay.localUrl }));
  });

  test('stop() kills the process', () => {
    relay.start();
    relay.stop();
    expect(proc.kill).toHaveBeenCalled();
  });

  test('stop() emits stopped', () => {
    const cb = jest.fn();
    relay.on('stopped', cb);
    relay.start();
    relay.stop();
    expect(cb).toHaveBeenCalled();
  });

  test('isReady() false before ready event', () => {
    relay.start();
    expect(relay.isReady()).toBe(false);
  });

  test('isReady() true after ready event', () => {
    relay.start();
    jest.advanceTimersByTime(600);
    expect(relay.isReady()).toBe(true);
  });

  test('getLocalUrl() returns localUrl', () => {
    expect(relay.getLocalUrl()).toBe(relay.localUrl);
  });
});

// ── Group 4: Auto-restart ───────────────────────────────────────────────────
describe('SRTRelay — auto-restart', () => {
  test('restarts on unexpected exit', () => {
    const proc1 = makeFakeProc();
    const proc2 = makeFakeProc();
    spawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);
    const relay = new SRTRelay({ srtUrl: BASE_URL });
    relay.start();
    expect(spawn).toHaveBeenCalledTimes(1);
    // Simulate crash
    proc1.emit('close', 1);
    // Advance past restart delay
    jest.advanceTimersByTime(6000);
    expect(spawn).toHaveBeenCalledTimes(2);
    relay.stop();
  });

  test('restart delay doubles on repeated crashes', () => {
    const procs = [0, 1, 2, 3].map(() => makeFakeProc());
    procs.forEach((p, i) => spawn.mockReturnValueOnce(procs[i]));
    const relay = new SRTRelay({ srtUrl: BASE_URL });
    relay.start();
    expect(relay._restartDelay).toBe(5000);
    procs[0].emit('close', 1);
    jest.advanceTimersByTime(6000); // trigger restart 1
    expect(relay._restartDelay).toBe(10000);
    procs[1].emit('close', 1);
    jest.advanceTimersByTime(11000); // trigger restart 2
    expect(relay._restartDelay).toBe(20000);
    relay.stop();
  });

  test('no restart after stop()', () => {
    const proc1 = makeFakeProc();
    spawn.mockReturnValue(proc1);
    const relay = new SRTRelay({ srtUrl: BASE_URL });
    relay.start();
    relay.stop();
    proc1.emit('close', 1); // stale close
    jest.advanceTimersByTime(30000);
    expect(spawn).toHaveBeenCalledTimes(1); // no additional spawn
  });
});

// ── Group 5: Error event ────────────────────────────────────────────────────
describe('SRTRelay — error handling', () => {
  test('proc error event propagates to relay', () => {
    const proc = makeFakeProc();
    spawn.mockReturnValue(proc);
    const relay = new SRTRelay({ srtUrl: BASE_URL });
    const errCb = jest.fn();
    relay.on('error', errCb);
    relay.start();
    proc.emit('error', new Error('ENOENT: ffmpeg not found'));
    expect(errCb).toHaveBeenCalledWith(expect.any(Error));
    relay.stop();
  });

  test('error triggers restart', () => {
    const proc1 = makeFakeProc();
    const proc2 = makeFakeProc();
    spawn.mockReturnValueOnce(proc1).mockReturnValueOnce(proc2);
    const relay = new SRTRelay({ srtUrl: BASE_URL });
    relay.on('error', () => {}); // prevent unhandled error
    relay.start();
    proc1.emit('error', new Error('spawn failed'));
    jest.advanceTimersByTime(6000);
    expect(spawn).toHaveBeenCalledTimes(2);
    relay.stop();
  });
});

// ── Group 6: Port determinism ───────────────────────────────────────────────
describe('SRTRelay — port allocation', () => {
  test('different URLs get different ports (spot check)', () => {
    const urls = [
      'srt://203.0.113.10:40065',
      'srt://203.0.113.10:40066',
      'srt://203.0.113.11:5000',
      'srt://203.0.113.11:5001',
      'srt://192.168.1.1:9000',
    ];
    const ports = urls.map(SRTRelay.hashPort);
    // All should be in range
    ports.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(5500);
      expect(p).toBeLessThanOrEqual(5599);
    });
    // At least 3 should be unique (collision resistance spot check)
    const unique = new Set(ports);
    expect(unique.size).toBeGreaterThanOrEqual(3);
  });
});
