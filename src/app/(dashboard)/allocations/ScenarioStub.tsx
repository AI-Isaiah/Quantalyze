import { Card } from "@/components/ui/Card";

/**
 * Phase 07 Plan 04 / D-06 — Scenario tab stub.
 *
 * Intentionally zero logic: the Phase 10 Scenario builder owns
 * SCENARIO-01…SCENARIO-09. This stub exists only so the two-mode mental
 * model ("Performance vs Scenario") is established while the allocator's
 * eye still follows the Performance tab for day-to-day monitoring.
 *
 * Copy strings are verbatim from 07-UI-SPEC.md §Copywriting. Do not
 * modify without a design review.
 */
export function ScenarioStub() {
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
