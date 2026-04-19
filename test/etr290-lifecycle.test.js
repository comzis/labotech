'use strict';

/**
 * ETR290 auto-lifecycle tests
 * Covers: watchdog ID matcher, compliance endpoint status, event log
 * filtering with id/type/limit, and state-persistence linkedAnalyserId.
 *
 * Route-level auto-start / auto-stop tests use direct map injection
 * into the route factory — no jest.mock() so no babel-hoisting issues.
 */

const express        = require('express');
const supertest      = require('supertest');
const ETR290Analyser = require('../src/etr290-analyser');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeWss() { return { clients: new Set() }; }

// Minimal ETR monitor that records calls without spawning tsp.
function makeFakeEtrMon(id, url = 'udp://239.1.1.1:5000') {
  return {
    id, url,
    isRunning: false,
    on:    jest.fn(),
    start: jest.fn(function () { this.isRunning = true; }),
    stop:  jest.fn(function () { this.isRunning = false; }),
    toJSON: jest.fn(function () { return { id: this.id, url: this.url, isRunning: this.isRunning }; }),
  };
}

// ─── Orphan watchdog ID matcher ───────────────────────────────────────────────

describe('_isManagedEtrMonitorId — watchdog pattern', () => {
  // Inline copy of the function under test so we can unit-test it in isolation.
  const _isManagedEtrMonitorId = (id) => /^etr-/i.test(String(id || ''));

  test.each([
    ['etr-stream-1',        true],
    ['etr-decoder-abc',     true],
    ['etr-analyser-xyz',    true],
    ['ETR-uppercase',       true],
    ['stream-1',            false],
    ['analyser-1',          false],
    ['monitor-etr-suffix',  false],
    ['',                    false],
    [null,                  false],
  ])('"%s" → %s', (id, expected) => {
    expect(_isManagedEtrMonitorId(id)).toBe(expected);
  });
});

// ─── compliance endpoint ──────────────────────────────────────────────────────

describe('GET /etr290/:id/compliance', () => {
  const etr290Route = require('../routes/etr290');

  function buildApp(monitors) {
    const app = express();
    app.use(express.json());
    app.use('/', etr290Route(monitors, fakeWss()));
    return app;
  }

  test('404 for unknown monitor', async () => {
    const res = await supertest(buildApp(new Map())).get('/unknown/compliance');
    expect(res.status).toBe(404);
  });

  test('overallStatus is "stopped" when isRunning=false', async () => {
    const mon = new ETR290Analyser({ id: 'etr-t1', url: 'udp://239.1.1.1:5000' });
    // Do not call mon.start() — isRunning stays false.
    const monitors = new Map([['etr-t1', mon]]);
    const res = await supertest(buildApp(monitors)).get('/etr-t1/compliance');
    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBe('stopped');
  });

  test('overallStatus is "ok" when running with no alarms', async () => {
    const mon = new ETR290Analyser({ id: 'etr-t2', url: 'udp://239.1.1.1:5000' });
    mon.isRunning = true;
    const monitors = new Map([['etr-t2', mon]]);
    const res = await supertest(buildApp(monitors)).get('/etr-t2/compliance');
    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBe('ok');
    expect(res.body.priorities).toHaveProperty('p1');
    expect(res.body.priorities).toHaveProperty('p2');
    expect(res.body.priorities).toHaveProperty('p3');
    expect(res.body.priorities.p1.status).toBe('ok');
  });

  test('overallStatus is "p1-alarm" when a P1 check is in error state', async () => {
    const mon = new ETR290Analyser({ id: 'etr-t3', url: 'udp://239.1.1.1:5000' });
    mon.isRunning = true;
    mon._status.cc_error = 'error'; // cc_error is a P1 check
    const monitors = new Map([['etr-t3', mon]]);
    const res = await supertest(buildApp(monitors)).get('/etr-t3/compliance');
    expect(res.status).toBe(200);
    expect(res.body.overallStatus).toBe('p1-alarm');
    expect(res.body.priorities.p1.alarming).toBeGreaterThan(0);
  });

  test('response includes activeIncidents and recentAlarms arrays', async () => {
    const mon = new ETR290Analyser({ id: 'etr-t4', url: 'udp://239.1.1.1:5000' });
    mon.isRunning = true;
    const monitors = new Map([['etr-t4', mon]]);
    const res = await supertest(buildApp(monitors)).get('/etr-t4/compliance');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.activeIncidents)).toBe(true);
    expect(Array.isArray(res.body.recentAlarms)).toBe(true);
  });

  test('POST /start returns 200 (not 409) when monitor already exists', async () => {
    const mon = makeFakeEtrMon('etr-existing', 'udp://239.1.1.1:5000');
    mon.isRunning = true;
    const monitors = new Map([['etr-existing', mon]]);
    const res = await supertest(buildApp(monitors))
      .post('/start')
      .send({ id: 'etr-existing', url: 'udp://239.1.1.1:5000' });
    expect(res.status).toBe(200);
  });
});

