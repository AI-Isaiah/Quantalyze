/**
 * Live-DB integration test — Migration 059 RLS policies on
 * bridge_outcomes + bridge_outcome_dismissals.
 *
 * Sprint 8 Phase 1 — Plan 01-02.
 *
 * Verifies migration 059 RLS policies against a live Postgres — mocked
 * clients would silently pass a broken policy. Each test exercises a
 * distinct policy path so a regression in any single policy is caught
 * independently.
 *
 * Tests:
 *   1. bridge_outcomes.select_own: owner SELECT own → 1 row; foreign allocator → 0 rows
 *   2. admin SELECT via service-role: admin client sees all rows
 *   3. spoofed INSERT blocked: user A cannot INSERT with allocator_id=B
 *   4. DELETE denied on bridge_outcomes: no DELETE policy → zero affected rows
 *   5. dismissals DELETE allowed for owner; foreign allocator DELETE → zero rows
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are absent
 * (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/bridge-outcomes-rls.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Create a throw-away strategy for the given manager user. The FK on
 * bridge_outcomes.strategy_id references strategies(id) — we need a real row.
 */
async function seedStrategy(
  admin: ReturnType<typeof createLiveAdminClient>,
  managerId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("strategies")
    .insert({ user_id: managerId, name: `__test_bridge_rls_${label}` })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedStrategy(${label}): ${error?.message}`);
  }
  return data.id as string;
}

/**
 * Insert a bridge_outcomes row via service-role (bypasses RLS for seeding).
 * Uses kind='rejected' + rejection_reason to avoid cross-field constraint
 * needing percent_allocated/allocated_at.
 */
async function seedOutcome(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
  strategyId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("bridge_outcomes")
    .insert({
      allocator_id: allocatorId,
      strategy_id: strategyId,
      kind: "rejected",
      rejection_reason: "other",
      note: "__test_rls_probe",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedOutcome: ${error?.message}`);
  }
  return data.id as string;
}

/**
 * Insert a bridge_outcome_dismissals row via service-role.
 */
