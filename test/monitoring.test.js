'use strict';

const { EventEmitter } = require('events');

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  rename: jest.fn((from, to, cb) => cb(null)),
  unlinkSync: jest.fn(),
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execFile: jest.fn(),
}));

const { spawn } = require('child_process');
const monitoring = require('../src/monitoring');

function makeProc(exitCode, delayMs = 0) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  setTimeout(() => proc.emit('exit', exitCode), delayMs);
  return proc;
}

describe('monitoring.captureThumbnail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('falls back through strict/relaxed attempts when initial passes fail', async () => {
    // Attempts 1-3: I-frame only (nokey). Attempt 4: any-frame fallback.
    // All four fail → rejects (tested separately). Here succeed on attempt 3.
    spawn
      .mockImplementationOnce(() => makeProc(1))  // attempt 1: full quality I-frame
      .mockImplementationOnce(() => makeProc(1))  // attempt 2: I-frame, no deblock
      .mockImplementationOnce(() => makeProc(0)); // attempt 3: I-frame, bare scale

    const out = await monitoring.captureThumbnail('decoder-1', 'rtp://239.100.17.7:6501');
    expect(out).toContain('/logs/thumbnails/decoder-1.jpg');
    expect(spawn).toHaveBeenCalledTimes(3);

    // Attempt 1: I-frame (skip_frame nokey) + deblock — select=eq(pict_type\,I) removed
    // because -skip_frame nokey does not set pict_type, causing select to match nothing.
    const firstArgs = spawn.mock.calls[0][1];
    const firstFilter = firstArgs[firstArgs.indexOf('-vf') + 1];
    expect(firstFilter).not.toContain('select=eq(pict_type');
    expect(firstArgs).toContain('-skip_frame');
    const skipIdx1 = firstArgs.indexOf('-skip_frame');
    expect(firstArgs[skipIdx1 + 1]).toBe('nokey');
    expect(firstFilter).toContain('pp=de/de');

    // Attempt 2: I-frame, no deblock
    const secondArgs = spawn.mock.calls[1][1];
    const secondFilter = secondArgs[secondArgs.indexOf('-vf') + 1];
    expect(secondFilter).not.toContain('select=eq(pict_type');
    expect(secondArgs).toContain('-skip_frame');
    const skipIdx2 = secondArgs.indexOf('-skip_frame');
    expect(secondArgs[skipIdx2 + 1]).toBe('nokey');
    expect(secondFilter).not.toContain('pp=de/de');

    // Attempt 3: I-frame, bare scale (no quality filters)
    const thirdArgs = spawn.mock.calls[2][1];
    const thirdFilter = thirdArgs[thirdArgs.indexOf('-vf') + 1];
    expect(thirdFilter).not.toContain('select=eq(pict_type');
    expect(thirdArgs).toContain('-skip_frame');
    const skipIdx3 = thirdArgs.indexOf('-skip_frame');
    expect(thirdArgs[skipIdx3 + 1]).toBe('nokey');
    expect(thirdFilter).not.toContain('pp=de/de');
    expect(thirdFilter).not.toContain('hqdn3d');
  });

  test('attempt 4 drops I-frame requirement when all strict passes fail', async () => {
    spawn
      .mockImplementationOnce(() => makeProc(1))  // attempt 1
      .mockImplementationOnce(() => makeProc(1))  // attempt 2
      .mockImplementationOnce(() => makeProc(1))  // attempt 3
      .mockImplementationOnce(() => makeProc(0)); // attempt 4: any-frame fallback

    const out = await monitoring.captureThumbnail('decoder-fallback', 'rtp://239.100.17.7:6501');
    expect(out).toContain('/logs/thumbnails/decoder-fallback.jpg');
    expect(spawn).toHaveBeenCalledTimes(4);

    const fourthArgs = spawn.mock.calls[3][1];
    const fourthFilter = fourthArgs[fourthArgs.indexOf('-vf') + 1];
    // Fallback path uses thumbnail=N filter, not select=I-frame
    expect(fourthFilter).not.toContain('select=eq(pict_type\\,I)');
    expect(fourthArgs).not.toContain('-skip_frame');
    expect(fourthFilter).toContain('thumbnail=');
  });

  test('normalizes custom decoder IDs for thumbnail filenames', async () => {
    spawn.mockImplementationOnce(() => makeProc(0));
    const out = await monitoring.captureThumbnail('WE M4 FEED A Bu', 'rtp://239.100.17.7:6501');
    expect(out).toMatch(/\/logs\/thumbnails\/WE_M4_FEED_A_Bu_[a-z0-9]+\.jpg$/i);
  });
});
