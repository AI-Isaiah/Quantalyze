"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 09.1 D-06 — Risk tab body (curated grid of 6 existing risk widgets).
 *
 * Curated widget IDs (live in WIDGET_COMPONENTS today):
 *   - var-expected-shortfall
 *   - tail-risk
 *   - risk-decomposition
 *   - alpha-beta-decomposition
 *   - regime-detector
 *   - correlation-matrix
 *
 * Plan 02 stub; Plan 10 fills with the curated grid reusing
 * WIDGET_COMPONENTS (no new widgets — picker rendering only).
 *
 * Props mirror MyAllocationDashboardPayload so Plan 10 can wire the
 * widgets' data without changing the AllocationsTabs render site.
 */
export function RiskTabPanel(_props: MyAllocationDashboardPayload) {
  return (
    <div
      data-tab-panel="risk"
      className="rounded-lg border border-border bg-surface p-8 text-sm text-text-secondary"
    >
      Risk tab — curated 6-widget grid shipping in Plan 10.
    </div>
  );
}
