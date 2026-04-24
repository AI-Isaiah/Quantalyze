"use client";

/**
 * Phase 09.1 Plan 05 — SizeStepper
 *
 * 4-button width stepper (1/2/3/4 columns) per designer-bundle/project/src/
 * widget-grid.jsx:192-217. Lives inside WidgetChrome on every grid tile;
 * driven by useDashboardConfigV2.resizeWidget when a button is clicked.
 *
 * D-01 contract: widths snap to 1, 2, 3, or 4 of the 4-col grid. The active
 * width gets the accent background; others get a neutral chrome treatment
 * that disappears alongside the rest of the chrome when the parent
 * `.widget-cell` loses hover/focus-within (handled by WidgetGrid CSS).
 *
 * DESIGN.md: numeric labels in Geist Mono, 9.5px (matches designer source).
 */

const SIZES: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];

type Props = {
  current: 1 | 2 | 3 | 4;
  onChange: (w: 1 | 2 | 3 | 4) => void;
};

export function SizeStepper({ current, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Widget width"
      style={{
        display: "inline-flex",
        gap: 0,
        padding: 2,
        background: "#fff",
        border: "1px solid var(--border, #E2E8F0)",
        borderRadius: 4,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-label={`Width ${s} of 4`}
          aria-pressed={s === current}
          onClick={() => onChange(s)}
          style={{
            width: 16,
            height: 16,
            padding: 0,
            border: "none",
            borderRadius: 2,
            background: s === current ? "var(--accent, #1B6B5A)" : "transparent",
            color: s === current ? "#fff" : "var(--text-muted, #718096)",
            fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
            fontSize: 9.5,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 120ms",
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
