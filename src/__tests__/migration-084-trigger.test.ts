/**
 * Integration test — Migration 084 first_api_key_added_at + first_sync_success_at primitives.
 *
 * Phase 11 Plan 01 Task 2. Verifies the trigger + RPC behavior contract
 * against a live Supabase database:
 *
 *   1. AFTER INSERT trigger on api_keys stamps first_api_key_added_at
 *      on auth.users.raw_user_meta_data on the FIRST insert per user.
 *   2. The trigger is idempotent — a second api_keys row preserves the
 *      original marker timestamp byte-identically.
 *   3. stamp_first_sync_success(p_user_id) RPC stamps first_sync_success_at
 *      when absent.
 *   4. The RPC is idempotent — a second call preserves the original marker.
 *   5. Defensive NULL-init case (RISK-3): even when raw_user_meta_data is
 *      cleared (NULL or empty JSONB), the trigger's COALESCE merge
 *      succeeds without a NOT-NULL violation or JSONB-typed exception.
 *
 * Why live-DB, not a unit test
 * ----------------------------
 * The trigger is enforced by Postgres itself on auth.users — a restricted
 * schema that cannot be reached via RLS-routed PostgREST clients.
 * SECURITY DEFINER + AFTER INSERT semantics are observable only through
 * a real round-trip. A mocked client would silently accept any call and
 * prove nothing.
 *
 * Gate: requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 * The full NULL-init defensive case (Test 5a) additionally requires
 * `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` to run raw UPDATE on
 * auth.users via the Management API. When introspection is unavailable,
 * Test 5b runs the empty-object approximation as a fallback (sufficient
 * to exercise the COALESCE branch at the JSONB-merge level).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   # Optional, for full NULL-init coverage:
 *   export SUPABASE_ACCESS_TOKEN=...
 *   export SUPABASE_PROJECT_REF=...
 *   npx vitest run src/__tests__/migration-084-trigger.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  runIntrospectionSql,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

// ISO-8601 UTC with millisecond precision — matches the to_char format
// in migration 084: 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'.
const ISO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Insert an api_keys row using only NOT-NULL columns. The trigger fires
// regardless of column content; placeholders are sufficient.
async function insertApiKey(
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
      api_key_encrypted: "placeholder-key",
      api_secret_encrypted: "placeholder-secret",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to insert api_keys row (${label}): ${error?.message}`);
  }
  return data.id as string;
}

// Read auth.users.raw_user_meta_data via the admin API. Returns the
// user_metadata JSON object (which mirrors raw_user_meta_data 1:1 in the
// admin SDK shape).
async function readUserMeta(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    throw new Error(`Failed to read user ${userId}: ${error?.message}`);
  }
  // user_metadata mirrors raw_user_meta_data; some Supabase versions
  // expose it as user_metadata, others as raw_user_meta_data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = data.user as any;
  return (u.user_metadata ?? u.raw_user_meta_data ?? {}) as Record<string, unknown>;
}

describe("Migration 084 — first_api_key_added trigger + stamp_first_sync_success RPC", () => {
  const cleanupUserIds: string[] = [];
  const cleanupApiKeyIds: string[] = [];

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    const admin = createLiveAdminClient();
    await cleanupLiveDbRow(admin, {
      apiKeyIds: cleanupApiKeyIds,
      userIds: cleanupUserIds,
    });
  });

  it.skipIf(!HAS_LIVE_DB)(
    "Test 1: api_keys INSERT stamps first_api_key_added_at with ISO-8601 ms timestamp",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(admin, `mig084-t1-${ts}@test.sec`);
      cleanupUserIds.push(userId);

      // Pre-condition: marker absent.
      const metaBefore = await readUserMeta(admin, userId);
      expect(metaBefore.first_api_key_added_at).toBeUndefined();

      const keyId = await insertApiKey(admin, userId, "t1-first");
      cleanupApiKeyIds.push(keyId);

      const metaAfter = await readUserMeta(admin, userId);
      expect(metaAfter.first_api_key_added_at).toMatch(ISO_MS_RE);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Test 2: second api_keys INSERT preserves first_api_key_added_at byte-identically",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(admin, `mig084-t2-${ts}@test.sec`);
      cleanupUserIds.push(userId);

      const firstKeyId = await insertApiKey(admin, userId, "t2-first");
      cleanupApiKeyIds.push(firstKeyId);

      const meta1 = await readUserMeta(admin, userId);
      const firstMarker = meta1.first_api_key_added_at as string;
      expect(firstMarker).toMatch(ISO_MS_RE);

      // Sleep briefly so a non-idempotent trigger would observably bump
      // the marker; idempotent trigger must NOT change it.
      await new Promise((r) => setTimeout(r, 50));

      const secondKeyId = await insertApiKey(admin, userId, "t2-second");
      cleanupApiKeyIds.push(secondKeyId);

      const meta2 = await readUserMeta(admin, userId);
      expect(meta2.first_api_key_added_at).toBe(firstMarker);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Test 3: stamp_first_sync_success RPC stamps first_sync_success_at with ISO-8601 ms timestamp",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(admin, `mig084-t3-${ts}@test.sec`);
      cleanupUserIds.push(userId);

      // Pre-condition: marker absent.
      const metaBefore = await readUserMeta(admin, userId);
      expect(metaBefore.first_sync_success_at).toBeUndefined();

      const { error } = await admin.rpc("stamp_first_sync_success", {
        p_user_id: userId,
      });
      expect(error).toBeNull();

      const metaAfter = await readUserMeta(admin, userId);
      expect(metaAfter.first_sync_success_at).toMatch(ISO_MS_RE);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Test 4: second stamp_first_sync_success RPC call preserves marker byte-identically",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(admin, `mig084-t4-${ts}@test.sec`);
      cleanupUserIds.push(userId);

      const { error: e1 } = await admin.rpc("stamp_first_sync_success", {
        p_user_id: userId,
      });
      expect(e1).toBeNull();

      const meta1 = await readUserMeta(admin, userId);
      const firstMarker = meta1.first_sync_success_at as string;
      expect(firstMarker).toMatch(ISO_MS_RE);

      await new Promise((r) => setTimeout(r, 50));

      const { error: e2 } = await admin.rpc("stamp_first_sync_success", {
        p_user_id: userId,
      });
      expect(e2).toBeNull();

      const meta2 = await readUserMeta(admin, userId);
      expect(meta2.first_sync_success_at).toBe(firstMarker);
    },
    30_000,
  );

  // Test 5a — RISK-3 full coverage: requires Management API access to
  // run a raw `UPDATE auth.users SET raw_user_meta_data = NULL`. The
  // updateUserById admin shim cannot set the column to NULL (it always
  // writes an object), so this is the only path to exercise the true
  // NULL-initial-state case.
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "Test 5a (RISK-3): trigger handles raw_user_meta_data = NULL initial state without exception",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(admin, `mig084-t5a-${ts}@test.sec`);
      cleanupUserIds.push(userId);

      // Force the column to NULL via the Management API. PostgREST does
      // not expose auth.users for direct UPDATE so this is the only
      // route. Quote-escape the userId UUID inline (it's machine-generated
      // by Supabase auth so injection risk is nil).
      await runIntrospectionSql(
        `UPDATE auth.users SET raw_user_meta_data = NULL WHERE id = '${userId}';`,
      );

      // Verify the NULL state landed.
      const verifyRows = await runIntrospectionSql<{
        is_null: boolean;
      }>(
        `SELECT raw_user_meta_data IS NULL AS is_null FROM auth.users WHERE id = '${userId}';`,
      );
      expect(verifyRows[0]?.is_null).toBe(true);

      // Now insert an api_keys row — the trigger MUST succeed despite
      // the NULL column. Without the COALESCE(..., '{}'::JSONB) defensive
      // merge, the `||` operator would propagate NULL and the UPDATE
      // would write NULL back — but the assertion below would still
      // pass falsely. So we additionally verify the marker was actually
      // written, which proves the merge produced a real JSONB value.
      const keyId = await insertApiKey(admin, userId, "t5a-null-init");
      cleanupApiKeyIds.push(keyId);

      // Read the column back via raw SQL — getUserById coerces NULL to
      // {}, which would mask a NULL-write bug.
      const afterRows = await runIntrospectionSql<{
        raw_user_meta_data: Record<string, unknown> | null;
      }>(
        `SELECT raw_user_meta_data FROM auth.users WHERE id = '${userId}';`,
      );
      const meta = afterRows[0]?.raw_user_meta_data;
      expect(meta).not.toBeNull();
      expect(meta?.first_api_key_added_at).toMatch(ISO_MS_RE);
    },
    30_000,
  );

  // Test 5b — RISK-3 fallback: when Management API is not configured,
  // approximate the NULL-init case by clearing user_metadata to {} via
  // the admin API. This still exercises the COALESCE-on-empty branch
  // at the JSONB-merge level (just not the strict NULL case). The full
  // NULL guarantee is enforced at install time by the migration's DO
  // verification — runtime regression coverage falls to Test 5a.
  it.skipIf(!HAS_LIVE_DB || HAS_INTROSPECTION)(
    "Test 5b (RISK-3 fallback): trigger handles cleared user_metadata without exception",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(admin, `mig084-t5b-${ts}@test.sec`);
      cleanupUserIds.push(userId);

      // Approximate NULL-init by clearing the metadata object.
      const { error: clearErr } = await admin.auth.admin.updateUserById(
        userId,
        { user_metadata: {} },
      );
      expect(clearErr).toBeNull();

      const metaCleared = await readUserMeta(admin, userId);
      expect(metaCleared.first_api_key_added_at).toBeUndefined();

      const keyId = await insertApiKey(admin, userId, "t5b-empty-init");
      cleanupApiKeyIds.push(keyId);

      const metaAfter = await readUserMeta(admin, userId);
      expect(metaAfter.first_api_key_added_at).toMatch(ISO_MS_RE);
    },
    30_000,
  );

  // Always-run informational test so the skip reason surfaces in CI logs.
  it("advertises live-DB skip reason when env is missing", () => {
    advertiseLiveDbSkipReason("migration-084-trigger.test.ts");
    expect(true).toBe(true);
  });
});
