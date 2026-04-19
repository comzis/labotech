import React from 'react';

// Broadcast-standard LED colours matching rack design tokens
const LED = {
  live:    { bg: '#00dd55', glow: 'rgba(0,221,85,0.55)'    },
  stopped: { bg: '#1c1c1c', glow: 'transparent'            },
  error:   { bg: '#ff2233', glow: 'rgba(255,34,51,0.55)'   },
  warning: { bg: '#ffaa00', glow: 'rgba(255,170,0,0.55)'   },
};

export default function StatusDot({ status = 'stopped', pulse = false }) {
  const { bg, glow } = LED[status] || LED.stopped;
  const isOn = status !== 'stopped';

  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
        pulse && status === 'live' ? 'animate-led-pulse' : ''
      }`}
      style={{
        background: isOn
          ? `radial-gradient(circle at 38% 32%, #ffffff44, ${bg}bb, ${bg})`
          : '#1a1a1a',
        boxShadow: isOn
          ? `0 0 5px ${glow}, 0 0 10px ${glow}`
          : 'inset 0 1px 2px rgba(0,0,0,0.6)',
      }}
    />
  );
}
