'use strict';

const { PersistentThumbnailCapture } = require('./monitoring');

class ThumbnailWorkerRuntime {
  constructor(options = {}) {
    this._CaptureClass = options.CaptureClass || PersistentThumbnailCapture;
    this._send = typeof options.send === 'function'
      ? options.send
      : ((msg) => { if (typeof process.send === 'function') process.send(msg); });
    this._captures = new Map(); // id -> { capture, url, frameHandler, errorHandler }
    this._shuttingDown = false;
    this._boundOnMessage = this._onMessage.bind(this);
    this._boundOnSigterm = this._onSigterm.bind(this);
  }

  start() {
    process.on('message', this._boundOnMessage);
    process.on('SIGTERM', this._boundOnSigterm);
    this._send({ event: 'ready' });
  }

  _onSigterm() {
    this.shutdown().finally(() => {
      process.exit(0);
    });
  }

  _toErrorMessage(err, fallback) {
    if (err && err.message) return String(err.message);
    return fallback;
  }

  _onMessage(message) {
    if (!message || typeof message !== 'object') return;
    const cmd = String(message.cmd || '');
    switch (cmd) {
      case 'start':
        this._handleStart(message);
        break;
      case 'stop':
        this._handleStop(message);
        break;
      case 'suspend':
        this._handleSuspend(message);
        break;
      case 'resume':
        this._handleResume(message);
        break;
      case 'shutdown':
        this.shutdown().finally(() => {
          process.exit(0);
        });
        break;
      default:
        this._send({
          event: 'error',
          id: message.id || null,
          message: `Unknown worker command: ${cmd || '<empty>'}`,
        });
        break;
    }
  }

  _safeStop(id) {
    const existing = this._captures.get(id);
    if (!existing) return;
    try {
      existing.capture.stop();
    } catch (_) {}
    if (typeof existing.capture.removeListener === 'function') {
      existing.capture.removeListener('frame', existing.frameHandler);
      existing.capture.removeListener('error', existing.errorHandler);
    }
    this._captures.delete(id);
  }

  _handleStart(message) {
    const id = String(message.id || '').trim();
    const url = String(message.url || '').trim();
    const intervalRaw = Number(message.intervalSec);
    const intervalSec = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 5;
    if (!id || !url) {
      this._send({ event: 'error', id: id || null, message: 'start requires id and url' });
      return;
    }

    this._safeStop(id);

    const capture = new this._CaptureClass({
      streamId: id,
      inputUrl: url,
      intervalSec,
    });
    const frameHandler = (filePath) => {
      this._send({ event: 'frame', id, path: filePath, url });
    };
    const errorHandler = (err) => {
      this._send({ event: 'error', id, message: this._toErrorMessage(err, 'thumbnail capture error') });
    };
    capture.on('frame', frameHandler);
    capture.on('error', errorHandler);
    capture.start();
    this._captures.set(id, { capture, url, frameHandler, errorHandler });
  }

  _handleStop(message) {
    const id = String(message.id || '').trim();
    if (!id) return;
    this._safeStop(id);
  }

  _handleSuspend(message) {
    const id = String(message.id || '').trim();
    const durationRaw = Number(message.durationMs);
    const durationMs = Number.isFinite(durationRaw) && durationRaw > 0 ? Math.floor(durationRaw) : 0;
    if (!id || durationMs <= 0) return;
    const existing = this._captures.get(id);
    if (!existing) return;
    try {
      existing.capture.suspend(durationMs);
    } catch (err) {
      this._send({ event: 'error', id, message: this._toErrorMessage(err, 'suspend failed') });
    }
  }

  _handleResume(message) {
    const id = String(message.id || '').trim();
    if (!id) return;
    const existing = this._captures.get(id);
    if (!existing) return;
    try {
      existing.capture.resume();
    } catch (err) {
      this._send({ event: 'error', id, message: this._toErrorMessage(err, 'resume failed') });
    }
  }

  shutdown() {
    if (this._shuttingDown) return Promise.resolve();
    this._shuttingDown = true;
    process.removeListener('message', this._boundOnMessage);
    process.removeListener('SIGTERM', this._boundOnSigterm);
    for (const id of this._captures.keys()) this._safeStop(id);
    this._send({ event: 'shutdown_complete' });
    return Promise.resolve();
  }
}

if (require.main === module) {
  const runtime = new ThumbnailWorkerRuntime();
  runtime.start();
}

module.exports = {
  ThumbnailWorkerRuntime,
};
