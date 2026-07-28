// ---------------------------------------------------------------------------
// Holdings table — row expand → inline outcome recording
// ---------------------------------------------------------------------------

function HoldingsTable({ holdings, onOpenBridge, onRecord, chartHoldings, onToggleChart }) {
  const [expanded, setExpanded] = React.useState(null);
  const [sort, setSort] = React.useState({ key: "weight", dir: "desc" });

  const sorted = React.useMemo(() => {
    const arr = [...holdings];
    arr.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (typeof av === "number") return sort.dir === "asc" ? av - bv : bv - av;
      return sort.dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [holdings, sort]);

  const header = (key, label, align = "right") => {
    const active = sort.key === key;
    return (
      <th
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
        style={{
          textAlign: align, padding: "10px 12px",
          fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
          textTransform: "uppercase", color: active ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {label} {active && (sort.dir === "desc" ? "↓" : "↑")}
      </th>
    );
  };

  return (
    <Card padding="sm" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 20px", borderBottom: "1px solid var(--border)",
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Holdings</h3>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
            {holdings.length} active positions · synced 2m ago
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="secondary">Export CSV</Button>
          <Button size="sm" variant="secondary">+ Add holding</Button>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 24, borderBottom: "1px solid var(--border)" }}></th>
              <th style={{ width: 28, borderBottom: "1px solid var(--border)", padding: "10px 0" }} title="Show on equity chart"></th>
              {header("strategy", "Strategy", "left")}
              {header("weight", "Weight")}
              {header("alloc", "Allocation")}
              {header("mtd", "MTD")}
              {header("sharpe", "Sharpe")}
              {header("dd", "Max DD")}
              {header("age", "Age (d)")}
              <th style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => (
              <React.Fragment key={h.id}>
                <HoldingRow
                  h={h}
                  expanded={expanded === h.id}
                  onToggle={() => setExpanded((e) => e === h.id ? null : h.id)}
                  onOpenBridge={onOpenBridge}
                  onChart={chartHoldings?.has(h.id)}
                  onToggleChart={onToggleChart}
                />
                {expanded === h.id && (
                  <tr>
                    <td colSpan="10" style={{ padding: 0, background: "#FBFCFD", borderBottom: "1px solid var(--border)" }}>
                      <HoldingDetail h={h} onRecord={onRecord} onOpenBridge={onOpenBridge} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function HoldingRow({ h, expanded, onToggle, onOpenBridge, onChart, onToggleChart }) {
  const [hover, setHover] = React.useState(false);
  const bg = expanded ? "#FBFCFD" : hover ? "#FAFBFC" : "transparent";
  const stripe = h.status === "underperform" ? "var(--negative)" : h.status === "watch" ? "var(--warning)" : "transparent";
  const spark = sparkSeries(h.id.charCodeAt(3) + h.alloc / 1000, 24, h.mtd * 2);

  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onToggle}
      style={{
        borderBottom: "1px solid var(--border)",
        background: bg,
        cursor: "pointer",
        transition: "background 120ms ease-out",
      }}
    >
      <td style={{ position: "relative", width: 24 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: stripe }} />
        <div style={{ paddingLeft: 6, display: "flex", alignItems: "center", color: "var(--text-muted)" }}>
          <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 150ms ease-out", display: "flex" }}>
            <Icon.chevronRight size={12} />
          </span>
        </div>
      </td>
      <td style={{ width: 28, textAlign: "center", padding: 0 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleChart && onToggleChart(h.id); }}
          title={onChart ? "Hide from equity chart" : "Show on equity chart"}
          style={{
            width: 16, height: 16, padding: 0,
            borderRadius: 3, cursor: "pointer",
            border: `1px solid ${onChart ? h.color : "var(--border)"}`,
            background: onChart ? h.color : "transparent",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            transition: "all 120ms",
          }}
        >
          {onChart && <span style={{ color: "#fff", display: "flex" }}><Icon.check size={9} /></span>}
        </button>
      </td>
      <td style={{ padding: "12px", height: "var(--row-h)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 500 }}>{h.strategy}</span>
              <span style={{ color: "var(--accent)", display: "flex" }}><Icon.verified size={12}/></span>
              {h.status === "underperform" && (
                <Badge color="#DC2626">Breach</Badge>
              )}
              {h.status === "watch" && (
                <Badge color="#D97706">Watch</Badge>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>
              {h.manager} · <Badge color={TAG_COLOR[h.tag] || "#64748B"} size="xs">{h.tag}</Badge>
            </div>
          </div>
        </div>
      </td>
      <td style={{ padding: "12px", textAlign: "right" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
          <div style={{ width: 48, height: 4, background: "#E2E8F0", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${h.weight * 400}%`, maxWidth: "100%", height: "100%", background: "var(--accent)" }} />
          </div>
          <span className="font-mono tnum" style={{ fontWeight: 500 }}>{(h.weight * 100).toFixed(1)}%</span>
        </div>
      </td>
      <td className="font-mono tnum" style={{ padding: "12px", textAlign: "right" }}>{fmtUSD(h.alloc, { compact: true })}</td>
      <td className={`font-mono tnum ${metricColor(h.mtd)}`} style={{ padding: "12px", textAlign: "right", fontWeight: 500 }}>
        {fmtPct(h.mtd, { explicitSign: true })}
      </td>
      <td className="font-mono tnum" style={{ padding: "12px", textAlign: "right" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <Sparkline series={spark} color={h.mtd >= 0 ? "var(--chart-strategy)" : "var(--negative)"} w={56} h={18} />
          <span>{h.sharpe.toFixed(2)}</span>
        </div>
      </td>
      <td className="font-mono tnum neg" style={{ padding: "12px", textAlign: "right" }}>{fmtPct(h.dd, { explicitSign: true })}</td>
      <td className="font-mono tnum muted" style={{ padding: "12px", textAlign: "right" }}>{h.age}</td>
      <td style={{ padding: "12px", width: 40, textAlign: "right", color: "var(--text-muted)" }}>
        {h.bridgeCandidate && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenBridge(); }}
            title="Open Bridge"
            style={{
              height: 26, padding: "0 8px",
              background: "var(--warning)", color: "#fff",
              border: "none", borderRadius: 4,
              fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
            }}>
            <Icon.bolt size={10}/> Bridge
          </button>
        )}
      </td>
    </tr>
  );
}

function HoldingDetail({ h, onRecord, onOpenBridge }) {
  const [tab, setTab] = React.useState("metrics");
  return (
    <div style={{ padding: "18px 28px 22px 42px" }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {[
          { k: "metrics", l: "Metrics" },
          { k: "outcome", l: "Record outcome", badge: h.bridgeCandidate },
          { k: "note", l: "Notes" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: "8px 14px",
            background: "transparent", border: "none",
            borderBottom: `2px solid ${tab === t.k ? "var(--accent)" : "transparent"}`,
            color: tab === t.k ? "var(--accent)" : "var(--text-secondary)",
            fontSize: 13, fontWeight: 500, cursor: "pointer",
            fontFamily: "DM Sans",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {t.l}
            {t.badge && <span style={{
              background: "var(--warning)", color: "#fff", fontSize: 9,
              padding: "1px 5px", borderRadius: 3, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>new</span>}
          </button>
        ))}
      </div>

      {tab === "metrics" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
          <DetailMetric label="Entry date" value="2025-03-12" />
          <DetailMetric label="Cost basis" value={fmtUSD(h.alloc * 0.92, { compact: true })} />
          <DetailMetric label="P&L (LTD)" value={fmtPct(h.mtd * 5.2, { explicitSign: true })} color="pos" />
          <DetailMetric label="Ann. Vol" value={(Math.abs(h.dd) * 2.8 * 100).toFixed(1) + "%"} />
          <DetailMetric label="Correlation" value={(0.1 + Math.random() * 0.3).toFixed(2)} />
          <DetailMetric label="Funding ytd" value={fmtUSD(h.alloc * 0.018, { compact: true })} color="pos" />
        </div>
      )}

      {tab === "outcome" && (
        <OutcomeForm h={h} onSubmit={onRecord} onOpenBridge={onOpenBridge} />
      )}

      {tab === "note" && (
        <div>
          <textarea
            defaultValue={h.status === "underperform" ?
              "Drawdown widening since late-March. Funding carry compressed; Bridge flagged 3 replacements. Decision by Fri." :
              "Performing in line with thesis. Hold."}
            style={{
              width: "100%", minHeight: 90, padding: 12,
              fontSize: 13, fontFamily: "DM Sans", lineHeight: 1.55,
              border: "1px solid var(--border)", borderRadius: 6, resize: "vertical",
            }}
          />
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>Auto-saved 3m ago · private to your org</div>
        </div>
      )}
    </div>
  );
}

function DetailMetric({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</div>
      <div className="font-mono tnum" style={{
        fontSize: 15, fontWeight: 500, marginTop: 4,
        color: color === "pos" ? "var(--positive)" : color === "neg" ? "var(--negative)" : "var(--text-primary)",
      }}>{value}</div>
    </div>
  );
}

function OutcomeForm({ h, onSubmit, onOpenBridge }) {
  const [action, setAction] = React.useState("allocated");
  const [size, setSize] = React.useState(h.alloc);
  const [submitted, setSubmitted] = React.useState(false);

  if (submitted) {
    return (
      <div style={{
        padding: 16, background: "#F0FDF4", border: "1px solid #BBF7D0",
        borderRadius: 8, display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 999, background: "var(--positive)", display: "grid", placeItems: "center", color: "#fff" }}>
          <Icon.check size={14}/>
        </div>
        <div>
          <div style={{ fontWeight: 500, fontSize: 14 }}>Outcome recorded.</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
            30/90/180-day realized delta will compute nightly. You'll see it in the Outcomes widget.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[
          { k: "allocated", l: "Allocated replacement" },
          { k: "rejected", l: "Rejected — kept original" },
          { k: "modified", l: "Modified size" },
        ].map((o) => (
          <button key={o.k} onClick={() => setAction(o.k)} style={{
            padding: "8px 14px",
            border: `1px solid ${action === o.k ? "var(--accent)" : "var(--border)"}`,
            background: action === o.k ? "var(--accent-10)" : "#fff",
            color: action === o.k ? "var(--accent)" : "var(--text-secondary)",
            borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer",
            fontFamily: "DM Sans",
          }}>
            {o.l}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
            Allocation size
          </label>
          <input
            value={"$" + size.toLocaleString()}
            onChange={(e) => setSize(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)}
            style={{
              width: "100%", marginTop: 6, height: 36, padding: "0 12px",
              fontSize: 14, fontFamily: "Geist Mono", fontVariantNumeric: "tabular-nums",
              border: "1px solid var(--border)", borderRadius: 6,
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
            Effective date
          </label>
          <input
            defaultValue="2026-04-21"
            style={{
              width: "100%", marginTop: 6, height: 36, padding: "0 12px",
              fontSize: 14, fontFamily: "Geist Mono", fontVariantNumeric: "tabular-nums",
              border: "1px solid var(--border)", borderRadius: 6,
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          Notes (private)
        </label>
        <textarea
          placeholder="What was the deciding factor? This feeds the rule-based rescoring engine."
          style={{
            width: "100%", marginTop: 6, minHeight: 70, padding: "10px 12px",
            fontSize: 13, fontFamily: "DM Sans", lineHeight: 1.55,
            border: "1px solid var(--border)", borderRadius: 6, resize: "vertical",
          }}
        />
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
          Realized delta computed at 30d / 90d / 180d vs held baseline.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {h.bridgeCandidate && <Button variant="ghost" size="sm" onClick={onOpenBridge}>Open Bridge candidates →</Button>}
          <Button variant="primary" size="sm" onClick={() => setSubmitted(true)}>Record outcome</Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HoldingsTable });
