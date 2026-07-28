// ---------------------------------------------------------------------------
// Outcomes widget — realized 30/90/180d delta
// ---------------------------------------------------------------------------

function OutcomesWidget({ outcomes }) {
  const [expanded, setExpanded] = React.useState(null);

  const kpi = React.useMemo(() => {
    const withDelta = outcomes.filter(o => o.delta90 != null);
    const hitRate = withDelta.length ? withDelta.filter(o => o.delta90 > 0).length / withDelta.length : 0;
    const avgDelta = withDelta.length ? withDelta.reduce((s, o) => s + o.delta90, 0) / withDelta.length : 0;
    const total = outcomes.length;
    return { hitRate, avgDelta, total };
  }, [outcomes]);

  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px", borderBottom: "1px solid var(--border)",
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            Bridge outcomes
            <Badge color="#1B6B5A">Feedback loop</Badge>
          </h3>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
            Realized delta from Bridge-driven reallocations — feeds the rescoring engine.
          </div>
        </div>
        <Button size="sm" variant="secondary">View all</Button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", borderBottom: "1px solid var(--border)" }}>
        <KPIStripCell label="Hit rate (90d)" value={(kpi.hitRate * 100).toFixed(0) + "%"} sub={`${outcomes.filter(o => o.delta90 != null).length} settled`} />
        <KPIStripCell label="Avg realized α (90d)" value={fmtPct(kpi.avgDelta, { explicitSign: true })} sub="vs held baseline" color={kpi.avgDelta >= 0 ? "pos" : "neg"} divider />
        <KPIStripCell label="Total outcomes" value={kpi.total} sub={`${outcomes.filter(o => o.status === "pending").length} pending cycle`} divider />
      </div>

      {/* Table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {["Reallocation", "Size", "Recorded", "Δ 30d", "Δ 90d", "Δ 180d", ""].map((h, i) => (
              <th key={i} style={{
                textAlign: i === 0 || i === 2 ? "left" : "right",
                padding: "10px 16px",
                fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                color: "var(--text-muted)", borderBottom: "1px solid var(--border)",
                whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o) => (
            <OutcomeRow key={o.id} o={o} expanded={expanded === o.id} onToggle={() => setExpanded((e) => e === o.id ? null : o.id)} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function KPIStripCell({ label, value, sub, color, divider }) {
  return (
    <div style={{ padding: "16px 20px", borderLeft: divider ? "1px solid var(--border)" : "none" }}>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</div>
      <div className="font-mono tnum" style={{
        fontSize: 22, fontWeight: 500, marginTop: 4,
        color: color === "pos" ? "var(--positive)" : color === "neg" ? "var(--negative)" : "var(--text-primary)",
      }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function OutcomeRow({ o, expanded, onToggle }) {
  const [hover, setHover] = React.useState(false);

  const deltaCell = (v, windowLabel) => {
    if (v == null) {
      return <span style={{ color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>pending</span>;
    }
    return (
      <span className="font-mono tnum" style={{
        color: v >= 0 ? "var(--positive)" : "var(--negative)",
        fontWeight: 500,
      }}>{fmtPct(v, { explicitSign: true })}</span>
    );
  };

  return (
    <React.Fragment>
      <tr
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: hover || expanded ? "#FAFBFC" : "transparent",
          cursor: "pointer",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <td style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{o.from}</span>
            <Icon.chevronRight size={12}/>
            <span style={{ fontWeight: 500 }}>{o.to}</span>
          </div>
        </td>
        <td className="font-mono tnum" style={{ padding: "12px 16px", textAlign: "right" }}>{fmtUSD(o.size, { compact: true })}</td>
        <td style={{ padding: "12px 16px", color: "var(--text-secondary)", fontSize: 12 }}>{fmtDate(o.recordedOn)}</td>
        <td style={{ padding: "12px 16px", textAlign: "right" }}>{deltaCell(o.delta30)}</td>
        <td style={{ padding: "12px 16px", textAlign: "right" }}>{deltaCell(o.delta90)}</td>
        <td style={{ padding: "12px 16px", textAlign: "right" }}>{deltaCell(o.delta180)}</td>
        <td style={{ padding: "12px 16px", textAlign: "right", color: "var(--text-muted)" }}>
          <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 150ms", display: "inline-flex" }}>
            <Icon.chevronRight size={12} />
          </span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan="7" style={{ background: "#FBFCFD", borderBottom: "1px solid var(--border)", padding: "16px 20px" }}>
            <OutcomeDetail o={o} />
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}

function OutcomeDetail({ o }) {
  const windows = [
    { label: "30-day window", v: o.delta30, ready: o.delta30 != null },
    { label: "90-day window", v: o.delta90, ready: o.delta90 != null },
    { label: "180-day window", v: o.delta180, ready: o.delta180 != null },
  ];
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 12 }}>
        Realized delta vs held baseline
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {windows.map((w, i) => (
          <div key={i} style={{
            padding: 14,
            background: "#fff", border: "1px solid var(--border)", borderRadius: 8,
          }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{w.label}</div>
            {w.ready ? (
              <div className="font-mono tnum" style={{ fontSize: 24, fontWeight: 500, marginTop: 6, color: w.v >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {fmtPct(w.v, { explicitSign: true })}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "var(--warning)" }} />
                Window open
              </div>
            )}
            <div style={{ marginTop: 10, height: 4, background: "#F1F5F9", borderRadius: 2, overflow: "hidden" }}>
              <div style={{
                width: w.ready ? "100%" : "45%",
                height: "100%",
                background: w.ready ? (w.v >= 0 ? "var(--positive)" : "var(--negative)") : "var(--warning)",
                transition: "width 300ms ease-out",
              }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, padding: "10px 14px", background: "#fff", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
        <b style={{ color: "var(--text-primary)" }}>Feedback contribution: </b>
        This outcome contributes {o.delta90 != null ? "fully" : "provisionally"} to mandate-fit weight tuning for <span className="font-mono">carry</span> and <span className="font-mono">market-neutral</span> dimensions on your next rescore cycle.
      </div>
    </div>
  );
}

Object.assign(window, { OutcomesWidget });
