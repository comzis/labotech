'use strict';

const fs = require('fs');
const path = require('path');

const POLICY_PATH = path.join(__dirname, '..', 'config', 'monitoring-policy.json');

// ── Named profile presets ─────────────────────────────────────────────────────
// Each profile defines the monitoring thresholds appropriate for a transport
// type / delivery context.  Env vars and config/monitoring-policy.json
// overrides are always applied on top, so operators can fine-tune any value
// within a chosen profile.
//
// Standards references:
//   broadcast-strict     — EBU R95 / ITU-R BT.656 TX master control
//   broadcast-balanced   — EBU R95 MCR contribution monitoring (default)
//   srt-contribution     — SRT Alliance spec; ARQ delivers near-lossless TS
//                          but retransmission adds IAT/jitter variation
//   contribution-relaxed — ETSI TR 101 290 / satellite / long-haul with
//                          inherent transport noise
//   ott-streaming        — MPEG-DASH / HLS IP delivery, loss-tolerant
const PROFILES = {
  'broadcast-strict': {
    label: 'Broadcast Strict',
    standard: 'EBU R95 / ITU-R BT.656',
    description: 'TX master control feed. Zero tolerance for TS errors — any single discontinuity or CC error triggers a warning.',
    health: {
      scoreOk: 90, scoreWarning: 75,
      lossWarnPct: 0.01, lossCriticalPct: 0.1,
      jitterWarnMs: 2, jitterCriticalMs: 8,
      iatP95WarnMs: 20, iatP95CriticalMs: 80,
      tsDiscWarnCount: 1, tsDiscCriticalCount: 3,
      ccWarnCount: 1, ccCriticalCount: 3,
    },
    probeCadence: { heavyProbeEvery: 2 },
  },

  'broadcast-balanced-v1': {
    label: 'Broadcast Balanced',
    standard: 'EBU R95 / ETSI TR 101 290',
    description: 'MCR contribution monitoring. Tolerates 1–2 probe-join artefacts (ETR 290 burst-window) before raising alarms.',
    health: {
      scoreOk: 85, scoreWarning: 65,
      lossWarnPct: 0.1, lossCriticalPct: 1.0,
      jitterWarnMs: 5, jitterCriticalMs: 15,
      iatP95WarnMs: 50, iatP95CriticalMs: 150,
      tsDiscWarnCount: 3, tsDiscCriticalCount: 8,
      ccWarnCount: 3, ccCriticalCount: 8,
    },
    probeCadence: { heavyProbeEvery: 3 },
  },

  'srt-contribution': {
    label: 'SRT Contribution',
    standard: 'SRT Alliance / IETF (haivision-srt)',
    description: 'SRT ARQ retransmission delivers a near-lossless TS layer. Tighter CC/loss thresholds than broadcast; higher IAT P95 tolerance to account for ARQ retransmit window jitter.',
    health: {
      scoreOk: 85, scoreWarning: 65,
      lossWarnPct: 0.01, lossCriticalPct: 0.1,
      jitterWarnMs: 10, jitterCriticalMs: 40,
      iatP95WarnMs: 120, iatP95CriticalMs: 400,
      tsDiscWarnCount: 1, tsDiscCriticalCount: 4,
      ccWarnCount: 1, ccCriticalCount: 4,
    },
    probeCadence: { heavyProbeEvery: 3 },
  },

  'contribution-relaxed': {
    label: 'Contribution Relaxed',
    standard: 'ETSI TR 101 290 / DVB-S2',
    description: 'Satellite and long-haul contribution links with inherent transport noise. High threshold tolerance; warns only on sustained or severe degradation.',
    health: {
      scoreOk: 75, scoreWarning: 55,
      lossWarnPct: 1.0, lossCriticalPct: 5.0,
      jitterWarnMs: 20, jitterCriticalMs: 60,
      iatP95WarnMs: 200, iatP95CriticalMs: 600,
      tsDiscWarnCount: 8, tsDiscCriticalCount: 20,
      ccWarnCount: 5, ccCriticalCount: 15,
    },
    probeCadence: { heavyProbeEvery: 3 },
  },

  'ott-streaming': {
    label: 'OTT Streaming',
    standard: 'MPEG-DASH / HLS (ETSI TS 103 285)',
    description: 'IP delivery to end-user devices. Loss-tolerant; focuses on sustained bitrate stability and service availability rather than single-packet errors.',
    health: {
      scoreOk: 75, scoreWarning: 55,
      lossWarnPct: 1.0, lossCriticalPct: 3.0,
      jitterWarnMs: 15, jitterCriticalMs: 50,
      iatP95WarnMs: 150, iatP95CriticalMs: 500,
      tsDiscWarnCount: 5, tsDiscCriticalCount: 15,
      ccWarnCount: 5, ccCriticalCount: 15,
    },
    probeCadence: { heavyProbeEvery: 3 },
  },
};

