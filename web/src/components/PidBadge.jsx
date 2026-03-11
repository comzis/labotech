import React from 'react';

function normalizePid(pid, pidHex) {
  if (pid != null && Number.isFinite(Number(pid))) return Number(pid);
  if (typeof pidHex === 'string') {
    const t = pidHex.trim();
    if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
  }
  return null;
}

export default function PidBadge({ pid, pidHex }) {
  const normalized = normalizePid(pid, pidHex);
  if (normalized == null) {
    return pidHex ? (
      <span className="inline-block bg-gray-800 text-blue-300 text-xs px-1.5 py-0.5 rounded font-mono border border-gray-700">
        {pidHex}
      </span>
    ) : null;
  }
  const hex = `0x${normalized.toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    <span className="inline-block bg-gray-800 text-blue-300 text-xs px-1.5 py-0.5 rounded font-mono border border-gray-700">
      {normalized} ({hex})
    </span>
  );
}
