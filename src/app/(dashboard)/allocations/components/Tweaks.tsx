"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTweaks } from "../context/TweaksContext";

/**
 * PR3 (HANDOFF G5) — Tweaks panel
 *
 * QA-mode gate is GONE. Allocators see the panel via the TweaksToggle
 * chip in the header; clicking it opens this 300px floating popover at
 * bottom-right (matching `designer-bundle/project/src/tweaks.jsx:38-99`).
 *
 * The panel reads the 7-knob state from TweaksContext; the provider
 * applies side effects (body[data-density], root --color-accent swap).
 * Each segmented row mirrors the prototype's labels exactly so the
 * pixel-by-pixel comparison check passes.
 *
 * Persistence is in localStorage under "allocations.tweaks" (same key
 * as the QA-gated v0.15.x panel — stored preferences survive the lift).
 */

export function Tweaks() {
  const { state, set, reset, panelOpen, closePanel } = useTweaks();
  const panelRef = useRef<HTMLDivElement>(null);

  // Outside-click + Esc dismissal.
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't close when clicking the toggle itself — TweaksToggle handles
      // that. Identify the toggle via its data attribute.
      if (target?.closest("[data-tweaks-toggle]")) return;
      if (panelRef.current && !panelRef.current.contains(target)) closePanel();
    };
    const t = setTimeout(() => {
      document.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [panelOpen, closePanel]);

  if (!panelOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Tweaks"
      style={{
        position: "fixed",
        bottom: 20,
        right: 20,
        width: 300,
        maxHeight: "80vh",
        overflowY: "auto",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)",
        zIndex: 50,
        padding: 16,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
            Tweaks
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Design variations · live
          </div>
        </div>
        <button
          type="button"
          onClick={closePanel}
          aria-label="Close tweaks"
          style={{
            width: 26,
            height: 26,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            borderRadius: 4,
            cursor: "pointer",
            color: "var(--color-text-secondary)",
            display: "grid",
            placeItems: "center",
            fontSize: 14,
            lineHeight: 1,
            fontFamily: "var(--font-sans)",
          }}
        >
          ×
        </button>
      </div>

      <Row label="Density">
        <Seg active={state.density === "tight"} onClick={() => set("density", "tight")}>
          Tight
        </Seg>
        <Seg
          active={state.density === "comfortable"}
          onClick={() => set("density", "comfortable")}
        >
          Regular
        </Seg>
        <Seg active={state.density === "loose"} onClick={() => set("density", "loose")}>
          Loose
        </Seg>
      </Row>

      <Row label="Accent">
        <Seg
          active={state.accentIntensity === "muted"}
          onClick={() => set("accentIntensity", "muted")}
        >
          Muted
        </Seg>
        <Seg
          active={state.accentIntensity === "full"}
          onClick={() => set("accentIntensity", "full")}
        >
          Full
        </Seg>
      </Row>

      <Row label="Display font">
        <Seg
          active={state.displayFont === "serif"}
          onClick={() => set("displayFont", "serif")}
        >
          Serif
        </Seg>
        <Seg
          active={state.displayFont === "sans"}
          onClick={() => set("displayFont", "sans")}
        >
          Sans
        </Seg>
      </Row>

      <Row label="Bridge banner">
        <Seg
          active={state.bridgeVariant === "subtle"}
          onClick={() => set("bridgeVariant", "subtle")}
        >
          Subtle
        </Seg>
        <Seg
          active={state.bridgeVariant === "card"}
          onClick={() => set("bridgeVariant", "card")}
        >
          Card
        </Seg>
        <Seg
          active={state.bridgeVariant === "full"}
          onClick={() => set("bridgeVariant", "full")}
        >
          Hero
        </Seg>
      </Row>

      <Row label="Equity chart">
        <Seg
          active={state.chartStyle === "line"}
          onClick={() => set("chartStyle", "line")}
        >
          Line
        </Seg>
        <Seg
          active={state.chartStyle === "area"}
          onClick={() => set("chartStyle", "area")}
        >
          Area
        </Seg>
      </Row>

      <Row label="Benchmark overlay">
        <Seg active={state.showBench} onClick={() => set("showBench", true)}>
          On
        </Seg>
        <Seg active={!state.showBench} onClick={() => set("showBench", false)}>
          Off
        </Seg>
      </Row>

      <Row label="Outcomes tab">
        <Seg active={state.showOutcomes} onClick={() => set("showOutcomes", true)}>
          Show
        </Seg>
        <Seg active={!state.showOutcomes} onClick={() => set("showOutcomes", false)}>
          Hide
        </Seg>
      </Row>

      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 10,
          padding: "8px 10px",
          background: "var(--color-page)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--color-text-muted)",
          lineHeight: 1.5,
          width: "100%",
          textAlign: "left",
          border: "none",
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
        }}
      >
        Reset to defaults
      </button>
    </div>
  );
}

// Re-export the state type so call sites that imported it from the old
// path keep working (Tweaks.test.tsx, BridgeWidget tests).
export type { TweakState } from "../context/TweaksContext";

// ───────────────────────────────────────────────────────── primitives

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 4 }}>{children}</div>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const baseStyle: CSSProperties = {
    padding: "4px 10px",
    border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
    background: active
      ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
      : "var(--color-surface)",
    color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
  };
  return (
    <button type="button" onClick={onClick} style={baseStyle}>
      {children}
    </button>
  );
}

// Matches the legacy default export so existing AllocationDashboardV2
// imports keep working through the refactor.
export default Tweaks;

// Re-export TweakState alias for backward-compat with old test paths.
// Original Tweaks.tsx exported `Tweaks` (named) — preserved above.
