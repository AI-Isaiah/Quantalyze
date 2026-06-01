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

/**
 * Single live-DB test password convention (H-0038). Every live-DB test that
 * creates a user + signs in via `signInAsTestUser` shares this one constant
 * so the password rule is defined in exactly one place. Previously each test
 * file declared its own divergent constant (e.g. `MandateRpcTest!-9f2c` vs
 * `MandateAuditTest!-9f2c`), duplicating the convention.
 */
export const LIVE_DB_TEST_PASSWORD = "LiveDbTest!-9f2c";

/** Shape returned by {@link signInAsTestUser}. */
export interface SignedInTestUser {
  /** Anon-key client authenticated as the freshly created test user. */
  client: SupabaseClient;
  /** The new user's id (register for cleanup with `cleanupLiveDbRow`). */
  userId: string;
  /** The synthetic email the user was created with. */
  email: string;
}

/**
 * Create a fresh test user, sign them in via the anon key, and return the
 * authenticated client + ids (H-0038). Centralizes the copy-pasted
 * "anon-key check → createTestUser → createClient → signInWithPassword" flow
 * that lived in every mandate/audit live-DB test, and locks the password
 * convention to {@link LIVE_DB_TEST_PASSWORD} in one place.
 *
 * The email is `${prefix}-${Date.now()}@test.local`. The caller is
 * responsible for cleanup: register the returned `userId` with its existing
 * `afterEach` → `cleanupLiveDbRow(admin, { userIds: [userId] })`, or pass an
 * `onCleanup` callback to have it tracked here.
 *
 * Only call inside an `it.skipIf(!HAS_LIVE_DB)` block — it throws when the
 * anon key is absent, by design.
 */
export async function signInAsTestUser(
  admin: SupabaseClient,
  prefix: string,
  onCleanup?: (userId: string) => void,
): Promise<SignedInTestUser> {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY required for user-scoped live-DB tests",
    );
  }
  const email = `${prefix}-${Date.now()}@test.local`;
  const userId = await createTestUser(admin, email, LIVE_DB_TEST_PASSWORD);
  onCleanup?.(userId);

  const client = createClient(LIVE_DB_URL!, anonKey);
  const { error } = await client.auth.signInWithPassword({
    email,
    password: LIVE_DB_TEST_PASSWORD,
  });
  if (error) throw error;

  return { client, userId, email };
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
 * Whether introspection-via-Management-API is available. Tests that need to
 * read pg_catalog / information_schema (which PostgREST does NOT expose by
 * default) should gate on this in addition to HAS_LIVE_DB. Requires a
 * Supabase Management API access token in SUPABASE_ACCESS_TOKEN and the
 * project ref in SUPABASE_PROJECT_REF.
 */
export const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
export const SUPABASE_PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF ??
  (process.env.NEXT_PUBLIC_SUPABASE_URL
    ? process.env.NEXT_PUBLIC_SUPABASE_URL.replace(
        /^https:\/\/([^.]+).*/,
        "$1",
      )
    : undefined);
export const HAS_INTROSPECTION =
  Boolean(SUPABASE_ACCESS_TOKEN) && Boolean(SUPABASE_PROJECT_REF);

/**
 * Run a raw SQL query via the Supabase Management API. Returns the raw rows
 * (or throws on HTTP error). Gate calls with `it.skipIf(!HAS_INTROSPECTION)`.
 *
 * The Management API endpoint POST /v1/projects/{ref}/database/query accepts
 * `{ query: string }` and returns an array of result rows (or `[]` for DDL).
 * It is NOT subject to PostgREST schema-cache restrictions on pg_catalog /
 * information_schema, so this is the only path for tests that need to
 * introspect Postgres metadata.
 */
export async function runIntrospectionSql<
  T = Record<string, unknown>,
>(query: string): Promise<T[]> {
  if (!HAS_INTROSPECTION) {
    throw new Error(
      "runIntrospectionSql called without SUPABASE_ACCESS_TOKEN / " +
        "SUPABASE_PROJECT_REF. Gate the test with it.skipIf(!HAS_INTROSPECTION).",
    );
  }
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Management API query failed (${resp.status}): ${body.slice(0, 500)}`,
    );
  }
  return (await resp.json()) as T[];
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
