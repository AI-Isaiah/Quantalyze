import type React from "react";

/**
 * Phase 100 / 100-03 (PI-06) — shared KPI panel primitive.
 *
 * Extracted verbatim from `KpiStrip.tsx`'s presentational shell so both the
 * allocations KpiStrip and the new `PortfolioKpiPanel` adapter render through
 * ONE white panel with N columned cells (micro uppercase muted label + Geist
 * Mono tabular-nums value + optional below-value content), hairline-bordered,
 * reflowing on the panel's OWN width via `@container` queries.
 *
 * This primitive is purely presentational: it holds NO warmup / stale /
 * scenario / delta logic and NO formatters. Callers resolve every value to a
 * display string (null → "—" is the caller's job) and pass a color-token
 * className plus any below-value nodes (a delta pill, a sub-copy line) as
 * `children`. The extraction is render-tree-neutral — KpiStrip's emitted DOM
 * is unchanged, so its existing tests pass unmodified.
 *
 * Layout invariants preserved from KpiStrip (Phase 52-02 / TYPE-04):
 *   - The `@container` HOST is a SEPARATE ancestor from the grid — an element
 *     never queries its own container size (CSS containment spec), so the host
 *     wraps the grid rather than sharing its class list.
 *   - Column count steps up by CONTAINER width via `@`-prefixed variants
 *     (`@sm`/`@lg`), never viewport `sm:`/`lg:`.
 *   - Inline-size containment only (bare `@container`, not `@container-size`).
 */
export interface KpiPanelCell {
  /** Stable React key + identity. KpiStrip uses the cell label. */
  key: string;
  /** Micro uppercase muted label. */
  label: string;
  /** Pre-formatted display value (caller resolves null → "—"). */
  value: string;
  /**
   * Color-token className appended to the value div (e.g. "text-positive").
   * Empty string when the metric carries no signed color.
   */
  valueClassName?: string;
  /**
   * Optional content rendered BELOW the value div (delta pill, sub-copy).
   * Rendered as-is so callers keep full control of that markup.
   */
  children?: React.ReactNode;
}

export interface KpiPanelProps {
  cells: KpiPanelCell[];
  /** Accessible group label. Defaults to KpiStrip's "Portfolio KPIs". */
  ariaLabel?: string;
}

export function KpiPanel({ cells, ariaLabel = "Portfolio KPIs" }: KpiPanelProps) {
  return (
    // Phase 52-02 / TYPE-04 — the panel is its OWN container-query context
    // (`@container`, inline-size) so it reflows on ITS width, not the viewport.
    // The `@container` HOST and the `@sm`/`@lg` grid variants must sit on
    // SEPARATE elements — an element never queries its OWN container size (CSS
    // containment spec), so the host wraps the grid rather than sharing its
    // class list. Inline-size containment ONLY — the size-containment variant
    // would collapse the panel's block size to 0.
    <div className="@container">
      <div
        className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @lg:grid-cols-4"
        role="group"
        aria-label={ariaLabel}
      >
        {cells.map(({ key, label, value, valueClassName, children }) => (
          <div
            key={key}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="text-micro font-semibold uppercase tracking-wider text-text-muted">
              {label}
            </div>
            {/* DESIGN.md: numeric data uses Geist Mono (font-mono) +
                tabular-nums so the fluid --text-* tier never raggeds a KPI
                column. */}
            <div
              className={`mt-1 font-mono text-lg font-medium tabular-nums ${valueClassName ?? ""}`}
            >
              {value}
            </div>
            {children}
          </div>
        ))}
      </div>
    </div>
  );
}
