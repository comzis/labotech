'use strict';

/**
 * Targeted tests for the Phase 2 thumbnail migration.
 * Validates that TSAnalyser correctly delegates thumbnail management to
 * ThumbnailWorkerClient and falls back to the in-process paths as designed.
 *
 * All process-spawning dependencies are mocked so no ffmpeg/tsp/ffprobe
 * processes are launched during the test run.
 */

// ── Module mocks (Jest hoists these before require()) ────────────────────────

// Mock child_process.spawn so that ffprobe/tsanalyze/ffmpeg don't get spawned
// when the probe timer fires during fake-timer advancement.
jest.mock('child_process', () => {
  const real = jest.requireActual('child_process');
  const { EventEmitter } = require('events');
  function makeNullProc() {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdin  = { write: () => {}, end: () => {} };
    p.kill   = () => {};
    p.connected = false;
    p.send = () => {};
    // Emit close on next tick so probe() resolves cleanly
    setTimeout(() => p.emit('close', 1, null), 0);
    return p;
  }
  return {
    ...real,
    spawn:    jest.fn(() => makeNullProc()),
    execFile: jest.fn((_, __, cb) => { if (cb) cb(null, '', ''); }),
    fork:     real.fork,
  };
});

jest.mock('../src/iat-sniffer', () => {
  const { EventEmitter } = require('events');
  return class FakeIATSniffer extends EventEmitter {
    constructor() { super(); this.isRunning = false; }
    start() { this.isRunning = true; }
    stop() { this.isRunning = false; }
    getMetrics() { return null; }
  };
});

jest.mock('../src/tsduck-monitor', () => {
  const { EventEmitter } = require('events');
  return class FakeTSDuckMonitor extends EventEmitter {
    constructor() { super(); }
    start() {}
    stop() {}
    suspend() {}
    resume() {}
  };
});

// SRTRelay mock — exposes a stable localUrl so _effectiveUrl is set correctly.
jest.mock('../src/srt-relay', () => {
  const { EventEmitter } = require('events');
  return class FakeSRTRelay extends EventEmitter {
    constructor({ id } = {}) {
      super();
      this.id = id;
      this.localUrl = 'udp://127.0.0.1:19000';
    }
    start() {}
    stop() {}
  };
});

jest.mock('../src/monitoring', () => {
  const { EventEmitter } = require('events');
  class FakePersistentThumbnailCapture extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.started = false;
    }
    start() { this.started = true; }
    stop() {}
    suspend(ms) { this.suspendedFor = ms; }
    resume() { this.resumed = true; }
  }
  return {
    captureThumbnail: jest.fn().mockResolvedValue('/logs/thumbnails/test.jpg'),
    PersistentThumbnailCapture: FakePersistentThumbnailCapture,
    sanitizeStreamId: (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '_'),
    parseSrtLatency: (url) => {
      const m = String(url || '').match(/[?&]latency=(\d+)/i);
      return m ? parseInt(m[1], 10) : 2000;
    },
    THUMBNAIL_DIR: '/tmp/labotech-test-thumbnails',
  };
});

jest.mock('../src/dolbye-adapter', () => {
  const { EventEmitter } = require('events');
  return class FakeDolbyEAdapter extends EventEmitter {
    constructor() { super(); }
    probe() { return Promise.resolve(null); }
  };
});

jest.mock('../src/tooling-preflight', () => ({
  isSltAvailable: () => false,
  getToolingPreflightSnapshot: () => ({}),
  startToolingPreflightAutoRefresh: () => {},
}));

// ── Test subject ─────────────────────────────────────────────────────────────

const TSAnalyser = require('../src/ts-analyser');

// ── Fake thumbnail client ─────────────────────────────────────────────────────

