// ---------------------------------------------------------------------------
// App — composes the whole allocator dashboard
// ---------------------------------------------------------------------------

function App() {
  const [tweaks, setTweaks] = React.useState(TWEAK_DEFAULTS);
  const [tweakVisible, setTweakVisible] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [bannerDismissed, setBannerDismissed] = React.useState(false);
  const [period, setPeriod] = React.useState("6M");
  const [customRange, setCustomRange] = React.useState(null); // { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
  const [customPickerOpen, setCustomPickerOpen] = React.useState(false);
  const [tab, setTab] = React.useState("overview");
  const [outcomes, setOutcomes] = React.useState(OUTCOMES);
  const [chartHoldings, setChartHoldings] = React.useState(new Set()); // holding ids on chart
  const [toast, setToast] = React.useState(null);
  // Widget layout: array of {k, w} where w = 1..4 (quarters). Row auto-wraps when width exceeds 4.
  const [widgetLayout, setWidgetLayout] = React.useState([
    { k: "bridge",    w: 4 },
    { k: "kpi",       w: 4 },
    { k: "equity",    w: 4 },
    { k: "holdings",  w: 3 },
    { k: "allocation",w: 1 },
    { k: "mandate",   w: 2 },
    { k: "outcomes",  w: 4 },
  ]);
  const [widgetPickerOpen, setWidgetPickerOpen] = React.useState(false);

  const WIDGET_CATALOG = {
    bridge:      { name: "Bridge recommendation", desc: "Mandate-breach callout with replacement candidates", defaultW: 4 },
    kpi:         { name: "KPI strip", desc: "AUM, YTD TWR, Sharpe, Max DD, avg ρ", defaultW: 4 },
    equity:      { name: "Equity curve", desc: "Portfolio vs benchmark, holding overlays", defaultW: 4 },
    holdings:    { name: "Holdings table", desc: "Active positions with inline outcome recording", defaultW: 3 },
    allocation:  { name: "Allocation by style", desc: "Exposure by strategy tag", defaultW: 2 },
    mandate:     { name: "Mandate snapshot", desc: "Live pass/fail of mandate gates", defaultW: 2 },
    outcomes:    { name: "Outcomes ledger", desc: "Bridge realized delta at 30/90/180d", defaultW: 4 },
    correlation: { name: "Correlation matrix", desc: "Pairwise ρ across holdings", unavailable: true },
    funding:     { name: "Funding rates", desc: "Perp funding across venues · 8h", unavailable: true },
    flows:       { name: "Flows ledger", desc: "Subs / redemptions / transfers", unavailable: true },
  };

  const addWidget = (k) => {
    setWidgetLayout(prev => prev.some(x => x.k === k) ? prev : [...prev, { k, w: WIDGET_CATALOG[k]?.defaultW || 4 }]);
    setWidgetPickerOpen(false);
  };
  const removeWidget = (k) => setWidgetLayout(prev => prev.filter(x => x.k !== k));
  const resizeWidget = (k, w) => setWidgetLayout(prev => prev.map(x => x.k === k ? { ...x, w: Math.max(1, Math.min(4, w)) } : x));
  const moveWidget = (from, to) => {
    setWidgetLayout(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(x => x.k === from);
      const toIdx = arr.findIndex(x => x.k === to);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  };

  // Edit-mode plumbing
  React.useEffect(() => {
    const onMsg = (e) => {
      if (!e.data) return;
      if (e.data.type === "__activate_edit_mode") setTweakVisible(true);
      if (e.data.type === "__deactivate_edit_mode") setTweakVisible(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Apply density via body attribute
  React.useEffect(() => {
    document.body.setAttribute("data-density", tweaks.density);
  }, [tweaks.density]);

  // Apply accent intensity via CSS variables
  React.useEffect(() => {
    const root = document.documentElement;
    if (tweaks.accentIntensity === "full") {
      root.style.setProperty("--accent", "#0E9F84");
      root.style.setProperty("--accent-hover", "#0B8870");
      root.style.setProperty("--accent-10", "rgba(14, 159, 132, 0.10)");
      root.style.setProperty("--chart-strategy", "#0E9F84");
    } else {
      root.style.setProperty("--accent", "#1B6B5A");
      root.style.setProperty("--accent-hover", "#155A4B");
      root.style.setProperty("--accent-10", "rgba(27, 107, 90, 0.08)");
      root.style.setProperty("--chart-strategy", "#1B6B5A");
    }
  }, [tweaks.accentIntensity]);

  const handleTweakChange = (v) => {
    setTweaks(v);
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: v }, "*");
  };

  const displayClass = tweaks.displayFont === "serif" ? "font-display" : "";
  const displayStyle = tweaks.displayFont === "sans" ? { fontFamily: "DM Sans", fontWeight: 500, letterSpacing: "-0.015em" } : {};

  const recordAndClose = (candidate) => {
    setDrawerOpen(false);
    setBannerDismissed(true);
    setToast(`Intro sent to ${candidate.manager} · awaiting reply`);
    setTimeout(() => setToast(null), 4200);
  };

  // Slice equity + holding series to match selected period
  // Series is 180 days, last index = today.
  const SERIES_LEN = EQUITY.portfolio.length;
  const periodDays = React.useMemo(() => {
    if (period === "CUSTOM" && customRange) {
      const end = new Date(customRange.end);
      const start = new Date(customRange.start);
      const days = Math.max(2, Math.round((end - start) / 86400000));
      return Math.min(SERIES_LEN, days);
    }
    return { "1M": 30, "3M": 90, "6M": 180, "YTD": 112, "1Y": 180, "ALL": 180 }[period] || 180;
  }, [period, customRange]);
  const slice = (arr) => arr.slice(Math.max(0, arr.length - periodDays));
  // Also normalize portfolio + bench to start at 1.0 at period start
  const equity = React.useMemo(() => {
    const p = slice(EQUITY.portfolio);
    const b = slice(EQUITY.bench);
    const pb = p[0] || 1, bb = b[0] || 1;
    return { portfolio: p.map(v => v / pb), bench: b.map(v => v / bb) };
  }, [period, customRange]);
  const renderWidget = (k) => {
    switch (k) {
      case "bridge":
        if (bannerDismissed) return <WidgetStub title="Bridge recommendation" body="No active breaches — Bridge will alert when a holding trips a mandate gate." onRestore={() => setBannerDismissed(false)} restoreLabel="Show last recommendation" />;
        return (
          <BridgeBanner
            variant={tweaks.bridgeVariant}
            bridge={BRIDGE}
            onOpen={() => setDrawerOpen(true)}
            onDismiss={() => setBannerDismissed(true)}
          />
        );
      case "kpi":
        return <KPIPanel />;
      case "equity":
        return (
          <Card padding="sm" style={{ padding: 0 }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 14px", borderBottom: "1px solid var(--border)", gap: 10, flexWrap: "wrap",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Equity curve</h3>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)" }}>
                  <span style={{ width: 10, height: 2, background: "var(--chart-strategy)" }} /> Portfolio
                </span>
                {tweaks.showBench && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)" }}>
                    <span style={{ width: 10, height: 1, borderTop: "1.25px dashed var(--chart-benchmark)" }} /> BTC
                  </span>
                )}
                <div style={{ width: 1, height: 14, background: "var(--border)" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 2, position: "relative" }}>
                  {["1M", "3M", "6M", "YTD", "1Y", "ALL"].map((p) => (
                    <button key={p} onClick={() => { setPeriod(p); setCustomPickerOpen(false); }} style={{
                      padding: "3px 8px", fontSize: 11, fontWeight: 500,
                      background: period === p ? "var(--accent-10)" : "transparent",
                      color: period === p ? "var(--accent)" : "var(--text-muted)",
                      border: "none", borderRadius: 3, cursor: "pointer",
                      fontFamily: "Geist Mono", letterSpacing: "0.04em",
                    }}>{p}</button>
                  ))}
                  <button
                    onClick={() => setCustomPickerOpen((o) => !o)}
                    style={{
                      padding: "3px 8px", fontSize: 11, fontWeight: 500,
                      background: period === "CUSTOM" ? "var(--accent-10)" : "transparent",
                      color: period === "CUSTOM" ? "var(--accent)" : "var(--text-muted)",
                      border: "none", borderRadius: 3, cursor: "pointer",
                      fontFamily: "Geist Mono", letterSpacing: "0.04em",
                      display: "inline-flex", alignItems: "center", gap: 3,
                    }}>
                    <Icon.calendar size={11} />
                    {period === "CUSTOM" && customRange
                      ? `${customRange.start.slice(5)} → ${customRange.end.slice(5)}`
                      : "CUSTOM"}
                  </button>
                  {customPickerOpen && (
                    <CustomRangePicker
                      current={customRange}
                      onApply={(range) => { setCustomRange(range); setPeriod("CUSTOM"); setCustomPickerOpen(false); }}
                      onClose={() => setCustomPickerOpen(false)}
                    />
                  )}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>sync 2m ago</div>
            </div>
            <div style={{ padding: 10 }}>
              <EquityChart
                portfolio={equity.portfolio}
                bench={equity.bench}
                style={tweaks.chartStyle}
                showBench={tweaks.showBench}
                height={240}
                overlays={HOLDINGS.filter(h => chartHoldings.has(h.id)).map(h => {
                  const s = slice(h.series);
                  const base = s[0] || 1;
                  return { id: h.id, label: h.strategy, color: h.color || TAG_COLOR[h.tag] || "#64748B", series: s.map(v => v / base) };
                })}
              />
            </div>
          </Card>
        );
      case "holdings":
        return (
          <HoldingsTable
            holdings={HOLDINGS}
            onOpenBridge={() => setDrawerOpen(true)}
            chartHoldings={chartHoldings}
            onToggleChart={(id) => {
              setChartHoldings(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              });
            }}
            onRecord={() => {}}
          />
        );
      case "allocation": return <AllocationBreakdown />;
      case "mandate":    return <MandateSnapshot />;
      case "outcomes":   return <OutcomesWidget outcomes={outcomes} />;
      default: return <WidgetStub title={WIDGET_CATALOG[k]?.name || k} body={WIDGET_CATALOG[k]?.desc || "Widget unavailable."} />;
    }
  };

  return (
    <div>
      <Sidebar current="allocations" />

      <main style={{ paddingLeft: 260, minHeight: "100vh" }}>
        <div style={{ padding: "16px 24px 28px", maxWidth: 1400, margin: "0 auto" }}>
          {/* Compact header row: title + tabs + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 10, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <h1 className={displayClass} style={{ margin: 0, fontSize: 22, lineHeight: 1, color: "var(--text-primary)", ...displayStyle }}>My Allocation</h1>
              <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.06em" }}>Northbay Capital LP</span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 0, alignItems: "center" }}>
              {[
                { k: "overview", l: "Overview" },
                { k: "holdings", l: "Holdings", count: HOLDINGS.length },
                { k: "outcomes", l: "Outcomes", count: outcomes.length },
                { k: "mandate", l: "Mandate" },
                { k: "risk", l: "Risk" },
              ].map((t) => (
                <TabButton key={t.k} t={t} active={tab === t.k} onClick={() => setTab(t.k)} />
              ))}
              <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 10px" }} />
              <div style={{ position: "relative" }}>
                <Button size="sm" variant="ghost" onClick={() => setWidgetPickerOpen(v => !v)}>
                  <Icon.grid size={13}/> Widget
                </Button>
                {widgetPickerOpen && (
                  <WidgetPicker
                    catalog={WIDGET_CATALOG}
                    layout={widgetLayout}
                    onAdd={addWidget}
                    onClose={() => setWidgetPickerOpen(false)}
                  />
                )}
              </div>
              <Button size="sm" variant="ghost"><Icon.note size={13}/> Export</Button>
              <Button size="sm" variant="primary">+ Allocation</Button>
            </div>
          </div>

          {tab === "overview" && (
            <WidgetGrid
              layout={widgetLayout}
              onMove={moveWidget}
              onRemove={removeWidget}
              onResize={resizeWidget}
              renderWidget={renderWidget}
            />
          )}

          {tab === "holdings" && (
            <HoldingsTable
              holdings={HOLDINGS}
              onOpenBridge={() => setDrawerOpen(true)}
              onRecord={() => {}}
            />
          )}

          {tab === "outcomes" && <OutcomesWidget outcomes={outcomes} />}

          {tab === "mandate" && <MandatePlaceholder />}
          {tab === "risk" && <RiskPlaceholder />}

          <footer style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
            <span>Quantalyze v0.15.0.0 · Sprint 9 · Demo-to-Production</span>
            <span>Figures are illustrative. Not investment advice.</span>
          </footer>
        </div>
      </main>

      <BridgeDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        bridge={BRIDGE}
        onAllocate={recordAndClose}
      />

      <TweakPanel
        value={tweaks}
        onChange={handleTweakChange}
        visible={tweakVisible}
        onClose={() => setTweakVisible(false)}
      />

      {/* Float trigger when tweaks hidden, small floating button bottom-right */}
      {!tweakVisible && (
        <button
          onClick={() => setTweakVisible(true)}
          style={{
            position: "fixed", bottom: 18, right: 18, zIndex: 30,
            height: 34, padding: "0 14px",
            background: "#fff", border: "1px solid var(--border)",
            borderRadius: 999, boxShadow: "var(--shadow-pop)",
            fontSize: 12, fontWeight: 500, color: "var(--text-secondary)",
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            fontFamily: "DM Sans",
          }}
        ><Icon.settings size={13}/> Tweaks</button>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 72, right: 18, zIndex: 60,
          background: "var(--accent)", color: "#fff",
          padding: "10px 14px", borderRadius: 8, fontSize: 13,
          boxShadow: "var(--shadow-pop)",
          display: "inline-flex", alignItems: "center", gap: 8,
          animation: "popin 240ms cubic-bezier(.2,.8,.2,1)",
        }}>
          <Icon.check size={14}/> {toast}
          <style>{`@keyframes popin { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
        </div>
      )}
    </div>
  );
}

// -------- subcomponents --------

function Breadcrumb() {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
      <a href="#" onClick={(e) => e.preventDefault()} style={{ color: "var(--text-muted)", textDecoration: "none" }}>My Workspace</a>
      <span>/</span>
      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>My Allocation</span>
    </nav>
  );
}

function TabButton({ t, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "10px 16px",
        background: "transparent", border: "none",
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        color: active ? "var(--text-primary)" : hover ? "var(--text-primary)" : "var(--text-secondary)",
        fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: "pointer",
        fontFamily: "DM Sans", marginBottom: -1,
        display: "inline-flex", alignItems: "center", gap: 6,
        transition: "color 150ms ease-out",
      }}
    >
      {t.l}
      {t.count != null && (
        <span style={{
          fontSize: 10.5, fontWeight: 500,
          background: active ? "var(--accent-10)" : "#EEF1F4",
          color: active ? "var(--accent)" : "var(--text-muted)",
          padding: "1px 6px", borderRadius: 10,
          fontFamily: "Geist Mono", fontVariantNumeric: "tabular-nums",
        }}>{t.count}</span>
      )}
    </button>
  );
}

function KPIPanel() {
  const items = [
    { label: "AUM", v: fmtUSD(KPIS.aum.value, { compact: true }), sub: "8 strategies" },
    { label: "YTD TWR", v: fmtPct(KPIS.ytd.value, { explicitSign: true }), sub: `MTD ${fmtPct(KPIS.mtd.value, { explicitSign: true })}`, color: "pos" },
    { label: "Sharpe", v: KPIS.sharpe.value.toFixed(2), sub: `α ${fmtPct(KPIS.alpha.value, { explicitSign: true })}` },
    { label: "Max DD 12m", v: fmtPct(KPIS.maxDD.value, { explicitSign: true }), sub: `vol ${fmtPct(KPIS.vol.value)}`, color: "neg" },
    { label: "Avg ρ", v: KPIS.corr.value.toFixed(2), sub: "tgt < 0.30" },
  ];
  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {items.map((k, i) => (
          <div key={k.label} className="kpi-cell" data-i={i} style={{
            padding: "8px 14px",
            borderLeft: i === 0 ? "none" : "1px solid var(--border)",
            minWidth: 0,
            display: "flex", flexDirection: "column", justifyContent: "center",
          }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{k.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2, minWidth: 0 }}>
              <div className="font-mono tnum" style={{
                fontSize: 18, fontWeight: 500, lineHeight: 1.1,
                color: k.color === "pos" ? "var(--positive)" : k.color === "neg" ? "var(--negative)" : "var(--text-primary)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
              }}>{k.v}</div>
              <div className="font-mono" style={{ fontSize: 10.5, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{k.sub}</div>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @media (max-width: 1100px) {
          .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .kpi-cell[data-i="3"] { border-left: none !important; border-top: 1px solid var(--border); }
          .kpi-cell[data-i="4"] { border-top: 1px solid var(--border); }
        }
        @media (max-width: 720px) {
          .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .kpi-cell { border-left: none !important; border-top: 1px solid var(--border) !important; }
          .kpi-cell[data-i="0"], .kpi-cell[data-i="1"] { border-top: none !important; }
          .kpi-cell[data-i="2"], .kpi-cell[data-i="4"] { border-left: 1px solid var(--border) !important; }
        }
      `}</style>
    </Card>
  );
}

