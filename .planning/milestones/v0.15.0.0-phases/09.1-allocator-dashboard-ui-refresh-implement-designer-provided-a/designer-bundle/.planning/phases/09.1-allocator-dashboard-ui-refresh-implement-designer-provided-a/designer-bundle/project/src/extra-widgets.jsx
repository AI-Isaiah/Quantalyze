// ---------------------------------------------------------------------------
// Extra widgets: Correlation matrix, Funding rates, Flows ledger,
//                Activity feed, Top movers
// ---------------------------------------------------------------------------

// Map ρ → color. Negative = blue, near-zero = neutral, high = warm red.
function corrColor(rho) {
  if (rho >= 0.7) return "rgba(220, 38, 38, 0.85)";      // strong +
  if (rho >= 0.4) return "rgba(220, 38, 38, 0.55)";
  if (rho >= 0.15) return "rgba(220, 38, 38, 0.25)";
  if (rho > -0.15) return "rgba(148, 163, 184, 0.22)";   // near zero
  if (rho > -0.4) return "rgba(30, 64, 175, 0.30)";
  return "rgba(30, 64, 175, 0.55)";
}

function CorrelationMatrix() {
  const [hover, setHover] = React.useState(null);
  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Correlation matrix</h3>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>90d rolling · Pearson</div>
      </div>
      <div style={{ padding: 12, overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 10.5, fontFamily: "Geist Mono" }}>
          <thead>
            <tr>
              <th></th>
              {HOLDINGS.map(h => (
                <th key={h.id} style={{
                  width: 30, height: 60, padding: 0, verticalAlign: "bottom",
                  color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.02em",
                }}>
                  <div style={{ transform: "rotate(-60deg)", transformOrigin: "left bottom", width: 60, whiteSpace: "nowrap", marginLeft: 15 }}>
                    {h.strategy.split(" ")[0]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOLDINGS.map(a => (
              <tr key={a.id}>
                <td style={{
                  padding: "0 6px 0 0", textAlign: "right",
                  color: "var(--text-muted)", fontWeight: 500,
                  whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis",
                }}>{a.strategy.split(" ")[0]}</td>
                {HOLDINGS.map(b => {
                  const rho = CORR[a.id][b.id];
                  const isHover = hover && (hover.a === a.id || hover.b === b.id) && !(hover.a === a.id && hover.b === b.id);
                  const isExact = hover && hover.a === a.id && hover.b === b.id;
                  return (
                    <td key={b.id}
                        onMouseEnter={() => setHover({ a: a.id, b: b.id, rho })}
                        onMouseLeave={() => setHover(null)}
                        style={{
                          width: 30, height: 26,
                          background: corrColor(rho),
                          border: isExact ? "1.5px solid var(--text-primary)" : isHover ? "1px solid rgba(0,0,0,0.2)" : "none",
                          textAlign: "center",
                          color: Math.abs(rho) > 0.4 ? "#fff" : "var(--text-secondary)",
                          cursor: "default",
                          transition: "all 100ms",
                        }}>
                      {rho === 1 ? "" : rho.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 14, fontSize: 10.5, color: "var(--text-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 10, background: "rgba(30,64,175,0.55)" }} /> −0.6
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 10, background: "rgba(148,163,184,0.22)" }} /> 0
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 12, height: 10, background: "rgba(220,38,38,0.85)" }} /> +0.95
        </span>
        {hover && (
          <span style={{ marginLeft: "auto", fontFamily: "Geist Mono", color: "var(--text-secondary)" }}>
            {HOLDINGS.find(h => h.id === hover.a)?.strategy.split(" ")[0]} × {HOLDINGS.find(h => h.id === hover.b)?.strategy.split(" ")[0]} · ρ = <b style={{ color: "var(--text-primary)" }}>{hover.rho.toFixed(2)}</b>
          </span>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Funding rates — grouped by venue, with mini-trend
// ---------------------------------------------------------------------------

function FundingRates() {
  // Group by venue
  const venues = {};
  FUNDING.forEach(f => { (venues[f.venue] = venues[f.venue] || []).push(f); });
  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Funding rates</h3>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>8h · annualized shown on hover</div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#FAFBFC", position: "sticky", top: 0 }}>
              <th style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>Venue / Asset</th>
              <th style={{ padding: "6px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>Rate 8h</th>
              <th style={{ padding: "6px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>Annualized</th>
              <th style={{ padding: "6px 12px", textAlign: "center", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)", width: 80 }}>Trend</th>
              <th style={{ padding: "6px 12px", textAlign: "right", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>OI</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(venues).map(([venue, rows]) => (
              <React.Fragment key={venue}>
                {rows.map((f, i) => {
                  const annual = f.rate * 3 * 365;
                  const positive = f.rate >= 0;
                  return (
                    <tr key={f.venue + f.asset} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px" }}>
                        {i === 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.04em", marginBottom: 2 }}>{venue}</div>}
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 500 }}>{f.asset}-PERP</span>
                        </div>
                      </td>
                      <td className="font-mono tnum" style={{ padding: "8px 12px", textAlign: "right", color: positive ? "var(--positive)" : "var(--negative)", fontWeight: 500 }}>
                        {positive ? "+" : ""}{(f.rate * 100).toFixed(4)}%
                      </td>
                      <td className="font-mono tnum" style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-secondary)" }}>
                        {positive ? "+" : ""}{(annual * 100).toFixed(1)}%
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <Sparkline series={f.trend} color={positive ? "var(--positive)" : "var(--negative)"} w={60} h={18} />
                      </td>
                      <td className="font-mono tnum" style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-muted)" }}>
                        {fmtUSD(f.notional, { compact: true })}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Flows ledger — subs / redemptions / transfers
// ---------------------------------------------------------------------------

function FlowsLedger() {
  const totals = FLOWS.reduce((acc, f) => {
    if (f.kind === "subscription") acc.subs += f.amount;
    else if (f.kind === "redemption") acc.reds += Math.abs(f.amount);
    return acc;
  }, { subs: 0, reds: 0 });

  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Flows ledger</h3>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          <span style={{ color: "var(--positive)" }}>+{fmtUSD(totals.subs, { compact: true })}</span>
          <span style={{ margin: "0 6px", color: "var(--border)" }}>·</span>
          <span style={{ color: "var(--negative)" }}>−{fmtUSD(totals.reds, { compact: true })}</span>
          <span style={{ margin: "0 6px", color: "var(--border)" }}>·</span>
          7d
        </div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {FLOWS.map(f => {
          const iconMap = { subscription: "↗", redemption: "↙", transfer: "⇄" };
          const colorMap = { subscription: "var(--positive)", redemption: "var(--negative)", transfer: "var(--text-secondary)" };
          return (
            <div key={f.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", borderBottom: "1px solid var(--border)",
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 13,
                background: f.kind === "subscription" ? "rgba(16,122,95,0.1)" : f.kind === "redemption" ? "rgba(220,38,38,0.08)" : "rgba(100,116,139,0.1)",
                color: colorMap[f.kind],
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 600, flexShrink: 0,
              }}>{iconMap[f.kind]}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>{f.entity}</span>
                  {f.status === "pending" && <Badge color="#D97706" size="xs">pending</Badge>}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {fmtDate(f.date)} · {f.strategy}
                </div>
              </div>
              <div className="font-mono tnum" style={{
                fontSize: 13, fontWeight: 500, textAlign: "right",
                color: f.amount >= 0 ? "var(--positive)" : "var(--negative)",
              }}>
                {f.amount >= 0 ? "+" : "−"}{fmtUSD(Math.abs(f.amount), { compact: true })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

function ActivityFeed() {
  const kindIcon = { breach: "⚠", bridge: "⟷", flow: "$", watch: "◐", outcome: "✓", note: "≡" };
  const sevColor = { high: "var(--negative)", med: "var(--warning)", info: "var(--text-secondary)" };
  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Recent activity</h3>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{ACTIVITY.length} events · 7d</div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {ACTIVITY.map(a => (
          <div key={a.id} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "9px 14px", borderBottom: "1px solid var(--border)",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 11, flexShrink: 0,
              background: a.severity === "high" ? "rgba(220,38,38,0.1)" : a.severity === "med" ? "rgba(217,119,6,0.1)" : "rgba(100,116,139,0.1)",
              color: sevColor[a.severity],
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, marginTop: 1,
            }}>{kindIcon[a.kind]}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.35 }}>{a.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "Geist Mono" }}>{a.ts.slice(5)}</span>
                <span>·</span>
                <span>{a.meta}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top movers (biggest MTD movers, gain + loss)
// ---------------------------------------------------------------------------

function TopMovers() {
  const sorted = [...HOLDINGS].sort((a, b) => Math.abs(b.mtd) - Math.abs(a.mtd)).slice(0, 5);
  const max = Math.max(...sorted.map(h => Math.abs(h.mtd)));
  return (
    <Card padding="sm" style={{ padding: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Top movers</h3>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>MTD · by magnitude</div>
      </div>
      <div style={{ padding: "8px 14px" }}>
        {sorted.map(h => {
          const positive = h.mtd >= 0;
          const barW = (Math.abs(h.mtd) / max) * 100;
          return (
            <div key={h.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span style={{ fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{h.strategy}</span>
                <span className="font-mono tnum" style={{ color: positive ? "var(--positive)" : "var(--negative)", fontWeight: 500, flexShrink: 0 }}>
                  {positive ? "+" : ""}{(h.mtd * 100).toFixed(2)}%
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", height: 3, background: "#F1F5F9", borderRadius: 2, overflow: "hidden", position: "relative" }}>
                <div style={{
                  position: "absolute", left: positive ? "50%" : `${50 - barW/2}%`,
                  width: `${barW/2}%`, height: "100%",
                  background: positive ? "var(--positive)" : "var(--negative)",
                  borderRadius: 2,
                }} />
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border)" }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

Object.assign(window, { CorrelationMatrix, FundingRates, FlowsLedger, ActivityFeed, TopMovers });
