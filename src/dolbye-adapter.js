'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

function _envBool(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function _envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function _normalizeDetected(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const str = String(value || '').toLowerCase();
  if (!str) return false;
  return ['1', 'true', 'yes', 'detected', 'present', 'dolbye'].includes(str);
}

function _normalizeDecoded(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const str = String(value || '').toLowerCase();
  if (!str) return false;
  return ['1', 'true', 'yes', 'ok', 'decoded', 'success'].includes(str);
}

function _safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function _tokenizeArgs(input) {
  const src = String(input || '').trim();
  if (!src) return [];
  // Simple shell-like tokenizer supporting single/double quotes and escapes.
  const out = [];
  let cur = '';
  let quote = null;
  let esc = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function _buildArgs(url) {
  const jsonRaw = String(process.env.DOLBYE_DECODER_ARGS_JSON || '').trim();
  if (jsonRaw) {
    try {
      const arr = JSON.parse(jsonRaw);
      if (Array.isArray(arr)) {
        return arr.map((v) => String(v).replace(/\{url\}/g, String(url || '')));
      }
    } catch (_) {}
  }
  const textRaw = String(process.env.DOLBYE_DECODER_ARGS || '--input {url} --json').trim();
  return _tokenizeArgs(textRaw).map((v) => v.replace(/\{url\}/g, String(url || '')));
}

function _normalizeOutput(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  return {
    available: true,
    ok: obj.ok === false ? false : true,
    detected: _normalizeDetected(obj.detected ?? obj.dolbyEDetected ?? obj.present),
    decoded: _normalizeDecoded(obj.decoded ?? obj.decodeOk ?? obj.success),
    frameCount: _safeNumber(obj.frameCount ?? obj.frames ?? obj.dolbyeFrames),
    programConfig: obj.programConfig || obj.program || null,
    error: obj.error ? String(obj.error) : null,
    raw: obj,
  };
}

function isEnabled() {
  return _envBool('DOLBYE_ENABLED', false);
}

function getConfig() {
  return {
    enabled: isEnabled(),
    decoderPath: String(process.env.DOLBYE_DECODER_PATH || '').trim(),
    timeoutMs: _envNumber('DOLBYE_DECODER_TIMEOUT_MS', 4000),
  };
}

function isConfigured() {
  const cfg = getConfig();
  if (!cfg.enabled) return false;
  if (!cfg.decoderPath) return false;
  try {
    fs.accessSync(cfg.decoderPath, fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function probe(url) {
  const cfg = getConfig();
  if (!cfg.enabled) {
    return Promise.resolve({
      available: false,
      ok: false,
      detected: false,
      decoded: false,
      frameCount: null,
      programConfig: null,
      error: 'Dolby E adapter disabled',
    });
  }
  if (!cfg.decoderPath) {
    return Promise.resolve({
      available: false,
      ok: false,
      detected: false,
      decoded: false,
      frameCount: null,
      programConfig: null,
      error: 'DOLBYE_DECODER_PATH is not set',
    });
  }

  const args = _buildArgs(url);
  return new Promise((resolve) => {
    execFile(cfg.decoderPath, args, { timeout: cfg.timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || stdout || err.message || '').toString().trim();
        return resolve({
          available: true,
          ok: false,
          detected: false,
          decoded: false,
          frameCount: null,
          programConfig: null,
          error: detail || 'Dolby E decoder command failed',
        });
      }
      const text = String(stdout || '').trim();
      if (!text) {
        return resolve({
          available: true,
          ok: false,
          detected: false,
          decoded: false,
          frameCount: null,
          programConfig: null,
          error: 'Dolby E decoder returned empty output',
        });
      }
      try {
        const parsed = JSON.parse(text);
        return resolve(_normalizeOutput(parsed));
      } catch (_) {
        const detected = /dolby\s*e/i.test(text);
        const decoded = /decoded|success|ok/i.test(text);
        return resolve({
          available: true,
          ok: decoded || detected,
          detected,
          decoded,
          frameCount: null,
          programConfig: null,
          error: null,
        });
      }
    });
  });
}

module.exports = { isEnabled, isConfigured, getConfig, probe };
