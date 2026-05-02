/**
 * Live-DB integration test — Migration 093 RLS policies on
 * strategy_verifications.
 *
 * Phase 15 / CSV-01..CSV-03 — Plan 15-06 Task 2B.
 *
 * Migration 093 ships THREE policies on strategy_verifications:
 *   - strategy_verifications_owner_select: SELECT where strategy_id IN
 *     (SELECT id FROM strategies WHERE user_id = auth.uid()).
 *   - strategy_verifications_admin_select: SELECT for users with the
 *     'admin' role in user_app_roles (via current_user_has_app_role).
 *   - strategy_verifications_service_all: ALL for service_role.
 *
 * No INSERT/UPDATE/DELETE policy exists for authenticated users — rows
 * are written exclusively by the SECURITY DEFINER finalize_csv_strategy
 * RPC, which the csv-finalize-rpc.test.ts integration test covers.
 *
 * This file pins the RLS contract end-to-end against the live test
 * Supabase project (qmnijlgmdhviwzwfyzlc):
 *
 *   1. Owner SELECT works — quant A reads their own row.
 *   2. Foreign-user SELECT returns zero rows — quant B reading A's
 *      strategy_id gets [] (anti-leak invariant).
 *   3. Admin SELECT works — a user with role='admin' in user_app_roles
 *      can read any verification row (admin status page at
 *      /admin/csv-status, plan 15-07, depends on this).
 *   4. Service-role SELECT works — the worker write path can read all
 *      rows without RLS filtering.
 *
 * Structure mirrors `src/__tests__/audit-log-rls.test.ts` (two-actor
 * sign-in pattern) and `src/__tests__/allocator-equity-rls.test.ts`
 * (service-role + dependency-order cleanup).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/strategy-verifications-rls.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
// Seed helpers — service-role inserts that bypass RLS for fixture setup.
// ---------------------------------------------------------------------------

interface SeededRow {
  strategyId: string;
  verificationId: string;
}

/**
 * Insert a strategies row + a strategy_verifications row owned by `userId`,
 * via service-role. Returns both ids so cleanup can target them.
 *
 * Uses static fixed string fields (source='csv', flow_type='csv',
 * trust_tier='csv_uploaded', status='validated') matching what the
 * production finalize_csv_strategy RPC writes.
 */
async function seedStrategyAndVerification(
  admin: SupabaseClient,
  userId: string,
  marker: string,
): Promise<SeededRow> {
  const { data: stratData, error: stratErr } = await admin
    .from("strategies")
    .insert({
      user_id: userId,
      name: `__test_rls_${marker}`,
      status: "pending_review",
      source: "csv",
      strategy_types: [],
      subtypes: [],
      markets: [],
      supported_exchanges: [],
    } as never)
    .select("id")
    .single();
  if (stratErr || !stratData) {
    throw new Error(
      `seedStrategyAndVerification(${marker}) strategies: ${stratErr?.message}`,
    );
  }
  const strategyId = (stratData as { id: string }).id;

  const { data: verData, error: verErr } = await admin
    .from("strategy_verifications")
    .insert({
      strategy_id: strategyId,
      wizard_session_id: crypto.randomUUID(),
      status: "validated",
      trust_tier: "csv_uploaded",
      flow_type: "csv",
      source: "csv",
    } as never)
    .select("id")
    .single();
  if (verErr || !verData) {
    // Roll back the strategies row so we don't leak.
    await admin.from("strategies").delete().eq("id", strategyId);
    throw new Error(
      `seedStrategyAndVerification(${marker}) strategy_verifications: ${verErr?.message}`,
    );
  }

  return {
    strategyId,
    verificationId: (verData as { id: string }).id,
  };
}

/**
 * Grant the 'admin' app role to a test user. Mirrors
 * src/__tests__/user-app-roles-backfill.test.ts:38-44.
 */
async function grantAdminRole(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await admin.from("user_app_roles").upsert(
    {
      user_id: userId,
      role: "admin",
      granted_by: null,
      granted_at: new Date().toISOString(),
    } as never,
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`grantAdminRole(${userId}): ${error.message}`);
  }
}

/**
 * Sign in as the given user and return a client that carries the user's
 * JWT in the Authorization header. Returns null if password-grant is
 * disabled (some Supabase projects). Mirrors audit-log-rls and
 * allocator-equity-rls patterns.
 */
