'use strict';

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const EVENTS_FILE = path.join(LOGS_DIR, 'events.jsonl');
const RING_SIZE = parseInt(process.env.EVENT_LOG_RING_SIZE || '500', 10) || 500;
const RETENTION_DAYS = Math.max(1, parseInt(process.env.EVENT_LOG_RETENTION_DAYS || '14', 10) || 14);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = Math.max(60000, parseInt(process.env.EVENT_LOG_CLEANUP_INTERVAL_MS || '21600000', 10) || 21600000);
const EVENTS_PREFIX = 'events-';
const EVENTS_EXT = '.jsonl';

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const ring = [];
let lastCleanupAt = 0;
let cleanupTimer = null;

function normalizeTime(rawTime) {
  if (!rawTime) return new Date();
  const t = new Date(rawTime);
  if (Number.isNaN(t.getTime())) return new Date();
  return t;
}

function toDateStamp(dt) {
  return dt.toISOString().slice(0, 10);
}

function getDailyEventsFile(dt) {
  return path.join(LOGS_DIR, `${EVENTS_PREFIX}${toDateStamp(dt)}${EVENTS_EXT}`);
}

function listRotatedEventFiles() {
  try {
    return fs.readdirSync(LOGS_DIR)
      .filter((name) => name.startsWith(EVENTS_PREFIX) && name.endsWith(EVENTS_EXT))
      .map((name) => path.join(LOGS_DIR, name));
  } catch (_) {
    return [];
  }
}

function fileDateFromName(filePath) {
  const base = path.basename(filePath);
  const raw = base.slice(EVENTS_PREFIX.length, base.length - EVENTS_EXT.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const dt = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function cleanupOldFiles() {
  const cutoff = Date.now() - RETENTION_MS;
  const rotated = listRotatedEventFiles();
  for (const filePath of rotated) {
    const dt = fileDateFromName(filePath);
    if (!dt) continue;
    if (dt.getTime() < cutoff) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {
        // Ignore cleanup failures: runtime eventing must remain available.
      }
    }
  }

  // Legacy single-file log from older builds: keep best-effort retention by file age.
  if (fs.existsSync(EVENTS_FILE)) {
    try {
      const st = fs.statSync(EVENTS_FILE);
      if (st.mtimeMs < cutoff) fs.unlinkSync(EVENTS_FILE);
    } catch (_) {
      // Ignore cleanup failures.
    }
  }
}

function maybeCleanup() {
  const now = Date.now();
  if ((now - lastCleanupAt) < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  cleanupOldFiles();
}

function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    try {
      cleanupOldFiles();
    } catch (_) {
      // Keep timer resilient; never crash server for log cleanup.
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

function push(msg) {
  if (!msg || typeof msg !== 'object') return;
  const entryTime = normalizeTime(msg.time);
  const entry = {
    ...msg,
    time: entryTime.toISOString(),
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  try {
    fs.appendFileSync(getDailyEventsFile(entryTime), `${JSON.stringify(entry)}\n`);
  } catch (_) {
    // Event persistence is best-effort; runtime must not fail on disk errors.
  }
  maybeCleanup();
}

function list() {
  return [...ring];
}

function clear() {
  ring.length = 0;
  const rotated = listRotatedEventFiles();
  for (const filePath of rotated) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {
      // Ignore clear failures.
    }
  }
  if (fs.existsSync(EVENTS_FILE)) {
    try {
      fs.unlinkSync(EVENTS_FILE);
    } catch (_) {
      // Ignore clear failures.
    }
  }
}

// Hydrate in-memory ring from persisted JSONL files on startup so timeline
// survives server restarts. Read files from oldest to newest so the ring
// ends up holding the most-recent RING_SIZE entries.
function hydrateRingFromDisk() {
  try {
    const files = listRotatedEventFiles().sort(); // lexicographic == chronological for YYYY-MM-DD names
    for (const filePath of files) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            if (entry && typeof entry === 'object') {
              ring.push(entry);
            }
          } catch (_) { /* skip malformed lines */ }
        }
      } catch (_) { /* skip unreadable files */ }
    }
    // Trim ring to max size keeping the most recent entries.
    if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  } catch (_) { /* hydration is best-effort */ }
}

// Initialize rotation/retention cleanup once on module load.
cleanupOldFiles();
hydrateRingFromDisk();
startCleanupTimer();

module.exports = {
  push,
  list,
  clear,
  EVENTS_FILE,
  cleanupOldFiles,
};
