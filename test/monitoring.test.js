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
  proc.kill = jest.fn();
  setTimeout(() => proc.emit('exit', exitCode), delayMs);
  return proc;
}

describe('monitoring.captureThumbnail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('falls back to relaxed frame selection when strict I-frame pass fails', async () => {
    spawn
      .mockImplementationOnce(() => makeProc(1))
      .mockImplementationOnce(() => makeProc(0));

    const out = await monitoring.captureThumbnail('decoder-1', 'rtp://239.100.17.7:6501');
    expect(out).toContain('/logs/thumbnails/decoder-1.jpg');
    expect(spawn).toHaveBeenCalledTimes(2);

    const firstArgs = spawn.mock.calls[0][1];
    const firstFilter = firstArgs[firstArgs.indexOf('-vf') + 1];
    expect(firstFilter).toContain('select=eq(pict_type\\,I)');
    expect(firstArgs).toContain('-skip_frame');

    const secondArgs = spawn.mock.calls[1][1];
    const secondFilter = secondArgs[secondArgs.indexOf('-vf') + 1];
    expect(secondFilter).not.toContain('select=eq(pict_type\\,I)');
    expect(secondArgs).not.toContain('-skip_frame');
  });
});
