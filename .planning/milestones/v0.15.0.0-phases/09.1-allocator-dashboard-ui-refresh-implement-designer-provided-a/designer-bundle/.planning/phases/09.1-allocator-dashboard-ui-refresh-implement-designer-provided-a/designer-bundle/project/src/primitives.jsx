// ---------------------------------------------------------------------------
// Primitives: Card, Badge, Button, formatters, metric chip, Pill
// ---------------------------------------------------------------------------

const fmtUSD = (n, opts = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1_000_000) return (n < 0 ? "−" : "") + "$" + (abs / 1_000_000).toFixed(2) + "M";
  if (opts.compact && abs >= 1_000) return (n < 0 ? "−" : "") + "$" + (abs / 1_000).toFixed(1) + "K";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: opts.cents ? 2 : 0 });
};

const fmtPct = (n, opts = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = opts.explicitSign && n > 0 ? "+" : "";
  return sign + (n * 100).toFixed(opts.precision ?? 2) + "%";
};

const fmtNum = (n, opts = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(opts.precision ?? 2);
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const metricColor = (n) => {
  if (n == null) return "muted";
  if (n > 0.0001) return "pos";
  if (n < -0.0001) return "neg";
  return "";
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function Card({ children, padding = "md", className = "", style, ...rest }) {
  const pad = padding === "sm" ? 16 : padding === "lg" ? 24 : 20;
  return (
    <div
      className={className}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        padding: pad,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge (tag-colored)
// ---------------------------------------------------------------------------
function Badge({ children, color, tone = "subtle", size = "sm" }) {
  const c = color || "#64748B";
  const bg = tone === "solid" ? c : c + "14"; // ~8% alpha
  const fg = tone === "solid" ? "#fff" : c;
  const brd = tone === "solid" ? "transparent" : c + "33";
  const pad = size === "xs" ? "1px 6px" : "2px 8px";
  const fs = size === "xs" ? 10 : 10.5;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: bg,
      color: fg,
      border: `1px solid ${brd}`,
      borderRadius: "var(--radius-sm)",
      padding: pad,
      fontSize: fs,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      lineHeight: 1.3,
      fontFamily: "DM Sans",
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
function Button({ children, variant = "secondary", size = "md", onClick, disabled, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const heights = { sm: 28, md: 34, lg: 40 };
  const fs = { sm: 12.5, md: 13.5, lg: 14 };
  const pad = { sm: "0 10px", md: "0 14px", lg: "0 18px" };
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    height: heights[size],
    padding: pad[size],
    fontSize: fs[size],
    fontWeight: 500,
    borderRadius: "var(--radius-md)",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 150ms ease-out",
    fontFamily: "DM Sans",
    opacity: disabled ? 0.5 : 1,
    whiteSpace: "nowrap",
  };
  let skin = {};
  if (variant === "primary") {
    skin = {
      background: hover ? "var(--accent-hover)" : "var(--accent)",
      color: "#fff",
      border: "1px solid var(--accent)",
    };
  } else if (variant === "secondary") {
    skin = {
      background: hover ? "#F1F5F9" : "var(--surface)",
      color: "var(--text-primary)",
      border: "1px solid var(--border)",
    };
  } else if (variant === "ghost") {
    skin = {
      background: hover ? "#F1F5F9" : "transparent",
      color: "var(--text-secondary)",
      border: "1px solid transparent",
    };
  } else if (variant === "danger") {
    skin = {
      background: hover ? "#FEF2F2" : "var(--surface)",
      color: "var(--negative)",
      border: "1px solid #FECACA",
    };
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...skin, ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pill / filter chip
// ---------------------------------------------------------------------------
function Pill({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 28,
        padding: "0 12px",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--accent-10)" : "var(--surface)",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 150ms ease-out",
        fontFamily: "DM Sans",
      }}
    >{children}</button>
  );
}

// ---------------------------------------------------------------------------
// Small icon set (inline SVG, 1.5 stroke, currentColor)
// ---------------------------------------------------------------------------
const Icon = {
  chevronDown: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>,
  chevronRight: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4l4 4-4 4" /></svg>,
  close: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  calendar: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.25"/><path d="M2.25 6.5h11.5M5.5 2v2.5M10.5 2v2.5"/></svg>,
  check: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7"/></svg>,
  verified: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.7 1.6 2.3-.3.6 2.2 2 1.2-.8 2.2.8 2.2-2 1.2-.6 2.2-2.3-.3L8 15l-1.7-1.6-2.3.3-.6-2.2-2-1.2.8-2.2L1.4 5.9l2-1.2.6-2.2 2.3.3L8 1z" fillOpacity="0.16"/><path d="M5.5 8.2l1.7 1.7 3.4-3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  alert: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.5L15 14H1L8 1.5z"/><path d="M8 6v4"/><circle cx="8" cy="12" r="0.6" fill="currentColor"/></svg>,
  arrowDown: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v10M4 9l4 4 4-4"/></svg>,
  arrowUp: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M4 7l4-4 4 4"/></svg>,
  bolt: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1L3 9h4l-1 6 6-8H8l1-6z"/></svg>,
  grid: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></svg>,
  plus: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>,
  drag: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></svg>,
  dots: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12" cy="8" r="1.2"/></svg>,
  search: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M13.5 13.5l-3-3"/></svg>,
  settings: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></svg>,
  note: (p = {}) => <svg width={p.size || 14} height={p.size || 14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2.5h7l3 3V13a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z"/><path d="M10 2.5V5.5h3"/><path d="M5 8h6M5 10.5h4"/></svg>,
};

Object.assign(window, { fmtUSD, fmtPct, fmtNum, fmtDate, metricColor, Card, Badge, Button, Pill, Icon });
