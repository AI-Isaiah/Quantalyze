/**
 * Live-DB integration test — Migration 080 voluntary_add cron branch
 * (Phase 10 / SCENARIO-07 — H2 verification).
 *
 * Verifies migration 080 shipped a third CTE branch in
 * `compute_bridge_outcome_deltas()` matching `md.kind = 'voluntary_add'` so
 * browse-added strategies accrue delta_30d/90d/180d once
 * `strategy_analytics.returns_series` covers the allocated_at + N window.
 *
 * Without this branch, voluntary_add rows satisfy NEITHER existing branch
 * (both original_* are NULL — the holding branch needs original_holding_ref
 * and the strategy branch needs original_strategy_id) and would silently
 * never accrue deltas (RESEARCH Pitfall 5 — closes the "Bridge recommendations
 * actually worked" feedback loop for self-added strategies).
 *
 *   T_CRON_BRANCH_PRESENT      : pg_get_functiondef(compute_bridge_outcome_deltas)
 *                                contains 'voluntary_add_candidates'
 *   T_CRON_FIRES_FOR_VA        : SETUP — voluntary_add match_decision +
 *                                bridge_outcomes(allocated_at = today - 31d) +
 *                                strategy returns_series covering >180 days;
 *                                CALL compute_bridge_outcome_deltas();
 *                                ASSERT delta_30d NOT NULL
 *   T_CRON_LEAVES_NULL_FOR_FRESH: same fixture but allocated_at = yesterday;
 *                                  delta_30d remains NULL (no return-series window
 *                                  yet) — proves idempotency / no spurious fills
 *
 * Fixture math:
 *   anchor = today - 31d
 *   returns_series: { date: anchor + i, value: 1.0 + 0.30 * i / 200 } for i in [0, 200]
 *   At i=30: value = 1.0 + 0.045 → realized 30d delta = (1.045/1.0) - 1 = 0.045
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  createLiveAdminClient,
  createTestUser,
  runIntrospectionSql,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import type { SupabaseClient } from "@supabase/supabase-js";

const STRATEGY_VA_CRON = "00000000-0000-0000-0000-000000001082";

/** Add N days (positive or negative) to a YYYY-MM-DD date string. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build a linear cumulative equity curve: 1.00 → 1.30 over `days` days. */
function buildLinearReturns(
  startDate: string,
  days: number,
): Array<{ date: string; value: number }> {
  const series: Array<{ date: string; value: number }> = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(startDate, i);
    const v = 1.0 + (0.3 * i) / days;
    series.push({ date: d, value: Number(v.toFixed(6)) });
  }
  return series;
}

