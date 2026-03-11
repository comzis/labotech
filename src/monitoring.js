'use strict';

const { spawn, execFile } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// Limit concurrent thumbnail captures to avoid CPU pile-up when many decoders run.
const THUMB_CONCURRENCY = parseInt(process.env.THUMBNAIL_MAX_CONCURRENT, 10) || 2;
let _thumbRunning = 0;
const _thumbQueue = [];

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
    return { width: 320, qv: 6 };
  }
  return { width: 640, qv: 3 };
}

function _doCaptureThumbnail(streamId, inputUrl) {
  return new Promise((resolve, reject) => {
    const safeId = sanitizeStreamId(streamId);
    const outPath = path.join(THUMBNAIL_DIR, `${safeId}.jpg`);
    const tmpPath = `${outPath}.tmp`;
    const capture = getThumbnailCaptureSettings();

    // Build input URL with multicast-friendly options
    let src = inputUrl;
    if (inputUrl.startsWith('udp://') || inputUrl.startsWith('rtp://')) {
      const sep = inputUrl.includes('?') ? '&' : '?';
      src = `${inputUrl}${sep}fifo_size=20000000&overrun_nonfatal=1&timeout=3000000&reorder_queue_size=512`;
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', '+discardcorrupt+genpts',
      '-err_detect', 'ignore_err',
      '-analyzeduration', '1000000',  // 1s — enough for well-formed live TS
      '-probesize', '2000000',
      '-rtbufsize', '64M',
      '-i', src,
      '-frames:v', '1',
      // thumbnail=4 at fps=4 buffers 1s of frames and picks the best keyframe.
      // Much faster than the previous thumbnail=24 at fps=8 (3s buffer).
      // bilinear is sufficient for a confidence monitor thumbnail.
      '-vf', `fps=4,thumbnail=4,scale=${capture.width}:trunc(${capture.width}/dar/2)*2:flags=bilinear`,
      '-q:v', String(capture.qv),
      tmpPath,  // write to .tmp first — atomic rename prevents corrupt browser reads
    ];

    const proc = spawn('ffmpeg', args);
    const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('Thumbnail timeout')); }, 8000);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        // Atomic rename: browser never loads a half-written JPEG.
        fs.rename(tmpPath, outPath, (err) => {
          if (err) reject(err);
          else resolve(outPath);
        });
      } else {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(new Error(`Thumbnail capture failed with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      reject(err);
    });
  });
}

/**
 * Capture a JPEG confidence thumbnail from a stream URL.
 * Queued: at most THUMB_CONCURRENCY captures run simultaneously to prevent
 * CPU pile-up when multiple decoders probe concurrently.
 * @param {string} streamId
 * @param {string} inputUrl
 * @returns {Promise<string>} path to thumbnail file
 */
function captureThumbnail(streamId, inputUrl) {
  return new Promise((resolve, reject) => {
    const run = () => {
      _thumbRunning += 1;
      _doCaptureThumbnail(streamId, inputUrl)
        .then(resolve, reject)
        .finally(() => {
          _thumbRunning -= 1;
          if (_thumbQueue.length > 0) _thumbQueue.shift()();
        });
    };
    if (_thumbRunning < THUMB_CONCURRENCY) {
      run();
    } else {
      _thumbQueue.push(run);
    }
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
