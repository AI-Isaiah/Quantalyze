"use client";

import { Suspense } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { WIDGET_COMPONENTS } from "./widgets";

/**
 * Phase 09.1 D-06 — Risk tab body (Plan 10).
 *
 * Curated 6-widget grid via WIDGET_COMPONENTS (no new widgets — picker
 * rendering only). Order matches the planning §D-06 list.
 *
 * Each tile carries `data-widget-id` so a future IntersectionObserver
 * (Plan 05 in the AllocationDashboardV2 root) can fire `widget_viewed`
 * analytics for Risk-tab widgets too.
 */

const RISK_WIDGETS = [
  "var-expected-shortfall",
  "tail-risk",
  "risk-decomposition",
  "alpha-beta-decomposition",
  "regime-detector",
  "correlation-matrix",
] as const;

export function RiskTabPanel(props: MyAllocationDashboardPayload) {
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
                // it through its own schema, so the whole payload passes as-is
                // (no `as any` escape hatch).
                data={props}
                timeframe="1YTD"
                width={0}
                height={0}
              />
            </Suspense>
          </div>
        );
      })}
    </div>
  );
}
