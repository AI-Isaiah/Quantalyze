import { describe, expect, it, vi } from "vitest";

// `route.ts` transitively imports `server-only`, which throws when loaded
// in a client-side test environment. The other route.test.ts files mock
// the module to a no-op for exactly this reason.
vi.mock("server-only", () => ({}));

import { CommitDiffSchema } from "./route";

// ---------------------------------------------------------------------------
// audit-2026-05-07 B9 (NEW-C18-02 / NEW-C18-03) — percent_allocated parity.
//
// Three encodings of the same field MUST agree on the canonical range
// [0, 100] (percent-as-integer):
//
//   1. Route-side Zod   — `src/app/api/allocator/scenario/commit/route.ts`
//      (VoluntaryAddDiff / VoluntaryModifyDiff / BridgeRecommendedDiff).
//
//   2. DB column CHECK  — `bridge_outcomes_percent_allocated_range_check`
//      installed by mig `20260514045553_commit_scenario_batch_hardening.sql`
//      (`CHECK (percent_allocated IS NULL OR (percent_allocated >= 0 AND
//      percent_allocated <= 100))`).
//
//   3. RPC validator    — `_validate_scenario_diff` rewritten by mig
//      `20260528183000_validate_scenario_diff_percent_range_fix.sql` from
//      the stale [0, 1] guard to [0, 100].
//
// NEW-C18-02 (LIVE BUG, fixed 2026-05-28): the original table-create
// migration `20260418060747_bridge_outcomes.sql` ALSO installed an inline
// `bridge_outcomes_percent_allocated_check` of [0.1, 50] that was never
// dropped. Postgres ANDs CHECKs, so the EFFECTIVE persistable range was the
// intersection [0.1, 50] — a normal 0%/60%/100% allocation passed Zod here
// and the validator but raised 23514 on insert, rolling back the whole
// single-tx batch. Migration `20260528223200_drop_stale_bridge_outcomes_
// percent_inline_check.sql` DROPs that stale inline check so the column now
// truly enforces only the canonical [0, 100]. THIS Zod test alone could
// never have caught the divergence (no DB in vitest), which is exactly why
// it went live — the authoritative DB-layer regression is that migration's
// verification DO block (asserts the inline check is gone) plus a post-apply
// MCP probe that percent_allocated=0/60/100 is now persistable.
//
//   4. Sibling writer  — `/api/bridge/outcome` (route.ts) writes the SAME
//      column. CL1 reconciled its stale `.max(50)` to the canonical
//      `.max(100)`; it keeps `.min(0.1)` as a deliberate per-endpoint rule
//      (an "allocated" outcome must be strictly positive — use kind='rejected'
//      otherwise), which is a STRICTER subset of the column range, not drift.
//      That route's own test (bridge/outcome/route.test.ts) pins 60/100/>100.
//
// This file pins the scenario-commit Zod range. The migration's verification
// DO block pins the validator range AND the dropped-inline-check state. The
// column CHECK is enforced by Postgres. The bridge/outcome writer is pinned
// in its own suite. Together they should NEVER drift on the UPPER bound (100)
// again. If a future PR widens scenario-commit Zod beyond 100, this test
// fails BEFORE the request can 23514 on insert; if a PR narrows it below 100,
// the test still fails (parity violated even when "safer"), surfacing the
// divergence so it can be reconciled cleanly.
//
// Numeric anchors. We probe at the boundaries (0, 100) and just outside
// (-0.01, 100.01) per discriminated union arm.
// ---------------------------------------------------------------------------

// Valid v4 UUID — the route uses `z.string().uuid()` which the v3.x
// Zod release tightens to the RFC 9562 versioned grammar (third group
// starts with one of 1-8; variant bits 8/9/a/b). The previous
// all-1s fixture passed legacy `.uuid()` but fails the current build.
const STRAT_ID = "11111111-1111-4111-8111-111111111111";
// HOLDING_REF_RE = /^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:(spot|derivative)$/
const HOLDING = "holding:okx:BTC-USDT:spot";

describe("NEW-C18-02 / NEW-C18-03 — percent_allocated parity", () => {
  it("voluntary_add accepts 0 and 100, rejects outside [0, 100]", () => {
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_add",
        strategy_id: STRAT_ID,
        percent_allocated: 0,
        size_at_decision_usd: 0,
      }).success,
    ).toBe(true);
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_add",
        strategy_id: STRAT_ID,
        percent_allocated: 100,
        size_at_decision_usd: 50_000,
      }).success,
    ).toBe(true);
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_add",
        strategy_id: STRAT_ID,
        percent_allocated: -0.01,
        size_at_decision_usd: 1,
      }).success,
    ).toBe(false);
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_add",
        strategy_id: STRAT_ID,
        percent_allocated: 100.01,
        size_at_decision_usd: 1,
      }).success,
    ).toBe(false);
  });

  it("bridge_recommended accepts 0 and 100, rejects outside [0, 100]", () => {
    expect(
      CommitDiffSchema.safeParse({
        kind: "bridge_recommended",
        strategy_id: STRAT_ID,
        holding_ref: HOLDING,
        percent_allocated: 0,
        size_at_decision_usd: 0,
      }).success,
    ).toBe(true);
    expect(
      CommitDiffSchema.safeParse({
        kind: "bridge_recommended",
        strategy_id: STRAT_ID,
        holding_ref: HOLDING,
        percent_allocated: 100,
        size_at_decision_usd: 50_000,
      }).success,
    ).toBe(true);
    expect(
      CommitDiffSchema.safeParse({
        kind: "bridge_recommended",
        strategy_id: STRAT_ID,
        holding_ref: HOLDING,
        percent_allocated: 100.01,
        size_at_decision_usd: 1,
      }).success,
    ).toBe(false);
  });

  it("voluntary_modify percent_allocated is optional and respects [0, 100] when present", () => {
    // Optional: absent is OK (size_at_decision_usd is still required).
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_modify",
        holding_ref: HOLDING,
        size_at_decision_usd: 1_000,
      }).success,
    ).toBe(true);
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_modify",
        holding_ref: HOLDING,
        percent_allocated: 100,
        size_at_decision_usd: 1_000,
      }).success,
    ).toBe(true);
    expect(
      CommitDiffSchema.safeParse({
        kind: "voluntary_modify",
        holding_ref: HOLDING,
        percent_allocated: 200,
        size_at_decision_usd: 1_000,
      }).success,
    ).toBe(false);
  });
});
