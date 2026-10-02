/**
 * Live-DB integration test — Migration 072 match_decisions XOR CHECK +
 * the CURRENT bridge_outcomes uniqueness invariant (finding f4, then
 * migrations 081 and 083).
 *
 * Verifies:
 *   XOR CHECK (match_decisions_original_xor):
 *   1. Rejects INSERT with BOTH original_strategy_id AND original_holding_ref set (23514)
 *   2. Rejects INSERT with NEITHER set (23514)
 *   3. Accepts INSERT with ONLY original_strategy_id (legacy path)
 *   4. Accepts INSERT with ONLY original_holding_ref = 'holding:binance:BTC:spot' (Phase 09)
 *   5. Admin client can SELECT match_decisions with new original_holding_ref column
 *
 *   bridge_outcomes uniqueness (Phase 164.9.1, D-13 / D-14):
 *   6. Two different holdings (same allocator+strategy) BOTH succeed
 *   7. (b) A second outcome for the SAME match_decision_id fails with 23505 AND
 *      the error names bridge_outcomes_allocator_match_decision_unique
 *   8. (a) Two strategy-sourced outcomes for the same (allocator, strategy)
 *      under two DIFFERENT decisions BOTH succeed
 *   9. (c) Two outcomes with match_decision_id NULL and the same (allocator,
 *      strategy) — the second fails with 23505 AND the error names
 *      bridge_outcomes_legacy_per_strategy_holding_when_md_null
 *
 * THE WRITTEN ANSWER (D-13, recorded verbatim here, in the phase plan and in
 * migration 20260925071300_bridge_outcomes_invariant_comments.sql):
 *   the CURRENT bridge_outcomes uniqueness invariant is two-part —
 *   (i) bridge_outcomes_allocator_match_decision_unique
 *       UNIQUE (allocator_id, match_decision_id), one outcome per decision
 *       (migration 081);
 *   (ii) bridge_outcomes_legacy_per_strategy_holding_when_md_null, a PARTIAL
 *       unique on (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
 *       WHERE match_decision_id IS NULL (migration 083), restoring 072's
 *       per-strategy guarantee only for rows whose decision was nulled out.
 *   Two strategy-sourced outcomes for the same (allocator, strategy) under two
 *   DIFFERENT decisions are ALLOWED by design; the old arm's 23505 expectation
 *   described migration 072's world.
 *
 * AUTHORITY: these arms assert DOCUMENTED design, never "whatever the database
 * did". 081 = 20260426131719_bridge_outcomes_relax_for_voluntary.sql (drops
 * 072's index, adds the per-decision constraint); 083 =
 * 20260426131721_commit_scenario_batch_race_fix.sql (the md-NULL partial
 * index). HISTORY: until Phase 164.9.1 this file asserted 072's
 * bridge_outcomes_unique_per_strategy_holding index, which 081 dropped. Its
 * "1-per-pair" arm was RED on the live lane for that reason, and its other
 * 23505 arm passed only because it OR-ed the SQLSTATE check with the name
 * check, which made the retired-name check decorative. Every constraint
 * assertion below is now a CONJUNCTION: the SQLSTATE AND the constraint name,
 * as two expects.
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

describe("match_decisions XOR CHECK + bridge_outcomes uniqueness (live-DB)", () => {
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
      // audit-2026-05-07 H-0960: kind must be set explicitly (mig 20260516160600
      // dropped the DEFAULT). audit-2026-05-07 H-0956: the v2 XOR constraint
      // (mig 20260516160400) requires EXACTLY ONE of original_* set — both-set
      // is forbidden.
      const { error } = await admin.from("match_decisions").insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_XOR_A,
        decision: "sent_as_intro",
        decided_by: allocatorId,
        original_strategy_id: STRATEGY_XOR_A,
        original_holding_ref: "holding:binance:BTC:spot",
        kind: "bridge_recommended",
      });

      expect(error).not.toBeNull();
      // SQLSTATE 23514 = check_violation; the new constraint name is
      // match_decisions_kind_bridge_recommended_v2 (mig 160400). The substring
      // 'match_decisions_kind_bridge_recommended' matches both old and v2.
      expect(
        error?.code === "23514" ||
          error?.message?.includes("match_decisions_kind_bridge_recommended"),
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT with NEITHER original_strategy_id NOR original_holding_ref set (SQLSTATE 23514)",
    async () => {
      // audit-2026-05-07 H-0960: kind explicit. Both originals NULL violates
      // the bridge_recommended _v2 XOR (requires EXACTLY ONE of original_*).
      const { error } = await admin.from("match_decisions").insert({
        allocator_id: allocatorId,
        strategy_id: STRATEGY_XOR_A,
        decision: "thumbs_up",
        decided_by: allocatorId,
        original_strategy_id: null,
        original_holding_ref: null,
        kind: "bridge_recommended",
      });

      expect(error).not.toBeNull();
      expect(
        error?.code === "23514" ||
          error?.message?.includes("match_decisions_kind_bridge_recommended"),
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "accepts INSERT with ONLY original_strategy_id set (legacy path)",
    async () => {
      // audit-2026-05-07 H-0960: kind explicit. Exactly one of original_*
      // set satisfies the bridge_recommended _v2 XOR.
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "sent_as_intro",
          decided_by: allocatorId,
          original_strategy_id: STRATEGY_XOR_A,
          original_holding_ref: null,
          kind: "bridge_recommended",
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
      // audit-2026-05-07 H-0960: kind explicit. Exactly one of original_*
      // set satisfies the bridge_recommended _v2 XOR.
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:BTC:spot",
          kind: "bridge_recommended",
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
  // bridge_outcomes uniqueness tests (4 cases). The invariant and its authority
  // (migrations 081 and 083) are in the file header, D-13.
  // ---------------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes uniqueness: two different holdings (same allocator+strategy) BOTH succeed",
    async () => {
      // Create two holding-sourced match_decisions sharing the same strategy_id
      // but with DIFFERENT original_holding_ref values.
      // audit-2026-05-07 H-0960: kind set explicitly (mig 20260516160600
      // dropped the DEFAULT). bridge_recommended shape: strategy_id NOT NULL
      // + exactly one of original_* NOT NULL (original_holding_ref here).
      const { data: mdA, error: errA } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:binance:BTC:spot",
          kind: "bridge_recommended",
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
          kind: "bridge_recommended",
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
    "bridge_outcomes uniqueness (b): a second outcome for the SAME match_decision_id fails 23505 on bridge_outcomes_allocator_match_decision_unique",
    async () => {
      // Create one holding-sourced match_decision for holding:okx:SOL:spot.
      // audit-2026-05-07 H-0960: kind set explicitly (bridge_recommended).
      const { data: md1, error: errMd1 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: null,
          original_holding_ref: "holding:okx:SOL:spot",
          kind: "bridge_recommended",
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

      // Second bridge_outcomes insert re-using the SAME match_decision (md1).
      // One outcome per decision is migration 081's key, so the constraint
      // that fires is bridge_outcomes_allocator_match_decision_unique. The
      // md-NULL partial index cannot fire: match_decision_id is set.
      const { data: bo2, error: boErr2 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          match_decision_id: md1!.id,
          kind: "allocated",
          percent_allocated: 20,
          allocated_at: today,
        })
        .select("id")
        .single();
      // Track before asserting, so a wrongly-accepted row is still cleaned up.
      if (bo2?.id) createdBridgeOutcomeIds.push(bo2.id as string);

      expect(boErr2).not.toBeNull();
      expect(boErr2?.code).toBe("23505");
      expect(boErr2?.message).toContain(
        "bridge_outcomes_allocator_match_decision_unique",
      );
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes uniqueness (a): two strategy-sourced outcomes for the same (allocator, strategy) under two DIFFERENT decisions BOTH succeed",
    async () => {
      // Two strategy-sourced match_decisions with same (allocator, strategy),
      // different decision values. Migration 074 keys match_decisions per
      // decision value, so both decisions exist legitimately; migration 081
      // keys bridge_outcomes per decision, so each gets its own outcome.
      // audit-2026-05-07 H-0960: kind set explicitly (bridge_recommended:
      // strategy_id NOT NULL + exactly one of original_* NOT NULL, here
      // original_strategy_id).
      const { data: mdS1, error: errMdS1 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_down",
          decided_by: allocatorId,
          original_strategy_id: STRATEGY_XOR_B,
          original_holding_ref: null,
          kind: "bridge_recommended",
        })
        .select("id")
        .single();
      expect(errMdS1).toBeNull();
      if (mdS1?.id) createdMatchDecisionIds.push(mdS1.id as string);

      const { data: mdS2, error: errMdS2 } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          decision: "thumbs_up",
          decided_by: allocatorId,
          original_strategy_id: STRATEGY_XOR_B,
          original_holding_ref: null,
          kind: "bridge_recommended",
        })
        .select("id")
        .single();
      expect(errMdS2).toBeNull();
      if (mdS2?.id) createdMatchDecisionIds.push(mdS2.id as string);

      // First outcome: strategy-sourced, so the trigger copies a NULL holding.
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
      if (boS1?.id) createdBridgeOutcomeIds.push(boS1.id as string);
      expect(boErrS1).toBeNull();
      expect(boS1?.original_holding_ref).toBeNull();

      // Second outcome, same (allocator, strategy, NULL holding), DIFFERENT
      // decision. Under 072's retired index this collided; under 081's
      // per-decision key it is allowed by design (D-13).
      const { data: boS2, error: boErrS2 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_B,
          match_decision_id: mdS2!.id,
          kind: "rejected",
          rejection_reason: "timing_wrong",
        })
        .select("id, original_holding_ref")
        .single();
      if (boS2?.id) createdBridgeOutcomeIds.push(boS2.id as string);
      expect(boErrS2).toBeNull();
      expect(boS2?.original_holding_ref).toBeNull();

      // Both rows are really there: read them back by this arm's own ids.
      const { data: rows, error: readErr } = await admin
        .from("bridge_outcomes")
        .select("id, match_decision_id")
        .in("id", [boS1!.id, boS2!.id]);
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(2);
      expect(new Set(rows!.map((r) => r.match_decision_id))).toEqual(
        new Set([mdS1!.id, mdS2!.id]),
      );
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes uniqueness (c): two outcomes with match_decision_id NULL for the same (allocator, strategy) fail 23505 on bridge_outcomes_legacy_per_strategy_holding_when_md_null",
    async () => {
      // The md-NULL shape is what a row becomes when its decision is deleted
      // (ON DELETE SET NULL). The kind CHECKs require strategy_id when
      // match_decision_id is NULL, and the sync trigger writes a NULL holding
      // for these rows, so both rows land on the same
      // (allocator, strategy, COALESCE(NULL, '')) slot of migration 083's
      // partial index. STRATEGY_XOR_A carries no md-NULL row from any other arm.
      const { data: boN1, error: boErrN1 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          match_decision_id: null,
          kind: "rejected",
          rejection_reason: "other",
        })
        .select("id, original_holding_ref")
        .single();
      if (boN1?.id) createdBridgeOutcomeIds.push(boN1.id as string);
      expect(boErrN1).toBeNull();
      expect(boN1?.original_holding_ref).toBeNull();

      const { data: boN2, error: boErrN2 } = await admin
        .from("bridge_outcomes")
        .insert({
          allocator_id: allocatorId,
          strategy_id: STRATEGY_XOR_A,
          match_decision_id: null,
          kind: "rejected",
          rejection_reason: "timing_wrong",
        })
        .select("id")
        .single();
      // Track before asserting, so a wrongly-accepted row is still cleaned up.
      if (boN2?.id) createdBridgeOutcomeIds.push(boN2.id as string);

      expect(boErrN2).not.toBeNull();
      expect(boErrN2?.code).toBe("23505");
      expect(boErrN2?.message).toContain(
        "bridge_outcomes_legacy_per_strategy_holding_when_md_null",
      );
    },
    30_000,
  );
});
