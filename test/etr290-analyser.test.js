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
    a._parseLine('[mpegts @ 0x0] time stamp discontinuity detected on pid 100');
    expect(a._counts.pcr_disc).toBeGreaterThan(0);
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
});
