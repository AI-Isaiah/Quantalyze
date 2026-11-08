"use client";

import { Suspense } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { WIDGET_COMPONENTS, type WidgetId } from "./widgets";
import { bookRiskInput } from "./widgets/lib/book-risk-input";

/**
 * Phase 198 plan 06 (D-02) — the Overview Risk section's widget grid.
 *
 * Phase 09.1 D-06 made this the Risk tab body; the tab is retired (198 D-02)
 * and its six widgets now render in `<section id="risk">` of the Overview.
 * Curated 6-widget grid via WIDGET_COMPONENTS (no new widgets — picker
 * rendering only). Order matches the planning §D-06 list.
 *
 * The gate lives in the Overview, not here (RESEARCH P5): the Overview's ONE
 * `historyGate` call decides the whole page, and this grid is mounted only by
 * its "ready" branch, so the page and the Risk section can never disagree. The
 * panel no longer gates itself; rendered on its own it draws the grid for
 * whatever payload it is handed, so a caller must not mount it over a history
 * the gate holds back.
 *
 * Each tile carries `data-widget-id` so a future IntersectionObserver
 * (Plan 05 in the AllocationDashboardV2 root) can fire `widget_viewed`
 * analytics for these widgets too.
 */

// H-0157 / M-1096: typed against WidgetId, so the panel can only list ids that
// exist in WIDGET_COMPONENTS — a typo or a registry/panel divergence is a
// compile error, not a silent runtime "Widget unavailable" tile.
const RISK_WIDGETS: readonly WidgetId[] = [
  "var-expected-shortfall",
  "tail-risk",
  "risk-decomposition",
  "alpha-beta-decomposition",
  "regime-detector",
  "correlation-matrix",
] as const;

export function RiskTabPanel(props: MyAllocationDashboardPayload) {
  // Every widget reads the book the Overview charts, through the one adapter.
  const data = bookRiskInput(props);
  return (
    <div
      data-tab-panel="risk"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2"
    >
      {RISK_WIDGETS.map((id) => {
        const Component = WIDGET_COMPONENTS[id];
        if (!Component) {
          return (
            <div
              key={id}
              data-widget-id={id}
              className="rounded-lg border border-border bg-surface p-4 text-xs text-text-muted"
            >
              Widget unavailable: {id}
            </div>
          );
        }
        return (
          <div
            key={id}
            data-widget-id={id}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <Suspense
              fallback={
                <div className="text-xs text-text-muted">Loading {id}…</div>
              }
            >
              <Component
                // B21: `data` is `unknown` on WidgetProps; each widget validates
                // it through its own schema, so the adapted payload passes as-is
                // (no `as any` escape hatch).
                // H-0076: width/height omitted — widgets size via ResponsiveContainer.
                data={data}
                timeframe="1YTD"
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
