'use strict';

const SUPPORTED_VIDEO_CODECS = ['libx264', 'libx265', 'copy'];
const SUPPORTED_AUDIO_CODECS = ['aac', 'mp2', 'ac3', 'eac3', 'copy'];

const VIDEO_PROFILES_BY_CODEC = {
  libx264: ['baseline', 'main', 'high', 'high422'],
  libx265: ['main', 'main10'],
  copy: [],
};

const DEFAULT_VIDEO_PROFILE_BY_CODEC = {
  libx264: 'high',
  libx265: 'main',
  copy: null,
};

function _norm(v) {
  return String(v || '').trim().toLowerCase();
}

function isSupportedVideoCodec(codec) {
  return SUPPORTED_VIDEO_CODECS.includes(_norm(codec));
}

function isSupportedAudioCodec(codec) {
  return SUPPORTED_AUDIO_CODECS.includes(_norm(codec));
}

function normalizeVideoCodec(codec, fallback = 'libx264') {
  const c = _norm(codec);
  return isSupportedVideoCodec(c) ? c : fallback;
}

function normalizeAudioCodec(codec, fallback = 'aac') {
  const c = _norm(codec);
  return isSupportedAudioCodec(c) ? c : fallback;
}

function normalizeVideoProfile(codec, profile) {
  const c = normalizeVideoCodec(codec);
  const p = _norm(profile);
  const allowed = VIDEO_PROFILES_BY_CODEC[c] || [];
  if (allowed.length === 0) return null;
  if (allowed.includes(p)) return p;
  return DEFAULT_VIDEO_PROFILE_BY_CODEC[c] || allowed[0] || null;
}

module.exports = {
  SUPPORTED_VIDEO_CODECS,
  SUPPORTED_AUDIO_CODECS,
  VIDEO_PROFILES_BY_CODEC,
  DEFAULT_VIDEO_PROFILE_BY_CODEC,
  isSupportedVideoCodec,
  isSupportedAudioCodec,
  normalizeVideoCodec,
  normalizeAudioCodec,
  normalizeVideoProfile,
};
