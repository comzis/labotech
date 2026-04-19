'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function _parsePort(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return 4100;
  return n;
}

function _parseBoolean(raw, def = false) {
  if (raw === undefined || raw === null) return def;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function _portRegex(port) {
  return new RegExp(`:${port}(\\s|$)`);
}

function _extractPid(line) {
  const m = String(line || '').match(/pid=(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function _extractCommandHint(line) {
  const m = String(line || '').match(/users:\(\("([^"]+)"/);
  return m ? m[1] : null;
}

function _allowlistRegexes() {
  const raw = process.env.ENCAP_KILL_ALLOWLIST || 'encapsulator,labotech,dashboard';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      try {
        return new RegExp(token, 'i');
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

async function _processDetails(pid) {
  if (!pid) return null;
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'pid=,ppid=,user=,comm=,args=']);
    return String(stdout || '').trim() || null;
  } catch (_) {
    return null;
  }
}

async function inspectPortOffenders(rawPort) {
  const port = _parsePort(rawPort);
  const listeners = [];
  let stdout = '';
  let stderr = '';
  try {
    const out = await execFileAsync('ss', ['-ltnp']);
    stdout = String(out.stdout || '');
    stderr = String(out.stderr || '');
  } catch (err) {
    return {
      ok: false,
      port,
      error: `failed to run ss: ${err.message}`,
      listeners: [],
    };
  }

  const byPid = new Map();
  const regex = _portRegex(port);
  const lines = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (!regex.test(line)) continue;
    const pid = _extractPid(line);
    const hint = _extractCommandHint(line);
    const key = pid == null ? `line:${line}` : `pid:${pid}`;
    if (!byPid.has(key)) {
      byPid.set(key, {
        pid,
        commandHint: hint,
        ssLine: line,
      });
    }
  }

  for (const entry of byPid.values()) {
    const details = entry.pid ? await _processDetails(entry.pid) : null;
    listeners.push({
      ...entry,
      processDetails: details,
    });
  }

  return {
    ok: true,
    port,
    listeners,
    listenersCount: listeners.length,
    stderr: stderr || null,
  };
}

function _isKillAllowed(listener, forceAny, allowlist) {
  if (forceAny) return true;
  const probe = `${listener.commandHint || ''} ${listener.processDetails || ''}`.trim();
  if (!probe) return false;
  return allowlist.some((rx) => rx.test(probe));
}

async function resolvePortOffenders(options = {}) {
  const port = _parsePort(options.port);
  const confirm = _parseBoolean(options.confirm, false);
  const enabled = _parseBoolean(process.env.ENCAP_KILL_ENABLED, true);
  const forceAny = _parseBoolean(process.env.ENCAP_KILL_FORCE_ANY, false);
  const allowlist = _allowlistRegexes();

  if (!enabled) {
    return {
      ok: false,
      port,
      error: 'port offender kill is disabled (ENCAP_KILL_ENABLED=0)',
      killed: [],
      skipped: [],
    };
  }

  const inspected = await inspectPortOffenders(port);
  if (!inspected.ok) return inspected;
  if (inspected.listenersCount === 0) {
    return {
      ok: true,
      port,
      action: 'no_listeners',
      killed: [],
      skipped: [],
      remaining: [],
    };
  }

  if (!confirm) {
    return {
      ok: false,
      port,
      error: 'confirmation_required',
      listeners: inspected.listeners,
      killed: [],
      skipped: [],
    };
  }

  const killed = [];
  const skipped = [];

  for (const listener of inspected.listeners) {
    if (!listener.pid) {
      skipped.push({
        ...listener,
        reason: 'pid_not_detected',
      });
      continue;
    }
    if (listener.pid <= 1) {
      skipped.push({
        ...listener,
        reason: 'protected_pid',
      });
      continue;
    }
    if (!_isKillAllowed(listener, forceAny, allowlist)) {
      skipped.push({
        ...listener,
        reason: 'not_allowlisted',
      });
      continue;
    }

    try {
      process.kill(listener.pid, 'SIGTERM');
      killed.push({
        ...listener,
        signal: 'SIGTERM',
      });
    } catch (err) {
      skipped.push({
        ...listener,
        reason: `kill_failed:${err.code || err.message}`,
      });
    }
  }

  await new Promise((r) => setTimeout(r, 1200));
  const after = await inspectPortOffenders(port);

  return {
    ok: true,
    port,
    action: 'attempted_kill',
    killed,
    skipped,
    killedCount: killed.length,
    skippedCount: skipped.length,
    remaining: after.listeners || [],
    remainingCount: after.listenersCount || 0,
    allowlist: (process.env.ENCAP_KILL_ALLOWLIST || 'encapsulator,labotech,dashboard').split(',').map((s) => s.trim()).filter(Boolean),
    forceAny,
    namespaceHint: 'If remaining offenders are host processes outside this container PID namespace, use scripts/triage-port-kill.sh on host.',
  };
}

module.exports = {
  inspectPortOffenders,
  resolvePortOffenders,
};
