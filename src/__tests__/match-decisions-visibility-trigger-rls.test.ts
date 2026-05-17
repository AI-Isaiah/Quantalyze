/**
 * Live-DB integration test — match_decisions BEFORE INSERT visibility trigger.
 *
 * PR #182 introduced a BEFORE INSERT trigger on `match_decisions` that gates
 * voluntary_add / bridge_recommended INSERTs with a non-NULL strategy_id on
 * `_assert_strategy_visible_to_allocator(strategy_id, allocator_id)`. The
 * rls-policy-auditor retroactive audit (Task #57) flagged a TEST GAP:
 *   src/__tests__/match-decisions-xor-rls.test.ts covers the new `kind`
 *   NOT-NULL contract but has zero regression coverage for the visibility-
 *   trigger leak scopes.
 *
 * This file closes that gap. The scopes covered:
 *   1. CROSS-ORG ALLOCATOR INSERT must 42501 — proves the trigger fires and
 *      raises insufficient_privilege when the allocator is NOT in the
 *      strategy's owning organization.
 *   2. IN-ORG ALLOCATOR INSERT must succeed — proves the helper returns TRUE
 *      for legitimate allocator/org pairings; the trigger does NOT
 *      fail-closed on the happy path.
 *   3. ORPHAN-ORG STRATEGY INSERT must fail-closed — proves the
 *      audit-2026-05-07 MED-3 fix lands: an org with zero members does NOT
 *      flip strategies to globally allocator-visible.
 *   4. service_role direct INSERT must succeed (CRITICAL-1 regression
 *      probe) — proves the CRITICAL-1 ACL fix in 20260516170000 STEP 2
 *      sticks: REVOKEing EXECUTE from service_role would 42501 every
 *      admin-client INSERT.
 *   5. NULL-ORG (owner-scoped) STRATEGY INSERT must succeed — proves the
 *      strategies.organization_id IS NULL branch falls through to TRUE
 *      (owner-scoped strategies have no membership gate).
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
 *   npx vitest run src/__tests__/match-decisions-visibility-trigger-rls.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("match_decisions visibility trigger (PR #182 leak scopes, live-DB)", () => {
  advertiseLiveDbSkipReason("match-decisions-visibility-trigger-rls");

  let admin: SupabaseClient;
  let allocatorInOrg: string;       // member of orgWithMembers
  let allocatorCrossOrg: string;    // NOT a member of orgWithMembers
  let strategyOwnerInOrg: string;   // owner of strategyInOrg (also member)
  let strategyOwnerOrphan: string;  // creator of orgOrphan (then removed)
  let strategyOwnerNullOrg: string; // owner of strategyNullOrg (no org)

  let orgWithMembers: string;       // has [allocatorInOrg, strategyOwnerInOrg]
  let orgOrphan: string;            // has zero members (post-cleanup)

  let strategyInOrg: string;        // organization_id = orgWithMembers
  let strategyInOrphanOrg: string;  // organization_id = orgOrphan
  let strategyNullOrg: string;      // organization_id IS NULL

  // Track all created match_decision IDs for cleanup
  const createdMatchDecisionIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();

    const ts = Date.now();

    // ----- Users ------------------------------------------------------------
    allocatorInOrg = await createTestUser(
      admin,
      `vis-alloc-in-org-${ts}@test.local`,
    );
    allocatorCrossOrg = await createTestUser(
      admin,
      `vis-alloc-cross-org-${ts}@test.local`,
    );
    strategyOwnerInOrg = await createTestUser(
      admin,
      `vis-owner-in-org-${ts}@test.local`,
    );
    strategyOwnerOrphan = await createTestUser(
      admin,
      `vis-owner-orphan-${ts}@test.local`,
    );
    strategyOwnerNullOrg = await createTestUser(
      admin,
      `vis-owner-null-org-${ts}@test.local`,
    );

    // ----- Organizations ----------------------------------------------------
    // orgWithMembers: legitimate org with allocator + owner inside.
    const orgWithMembersInsert = await admin
      .from("organizations")
      .insert({
        name: `vis-trigger org-with-members ${ts}`,
        slug: `vis-with-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        created_by: strategyOwnerInOrg,
      })
      .select("id")
      .single();
    if (orgWithMembersInsert.error || !orgWithMembersInsert.data) {
      throw new Error(
        `orgWithMembers seed: ${orgWithMembersInsert.error?.message}`,
      );
    }
    orgWithMembers = orgWithMembersInsert.data.id;

    const memInsert = await admin.from("organization_members").insert([
      {
        organization_id: orgWithMembers,
        user_id: strategyOwnerInOrg,
        role: "owner",
      },
      {
        organization_id: orgWithMembers,
        user_id: allocatorInOrg,
        role: "member",
      },
    ]);
    if (memInsert.error) {
      throw new Error(`organization_members seed: ${memInsert.error.message}`);
    }

    // orgOrphan: created with one member, then the member is removed to
    // produce a zero-members orphan state matching the audit-2026-05-07
    // MED-3 scenario (sole-admin departure leaves org empty).
    const orgOrphanInsert = await admin
      .from("organizations")
      .insert({
        name: `vis-trigger org-orphan ${ts}`,
        slug: `vis-orphan-${ts}-${Math.random().toString(36).slice(2, 8)}`,
        created_by: strategyOwnerOrphan,
      })
      .select("id")
      .single();
    if (orgOrphanInsert.error || !orgOrphanInsert.data) {
      throw new Error(`orgOrphan seed: ${orgOrphanInsert.error?.message}`);
    }
    orgOrphan = orgOrphanInsert.data.id;

    await admin.from("organization_members").insert({
      organization_id: orgOrphan,
      user_id: strategyOwnerOrphan,
      role: "owner",
    });

    // ----- Strategies -------------------------------------------------------
    // strategyInOrg: organization_id = orgWithMembers.
    const stratInOrgInsert = await admin
      .from("strategies")
      .insert({
        user_id: strategyOwnerInOrg,
        organization_id: orgWithMembers,
        name: `vis-trigger strat-in-org ${ts}`,
      })
      .select("id")
      .single();
    if (stratInOrgInsert.error || !stratInOrgInsert.data) {
      throw new Error(`strategyInOrg seed: ${stratInOrgInsert.error?.message}`);
    }
    strategyInOrg = stratInOrgInsert.data.id;

    // strategyInOrphanOrg: organization_id = orgOrphan (will be orphaned
    // by DELETE of strategyOwnerOrphan's membership below).
    const stratOrphanInsert = await admin
      .from("strategies")
      .insert({
        user_id: strategyOwnerOrphan,
        organization_id: orgOrphan,
        name: `vis-trigger strat-orphan ${ts}`,
      })
      .select("id")
      .single();
    if (stratOrphanInsert.error || !stratOrphanInsert.data) {
      throw new Error(
        `strategyInOrphanOrg seed: ${stratOrphanInsert.error?.message}`,
      );
    }
    strategyInOrphanOrg = stratOrphanInsert.data.id;

    // strategyNullOrg: organization_id IS NULL — owner-scoped, no org gate.
    const stratNullInsert = await admin
      .from("strategies")
      .insert({
        user_id: strategyOwnerNullOrg,
        organization_id: null,
        name: `vis-trigger strat-null-org ${ts}`,
      })
      .select("id")
      .single();
    if (stratNullInsert.error || !stratNullInsert.data) {
      throw new Error(`strategyNullOrg seed: ${stratNullInsert.error?.message}`);
    }
    strategyNullOrg = stratNullInsert.data.id;

    // Now empty orgOrphan: delete its sole member to produce the
    // zero-members orphan state.
    const orphanRemove = await admin
      .from("organization_members")
      .delete()
      .eq("organization_id", orgOrphan);
    if (orphanRemove.error) {
      throw new Error(`orgOrphan empty: ${orphanRemove.error.message}`);
    }
  });

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;

    // Delete created match_decisions first (no FK back to strategies via
    // ON DELETE CASCADE on strategy_id so we rely on cascade for the
    // strategies/users teardown, but explicit cleanup keeps the test
    // boundary tidy).
    for (const id of createdMatchDecisionIds) {
      await admin.from("match_decisions").delete().eq("id", id);
    }

    // Strategies — these will cascade-delete any remaining match_decisions
    // by ON DELETE CASCADE on strategy_id.
    for (const id of [strategyInOrg, strategyInOrphanOrg, strategyNullOrg]) {
      if (id) await admin.from("strategies").delete().eq("id", id);
    }

    // Organizations — cascade-deletes organization_members.
    for (const id of [orgWithMembers, orgOrphan]) {
      if (id) await admin.from("organizations").delete().eq("id", id);
    }

    // Users (deleted last; auth.users delete cascades to profiles).
    for (const id of [
      allocatorInOrg,
      allocatorCrossOrg,
      strategyOwnerInOrg,
      strategyOwnerOrphan,
      strategyOwnerNullOrg,
    ]) {
      if (id) await admin.auth.admin.deleteUser(id);
    }
  });

  // ---------------------------------------------------------------------------
  // Scope 1: CROSS-ORG ALLOCATOR INSERT must 42501
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT when allocator is NOT a member of the org-scoped strategy's owning org (42501)",
    async () => {
      // bridge_recommended with strategy_id set + allocator_id set fires
      // the trigger. allocator is NOT in orgWithMembers → helper returns
      // FALSE → trigger RAISE EXCEPTION with USING ERRCODE =
      // 'insufficient_privilege' (42501).
      const { error, data } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorCrossOrg,
          strategy_id: strategyInOrg,
          decision: "sent_as_intro",
          decided_by: allocatorCrossOrg,
          original_strategy_id: strategyInOrg,
          original_holding_ref: null,
          kind: "bridge_recommended",
        })
        .select("id");

      expect(error).not.toBeNull();
      expect(data).toBeNull();
      // PostgREST surfaces PG error code in the RPC error contract.
      // 42501 = insufficient_privilege (raised by the trigger via
      // USING ERRCODE).
      expect(
        error?.code === "42501" ||
          error?.message?.includes("visibility check") ||
          error?.message?.includes("M-0825"),
      ).toBe(true);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // Scope 2: IN-ORG ALLOCATOR INSERT must succeed
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "accepts INSERT when allocator is a member of the org-scoped strategy's owning org",
    async () => {
      // allocator IS in orgWithMembers → helper returns TRUE → trigger
      // returns NEW → row persists.
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorInOrg,
          strategy_id: strategyInOrg,
          decision: "sent_as_intro",
          decided_by: allocatorInOrg,
          original_strategy_id: strategyInOrg,
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

  // ---------------------------------------------------------------------------
  // Scope 3: ORPHAN-ORG STRATEGY INSERT must fail-closed
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT for any allocator when strategy belongs to a zero-members orphan org (fail-closed, MED-3)",
    async () => {
      // strategyInOrphanOrg has organization_id = orgOrphan, which now has
      // zero organization_members. Per audit-2026-05-07 MED-3 the helper
      // returns FALSE (fail-closed) instead of the prior TRUE fast-path,
      // so the trigger raises 42501.
      //
      // Probe with an allocator that has never been associated with the
      // org (allocatorCrossOrg). Pre-MED-3, this would have succeeded
      // unsafely; post-MED-3 it must 42501.
      const { error, data } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorCrossOrg,
          strategy_id: strategyInOrphanOrg,
          decision: "sent_as_intro",
          decided_by: allocatorCrossOrg,
          original_strategy_id: strategyInOrphanOrg,
          original_holding_ref: null,
          kind: "bridge_recommended",
        })
        .select("id");

      expect(error).not.toBeNull();
      expect(data).toBeNull();
      expect(
        error?.code === "42501" ||
          error?.message?.includes("visibility check") ||
          error?.message?.includes("M-0825"),
      ).toBe(true);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // Scope 4: service_role direct INSERT must succeed (CRITICAL-1 regression)
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "accepts service_role direct INSERT (CRITICAL-1 regression — REVOKE EXECUTE FROM service_role would 42501)",
    async () => {
      // The admin client used in this test IS service_role. If a future
      // migration REVOKEs EXECUTE on _assert_strategy_visible_to_allocator
      // FROM service_role (the 160700-as-shipped bug 170000 STEP 2
      // closed), this INSERT would 42501 with "permission denied for
      // function _assert_strategy_visible_to_allocator" — even though
      // service_role has BYPASSRLS (BYPASSRLS skips ROW-level security
      // but not OBJECT-level / function-EXECUTE permissions). Use a
      // distinct (allocator, strategy, decision) tuple so partial unique
      // indexes don't collide with Scope 2.
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorInOrg,
          strategy_id: strategyInOrg,
          decision: "thumbs_up",
          decided_by: allocatorInOrg,
          original_strategy_id: strategyInOrg,
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

  // ---------------------------------------------------------------------------
  // Scope 5: NULL-ORG (owner-scoped) strategy INSERT must succeed
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "accepts INSERT for any allocator when strategy has organization_id IS NULL (owner-scoped, no org gate)",
    async () => {
      // strategyNullOrg has organization_id IS NULL → helper returns TRUE
      // (owner-scoped strategies are globally allocator-visible while
      // published, per the helper's NULL-org branch). A cross-org
      // allocator must still be allowed to commit a bridge_recommended
      // against the owner-scoped strategy.
      const { data, error } = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorCrossOrg,
          strategy_id: strategyNullOrg,
          decision: "sent_as_intro",
          decided_by: allocatorCrossOrg,
          original_strategy_id: strategyNullOrg,
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
});
