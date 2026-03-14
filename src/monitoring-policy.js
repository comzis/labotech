'use strict';

const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.join(__dirname, '..', 'config', 'monitoring-policy.json');

function _envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function _envBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function _readPolicyFile() {
  try {
    if (!fs.existsSync(POLICY_PATH)) return {};
    const raw = fs.readFileSync(POLICY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function _buildPolicy() {
  const filePolicy = _readPolicyFile();
  return {
    profile: String(filePolicy.profile || process.env.MONITORING_POLICY_PROFILE || 'broadcast-balanced-v1'),
    source: fs.existsSync(POLICY_PATH) ? 'config' : 'defaults',
    path: POLICY_PATH,
    probeCadence: {
      baseIntervalMs: _envNumber(
        'TS_PROBE_BASE_INTERVAL_MS',
        Number(filePolicy?.probeCadence?.baseIntervalMs || 5000)
      ),
      heavyProbeEvery: Math.max(1, Math.floor(_envNumber(
        'TS_PROBE_HEAVY_EVERY',
        Number(filePolicy?.probeCadence?.heavyProbeEvery || 3)
      ))),
      heavyProbeIntervalMs: _envNumber(
        'TS_PROBE_HEAVY_INTERVAL_MS',
        Number(filePolicy?.probeCadence?.heavyProbeIntervalMs || 15000)
      ),
      minLoopDelayMs: _envNumber(
        'TS_PROBE_MIN_LOOP_DELAY_MS',
        Number(filePolicy?.probeCadence?.minLoopDelayMs || 250)
      ),
      startupJitterMaxMs: _envNumber(
        'TS_PROBE_START_JITTER_MAX_MS',
        Number(filePolicy?.probeCadence?.startupJitterMaxMs || 2000)
      ),
    },
    bitrate: {
      stabilityWindowMs: _envNumber(
        'TS_BITRATE_STABILITY_WINDOW_MS',
        Number(filePolicy?.bitrate?.stabilityWindowMs || 10000)
      ),
      warnDeltaPct: _envNumber(
        'TS_BITRATE_DELTA_WARN_PCT',
        Number(filePolicy?.bitrate?.warnDeltaPct || 3)
      ),
      criticalDeltaPct: _envNumber(
        'TS_BITRATE_DELTA_CRITICAL_PCT',
        Number(filePolicy?.bitrate?.criticalDeltaPct || 6)
      ),
    },
    health: {
      scoreWarning: _envNumber('TS_HEALTH_SCORE_WARNING', Number(filePolicy?.health?.scoreWarning || 65)),
      scoreOk: _envNumber('TS_HEALTH_SCORE_OK', Number(filePolicy?.health?.scoreOk || 85)),
      lossWarnPct: _envNumber('TS_HEALTH_LOSS_WARN_PCT', Number(filePolicy?.health?.lossWarnPct || 0.1)),
      lossCriticalPct: _envNumber('TS_HEALTH_LOSS_CRITICAL_PCT', Number(filePolicy?.health?.lossCriticalPct || 1.0)),
      jitterWarnMs: _envNumber('TS_HEALTH_JITTER_WARN_MS', Number(filePolicy?.health?.jitterWarnMs || 5)),
      jitterCriticalMs: _envNumber('TS_HEALTH_JITTER_CRITICAL_MS', Number(filePolicy?.health?.jitterCriticalMs || 15)),
      iatP95WarnMs: _envNumber('TS_HEALTH_IAT_P95_WARN_MS', Number(filePolicy?.health?.iatP95WarnMs || 50)),
      iatP95CriticalMs: _envNumber('TS_HEALTH_IAT_P95_CRITICAL_MS', Number(filePolicy?.health?.iatP95CriticalMs || 150)),
      tsDiscWarnCount: _envNumber('TS_HEALTH_TS_DISC_WARN_COUNT', Number(filePolicy?.health?.tsDiscWarnCount || 1)),
      tsDiscCriticalCount: _envNumber('TS_HEALTH_TS_DISC_CRITICAL_COUNT', Number(filePolicy?.health?.tsDiscCriticalCount || 3)),
      ccWarnCount: _envNumber('TS_HEALTH_CC_WARN_COUNT', Number(filePolicy?.health?.ccWarnCount || 1)),
      ccCriticalCount: _envNumber('TS_HEALTH_CC_CRITICAL_COUNT', Number(filePolicy?.health?.ccCriticalCount || 3)),
      dolbyEMissingPenalty: _envNumber(
        'TS_HEALTH_DOLBYE_MISSING_PENALTY',
        Number(filePolicy?.health?.dolbyEMissingPenalty || 10)
      ),
      dolbyEDecodeFailurePenalty: _envNumber(
        'TS_HEALTH_DOLBYE_DECODE_FAIL_PENALTY',
        Number(filePolicy?.health?.dolbyEDecodeFailurePenalty || 18)
      ),
    },
    smpte20227: {
      minSamples: _envNumber('TS_20227_MIN_SAMPLES', Number(filePolicy?.smpte20227?.minSamples || 50)),
      maxLossPct: _envNumber('TS_20227_MAX_LOSS_PCT', Number(filePolicy?.smpte20227?.maxLossPct || 0.0)),
      maxGapEvents: _envNumber('TS_20227_MAX_GAP_EVENTS', Number(filePolicy?.smpte20227?.maxGapEvents || 0)),
      maxDuplicateEvents: _envNumber('TS_20227_MAX_DUPLICATE_EVENTS', Number(filePolicy?.smpte20227?.maxDuplicateEvents || 0)),
      maxReorderedEvents: _envNumber('TS_20227_MAX_REORDER_EVENTS', Number(filePolicy?.smpte20227?.maxReorderedEvents || 0)),
      requireNicCapture: _envBoolean(
        'TS_20227_REQUIRE_NIC_CAPTURE',
        Boolean(filePolicy?.smpte20227?.requireNicCapture ?? true)
      ),
    },
    loadedAt: Date.now(),
  };
}

function getMonitoringPolicy() {
  return _buildPolicy();
}

function getMonitoringPolicySummary() {
  const policy = _buildPolicy();
  return {
    profile: policy.profile,
    source: policy.source,
    probeCadence: policy.probeCadence,
    bitrate: policy.bitrate,
    loadedAt: policy.loadedAt,
  };
}

module.exports = {
  getMonitoringPolicy,
  getMonitoringPolicySummary,
  POLICY_PATH,
};