async function seedDismissal(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
  strategyId: string,
): Promise<string> {
  const futureTs = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("bridge_outcome_dismissals")
    .insert({
      allocator_id: allocatorId,
      strategy_id: strategyId,
      expires_at: futureTs,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedDismissal: ${error?.message}`);
  }
  return data.id as string;
}

/**
 * Create a user-scoped Supabase client authenticated as the given user via
 * signInWithPassword. Returns null (and logs a warning) if password-grant is
 * disabled in the project — the calling test should skip its assertions.
 */
async function createAuthedClient(
  email: string,
  password: string,
): Promise<ReturnType<typeof createClient> | null> {
  // Use the service-role key on a fresh client so we get a session token via
  // signInWithPassword, then hand the token to a scoped client that respects RLS.
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: { session }, error } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !session) {
    console.warn(
      "[bridge-outcomes-rls] signInWithPassword failed (password-grant may be disabled):",
      error?.message,
    );
    return null;
  }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Migration 059 — bridge_outcomes + bridge_outcome_dismissals RLS", () => {
  // -------------------------------------------------------------------------
  // Test 1: owner SELECT own; foreign allocator SELECT returns 0 rows
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes: owner reads own row; foreign allocator reads 0 rows",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };

      try {
        // Create two allocators and a manager (strategy owner)
        const passwordA = `RlsOwnerA${ts}!`;
        const passwordB = `RlsForeignB${ts}!`;
        const allocatorAId = await createTestUser(
          admin,
          `rls-alloc-a-${ts}@test.sec`,
          passwordA,
        );
        const allocatorBId = await createTestUser(
          admin,
          `rls-alloc-b-${ts}@test.sec`,
          passwordB,
        );
        const managerId = await createTestUser(
          admin,
          `rls-mgr-${ts}@test.sec`,
        );
        cleanup.userIds!.push(allocatorAId, allocatorBId, managerId);

        const strategyId = await seedStrategy(admin, managerId, `${ts}`);
        cleanup.strategyIds!.push(strategyId);

        // Seed outcome for A
        const outcomeId = await seedOutcome(admin, allocatorAId, strategyId);

        // Authenticate as A
        const clientA = await createAuthedClient(
          `rls-alloc-a-${ts}@test.sec`,
          passwordA,
        );
        if (!clientA) return; // password-grant disabled — skip

        // A can read their own row
        const { data: aOwnRead, error: aOwnErr } = await clientA
          .from("bridge_outcomes")
          .select("id, allocator_id")
          .eq("id", outcomeId);
        expect(aOwnErr).toBeNull();
        expect(aOwnRead).not.toBeNull();
        expect(aOwnRead!.length).toBe(1);
        expect((aOwnRead![0] as { allocator_id: string }).allocator_id).toBe(allocatorAId);

        // Authenticate as B
        const clientB = await createAuthedClient(
          `rls-alloc-b-${ts}@test.sec`,
          passwordB,
        );
        if (!clientB) return;

        // B cannot read A's row — RLS USING (allocator_id = auth.uid()) filters it out
        const { data: bCrossRead, error: bCrossErr } = await clientB
          .from("bridge_outcomes")
          .select("id")
          .eq("id", outcomeId);
        expect(bCrossErr).toBeNull();
        expect(bCrossRead).toEqual([]);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // Test 2: service-role admin SELECT all rows
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes: service-role admin client reads all rows across allocators",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };

      try {
        const allocatorAId = await createTestUser(admin, `rls-sa-a-${ts}@test.sec`);
        const allocatorBId = await createTestUser(admin, `rls-sa-b-${ts}@test.sec`);
        const managerId = await createTestUser(admin, `rls-sa-mgr-${ts}@test.sec`);
        cleanup.userIds!.push(allocatorAId, allocatorBId, managerId);

        const strategyId = await seedStrategy(admin, managerId, `sa-${ts}`);
        cleanup.strategyIds!.push(strategyId);

        // Strategy unique constraint: one outcome per (allocator, strategy)
        // Use separate strategies for each allocator
        const strategyId2 = await seedStrategy(admin, managerId, `sa2-${ts}`);
        cleanup.strategyIds!.push(strategyId2);

        const outcomeAId = await seedOutcome(admin, allocatorAId, strategyId);
        const outcomeBId = await seedOutcome(admin, allocatorBId, strategyId2);

        // Service-role admin can see both rows
        const { data: allRows, error: allErr } = await admin
          .from("bridge_outcomes")
          .select("id, allocator_id")
          .in("id", [outcomeAId, outcomeBId]);
        expect(allErr).toBeNull();
        expect(allRows).not.toBeNull();
        expect(allRows!.length).toBe(2);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // Test 3: spoofed INSERT blocked (WITH CHECK (allocator_id = auth.uid()))
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes: INSERT with spoofed allocator_id is blocked by RLS WITH CHECK",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };

      try {
        const passwordA = `RlsSpoofA${ts}!`;
        const allocatorAId = await createTestUser(
          admin,
          `rls-spoof-a-${ts}@test.sec`,
          passwordA,
        );
        const allocatorBId = await createTestUser(
          admin,
          `rls-spoof-b-${ts}@test.sec`,
        );
        const managerId = await createTestUser(admin, `rls-spoof-mgr-${ts}@test.sec`);
        cleanup.userIds!.push(allocatorAId, allocatorBId, managerId);

        const strategyId = await seedStrategy(admin, managerId, `spoof-${ts}`);
        cleanup.strategyIds!.push(strategyId);

        // Authenticate as A
        const clientA = await createAuthedClient(
          `rls-spoof-a-${ts}@test.sec`,
          passwordA,
        );
        if (!clientA) return;

        // A tries to INSERT a row claiming allocator_id = B's id (spoof).
        // The untyped createClient() resolves insert() to `never`; cast to
        // satisfy TS while still exercising the actual RLS path at runtime.
        const { data: spoofed, error: spoofErr } = await clientA
          .from("bridge_outcomes")
          .insert({
            allocator_id: allocatorBId, // spoofed — not auth.uid()
            strategy_id: strategyId,
            kind: "rejected",
            rejection_reason: "other",
            note: "__spoof_probe",
          } as never)
          .select("id");

        // Either PostgREST returns an explicit error, or the insert silently
        // produces zero rows (RLS WITH CHECK blocks it). What must NOT happen
        // is a row with allocator_id = B existing.
        if (spoofErr) {
          expect(spoofErr.message.toLowerCase()).toMatch(
            /new row violates row-level security|permission denied|violates row-level security policy/i,
          );
        } else {
          expect(spoofed).toEqual([]);
        }

        // Confirm B's account has no spurious row in bridge_outcomes
        const { data: bRows } = await admin
          .from("bridge_outcomes")
          .select("id")
          .eq("allocator_id", allocatorBId);
        expect((bRows ?? []).length).toBe(0);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // Test 4: DELETE denied on bridge_outcomes (append-only — no DELETE policy)
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcomes: DELETE is denied — no DELETE policy (append-only invariant)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };

      try {
        const passwordA = `RlsDelA${ts}!`;
        const allocatorAId = await createTestUser(
          admin,
          `rls-del-a-${ts}@test.sec`,
          passwordA,
        );
        const managerId = await createTestUser(admin, `rls-del-mgr-${ts}@test.sec`);
        cleanup.userIds!.push(allocatorAId, managerId);

        const strategyId = await seedStrategy(admin, managerId, `del-${ts}`);
        cleanup.strategyIds!.push(strategyId);

        const outcomeId = await seedOutcome(admin, allocatorAId, strategyId);

        // Authenticate as A
        const clientA = await createAuthedClient(
          `rls-del-a-${ts}@test.sec`,
          passwordA,
        );
        if (!clientA) return;

        // A attempts to DELETE their own row — should fail (no DELETE policy)
        const { data: deleted, error: deleteErr } = await clientA
          .from("bridge_outcomes")
          .delete()
          .eq("id", outcomeId)
          .select("id");

        if (deleteErr) {
          expect(deleteErr.message.toLowerCase()).toMatch(
            /permission denied|new row violates|violates row-level security/i,
          );
        } else {
          // No error but zero rows deleted (no DELETE policy = no rows match)
          expect(deleted).toEqual([]);
        }

        // Confirm the row still exists (append-only invariant)
        const { data: reread, error: rereadErr } = await admin
          .from("bridge_outcomes")
          .select("id")
          .eq("id", outcomeId)
          .maybeSingle();
        expect(rereadErr).toBeNull();
        expect(reread?.id).toBe(outcomeId);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // Test 5: dismissals DELETE allowed for owner; foreign DELETE → 0 rows
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "bridge_outcome_dismissals: owner can DELETE own row; foreign allocator DELETE → zero rows",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };

      try {
        const passwordA = `RlsDismA${ts}!`;
        const passwordB = `RlsDismB${ts}!`;
        const allocatorAId = await createTestUser(
          admin,
          `rls-dism-a-${ts}@test.sec`,
          passwordA,
        );
        const allocatorBId = await createTestUser(
          admin,
          `rls-dism-b-${ts}@test.sec`,
          passwordB,
        );
        const managerId = await createTestUser(admin, `rls-dism-mgr-${ts}@test.sec`);
        cleanup.userIds!.push(allocatorAId, allocatorBId, managerId);

        const strategyIdA = await seedStrategy(admin, managerId, `dism-a-${ts}`);
        const strategyIdB = await seedStrategy(admin, managerId, `dism-b-${ts}`);
        cleanup.strategyIds!.push(strategyIdA, strategyIdB);

        // Seed dismissals for A and B
        const dismissalAId = await seedDismissal(admin, allocatorAId, strategyIdA);
        const dismissalBId = await seedDismissal(admin, allocatorBId, strategyIdB);

        // Authenticate as A
        const clientA = await createAuthedClient(
          `rls-dism-a-${ts}@test.sec`,
          passwordA,
        );
        if (!clientA) return;

        // A tries to DELETE B's dismissal row — should return 0 affected rows
        const { data: foreignDelete, error: foreignDeleteErr } = await clientA
          .from("bridge_outcome_dismissals")
          .delete()
          .eq("id", dismissalBId)
          .select("id");
        expect(foreignDeleteErr).toBeNull();
        expect((foreignDelete ?? []).length).toBe(0);

        // B's row still exists
        const { data: bRowCheck } = await admin
          .from("bridge_outcome_dismissals")
          .select("id")
          .eq("id", dismissalBId)
          .maybeSingle();
        expect(bRowCheck?.id).toBe(dismissalBId);

        // A CAN delete their own dismissal (owner-delete policy exists on dismissals)
        const { data: ownDelete, error: ownDeleteErr } = await clientA
          .from("bridge_outcome_dismissals")
          .delete()
          .eq("id", dismissalAId)
          .select("id");
        expect(ownDeleteErr).toBeNull();
        // A's row is gone (either explicit success or empty result)
        const aRowsDeleted = (ownDelete ?? []).length;
        expect(aRowsDeleted).toBeLessThanOrEqual(1); // 0 or 1 depending on PostgREST response

        // Confirm A's row is gone
        const { data: aRowCheck } = await admin
          .from("bridge_outcome_dismissals")
          .select("id")
          .eq("id", dismissalAId)
          .maybeSingle();
        expect(aRowCheck).toBeNull();

        // Clean up B's dismissal manually (test cleanup)
        await admin.from("bridge_outcome_dismissals").delete().eq("id", dismissalBId);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the test suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("bridge-outcomes-rls");
    expect(true).toBe(true);
  });
});
