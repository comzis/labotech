export function resolveTransportBitrate(result) {
  const tsduckBps = Number(result?.dvb?.tsduckBitrateBps || 0);
  if (Number.isFinite(tsduckBps) && tsduckBps > 0) {
    return { bps: tsduckBps, mbps: tsduckBps / 1e6, source: 'tsduck', trusted: true };
  }

  const measuredBps = Number(result?.dvb?.measuredBitrateBps || 0);
  if (Number.isFinite(measuredBps) && measuredBps > 0) {
    return { bps: measuredBps, mbps: measuredBps / 1e6, source: 'measured', trusted: true };
  }

  const bps = Number(result?.dvb?.bitrateBps || 0);
  const source = String(result?.dvb?.bitrateSource || '').toLowerCase();
  const held = Boolean(result?.dvb?.bitrateHeldFromPrevious);
  const trustedBySource = source === 'tsduck' || source === 'measured';
  if (Number.isFinite(bps) && bps > 0) {
    return {
      bps,
      mbps: bps / 1e6,
      source: source || (held ? 'held' : '-'),
      trusted: Boolean(trustedBySource || held),
    };
  }

  return { bps: null, mbps: null, source: source || '-', trusted: false };
}

export function formatMbps(mbps, digits = 2) {
  if (!Number.isFinite(Number(mbps)) || Number(mbps) <= 0) return '-';
  return `${Number(mbps).toFixed(digits)} Mb/s`;
}

