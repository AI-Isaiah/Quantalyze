/**
 * Live-DB integration test — Migration 081 bridge_outcomes voluntary-kind relaxation
 * (Phase 10 / SCENARIO-07 — HIGH-1 verification).
 *
 * Verifies migration 081 shipped the relaxation that lets Plan 07's commit route
 * INSERT voluntary_remove + voluntary_add bridge_outcomes rows against the live
 * schema. Without 081, those INSERTs throw NOT NULL (strategy_id) / unique-index
 * (allocator_id, strategy_id, COALESCE(original_holding_ref, '')) / kind-aware
 * CHECK violations.
 *
 *   T_BO_STRATEGY_NULLABLE      : bridge_outcomes.strategy_id is_nullable = YES
 *   T_BO_OLD_UNIQUE_GONE        : bridge_outcomes_unique_per_strategy_holding gone
 *   T_BO_NEW_UNIQUE             : bridge_outcomes_allocator_match_decision_unique present
 *   T_BO_INSERT_VR              : voluntary_remove → bridge_outcomes(kind='rejected',
 *                                 strategy_id=NULL, match_decision_id=NEW) round-trips
 *   T_BO_INSERT_VA              : voluntary_add → bridge_outcomes(kind='allocated',
 *                                 strategy_id=NEW.strategy_id, match_decision_id=NEW)
 *                                 round-trips
 *   T_BO_REJECT_VR_BAD_CHECK    : kind='allocated' with strategy_id=NULL AND
 *                                 match_decision_id=NULL is rejected
 *   T_BO_DOUBLE_INSERT_BLOCKED  : two bridge_outcomes for same (allocator_id,
 *                                 match_decision_id) — second violates new unique
 *   T_BO_LIVE_ROUNDTRIP         : (H1 hard verification) build the EXACT shape Plan 07
 *                                 commit route emits for both voluntary kinds and
 *                                 prove they round-trip cleanly (INSERT, SELECT, assert)
 *
 * Pattern: admin client for all inserts (match_decisions has admin/service-role RLS only;
 * bridge_outcomes has owner-INSERT RLS but admin bypasses for fixture cleanliness).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully when absent.
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

const STRATEGY_PHASE10_BO = "00000000-0000-0000-0000-000000001081";

describe("migration 081 — bridge_outcomes voluntary-kind relaxation (live-DB)", () => {
  advertiseLiveDbSkipReason("bridge-outcomes-voluntary-schema");

  let admin: SupabaseClient;
  let allocatorId: string;
  const createdMatchDecisionIds: string[] = [];
  const createdBridgeOutcomeIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    allocatorId = await createTestUser(
      admin,
      `phase10-bo-voluntary-${Date.now()}@test.local`,
    );

    // Seed strategy + strategy_analytics for FK targets.
    const seed = await admin.from("strategies").upsert(
      [
        {
          id: STRATEGY_PHASE10_BO,
          user_id: allocatorId,
          name: "Phase10 BO Voluntary Test (synthetic)",
        },
      ],
      { onConflict: "id" },
    );
    if (seed.error) {
      throw new Error(`Failed to seed strategy: ${seed.error.message}`);
    }
    await admin
      .from("strategy_analytics")
      .upsert(
        { strategy_id: STRATEGY_PHASE10_BO, returns_series: [] },
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
      .eq("strategy_id", STRATEGY_PHASE10_BO);
    await admin.from("strategies").delete().eq("id", STRATEGY_PHASE10_BO);
    await admin.auth.admin.deleteUser(allocatorId);
  });

  // ---------------------------------------------------------------------------
  // T_BO_STRATEGY_NULLABLE — column is now nullable
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_BO_STRATEGY_NULLABLE: bridge_outcomes.strategy_id is_nullable = YES",
    async () => {
      const rows = await runIntrospectionSql<{ is_nullable: string }>(
        "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='bridge_outcomes' AND column_name='strategy_id'",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].is_nullable).toBe("YES");
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_OLD_UNIQUE_GONE — legacy index gone
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_BO_OLD_UNIQUE_GONE: bridge_outcomes_unique_per_strategy_holding index absent",
    async () => {
      const rows = await runIntrospectionSql<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='bridge_outcomes' AND indexname IN ('bridge_outcomes_unique_per_strategy', 'bridge_outcomes_unique_per_strategy_holding')",
      );
      expect(rows.length).toBe(0);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_NEW_UNIQUE — new constraint present
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_BO_NEW_UNIQUE: bridge_outcomes_allocator_match_decision_unique constraint present",
    async () => {
      const rows = await runIntrospectionSql<{ conname: string }>(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'public.bridge_outcomes'::regclass AND conname = 'bridge_outcomes_allocator_match_decision_unique'",
      );
      expect(rows.length).toBe(1);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_INSERT_VR — voluntary_remove round-trip
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_BO_INSERT_VR: voluntary_remove match_decision + bridge_outcomes(kind=rejected, strategy_id=NULL) round-trip",
    async () => {
      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: null,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:VR-INSERT:spot",
          kind: "voluntary_remove",
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
          strategy_id: null, // voluntary_remove — no replacement strategy
          kind: "rejected",
          rejection_reason: "underperforming_peers",
        })
        .select("id, kind, strategy_id, match_decision_id, rejection_reason")
        .single();
      expect(boErr).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = bo as any;
      expect(row?.kind).toBe("rejected");
      expect(row?.strategy_id).toBeNull();
      expect(row?.match_decision_id).toBe(md!.id);
      expect(row?.rejection_reason).toBe("underperforming_peers");
      if (row?.id) createdBridgeOutcomeIds.push(row.id as string);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_INSERT_VA — voluntary_add round-trip
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_BO_INSERT_VA: voluntary_add match_decision + bridge_outcomes(kind=allocated, strategy_id=NEW) round-trip",
    async () => {
      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_PHASE10_BO,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: null,
          kind: "voluntary_add",
        })
        .select("id, strategy_id")
        .single();
      expect(mdErr).toBeNull();
      if (md?.id) createdMatchDecisionIds.push(md.id as string);

      const today = new Date().toISOString().slice(0, 10);

      const { data: bo, error: boErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: md!.id,
          strategy_id: md!.strategy_id, // voluntary_add — strategy_id is the NEW strategy
          kind: "allocated",
          percent_allocated: 10,
          allocated_at: today,
        })
        .select("id, kind, strategy_id, match_decision_id, percent_allocated")
        .single();
      expect(boErr).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = bo as any;
      expect(row?.kind).toBe("allocated");
      expect(row?.strategy_id).toBe(STRATEGY_PHASE10_BO);
      expect(row?.match_decision_id).toBe(md!.id);
      expect(Number(row?.percent_allocated)).toBe(10);
      if (row?.id) createdBridgeOutcomeIds.push(row.id as string);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_REJECT_VR_BAD_CHECK — kind-aware CHECK rejects bad shape
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_BO_REJECT_VR_BAD_CHECK: kind=allocated with strategy_id=NULL AND match_decision_id=NULL is rejected by kind-aware CHECK",
    async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await admin.from("bridge_outcomes").insert({
        allocator_id: allocatorId,
        match_decision_id: null,
        strategy_id: null, // VIOLATES — needs one of strategy_id or match_decision_id
        kind: "allocated",
        percent_allocated: 5,
        allocated_at: today,
      });
      expect(error).not.toBeNull();
      expect(
        error?.code === "23514" ||
          error?.message?.includes("bridge_outcomes_kind_allocated"),
      ).toBe(true);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_DOUBLE_INSERT_BLOCKED — new (allocator_id, match_decision_id) unique
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_BO_DOUBLE_INSERT_BLOCKED: two bridge_outcomes for same (allocator_id, match_decision_id) → second is 23505",
    async () => {
      const { data: md, error: mdErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: null,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:okx:DOUBLE:spot",
          kind: "voluntary_remove",
        })
        .select("id")
        .single();
      expect(mdErr).toBeNull();
      if (md?.id) createdMatchDecisionIds.push(md.id as string);

      const first = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: md!.id,
          strategy_id: null,
          kind: "rejected",
          rejection_reason: "timing_wrong",
        })
        .select("id")
        .single();
      expect(first.error).toBeNull();
      if (first.data?.id)
        createdBridgeOutcomeIds.push(first.data.id as string);

      // Second INSERT — same (allocator_id, match_decision_id) → must violate
      // bridge_outcomes_allocator_match_decision_unique
      const second = await admin.from("bridge_outcomes").insert({
        allocator_id: allocatorId,
        match_decision_id: md!.id,
        strategy_id: null,
        kind: "rejected",
        rejection_reason: "mandate_conflict",
      });
      expect(second.error).not.toBeNull();
      expect(
        second.error?.code === "23505" ||
          second.error?.message?.includes(
            "bridge_outcomes_allocator_match_decision_unique",
          ),
      ).toBe(true);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // T_BO_LIVE_ROUNDTRIP — H1 hard verification
  //
  // Builds the EXACT shape Plan 07's POST /api/allocator/scenario/commit route
  // emits for both voluntary kinds and proves they round-trip cleanly.
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "T_BO_LIVE_ROUNDTRIP: (H1) Plan 07 voluntary_remove + voluntary_add commit shapes round-trip cleanly",
    async () => {
      const today = new Date().toISOString().slice(0, 10);

      // ----- voluntary_remove commit shape -----
      const { data: mdRemove } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: null,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:RT-VR:spot",
          kind: "voluntary_remove",
        })
        .select("id")
        .single();
      if (mdRemove?.id) createdMatchDecisionIds.push(mdRemove.id as string);

      const { data: boRemove, error: boRemoveErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: mdRemove!.id,
          strategy_id: null,
          kind: "rejected",
          rejection_reason: "underperforming_peers",
        })
        .select(
          "id, allocator_id, match_decision_id, strategy_id, kind, rejection_reason",
        )
        .single();
      expect(boRemoveErr).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const removeRow = boRemove as any;
      expect(removeRow?.allocator_id).toBe(allocatorId);
      expect(removeRow?.match_decision_id).toBe(mdRemove!.id);
      expect(removeRow?.strategy_id).toBeNull();
      expect(removeRow?.kind).toBe("rejected");
      expect(removeRow?.rejection_reason).toBe("underperforming_peers");
      if (removeRow?.id)
        createdBridgeOutcomeIds.push(removeRow.id as string);

      // ----- voluntary_add commit shape -----
      // Use a fresh strategy for voluntary_add so we don't collide with the
      // earlier T_BO_INSERT_VA test's (allocator_id, STRATEGY_PHASE10_BO,
      // decision='sent_as_intro') row via uniq_match_dec_sent_per_pair.
      // Also use decision='snoozed' which has no unique index across pairs.
      const FRESH_STRATEGY_VA =
        "00000000-0000-0000-0000-000000001084";
      const fStrat = await admin.from("strategies").upsert(
        [
          {
            id: FRESH_STRATEGY_VA,
            user_id: allocatorId,
            name: "Phase10 BO LIVE_ROUNDTRIP voluntary_add (synthetic)",
          },
        ],
        { onConflict: "id" },
      );
      expect(fStrat.error).toBeNull();
      await admin
        .from("strategy_analytics")
        .upsert(
          { strategy_id: FRESH_STRATEGY_VA, returns_series: [] },
          { onConflict: "strategy_id" },
        );

      const { data: mdAdd, error: mdAddErr } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: FRESH_STRATEGY_VA,
          decision: "snoozed",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: null,
          kind: "voluntary_add",
        })
        .select("id, strategy_id")
        .single();
      expect(mdAddErr).toBeNull();
      expect(mdAdd).not.toBeNull();
      if (mdAdd?.id) createdMatchDecisionIds.push(mdAdd.id as string);

      const { data: boAdd, error: boAddErr } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          match_decision_id: mdAdd!.id,
          strategy_id: mdAdd!.strategy_id,
          kind: "allocated",
          percent_allocated: 12.5,
          allocated_at: today,
        })
        .select(
          "id, allocator_id, match_decision_id, strategy_id, kind, percent_allocated, allocated_at",
        )
        .single();
      expect(boAddErr).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addRow = boAdd as any;
      expect(addRow?.allocator_id).toBe(allocatorId);
      expect(addRow?.match_decision_id).toBe(mdAdd!.id);
      expect(addRow?.strategy_id).toBe(FRESH_STRATEGY_VA);
      expect(addRow?.kind).toBe("allocated");
      expect(Number(addRow?.percent_allocated)).toBe(12.5);
      expect(addRow?.allocated_at).toBe(today);
      if (addRow?.id) createdBridgeOutcomeIds.push(addRow.id as string);

      // Cleanup the fresh strategy fixture inline (afterAll covers main only)
      // (note: bridge_outcomes + match_decisions for this strategy are tracked
      //  in createdBridgeOutcomeIds + createdMatchDecisionIds; afterAll deletes
      //  them first, then we can drop the strategy)
      // Defer the strategy cleanup to a tiny inline cleanup after assertions.
      // Use a separate after step via dynamic try/finally would be heavier than
      // just registering the IDs and letting afterAll handle dependency order.
      // The afterAll has no awareness of FRESH_STRATEGY_VA — add an inline
      // cleanup at the end of afterAll via a module-scoped tracker. Simpler:
      // delete here since assertions are done.
      // (actually leaves strategies row; cleanup below)
      // Inline cleanup is safe — bridge_outcomes for this strategy were
      // tracked above and afterAll deletes them; same for match_decisions.
      // We delete strategy_analytics + strategies here so afterAll can ignore.
      await admin
        .from("bridge_outcomes")
        .delete()
        .eq("id", addRow.id);
      await admin
        .from("match_decisions")
        .delete()
        .eq("id", mdAdd!.id);
      // Pop them from the tracker arrays so afterAll doesn't re-delete
      const boIdx = createdBridgeOutcomeIds.indexOf(addRow.id as string);
      if (boIdx >= 0) createdBridgeOutcomeIds.splice(boIdx, 1);
      const mdIdx = createdMatchDecisionIds.indexOf(mdAdd!.id as string);
      if (mdIdx >= 0) createdMatchDecisionIds.splice(mdIdx, 1);
      await admin
        .from("strategy_analytics")
        .delete()
        .eq("strategy_id", FRESH_STRATEGY_VA);
      await admin
        .from("strategies")
        .delete()
        .eq("id", FRESH_STRATEGY_VA);
    },
    30_000,
  );
});
