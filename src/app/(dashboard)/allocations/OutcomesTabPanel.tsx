"use client";

import type { MyAllocationDashboardPayload } from "@/lib/queries";
import OutcomesWidget from "./widgets/outcomes/OutcomesWidget";

/**
 * Phase 09.1 D-06 — Outcomes tab body (full-width OutcomesWidget).
 * Plan 02 stub; Plan 10 fills with the restyled OutcomesWidget (designer
 * outcomes.jsx shape: 3-KPI strip + delta table + OutcomeDetail).
 *
 * The OutcomesWidget consumes WidgetProps `{ data, timeframe, width?, height? }`.
 * `data` accepts the full payload — the widget reads `data.outcomes` only.
 * `width`/`height` are omitted (H-0076): the widget body sizes via `flex h-full`
 * / Recharts `ResponsiveContainer`, so there is no real pixel size to pass.
 */
export function OutcomesTabPanel(props: MyAllocationDashboardPayload) {
  return (
    <div data-tab-panel="outcomes">
      <OutcomesWidget
        // B21: `data` is `unknown` on WidgetProps; OutcomesWidget validates it
        // through outcomesWidgetDataSchema, so the whole payload passes as-is.
        data={props}
        timeframe="1YTD"
      />
    </div>
  );
}
