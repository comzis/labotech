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

const C = {
  panel: '#0d1118',
  panelAlt: '#0f1420',
  border: '#161d2b',
  borderHi: '#243045',
  text: '#c4d0e8',
  muted: '#3e506a',
  head: '#6b82aa',
  cyan: '#00e5ff',
  ok: '#00e676',
  warn: '#ffab00',
  err: '#ff3d57',
  accent: '#2d5fff',
};

const LED_COLORS = {
  cyan: C.cyan,
  green: C.ok,
  purple: '#9d6fff',
  red: C.err,
  amber: C.warn,
  blue: C.accent,
  teal: '#00ddaa',
};

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
      className={className}
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 3,
        overflow: 'hidden',
        boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          background: C.panelAlt,
          borderBottom: `1px solid ${C.borderHi}`,
        }}
      >
        {Icon && (
          <Icon
            strokeWidth={1.5}
            style={{ width: 13, height: 13, color: ledColor, opacity: 0.9, flexShrink: 0 }}
          />
        )}

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.15em',
            color: C.head,
            textTransform: 'uppercase',
            fontFamily: "'Courier New',monospace",
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
          }}
        >
          {title}
        </span>

        <span
          className={ledPulse ? 'animate-led-pulse' : ''}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: ledColor,
            boxShadow: `0 0 6px ${ledColor}aa`,
            flexShrink: 0,
          }}
        />
      </div>

      <div style={{ padding: '10px 12px', background: C.panel, color: C.text }}>
        {children}
      </div>
    </motion.div>
  );
}
