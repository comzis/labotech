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
    spawn
      .mockImplementationOnce(() => makeProc(1))
      .mockImplementationOnce(() => makeProc(1))
      .mockImplementationOnce(() => makeProc(0));

    const out = await monitoring.captureThumbnail('decoder-1', 'rtp://239.100.17.7:6501');
    expect(out).toContain('/logs/thumbnails/decoder-1.jpg');
    expect(spawn).toHaveBeenCalledTimes(3);

    const firstArgs = spawn.mock.calls[0][1];
    const firstFilter = firstArgs[firstArgs.indexOf('-vf') + 1];
    expect(firstFilter).toContain('select=eq(pict_type\\,I)');
    expect(firstArgs).toContain('-skip_frame');
    expect(firstFilter).toContain('pp=de/de');

    const secondArgs = spawn.mock.calls[1][1];
    const secondFilter = secondArgs[secondArgs.indexOf('-vf') + 1];
    expect(secondFilter).toContain('select=eq(pict_type\\,I)');
    expect(secondArgs).toContain('-skip_frame');
    expect(secondFilter).not.toContain('pp=de/de');

    const thirdArgs = spawn.mock.calls[2][1];
    const thirdFilter = thirdArgs[thirdArgs.indexOf('-vf') + 1];
    expect(thirdFilter).not.toContain('select=eq(pict_type\\,I)');
    expect(thirdArgs).not.toContain('-skip_frame');
  });
});
