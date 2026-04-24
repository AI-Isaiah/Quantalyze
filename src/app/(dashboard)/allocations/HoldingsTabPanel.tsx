"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 09.1 D-06 — Holdings tab body (full-width HoldingsTable).
 * Plan 02 stub; Plan 08 fills with designer HoldingsTable + 3-tab row-expand
 * + adapter-driven rows (D-11 / D-18).
 *
 * Props mirror MyAllocationDashboardPayload so Plan 08 can wire the
 * HoldingsTable + adapter without changing the AllocationsTabs render site.
 */
export function HoldingsTabPanel(_props: MyAllocationDashboardPayload) {
  return (
    <div
      data-tab-panel="holdings"
      className="rounded-lg border border-border bg-surface p-8 text-sm text-text-secondary"
    >
      Holdings tab — full-width table shipping in Plan 08 (D-11 / D-18).
    </div>
  );
}
