import React from 'react';
import { motion } from 'framer-motion';

export const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 26 } },
};

export const containerVariants = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.08 } },
};

// LED colour map: accent prop → colour value
const LED_COLORS = {
  cyan:   '#00ddff',
  green:  '#00dd55',
  purple: '#cc44ff',
  red:    '#ff2233',
  amber:  '#ffaa00',
  blue:   '#2299ff',
  teal:   '#00ddaa',
};

function ScrewHole() {
  return (
    <div
      className="w-3 h-3 rounded-full shrink-0"
      style={{
        background: 'radial-gradient(circle at 38% 32%, #3a3a3a, #0a0a0a)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.95), 0 0.5px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Phillips cross mark */}
      <svg viewBox="0 0 12 12" className="w-full h-full opacity-20">
        <line x1="6" y1="2" x2="6" y2="10" stroke="#888" strokeWidth="1" />
        <line x1="2" y1="6" x2="10" y2="6" stroke="#888" strokeWidth="1" />
      </svg>
    </div>
  );
}

function RackLED({ color = '#00dd55', pulse = false }) {
  return (
    <div
      className={`w-2.5 h-2.5 rounded-full shrink-0 ${pulse ? 'animate-led-pulse' : ''}`}
      style={{
        background: `radial-gradient(circle at 38% 32%, #ffffff55, ${color}cc, ${color})`,
        boxShadow: `0 0 5px ${color}cc, 0 0 10px ${color}55`,
      }}
    />
  );
}

export default function BentoCard({
  title,
  icon: Icon,
  children,
  className = '',
  accentColor = 'cyan',
  ledPulse = false,
}) {
  const ledColor = LED_COLORS[accentColor] || LED_COLORS.cyan;

  return (
    <motion.div
      variants={itemVariants}
      className={`rack-unit overflow-hidden ${className}`}
      style={{
        background: '#141414',
        border: '1px solid #252525',
        boxShadow: '0 4px 20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.025)',
      }}
    >
      {/* ── Bezel / front-panel header ───────────────────────────────────── */}
      <div
        className="flex items-center gap-2.5 px-3 py-2"
        style={{
          background: 'linear-gradient(180deg, #282828 0%, #1e1e1e 55%, #181818 100%)',
          borderBottom: '1px solid #0d0d0d',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <ScrewHole />

        {Icon && (
          <Icon
            className="w-3.5 h-3.5 shrink-0"
            strokeWidth={1.5}
            style={{ color: ledColor, opacity: 0.7 }}
          />
        )}

        <span
          className="flex-1 min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.22em] font-mono"
          style={{ color: '#888', textShadow: '0 1px 0 rgba(0,0,0,0.8)' }}
        >
          {title}
        </span>

        {/* Status LED */}
        <RackLED color={ledColor} pulse={ledPulse} />

        <ScrewHole />
      </div>

      {/* ── Panel face (content) ─────────────────────────────────────────── */}
      <div
        className="p-5"
        style={{
          background: '#141414',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.45)',
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}
