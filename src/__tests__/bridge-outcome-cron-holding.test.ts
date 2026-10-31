/**
 * Live-DB integration test: the holding branch of compute_bridge_outcome_deltas
 * measures the ACCOUNT's derived returns (Phase 176 LEGACYRETIRE, D-03 / D-05).
 *
 * Until Phase 176 the holding branch read the per-symbol `breakdown` of the legacy
 * allocator_equity_snapshots table (migration 073). Plan 176-02 re-based it on the
 * allocator's allocator_equity_derived row of kind equity_curve: the outcome is the
 * compounded flow-neutral daily returns over (allocated_at, allocated_at + N]. A day
 * with no returns entry is no change (the derived curve omits days under benign flags),
 * and a window the derived curve does not cover is NULL.
 *
 * Verifies:
 *   1. holding-sourced outcome populates delta_30d/90d/180d with the compounded
 *      derived returns of the account
 *   2. holding-sourced outcome whose derived returns miss a day inside a window is
 *      measured over the days that are present (the absent day is no change)
 *   3. strategy-sourced outcome still populates deltas (regression check on the
 *      existing migration 060 path, post-f3 LEFT JOIN retains processing)
 *   4. legacy bridge_outcomes with match_decision_id=NULL (kind='allocated')
 *      still populated by the LEFT-JOIN strategy branch (finding f3)
 *
 * Fixture math for the holding branch tests:
 *   anchor = allocated_at = today (UTC) minus 200 days
 *   derived returns[].r = 0.01 on every day anchor+1 .. anchor+180
 *   delta_N = 1.01^N - 1, computed in the test with Math.pow as the oracle
 *             (an independent invariant, not a copy of the SQL formula)
 *   the dollar curve in the payload is deliberately not what the outcome reads
 *
 * The dates are relative to the run day. bridge_outcomes_allocated_at_check admits an
 * allocated_at only inside [CURRENT_DATE - 365 days, CURRENT_DATE], so a fixed anchor
 * would fall out of the window and make every insert fail on a later calendar day.
 * Anchor + 180 is 20 days before today, so the whole window is in the past.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully when absent. A skip is a skip, never a pass: the CI
 * frontend-live-db-lane runs this file against a local stack private to its runner.
 *
 * Run locally (against a local stack only, never shared TEST or PROD):
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/bridge-outcome-cron-holding.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import type { SupabaseClient } from "@supabase/supabase-js";

// Stable synthetic UUIDs — test-only, deterministic for easier cleanup
const STRATEGY_HOLDING_TEST  = "00000000-0000-0000-0000-000000000730";
const STRATEGY_LEGACY_NULL   = "00000000-0000-0000-0000-000000000731";
// Separate strategy for Test 4 so it doesn't collide with Test 3's bridge_outcomes
// UNIQUE slot (allocator, strategy, COALESCE(original_holding_ref,'')='')).
const STRATEGY_LEGACY_NULL_2 = "00000000-0000-0000-0000-000000000732";

/**
 * Add N days to a YYYY-MM-DD date string.
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Anchor date for all test fixtures: 200 days before today (UTC), inside
// bridge_outcomes_allocated_at_check on every run day (see the header).
const ANCHOR_DATE = addDays(new Date().toISOString().slice(0, 10), -200);

// The constant daily return of the holding fixtures.
const DAILY_R = 0.01;

/** The oracle: N days compounding DAILY_R. */
function compounded(days: number): number {
  return Math.pow(1 + DAILY_R, days) - 1;
}

/** The compounded outcome must agree to 1e-9 (a numeric column, not a rounded one). */
function expectCompounded(actual: unknown, days: number): void {
  expect(actual).not.toBeNull();
  expect(Math.abs(Number(actual) - compounded(days))).toBeLessThan(1e-9);
}

/**
 * Build the allocator_equity_derived payload of kind equity_curve: payload version 2,
 * trustworthy, `returns` = one {date, r} entry for each of anchor+1 .. anchor+n except
 * the day offsets listed in `skip`, and a dollar `curve` that compounds the same r.
 */
