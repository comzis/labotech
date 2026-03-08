'use strict';

const { EventEmitter } = require('events');
const SRTEncoder = require('./encoder');

const SWITCH_THRESHOLD_MS = 3000;

class FailoverEncoder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id              = options.id;
    this.primaryInput    = options.primaryInput;
    this.backupInput     = options.backupInput;
    this.encoderOptions  = options.encoderOptions || {};

    this._active   = null;   // 'primary' | 'backup'
    this._encoder  = null;
    this._watchdog = null;
    this._lastSeen = null;
    this.isRunning = false;
  }

  _createEncoder(input) {
    return new SRTEncoder({
      ...this.encoderOptions,
      id: `${this.id}-${Date.now()}`,
      input,
    });
  }

  _startEncoder(input, role) {
    const enc = this._createEncoder(input);

    enc.on('stats', (stats) => {
      this._lastSeen = Date.now();
      this.emit('stats', { ...stats, active: role });
    });

    enc.on('error', (err) => {
      this.emit('error', err);
      this._maybeSwitch();
    });

    enc.on('stopped', () => {
      if (this.isRunning) this._maybeSwitch();
    });

    enc.start();
    return enc;
  }

  _maybeSwitch() {
    const nextRole  = this._active === 'primary' ? 'backup' : 'primary';
    const nextInput = nextRole === 'primary' ? this.primaryInput : this.backupInput;

    if (!nextInput) {
      this.emit('error', new Error('No failover input available'));
      return;
    }

    if (this._encoder) this._encoder.stop();

    this._active  = nextRole;
    this._encoder = this._startEncoder(nextInput, nextRole);
    this.emit('switched', { to: nextRole, input: nextInput });
  }

  _startWatchdog() {
    this._watchdog = setInterval(() => {
      if (!this._lastSeen) return;
      if (Date.now() - this._lastSeen > SWITCH_THRESHOLD_MS) {
        this._lastSeen = null;
        this._maybeSwitch();
      }
    }, 1000);
  }

  start() {
    if (this.isRunning) throw new Error(`FailoverEncoder ${this.id} already running`);
    this.isRunning = true;
    this._active   = 'primary';
    this._encoder  = this._startEncoder(this.primaryInput, 'primary');
    this._lastSeen = Date.now();
    this._startWatchdog();
    this.emit('started', { id: this.id, active: 'primary' });
    return this;
  }

  stop() {
    this.isRunning = false;
    clearInterval(this._watchdog);
    if (this._encoder) this._encoder.stop();
    this.emit('stopped', { id: this.id });
  }

  toJSON() {
    return {
      id:           this.id,
      primaryInput: this.primaryInput,
      backupInput:  this.backupInput,
      active:       this._active,
      isRunning:    this.isRunning,
    };
  }
}

module.exports = FailoverEncoder;
