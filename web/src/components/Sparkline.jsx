import React from 'react';

export default function Sparkline({ data = [], width = 120, height = 30, color = '#3b82f6' }) {
  if (data.length < 2) {
    return <svg width={width} height={height} className="opacity-30"><line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke={color} strokeWidth="1" /></svg>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