function buildDerivedPayload(
  anchor: string,
  n: number,
  skip: number[] = [],
): Record<string, unknown> {
  const curve: Array<{ date: string; equity_usd: number }> = [
    { date: anchor, equity_usd: 1000 },
  ];
  const returns: Array<{ date: string; r: number }> = [];
  let equity = 1000;
  for (let i = 1; i <= n; i++) {
    equity *= 1 + DAILY_R;
    curve.push({ date: addDays(anchor, i), equity_usd: equity });
    if (!skip.includes(i)) {
      returns.push({ date: addDays(anchor, i), r: DAILY_R });
    }
  }
  return {
    version: 2,
    is_trustworthy: true,
    flags: [],
    degrade_reasons: [],
    curve,
    returns,
  };
}

/**
 * Build a minimal linear cumulative equity curve for strategy-branch tests.
 * Same shape as bridge-outcome-cron.test.ts (1.00 → 1.30 over 180d).
 */
function buildLinearEquityCurve(
  days: number,
): Array<{ date: string; value: number }> {
  const series: Array<{ date: string; value: number }> = [];
  const start = new Date(`${ANCHOR_DATE}T00:00:00Z`).getTime();
  for (let i = 0; i <= days; i++) {
    const d = new Date(start + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const v = 1.0 + (0.3 * i) / days;
    series.push({ date: d, value: Number(v.toFixed(6)) });
  }
  return series;
}

describe("bridge-outcome-cron-holding (live-DB)", () => {
  advertiseLiveDbSkipReason("bridge-outcome-cron-holding");

  let admin: SupabaseClient;
  let allocatorId: string;

  // IDs tracked for cleanup
  const createdMatchDecisionIds: string[] = [];
  const createdBridgeOutcomeIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    allocatorId = await createTestUser(
      admin,
      "phase9-cron-holding@test.local",
    );

    // Seed strategy rows (needed for bridge_outcomes.strategy_id FK)
    const stratUpsert = await admin.from("strategies").upsert(
      [
        {
          id: STRATEGY_HOLDING_TEST,
          user_id: allocatorId,
          name: "Phase9 Cron Holding Test (synthetic)",
        },
        {
          id: STRATEGY_LEGACY_NULL,
          user_id: allocatorId,
          name: "Phase9 Cron Legacy Null Test (synthetic)",
        },
        {
          id: STRATEGY_LEGACY_NULL_2,
          user_id: allocatorId,
          name: "Phase9 Cron Legacy Null Test 2 (synthetic)",
        },
      ],
      { onConflict: "id" },
    );
    if (stratUpsert.error) {
      throw new Error(
        `Failed to seed strategies: ${stratUpsert.error.message}`,
      );
    }

    // Seed strategy_analytics for all strategies
    // STRATEGY_HOLDING_TEST: empty series (holding branch reads the derived account curve, not returns_series)
    // STRATEGY_LEGACY_NULL / STRATEGY_LEGACY_NULL_2: linear curve (strategy branch)
    await admin.from("strategy_analytics").upsert(
      [
        {
          strategy_id: STRATEGY_HOLDING_TEST,
          returns_series: [],
        },
        {
          strategy_id: STRATEGY_LEGACY_NULL,
          returns_series: buildLinearEquityCurve(180),
        },
        {
          strategy_id: STRATEGY_LEGACY_NULL_2,
          returns_series: buildLinearEquityCurve(180),
        },
      ],
      { onConflict: "strategy_id" },
    );
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;

    // Cleanup in dependency order: bridge_outcomes → match_decisions → derived equity → strategy_analytics → strategies → user
    if (createdBridgeOutcomeIds.length > 0) {
      await admin
        .from("bridge_outcomes")
        .delete()
        .in("id", createdBridgeOutcomeIds);
    }
    if (createdMatchDecisionIds.length > 0) {
      await admin
        .from("match_decisions")
        .delete()
        .in("id", createdMatchDecisionIds);
    }
    await admin
      .from("allocator_equity_derived")
      .delete()
      .eq("allocator_id", allocatorId);
    await admin
      .from("strategy_analytics")
      .delete()
      .in("strategy_id", [STRATEGY_HOLDING_TEST, STRATEGY_LEGACY_NULL, STRATEGY_LEGACY_NULL_2]);
    await admin
      .from("strategies")
      .delete()
      .in("id", [STRATEGY_HOLDING_TEST, STRATEGY_LEGACY_NULL, STRATEGY_LEGACY_NULL_2]);
    await admin.auth.admin.deleteUser(allocatorId);
  });

  // ---------------------------------------------------------------------------
  // Test 1: holding-sourced outcome → delta_30d/90d/180d compounded from the
  // account's derived returns
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "holding-sourced outcome populates delta_30d/90d/180d from the compounded derived returns",
    async () => {
      // Arrange: the allocator's derived equity_curve row, a dense returns series
      // anchor+1 .. anchor+180 (no legacy snapshot row is written).
      const { error: derErr } = await admin
        .from("allocator_equity_derived")
        .upsert(
          {
            allocator_id: allocatorId,
            kind: "equity_curve",
            payload: buildDerivedPayload(ANCHOR_DATE, 180),
          },
          { onConflict: "allocator_id,kind" },
        );
      expect(derErr).toBeNull();

      // Arrange: insert holding-sourced match_decision
      // audit-2026-05-07 H-0960 (mig 20260516160600 drops the kind DEFAULT):
      // kind must be set explicitly. strategy_id NOT NULL + original_holding_ref
      // NOT NULL + original_strategy_id NULL is bridge_recommended XOR shape.
      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_HOLDING_TEST,
          decision: "thumbs_up",
          decided_by: allocatorId,
          kind: "bridge_recommended",
          original_strategy_id: null,
          original_holding_ref: "holding:binance:BTC:spot",
        })
        .select("id")
        .single();
      expect(mdErr).toBeNull();
      if (md?.id) createdMatchDecisionIds.push(md.id as string);

      // Arrange: insert bridge_outcomes with delta_30d=NULL, needs_recompute=FALSE
      const { data: bo, error: boErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_HOLDING_TEST,
          match_decision_id: md!.id,
          kind: "allocated",
          percent_allocated: 10,
          allocated_at: ANCHOR_DATE,
          needs_recompute: false,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr).toBeNull();
      if (bo?.id) createdBridgeOutcomeIds.push(bo.id as string);

      // Act: run the cron function
      const { error: cronErr } = await admin.rpc(
        "compute_bridge_outcome_deltas",
      );
      expect(cronErr).toBeNull();

      // Assert: 1.01^N - 1 for N = 30, 90, 180
      const { data: row, error: rowErr } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d, deltas_computed_at")
        .eq("id", bo!.id)
        .single();
      expect(rowErr).toBeNull();
      expectCompounded(row?.delta_30d, 30);
      expectCompounded(row?.delta_90d, 90);
      expectCompounded(row?.delta_180d, 180);
      expect(row?.deltas_computed_at).not.toBeNull();
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // Test 2: a missing day inside a window is no change; the windows are still measured
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "holding-sourced outcome whose derived returns miss anchor + 45 is measured over the days present (30 / 89 / 179 days)",
    async () => {
      // Replace the allocator's derived row with one that has no returns entry on
      // anchor + 45. Test 1's outcome is already computed (needs_recompute = false and
      // delta_30d set), so this replacement does not change it.
      const { error: derErr } = await admin
        .from("allocator_equity_derived")
        .upsert(
          {
            allocator_id: allocatorId,
            kind: "equity_curve",
            payload: buildDerivedPayload(ANCHOR_DATE, 180, [45]),
          },
          { onConflict: "allocator_id,kind" },
        );
      expect(derErr).toBeNull();

      // Holding-sourced match_decision for ETH (different holding_ref from Test 1's BTC,
      // so it takes its own bridge_outcomes UNIQUE slot).
      // audit-2026-05-07 H-0960: kind must be set explicitly post-160600.
      const { data: md2, error: mdErr2 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_HOLDING_TEST,
          decision: "thumbs_down",
          decided_by: allocatorId,
          kind: "bridge_recommended",
          original_strategy_id: null,
          original_holding_ref: "holding:binance:ETH:spot",
        })
        .select("id")
        .single();
      expect(mdErr2).toBeNull();
      if (md2?.id) createdMatchDecisionIds.push(md2.id as string);

      const { data: bo2, error: boErr2 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_HOLDING_TEST,
          match_decision_id: md2!.id,
          kind: "allocated",
          percent_allocated: 5,
          allocated_at: ANCHOR_DATE,
          needs_recompute: false,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr2).toBeNull();
      if (bo2?.id) createdBridgeOutcomeIds.push(bo2.id as string);

      // Act
      const { error: cronErr2 } = await admin.rpc(
        "compute_bridge_outcome_deltas",
      );
      expect(cronErr2).toBeNull();

      // Assert: day 45 has no returns entry, so it is no change. The 30-day window does not
      // contain it (30 compounded days); the 90 and 180 day windows do (89 and 179).
      const { data: row2, error: rowErr2 } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d")
        .eq("id", bo2!.id)
        .single();
      expect(rowErr2).toBeNull();
      expectCompounded(row2?.delta_30d, 30);
      expectCompounded(row2?.delta_90d, 89);
      expectCompounded(row2?.delta_180d, 179);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // Test 3: strategy-sourced outcome still processes via LEFT JOIN (regression)
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "strategy-sourced outcome still populates deltas (regression check on existing 060 path — post-f3 LEFT JOIN retains strategy-sourced processing)",
    async () => {
      // Insert strategy-sourced match_decision (original_strategy_id set)
      // audit-2026-05-07 H-0960: kind must be set explicitly post-160600.
      // strategy-sourced shape (original_strategy_id NOT NULL + original_holding_ref
      // NULL) is bridge_recommended XOR shape per mig 20260516160400.
      const { data: md3, error: mdErr3 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_LEGACY_NULL,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          kind: "bridge_recommended",
          original_strategy_id: STRATEGY_LEGACY_NULL,
          original_holding_ref: null,
        })
        .select("id")
        .single();
      expect(mdErr3).toBeNull();
      if (md3?.id) createdMatchDecisionIds.push(md3.id as string);

      // Insert bridge_outcomes with a strategy-sourced match_decision
      const { data: bo3, error: boErr3 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_LEGACY_NULL,
          match_decision_id: md3!.id,
          kind: "allocated",
          percent_allocated: 20,
          allocated_at: ANCHOR_DATE,
          needs_recompute: false,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr3).toBeNull();
      if (bo3?.id) createdBridgeOutcomeIds.push(bo3.id as string);

      // Act
      await admin.rpc("compute_bridge_outcome_deltas");

      // Assert: strategy branch still processes (LEFT JOIN doesn't break it)
      const { data: row3 } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d")
        .eq("id", bo3!.id)
        .single();
      // Linear curve 1.00→1.30: day30=0.05, day90=0.15, day180=0.30
      expect(row3?.delta_30d).not.toBeNull();
      expect(Number(row3?.delta_30d)).toBeCloseTo(0.05, 4);
      expect(Number(row3?.delta_90d)).toBeCloseTo(0.15, 4);
      expect(Number(row3?.delta_180d)).toBeCloseTo(0.30, 4);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // Test 4: legacy bridge_outcomes with match_decision_id=NULL (finding f3)
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "legacy bridge_outcomes with match_decision_id=NULL (kind='allocated') still populated by LEFT-JOIN strategy branch (finding f3)",
    async () => {
      // This test pins the regression that finding f3 prevents.
      // Migration 073's LEFT JOIN must include these rows; INNER JOIN would drop them.
      //
      // Fixture: bridge_outcomes row with match_decision_id=NULL, kind='allocated',
      // strategy_id pointing to a strategy with a real returns_series.
      // Uses STRATEGY_LEGACY_NULL_2 (not STRATEGY_LEGACY_NULL) to avoid colliding
      // with Test 3's bridge_outcomes UNIQUE slot (allocator, strategy, COALESCE(holding_ref,'')='').
      const { data: boLegacy, error: boLegacyErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_LEGACY_NULL_2,
          match_decision_id: null, // explicit NULL — simulates ON DELETE SET NULL or pre-link row
          kind: "allocated",
          percent_allocated: 25,
          allocated_at: ANCHOR_DATE,
          needs_recompute: false,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boLegacyErr).toBeNull();
      if (boLegacy?.id) createdBridgeOutcomeIds.push(boLegacy.id as string);

      // Act: run the cron
      const { error: cronErr } = await admin.rpc(
        "compute_bridge_outcome_deltas",
      );
      expect(cronErr).toBeNull();

      // Assert: delta_30d was populated from strategy_analytics.returns_series
      // (NOT from the derived account curve — this is the strategy branch, not the holding branch)
      const { data: rowLegacy } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d")
        .eq("id", boLegacy!.id)
        .single();
      expect(rowLegacy?.delta_30d).not.toBeNull();
      // Linear curve 1.00→1.30: day30 ≈ 0.05
      expect(Number(rowLegacy?.delta_30d)).toBeCloseTo(0.05, 4);
    },
    30_000,
  );
});
