"use client";

/**
 * Phase 09.1 Plan 09 / D-15 — BridgeHeroWidget
 *
 * Thin WidgetProps adapter for the Hero Bridge widget. Pulls
 * `flaggedHoldings` and `matchDecisionsByHoldingRef` out of the dashboard
 * payload (`data` prop) and forwards them to the actual `BridgeWidget`
 * with the default `variant="full"` per D-15.
 *
 * The adapter exists so the lazy widget registry entry
 * (`widgets/index.ts:WIDGET_COMPONENTS["bridge-hero"]`) can render with
 * the standard `WidgetProps` contract while the underlying `BridgeWidget`
 * keeps a clean per-domain prop interface.
 */

import type { WidgetProps } from "../../lib/types";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import { BridgeWidget } from "../../components/BridgeWidget";

export default function BridgeHeroWidget({ data }: WidgetProps) {
  const hasError = Boolean(
    data && typeof data === "object" && (data as { __error?: unknown }).__error,
  );

  if (hasError) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
        Bridge unavailable
      </div>
    );
  }

  const payload = data as MyAllocationDashboardPayload | undefined;
  const flaggedHoldings = payload?.flaggedHoldings ?? [];
  const matchDecisionsByHoldingRef = payload?.matchDecisionsByHoldingRef ?? {};
  // PR2 (HANDOFF G4) — forward `outcomes` so the rich empty state can
  // surface "Last reviewed N days ago" + the count of reviews on file.
  // The dashboard payload already provides this list (sorted DESC,
  // capped at 200) so no new fetch is needed.
  const outcomes = payload?.outcomes ?? [];

  return (
    <BridgeWidget
      flaggedHoldings={flaggedHoldings}
      matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
      outcomes={outcomes}
    />
  );
}
