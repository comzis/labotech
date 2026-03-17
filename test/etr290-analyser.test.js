const ETR290Analyser = require('../src/etr290-analyser');

describe('ETR290Analyser parser patterns', () => {
  test('registers continuity counter failures as cc_error', () => {
    const a = new ETR290Analyser({ id: 'etr-test', url: 'udp://239.1.1.1:1234' });
    a._parseLine('[mpegts @ 0x0] Continuity check failed for pid 256 expected 4 got 6');
    expect(a._counts.cc_error).toBeGreaterThan(0);
    expect(a._status.cc_error).toBe('error');
  });

  test('registers timestamp discontinuity wording as pcr_disc', () => {
    const a = new ETR290Analyser({ id: 'etr-test', url: 'udp://239.1.1.1:1234' });
    // pcr_disc has a default burst threshold of 3 (processing-noise filter).
    // Pattern must match on first hit, but incident only escalates after 3 hits.
    a._parseLine('[mpegts @ 0x0] time stamp discontinuity detected on pid 100');
    expect(a._counts.pcr_disc).toBe(1);
    expect(a._status.pcr_disc).toBe('ok'); // pending — threshold not yet reached
    a._parseLine('[mpegts @ 0x0] time stamp discontinuity detected on pid 100');
    a._parseLine('[mpegts @ 0x0] time stamp discontinuity detected on pid 100');
    expect(a._counts.pcr_disc).toBe(3);
    expect(a._status.pcr_disc).toBe('error');
  });

  test('creates and clears active incident lifecycle', () => {
    const a = new ETR290Analyser({ id: 'etr-test', url: 'udp://239.1.1.1:1234' });
    const started = [];
    const cleared = [];
    a.on('incident_started', (evt) => started.push(evt));
    a.on('incident_cleared', (evt) => cleared.push(evt));

    const before = Date.now();
    a._parseLine('[mpegts @ 0x0] Continuity check failed for pid 300 expected 2 got 4');
    expect(started.length).toBe(1);
    expect(started[0].checkId).toBe('cc_error');
    expect(started[0].pid).toBe(300);
    expect(a._status.cc_error).toBe('error');

    const changed = a._clearStaleIncidents(before + 60 * 1000);
    expect(changed).toBe(true);
    expect(cleared.length).toBe(1);
    expect(cleared[0].status).toBe('cleared');
    expect(a._status.cc_error).toBe('ok');
  });

  test('burst window resets pending count for stale single-blip matches', () => {
    const a = new ETR290Analyser({
      id: 'etr-burst',
      url: 'udp://239.1.1.1:1234',
      config: { thresholds: { transport_error: 3 } },
    });
    const started = [];
    a.on('incident_started', (evt) => started.push(evt));

    // Two isolated blips, each within burst window of each other
    a._parseLine('[mpegts @ 0x0] Packet corrupt (stream = 0, dts = 100), dropping it.');
    a._parseLine('[mpegts @ 0x0] Packet corrupt (stream = 0, dts = 200), dropping it.');
    expect(a._counts.transport_error).toBe(2);
    expect(a._status.transport_error).toBe('ok'); // still pending

    // Simulate burst window expiry by back-dating the last match timestamp
    a._pendingLastMatchAt.transport_error = Date.now() - 60000;

    // Third blip — arrives after the burst window, so pending count resets to 1
    a._parseLine('[mpegts @ 0x0] Packet corrupt (stream = 0, dts = 300), dropping it.');
    expect(a._status.transport_error).toBe('ok'); // count reset to 1, still pending
    expect(started.length).toBe(0);
  });

  test('respects per-check threshold before raising incident', () => {
    const a = new ETR290Analyser({
      id: 'etr-threshold',
      url: 'udp://239.1.1.1:1234',
      config: { thresholds: { cc_error: 2 } },
    });
    const started = [];
    a.on('incident_started', (evt) => started.push(evt));

    a._parseLine('[mpegts @ 0x0] Continuity check failed for pid 256 expected 4 got 6');
    expect(a._counts.cc_error).toBe(1);
    expect(a._status.cc_error).toBe('ok');
    expect(started.length).toBe(0);

    a._parseLine('[mpegts @ 0x0] Continuity check failed for pid 256 expected 5 got 7');
    expect(a._counts.cc_error).toBe(2);
    expect(a._status.cc_error).toBe('error');
    expect(started.length).toBe(1);
  });

  test('startup grace suppresses incidents but still counts matches', () => {
    const a = new ETR290Analyser({
      id: 'etr-grace',
      url: 'udp://239.1.1.1:1234',
      config: { thresholds: { transport_error: 1 } },
    });
    const started = [];
    a.on('incident_started', (evt) => started.push(evt));

    // Simulate just-started (within 5s grace)
    a._startedAt = Date.now();

    // RTP join artefact — should count but NOT raise incident during grace
    a._parseLine('[rtpproto @ 0x0] RTP: missed 3 packets');
    expect(a._counts.transport_error).toBe(1);
    expect(a._status.transport_error).toBe('ok');
    expect(started.length).toBe(0);

    // Expire grace by back-dating _startedAt
    a._startedAt = Date.now() - 10000;

    // Same error after grace — incident must fire
    a._parseLine('[rtpproto @ 0x0] RTP: missed 3 packets');
    expect(a._counts.transport_error).toBe(2);
    expect(a._status.transport_error).toBe('error');
    expect(started.length).toBe(1);
  });

  test('filters alarms by included PID list', () => {
    const a = new ETR290Analyser({
      id: 'etr-pid-filter',
      url: 'udp://239.1.1.1:1234',
      config: { includePids: [300], allowUnknownPid: false },
    });

    a._parseLine('[mpegts @ 0x0] Continuity check failed for pid 256 expected 4 got 6');
    expect(a._counts.cc_error).toBe(0);
    expect(a._status.cc_error).toBe('ok');

    a._parseLine('[mpegts @ 0x0] Continuity check failed for pid 300 expected 4 got 6');
    expect(a._counts.cc_error).toBe(1);
    expect(a._status.cc_error).toBe('error');
  });
});
