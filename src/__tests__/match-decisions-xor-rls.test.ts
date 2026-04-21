/**
 * Live-DB integration test — Migration 072 match_decisions XOR CHECK +
 * bridge_outcomes widened UNIQUE (finding f4).
 *
 * Verifies:
 *   XOR CHECK (match_decisions_original_xor):
 *   1. Rejects INSERT with BOTH original_strategy_id AND original_holding_ref set (23514)
 *   2. Rejects INSERT with NEITHER set (23514)
 *   3. Accepts INSERT with ONLY original_strategy_id (legacy path)
 *   4. Accepts INSERT with ONLY original_holding_ref = 'holding:binance:BTC:spot' (Phase 09)
 *   5. Admin client can SELECT match_decisions with new original_holding_ref column
 *
 *   bridge_outcomes widened UNIQUE (bridge_outcomes_unique_per_strategy_holding):
 *   6. Two different holdings (same allocator+strategy) BOTH succeed
 *   7. Same (allocator+strategy+holding_ref) second INSERT fails with 23505
 *   8. Strategy-sourced rows preserve the (allocator+strategy) 1-per-pair guarantee
 *      via COALESCE('') — second strategy-only row still rejected with 23505
 *
 * Pattern E from 09-PATTERNS.md: admin client for all inserts (match_decisions
 * has admin + service_role RLS only; no allocator-self-write policy).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully when absent.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/match-decisions-xor-rls.test.ts
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
const STRATEGY_XOR_A = "00000000-0000-0000-0000-000000000720";
const STRATEGY_XOR_B = "00000000-0000-0000-0000-000000000721";

describe("match_decisions XOR CHECK + bridge_outcomes widened UNIQUE (live-DB)", () => {
  advertiseLiveDbSkipReason("match-decisions-xor-rls");

  let admin: SupabaseClient;
  let allocatorId: string;

  // Track all created IDs for cleanup
  const createdMatchDecisionIds: string[] = [];
  const createdBridgeOutcomeIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    allocatorId = await createTestUser(admin, "phase9-xor-test@test.local");

    // Seed minimal strategy rows for FK (strategies requires user_id NOT NULL)
    const stratUpsert = await admin.from("strategies").upsert(
      [
        {
          id: STRATEGY_XOR_A,
          user_id: allocatorId,
          name: "Phase9 XOR Test Strategy A (synthetic)",
        },
        {
          id: STRATEGY_XOR_B,
          user_id: allocatorId,
          name: "Phase9 XOR Test Strategy B (synthetic)",
        },
      ],
      { onConflict: "id" },
    );
    if (stratUpsert.error) {
      throw new Error(
        `Failed to seed strategies: ${stratUpsert.error.message}`,
      );
    }

    // Seed minimal strategy_analytics for both (bridge_outcomes FK requires it)
    for (const stratId of [STRATEGY_XOR_A, STRATEGY_XOR_B]) {
      await admin
        .from("strategy_analytics")
        .upsert({ strategy_id: stratId, returns_series: [] }, { onConflict: "strategy_id" });
    }
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;

    // Delete in dependency order: bridge_outcomes → match_decisions → strategies → user
    for (const id of createdBridgeOutcomeIds) {
      await admin.from("bridge_outcomes").delete().eq("id", id);
    }
    for (const id of createdMatchDecisionIds) {
      await admin.from("match_decisions").delete().eq("id", id);
    }
    await admin.from("strategy_analytics").delete().eq("strategy_id", STRATEGY_XOR_A);
    await admin.from("strategy_analytics").delete().eq("strategy_id", STRATEGY_XOR_B);
    await admin.from("strategies").delete().eq("id", STRATEGY_XOR_A);
    await admin.from("strategies").delete().eq("id", STRATEGY_XOR_B);
    await admin.auth.admin.deleteUser(allocatorId);
  });

  // ---------------------------------------------------------------------------
  // XOR CHECK tests (5 cases)
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT with BOTH original_strategy_id AND original_holding_ref set (SQLSTATE 23514)",
    async () => {
      const { error } = await admin.from("match_decisions").insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_XOR_A,
        decision: "sent_as_intro",
        decided_by: allocatorId,
        original_strategy_id: STRATEGY_XOR_A,
        original_holding_ref: "holding:binance:BTC:spot",
      });

      expect(error).not.toBeNull();
      // SQLSTATE 23514 = check_violation; Supabase surfaces as code '23514'
      // or the constraint name appears in the message
      expect(
        error?.code === "23514" ||
          error?.message?.includes("match_decisions_original_xor"),
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT with NEITHER original_strategy_id NOR original_holding_ref set (SQLSTATE 23514)",
    async () => {
      // Both NULL → XOR evaluates: FALSE <> FALSE = FALSE → check fails
      const { error } = await admin.from("match_decisions").insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_XOR_A,
        decision: "thumbs_up",
        decided_by: allocatorId,
        original_strategy_id: null,
        original_holding_ref: null,
      });

      expect(error).not.toBeNull();
      expect(
        error?.code === "23514" ||
          error?.message?.includes("match_decisions_original_xor"),
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "accepts INSERT with ONLY original_strategy_id set (legacy path)",
    async () => {
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          original_strategy_id: STRATEGY_XOR_A,
          original_holding_ref: null,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data?.id) createdMatchDecisionIds.push(data.id as string);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "accepts INSERT with ONLY original_holding_ref = 'holding:binance:BTC:spot' set (Phase 09 path)",
    async () => {
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:BTC:spot",
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      if (data?.id) createdMatchDecisionIds.push(data.id as string);

      // Verify the column value round-trips correctly
      const { data: row } = await admin
        .from("match_decisions")
        .select("original_holding_ref, original_strategy_id")
        .eq("id", data!.id)
        .single();
      expect(row?.original_holding_ref).toBe("holding:binance:BTC:spot");
      expect(row?.original_strategy_id).toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "admin client can SELECT match_decisions rows; original_holding_ref column is visible",
    async () => {
      const { data, error } = await admin
        .from("match_decisions")
        .select("id, original_holding_ref, original_strategy_id")
        .eq("allocator_id", allocatorId)
        .not("original_holding_ref", "is", null);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      // At least the holding-only row from the test above
      expect(data!.length).toBeGreaterThanOrEqual(1);
      expect(data!.every((r) => r.original_holding_ref !== null)).toBe(true);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // bridge_outcomes widened UNIQUE tests (3 cases)
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes widened UNIQUE: two different holdings (same allocator+strategy) BOTH succeed",
    async () => {
      // Create two holding-sourced match_decisions sharing the same strategy_id
      // but with DIFFERENT original_holding_ref values
      const { data: mdA, error: errA } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:BTC:spot",
        })
        .select("id")
        .single();
      expect(errA).toBeNull();
      if (mdA?.id) createdMatchDecisionIds.push(mdA.id as string);

      const { data: mdB, error: errB } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:ETH:spot",
        })
        .select("id")
        .single();
      expect(errB).toBeNull();
      if (mdB?.id) createdMatchDecisionIds.push(mdB.id as string);

      // Insert bridge_outcomes for each holding — both should succeed
      const today = new Date().toISOString().slice(0, 10);

      const { data: boA, error: boErrA } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          match_decision_id: mdA!.id,
          kind: "allocated",
          percent_allocated: 10,
          allocated_at: today,
        })
        .select("id, original_holding_ref")
        .single();
      expect(boErrA).toBeNull();
      expect(boA?.id).toBeTruthy();
      // Trigger should have populated the denormalized column
      expect(boA?.original_holding_ref).toBe("holding:binance:BTC:spot");
      if (boA?.id) createdBridgeOutcomeIds.push(boA.id as string);

      const { data: boB, error: boErrB } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          match_decision_id: mdB!.id,
          kind: "allocated",
          percent_allocated: 5,
          allocated_at: today,
        })
        .select("id, original_holding_ref")
        .single();
      expect(boErrB).toBeNull();
      expect(boB?.id).toBeTruthy();
      expect(boB?.original_holding_ref).toBe("holding:binance:ETH:spot");
      if (boB?.id) createdBridgeOutcomeIds.push(boB.id as string);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes widened UNIQUE: same (allocator+strategy+holding_ref) second INSERT fails with 23505",
    async () => {
      // Create one holding-sourced match_decision for holding:okx:SOL:spot
      const { data: md1, error: errMd1 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:okx:SOL:spot",
        })
        .select("id")
        .single();
      expect(errMd1).toBeNull();
      if (md1?.id) createdMatchDecisionIds.push(md1.id as string);

      const today = new Date().toISOString().slice(0, 10);

      // First bridge_outcomes insert — should succeed
      const { data: bo1, error: boErr1 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          match_decision_id: md1!.id,
          kind: "allocated",
          percent_allocated: 15,
          allocated_at: today,
        })
        .select("id")
        .single();
      expect(boErr1).toBeNull();
      if (bo1?.id) createdBridgeOutcomeIds.push(bo1.id as string);

      // Second insert with the same (allocator, strategy, holding_ref) via another
      // match_decision that also points to holding:okx:SOL:spot
      const { data: md2, error: errMd2 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:okx:SOL:spot",
        })
        .select("id")
        .single();
      expect(errMd2).toBeNull();
      if (md2?.id) createdMatchDecisionIds.push(md2.id as string);

      // This second bridge_outcomes insert should fail: same (allocator, strategy,
      // COALESCE(original_holding_ref, '')) triple → 23505
      const { error: boErr2 } = await admin.from("bridge_outcomes").insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_XOR_A,
        match_decision_id: md2!.id,
        kind: "allocated",
        percent_allocated: 20,
        allocated_at: today,
      });

      expect(boErr2).not.toBeNull();
      expect(
        boErr2?.code === "23505" ||
          boErr2?.message?.includes(
            "bridge_outcomes_unique_per_strategy_holding",
          ),
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes widened UNIQUE: strategy-sourced rows preserve (allocator+strategy) 1-per-pair guarantee via COALESCE('')",
    async () => {
      // Two strategy-sourced match_decisions with same (allocator, strategy)
      const { data: mdS1 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: STRATEGY_XOR_B,
          original_holding_ref: null,
        })
        .select("id")
        .single();
      if (mdS1?.id) createdMatchDecisionIds.push(mdS1.id as string);

      const today = new Date().toISOString().slice(0, 10);

      // First strategy-sourced bridge_outcomes row → triggers populate NULL
      // → COALESCE(NULL, '') = '' → unique slot (allocator, strategy, '')
      const { data: boS1, error: boErrS1 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          match_decision_id: mdS1!.id,
          kind: "rejected",
          rejection_reason: "mandate_conflict",
        })
        .select("id, original_holding_ref")
        .single();
      expect(boErrS1).toBeNull();
      // Strategy-sourced row: trigger sees original_holding_ref IS NULL on match_decision
      expect(boS1?.original_holding_ref).toBeNull();
      if (boS1?.id) createdBridgeOutcomeIds.push(boS1.id as string);

      // Second strategy-sourced match_decision for same (allocator, strategy)
      const { data: mdS2 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: STRATEGY_XOR_B,
          original_holding_ref: null,
        })
        .select("id")
        .single();
      if (mdS2?.id) createdMatchDecisionIds.push(mdS2.id as string);

      // Second bridge_outcomes row with same strategy, no holding_ref
      // → COALESCE(NULL, '') = '' → collides with first → 23505
      const { error: boErrS2 } = await admin.from("bridge_outcomes").insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_XOR_B,
        match_decision_id: mdS2!.id,
        kind: "rejected",
        rejection_reason: "timing_wrong",
      });

      expect(boErrS2).not.toBeNull();
      expect(
        boErrS2?.code === "23505" ||
          boErrS2?.message?.includes(
            "bridge_outcomes_unique_per_strategy_holding",
          ),
      ).toBe(true);
    },
    30_000,
  );
});
