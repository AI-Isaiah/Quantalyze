// ---------------------------------------------------------------------------
// Tweaks panel — floating bottom-right with persistence via postMessage
// ---------------------------------------------------------------------------

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "accentIntensity": "muted",
  "displayFont": "serif",
  "bridgeVariant": "full",
  "chartStyle": "area",
  "showOutcomes": true,
  "showBench": true
}/*EDITMODE-END*/;

function TweakPanel({ value, onChange, visible, onClose }) {
  if (!visible) return null;

  const Row = ({ label, children }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{label}</span>
      <div style={{ display: "flex", gap: 4 }}>{children}</div>
    </div>
  );

  const Seg = ({ val, cur, onClick, children }) => (
    <button onClick={onClick} style={{
      padding: "4px 10px",
      border: `1px solid ${val === cur ? "var(--accent)" : "var(--border)"}`,
      background: val === cur ? "var(--accent-10)" : "#fff",
      color: val === cur ? "var(--accent)" : "var(--text-secondary)",
      borderRadius: 4, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
      fontFamily: "DM Sans",
    }}>{children}</button>
  );

  const set = (k, v) => onChange({ ...value, [k]: v });

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20,
      width: 300, maxHeight: "80vh", overflowY: "auto",
      background: "#fff", border: "1px solid var(--border)",
      borderRadius: 10, boxShadow: "var(--shadow-pop)",
      zIndex: 50, padding: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Tweaks</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Design variations · live</div>
        </div>
        <button onClick={onClose} style={{
          width: 26, height: 26, border: "1px solid var(--border)", background: "#fff",
          borderRadius: 4, cursor: "pointer", color: "var(--text-secondary)", display: "grid", placeItems: "center",
        }}><Icon.close size={12}/></button>
      </div>

      <Row label="Density">
        <Seg val="tight" cur={value.density} onClick={() => set("density", "tight")}>Tight</Seg>
        <Seg val="comfortable" cur={value.density} onClick={() => set("density", "comfortable")}>Regular</Seg>
        <Seg val="loose" cur={value.density} onClick={() => set("density", "loose")}>Loose</Seg>
      </Row>

      <Row label="Accent">
        <Seg val="muted" cur={value.accentIntensity} onClick={() => set("accentIntensity", "muted")}>Muted</Seg>
        <Seg val="full" cur={value.accentIntensity} onClick={() => set("accentIntensity", "full")}>Full</Seg>
      </Row>

      <Row label="Display font">
        <Seg val="serif" cur={value.displayFont} onClick={() => set("displayFont", "serif")}>Serif</Seg>
        <Seg val="sans" cur={value.displayFont} onClick={() => set("displayFont", "sans")}>Sans</Seg>
      </Row>

      <Row label="Bridge banner">
        <Seg val="subtle" cur={value.bridgeVariant} onClick={() => set("bridgeVariant", "subtle")}>Subtle</Seg>
        <Seg val="card" cur={value.bridgeVariant} onClick={() => set("bridgeVariant", "card")}>Card</Seg>
        <Seg val="full" cur={value.bridgeVariant} onClick={() => set("bridgeVariant", "full")}>Hero</Seg>
      </Row>

      <Row label="Equity chart">
        <Seg val="line" cur={value.chartStyle} onClick={() => set("chartStyle", "line")}>Line</Seg>
        <Seg val="area" cur={value.chartStyle} onClick={() => set("chartStyle", "area")}>Area</Seg>
      </Row>

      <Row label="Benchmark overlay">
        <Seg val={true} cur={value.showBench} onClick={() => set("showBench", true)}>On</Seg>
        <Seg val={false} cur={value.showBench} onClick={() => set("showBench", false)}>Off</Seg>
      </Row>

      <Row label="Outcomes widget">
        <Seg val={true} cur={value.showOutcomes} onClick={() => set("showOutcomes", true)}>Show</Seg>
        <Seg val={false} cur={value.showOutcomes} onClick={() => set("showOutcomes", false)}>Hide</Seg>
      </Row>

      <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg)", borderRadius: 6, fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
        Toggle the Tweaks button in the toolbar to re-hide. Changes persist live.
      </div>
    </div>
  );
}

Object.assign(window, { TweakPanel, TWEAK_DEFAULTS });
