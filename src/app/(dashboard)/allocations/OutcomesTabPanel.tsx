"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";

/**
 * Phase 09.1 D-06 — Outcomes tab body (full-width OutcomesWidget).
 * Plan 02 stub; Plan 10 fills by restyling existing OutcomesWidget to the
 * designer outcomes.jsx shape (3-KPI strip + delta table + OutcomeDetail).
 *
 * Props mirror MyAllocationDashboardPayload so Plan 10 can wire the existing
 * OutcomesWidget without changing the AllocationsTabs render site.
 */
export function OutcomesTabPanel(_props: MyAllocationDashboardPayload) {
  return (
    <div
      data-tab-panel="outcomes"
      className="rounded-lg border border-border bg-surface p-8 text-sm text-text-secondary"
    >
      Outcomes tab — restyled OutcomesWidget shipping in Plan 10.
    </div>
  );
}