async function createAuthedClient(
  email: string,
  password: string,
): Promise<SupabaseClient | null> {
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    console.warn(
      "[strategy-verifications-rls] signInWithPassword failed (password-grant may be disabled):",
      error?.message,
    );
    return null;
  }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Migration 093 — strategy_verifications RLS (Phase 15 / CSV-01..CSV-03)", () => {
  // -------------------------------------------------------------------------
  // 1. Owner can SELECT their own verification row.
  //    2. Foreign user reading owner's strategy_id gets [] (anti-leak).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "owner reads own verification row; foreign user reading the same strategy_id gets zero rows",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const seededStrategyIds: string[] = [];

      try {
        // --- Two quants: A owns the strategy, B is the foreign user ---
        const passwordA = `RlsVerOwnerA${ts}!`;
        const passwordB = `RlsVerOwnerB${ts}!`;
        const emailA = `rls-ver-a-${ts}@test.sec`;
        const emailB = `rls-ver-b-${ts}@test.sec`;
        const aId = await createTestUser(admin, emailA, passwordA);
        const bId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds.push(aId, bId);

        // --- Seed one strategy + one verification row per quant ----------
        const aSeed = await seedStrategyAndVerification(admin, aId, `a-${ts}`);
        const bSeed = await seedStrategyAndVerification(admin, bId, `b-${ts}`);
        seededStrategyIds.push(aSeed.strategyId, bSeed.strategyId);

        // --- Authenticate as A; must see EXACTLY their own row -----------
        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return; // password-grant disabled — graceful skip

        const { data: aRows, error: aErr } = await clientA
          .from("strategy_verifications")
          .select("id, strategy_id, trust_tier, flow_type, source")
          .eq("strategy_id", aSeed.strategyId);
        expect(aErr).toBeNull();
        expect(aRows).not.toBeNull();
        expect(aRows!.length).toBe(1);
        const aRow = aRows![0] as Record<string, unknown>;
        expect(aRow.id).toBe(aSeed.verificationId);
        expect(aRow.trust_tier).toBe("csv_uploaded");
        expect(aRow.flow_type).toBe("csv");
        expect(aRow.source).toBe("csv");

        // --- Foreign user B asks about A's strategy_id → 0 rows ----------
        // The strategy_verifications_owner_select policy filters on
        // `strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid())`.
        // For B, the IN-list does not include A's strategy id, so RLS
        // returns an empty set (NOT a permission error — that's the
        // RLS contract for SELECT). This is the anti-leak invariant.
        const clientB = await createAuthedClient(emailB, passwordB);
        if (!clientB) return;

        const { data: bCrossRead, error: bCrossErr } = await clientB
          .from("strategy_verifications")
          .select("id, strategy_id")
          .eq("strategy_id", aSeed.strategyId);
        expect(bCrossErr).toBeNull();
        expect(bCrossRead).toEqual([]);
      } finally {
        // FK CASCADE on strategies → strategy_verifications clears the
        // verification rows automatically when we delete the strategies.
        for (const id of seededStrategyIds) {
          try {
            await admin.from("strategies").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[strategy-verifications-rls] cleanup strategies ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // 3. Owner write-attempt is blocked — no INSERT/UPDATE/DELETE policy
  //    exists for authenticated, so RLS rejects direct writes. The only
  //    write path is the SECURITY DEFINER finalize_csv_strategy RPC.
  //    This pins the contract: a quant cannot bypass the RPC and forge
  //    a verification row by going directly through PostgREST.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "owner cannot directly INSERT into strategy_verifications (only finalize_csv_strategy RPC writes)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const seededStrategyIds: string[] = [];

      try {
        const password = `RlsVerWrite${ts}!`;
        const email = `rls-ver-write-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds.push(ownerId);

        // Seed a strategy owned by this user (but NO verification row).
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: ownerId,
            name: `__test_rls_write_${ts}`,
            status: "pending_review",
            source: "csv",
            strategy_types: [],
            subtypes: [],
            markets: [],
            supported_exchanges: [],
          } as never)
          .select("id")
          .single();
        if (stratErr || !stratData) {
          throw new Error(`seed strategy: ${stratErr?.message}`);
        }
        const strategyId = (stratData as { id: string }).id;
        seededStrategyIds.push(strategyId);

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        // Attempt to forge a verification row directly. With NO INSERT
        // policy on the table for `authenticated`, PostgreSQL refuses
        // the row (RLS denies INSERTs that don't match a WITH CHECK
        // clause; the absence of any INSERT policy is equivalent to
        // WITH CHECK (false) for non-bypass roles).
        const { data: forgedRow, error: forgeErr } = await clientOwner
          .from("strategy_verifications")
          .insert({
            strategy_id: strategyId,
            wizard_session_id: crypto.randomUUID(),
            status: "validated",
            trust_tier: "csv_uploaded",
            flow_type: "csv",
            source: "csv",
          } as never)
          .select("id");

        // Two acceptable failure shapes:
        //   (a) PostgREST returns 401/403/42501 with a permission error.
        //   (b) PostgREST returns an empty array (no rows inserted under
        //       the absent-INSERT-policy semantics).
        // What must NOT happen is a forged row landing in the table.
        if (forgeErr) {
          expect(forgeErr.message.toLowerCase()).toMatch(
            /permission denied|new row violates|policy|insufficient/,
          );
        } else {
          expect(forgedRow).toEqual([]);
        }

        // Confirm via service-role read that no verification row exists
        // for this strategy_id.
        const { count } = await admin
          .from("strategy_verifications")
          .select("*", { count: "exact", head: true })
          .eq("strategy_id", strategyId);
        expect(count).toBe(0);
      } finally {
        for (const id of seededStrategyIds) {
          try {
            await admin.from("strategies").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[strategy-verifications-rls] cleanup (write) strategies ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // 4. Admin can SELECT any verification row — proves the
  //    strategy_verifications_admin_select policy actually engages
  //    (admin status page at /admin/csv-status, plan 15-07, depends
  //    on this read path).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "admin (user_app_roles.role='admin') reads any verification row",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const seededStrategyIds: string[] = [];
      const seededAdminIds: string[] = [];

      try {
        // Quant who owns the strategy.
        const quantPassword = `RlsVerAdminQ${ts}!`;
        const quantEmail = `rls-ver-quant-${ts}@test.sec`;
        const quantId = await createTestUser(admin, quantEmail, quantPassword);
        cleanup.userIds.push(quantId);

        const seed = await seedStrategyAndVerification(
          admin,
          quantId,
          `admin-target-${ts}`,
        );
        seededStrategyIds.push(seed.strategyId);

        // Admin who is NOT the strategy owner but holds 'admin' role.
        const adminPassword = `RlsVerAdmin${ts}!`;
        const adminEmail = `rls-ver-admin-${ts}@test.sec`;
        const adminUserId = await createTestUser(
          admin,
          adminEmail,
          adminPassword,
        );
        cleanup.userIds.push(adminUserId);
        seededAdminIds.push(adminUserId);

        // Grant the admin app role.
        await grantAdminRole(admin, adminUserId);

        const adminClient = await createAuthedClient(adminEmail, adminPassword);
        if (!adminClient) return;

        // Admin reads the OTHER user's verification row — must succeed
        // via strategy_verifications_admin_select policy.
        const { data: adminRows, error: adminErr } = await adminClient
          .from("strategy_verifications")
          .select("id, strategy_id, trust_tier, flow_type")
          .eq("id", seed.verificationId);
        expect(adminErr).toBeNull();
        expect(adminRows).not.toBeNull();
        expect(adminRows!.length).toBe(1);
        const adminRow = adminRows![0] as Record<string, unknown>;
        expect(adminRow.id).toBe(seed.verificationId);
        expect(adminRow.strategy_id).toBe(seed.strategyId);
        expect(adminRow.trust_tier).toBe("csv_uploaded");
        expect(adminRow.flow_type).toBe("csv");
      } finally {
        // Clear granted admin roles before deleting users.
        for (const id of seededAdminIds) {
          try {
            await admin.from("user_app_roles").delete().eq("user_id", id);
          } catch (err) {
            console.warn(
              `[strategy-verifications-rls] cleanup (admin) user_app_roles ${id}: ${(err as Error).message}`,
            );
          }
        }
        for (const id of seededStrategyIds) {
          try {
            await admin.from("strategies").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[strategy-verifications-rls] cleanup (admin) strategies ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // 5. service_role SELECT returns rows owned by anyone — belt-and-
  //    suspenders verification that the
  //    strategy_verifications_service_all policy actually engages
  //    (worker write path / phase-19 flag-monitor cron depend on this).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "service_role reads verification rows across users (service_all policy)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const seededStrategyIds: string[] = [];

      try {
        const password = `RlsVerSvc${ts}!`;
        const email = `rls-ver-svc-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds.push(ownerId);

        const seed = await seedStrategyAndVerification(
          admin,
          ownerId,
          `svc-${ts}`,
        );
        seededStrategyIds.push(seed.strategyId);

        // service-role SELECT must return the seeded row — no RLS filter.
        const { data, error } = await admin
          .from("strategy_verifications")
          .select(
            "id, strategy_id, trust_tier, flow_type, source, status, wizard_session_id, correlation_id",
          )
          .eq("id", seed.verificationId)
          .single();
        expect(error).toBeNull();
        expect(data).not.toBeNull();
        const row = data as Record<string, unknown>;
        expect(row.strategy_id).toBe(seed.strategyId);
        expect(row.trust_tier).toBe("csv_uploaded");
        expect(row.flow_type).toBe("csv");
        expect(row.source).toBe("csv");
        expect(row.status).toBe("validated");
        // Phase 16 / OBSERV-06 will populate correlation_id; Phase 15
        // leaves NULL.
        expect(row.correlation_id).toBeNull();
      } finally {
        for (const id of seededStrategyIds) {
          try {
            await admin.from("strategies").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[strategy-verifications-rls] cleanup (svc) strategies ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the test suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("strategy-verifications-rls");
    expect(true).toBe(true);
  });
});
