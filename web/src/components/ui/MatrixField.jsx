import React from 'react';

// ── Shared input style ─────────────────────────────────────────────────────────
const BASE_INPUT =
  'w-full bg-black/60 border border-rack-rail rounded-sm px-3 py-2 text-sm text-gray-200 font-mono ' +
  'focus:outline-none transition-all duration-150 placeholder:text-gray-700 ' +
  'shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)]';

const FOCUS_COLORS = {
  cyan:   'focus:border-led-cyan/50   focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,221,255,0.15)]',
  green:  'focus:border-led-green/50  focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,221,85,0.15)]',
  purple: 'focus:border-led-purple/50 focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_0_0_1px_rgba(204,68,255,0.15)]',
  amber:  'focus:border-led-amber/50  focus:shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,170,0,0.15)]',
};

const VALUE_COLORS = {
  cyan:   'text-led-cyan/90',
  green:  'text-led-green/90',
  purple: 'text-led-purple/90',
  amber:  'text-led-amber/90',
};

function EngravedLabel({ children }) {
  return (
    <label className="text-[10px] font-bold uppercase tracking-[0.2em] pl-0.5 engraved font-mono">
      {children}
    </label>
  );
}

// ── Field ──────────────────────────────────────────────────────────────────────
export function Field({ label, value, onChange, color = 'cyan', ...props }) {
  const focus = FOCUS_COLORS[color] || FOCUS_COLORS.cyan;
  const valColor = VALUE_COLORS[color] || VALUE_COLORS.cyan;
  return (
    <div className="flex flex-col gap-1">
      <EngravedLabel>{label}</EngravedLabel>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
        className={`${BASE_INPUT} ${focus} ${valColor} ${
          props.type === 'number' || props.className?.includes('font-mono') ? 'font-mono' : ''
        }`}
      />
    </div>
  );
}

// ── SelectField ────────────────────────────────────────────────────────────────
export function SelectField({ label, options, value, onChange, color = 'cyan', ...props }) {
  const focus = FOCUS_COLORS[color] || FOCUS_COLORS.cyan;
  return (
    <div className="flex flex-col gap-1">
      <EngravedLabel>{label}</EngravedLabel>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...props}
          className={`${BASE_INPUT} ${focus} appearance-none cursor-pointer pr-8`}
          style={{
            backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23555555" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>')`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          {options.map((o) => {
            const isObj = typeof o === 'object';
            return (
              <option
                key={isObj ? o.value : o}
                value={isObj ? o.value : o}
                className="bg-rack-panel text-gray-200"
              >
                {isObj ? o.label : o}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
}

// ── PidField ───────────────────────────────────────────────────────────────────
export function PidField({ label, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <EngravedLabel>{label}</EngravedLabel>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min="1"
        max="65535"
        className={`${BASE_INPUT} ${FOCUS_COLORS.purple} text-led-purple/90 font-mono`}
      />
    </div>
  );
}