function makeFakeClient() {
  return {
    started: [],
    stopped: [],
    suspended: [],
    resumed: [],
    start(id, url, intervalSec) { this.started.push({ id, url, intervalSec }); },
    stop(id)                    { this.stopped.push(id); },
    suspend(id, durationMs)     { this.suspended.push({ id, durationMs }); },
    resume(id)                  { this.resumed.push(id); },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnalyser(url, extraOpts = {}) {
  return new TSAnalyser({ id: 'test-id', url, ...extraOpts });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 2 migration — TSAnalyser thumbnail delegation', () => {

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('stores injected thumbnailClient', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      expect(a._thumbnailClient).toBe(client);
    });

    test('_thumbnailClient defaults to null when not provided', () => {
      const a = makeAnalyser('udp://239.1.1.1:5000');
      expect(a._thumbnailClient).toBeNull();
    });
  });

  // ── startContinuous() — worker path ─────────────────────────────────────────

  describe('startContinuous() — worker path (direct SRT, RTP/UDP multicast)', () => {
    test('calls thumbnailClient.start() for RTP/UDP multicast', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();

      // Thumbnail start fires after jitter timer
      jest.runAllTimers();

      expect(client.started).toHaveLength(1);
      expect(client.started[0].id).toBe('test-id');
      expect(client.started[0].url).toBe('udp://239.1.1.1:5000');
      expect(client.started[0].intervalSec).toBeGreaterThan(0);

      a.stop();
    });

    test('calls thumbnailClient.start() for RTP multicast', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('rtp://239.1.1.2:1234', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      expect(client.started).toHaveLength(1);
      expect(client.started[0].url).toBe('rtp://239.1.1.2:1234');

      a.stop();
    });

    test('does NOT create in-process _persistentThumb when worker is active', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      expect(a._persistentThumb).toBeFalsy();

      a.stop();
    });

    test('does NOT call captureThumbnail in-process when worker is active', () => {
      const { captureThumbnail } = require('../src/monitoring');
      captureThumbnail.mockClear();

      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      expect(captureThumbnail).not.toHaveBeenCalled();

      a.stop();
    });
  });

  // ── startContinuous() — relay-backed SRT ────────────────────────────────────

  describe('startContinuous() — relay-backed SRT stays in-process', () => {
    test('does NOT call thumbnailClient.start() when relay is active', () => {
      const client = makeFakeClient();
      // SRT URL triggers FakeSRTRelay, which sets this._relay
      const a = makeAnalyser('srt://10.0.0.1:9000', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      // Relay should be set by the FakeSRTRelay mock
      expect(a._relay).not.toBeNull();
      // Worker must NOT be started — relay-backed path uses in-process one-shot
      expect(client.started).toHaveLength(0);

      a.stop();
    });

    test('uses in-process captureThumbnail loop for relay-backed SRT', () => {
      const { captureThumbnail } = require('../src/monitoring');
      captureThumbnail.mockClear();

      const client = makeFakeClient();
      const a = makeAnalyser('srt://10.0.0.1:9000', { thumbnailClient: client });
      a.startContinuous();
      // Fire jitter timer + one interval
      jest.runAllTimers();

      expect(captureThumbnail).toHaveBeenCalled();

      a.stop();
    });
  });

  // ── startContinuous() — no client (fallback) ────────────────────────────────

  describe('startContinuous() — no thumbnailClient (fallback paths)', () => {
    test('RTP/UDP multicast uses in-process captureThumbnail when no client', () => {
      const { captureThumbnail } = require('../src/monitoring');
      captureThumbnail.mockClear();

      const a = makeAnalyser('udp://239.1.1.1:5000');
      a.startContinuous();
      jest.runAllTimers();

      expect(captureThumbnail).toHaveBeenCalled();

      a.stop();
    });
  });

  // ── stop() ──────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    test('calls thumbnailClient.stop(id) when client is present', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      a.stop();

      expect(client.stopped).toContain('test-id');
    });

    test('does not throw when thumbnailClient is null', () => {
      const a = makeAnalyser('udp://239.1.1.1:5000');
      a.startContinuous();
      expect(() => a.stop()).not.toThrow();
    });

    test('clears thumbnail timer on stop', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();

      // Timer should be set (before jitter fires)
      expect(a._thumbnailTimer).not.toBeNull();

      a.stop();

      expect(a._thumbnailTimer).toBeNull();
    });
  });

  // ── getEtrStartDelay() ───────────────────────────────────────────────────────

  describe('getEtrStartDelay()', () => {
    test('returns delay for direct SRT with thumbnailClient', () => {
      const client = makeFakeClient();
      // Manually set up direct SRT state (no relay, with client)
      const a = makeAnalyser('srt://10.0.0.1:9000?latency=2000', { thumbnailClient: client });
      // Do NOT call startContinuous — set state manually to simulate direct SRT
      a._relay = null;
      const delay = a.getEtrStartDelay();
      expect(delay).toBeGreaterThan(0);
      // Should be latency (2000) + 15000 = 17000
      expect(delay).toBe(17000);
    });

    test('returns 0 for relay-backed SRT', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('srt://10.0.0.1:9000', { thumbnailClient: client });
      // Simulate relay active
      a._relay = { localUrl: 'udp://127.0.0.1:19000', stop: () => {} };
      expect(a.getEtrStartDelay()).toBe(0);
    });

    test('returns 0 for RTP/UDP (no SRT contention)', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      expect(a.getEtrStartDelay()).toBe(0);
    });

    test('returns 0 for direct SRT without thumbnailClient (no thumbnail active)', () => {
      const a = makeAnalyser('srt://10.0.0.1:9000?latency=2000');
      a._relay = null;
      // No thumbnailClient and no _persistentThumb — no slot contention
      expect(a.getEtrStartDelay()).toBe(0);
    });
  });

  // ── thumbnailClient.start() args ─────────────────────────────────────────────

  describe('thumbnailClient.start() receives correct intervalSec', () => {
    test('uses THUMBNAIL_INTERVAL_SEC env var when set', () => {
      process.env.THUMBNAIL_INTERVAL_SEC = '10';
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      expect(client.started[0].intervalSec).toBe(10);

      a.stop();
      delete process.env.THUMBNAIL_INTERVAL_SEC;
    });

    test('defaults to 5 when THUMBNAIL_INTERVAL_SEC is not set', () => {
      delete process.env.THUMBNAIL_INTERVAL_SEC;
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();
      jest.runAllTimers();

      expect(client.started[0].intervalSec).toBe(5);

      a.stop();
    });
  });

  // ── Idempotency ──────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    test('calling startContinuous() twice does not double-start worker', () => {
      const client = makeFakeClient();
      const a = makeAnalyser('udp://239.1.1.1:5000', { thumbnailClient: client });
      a.startContinuous();
      a.startContinuous(); // second call — isRunning guard should block
      jest.runAllTimers();

      expect(client.started).toHaveLength(1);

      a.stop();
    });
  });

});
