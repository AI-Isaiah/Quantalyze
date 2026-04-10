/**
 * Shared live-DB test helpers for Vitest integration tests.
 *
 * Vitest integration tests that exercise real Postgres behavior (triggers,
 * RLS, RPCs, column grants) need a service-role Supabase client to set up
 * fixtures and a way to skip gracefully when env vars aren't present (CI
 * without a live DB).
 *
 * This module centralizes:
 *   - Env var reads + `HAS_LIVE_DB` skip gate
 *   - Service-role admin client factory
 *   - Test user creation (wraps `auth.admin.createUser` + profile upsert)
 *   - Reusable cleanup helper that reports failures loudly
 *
 * Keep this file free of `server-only` so Vitest (jsdom env) can import it.
 * The parallel production helper `src/lib/supabase/admin.ts` has
 * `import "server-only"` which throws in non-server test environments.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const LIVE_DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const LIVE_DB_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const HAS_LIVE_DB = Boolean(LIVE_DB_URL && LIVE_DB_SERVICE_ROLE_KEY);

/**
 * Create a service-role Supabase client for test fixture setup. Only call
 * this inside an `it.skipIf(!HAS_LIVE_DB)` block — it throws when the env
 * vars are absent, by design. The thrown error is cleaner than silently
 * returning a dead client.
 */
export function createLiveAdminClient(): SupabaseClient {
  if (!HAS_LIVE_DB) {
    throw new Error(
      "createLiveAdminClient called without NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY. Gate the test with it.skipIf(!HAS_LIVE_DB).",
    );
  }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!);
}

/**
 * Create a test user (auth.users + profiles row) via the service-role
 * admin client. Returns the new user id. Throws on failure.
 */
export async function createTestUser(
  admin: SupabaseClient,
  email: string,
  password?: string,
): Promise<string> {
  const pw = password ?? `LiveDbTest${Date.now()}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pw,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create test user ${email}: ${error?.message}`);
  }
  // Ensure profile row exists. The signup trigger normally handles this,
  // but we don't want to race the trigger in tests.
  await admin
    .from("profiles")
    .upsert({ id: data.user.id, display_name: email }, { onConflict: "id" });
  return data.user.id;
}

/** Cleanup tracker — pass IDs of resources to delete at test end. */
export interface LiveDbCleanupRow {
  strategyIds?: string[];
  apiKeyIds?: string[];
  userIds?: string[];
}

/**
 * Delete test fixtures in dependency order. Reports individual failures
 * via `console.warn` rather than swallowing them, so orphan rows are
 * visible in the test output even if the test itself passed.
 */
export async function cleanupLiveDbRow(
  admin: SupabaseClient,
  row: LiveDbCleanupRow,
): Promise<void> {
  const failures: string[] = [];

  for (const id of row.strategyIds ?? []) {
    try {
      await admin.from("strategies").delete().eq("id", id);
    } catch (err) {
      failures.push(`strategies ${id}: ${(err as Error).message}`);
    }
  }
  for (const id of row.apiKeyIds ?? []) {
    try {
      await admin.from("api_keys").delete().eq("id", id);
    } catch (err) {
      failures.push(`api_keys ${id}: ${(err as Error).message}`);
    }
  }
  for (const id of row.userIds ?? []) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch (err) {
      failures.push(`user ${id}: ${(err as Error).message}`);
    }
  }

  if (failures.length > 0) {
    console.warn(
      `[live-db cleanup] Failures (orphan rows may remain in live DB):\n  ${failures.join("\n  ")}`,
    );
  }
}

/**
 * Advertise why the live-DB tests were skipped. Call from a non-gated
 * `it(...)` at the end of the describe block so the reason is visible
 * in the test output.
 */
export function advertiseLiveDbSkipReason(testFileLabel: string): void {
  if (!HAS_LIVE_DB) {
    console.warn(
      `[${testFileLabel}] Skipping live-DB tests. Set ` +
        `NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable.`,
    );
  }
}
