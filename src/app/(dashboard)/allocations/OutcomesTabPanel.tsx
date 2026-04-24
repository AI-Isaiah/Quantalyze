"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";
import OutcomesWidget from "./widgets/outcomes/OutcomesWidget";

/**
 * Phase 09.1 D-06 — Outcomes tab body (full-width OutcomesWidget).
 * Plan 02 stub; Plan 10 fills with the restyled OutcomesWidget (designer
 * outcomes.jsx shape: 3-KPI strip + delta table + OutcomeDetail).
 *
 * The OutcomesWidget consumes WidgetProps `{ data, timeframe, width, height }`.
 * `data` accepts the full payload — the widget reads `data.outcomes` only.
 * `width`/`height` are ignored by the widget body (it uses `flex h-full`).
 */
export function OutcomesTabPanel(props: MyAllocationDashboardPayload) {
  return (
    <div data-tab-panel="outcomes">
      <OutcomesWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={props as any}
        timeframe="YTD"
        width={0}
        height={0}
      />
    </div>
  );
}
