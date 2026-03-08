import React from 'react';

const STATES = {
  live:    'bg-green-500 shadow-green-500/50',
  stopped: 'bg-gray-500',
  error:   'bg-red-500 shadow-red-500/50',
  warning: 'bg-yellow-500 shadow-yellow-500/50',
};

export default function StatusDot({ status = 'stopped', pulse = false }) {
  const cls = STATES[status] || STATES.stopped;
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shadow-sm ${cls} ${
        pulse && status === 'live' ? 'animate-pulse' : ''
      }`}
    />
  );
}
