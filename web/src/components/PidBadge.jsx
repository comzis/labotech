import React from 'react';

export default function PidBadge({ pid }) {
  if (pid === null || pid === undefined) return null;
  const hex = `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`;
  return (
    <span className="inline-block bg-gray-800 text-blue-300 text-xs px-1.5 py-0.5 rounded font-mono border border-gray-700">
      {hex}
    </span>
  );
}
