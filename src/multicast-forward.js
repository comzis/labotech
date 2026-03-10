'use strict';

const { EventEmitter } = require('events');
const { spawn, exec } = require('child_process');

const DEFAULT_NIC    = process.env.MULTICAST_NIC    || 'eno2';
const DEFAULT_SUBNET = process.env.FORWARD_MULTICAST_SUBNET || '239.100.25.0/26';

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet), 0) >>> 0;
}

function isInSubnet(ip, subnet) {
  const [base, bits] = subnet.split('/');
  const mask = bits ? (~0 << (32 - parseInt(bits))) >>> 0 : 0xffffffff;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

class MulticastForwarder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id          = options.id;
    this.sourceUrl   = options.sourceUrl;   // udp://239.x.x.x:port
    this.destIp      = options.destIp;      // 239.100.25.x
    this.destPort    = options.destPort || 1234;
    this.nic         = options.nic || DEFAULT_NIC;
    this.subnet      = options.subnet || DEFAULT_SUBNET;
    this.ttl         = options.ttl || parseInt(process.env.MULTICAST_TTL) || 10;

    this.process     = null;
    this.isRunning   = false;
    this.startTime   = null;
    this.lastStats   = null;
  }

  buildMulticastUrl() {
    // Use 'interface' (NIC name) not 'localaddr' (IP) — eno2 has no IP assigned.
    // localaddr=0.0.0.0 lets the OS pick the default route (eno1/management),
    // so multicast packets never reach eno2 and the VB330 probe gets no lock.
    return `udp://${this.destIp}:${this.destPort}?pkt_size=1316&ttl=${this.ttl}&interface=${this.nic}`;
  }

  validateDestination() {
    if (!this.destIp) throw new Error('destIp is required');
    if (!isInSubnet(this.destIp, this.subnet)) {
      throw new Error(
        `Destination ${this.destIp} is not within allowed subnet ${this.subnet}`
      );
    }
  }

  checkMulticastRoute() {
    return new Promise((resolve, reject) => {
      exec(`ip route show ${this.subnet} dev ${this.nic}`, (err, stdout) => {
        if (err) return resolve(false);
        resolve(stdout.trim().length > 0);
      });
    });
  }

  ensureMulticastRoute() {
    return new Promise((resolve, reject) => {
      exec(
        `ip route add ${this.subnet} dev ${this.nic} 2>/dev/null || true`,
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  async start() {
    if (this.isRunning) {
      throw new Error(`Forwarder ${this.id} is already running`);
    }

    this.validateDestination();
    await this.ensureMulticastRoute();

    // Append UDP buffer options to source URL to prevent packet loss / PAT drops
    const sep = this.sourceUrl.includes('?') ? '&' : '?';
    const srcUrl = this.sourceUrl.startsWith('udp://') || this.sourceUrl.startsWith('rtp://')
      ? `${this.sourceUrl}${sep}fifo_size=10000000&overrun_nonfatal=1`
      : this.sourceUrl;

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-stats',
      '-fflags', '+genpts+discardcorrupt',
      '-i', srcUrl,
      '-c', 'copy',
      '-f', 'mpegts',
      '-mpegts_copyts', '1',   // preserve original TS timestamps + PAT/PMT
      this.buildMulticastUrl(),
    ];

    this.process = spawn('ffmpeg', args);
    this.isRunning = true;
    this.startTime = Date.now();

    this.process.stderr.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (line.trim()) this._parseStats(line);
      });
    });

    this.process.on('exit', (code, signal) => {
      this.isRunning = false;
      this.process = null;
      if (signal === 'SIGTERM' || code === 0 || (this._stopping && code === 255)) {
        this._stopping = false;
        this.emit('stopped', { id: this.id, code, signal });
      } else {
        this._stopping = false;
        this.emit('error', new Error(`Forwarder FFmpeg exited with code ${code}`));
      }
    });

    this.process.on('error', (err) => {
      this.isRunning = false;
      this.emit('error', err);
    });

    this.emit('started', { id: this.id });
    return this;
  }

  stop() {
    if (this.process && this.isRunning) {
      this._stopping = true;
      this.process.kill('SIGTERM');
    }
  }

  _parseStats(line) {
    const stats = {};
    const mBitrate = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
    const mFrame   = line.match(/frame=\s*(\d+)/);
    const mSpeed   = line.match(/speed=\s*([\d.]+)x/);
    if (mBitrate) stats.bitrate = parseFloat(mBitrate[1]);
    if (mFrame)   stats.frame   = parseInt(mFrame[1]);
    if (mSpeed)   stats.speed   = parseFloat(mSpeed[1]);

    if (Object.keys(stats).length > 0) {
      this.lastStats = stats;
      this.emit('stats', stats);
    }
  }

  toJSON() {
    return {
      id:        this.id,
      sourceUrl: this.sourceUrl,
      destIp:    this.destIp,
      destPort:  this.destPort,
      nic:       this.nic,
      isRunning: this.isRunning,
      startTime: this.startTime,
      lastStats: this.lastStats,
    };
  }
}

module.exports = { MulticastForwarder, isInSubnet };
