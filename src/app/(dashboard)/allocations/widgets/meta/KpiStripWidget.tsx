"use client";

import type { WidgetProps } from "../../lib/types";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { PortfolioAnalytics } from "@/lib/types";
import { WidgetState } from "../../components/WidgetState";
import { isWidgetStateV2Enabled } from "@/lib/widget-state-flag";

/**
 * Phase 09.1 PR1 (dashboard parity) — V2 Overview KPI strip.
 *
 * Pixel-faithful port of the prototype's `KPIPanel` (designer source:
 * `Allocator Dashboard.html` KPIPanel; prototype `app.jsx:397-443`). 5-cell
 * row, single Card chrome, vertical-bar dividers between cells, and the
 * prototype's exact responsive media-query break at 1100px (collapses to 3
 * columns) and 720px (collapses to 2 columns). Inline styles + var(--*)
 * tokens are byte-equivalent to the prototype JSX.
 *
 * NOTE: this is intentionally NOT a wrapper around the existing
 * `components/KpiStrip.tsx`. That component renders 5 separate bordered
 * cards in a Tailwind grid — structurally different from the prototype's
 * 1-card / 5-divided-cells layout. Pixel parity per the user directive
 * ("do not adapt the design") trumps reuse. The other component stays
 * untouched and continues to power `OutcomesWidget`'s per-window KPI strip.
 *
 * Data wiring (every cell falls back to em-dash on null):
 *   - AUM       : `analytics.total_aum` ?? sum(`holdingsSummary[*].value_usd`).
 *                 Sub-copy: `${strategies.length} strategies`.
 *   - YTD TWR   : `analytics.return_ytd`. Sub: `MTD {formatPct(return_mtd)}`.
 *                 Positive-tinted (matches prototype `color: "pos"`).
 *   - Sharpe    : `analytics.portfolio_sharpe`. Sub: `α —` (no alpha field
 *                 on PortfolioAnalytics; sub-copy preserved for layout
 *                 fidelity, value falls back to em-dash).
 *   - Max DD 12m: `analytics.portfolio_max_drawdown`. Sub:
 *                 `vol {formatPct(portfolio_volatility)}`. Negative-tinted.
 *   - Avg ρ     : `analytics.avg_pairwise_correlation`. Sub: `tgt < 0.30`
 *                 (hardcoded — same as prototype).
 */

interface KpiCell {
  label: string;
  /** Pre-formatted main value (e.g. "$48.73M", "+14.32%", "1.84"). */
  value: string;
  /** Pre-formatted sub-copy (e.g. "8 strategies", "MTD +2.17%"). */
  sub: string;
  /** Optional color cue — matches prototype's `color: "pos" | "neg"`. */
  color?: "pos" | "neg";
}

export function KpiStripWidget({ data }: WidgetProps) {
  const payload = (data ?? {}) as Partial<MyAllocationDashboardPayload>;
  const cells = buildCells(payload);

  // Phase 11 / UI-BLOCK-01 — wire WidgetState v2 behind the feature flag.
  // KpiStripWidget has NO explicit state branches today (it always renders
  // 5 cells with em-dashes for missing values, which is its way of
  // expressing the empty/warmup state). Per the UI-BLOCK-01 contract we
  // do NOT manufacture a new state branch; we only forward the existing
  // success render through <WidgetState mode="success"> when the flag is
  // ON. This proves the primitive is consumed in production while
  // preserving byte-identical visual output (mode="success" is bare
  // children, no Card chrome). When the flag is OFF (default), the strip
  // renders verbatim — production behavior is unchanged.
  const v2 = isWidgetStateV2Enabled();

  const strip = (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        padding: 0,
        overflow: "hidden",
      }}
    >
      <div
        className="kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        }}
      >
        {cells.map((cell, i) => (
          <div
            key={cell.label}
            className="kpi-cell"
            data-i={i}
            style={{
              padding: "8px 14px",
              borderLeft:
                i === 0 ? "none" : "1px solid var(--color-border)",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cell.label}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                marginTop: 2,
                minWidth: 0,
              }}
            >
              <div
                className="font-mono tnum"
                style={{
                  fontSize: 18,
                  fontWeight: 500,
                  lineHeight: 1.1,
                  color:
                    cell.color === "pos"
                      ? "var(--positive)"
                      : cell.color === "neg"
                        ? "var(--negative)"
                        : "var(--text-primary)",
                  letterSpacing: "-0.01em",
                  whiteSpace: "nowrap",
                }}
              >
                {cell.value}
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {cell.sub}
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Responsive break-points byte-equivalent to prototype app.jsx:428-440. */}
      <style>{`
        @media (max-width: 1100px) {
          .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .kpi-cell[data-i="3"] { border-left: none !important; border-top: 1px solid var(--color-border); }
          .kpi-cell[data-i="4"] { border-top: 1px solid var(--color-border); }
        }
        @media (max-width: 720px) {
          .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .kpi-cell { border-left: none !important; border-top: 1px solid var(--color-border) !important; }
          .kpi-cell[data-i="0"], .kpi-cell[data-i="1"] { border-top: none !important; }
          .kpi-cell[data-i="2"], .kpi-cell[data-i="4"] { border-left: 1px solid var(--color-border) !important; }
        }
      `}</style>
    </div>
  );

  if (v2) {
    return <WidgetState mode="success">{strip}</WidgetState>;
  }
  return strip;
}

