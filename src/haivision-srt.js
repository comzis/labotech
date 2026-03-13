'use strict';

function buildHaivisionCallerUrl({
  host,
  port,
  latency,
  passphrase,
  pbkeylen,
  streamId,
  adapter,
}) {
  let url = `srt://${host}:${port}?mode=caller&latency=${latency}&stats=1&statsintvl=1`;
  if (passphrase) url += `&passphrase=${encodeURIComponent(passphrase)}&pbkeylen=${pbkeylen}`;
  if (streamId) url += `&streamid=${encodeURIComponent(streamId)}`;
  if (adapter) url += `&adapter=${encodeURIComponent(adapter)}`;
  return url;
}

function parseHaivisionStatsLine(line) {
  if (!String(line || '').includes('srt-stats')) return null;

  const mRate = line.match(/rate=([\d.]+)Mbps/i);
  const mBw = line.match(/bw=([\d.]+)Mbps/i);
  const mRtt = line.match(/rtt=([\d.]+)ms/i);
  const mTotal = line.match(/total=(\d+)/i);
  const mRetrans = line.match(/retrans=(\d+)/i);
  const mLoss = line.match(/loss=(\d+)/i);
  const mNak = line.match(/nak=(\d+)/i);

  const stats = {};
  if (mRate) stats.rateMbps = parseFloat(mRate[1]);
  if (mBw) stats.bwMbps = parseFloat(mBw[1]);
  if (mRtt) stats.rttMs = parseFloat(mRtt[1]);
  if (mTotal) stats.pktTotal = parseInt(mTotal[1], 10);
  if (mRetrans) stats.pktRetrans = parseInt(mRetrans[1], 10);
  if (mLoss) stats.pktLoss = parseInt(mLoss[1], 10);
  if (mNak) stats.pktNak = parseInt(mNak[1], 10);

  if (stats.pktTotal > 0 && stats.pktLoss !== undefined) {
    stats.lossPercent = parseFloat(((stats.pktLoss / stats.pktTotal) * 100).toFixed(2));
  }

  return Object.keys(stats).length > 0 ? stats : null;
}

function classifyHaivisionLink(stats) {
  if (!stats) return { status: 'unknown', reason: 'waiting for haivision stats' };

  const loss = Number(stats.lossPercent);
  const rtt = Number(stats.rttMs);
  const retrans = Number(stats.pktRetrans);

  if ((Number.isFinite(loss) && loss >= 1) || (Number.isFinite(rtt) && rtt >= 120)) {
    return { status: 'critical', reason: 'high loss or rtt' };
  }
  if ((Number.isFinite(loss) && loss > 0) || (Number.isFinite(rtt) && rtt >= 70) || (Number.isFinite(retrans) && retrans > 0)) {
    return { status: 'degraded', reason: 'non-zero loss/retrans or elevated rtt' };
  }
  return { status: 'healthy', reason: 'stable srt path' };
}

module.exports = {
  buildHaivisionCallerUrl,
  parseHaivisionStatsLine,
  classifyHaivisionLink,
};
