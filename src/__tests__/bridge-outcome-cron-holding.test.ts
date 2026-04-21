/**
 * Live-DB integration test — Migration 073 compute_bridge_outcome_deltas holding branch.
 *
 * Verifies:
 *   1. holding-sourced outcome populates delta_30d/90d/180d from
 *      allocator_equity_snapshots.breakdown series
 *   2. holding-sourced outcome with missing value_at(allocated_at + N) leaves
 *      that delta as NULL (CASE guard)
 *   3. strategy-sourced outcome still populates deltas (regression check on
 *      existing migration 060 path — post-f3 LEFT JOIN retains processing)
 *   4. legacy bridge_outcomes with match_decision_id=NULL (kind='allocated')
 *      still populated by the LEFT-JOIN strategy branch (finding f3)
 *
 * Fixture math for holding branch tests:
 *   allocated_at = ANCHOR_DATE (2026-01-01)
 *   breakdown[symbol] on date = value_usd (flat integer per day)
 *   value_at(anchor)      = 100
 *   value_at(anchor + 30) = 110 → expected delta_30d  = (110/100) - 1 = 0.10
 *   value_at(anchor + 90) = 115 → expected delta_90d  = (115/100) - 1 = 0.15
 *   value_at(anchor + 180)= 120 → expected delta_180d = (120/100) - 1 = 0.20
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully when absent.
 *
 * Run locally:
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

// Anchor date for all test fixtures
const ANCHOR_DATE = "2026-01-01";

/**
 * Add N days to a YYYY-MM-DD date string.
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build allocator_equity_snapshots rows with breakdown containing a single
 * symbol so extract_symbol_value_at can read exact values.
 *
 * Seeded dates: anchor, anchor+30, anchor+90, anchor+180
 * Values for "BTC": 100, 110, 115, 120
 *
 * delta_30d  = (110/100) - 1 = 0.10
 * delta_90d  = (115/100) - 1 = 0.15
 * delta_180d = (120/100) - 1 = 0.20
 */
function buildBreakdownSnapshots(allocatorId: string) {
  return [
    {
      allocator_id: allocatorId,
      asof: ANCHOR_DATE,
      value_usd: 100,
      breakdown: { BTC: 100 },
      source: "exchange_primary",
    },
    {
      allocator_id: allocatorId,
      asof: addDays(ANCHOR_DATE, 30),
      value_usd: 110,
      breakdown: { BTC: 110 },
      source: "exchange_primary",
    },
    {
      allocator_id: allocatorId,
      asof: addDays(ANCHOR_DATE, 90),
      value_usd: 115,
      breakdown: { BTC: 115 },
      source: "exchange_primary",
    },
    {
      allocator_id: allocatorId,
      asof: addDays(ANCHOR_DATE, 180),
      value_usd: 120,
      breakdown: { BTC: 120 },
      source: "exchange_primary",
    },
  ];
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
    // STRATEGY_HOLDING_TEST: empty series (holding branch uses breakdown, not returns_series)
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

    // Cleanup in dependency order: bridge_outcomes → match_decisions → equity_snapshots → strategy_analytics → strategies → user
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
      .from("allocator_equity_snapshots")
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
  // Test 1: holding-sourced outcome → delta_30d/90d/180d from breakdown series
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "holding-sourced outcome populates delta_30d/90d/180d from breakdown series",
    async () => {
      // Arrange: insert equity snapshots with per-symbol breakdown
      const snapshots = buildBreakdownSnapshots(allocatorId);
      const { error: snapErr } = await admin
        .from("allocator_equity_snapshots")
        .upsert(snapshots, { onConflict: "allocator_id,asof" });
      expect(snapErr).toBeNull();

      // Arrange: insert holding-sourced match_decision
      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_HOLDING_TEST,
          decision: "thumbs_up",
          decided_by: allocatorId,
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

      // Assert: delta columns populated from breakdown series
      const { data: row, error: rowErr } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d, deltas_computed_at")
        .eq("id", bo!.id)
        .single();
      expect(rowErr).toBeNull();
      expect(row?.delta_30d).not.toBeNull();
      expect(row?.delta_90d).not.toBeNull();
      expect(row?.delta_180d).not.toBeNull();
      // (110/100) - 1 = 0.10
      expect(Number(row?.delta_30d)).toBeCloseTo(0.10, 4);
      // (115/100) - 1 = 0.15
      expect(Number(row?.delta_90d)).toBeCloseTo(0.15, 4);
      // (120/100) - 1 = 0.20
      expect(Number(row?.delta_180d)).toBeCloseTo(0.20, 4);
      expect(row?.deltas_computed_at).not.toBeNull();
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // Test 2: missing value for a window leaves that delta as NULL
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "holding-sourced outcome with missing value_at(allocated_at + N) leaves that delta as NULL",
    async () => {
      // Use a recent past date (ANCHOR_DATE + 10 = 2026-01-11) within the
      // bridge_outcomes_allocated_at_check window (CURRENT_DATE - 365..CURRENT_DATE).
      // The breakdown snapshots at this date+30/+90/+180 are NOT seeded, so
      // extract_symbol_value_at will return NULL for those windows → deltas stay NULL.
      const recentAnchor = addDays(ANCHOR_DATE, 10);

      // Seed only the anchor snapshot (no +30/+90/+180 rows)
      const { error: snapErr } = await admin
        .from("allocator_equity_snapshots")
        .upsert(
          [
            {
              allocator_id: allocatorId,
              asof: recentAnchor,
              value_usd: 200,
              breakdown: { ETH: 200 },
              source: "exchange_primary",
            },
          ],
          { onConflict: "allocator_id,asof" },
        );
      expect(snapErr).toBeNull();

      // Holding-sourced match_decision for ETH (different holding_ref from Test 1's BTC)
      const { data: md2, error: mdErr2 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_HOLDING_TEST,
          decision: "thumbs_down",
          decided_by: allocatorId,
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
          allocated_at: recentAnchor,
          needs_recompute: false,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr2).toBeNull();
      if (bo2?.id) createdBridgeOutcomeIds.push(bo2.id as string);

      // Act
      await admin.rpc("compute_bridge_outcome_deltas");

      // Assert: deltas remain NULL because no +30/+90/+180 snapshots exist
      const { data: row2 } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d")
        .eq("id", bo2!.id)
        .single();
      expect(row2?.delta_30d).toBeNull();
      expect(row2?.delta_90d).toBeNull();
      expect(row2?.delta_180d).toBeNull();
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
      const { data: md3, error: mdErr3 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_LEGACY_NULL,
          decision: "sent_as_intro",
          decided_by: allocatorId,
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
      // (NOT from breakdown — this is the strategy branch, not the holding branch)
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
