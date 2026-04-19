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

  test('attempt 1 uses thumbnail=pick + deblock, no -skip_frame nokey', async () => {
    spawn.mockImplementationOnce(() => makeProc(0));

    const out = await monitoring.captureThumbnail('decoder-1', 'rtp://239.100.17.7:6501');
    expect(out).toContain('/logs/thumbnails/decoder-1.jpg');
    expect(spawn).toHaveBeenCalledTimes(1);

    const args = spawn.mock.calls[0][1];
    const vf = args[args.indexOf('-vf') + 1];
    // thumbnail=pick filter used (no -skip_frame nokey, no select=I-frame)
    expect(vf).toContain('thumbnail=');
    expect(vf).not.toContain('select=eq(pict_type');
    expect(args).not.toContain('-skip_frame');
  });

  test('falls back to attempt 2 (no deblock) when attempt 1 fails', async () => {
    spawn
      .mockImplementationOnce(() => makeProc(1))  // attempt 1: with deblock — fails (pp unavailable)
      .mockImplementationOnce(() => makeProc(0)); // attempt 2: bare scale — succeeds

    const out = await monitoring.captureThumbnail('decoder-2', 'rtp://239.100.17.7:6501');
    expect(out).toContain('/logs/thumbnails/decoder-2.jpg');
    expect(spawn).toHaveBeenCalledTimes(2);

    const firstArgs = spawn.mock.calls[0][1];
    const firstVf = firstArgs[firstArgs.indexOf('-vf') + 1];
    expect(firstVf).toContain('thumbnail=');
    expect(firstVf).toContain('pp=de/de');

    const secondArgs = spawn.mock.calls[1][1];
    const secondVf = secondArgs[secondArgs.indexOf('-vf') + 1];
    expect(secondVf).toContain('thumbnail=');
    expect(secondVf).not.toContain('pp=de/de');
  });

  test('rejects when both attempts fail', async () => {
    spawn
      .mockImplementationOnce(() => makeProc(1))
      .mockImplementationOnce(() => makeProc(1));

    await expect(
      monitoring.captureThumbnail('decoder-fail', 'rtp://239.100.17.7:6501')
    ).rejects.toThrow();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('normalizes custom decoder IDs for thumbnail filenames', async () => {
    spawn.mockImplementationOnce(() => makeProc(0));
    const out = await monitoring.captureThumbnail('WE M4 FEED A Bu', 'rtp://239.100.17.7:6501');
    expect(out).toMatch(/\/logs\/thumbnails\/WE_M4_FEED_A_Bu_[a-z0-9]+\.jpg$/i);
  });
});
