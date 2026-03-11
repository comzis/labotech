'use strict';

const { spawn, execFile } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const THUMBNAIL_DIR      = path.join(__dirname, '..', 'logs', 'thumbnails');
const THUMBNAIL_INTERVAL = parseInt(process.env.THUMBNAIL_INTERVAL_SEC) || 5;
const THUMBNAIL_QUALITY_PROFILE = String(process.env.THUMBNAIL_QUALITY_PROFILE || 'high').trim().toLowerCase();
const SNMP_HOST          = process.env.SNMP_MANAGER_HOST || '10.67.18.1';
const SYSLOG_HOST        = process.env.SYSLOG_HOST       || '10.67.18.1';
const SYSLOG_PORT        = parseInt(process.env.SYSLOG_PORT) || 514;
const SAFE_STREAM_ID_RE  = /^[A-Za-z0-9_-]{1,64}$/;

if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

function sanitizeStreamId(streamId) {
  const id = String(streamId || '');
  if (!SAFE_STREAM_ID_RE.test(id)) {
    throw new Error('Invalid stream id');
  }
  return id;
}

function getThumbnailCaptureSettings() {
  // high: better multiview detail, more CPU
  // low: lower CPU footprint, more compression artifacts
  if (THUMBNAIL_QUALITY_PROFILE === 'low') {
    return {
      width: 320,
      qv: 6,
    };
  }
  return {
    width: 640,
    qv: 3,
  };
}

/**
 * Capture a JPEG confidence thumbnail from a stream URL.
 * @param {string} streamId
 * @param {string} inputUrl
 * @returns {Promise<string>} path to thumbnail file
 */
function captureThumbnail(streamId, inputUrl) {
  return new Promise((resolve, reject) => {
    const safeId = sanitizeStreamId(streamId);
    const outPath = path.join(THUMBNAIL_DIR, `${safeId}.jpg`);
    const capture = getThumbnailCaptureSettings();

    // Build input URL with multicast-friendly options
    let src = inputUrl;
    if (inputUrl.startsWith('udp://') || inputUrl.startsWith('rtp://')) {
      const sep = inputUrl.includes('?') ? '&' : '?';
      src = `${inputUrl}${sep}fifo_size=10000000&overrun_nonfatal=1&timeout=5000000`; // improve live TS reliability
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', '+discardcorrupt',
      '-analyzeduration', '5000000',
      '-probesize', '5000000',
      '-i', src,
      '-frames:v', '1',
      '-vf', `thumbnail=60,scale=${capture.width}:trunc(${capture.width}/dar/2)*2`,
      '-q:v', String(capture.qv),
      outPath,
    ];

    const proc = spawn('ffmpeg', args);
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Thumbnail timeout')); }, 12000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(outPath);
      else reject(new Error(`Thumbnail capture failed with code ${code}`));
    });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Send an SNMP v2c trap via snmptrap (net-snmp).
 * Falls back gracefully if snmptrap is not installed.
 */
function sendSnmpTrap(oid, value, type = 's') {
  const args = [
    '-v', '2c',
    '-c', 'public',
    SNMP_HOST,
    '',
    String(oid),
    String(oid),
    String(type),
    String(value),
  ];
  execFile('snmptrap', args, () => {}); // fire-and-forget
}

/**
 * Send a UDP syslog message (RFC 3164).
 */
function sendSyslog(message, severity = 6) {
  const facility = 16;  // local0
  const pri = (facility * 8) + severity;
  const msg = `<${pri}>${new Date().toISOString()} labotech ${message}`;
  const buf = Buffer.from(msg);
  const client = dgram.createSocket('udp4');
  client.send(buf, 0, buf.length, SYSLOG_PORT, SYSLOG_HOST, () => client.close());
}

module.exports = { captureThumbnail, sanitizeStreamId, sendSnmpTrap, sendSyslog, THUMBNAIL_DIR };
