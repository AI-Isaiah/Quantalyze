/**
 * H-1021 / H-1022 (pr-test-analyzer G1+G2) — compile-time tests for the seed
 * module's discriminated union and the legal-index narrowing.
 *
 * These tests do NOT exercise runtime behavior — they assert TYPES. If a
 * regression widens `PortfolioAnalyticsJSONB` so that `portfolio_returns` is
 * accessible on a `pending` arm (or removes `StrategyIdx` so 8 becomes a
 * legal index), the `@ts-expect-error` lines below will FLIP — the expected
 * error disappears, and `tsc --noEmit` will fail with
 * "Unused '@ts-expect-error' directive". That tsc failure IS the test.
 *
 * The test runner (vitest) compiles the file as part of the suite, so even
 * a no-op `it()` here is enough — vitest delegates to the project's TS
 * config which runs strict mode + noUnusedDirectives semantics for
 * `@ts-expect-error`. The single live runtime assertion is a smoke check
 * that the imported symbols exist (catches a stray rename of either type).
 */

import { describe, it, expect } from "vitest";
import {
  STRATEGY_UUIDS,
  type PortfolioAnalyticsJSONB,
  type StrategyIdx,
} from "../../scripts/seed-demo-data";

// All type-level assertions live inside this function. It is NEVER invoked at
// runtime (only its TS body is type-checked) — that prevents the `declare
// const row` + `if (row.computation_status === ...)` from blowing up vitest
// with "row is not defined" at module evaluation.
function _typeAssertions(): void {
  // ---------- H-1021: PortfolioAnalyticsJSONB discriminated union narrowing ----

   
  const row = null as unknown as PortfolioAnalyticsJSONB;

  // `complete` arm: metrics ARE accessible.
  if (row.computation_status === "complete") {
    // Should compile — no @ts-expect-error.
    void row.total_return_twr;
    void row.portfolio_sharpe;
    void row.attribution_breakdown;
  }

  // `pending` arm: NO metrics on the row. Accessing them must be a TS error.
  if (row.computation_status === "pending") {
    // @ts-expect-error - total_return_twr does not exist on the `pending` arm
    void row.total_return_twr;
    // @ts-expect-error - portfolio_sharpe does not exist on the `pending` arm
    void row.portfolio_sharpe;
  }

  // `computing` arm: same as pending — analytics not yet written.
  if (row.computation_status === "computing") {
    // @ts-expect-error - total_return_twr does not exist on the `computing` arm
    void row.total_return_twr;
  }

  // `failed` arm: error message IS present; metrics are NOT.
  if (row.computation_status === "failed") {
    // Should compile — error string is on the failed arm.
    void row.computation_error;
    // @ts-expect-error - portfolio_sharpe does not exist on the `failed` arm
    void row.portfolio_sharpe;
    // @ts-expect-error - total_return_twr does not exist on the `failed` arm
    void row.total_return_twr;
  }

  // ---------- H-1022: StrategyIdx legal-index narrowing ---------------------

  // Valid indices: 0..7 for the current 8-entry tuple.
  const _validIdxZero: StrategyIdx = 0;
  const _validIdxSeven: StrategyIdx = 7;
  void _validIdxZero;
  void _validIdxSeven;

  // `STRATEGY_UUIDS.length` is the tuple length literal (8). The
  // `Exclude<Partial<typeof T>["length"], typeof T["length"]>` shape removes
  // it, so the length value is OUT of bounds for the index union.
  // @ts-expect-error - STRATEGY_UUIDS.length (8) is the count, not a legal index
  const _invalidIdxLen: StrategyIdx = STRATEGY_UUIDS.length;
  void _invalidIdxLen;

  // Hard-coded out-of-bounds literal — `99` is not in the 0..7 union.
  // @ts-expect-error - 99 is not a legal index into STRATEGY_UUIDS
  const _invalidIdxHardcoded: StrategyIdx = 99;
  void _invalidIdxHardcoded;
}
// Reference _typeAssertions so it's not stripped as dead code by any
// future TS config that flags unused top-level functions.
void _typeAssertions;

// ---------- Runtime smoke check ---------------------------------------------

describe("seed-demo-data type exports (H-1021 / H-1022)", () => {
  it("STRATEGY_UUIDS is an 8-entry tuple at runtime (matches type-level pins above)", () => {
    expect(STRATEGY_UUIDS).toHaveLength(8);
  });
});
