import React from "react";

export const C = {
  bg: "#06080c",
  surface: "#0b0e15",
  panel: "#0d1118",
  panelAlt: "#0f1420",
  panelB: "#0b0e14",
  border: "#161d2b",
  borderHi: "#243045",
  borderFocus: "#2d5fff",
  text: "#c4d0e8",
  muted: "#3e506a",
  dim: "#1a2233",
  head: "#6b82aa",
  input: "#080b10",
  selected: "#001f3a",
  ok: "#00e676",
  warn: "#ffab00",
  err: "#ff3d57",
  crit: "#ff1a3a",
  info: "#29b6f6",
  cyan: "#00e5ff",
  accent: "#2d5fff",
  purple: "#9d6fff",
  orange: "#ff8c00",
  nominal: "#29b6f6",
  incident: "#cc44ff",
  etr: "#ff8c00",
  runtime: "#00e5ff",
  analyse: "#44ff88",
  blue: "#2979ff",
  red: "#f50057",
  gold: "#ffd740",
  s22: "#00e5ff",
};

// Supports both `color` and legacy `c` props
export const Dot = ({ color, c, size = 7, glow = true }) => {
  const finalColor = color || c || C.ok;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: finalColor,
        boxShadow: glow ? `0 0 ${size}px ${finalColor}88` : "none",
        flexShrink: 0,
      }}
    />
  );
};

export const Badge = ({ label, color = C.ok, filled = false, small = false }) => (
  <span
    style={{
      fontSize: small ? 8 : 9,
      fontWeight: 800,
      letterSpacing: "0.1em",
      color: filled ? C.bg : color,
      background: filled ? color : "transparent",
      border: `1px solid ${color}`,
      borderRadius: 2,
      padding: small ? "1px 4px" : "1px 6px",
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      display: "inline-flex",
      alignItems: "center",
    }}
  >
    {label}
  </span>
);

export const ServiceStatusBadge = ({ connected }) => (
  <Badge
    label={connected ? "RUNNING" : "OFFLINE"}
    color={connected ? C.ok : C.err}
    filled
  />
);

export const NavTab = ({
  label,
  icon,
  active = false,
  alert = false,
  onClick,
  activeColor = C.cyan,
}) => (
  <button
    onClick={onClick}
    style={{
      background: "none",
      border: "none",
      cursor: "pointer",
      padding: "6px 10px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      opacity: active ? 1 : 0.4,
      borderBottom: active ? `2px solid ${activeColor}` : "2px solid transparent",
      transition: "all 0.15s",
      position: "relative",
    }}
  >
    {alert && (
      <span
        style={{
          position: "absolute",
          top: 4,
          right: 6,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: C.err,
          boxShadow: `0 0 6px ${C.err}`,
        }}
      />
    )}
    <span style={{ fontSize: 13 }}>{icon}</span>
    <span
      style={{
        fontSize: 8.5,
        fontWeight: 700,
        letterSpacing: "0.12em",
        color: active ? activeColor : C.head,
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  </button>
);

export const Label = ({ children, required = false }) => (
  <div
    style={{
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.11em",
      color: C.head,
      textTransform: "uppercase",
      marginBottom: 4,
    }}
  >
    {children}
    {required && <span style={{ color: C.err, marginLeft: 2 }}>*</span>}
  </div>
);

export const Input = ({
  value,
  onChange,
  placeholder,
  mono = false,
  disabled = false,
  readOnly = false,
  suffix,
  style,
}) => (
  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={readOnly}
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: disabled || readOnly ? C.dim : C.input,
        border: `1px solid ${C.border}`,
        borderRadius: 2,
        color: disabled || readOnly ? C.muted : C.text,
        padding: "5px 8px",
        fontSize: mono ? 11 : 11,
        fontFamily: mono ? "'Courier New',monospace" : "inherit",
        outline: "none",
        transition: "border-color 0.15s",
        cursor: readOnly ? "default" : "text",
        ...style,
      }}
      onFocus={(e) => {
        if (!readOnly) e.target.style.borderColor = C.borderFocus;
      }}
      onBlur={(e) => {
        e.target.style.borderColor = C.border;
      }}
    />
    {suffix && (
      <span
        style={{
          position: "absolute",
          right: 7,
          fontSize: 9,
          color: C.muted,
          pointerEvents: "none",
        }}
      >
        {suffix}
      </span>
    )}
  </div>
);

// Alias used in some pages
export const Inp = (props) => <Input {...props} />;

export const Select = ({ value, onChange, options = [], disabled = false }) => (
  <select
    value={value}
    onChange={onChange}
    disabled={disabled}
    style={{
      width: "100%",
      background: disabled ? C.dim : C.input,
      border: `1px solid ${C.border}`,
      borderRadius: 2,
      color: disabled ? C.muted : C.text,
      padding: "5px 8px",
      fontSize: 11,
      fontFamily: "inherit",
      outline: "none",
      cursor: disabled ? "default" : "pointer",
      appearance: "none",
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%233e506a'/%3E%3C/svg%3E\")",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "calc(100% - 8px) center",
      paddingRight: 24,
    }}
  >
    {options.map((o) => (
      <option key={o.value ?? o} value={o.value ?? o}>
        {o.label ?? o}
      </option>
    ))}
  </select>
);

// Alias used in some pages
export const Sel = (props) => <Select {...props} />;

export const Field = ({ label, required = false, children, style }) => (
  <div style={{ display: "flex", flexDirection: "column", ...style }}>
    {label ? <Label required={required}>{label}</Label> : null}
    {children}
  </div>
);

export const PanelBox = ({ children, style }) => (
  <div
    style={{
      background: C.panel,
      border: `1px solid ${C.border}`,
      borderRadius: 3,
      overflow: "hidden",
      ...style,
    }}
  >
    {children}
  </div>
);

// Alias used in some pages
export const PBox = (props) => <PanelBox {...props} />;

export const SectionHead = ({
  icon,
  num,
  title,
  active = true,
  right,
  badge,
  activeDotColor = C.ok,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "7px 12px",
      background: C.panelAlt,
      borderBottom: `1px solid ${C.borderHi}`,
      borderRadius: "3px 3px 0 0",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {num ? (
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            color: C.muted,
            letterSpacing: "0.1em",
            background: C.dim,
            border: `1px solid ${C.border}`,
            borderRadius: 2,
            padding: "1px 5px",
          }}
        >
          {num}
        </span>
      ) : null}
      {icon ? <span style={{ fontSize: 11 }}>{icon}</span> : null}
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: "0.15em",
          color: C.head,
          textTransform: "uppercase",
        }}
      >
        {title}
      </span>
      {badge}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {right}
      <Dot color={active ? activeDotColor : C.muted} />
      <span style={{ fontSize: 8, color: C.muted }}>▲</span>
    </div>
  </div>
);

// Alias used in some pages
export const SHead = (props) => <SectionHead {...props} />;
