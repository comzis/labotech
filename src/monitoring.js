'use strict';

const { spawn, execFile } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Limit concurrent thumbnail captures to avoid CPU pile-up when many decoders run.
// If THUMBNAIL_MAX_CONCURRENT is not set, auto-size by CPU cores with a safe cap.
function _defaultThumbConcurrency() {
  const cores = Array.isArray(os.cpus()) ? os.cpus().length : 4;
  const byCores = Math.floor(cores / 2);
  return Math.max(4, Math.min(12, byCores || 4));
}
const _envThumbConcurrency = parseInt(process.env.THUMBNAIL_MAX_CONCURRENT, 10);
const THUMB_CONCURRENCY = Number.isFinite(_envThumbConcurrency) && _envThumbConcurrency > 0
  ? _envThumbConcurrency
  : _defaultThumbConcurrency();
let _thumbRunning = 0;
const _thumbQueue = [];
// Deduplicate captures per stream so queue pressure doesn't create stale rotations.
const _thumbPendingById = new Map(); // safeStreamId -> Promise<string>

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
  const raw = String(streamId || '').trim();
  if (SAFE_STREAM_ID_RE.test(raw)) return raw;
  let base = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = 'stream';
  const hash = Math.abs(_hashString(raw || 'stream')).toString(36).slice(0, 8);
  // Keep deterministic IDs and avoid collisions for similarly-normalized names.
  const truncated = base.slice(0, 54);
  return `${truncated}_${hash}`.slice(0, 64);
}

function _hashString(input) {
  let h = 0;
  const s = String(input || '');
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function getThumbnailCaptureSettings() {
  // high: better multiview detail, more CPU
  // low: lower CPU footprint, more compression artifacts
  if (THUMBNAIL_QUALITY_PROFILE === 'low') {
    return {
      width: 320,
      qv: 5,
      pick: 3,
      scaler: 'bilinear',
      deblock: false,
      denoise: null,
    };
  }
  return {
    width: 640,
    qv: 2,
    pick: 4,
    scaler: 'lanczos',
    // pp=de applies H.264-style loop deblocking as a post-processing pass,
    // smoothing DCT block boundaries before JPEG encode.
    deblock: true,
    // Temporal+spatial denoise: reduces compression noise between block boundaries.
    denoise: 'hqdn3d=2:2:6:6',
  };
}

function _doCaptureThumbnail(streamId, inputUrl) {
  return new Promise((resolve, reject) => {
    const safeId = sanitizeStreamId(streamId);
    const outPath = path.join(THUMBNAIL_DIR, `${safeId}.jpg`);
    // Keep a .jpg suffix on temp output so ffmpeg selects the jpeg muxer.
    const tmpPath = `${outPath}.tmp.jpg`;
    const capture = getThumbnailCaptureSettings();

    // Build input URL with multicast-friendly options
    let src = inputUrl;
    if (inputUrl.startsWith('udp://') || inputUrl.startsWith('rtp://')) {
      const sep = inputUrl.includes('?') ? '&' : '?';
      src = `${inputUrl}${sep}fifo_size=20000000&overrun_nonfatal=1&timeout=7000000&reorder_queue_size=1024`;
    }

    const runAttempt = ({ iFrameOnly, timeoutMs, deblock, denoise }) => new Promise((attemptResolve, attemptReject) => {
      const vf = [
        iFrameOnly ? 'select=eq(pict_type\\,I)' : null,
        `thumbnail=${capture.pick}`,
        deblock ? 'pp=de/de' : null,
        `scale=${capture.width}:trunc(${capture.width}/dar/2)*2:flags=${capture.scaler}`,
        denoise || null,
      ].filter(Boolean).join(',');
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-fflags', '+discardcorrupt+genpts',
        '-err_detect', 'ignore_err',
        // Strict pass avoids B-frame artefacts. Fallback pass allows any decodable
        // frame to guarantee thumbnail continuity under long/irregular GOPs.
        ...(iFrameOnly ? ['-skip_frame', 'noref'] : []),
        '-analyzeduration', iFrameOnly ? '4000000' : '7000000',
        '-probesize', iFrameOnly ? '5000000' : '7000000',
        '-rtbufsize', '128M',
        '-i', src,
        '-frames:v', '1',
        '-vf', vf,
        '-f', 'image2',
        '-q:v', String(capture.qv),
        tmpPath,
      ];
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      const timer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch (_) {}
        attemptReject(new Error(iFrameOnly ? 'Thumbnail timeout (I-frame)' : 'Thumbnail timeout (fallback)'));
      }, timeoutMs);
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) return attemptResolve();
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        const detail = (stderr || '').trim();
        attemptReject(new Error(detail ? `Thumbnail capture failed with code ${code}: ${detail}` : `Thumbnail capture failed with code ${code}`));
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        attemptReject(err);
      });
    });

    // Progressive fallback ladder:
    // 1) strict I-frame + quality filters
    // 2) strict I-frame without deblock (for ffmpeg builds missing "pp")
    // 3) relaxed frame selection without deblock (maximize continuity)
    // 4) minimal relaxed chain (no denoise) for very limited ffmpeg builds
    runAttempt({
      iFrameOnly: true,
      timeoutMs: 12000,
      deblock: capture.deblock,
      denoise: capture.denoise,
    })
      .catch(() => runAttempt({
        iFrameOnly: true,
        timeoutMs: 10000,
        deblock: false,
        denoise: capture.denoise,
      }))
      .catch(() => runAttempt({
        iFrameOnly: false,
        timeoutMs: 10000,
        deblock: false,
        denoise: capture.denoise,
      }))
      .catch(() => runAttempt({
        iFrameOnly: false,
        timeoutMs: 8000,
        deblock: false,
        denoise: null,
      }))
      .then(() => {
        fs.rename(tmpPath, outPath, (err) => {
          if (err) reject(err);
          else resolve(outPath);
        });
      })
      .catch((err) => {
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
  const safeId = sanitizeStreamId(streamId);
  const pending = _thumbPendingById.get(safeId);
  if (pending) return pending;

  const taskPromise = new Promise((resolve, reject) => {
    const run = () => {
      _thumbRunning += 1;
      _doCaptureThumbnail(streamId, inputUrl)
        .then(resolve, reject)
        .finally(() => {
          _thumbRunning -= 1;
          _thumbPendingById.delete(safeId);
          if (_thumbQueue.length > 0) _thumbQueue.shift()();
        });
    };
    if (_thumbRunning < THUMB_CONCURRENCY) {
      run();
    } else {
      _thumbQueue.push(run);
    }
  });
  _thumbPendingById.set(safeId, taskPromise);
  return taskPromise;
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
