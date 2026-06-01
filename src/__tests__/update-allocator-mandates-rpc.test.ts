import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  createLiveAdminClient,
  cleanupLiveDbRow,
  signInAsTestUser,
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
 *   2. MANDATE-05: Unauthenticated anon call → GRANT-layer denial
 *      ("permission denied for function", SQLSTATE 42501); anon REVOKEd in
 *      migration 061 so the function body never runs
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
  // H-0038: track the created user id for afterEach cleanup. The shared
  // signInAsTestUser helper creates the user, signs in, and (via this
  // callback) records the id so cleanup is identical across tests.
  const trackForCleanup = (userId: string) => {
    testUserId = userId;
  };

  beforeAll(() => {
    if (HAS_LIVE_DB) admin = createLiveAdminClient();
  });

  afterEach(async () => {
    if (HAS_LIVE_DB && testUserId) {
      await cleanupLiveDbRow(admin, { userIds: [testUserId] });
      testUserId = null;
    }
  });

  it.skipIf(!HAS_LIVE_DB)(
    "MANDATE-04: auth'd user RPC writes max_weight AND mandate_edited_at is populated within 5 seconds",
    async () => {
      const { client: testUserClient } = await signInAsTestUser(
        admin,
        "mandate-rpc-ok",
        trackForCleanup,
      );

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
    "unauthenticated anon call: RPC is rejected at the GRANT layer (42501 insufficient_privilege) — anon REVOKEd in migration 061, function body never runs",
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
      // H-0039 (second-pass fix): the GRANT-layer denial and the function's
      // body auth guard CANNOT be told apart by SQLSTATE — both are 42501.
      //   • GRANT layer (anon lacks EXECUTE, REVOKEd in mig 061): Postgres
      //     raises the standard "permission denied for function
      //     update_allocator_mandates" with SQLSTATE 42501.
      //   • Body guard (v_auth_uid IS NULL, mandate_columns.sql:128-129):
      //     RAISE 'update_allocator_mandates: no auth session'
      //       USING ERRCODE = 'insufficient_privilege'  ← ALSO 42501.
      //     (The migration's inline comment + COMMENT say "28000", but the
      //     RAISE actually emits insufficient_privilege = 42501. Unlike
      //     log_audit_event — switched to 28000 in NEW-C10-04 precisely to
      //     separate the layers — this RPC's guard was never given that
      //     treatment, so the codes are identical.)
      // The prior assertion pinned only the code (42501) and added a vacuous
      // `not.toBe("28000")` — which can NEVER fail because this RPC emits no
      // 28000. Under a regression that re-GRANTs anon EXECUTE (REVOKE drift),
      // anon reaches the body, the guard fires 42501 with the "no auth
      // session" message — code-only checks would STILL pass GREEN, hiding
      // the very security hole the test documents. So we distinguish the two
      // layers by MESSAGE TEXT, the only discriminator available:
      //   GRANT layer  → "permission denied for function ..." (Postgres std)
      //   body guard   → "...: no auth session"               (custom RAISE)
      const msg = error!.message ?? "";
      // The body-guard message must NOT appear: its presence proves anon
      // executed the function body, i.e. the REVOKE ALL FROM anon regressed.
      expect(
        msg,
        `Anon reached the function BODY (got the v_auth_uid-IS-NULL guard message), proving REVOKE ALL FROM anon in mig 061 regressed. code=${error!.code} message=${msg}`,
      ).not.toMatch(/no auth session/i);
      // And the denial must be the GRANT-layer "permission denied for
      // function" signature (with SQLSTATE 42501). PostgREST surfaces the
      // permission-denied error verbatim; we accept a stripped code field
      // only when the standard permission-denied text is present.
      const isGrantLayerDenial =
        /permission denied for function/i.test(msg) ||
        (error!.code === "42501" && !/no auth session/i.test(msg));
      expect(
        isGrantLayerDenial,
        `Expected GRANT-layer "permission denied for function" denial (anon REVOKEd in mig 061). Got code=${error!.code} message=${msg}.`,
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "out-of-range max_weight: RPC rejects with SQLSTATE 22023",
    async () => {
      const { client: testUserClient } = await signInAsTestUser(
        admin,
        "mandate-rpc-range",
        trackForCleanup,
      );

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
      const { client: testUserClient } = await signInAsTestUser(
        admin,
        "mandate-rpc-enum",
        trackForCleanup,
      );

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
      const { client: testUserClient } = await signInAsTestUser(
        admin,
        "mandate-rpc-clear",
        trackForCleanup,
      );

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
      const { client: testUserClient } = await signInAsTestUser(
        admin,
        "mandate-direct-update",
        trackForCleanup,
      );

      // Seed via RPC first (the only allowed write path).
      const { error: seedErr } = await testUserClient.rpc(
        "update_allocator_mandates",
        { p_max_weight: 0.25 },
      );
      expect(seedErr).toBeNull();

      // Attempt a direct UPDATE as the authenticated allocator — MANDATE-06
      // Option A. allocator_prefs_self_update was DROPPED in migration 061
      // (verified by that migration's self-check). With NO permissive UPDATE
      // policy on allocator_preferences, PostgreSQL RLS finds zero updatable
      // rows: the UPDATE silently affects 0 rows and PostgREST returns
      //   error === null  AND  data === []  (the .select() of updated rows).
      //
      // H-0039: the prior assertion accepted EITHER an error (matching
      // /permission|policy|denied/) OR empty data — so a material behavior
      // change between PostgREST versions (usable error message vs. a
      // success-shaped empty response the UI might read as "saved!") would
      // pass either way. We now PIN the deterministic RLS outcome: no error,
      // empty data. A genuine permission-denied error here would be a real
      // behavior change worth surfacing, not silently absorbing.
      const { data: updateData, error: updateErr } = await testUserClient
        .from("allocator_preferences")
        .update({ max_weight: 0.40 })
        .eq("user_id", testUserId!)
        .select();

      expect(
        updateErr,
        `Expected no PostgREST error (RLS yields 0 rows, not a denial). Got: ${updateErr?.code} ${updateErr?.message}`,
      ).toBeNull();
      expect(updateData).toEqual([]);

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
      const { client: testUserClient } = await signInAsTestUser(
        admin,
        "mandate-admin",
        trackForCleanup,
      );

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