// ---------------------------------------------------------------------------
// Cell construction
// ---------------------------------------------------------------------------

function buildCells(
  payload: Partial<MyAllocationDashboardPayload>,
): KpiCell[] {
  const analytics: PortfolioAnalytics | null = payload.analytics ?? null;
  const strategies = payload.strategies ?? [];
  const holdingsSummary = payload.holdingsSummary ?? [];

  const aum = computeAum(analytics, holdingsSummary);
  const strategyCount = strategies.length;
  const ytd = analytics?.return_ytd ?? null;
  const mtd = analytics?.return_mtd ?? null;
  const sharpe = analytics?.portfolio_sharpe ?? null;
  const maxDd = analytics?.portfolio_max_drawdown ?? null;
  const vol = analytics?.portfolio_volatility ?? null;
  const corr = analytics?.avg_pairwise_correlation ?? null;

  return [
    {
      label: "AUM",
      value: fmtCurrencyCompact(aum),
      sub: `${strategyCount} ${strategyCount === 1 ? "strategy" : "strategies"}`,
    },
    {
      label: "YTD TWR",
      value: fmtPct(ytd, true),
      sub: `MTD ${fmtPct(mtd, true)}`,
      color: "pos",
    },
    {
      label: "Sharpe",
      value: sharpe == null ? "—" : sharpe.toFixed(2),
      sub: "α —",
    },
    {
      label: "Max DD 12m",
      value: fmtPct(maxDd, true),
      sub: `vol ${fmtPct(vol, false)}`,
      color: "neg",
    },
    {
      label: "Avg ρ",
      value: corr == null ? "—" : corr.toFixed(2),
      sub: "tgt < 0.30",
    },
  ];
}

function computeAum(
  analytics: PortfolioAnalytics | null,
  holdingsSummary: MyAllocationDashboardPayload["holdingsSummary"],
): number | null {
  if (analytics?.total_aum != null) return analytics.total_aum;
  if (holdingsSummary.length === 0) return null;
  return holdingsSummary.reduce(
    (sum, h) => sum + (typeof h.value_usd === "number" ? h.value_usd : 0),
    0,
  );
}

/**
 * Compact USD formatter matching the prototype `fmtUSD(value, { compact:
 * true })` output: 2 decimals always (e.g. `$48.73M`, `$1.20K`). The
 * production `formatCurrency` helper rounds to 1 decimal — we want 2 here
 * for byte-fidelity to the screenshot.
 */
function fmtCurrencyCompact(value: number | null): string {
  if (value == null) return "—";
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

/**
 * Percent formatter at 2 decimals. `signed=true` prepends `+` for positive
 * values (matches prototype `fmtPct(v, { explicitSign: true })`); negative
 * sign is always rendered. Returns em-dash for null.
 */
function fmtPct(value: number | null, signed: boolean): string {
  if (value == null) return "—";
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

export default KpiStripWidget;
