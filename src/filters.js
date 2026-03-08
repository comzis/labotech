'use strict';

/**
 * Build a logo overlay filter string.
 * @param {string} logoPath  - path to logo image
 * @param {string} position  - 'topright' | 'topleft' | 'bottomright' | 'bottomleft'
 * @param {number} padding   - pixel padding from edge (default 10)
 */
function buildLogoOverlay(logoPath, position = 'topright', padding = 10) {
  const positions = {
    topright:    `W-w-${padding}:${padding}`,
    topleft:     `${padding}:${padding}`,
    bottomright: `W-w-${padding}:H-h-${padding}`,
    bottomleft:  `${padding}:H-h-${padding}`,
  };
  const overlay = positions[position] || positions.topright;
  return `movie=${logoPath}[logo];[in][logo]overlay=${overlay}[out]`;
}

/**
 * Build a noise reduction filter string.
 * @param {number} strength - 0–10 (default 3)
 */
function buildNoiseReduction(strength = 3) {
  // hqdn3d: luma_spatial, chroma_spatial, luma_tmp, chroma_tmp
  const s = Math.min(10, Math.max(0, strength));
  return `hqdn3d=${s}:${s * 0.75}:${s * 1.5}:${s * 1.2}`;
}

/**
 * Build a scale filter, optionally preserving aspect ratio.
 * @param {number} width
 * @param {number} height  - use -1 to preserve aspect ratio
 * @param {string} flags   - scaling algorithm (default 'lanczos')
 */
function buildScaleFilter(width, height = -1, flags = 'lanczos') {
  return `scale=${width}:${height}:flags=${flags}`;
}

module.exports = { buildLogoOverlay, buildNoiseReduction, buildScaleFilter };
