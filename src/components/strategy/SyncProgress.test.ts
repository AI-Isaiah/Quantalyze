/**
 * audit-2026-05-07 C-0142 — SyncStatus exhaustive narrowing.
 *
 * Regression: the previous code did raw string comparisons against
 * `computation_status` values, so adding a new DB status silently
 * routed to none of the UI branches. This file tests the discriminated
 * converter `toSyncStatus` that maps every `ComputationStatus` variant
 * to a `SyncStatus`, and exercises `assertNever` for unknown inputs.
 *
 * IMPORTANT (behavioral guarantee, not just coverage): if a maintainer
 * adds a new variant to `StrategyAnalytics.computation_status` in
 * `src/lib/types.ts` without extending `toSyncStatus`, the `switch`
 * `never` mismatch is a compile-time error. The runtime test below
 * also pins the four current mappings so a refactor cannot silently
 * change one branch (e.g. routing "failed" to "complete").
 */
import { describe, it, expect } from "vitest";
import { toSyncStatus, type ComputationStatus } from "./SyncProgress";

describe("toSyncStatus (audit-2026-05-07 C-0142)", () => {
  it("maps DB 'pending' to UI 'idle'", () => {
    expect(toSyncStatus("pending")).toBe("idle");
  });

  it("maps DB 'computing' to UI 'computing'", () => {
    expect(toSyncStatus("computing")).toBe("computing");
  });

  it("maps DB 'complete' to UI 'complete'", () => {
    expect(toSyncStatus("complete")).toBe("complete");
  });

  it("maps DB 'failed' to UI 'error'", () => {
    expect(toSyncStatus("failed")).toBe("error");
  });

  it("covers every ComputationStatus variant (exhaustive)", () => {
    // Pinning the full DB → UI mapping. If a new DB variant is added,
    // TypeScript fails the build at `toSyncStatus`'s switch; this list
    // must then be updated and the new mapping documented.
    const cases: ReadonlyArray<readonly [ComputationStatus, string]> = [
      ["pending", "idle"],
      ["computing", "computing"],
      ["complete", "complete"],
      ["failed", "error"],
    ];
    for (const [db, ui] of cases) {
      expect(toSyncStatus(db)).toBe(ui);
    }
  });

  it("throws via assertNever for an unknown DB value (defensive runtime guard)", () => {
    // Simulate a DB row that drifts past the type at runtime (e.g.
    // a Supabase typegen lag after a migration). The `default` branch
    // calls `assertNever` which throws — surfaces the drift loudly
    // instead of silently dropping the UI update.
    expect(() => toSyncStatus("bogus_state" as ComputationStatus)).toThrow(
      /unexpected ComputationStatus variant/,
    );
  });
});