function AllocationBreakdown() {
  // Group holdings by tag
  const groups = {};
  HOLDINGS.forEach((h) => {
    groups[h.tag] = (groups[h.tag] || 0) + h.weight;
  });
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const totalWeight = entries.reduce((s, [, v]) => s + v, 0);

  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Allocation by style</h3>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{entries.length} styles · {totalWeight < 0.99 ? ((1 - totalWeight) * 100).toFixed(1) + "% cash" : "fully deployed"}</div>
      </div>
      {/* Stacked bar */}
      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)" }}>
          {entries.map(([tag, w]) => (
            <div key={tag} style={{ width: `${w * 100}%`, background: TAG_COLOR[tag] || "#64748B" }} title={`${tag}: ${(w*100).toFixed(1)}%`} />
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          {entries.map(([tag, w]) => (
            <div key={tag} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: TAG_COLOR[tag] || "#64748B" }} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{tag}</span>
              <span className="font-mono tnum" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{(w * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function MandateSnapshot() {
  const rules = [
    { label: "Max single allocation", v: "22%", gate: "18.5%", ok: true },
    { label: "Min Sharpe (90d)", v: "0.75", gate: "1.84", ok: true },
    { label: "Max DD floor", v: "-7.5%", gate: "-9.1%", ok: false },
    { label: "Min AUM", v: "$10M", gate: "$48.7M", ok: true },
    { label: "Style concentration", v: "35% cap", gate: "19.3%", ok: true },
  ];
  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Mandate</h3>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>Auto-saved · 4/5 gates pass</div>
        </div>
        <Button size="sm" variant="ghost">Edit →</Button>
      </div>
      <div>
        {rules.map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid var(--border)", gap: 10 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999,
              background: r.ok ? "var(--positive)" : "var(--negative)",
            }} />
            <span style={{ flex: 1, fontSize: 12.5 }}>{r.label}</span>
            <span className="font-mono tnum" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.v}</span>
            <span style={{ width: 1, height: 14, background: "var(--border)" }} />
            <span className="font-mono tnum" style={{ fontSize: 12.5, color: r.ok ? "var(--text-primary)" : "var(--negative)", fontWeight: 500, minWidth: 56, textAlign: "right" }}>{r.gate}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MandatePlaceholder() {
  return (
    <Card padding="lg">
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Mandate profile</h3>
      <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 6 }}>
        Full mandate form lives here — liquidity, style, risk sliders + auto-save-on-blur. Snapshot shown in Overview.
      </p>
    </Card>
  );
}

function RiskPlaceholder() {
  return (
    <Card padding="lg">
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Risk analytics</h3>
      <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 6 }}>
        VaR/ES, alpha/beta, correlation heatmap, regime detection. Not wired in this prototype.
      </p>
    </Card>
  );
}

function WidgetStub({ title, body, onRestore, restoreLabel }) {
  return (
    <Card padding="md">
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{body}</div>
      {onRestore && (
        <button onClick={onRestore} style={{
          marginTop: 10, padding: "4px 10px", fontSize: 11, fontWeight: 500,
          background: "transparent", color: "var(--accent)",
          border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer",
        }}>{restoreLabel || "Restore"}</button>
      )}
    </Card>
  );
}

// Mount
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
