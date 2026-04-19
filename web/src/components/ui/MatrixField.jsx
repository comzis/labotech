import React from 'react';

const C = {
  border: '#161d2b',
  borderFocus: '#2d5fff',
  panel: '#080b10',
  text: '#c4d0e8',
  muted: '#3e506a',
  head: '#6b82aa',
  cyan: '#00e5ff',
  green: '#00e676',
  purple: '#9d6fff',
  amber: '#ffab00',
};

const VALUE_COLORS = {
  cyan: C.cyan,
  green: C.green,
  purple: C.purple,
  amber: C.amber,
};

function EngravedLabel({ children, required }) {
  return (
    <label style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: C.head, paddingLeft: 2 }}>
      {children}{required ? <span style={{ color: '#ff3d57', marginLeft: 2 }}>*</span> : null}
    </label>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────
export function Field({ label, value, onChange, color = 'cyan', required, ...props }) {
  const valColor = VALUE_COLORS[color] || C.cyan;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <EngravedLabel required={required}>{label}</EngravedLabel>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          padding: '6px 8px',
          fontSize: 11,
          color: valColor,
          fontFamily: "'Courier New',monospace",
          outline: 'none',
        }}
        onFocus={(e) => { e.target.style.borderColor = C.borderFocus; }}
        onBlur={(e) => { e.target.style.borderColor = C.border; }}
      />
    </div>
  );
}

// ── SelectField ────────────────────────────────────────────────────────────────
export function SelectField({ label, options, value, onChange, color = 'cyan', ...props }) {
  const valColor = VALUE_COLORS[color] || C.cyan;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <EngravedLabel>{label}</EngravedLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          padding: '6px 8px',
          fontSize: 11,
          color: valColor,
          fontFamily: "'Courier New',monospace",
          outline: 'none',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%233e506a'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'calc(100% - 8px) center',
          paddingRight: 24,
        }}
        onFocus={(e) => { e.target.style.borderColor = C.borderFocus; }}
        onBlur={(e) => { e.target.style.borderColor = C.border; }}
      >
        {options.map((o) => {
          const isObj = typeof o === 'object';
          return (
            <option key={isObj ? o.value : o} value={isObj ? o.value : o}>
              {isObj ? o.label : o}
            </option>
          );
        })}
      </select>
    </div>
  );
}

// ── PidField ───────────────────────────────────────────────────────────────────
export function PidField({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <EngravedLabel>{label}</EngravedLabel>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min="1"
        max="65535"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 2,
          padding: '6px 8px',
          fontSize: 11,
          color: C.purple,
          fontFamily: "'Courier New',monospace",
          outline: 'none',
        }}
        onFocus={(e) => { e.target.style.borderColor = C.borderFocus; }}
        onBlur={(e) => { e.target.style.borderColor = C.border; }}
      />
    </div>
  );
}
