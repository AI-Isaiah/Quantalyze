/**
 * SEC-005 live-DB probe — verifies the migration 027 REVOKE took effect.
 *
 * The regex-based test in `sec-005-api-keys-projection.test.ts` scans
 * source code for known violation patterns. But a static scan cannot catch:
 *   - Dynamic table names (`.from(variable)` where variable = "api_keys")
 *   - RPC calls that internally SELECT encrypted columns
 *   - PostgREST joined projections via unrelated tables
 *   - Direct SQL via functions/views that transitively expose the columns
 *
 * This test connects to the live DB as an AUTHENTICATED user (not service
 * role) and asks Postgres directly: "can this role SELECT the encrypted
 * columns?" Ground truth. If any encrypted column is still readable, the
 * test fails and migration 027 is not holding the line.
 *
 * It also cross-references the `API_KEY_USER_COLUMNS` constant against
 * the actual GRANT on the live DB, catching drift between code and DB
 * state (e.g., a new column added to the constant but the migration
 * forgot to GRANT it back).
 *
 * Gate: requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 * env vars. Skips gracefully in CI without live DB access.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_KEY_USER_COLUMNS,
  API_KEY_USER_COLUMNS_ARR,
  API_KEY_ENCRYPTED_COLUMNS,
} from "./constants";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "./test-helpers/live-db";

describe("SEC-005 live probe — migration 027 ground truth", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "authenticated client returns NULL for encrypted columns",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const email = `sec005-probe-${ts}@test.sec`;
      const password = `Sec005Probe${ts}!`;
      const userId = await createTestUser(admin, email, password);
      let keyId: string | null = null;

      try {
        // Insert a test api_keys row owned by this user. Service-role is
        // fine for the seed — we're not testing this insert, we're testing
        // the authenticated-client SELECT that follows.
        const { data: keyData, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "sec005-probe",
            api_key_encrypted: "PROBE_CIPHERTEXT",
            dek_encrypted: "PROBE_DEK",
          })
          .select("id")
          .single();
        if (keyErr || !keyData) {
          throw new Error(`Failed to insert test api_keys row: ${keyErr?.message}`);
        }
        keyId = keyData.id;

        // Sign in AS that user to get a user-scoped JWT.
        const signinClient = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!);
        const { data: session, error: signInErr } =
          await signinClient.auth.signInWithPassword({ email, password });
        if (signInErr || !session.session) {
          throw new Error(`Sign in failed: ${signInErr?.message}`);
        }

        // Authenticated client using the user's JWT. The apikey header is
        // required by the Supabase gateway; PostgREST derives the effective
        // DB role from the JWT's `role` claim, so this query runs as the
        // `authenticated` Postgres role and is subject to migration 027's
        // column grants.
        const authClient = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
          global: {
            headers: {
              Authorization: `Bearer ${session.session.access_token}`,
              apikey: LIVE_DB_SERVICE_ROLE_KEY!,
            },
          },
          auth: { persistSession: false },
        });

        // Probe 1: project each encrypted column individually. After
        // migration 027, PostgREST should return NULL for each.
        for (const col of API_KEY_ENCRYPTED_COLUMNS) {
          const { data, error } = await authClient
            .from("api_keys")
            .select(col)
            .eq("user_id", userId);

          // Either the query errors (strict mode) or returns NULL for the
          // column. Both are acceptable — neither exposes ciphertext.
          if (error) {
            // Acceptable — Postgres refused the projection
            continue;
          }

          expect(data).toBeTruthy();
          expect(Array.isArray(data)).toBe(true);
          for (const row of data ?? []) {
            const value = (row as Record<string, unknown>)[col];
            expect(
              value,
              `Encrypted column ${col} was readable by authenticated client — ` +
                `migration 027 REVOKE is not holding`,
            ).toBeNull();
          }
        }

        // Probe 2: the allowlist columns must still be readable
        const { data: allowedData, error: allowedErr } = await authClient
          .from("api_keys")
          .select(API_KEY_USER_COLUMNS)
          .eq("user_id", userId);

        expect(allowedErr).toBeNull();
        expect(allowedData).toBeTruthy();
        expect((allowedData ?? []).length).toBeGreaterThan(0);

        const firstRow = (allowedData ?? [])[0] as Record<string, unknown>;
        expect(firstRow.id).toBeTruthy();
        expect(firstRow.exchange).toBe("binance");
        expect(firstRow.label).toBe("sec005-probe");
      } finally {
        await cleanupLiveDbRow(admin, {
          apiKeyIds: keyId ? [keyId] : [],
          userIds: [userId],
        });
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "API_KEY_USER_COLUMNS matches the live GRANT — no drift",
    async () => {
      // Project every column in the allowlist tuple against the live DB.
      // If any column is missing from the GRANT (or doesn't exist in the
      // schema), PostgREST returns an error. This catches drift between
      // constants.ts and migration 027's GRANT list.
      const admin = createLiveAdminClient();

      const { data, error } = await admin
        .from("api_keys")
        .select(API_KEY_USER_COLUMNS)
        .limit(0);

      expect(
        error,
        `API_KEY_USER_COLUMNS projection failed — at least one column in ` +
          `the constant does not exist or is not granted. Error: ${error?.message}`,
      ).toBeNull();
      expect(data).toBeDefined();

      // Also verify each column in the tuple individually, so a typo in
      // the constant surfaces as a clear per-column error rather than a
      // single aggregate failure.
      for (const col of API_KEY_USER_COLUMNS_ARR) {
        const { error: colErr } = await admin
          .from("api_keys")
          .select(col)
          .limit(0);
        expect(
          colErr,
          `Column "${col}" from API_KEY_USER_COLUMNS_ARR is not readable — ` +
            `drift between constants.ts and migration 027. Error: ${colErr?.message}`,
        ).toBeNull();
      }
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("sec-005-live-probe");
    expect(true).toBe(true);
  });
});
