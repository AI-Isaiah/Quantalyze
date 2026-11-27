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
import { PROD_PROJECT_REFS } from "@/lib/test-safety";

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

/** Options for {@link createTestApiKey}. Every `p_`-named writer argument is exposed. */
export interface CreateTestApiKeyOptions {
  /** Owner of the key (required). Immutable once written (DBACC-02). */
  userId: string;
  /** Default `"binance"`. */
  exchange?: string;
  /** Default `live-key-<epoch>`. */
  label?: string;
  /** Default a placeholder ciphertext literal. Never pass a real credential. */
  apiKeyEncrypted?: string;
  apiSecretEncrypted?: string;
  dekEncrypted?: string;
  kekVersion?: number;
  venueAccountId?: string;
  venueServer?: string;
  /** Caller-chosen key id (the writer's `p_id`). */
  id?: string;
  /**
   * Idempotent re-seed of `id`: when a row with that id already exists, skip the
   * insert. Replaces `.upsert(..., { onConflict: "id" })`, which the PR-C
   * BEFORE INSERT fence would refuse, because it fires on INSERT ... ON CONFLICT
   * before conflict resolution. Requires `id`.
   */
  ifAbsent?: boolean;
  /**
   * Columns the writer does not take (`is_active`, `created_at`,
   * `disconnected_at`, `sync_status`, `last_sync_at`, `account_balance_usdt`,
   * ...), applied by a follow-up admin UPDATE. May not name `user_id` or `id`.
   */
  extras?: Record<string, unknown>;
}

/**
 * Seed an `api_keys` row through the audited writer `insert_api_key` and return
 * its id. Throws on failure, naming the step.
 *
 * Why (DBACC-02, founder decision 2026-11-26): the PR-C fence refuses any
 * `api_keys` insert that is not the audited writer, `ON CONFLICT` upserts
 * included, and `api_keys.user_id` is immutable. Live tests therefore seed
 * through this one helper and never `.from("api_keys").insert` / `.upsert`.
 *
 * `insert_api_key` stamps `attested_venue = exchange`; a seed that needs it NULL
 * passes `extras: { attested_venue: null }` (the fence guards INSERT only).
 * Only call this inside an `it.skipIf(!HAS_LIVE_DB)` block with a client from
 * {@link createLiveAdminClient}.
 */
export async function createTestApiKey(
  admin: SupabaseClient,
  opts: CreateTestApiKeyOptions,
): Promise<string> {
  const { extras } = opts;
  if (extras && ("user_id" in extras || "id" in extras)) {
    throw new Error(
      "[createTestApiKey] extras may not set user_id or id (user_id is immutable, DBACC-02)",
    );
  }
  if (opts.ifAbsent && !opts.id) {
    throw new Error("[createTestApiKey] ifAbsent requires an id");
  }

  let id: string | undefined;
  if (opts.ifAbsent) {
    const { data: existing, error: lookupErr } = await admin
      .from("api_keys")
      .select("id, user_id")
      .eq("id", opts.id!)
      .maybeSingle();
    if (lookupErr) {
      throw new Error(
        `[createTestApiKey] ifAbsent lookup of ${opts.id} failed: ${lookupErr.message}`,
      );
    }
    if (existing) {
      if (existing.user_id !== opts.userId) {
        throw new Error(
          `[createTestApiKey] api_keys ${opts.id} already exists under another user_id; ` +
            "refusing to reuse it (user_id is immutable, DBACC-02)",
        );
      }
      id = existing.id as string;
    }
  }

  if (!id) {
    const args: Record<string, unknown> = {
      p_user_id: opts.userId,
      p_exchange: opts.exchange ?? "binance",
      p_label: opts.label ?? `live-key-${Date.now()}`,
      p_api_key_encrypted: opts.apiKeyEncrypted ?? "test-encrypted-placeholder",
      p_api_secret_encrypted: opts.apiSecretEncrypted,
      p_dek_encrypted: opts.dekEncrypted,
      p_kek_version: opts.kekVersion,
      p_venue_account_id: opts.venueAccountId,
      p_venue_server: opts.venueServer,
      p_id: opts.id,
    };
    for (const k of Object.keys(args)) {
      if (args[k] === undefined) delete args[k];
    }
    const { data, error } = await admin.rpc("insert_api_key", args);
    if (error || !data) {
      throw new Error(
        `[createTestApiKey] insert_api_key RPC failed: ${error?.message ?? "no id returned"}`,
      );
    }
    id = data as string;
  }

  if (extras && Object.keys(extras).length > 0) {
    const { error } = await admin.from("api_keys").update(extras).eq("id", id);
    if (error) {
      throw new Error(
        `[createTestApiKey] extras UPDATE of api_keys ${id} failed: ${error.message}`,
      );
    }
  }
  return id;
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

/**
 * The project ref the Management API is called with, or undefined.
 *
 * Only a well-formed hosted ref counts, and never a production one. A
 * loopback lane URL (`http://127.0.0.1:54421`) used to fall through the
 * `https://` regex unchanged, so a shell holding a real access token sent
 * that token to `api.supabase.com/v1/projects/http://127.0.0.1:54421/...`
 * (measured 2026-10-01, ~49 requests, all 404). And a developer env whose
 * URL or SUPABASE_PROJECT_REF names production would have run the
 * introspection SQL against production, which no other guard covers.
 */
function resolveIntrospectionRef(): string | undefined {
  const explicit = process.env.SUPABASE_PROJECT_REF;
  const fromUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
    /^https:\/\/([a-z0-9]{20})\.supabase\.co(?:\/|$)/,
  )?.[1];
  const ref = explicit ?? fromUrl;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) return undefined;
  if ((PROD_PROJECT_REFS as readonly string[]).includes(ref)) return undefined;
  return ref;
}

export const SUPABASE_PROJECT_REF = resolveIntrospectionRef();
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