describe("migration 080 — voluntary_add cron branch (live-DB / H2)", () => {
  advertiseLiveDbSkipReason("bridge-outcome-cron-voluntary-add");

  let admin: SupabaseClient;
  let allocatorId: string;
  const createdMatchDecisionIds: string[] = [];
  const createdBridgeOutcomeIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    allocatorId = await createTestUser(
      admin,
      `phase10-cron-va-${Date.now()}@test.local`,
    );

    // Seed strategy + 200-day linear returns_series anchored 31 days ago so
    // T_CRON_FIRES_FOR_VA's allocated_at + 30d window has a value to read.
    const today = new Date().toISOString().slice(0, 10);
    const anchor = addDays(today, -31);

    const seedStrat = await admin.from("strategies").upsert(
      [
        {
          id: STRATEGY_VA_CRON,
          user_id: allocatorId,
          name: "Phase10 voluntary_add cron test (synthetic)",
        },
      ],
      { onConflict: "id" },
    );
    if (seedStrat.error) {
      throw new Error(`Failed to seed strategy: ${seedStrat.error.message}`);
    }

    const returns = buildLinearReturns(anchor, 200);
    await admin
      .from("strategy_analytics")
      .upsert(
        { strategy_id: STRATEGY_VA_CRON, returns_series: returns },
        { onConflict: "strategy_id" },
      );
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
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
      .from("strategy_analytics")
      .delete()
      .eq("strategy_id", STRATEGY_VA_CRON);
    await admin.from("strategies").delete().eq("id", STRATEGY_VA_CRON);
    await admin.auth.admin.deleteUser(allocatorId);
  });

  // ---------------------------------------------------------------------------
  // T_CRON_BRANCH_PRESENT — string-level proof the new branch landed in pg_proc
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_CRON_BRANCH_PRESENT: pg_get_functiondef(compute_bridge_outcome_deltas) contains 'voluntary_add_candidates'",
    async () => {
      const rows = await runIntrospectionSql<{ has_branch: boolean }>(
        "SELECT pg_get_functiondef(oid) LIKE '%voluntary_add_candidates%' AS has_branch FROM pg_proc WHERE proname = 'compute_bridge_outcome_deltas'",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].has_branch).toBe(true);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_CRON_FIRES_FOR_VA — branch fires and produces non-NULL delta_30d
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_CRON_FIRES_FOR_VA: voluntary_add row with allocated_at=today-31d gets delta_30d populated",
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const anchor = addDays(today, -31);

      // voluntary_add match_decision
      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_VA_CRON,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: null,
          kind: "voluntary_add",
        })
        .select("id")
        .single();
      expect(mdErr).toBeNull();
      if (md?.id) createdMatchDecisionIds.push(md.id as string);

      // bridge_outcomes(allocated, allocated_at=anchor)
      const { data: bo, error: boErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: md!.id,
          strategy_id: STRATEGY_VA_CRON,
          kind: "allocated",
          percent_allocated: 10,
          allocated_at: anchor,
          needs_recompute: true,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr).toBeNull();
      if (bo?.id) createdBridgeOutcomeIds.push(bo.id as string);

      // Run the cron
      const { error: cronErr } = await admin.rpc(
        "compute_bridge_outcome_deltas",
      );
      expect(cronErr).toBeNull();

      // Verify delta_30d populated by the new voluntary_add branch
      const { data: row } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, deltas_computed_at, needs_recompute")
        .eq("id", bo!.id)
        .single();
      expect(row?.delta_30d).not.toBeNull();
      // Linear curve: at i=30 days, value = 1.0 + 30 * 0.3 / 200 = 1.045 → delta=0.045
      expect(Number(row?.delta_30d)).toBeCloseTo(0.045, 3);
      expect(row?.deltas_computed_at).not.toBeNull();
      expect(row?.needs_recompute).toBe(false);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_CRON_LEAVES_NULL_FOR_FRESH — fresh allocated_at → delta stays NULL
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_CRON_LEAVES_NULL_FOR_FRESH: voluntary_add row with allocated_at=yesterday → delta_30d stays NULL (no spurious fills)",
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = addDays(today, -1);

      // A fresh strategy with an empty returns_series has no data for the +30d
      // window, so every delta must stay NULL — proving the cron writes no
      // spurious fills when the model has nothing to compute.

      const FRESH_STRATEGY = "00000000-0000-0000-0000-000000001083";
      await admin.from("strategies").upsert(
        [
          {
            id: FRESH_STRATEGY,
            user_id: allocatorId,
            name: "Phase10 voluntary_add fresh strategy (no returns)",
          },
        ],
        { onConflict: "id" },
      );
      await admin
        .from("strategy_analytics")
        .upsert(
          { strategy_id: FRESH_STRATEGY, returns_series: [] },
          { onConflict: "strategy_id" },
        );

      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: FRESH_STRATEGY,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: null,
          kind: "voluntary_add",
        })
        .select("id")
        .single();
      expect(mdErr).toBeNull();
      if (md?.id) createdMatchDecisionIds.push(md.id as string);

      const { data: bo, error: boErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: md!.id,
          strategy_id: FRESH_STRATEGY,
          kind: "allocated",
          percent_allocated: 5,
          allocated_at: yesterday,
          needs_recompute: true,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr).toBeNull();
      if (bo?.id) createdBridgeOutcomeIds.push(bo.id as string);

      await admin.rpc("compute_bridge_outcome_deltas");

      const { data: row } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d")
        .eq("id", bo!.id)
        .single();
      // No data in returns_series → extract_delta returns NULL → COALESCE keeps NULL
      expect(row?.delta_30d).toBeNull();
      expect(row?.delta_90d).toBeNull();
      expect(row?.delta_180d).toBeNull();

      // Cleanup the extra strategy fixture inline (afterAll covers the main one)
      await admin
        .from("strategy_analytics")
        .delete()
        .eq("strategy_id", FRESH_STRATEGY);
      await admin.from("strategies").delete().eq("id", FRESH_STRATEGY);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // H-0011 — T_CRON_WINDOW_NOT_COVERED: the genuinely-distinct "no return-series
  // window yet" case the docstring (lines 23-25) originally claimed.
  //
  // T_CRON_LEAVES_NULL_FOR_FRESH above proves "EMPTY series → NULL", which is a
  // DIFFERENT failure mode than "series exists but doesn't yet reach
  // allocated_at + 30d". extract_delta (migration 20260418074935 STEP 2) returns
  // NULL when EITHER endpoint is missing; this test pins the second endpoint
  // case specifically: the series HAS a value at allocated_at (so the cron's
  // first guard passes) but has NO value at allocated_at + 30d, so delta_30d
  // MUST stay NULL. Without this, a regression that populates delta_30d from a
  // partial series (e.g. interpolating, or falling back to the last point) when
  // the cron fires on a recent allocated_at would go uncaught — exactly the
  // "fresh allocated_at" regression class the original docstring guarded.
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_CRON_WINDOW_NOT_COVERED: voluntary_add row whose series covers allocated_at but NOT allocated_at+30d → delta_30d stays NULL (distinct from empty-series)",
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Anchor 10 days ago so allocated_at IS in the series but allocated_at+30d
      // (today + 20) is BEYOND the 10-day series → second endpoint absent.
      const anchor = addDays(today, -10);

      const PARTIAL_STRATEGY = "00000000-0000-0000-0000-000000001084";
      await admin.from("strategies").upsert(
        [
          {
            id: PARTIAL_STRATEGY,
            user_id: allocatorId,
            name: "Phase10 voluntary_add partial-window strategy",
          },
        ],
        { onConflict: "id" },
      );
      // Non-empty series of 11 points (anchor .. anchor+10). Contains a value
      // AT the anchor (cron's first guard passes) but nothing at anchor+30.
      const partialSeries = buildLinearReturns(anchor, 10);
      await admin
        .from("strategy_analytics")
        .upsert(
          { strategy_id: PARTIAL_STRATEGY, returns_series: partialSeries },
          { onConflict: "strategy_id" },
        );

      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: PARTIAL_STRATEGY,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: null,
          kind: "voluntary_add",
        })
        .select("id")
        .single();
      expect(mdErr).toBeNull();
      if (md?.id) createdMatchDecisionIds.push(md.id as string);

      const { data: bo, error: boErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: md!.id,
          strategy_id: PARTIAL_STRATEGY,
          kind: "allocated",
          percent_allocated: 7,
          allocated_at: anchor,
          needs_recompute: true,
          delta_30d: null,
        })
        .select("id")
        .single();
      expect(boErr).toBeNull();
      if (bo?.id) createdBridgeOutcomeIds.push(bo.id as string);

      await admin.rpc("compute_bridge_outcome_deltas");

      const { data: row } = await admin
        .from("bridge_outcomes")
        .select("delta_30d, delta_90d, delta_180d")
        .eq("id", bo!.id)
        .single();
      // anchor present, anchor+30/90/180 absent → extract_delta returns NULL
      // for all windows → COALESCE keeps NULL. Proves "partial-window, not
      // empty-series" leaves deltas unfilled.
      expect(row?.delta_30d).toBeNull();
      expect(row?.delta_90d).toBeNull();
      expect(row?.delta_180d).toBeNull();

      await admin
        .from("strategy_analytics")
        .delete()
        .eq("strategy_id", PARTIAL_STRATEGY);
      await admin.from("strategies").delete().eq("id", PARTIAL_STRATEGY);
    },
    30_000,
  );
});
