import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

/**
 * MANDATE-05 / MANDATE-06 / MANDATE-04 — live-DB integration coverage for
 * update_allocator_mandates SECURITY DEFINER RPC + direct-UPDATE RLS
 * enforcement (ROADMAP SC4 Option A).
 *
 * Tests:
 *   1. MANDATE-04: Auth'd user RPC writes max_weight + mandate_edited_at
 *      populated within 5 seconds
 *   2. MANDATE-05: Unauthenticated anon call → SQLSTATE 28000
 *   3. MANDATE-05: Out-of-range max_weight → SQLSTATE 22023
 *   4. MANDATE-05: Invalid liquidity_preference enum → SQLSTATE 22023
 *   5. D-11 Reset: p_clear_fields nulls the listed field
 *   6. MANDATE-06 (ROADMAP SC4 Option A): Direct UPDATE on mandate columns
 *      as authenticated allocator is blocked (0 rows affected)
 *   7. Admin direct UPDATE via service-role client succeeds (unchanged)
 *
 * Gate: HAS_LIVE_DB (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 * Skips gracefully otherwise.
 */

advertiseLiveDbSkipReason("update-allocator-mandates-rpc");

describe("MANDATE-05 / MANDATE-06: update_allocator_mandates RPC", () => {
  let admin: SupabaseClient;
  let testUserId: string | null = null;
  const TEST_PASSWORD = "MandateRpcTest!-9f2c";

  beforeAll(() => {
    if (HAS_LIVE_DB) admin = createLiveAdminClient();
  });

  afterEach(async () => {
    if (HAS_LIVE_DB && testUserId) {
      await cleanupLiveDbRow(admin, { userIds: [testUserId] });
      testUserId = null;
    }
  });

  async function signInAsTestUser(email: string): Promise<SupabaseClient> {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY required for user-scoped tests",
      );
    }
    const userClient = createClient(LIVE_DB_URL!, anonKey);
    const { error } = await userClient.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (error) throw error;
    return userClient;
  }

  it.skipIf(!HAS_LIVE_DB)(
    "MANDATE-04: auth'd user RPC writes max_weight AND mandate_edited_at is populated within 5 seconds",
    async () => {
      const email = `mandate-rpc-ok-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);
      const testUserClient = await signInAsTestUser(email);

      const beforeCall = Date.now();
      const { error: rpcErr } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_max_weight: 0.25, p_correlation_ceiling: 0.6 },
      );
      expect(rpcErr).toBeNull();

      // Read back using service-role admin.
      const { data, error: selErr } = await admin
        .from("allocator_preferences")
        .select(
          "max_weight, correlation_ceiling, mandate_edited_at, edited_by_user_id",
        )
        .eq("user_id", testUserId!)
        .maybeSingle();
      expect(selErr).toBeNull();
      expect(data).not.toBeNull();
      expect(Number(data!.max_weight)).toBeCloseTo(0.25);
      expect(Number(data!.correlation_ceiling)).toBeCloseTo(0.6);
      expect(data!.mandate_edited_at).not.toBeNull();
      // MANDATE-04: mandate_edited_at within the last 5 seconds.
      const editedAt = new Date(data!.mandate_edited_at!).getTime();
      expect(editedAt).toBeGreaterThanOrEqual(beforeCall - 1000);
      expect(editedAt).toBeLessThanOrEqual(beforeCall + 5000);
      // edited_by_user_id marks an allocator self-edit (D-14).
      expect(data!.edited_by_user_id).toBeNull();
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "unauthenticated anon call: RPC rejects at the GRANT layer (42501) or inside the function body (28000)",
    async () => {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!anonKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required");
      }
      const anon = createClient(LIVE_DB_URL!, anonKey);
      const { error } = await anon.rpc("update_allocator_mandates", {
        p_max_weight: 0.25,
      });
      expect(error).not.toBeNull();
      // Two valid rejection paths, both defense-in-depth:
      //   42501 (insufficient_privilege at GRANT layer): migration 061's
      //     REVOKE ALL FROM anon + GRANT EXECUTE TO authenticated stops
      //     the anon role before the function body runs. This is the
      //     primary gate and the expected path in production.
      //   28000 (insufficient_privilege inside function body): the
      //     v_auth_uid IS NULL guard fires if a client somehow bypasses
      //     the GRANT (e.g., service_role calling without a JWT GUC).
      //   Message-text match covers PostgREST versions that wrap the
      //     underlying pg error without preserving the code field.
      expect(
        error!.code === "42501" ||
          error!.code === "28000" ||
          /permission denied|insufficient_privilege|no auth/i.test(
            error!.message,
          ),
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "out-of-range max_weight: RPC rejects with SQLSTATE 22023",
    async () => {
      const email = `mandate-rpc-range-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);
      const testUserClient = await signInAsTestUser(email);

      const { error } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_max_weight: 0.99 },
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023");
      expect(error!.message).toMatch(/max_weight must be between 0\.05 and 0\.50/);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "invalid liquidity_preference enum: RPC rejects with SQLSTATE 22023",
    async () => {
      const email = `mandate-rpc-enum-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);
      const testUserClient = await signInAsTestUser(email);

      const { error } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_liquidity_preference: "ultra" },
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe("22023");
      expect(error!.message).toMatch(
        /liquidity_preference must be high, medium, or low/,
      );
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "p_clear_fields: RPC nulls the listed field regardless of named-parameter value",
    async () => {
      const email = `mandate-rpc-clear-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);
      const testUserClient = await signInAsTestUser(email);

      // Seed a value first.
      const { error: seedErr } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_max_weight: 0.3 },
      );
      expect(seedErr).toBeNull();

      // Now clear it via p_clear_fields.
      const { error: clearErr } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_clear_fields: ["max_weight"] },
      );
      expect(clearErr).toBeNull();

      const { data } = await admin
        .from("allocator_preferences")
        .select("max_weight")
        .eq("user_id", testUserId!)
        .maybeSingle();
      expect(data?.max_weight).toBeNull();
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "MANDATE-06 (ROADMAP SC4 Option A): authenticated allocator direct UPDATE on mandate columns is blocked — 0 rows affected (allocator_prefs_self_update policy dropped in migration 061)",
    async () => {
      const email = `mandate-direct-update-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);
      const testUserClient = await signInAsTestUser(email);

      // Seed via RPC first (the only allowed write path).
      const { error: seedErr } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_max_weight: 0.25 },
      );
      expect(seedErr).toBeNull();

      // Attempt a direct UPDATE as the authenticated allocator — MANDATE-06
      // Option A: this must affect 0 rows because allocator_prefs_self_update
      // was DROPPED in migration 061. Depending on PostgREST version, either:
      //   (a) error is null + data is empty (RLS hides the row), or
      //   (b) error is a permission-denied message.
      const { data: updateData, error: updateErr } = await testUserClient
        .from("allocator_preferences")
        .update({ max_weight: 0.40 })
        .eq("user_id", testUserId!)
        .select();

      if (updateErr) {
        // RLS rejected at PostgREST layer — acceptable.
        expect(/permission|policy|denied/i.test(updateErr.message)).toBe(true);
      } else {
        // No error — data MUST be empty (0 rows affected).
        expect(updateData).toEqual([]);
      }

      // Verify the value was NOT overwritten — still 0.25 from the RPC seed.
      const { data } = await admin
        .from("allocator_preferences")
        .select("max_weight")
        .eq("user_id", testUserId!)
        .maybeSingle();
      expect(Number(data!.max_weight)).toBeCloseTo(0.25);
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "admin direct UPDATE via service-role client succeeds (allocator_prefs_admin_all policy unchanged)",
    async () => {
      const email = `mandate-admin-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);
      const testUserClient = await signInAsTestUser(email);

      // Seed a mandate row via allocator path so the admin UPDATE has a target.
      await testUserClient.rpc("update_allocator_mandates", {
        p_max_weight: 0.25,
      });

      // Admin direct UPDATE via service-role — bypasses RLS entirely.
      // Simulates the /api/admin/match/preferences path.
      const adminPlaceholderId = testUserId; // in real code: acting admin's id
      const { error: upErr } = await admin
        .from("allocator_preferences")
        .update({ min_sharpe: 1.5, edited_by_user_id: adminPlaceholderId })
        .eq("user_id", testUserId!);
      expect(upErr).toBeNull();

      const { data } = await admin
        .from("allocator_preferences")
        .select("min_sharpe, edited_by_user_id, max_weight")
        .eq("user_id", testUserId!)
        .maybeSingle();
      expect(Number(data!.min_sharpe)).toBe(1.5);
      expect(data!.edited_by_user_id).not.toBeNull();
      // Allocator-seeded value preserved.
      expect(Number(data!.max_weight)).toBeCloseTo(0.25);
    },
    60_000,
  );
});
