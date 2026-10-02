"use client";

import { Suspense } from "react";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { WIDGET_COMPONENTS, type WidgetId } from "./widgets";
import { EquityHistoryRebuilding } from "./components/EquityHistoryRebuilding";
import { bookRiskInput } from "./widgets/lib/book-risk-input";

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

/**
 * The keys a `key_not_syncing` reason is about, resolved to the owner's own key
 * rows exactly as the Overview resolves them (AllocationDashboardV2, review C2
 * round 2 IN-04): an id missing from `apiKeys` makes the set unknown (null), so
 * the line falls back to its unnamed form rather than naming a different key.
 */
function resolveNotSyncingKeys(
  props: MyAllocationDashboardPayload,
): MyAllocationDashboardPayload["apiKeys"] | null {
  const ids = props.equityHistoryNotSyncingKeyIds ?? [];
  if (ids.length === 0) return null;
  const byId = new Map((props.apiKeys ?? []).map((k) => [k.id, k]));
  const keys = ids.map((id) => byId.get(id));
  return keys.every((k) => k !== undefined) ? keys : null;
}

export function RiskTabPanel(props: MyAllocationDashboardPayload) {
  // Phase 169.4-01 (SC2, T-169-25): the Risk tab shares the Overview's
  // rebuilding state. Fail-closed like the Overview: only an explicit "ready"
  // shows a figure; a missing or unknown state reads as rebuilding, and NO risk
  // widget renders over a history 167.1.2 withholds.
  if (props.equityHistoryState !== "ready") {
    return (
      <div data-tab-panel="risk">
        <EquityHistoryRebuilding
          reason={props.equityHistoryRebuildReason ?? null}
          notSyncingKeys={resolveNotSyncingKeys(props)}
        />
      </div>
    );
  }
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