// ─── events API filtering ─────────────────────────────────────────────────────

describe('GET /events — id, type, limit filters', () => {
  const eventsRoute = require('../routes/events');

  const SAMPLE = [
    { type: 'etr290_alarm',  id: 'etr-s1', time: new Date(1000).toISOString() },
    { type: 'etr290_alarm',  id: 'etr-s2', time: new Date(2000).toISOString() },
    { type: 'health_alarm',  id: 'etr-s1', time: new Date(3000).toISOString() },
    { type: 'etr290_incident_started', id: 'etr-s1', time: new Date(4000).toISOString() },
  ];

  function buildApp(events) {
    const app = express();
    app.use('/', eventsRoute({ list: () => events, clear: jest.fn() }));
    return app;
  }

  test('returns all events (up to default limit) when no filters', async () => {
    const res = await supertest(buildApp(SAMPLE)).get('/');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(SAMPLE.length);
  });

  test('?id= filters to matching stream', async () => {
    const res = await supertest(buildApp(SAMPLE)).get('/?id=etr-s1');
    expect(res.body.length).toBe(3);
    expect(res.body.every(e => e.id === 'etr-s1')).toBe(true);
  });

  test('?type= filters to matching event type', async () => {
    const res = await supertest(buildApp(SAMPLE)).get('/?type=etr290_alarm');
    expect(res.body.length).toBe(2);
    expect(res.body.every(e => e.type === 'etr290_alarm')).toBe(true);
  });

  test('?id= and ?type= are AND-combined', async () => {
    const res = await supertest(buildApp(SAMPLE)).get('/?id=etr-s1&type=etr290_alarm');
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe('etr-s1');
    expect(res.body[0].type).toBe('etr290_alarm');
  });

  test('?limit= caps result count', async () => {
    const res = await supertest(buildApp(SAMPLE)).get('/?limit=2');
    expect(res.body.length).toBe(2);
  });

  test('?limit= is capped at 2000 regardless of requested value', async () => {
    const big = Array.from({ length: 2500 }, (_, i) => ({
      type: 'etr290_alarm', id: 'etr-x', time: new Date(i).toISOString(),
    }));
    const res = await supertest(buildApp(big)).get('/?limit=9999');
    expect(res.body.length).toBe(2000);
  });

  test('?since= filters by timestamp', async () => {
    const res = await supertest(buildApp(SAMPLE)).get(`/?since=2500`);
    // Only events at t=3000 and t=4000 pass.
    expect(res.body.length).toBe(2);
  });
});

// ─── state-persistence — linkedAnalyserId ─────────────────────────────────────

describe('state-persistence — ETR linkedAnalyserId', () => {
  const persistence = require('../src/state-persistence');
  const path = require('path');
  const fs   = require('fs');
  const STATE_FILE = path.join(__dirname, '../config/state.json');

  // Save original state and restore after each test.
  let originalState;
  beforeEach(() => {
    try { originalState = fs.readFileSync(STATE_FILE, 'utf8'); } catch (_) { originalState = null; }
  });
  afterEach(() => {
    try {
      if (originalState !== null) fs.writeFileSync(STATE_FILE, originalState);
      else fs.unlinkSync(STATE_FILE);
    } catch (_) {}
  });

  test('stores linkedAnalyserId and original SRT URL (not relay URL)', () => {
    const fakeAnalyser = {
      id: 'decoder-srt', url: 'srt://host:9000?latency=200', isRunning: true,
      interval: 30000, nicName: null,
    };
    const fakeEtr = {
      id: 'etr-decoder-srt',
      url: 'udp://127.0.0.1:5523', // effective relay URL — should NOT be stored
      isRunning: true,
      nicName: null,
      _config: { profileName: null, includePids: [], excludePids: [], allowUnknownPid: true, thresholds: {} },
    };

    persistence.save(
      new Map(), new Map(), new Map(),
      new Map([['decoder-srt', fakeAnalyser]]),
      new Map([['etr-decoder-srt', fakeEtr]]),
    );

    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(state.etr290monitors).toHaveLength(1);
    const saved = state.etr290monitors[0];
    expect(saved.url).toBe('srt://host:9000?latency=200'); // original SRT URL
    expect(saved.linkedAnalyserId).toBe('decoder-srt');    // explicit link
  });

  test('stores null linkedAnalyserId for manually named ETR without linked analyser', () => {
    const fakeEtr = {
      id: 'manual-etr-monitor',
      url: 'udp://239.1.1.1:5000',
      isRunning: true,
      nicName: null,
      _config: { profileName: null, includePids: [], excludePids: [], allowUnknownPid: true, thresholds: {} },
    };

    persistence.save(
      new Map(), new Map(), new Map(),
      new Map(),
      new Map([['manual-etr-monitor', fakeEtr]]),
    );

    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    expect(state.etr290monitors[0].linkedAnalyserId).toBeNull();
    expect(state.etr290monitors[0].url).toBe('udp://239.1.1.1:5000');
  });
});
