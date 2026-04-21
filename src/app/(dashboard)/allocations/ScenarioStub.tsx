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
 * Copy strings are verbatim from 07-UI-SPEC.md §Copywriting. Do not
 * modify without a design review.
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

  return (
    <Card className="py-12 text-center">
      <h2 className="font-serif text-2xl text-text-primary mb-2">
        Scenario builder coming soon
      </h2>
      <p className="text-sm text-text-secondary max-w-md mx-auto">
        Model what-if outcomes by adding or removing strategies and holdings
        from your live composition. Available in the next update.
      </p>
    </Card>
  );
}
