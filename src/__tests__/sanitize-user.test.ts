/**
 * Integration test — Migration 055 sanitize_user RPC.
 *
 * Sprint 6 closeout Task 7.3. Verifies three invariants against a live
 * Supabase database:
 *
 *   1. IDEMPOTENCY: calling sanitize_user twice on the same user is a
 *      no-op on the second call. The second call returns 0 rows mutated.
 *   2. AUDIT TRAIL PRESERVED: any audit_log rows attributed to the
 *      sanitized user survive the sanitize. The migration 049 deny
 *      policies enforce this at the DB layer; this test is a
 *      belt-and-suspenders assertion that the sanitize_user RPC doesn't
 *      somehow bypass the deny.
 *   3. API KEYS PURGED: every api_keys row owned by the user is deleted.
 *      The row IS the credential — no anonymization short of DELETE is
 *      defensible.
 *
 * Plus a cross-table cascade sanity: if a user has a pending deletion
 * request AND a strategy with pending intro, the sanitize should
 * succeed (blocking or cascading per the migration 055 per-table
 * matrix — blocking would surface as an RPC error).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and migration 055 applied. Skips gracefully otherwise.
 */

import { describe, it, expect } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

async function seedApiKey(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: userId,
      exchange: "binance",
      label,
      api_key_encrypted: "ct",
      dek_encrypted: "dct",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedApiKey failed: ${error?.message}`);
  }
  return data.id;
}

async function seedAuditRow(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  marker: string,
): Promise<string> {
  const { data, error } = await admin
    .from("audit_log")
    .insert({
      user_id: userId,
      action: `__sanitize_test_${marker}`,
      entity_type: "test_probe",
      entity_id: crypto.randomUUID(),
      metadata: { marker },
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedAuditRow failed: ${error?.message}`);
  }
  return data.id;
}

describe("Migration 055 — sanitize_user RPC", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "idempotent: double-call leaves the user fully sanitized with no errors",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[]; apiKeyIds: string[] } = {
        userIds: [],
        apiKeyIds: [],
      };

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-idem-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        await seedApiKey(admin, userId, "idem-key");

        // First call — should mutate at least the profiles row.
        const { data: firstResult, error: firstErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: userId },
        );
        expect(firstErr).toBeNull();
        expect(firstResult).toBeGreaterThanOrEqual(1);

        // Profile should now be anonymized
        const { data: profile } = await admin
          .from("profiles")
          .select("display_name, email")
          .eq("id", userId)
          .single();
        expect(profile?.display_name).toBe("[deleted]");
        expect(profile?.email).toBeNull();

        // Second call — idempotent no-op
        const { data: secondResult, error: secondErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: userId },
        );
        expect(secondErr).toBeNull();
        expect(secondResult).toBe(0);

        // Profile still anonymized (unchanged)
        const { data: profileAfter } = await admin
          .from("profiles")
          .select("display_name, email")
          .eq("id", userId)
          .single();
        expect(profileAfter?.display_name).toBe("[deleted]");
        expect(profileAfter?.email).toBeNull();
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "audit trail preserved: audit_log rows survive sanitize_user",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const auditIds: string[] = [];

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-audit-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // Seed two audit rows for this user
        auditIds.push(await seedAuditRow(admin, userId, `pre-${ts}-1`));
        auditIds.push(await seedAuditRow(admin, userId, `pre-${ts}-2`));

        // Run sanitize
        const { error: rpcErr } = await admin.rpc("sanitize_user", {
          p_user_id: userId,
        });
        expect(rpcErr).toBeNull();

        // Audit rows must still exist AND still attribute to userId
        // (the attribution is the whole point of the trail — the row
        // references a now-anonymized profiles row, but the user_id
        // FK is preserved).
        const { data: rows, error: readErr } = await admin
          .from("audit_log")
          .select("id, user_id, action")
          .in("id", auditIds);
        expect(readErr).toBeNull();
        expect(rows?.length).toBe(2);
        for (const row of rows ?? []) {
          expect(row.user_id).toBe(userId);
        }
      } finally {
        // Clean up audit rows via the service-role bypass — migration
        // 049 denies UPDATE/DELETE via PostgREST but service-role is
        // bypassed for cleanup scripts; if the REVOKE is enforced the
        // rows will leak as documented in the helper warn path.
        for (const id of auditIds) {
          await admin.from("audit_log").delete().eq("id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "api_keys purged: zero rows remain for the user after sanitize",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-keys-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // Seed two keys
        await seedApiKey(admin, userId, "key-1");
        await seedApiKey(admin, userId, "key-2");

        const { count: before } = await admin
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        expect(before).toBe(2);

        const { error: rpcErr } = await admin.rpc("sanitize_user", {
          p_user_id: userId,
        });
        expect(rpcErr).toBeNull();

        const { count: after } = await admin
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        expect(after).toBe(0);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "cascade: user with a pending contact_request (intro) + strategy is sanitized without error",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: {
        userIds: string[];
        strategyIds: string[];
      } = { userIds: [], strategyIds: [] };

      try {
        // Create manager (strategy owner) + allocator (contact_request
        // originator). We sanitize the allocator — the contact_request
        // row preserves per the matrix.
        const managerId = await createTestUser(
          admin,
          `sanitize-manager-${ts}@test.sec`,
        );
        const allocatorId = await createTestUser(
          admin,
          `sanitize-allocator-${ts}@test.sec`,
        );
        cleanup.userIds.push(managerId, allocatorId);

        const { data: strategy, error: sErr } = await admin
          .from("strategies")
          .insert({ user_id: managerId, name: "Cascade probe strategy" })
          .select("id")
          .single();
        if (sErr || !strategy) {
          throw new Error(`strategy seed: ${sErr?.message}`);
        }
        cleanup.strategyIds.push(strategy.id);

        // Seed the contact_request (pending intro)
        const { data: cr, error: crErr } = await admin
          .from("contact_requests")
          .insert({
            allocator_id: allocatorId,
            strategy_id: strategy.id,
            message: "pending probe intro",
            status: "pending",
          })
          .select("id")
          .single();
        if (crErr || !cr) {
          throw new Error(`contact_request seed: ${crErr?.message}`);
        }

        // Sanitize the allocator. The per-table matrix says
        // contact_requests are PRESERVED (cross-party audit), so the
        // call must succeed — NOT throw a FK-cascade error.
        const { error: rpcErr } = await admin.rpc("sanitize_user", {
          p_user_id: allocatorId,
        });
        expect(rpcErr).toBeNull();

        // Contact request still exists
        const { data: crAfter, error: crReadErr } = await admin
          .from("contact_requests")
          .select("id, allocator_id, status")
          .eq("id", cr.id)
          .maybeSingle();
        expect(crReadErr).toBeNull();
        expect(crAfter?.id).toBe(cr.id);
        expect(crAfter?.allocator_id).toBe(allocatorId);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("sanitize-user");
    expect(true).toBe(true);
  });
});
