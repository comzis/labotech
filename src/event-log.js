'use strict';

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const EVENTS_FILE = path.join(LOGS_DIR, 'events.jsonl');
const RING_SIZE = parseInt(process.env.EVENT_LOG_RING_SIZE || '500', 10) || 500;

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const ring = [];

function push(msg) {
  if (!msg || typeof msg !== 'object') return;
  const entry = {
    time: msg.time || new Date().toISOString(),
    ...msg,
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.splice(0, ring.length - RING_SIZE);
  try {
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(entry)}\n`);
  } catch (_) {
    // Event persistence is best-effort; runtime must not fail on disk errors.
  }
}

function list() {
  return [...ring];
}

function clear() {
  ring.length = 0;
}

module.exports = {
  push,
  list,
  clear,
  EVENTS_FILE,
};
