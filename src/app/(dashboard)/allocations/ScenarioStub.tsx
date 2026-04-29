import { Card } from "@/components/ui/Card";
import {
  ScenarioFlaggedHoldingsList,
  type ScenarioFlaggedHoldingsListProps,
} from "./ScenarioFlaggedHoldingsList";
import type { FlaggedHolding } from "./lib/holding-outcome-adapter";
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

/**
 * Phase 07 Plan 04 / D-06 — Scenario tab stub.
 *
 * Phase 09 / D-08 + Pitfall 7: when `flaggedHoldings.length > 0`, renders
 * `ScenarioFlaggedHoldingsList` instead of the stub card. The stub card is
 * preserved verbatim as the empty-state fallback.
 *
 * Phase 09.1 Plan 10 (D-07): restyle-only token cleanup — explicit
 * `var(--font-serif)` on the heading, design-token spacing, no behavior
 * change. Phase 10 replaces the body with the Scenario composer.
 *
 * Copy strings are locked. Do not modify without a design review.
 */
export interface ScenarioStubProps {
  /** Phase 09. When non-empty, replaces the stub card with the flagged list. */
  flaggedHoldings?: FlaggedHolding[];
  matchDecisionsByHoldingRef?: Record<string, { id: string } | null>;
  existingOutcomesByHoldingRef?: Record<string, BridgeOutcome | null>;
  allocatorPreferences?: ScenarioFlaggedHoldingsListProps["allocatorPreferences"];
}

export function ScenarioStub({
  flaggedHoldings,
  matchDecisionsByHoldingRef = {},
  existingOutcomesByHoldingRef = {},
  allocatorPreferences,
}: ScenarioStubProps = {}) {
  // D-08 + Pitfall 7: branch on flagged holdings presence
  if (flaggedHoldings && flaggedHoldings.length > 0) {
    return (
      <ScenarioFlaggedHoldingsList
        flaggedHoldings={flaggedHoldings}
        matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
        existingOutcomesByHoldingRef={existingOutcomesByHoldingRef}
        allocatorPreferences={allocatorPreferences}
      />
    );
  }

  // Phase 09.1 Plan 10 — restyled empty-state. Card padding + serif heading
  // via the explicit CSS var so the design-token map is unambiguous.
  return (
    <Card className="py-12 text-center">
      <h2
        className="mb-2 text-2xl text-text-primary"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Scenario builder coming soon
      </h2>
      <p className="mx-auto max-w-md text-sm text-text-secondary">
        Model what-if outcomes by adding or removing strategies and holdings
        from your live composition. Available in the next update.
      </p>
    </Card>
  );
}
