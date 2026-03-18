'use strict';

const path = require('path');
const { EventEmitter } = require('events');
const { fork } = require('child_process');

class ThumbnailWorkerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this._workerPath = options.workerPath || path.join(__dirname, 'thumbnail-worker.js');
    this._forkFn = options.forkFn || fork;
    this._restartDelayMs = Math.max(1000, Number(options.restartDelayMs) || 2000);
    this._maxRestartDelayMs = Math.max(this._restartDelayMs, Number(options.maxRestartDelayMs) || 30000);
    this._active = new Map(); // id -> { url, intervalSec }
    this._worker = null;
    this._respawnTimer = null;
    this._shuttingDown = false;
    this._awaitingReplay = false;
    this._shutdownResolver = null;
    this._spawnWorker();
  }

  _toSafeInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  _spawnWorker() {
    if (this._shuttingDown) return;
    if (this._worker) return;
    const child = this._forkFn(this._workerPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    this._worker = child;
    child.on('message', (msg) => this._onWorkerMessage(msg));
    child.on('exit', (code, signal) => this._onWorkerExit(code, signal));
  }

  _send(message) {
    if (!this._worker || !this._worker.connected) return false;
    try {
      this._worker.send(message);
      return true;
    } catch (_) {
      return false;
    }
  }

  _onWorkerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.event === 'ready') {
      if (this._awaitingReplay) {
        this._replayActiveCaptures();
        this._awaitingReplay = false;
        this.emit('worker_restarted');
      }
      this.emit('ready');
      return;
    }
    if (msg.event === 'frame') {
      this.emit('frame', msg.id, msg.url, msg.path);
      return;
    }
    if (msg.event === 'error') {
      if (this.listenerCount('error') > 0) {
        this.emit('error', { id: msg.id, message: msg.message });
      } else {
        this.emit('worker_error', { id: msg.id, message: msg.message });
      }
      return;
    }
    if (msg.event === 'shutdown_complete') {
      this._finalizeShutdown();
    }
  }

  _onWorkerExit(code, signal) {
    this._worker = null;
    if (this._shuttingDown) {
      this._finalizeShutdown();
      return;
    }
    this._scheduleRespawn(code, signal);
  }

  _scheduleRespawn(code, signal) {
    if (this._shuttingDown) return;
    if (this._respawnTimer) return;
    const delay = this._restartDelayMs;
    this._restartDelayMs = Math.min(this._restartDelayMs * 2, this._maxRestartDelayMs);
    this._respawnTimer = setTimeout(() => {
      this._respawnTimer = null;
      this._awaitingReplay = true;
      this._spawnWorker();
    }, delay);
    this.emit('worker_exit', { code, signal, restartInMs: delay });
  }

  _replayActiveCaptures() {
    for (const [id, data] of this._active.entries()) {
      this._send({
        cmd: 'start',
        id,
        url: data.url,
        intervalSec: data.intervalSec,
      });
    }
  }

  start(id, url, intervalSec) {
    const streamId = String(id || '').trim();
    const sourceUrl = String(url || '').trim();
    if (!streamId || !sourceUrl) return;
    const sec = this._toSafeInt(intervalSec, 5);
    this._active.set(streamId, { url: sourceUrl, intervalSec: sec });
    this._send({ cmd: 'start', id: streamId, url: sourceUrl, intervalSec: sec });
  }

  stop(id) {
    const streamId = String(id || '').trim();
    if (!streamId) return;
    this._active.delete(streamId);
    this._send({ cmd: 'stop', id: streamId });
  }

  suspend(id, durationMs) {
    const streamId = String(id || '').trim();
    if (!streamId) return;
    const ms = this._toSafeInt(durationMs, 0);
    if (ms <= 0) return;
    this._send({ cmd: 'suspend', id: streamId, durationMs: ms });
  }

  resume(id) {
    const streamId = String(id || '').trim();
    if (!streamId) return;
    this._send({ cmd: 'resume', id: streamId });
  }

  _finalizeShutdown() {
    if (this._respawnTimer) {
      clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    const resolver = this._shutdownResolver;
    this._shutdownResolver = null;
    if (resolver) resolver();
  }

  shutdown() {
    if (this._shuttingDown) {
      return this._shutdownResolver ? new Promise((resolve) => {
        const prev = this._shutdownResolver;
        this._shutdownResolver = () => { prev(); resolve(); };
      }) : Promise.resolve();
    }
    this._shuttingDown = true;
    if (this._respawnTimer) {
      clearTimeout(this._respawnTimer);
      this._respawnTimer = null;
    }
    return new Promise((resolve) => {
      this._shutdownResolver = resolve;
      if (!this._worker) {
        this._finalizeShutdown();
        return;
      }
      const sent = this._send({ cmd: 'shutdown' });
      if (!sent) {
        try { this._worker.kill('SIGTERM'); } catch (_) {}
      }
      setTimeout(() => {
        if (this._shutdownResolver) {
          try { if (this._worker) this._worker.kill('SIGTERM'); } catch (_) {}
          this._finalizeShutdown();
        }
      }, 5000);
    });
  }
}

module.exports = {
  ThumbnailWorkerClient,
};
