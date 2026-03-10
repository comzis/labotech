'use strict';

const { spawn, exec } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const THUMBNAIL_DIR      = path.join(__dirname, '..', 'logs', 'thumbnails');
const THUMBNAIL_INTERVAL = parseInt(process.env.THUMBNAIL_INTERVAL_SEC) || 5;
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

    // Build input URL with multicast-friendly options
    let src = inputUrl;
    if (inputUrl.startsWith('udp://') || inputUrl.startsWith('rtp://')) {
      const sep = inputUrl.includes('?') ? '&' : '?';
      src = `${inputUrl}${sep}timeout=3000000`; // 3s timeout
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', '+genpts+discardcorrupt',
      '-i', src,
      '-vframes', '1',
      '-vf', 'scale=320:trunc(320/dar/2)*2',
      '-q:v', '5',
      outPath,
    ];

    const proc = spawn('ffmpeg', args);
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Thumbnail timeout')); }, 8000);
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
  exec(
    `snmptrap -v 2c -c public ${SNMP_HOST} '' ${oid} ${oid} ${type} "${value}" 2>/dev/null`,
    () => {}  // fire-and-forget
  );
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
