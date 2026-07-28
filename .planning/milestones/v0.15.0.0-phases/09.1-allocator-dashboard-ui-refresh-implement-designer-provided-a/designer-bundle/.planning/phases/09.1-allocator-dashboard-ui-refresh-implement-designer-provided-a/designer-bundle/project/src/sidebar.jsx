// ---------------------------------------------------------------------------
// Sidebar — matches DashboardChrome from the repo
// ---------------------------------------------------------------------------

function Sidebar({ current }) {
  const sections = [
    {
      heading: "MY WORKSPACE",
      items: [
        { label: "My Allocation", href: "allocations", icon: "portfolio", badge: "1" },
        { label: "Scenarios", href: "scenarios", icon: "bar" },
        { label: "Recommendations", href: "recommendations", icon: "match" },
      ],
    },
    {
      heading: "DISCOVERY",
      subgroups: [
        {
          label: "Digital Assets",
          items: [
            { label: "Market Neutral", href: "disc-da-mn", icon: "search" },
            { label: "Trend", href: "disc-da-trend", icon: "search" },
            { label: "Vol Strategies", href: "disc-da-vol", icon: "search" },
            { label: "Stat-Arb", href: "disc-da-sa", icon: "search" },
          ],
        },
        {
          label: "TradFi",
          items: [
            { label: "Equity L/S", href: "disc-tf-ls", icon: "search" },
            { label: "Macro", href: "disc-tf-macro", icon: "search" },
            { label: "Credit", href: "disc-tf-credit", icon: "search" },
            { label: "Rates Vol", href: "disc-tf-rv", icon: "search" },
          ],
        },
      ],
    },
    {
      heading: "ACCOUNT",
      items: [
        { label: "Profile", href: "profile", icon: "user" },
      ],
    },
  ];

  return (
    <aside style={{
      position: "fixed", inset: "0 auto 0 0", width: 260,
      background: "var(--sidebar)", color: "var(--sidebar-text)",
      display: "flex", flexDirection: "column", zIndex: 30,
    }}>
      <div style={{ height: 64, display: "flex", alignItems: "center", padding: "0 24px" }}>
        <span className="font-display" style={{ color: "#fff", fontSize: 22, letterSpacing: "-0.01em" }}>
          Quantalyze
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
        {sections.map((section) => (
          <div key={section.heading} style={{ marginTop: 24 }}>
            <p style={{
              margin: "0 12px 8px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.12em",
              color: "rgba(203,213,225,0.55)",
              textTransform: "uppercase",
            }}>
              {section.heading}
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {section.items && section.items.map((item) => {
                const active = item.href === current;
                return (
                  <SidebarItem key={item.href} item={item} active={active} />
                );
              })}
              {section.subgroups && section.subgroups.map((sg) => (
                <li key={sg.label} style={{ marginTop: 8 }}>
                  <div style={{
                    padding: "4px 12px 4px 12px",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "rgba(203,213,225,0.75)",
                    letterSpacing: "0.02em",
                  }}>
                    {sg.label}
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {sg.items.map((item) => {
                      const active = item.href === current;
                      return (
                        <SidebarItem key={item.href} item={item} active={active} indent />
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: 16, display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg, #1B6B5A, #3B9A84)",
          display: "grid", placeItems: "center",
          color: "#fff", fontWeight: 600, fontSize: 12,
        }}>NP</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Nora Price</div>
          <div style={{ color: "rgba(203,213,225,0.6)", fontSize: 11 }}>Northbay Capital LP</div>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({ item, active, indent }) {
  const [hover, setHover] = React.useState(false);
  const bg = active ? "var(--sidebar-active)" : hover ? "var(--sidebar-hover)" : "transparent";
  const fg = active || hover ? "#fff" : "var(--sidebar-text)";
  return (
    <li>
      <a
        href="#"
        onClick={(e) => e.preventDefault()}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: indent ? "7px 12px 7px 22px" : "8px 12px",
          borderRadius: 8,
          color: fg, background: bg,
          textDecoration: "none", fontSize: 13.5,
          transition: "background 150ms ease-out, color 150ms ease-out",
        }}
      >
        <SideIcon kind={item.icon} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge && (
          <span style={{
            background: "var(--accent)", color: "#fff",
            fontSize: 10, fontWeight: 600,
            padding: "1px 6px", borderRadius: 999,
            minWidth: 18, textAlign: "center",
          }}>{item.badge}</span>
        )}
      </a>
    </li>
  );
}

function SideIcon({ kind }) {
  const props = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (kind) {
    case "portfolio": return <svg {...props}><rect x="2" y="4" width="12" height="10" rx="1.5"/><path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M2 8h12"/></svg>;
    case "bar": return <svg {...props}><path d="M4 12V7M8 12V4M12 12V9"/></svg>;
    case "match": return <svg {...props}><path d="M3 4h4M3 12h4"/><path d="M9 4l4 4-4 4"/><path d="M13 8H7"/></svg>;
    case "search": return <svg {...props}><circle cx="7" cy="7" r="4"/><path d="M13 13l-2.5-2.5"/></svg>;
    case "user": return <svg {...props}><circle cx="8" cy="5" r="2.5"/><path d="M3 14a5 5 0 0110 0"/></svg>;
    default: return <svg {...props}><circle cx="8" cy="8" r="4"/></svg>;
  }
}

Object.assign(window, { Sidebar });
