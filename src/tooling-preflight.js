'use strict';

const path = require('path');
const { spawn } = require('child_process');

const TOOL_TIMEOUT_MS = 2500;

let _snapshot = {
  status: 'pending',
  checkedAt: null,
  nicName: null,
  tools: {
    ffmpeg: { available: false, version: null, error: 'pending' },
    ffprobe: { available: false, version: null, error: 'pending' },
    tsanalyze: { available: false, version: null, error: 'pending' },
    tshark: { available: false, version: null, error: 'pending' },
    tcpdump: { available: false, version: null, error: 'pending' },
  },
  srtProtocol: { available: null, reason: 'preflight pending' },
  nicCapture: {
    required: true,
    state: 'pending',
    tool: null,
    ok: null,
    reason: 'preflight pending',
  },
};

function _readNicName() {
  try {
    const cfg = require('../config/multicast.json');
    return String(cfg?.nic || 'eno2');
  } catch (_) {
    return 'eno2';
  }
}

function _runCommand(command, args, timeoutMs = TOOL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch (_) {}
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr,
        timedOut: false,
        error: err && err.message ? err.message : 'spawn failed',
      });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        timedOut,
        error: null,
      });
    });
  });
}

function _extractVersion(output) {
  const line = String(output || '').split('\n').map((s) => s.trim()).find(Boolean);
  return line || null;
}

async function _checkTool(name, args) {
  const res = await _runCommand(name, args);
  if (!res.ok) {
    const errLine = _extractVersion(res.stderr) || _extractVersion(res.stdout) || res.error || `exit ${res.code}`;
    return { available: false, version: null, error: errLine };
  }
  return {
    available: true,
    version: _extractVersion(res.stdout) || _extractVersion(res.stderr),
    error: null,
  };
}

async function _checkNicCapture(toolName, nicName) {
  if (!toolName) {
    return {
      required: true,
      state: 'unavailable',
      tool: null,
      ok: false,
      reason: 'No NIC capture tool available (tshark/tcpdump missing)',
    };
  }
  const args = toolName === 'tshark'
    ? ['-Q', '-i', nicName, '-a', 'duration:1', '-c', '1', '-f', 'udp dst port 65535']
    : ['-i', nicName, '-nn', '-c', '1', 'udp', 'dst', 'port', '65535'];
  const res = await _runCommand(toolName, args, 2000);
  const mergedErr = `${res.stderr || ''}\n${res.stdout || ''}`.toLowerCase();
  if (/(permission denied|operation not permitted|you don't have permission|cannot open .* device)/i.test(mergedErr)) {
    return {
      required: true,
      state: 'missing_permissions',
      tool: toolName,
      ok: false,
      reason: `${toolName} lacks capture permission on ${nicName}`,
    };
  }
  if (res.ok || res.timedOut) {
    return {
      required: true,
      state: 'ready',
      tool: toolName,
      ok: true,
      reason: `${toolName} capture preflight passed on ${nicName}`,
    };
  }
  return {
    required: true,
    state: 'degraded',
    tool: toolName,
    ok: null,
    reason: `${toolName} capture preflight inconclusive (${res.error || `exit ${res.code}`})`,
  };
}

async function _checkSrtProtocol() {
  const res = await _runCommand('ffmpeg', ['-protocols']);
  if (!res.ok && res.code !== 1) {
    // ffmpeg -protocols exits 1 on older builds but still writes valid output
    if (!res.stdout && !res.stderr) {
      return { available: false, reason: 'ffmpeg not found or produced no output' };
    }
  }
  const output = (res.stdout + res.stderr).toLowerCase();
  if (output.includes('\nsrt') || output.includes(' srt') || /\bsrt\b/.test(output)) {
    return { available: true, reason: 'libsrt compiled in' };
  }
  return {
    available: false,
    reason: 'srt protocol not listed — ffmpeg may need --enable-libsrt rebuild or ffmpeg-srt PPA',
  };
}

async function refreshToolingPreflight() {
  const nicName = _readNicName();
  const [ffmpeg, ffprobe, tsanalyze, tshark, tcpdump, srtProtocol] = await Promise.all([
    _checkTool('ffmpeg', ['-version']),
    _checkTool('ffprobe', ['-version']),
    _checkTool('tsanalyze', ['--version']),
    _checkTool('tshark', ['-v']),
    _checkTool('tcpdump', ['--version']),
    _checkSrtProtocol(),
  ]);

  const preferredCaptureTool = tshark.available ? 'tshark' : (tcpdump.available ? 'tcpdump' : null);
  const nicCapture = await _checkNicCapture(preferredCaptureTool, nicName);
  const status = (
    ffmpeg.available &&
    ffprobe.available &&
    nicCapture.ok !== false
  ) ? 'ready' : 'degraded';

  _snapshot = {
    status,
    checkedAt: Date.now(),
    nicName,
    tools: { ffmpeg, ffprobe, tsanalyze, tshark, tcpdump },
    srtProtocol,
    nicCapture,
  };
  return _snapshot;
}

function getToolingPreflightSnapshot() {
  return { ..._snapshot };
}

function startToolingPreflightAutoRefresh() {
  refreshToolingPreflight().catch(() => {});
  const timer = setInterval(() => {
    refreshToolingPreflight().catch(() => {});
  }, 5 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = {
  refreshToolingPreflight,
  getToolingPreflightSnapshot,
  startToolingPreflightAutoRefresh,
};