const DEFAULT_PROFILE = 'broadcast-balanced-v1';

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
  const profileName = String(
    filePolicy.profile || process.env.MONITORING_POLICY_PROFILE || DEFAULT_PROFILE
  );
  // Fall back to default if an unknown profile name is requested.
  const preset = PROFILES[profileName] || PROFILES[DEFAULT_PROFILE];
  const ph = preset.health;
  const pc = preset.probeCadence;

  return {
    profile: profileName,
    profileMeta: {
      label: preset.label,
      standard: preset.standard,
      description: preset.description,
    },
    source: fs.existsSync(POLICY_PATH) ? 'config' : 'defaults',
    path: POLICY_PATH,
    probeCadence: {
      baseIntervalMs: _envNumber(
        'TS_PROBE_BASE_INTERVAL_MS',
        Number(filePolicy?.probeCadence?.baseIntervalMs || 5000)
      ),
      heavyProbeEvery: Math.max(1, Math.floor(_envNumber(
        'TS_PROBE_HEAVY_EVERY',
        Number(filePolicy?.probeCadence?.heavyProbeEvery || pc.heavyProbeEvery || 3)
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
        Number(filePolicy?.probeCadence?.startupJitterMaxMs || 4500)
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
      scoreWarning: _envNumber('TS_HEALTH_SCORE_WARNING', Number(filePolicy?.health?.scoreWarning ?? ph.scoreWarning)),
      scoreOk:      _envNumber('TS_HEALTH_SCORE_OK',      Number(filePolicy?.health?.scoreOk      ?? ph.scoreOk)),
      lossWarnPct:     _envNumber('TS_HEALTH_LOSS_WARN_PCT',     Number(filePolicy?.health?.lossWarnPct     ?? ph.lossWarnPct)),
      lossCriticalPct: _envNumber('TS_HEALTH_LOSS_CRITICAL_PCT', Number(filePolicy?.health?.lossCriticalPct ?? ph.lossCriticalPct)),
      jitterWarnMs:     _envNumber('TS_HEALTH_JITTER_WARN_MS',     Number(filePolicy?.health?.jitterWarnMs     ?? ph.jitterWarnMs)),
      jitterCriticalMs: _envNumber('TS_HEALTH_JITTER_CRITICAL_MS', Number(filePolicy?.health?.jitterCriticalMs ?? ph.jitterCriticalMs)),
      iatP95WarnMs:     _envNumber('TS_HEALTH_IAT_P95_WARN_MS',     Number(filePolicy?.health?.iatP95WarnMs     ?? ph.iatP95WarnMs)),
      iatP95CriticalMs: _envNumber('TS_HEALTH_IAT_P95_CRITICAL_MS', Number(filePolicy?.health?.iatP95CriticalMs ?? ph.iatP95CriticalMs)),
      tsDiscWarnCount:     _envNumber('TS_HEALTH_TS_DISC_WARN_COUNT',     Number(filePolicy?.health?.tsDiscWarnCount     ?? ph.tsDiscWarnCount)),
      tsDiscCriticalCount: _envNumber('TS_HEALTH_TS_DISC_CRITICAL_COUNT', Number(filePolicy?.health?.tsDiscCriticalCount ?? ph.tsDiscCriticalCount)),
      ccWarnCount:     _envNumber('TS_HEALTH_CC_WARN_COUNT',     Number(filePolicy?.health?.ccWarnCount     ?? ph.ccWarnCount)),
      ccCriticalCount: _envNumber('TS_HEALTH_CC_CRITICAL_COUNT', Number(filePolicy?.health?.ccCriticalCount ?? ph.ccCriticalCount)),
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
      minSamples:          _envNumber('TS_20227_MIN_SAMPLES',           Number(filePolicy?.smpte20227?.minSamples          || 50)),
      maxLossPct:          _envNumber('TS_20227_MAX_LOSS_PCT',           Number(filePolicy?.smpte20227?.maxLossPct          || 0.0)),
      maxGapEvents:        _envNumber('TS_20227_MAX_GAP_EVENTS',         Number(filePolicy?.smpte20227?.maxGapEvents        || 0)),
      maxDuplicateEvents:  _envNumber('TS_20227_MAX_DUPLICATE_EVENTS',   Number(filePolicy?.smpte20227?.maxDuplicateEvents  || 0)),
      maxReorderedEvents:  _envNumber('TS_20227_MAX_REORDER_EVENTS',     Number(filePolicy?.smpte20227?.maxReorderedEvents  || 0)),
      requireNicCapture:   _envBoolean('TS_20227_REQUIRE_NIC_CAPTURE',   Boolean(filePolicy?.smpte20227?.requireNicCapture ?? true)),
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
    profileMeta: policy.profileMeta,
    source: policy.source,
    probeCadence: policy.probeCadence,
    bitrate: policy.bitrate,
    loadedAt: policy.loadedAt,
  };
}

function setProfile(profileName) {
  if (!PROFILES[profileName]) {
    throw new Error(`Unknown profile '${profileName}'. Valid: ${Object.keys(PROFILES).join(', ')}`);
  }
  const existing = _readPolicyFile();
  const updated = { ...existing, profile: profileName };
  fs.mkdirSync(path.dirname(POLICY_PATH), { recursive: true });
  fs.writeFileSync(POLICY_PATH, JSON.stringify(updated, null, 2) + '\n', 'utf8');
}

module.exports = {
  getMonitoringPolicy,
  getMonitoringPolicySummary,
  setProfile,
  PROFILES,
  POLICY_PATH,
};
