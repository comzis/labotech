'use strict';

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');

const DEFAULT_NIC    = process.env.MULTICAST_NIC    || 'eno2';
const DEFAULT_SUBNET = process.env.FORWARD_MULTICAST_SUBNET || '239.100.25.0/26';
const IS_TEST_RUNTIME = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const DEFAULT_ALLOWED_IP = IS_TEST_RUNTIME ? null : (process.env.FORWARD_MULTICAST_IP || null);
const DEFAULT_REQUIRE_EXPLICIT_DEST = IS_TEST_RUNTIME
  ? false
  : String(process.env.FORWARD_REQUIRE_EXPLICIT_DEST || 'true').toLowerCase() !== 'false';
const SAFE_NIC_RE = /^[a-zA-Z0-9_.:-]{1,32}$/;
const LIVE_INPUT_FIFO_SIZE = parseInt(process.env.TS_INPUT_FIFO_SIZE || '524288', 10) || 524288;
const LIVE_INPUT_TIMEOUT_US = parseInt(process.env.TS_INPUT_TIMEOUT_US || '7000000', 10) || 7000000;
const LIVE_INPUT_REORDER_QUEUE = parseInt(process.env.TS_INPUT_REORDER_QUEUE_SIZE || '256', 10) || 256;

function isValidIpv4(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || ''))) return false;
  return String(ip).split('.').every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet), 0) >>> 0;
}

