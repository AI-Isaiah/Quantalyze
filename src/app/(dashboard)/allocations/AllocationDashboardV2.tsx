"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 09.1 Plan 01 / D-17 — V2 dashboard shell.
 *
 * Empty by design: subsequent plans (02..11) fill this with the 4-col grid,
 * WidgetChrome-wrapped widgets, KpiStrip rewrite, EquityChart, HoldingsTable
 * with 3-tab row-expand, Bridge hero + drawer, and the rest of the designer's
 * Overview tab composition.
 *
 * Plan 01 only: render a visible "V2 shell active" marker so the feature
 * flag can be verified end-to-end before real content lands. The outer
 * wrapper carries a `data-ui-v2-shell` attribute so DOM-level tests can
 * assert which branch rendered without relying on user-visible copy.
 *
 * Props deliberately mirror MyAllocationDashboardPayload so the shell can be
 * a drop-in replacement for AllocationDashboard at the AllocationsTabs render
 * site — no payload remapping needed when V2 finally lands.
 */
export function AllocationDashboardV2(_props: MyAllocationDashboardPayload) {
  return (
    <div
      data-ui-v2-shell="true"
      className="rounded-lg border border-border bg-surface p-8 text-sm text-text-secondary"
    >
      Allocator dashboard V2 shell — widgets landing in plans 02 through 11.
    </div>
  );
}
