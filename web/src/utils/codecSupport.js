export const SUPPORTED_VIDEO_CODECS = [
  { value: 'libx264', label: 'H.264 (libx264)' },
  { value: 'libx265', label: 'H.265/HEVC (libx265)' },
  { value: 'copy', label: 'Pass-through (copy)' },
];

export const SUPPORTED_AUDIO_CODECS = [
  { value: 'aac', label: 'AAC-LC' },
  { value: 'mp2', label: 'MPEG-1 Layer II (MP2)' },
  { value: 'ac3', label: 'AC-3 (Dolby Digital)' },
  { value: 'eac3', label: 'E-AC-3 (Dolby Digital Plus)' },
  { value: 'copy', label: 'Pass-through (copy)' },
];

export const VIDEO_PROFILES_BY_CODEC = {
  libx264: [
    { value: 'baseline', label: 'baseline' },
    { value: 'main', label: 'main' },
    { value: 'high', label: 'high' },
    { value: 'high422', label: 'high422' },
  ],
  libx265: [
    { value: 'main', label: 'main' },
    { value: 'main10', label: 'main10' },
  ],
  copy: [],
};

export function profileOptionsForCodec(codec) {
  return VIDEO_PROFILES_BY_CODEC[codec] || [];
}