function isInSubnet(ip, subnet) {
  const [base, bits] = subnet.split('/');
  const mask = bits ? (~0 << (32 - parseInt(bits))) >>> 0 : 0xffffffff;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

function resolveIpCommand() {
  const preferred = process.env.FORWARD_IP_BIN;
  if (preferred && fs.existsSync(preferred)) return preferred;
  const candidates = ['/sbin/ip', '/usr/sbin/ip', '/bin/ip', '/usr/bin/ip'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'ip';
}

const IP_CMD = resolveIpCommand();

class MulticastForwarder extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id          = options.id;
    this.sourceUrl   = String(options.sourceUrl || '').trim();   // udp://239.x.x.x:port
    this.destIp      = options.destIp;      // 239.100.25.x
    this.destPort    = options.destPort || 1234;
    this.nic         = options.nic || DEFAULT_NIC;
    this.subnet      = options.subnet || DEFAULT_SUBNET;
    const hasAllowedIpOverride = Object.prototype.hasOwnProperty.call(options, 'allowedIp');
    this.allowedIp   = hasAllowedIpOverride ? options.allowedIp : DEFAULT_ALLOWED_IP;
    this.requireExplicitDest = options.requireExplicitDest != null
      ? Boolean(options.requireExplicitDest)
      : DEFAULT_REQUIRE_EXPLICIT_DEST;
    this.ttl         = options.ttl || parseInt(process.env.MULTICAST_TTL) || 10;

    this.process     = null;
    this.isRunning   = false;
    this.startTime   = null;
    this.lastStats   = null;
    this._stderrBuffer = [];
  }

  buildMulticastUrl() {
    // Use 'interface' (NIC name) not 'localaddr' (IP) — eno2 has no IP assigned.
    // localaddr=0.0.0.0 lets the OS pick the default route (eno1/management),
    // so multicast packets never reach eno2 and the VB330 probe gets no lock.
    return `udp://${this.destIp}:${this.destPort}?pkt_size=1316&ttl=${this.ttl}&interface=${this.nic}`;
  }

  validateDestination() {
    if (!this.destIp) throw new Error('destIp is required');
    if (!isValidIpv4(this.destIp)) {
      throw new Error(`Invalid IPv4 destination: ${this.destIp}`);
    }
    if (this.allowedIp && !isValidIpv4(this.allowedIp)) {
      throw new Error(`Invalid configured FORWARD_MULTICAST_IP: ${this.allowedIp}`);
    }
    if (!isInSubnet(this.destIp, this.subnet)) {
      throw new Error(
        `Destination ${this.destIp} is not within allowed subnet ${this.subnet}`
      );
    }
    if (this.allowedIp && !isInSubnet(this.allowedIp, this.subnet)) {
      throw new Error(`Configured FORWARD_MULTICAST_IP ${this.allowedIp} is outside subnet ${this.subnet}`);
    }
    if (this.requireExplicitDest && !this.allowedIp) {
      throw new Error('FORWARD_MULTICAST_IP is not configured; refusing to forward to avoid multicast flooding.');
    }
    // Optional strict pinning to one destination IP; by default allow any IP in subnet.
    if (this.allowedIp && this.destIp !== this.allowedIp) {
      throw new Error(`Destination ${this.destIp} is blocked. Only ${this.allowedIp} is allowed.`);
    }
  }

  validateNic() {
    if (!this.nic || !SAFE_NIC_RE.test(String(this.nic))) {
      throw new Error('Invalid NIC name');
    }
  }

  _runIp(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(IP_CMD, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', (err) => {
        if (err && err.code === 'ENOENT') {
          return reject(new Error(`ip route tool not found (tried: ${IP_CMD}). Install iproute2 in runtime image.`));
        }
        return reject(err);
      });
      proc.on('exit', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr.trim() || `${IP_CMD} ${args.join(' ')} failed (${code})`));
      });
    });
  }

  checkMulticastRoute() {
    return this
      ._runIp(['route', 'show', this.subnet, 'dev', this.nic])
      .then(({ stdout }) => stdout.trim().length > 0)
      .catch(() => false);
  }

  ensureMulticastRoute() {
    // route replace is idempotent and avoids shell fallback patterns
    return this._runIp(['route', 'replace', this.subnet, 'dev', this.nic]).then(() => {});
  }

  async start() {
    if (this.isRunning) {
      throw new Error(`Forwarder ${this.id} is already running`);
    }

    this.validateNic();
    this.validateDestination();
    await this.ensureMulticastRoute();

    // Append UDP buffer options to source URL to prevent packet loss / PAT drops
    const sep = this.sourceUrl.includes('?') ? '&' : '?';
    const isLiveTsSource = this.sourceUrl.startsWith('udp://') || this.sourceUrl.startsWith('rtp://');
    const srcUrl = isLiveTsSource
      ? `${this.sourceUrl}${sep}fifo_size=${LIVE_INPUT_FIFO_SIZE}&overrun_nonfatal=1&timeout=${LIVE_INPUT_TIMEOUT_US}&reorder_queue_size=${LIVE_INPUT_REORDER_QUEUE}`
      : this.sourceUrl;

    const inputArgs = isLiveTsSource
      ? ['-fflags', '+discardcorrupt', '-f', 'mpegts', '-i', srcUrl]
      : ['-i', srcUrl];

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-stats',
      '-avoid_negative_ts', 'make_non_negative',
      ...inputArgs,
      '-c', 'copy',
      '-f', 'mpegts',
      '-mpegts_copyts', '1',   // preserve original TS timestamps + PAT/PMT
      '-pcr_period', '20',     // PCR every 20 ms — within ETR290 2.3a 40 ms limit
      this.buildMulticastUrl(),
    ];

    this.process = spawn('ffmpeg', args);
    this.isRunning = true;
    this.startTime = Date.now();

    this.process.stderr.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (!line.trim()) return;
        this._stderrBuffer = [...this._stderrBuffer.slice(-9), line];
        this._parseStats(line);
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
        const context = (this._stderrBuffer || []).slice(-5).join(' | ');
        this.emit('error', new Error(`Forwarder FFmpeg exited with code ${code}: ${context}`));
      }
    });

    this.process.on('error', (err) => {
      this.isRunning = false;
      this.emit('error', err);
    });

    this.emit('started', { id: this.id });
    console.log(`[MulticastForwarder ${this.id}] output → udp://${this.destIp}:${this.destPort} via ${this.nic}`);
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

module.exports = { MulticastForwarder, isInSubnet, isValidIpv4 };
