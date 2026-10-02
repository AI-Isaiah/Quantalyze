// ---------------------------------------------------------------------------
// Bridge — banner + replacement drawer
// ---------------------------------------------------------------------------

function BridgeBanner({ variant = "card", bridge, onOpen, dismissed, onDismiss }) {
  if (dismissed) return null;
  const u = bridge.underperformer;

  if (variant === "subtle") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px",
        background: "#FFF7ED",
        border: "1px solid #FED7AA",
        borderRadius: "var(--radius-md)",
      }}>
        <span style={{ color: "var(--warning)", display: "flex" }}><Icon.alert size={16} /></span>
        <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
          <b>{u.strategy}</b> is breaching your mandate ({u.breaches.map(b=>b.label).join(", ")}). Bridge has {bridge.candidates.length} replacement candidates.
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
          <Button size="sm" variant="primary" onClick={onOpen}>Review</Button>
        </div>
      </div>
    );
  }

  if (variant === "full") {
    return (
      <div style={{
        background: "linear-gradient(180deg, #FFF7ED 0%, #FFFAF3 100%)",
        border: "1px solid #FED7AA",
        borderRadius: "var(--radius-lg)",
        padding: "14px 18px",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            <Badge color="#D97706" tone="solid" size="xs">⚡ Bridge</Badge>
            <h3 className="font-display" style={{ margin: 0, fontSize: 18, lineHeight: 1.25, color: "var(--text-primary)", fontWeight: 500 }}>
              {u.strategy} is underperforming — {bridge.candidates.length} replacements ready.
            </h3>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <Button size="sm" variant="ghost" onClick={onDismiss}>Not now</Button>
            <Button size="sm" variant="primary" onClick={onOpen}>Review candidates →</Button>
          </div>
        </div>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
          {u.breaches.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 4, height: 4, borderRadius: 999, background: "var(--warning)", flexShrink: 0 }} />
              {b.label} {b.currentLabel} <span style={{ color: "var(--text-muted)" }}>(gate {b.gateLabel})</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // default "card"
  return (
    <Card padding="md" style={{ borderColor: "#FED7AA", background: "#FFFBF4" }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 16, alignItems: "center" }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: "var(--warning)", color: "#fff",
          display: "grid", placeItems: "center",
        }}>
          <Icon.bolt size={18} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--warning)" }}>Bridge recommendation</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· updated 4m ago</span>
          </div>
          <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
            <b>{u.strategy}</b> tripped {u.breaches.length} mandate gates. {bridge.candidates.length} matching candidates meet all your constraints.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="ghost" onClick={onDismiss}>Dismiss</Button>
          <Button variant="primary" onClick={onOpen}>Review →</Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bridge drawer — slides in from right
// ---------------------------------------------------------------------------
function BridgeDrawer({ open, onClose, bridge, onAllocate }) {
  const [selected, setSelected] = React.useState(0);
  const [stage, setStage] = React.useState("browse"); // browse | confirm

  React.useEffect(() => {
    if (!open) { setStage("browse"); setSelected(0); }
  }, [open]);

  if (!open) return null;
  const u = bridge.underperformer;
  const c = bridge.candidates[selected];

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.32)",
        zIndex: 40, animation: "fadeIn 200ms ease-out",
      }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: 620, maxWidth: "96vw",
        background: "var(--surface)", zIndex: 41,
        boxShadow: "-12px 0 40px rgba(15,23,42,0.18)",
        display: "flex", flexDirection: "column",
        animation: "slideIn 280ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}>
        <style>{`
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
          @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        `}</style>

        {/* header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Badge color="#D97706" tone="solid" size="xs">⚡ Bridge</Badge>
              <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Replacement candidates</span>
            </div>
            <button onClick={onClose} style={{
              width: 30, height: 30, border: "1px solid var(--border)",
              background: "#fff", borderRadius: 6, cursor: "pointer",
              display: "grid", placeItems: "center", color: "var(--text-secondary)",
            }}><Icon.close /></button>
          </div>
          <h2 className="font-display" style={{ fontSize: 28, margin: "10px 0 4px", lineHeight: 1.15 }}>
            Replace {u.strategy}
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            90d delta vs benchmark:{" "}
            <span className="font-mono tnum neg" style={{ fontWeight: 500 }}>{fmtPct(u.d90, { explicitSign: true })}</span>
            {" · "}breach: {u.breaches.length} gates
          </div>
        </div>

        {stage === "browse" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {/* mandate breach list */}
            <div style={{ padding: "16px 24px", background: "#FFFBF4", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--warning)", marginBottom: 10 }}>
                Mandate gates failed
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {u.breaches.map((b, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #FED7AA", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                      {b.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                      <span className="font-mono tnum" style={{ fontSize: 15, fontWeight: 500, color: "var(--negative)" }}>{b.currentLabel}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>gate {b.gateLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* candidates list */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
                Ranked by mandate fit
              </div>
              {bridge.candidates.map((c, i) => (
                <CandidateCard key={c.id} c={c} selected={i === selected} onClick={() => setSelected(i)} rank={i + 1} />
              ))}
            </div>
          </div>
        )}

        {stage === "confirm" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
              Send intro
            </div>
            <h3 className="font-display" style={{ margin: 0, fontSize: 22 }}>
              {c.strategy}
            </h3>
            <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>by {c.manager}</div>

            {/* Apples-to-apples: how this candidate fixes each breached gate */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 10 }}>
                How this fixes your breached gates
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {u.breaches.map((b, i) => {
                  const candVal = c[b.key];
                  const candLabel = b.format === "pctMag"
                    ? (Math.abs(candVal) * 100).toFixed(1) + "%"
                    : (+candVal).toFixed(2);
                  return (
                    <div key={i} style={{
                      display: "grid", gridTemplateColumns: "1fr auto 1fr auto",
                      alignItems: "center", gap: 12,
                      padding: "10px 12px",
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: 6,
                    }}>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{b.label} · current</div>
                        <div className="font-mono tnum neg" style={{ fontSize: 15, fontWeight: 500, marginTop: 2 }}>{b.currentLabel}</div>
                      </div>
                      <div style={{ color: "var(--accent)" }}><Icon.chevronRight size={16} /></div>
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{b.label} · candidate</div>
                        <div className="font-mono tnum pos" style={{ fontSize: 15, fontWeight: 500, marginTop: 2 }}>{candLabel}</div>
                      </div>
                      <div style={{
                        padding: "2px 8px", borderRadius: 999,
                        background: "var(--positive-10, #ECFDF5)",
                        color: "var(--positive)",
                        fontSize: 11, fontWeight: 600,
                        fontFamily: "Geist Mono",
                        whiteSpace: "nowrap",
                      }}>
                        passes {b.gateLabel}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Potential allocation — pre-filled from mandate target */}
            <div style={{ marginTop: 20 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Potential allocation size</label>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  defaultValue={fmtUSD(c.potentialAllocation, { compact: false })}
                  style={{
                    flex: 1, height: 38,
                    padding: "0 12px", fontSize: 14,
                    border: "1px solid var(--border)", borderRadius: 6,
                    fontFamily: "Geist Mono", fontVariantNumeric: "tabular-nums",
                  }}
                />
                <Button variant="secondary">Use mandate target</Button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                Indicative only — actual size set when allocation lands. Mandate target {fmtUSD(bridge.mandate.targetSize, { compact: true })} · range {fmtUSD(bridge.mandate.sizeRange[0], { compact: true })}–{fmtUSD(bridge.mandate.sizeRange[1], { compact: true })}.
              </div>
            </div>

            {/* Note to manager — mandate-first, no mention of source strategy */}
            <div style={{ marginTop: 20 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>Note to manager</label>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, marginBottom: 8 }}>
                Minimum: our mandate. Expected size and other context are optional.
              </div>
              <textarea
                defaultValue={`Mandate: ${bridge.mandate.name} — ${bridge.mandate.style}. Gates: ${bridge.mandate.constraints.join(", ")}.\n\nExpected size: ~${fmtUSD(c.potentialAllocation, { compact: true })} (range ${fmtUSD(bridge.mandate.sizeRange[0], { compact: true })}–${fmtUSD(bridge.mandate.sizeRange[1], { compact: true })}).\n\nYour ${c.tag.toLowerCase()} profile fits the mandate. Happy to connect.`}
                style={{
                  width: "100%", padding: "10px 12px",
                  fontSize: 13, fontFamily: "DM Sans", lineHeight: 1.55,
                  border: "1px solid var(--border)", borderRadius: 6,
                  resize: "vertical", minHeight: 132,
                }}
              />
            </div>
          </div>
        )}

        {/* footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)" }}>
          {stage === "browse" ? (
            <>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {bridge.candidates.length} candidates · ranked by mandate fit
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="ghost" onClick={onClose}>Close</Button>
                <Button variant="primary" onClick={() => setStage("confirm")}>
                  Continue with {bridge.candidates[selected].strategy} →
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStage("browse")}>← Back</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" onClick={onClose}>Save as draft</Button>
                <Button variant="primary" onClick={() => onAllocate(c)}>Send intro →</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CandidateCard({ c, selected, onClick, rank }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: 16,
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        background: selected ? "var(--accent-10)" : "var(--surface)",
        borderRadius: 8, cursor: "pointer",
        marginBottom: 10,
        transition: "all 150ms ease-out",
        boxShadow: selected ? "0 0 0 3px rgba(27,107,90,0.08)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "start", gap: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 999,
          background: selected ? "var(--accent)" : "#F1F5F9",
          color: selected ? "#fff" : "var(--text-secondary)",
          display: "grid", placeItems: "center",
          fontSize: 12, fontWeight: 600, flexShrink: 0,
          fontFamily: "Geist Mono",
        }}>{rank}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>{c.strategy}</span>
            {c.verified && <span style={{ color: "var(--accent)", display: "flex" }}><Icon.verified size={14}/></span>}
            <Badge color={TAG_COLOR[c.tag] || "#64748B"}>{c.tag}</Badge>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            by {c.manager} · AUM {fmtUSD(c.aum, { compact: true })}
          </div>

          {/* metric strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <MicroMetric label="Fit" value={(c.fit * 100).toFixed(0) + "%"} accent />
            <MicroMetric label="Sharpe" value={c.sharpe.toFixed(2)} />
            <MicroMetric label="MTD" value={fmtPct(c.mtd, { explicitSign: true })} color={c.mtd > 0 ? "pos" : "neg"} />
            <MicroMetric label="Max DD" value={fmtPct(c.dd, { explicitSign: true })} color="neg" />
          </div>

          {/* mandate fit breakdown */}
          <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
            <MandateBar label="Liquidity" v={c.mandateFit.liquidity} />
            <MandateBar label="Style" v={c.mandateFit.style} />
            <MandateBar label="Risk" v={c.mandateFit.risk} />
          </div>

          {selected && (
            <div style={{
              marginTop: 12, padding: "8px 10px",
              background: "#fff", border: "1px solid var(--border)",
              borderRadius: 6, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5,
            }}>
              <b style={{ color: "var(--text-primary)" }}>Why this one: </b>{c.reason}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MicroMetric({ label, value, accent, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</div>
      <div className="font-mono tnum" style={{ fontSize: 15, fontWeight: 500, marginTop: 2, color: accent ? "var(--accent)" : color === "pos" ? "var(--positive)" : color === "neg" ? "var(--negative)" : "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function MandateBar({ label, v }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 3 }}>
        <span>{label}</span>
        <span className="font-mono tnum" style={{ color: "var(--text-secondary)" }}>{(v * 100).toFixed(0)}</span>
      </div>
      <div style={{ height: 3, background: "#E2E8F0", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${v * 100}%`, height: "100%", background: v >= 0.85 ? "var(--positive)" : v >= 0.7 ? "var(--accent)" : "var(--warning)" }} />
      </div>
    </div>
  );
}

Object.assign(window, { BridgeBanner, BridgeDrawer });
