'use strict';

const { EventEmitter } = require('events');
const { ThumbnailWorkerRuntime } = require('../src/thumbnail-worker');
const { ThumbnailWorkerClient } = require('../src/thumbnail-worker-client');

class FakeCapture extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.started = false;
    this.stopped = false;
    this.suspendedFor = 0;
    this.resumed = false;
  }
  start() { this.started = true; return this; }
  stop() { this.stopped = true; }
  suspend(ms) { this.suspendedFor = ms; }
  resume() { this.resumed = true; }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.sent = [];
    this.killed = null;
  }
  send(msg) { this.sent.push(msg); }
  kill(signal) {
    this.killed = signal || 'SIGTERM';
    this.connected = false;
    this.emit('exit', null, this.killed);
  }
}

describe('ThumbnailWorkerRuntime', () => {
  test('handles start/suspend/resume/stop command lifecycle', async () => {
    const emitted = [];
    const runtime = new ThumbnailWorkerRuntime({
      CaptureClass: FakeCapture,
      send: (msg) => emitted.push(msg),
    });

    runtime._onMessage({ cmd: 'start', id: 'lane-1', url: 'srt://source', intervalSec: 5 });
    const entry = runtime._captures.get('lane-1');
    expect(entry).toBeDefined();
    expect(entry.capture.started).toBe(true);
    expect(entry.capture.opts.streamId).toBe('lane-1');

    runtime._onMessage({ cmd: 'suspend', id: 'lane-1', durationMs: 12000 });
    expect(entry.capture.suspendedFor).toBe(12000);

    runtime._onMessage({ cmd: 'resume', id: 'lane-1' });
    expect(entry.capture.resumed).toBe(true);

    entry.capture.emit('frame', '/tmp/lane-1.jpg');
    expect(emitted.some((m) => m.event === 'frame' && m.id === 'lane-1')).toBe(true);

    runtime._onMessage({ cmd: 'stop', id: 'lane-1' });
    expect(entry.capture.stopped).toBe(true);
    expect(runtime._captures.has('lane-1')).toBe(false);

    await runtime.shutdown();
    expect(emitted.some((m) => m.event === 'shutdown_complete')).toBe(true);
  });

  test('sends error on unknown command', () => {
    const emitted = [];
    const runtime = new ThumbnailWorkerRuntime({
      CaptureClass: FakeCapture,
      send: (msg) => emitted.push(msg),
    });
    runtime._onMessage({ cmd: 'invalid', id: 'lane-2' });
    expect(emitted.some((m) => m.event === 'error')).toBe(true);
  });
});

describe('ThumbnailWorkerClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('replays active captures after worker restart', () => {
    const children = [];
    const forkFn = () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    };

    const client = new ThumbnailWorkerClient({
      forkFn,
      restartDelayMs: 1000,
      maxRestartDelayMs: 2000,
    });

    client.start('lane-a', 'udp://239.1.1.1:5000', 7);
    expect(children[0].sent.some((m) => m.cmd === 'start' && m.id === 'lane-a')).toBe(true);

    let restarted = false;
    client.on('worker_restarted', () => { restarted = true; });

    children[0].emit('exit', 1, null);
    jest.advanceTimersByTime(1000);
    expect(children).toHaveLength(2);

    children[1].emit('message', { event: 'ready' });
    expect(restarted).toBe(true);
    expect(children[1].sent.some((m) => m.cmd === 'start' && m.id === 'lane-a')).toBe(true);
  });

  test('shutdown waits for shutdown_complete', async () => {
    const children = [];
    const client = new ThumbnailWorkerClient({
      forkFn: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
    });

    const p = client.shutdown();
    expect(children[0].sent.some((m) => m.cmd === 'shutdown')).toBe(true);
    children[0].emit('message', { event: 'shutdown_complete' });
    await expect(p).resolves.toBeUndefined();
  });

  test('routes worker error to worker_error when no error listener exists', () => {
    const events = [];
    const client = new ThumbnailWorkerClient({
      forkFn: () => new FakeChild(),
    });
    client.on('worker_error', (e) => events.push(e));
    client._onWorkerMessage({ event: 'error', id: 'lane-x', message: 'boom' });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('lane-x');
  });
});
