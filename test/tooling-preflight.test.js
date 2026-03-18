'use strict';

const { refreshToolingPreflight, getToolingPreflightSnapshot } = require('../src/tooling-preflight');

describe('tooling-preflight — srtProtocol check', () => {
  it('snapshot includes srtProtocol field with available boolean', async () => {
    const snap = await refreshToolingPreflight();
    expect(snap).toHaveProperty('srtProtocol');
    expect(typeof snap.srtProtocol.available).toBe('boolean');
    expect(typeof snap.srtProtocol.reason).toBe('string');
  });

  it('getToolingPreflightSnapshot reflects the last refresh', async () => {
    await refreshToolingPreflight();
    const snap = getToolingPreflightSnapshot();
    expect(snap).toHaveProperty('srtProtocol');
    expect(snap.srtProtocol.available).not.toBeNull();
  });

  it('snapshot includes all expected top-level keys', async () => {
    const snap = await refreshToolingPreflight();
    expect(snap).toHaveProperty('status');
    expect(snap).toHaveProperty('checkedAt');
    expect(snap).toHaveProperty('tools');
    expect(snap).toHaveProperty('srtProtocol');
    expect(snap).toHaveProperty('nicCapture');
  });
});
