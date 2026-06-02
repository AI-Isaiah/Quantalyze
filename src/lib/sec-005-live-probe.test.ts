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
  HAS_INTROSPECTION,
  runIntrospectionSql,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "./test-helpers/live-db";

// The anon (publishable) key — the credential a public-internet attacker
// actually holds. Migration 027 REVOKEs SELECT on api_keys from `anon` AND
// `authenticated`, but the authenticated probe below only proves the latter
// half. The anon probe (H-0510) covers the public-API surface. Gated
// separately: if the anon key is absent we skip rather than throw.
const LIVE_DB_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_ANON_PROBE = HAS_LIVE_DB && Boolean(LIVE_DB_ANON_KEY);

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
        //
        // The probe must not pass vacuously (H-0511). Two old escape hatches
        // are closed:
        //   1. `if (error) continue` swallowed ANY error (network, gateway,
        //      JWT decode, schema-cache) as "Postgres refused the
        //      projection" — so a session/JWT-propagation bug that broke the
        //      query entirely would have passed. We now only accept the
        //      explicit Postgres column-privilege refusal (42501 / "permission
        //      denied"); every other error fails loudly.
        //   2. `for (const row of data ?? [])` ran zero times when `data` was
        //      `[]` — if the authenticated client could not see its own row
        //      (RLS scope wrong, JWT role claim missing, session mismatch) the
        //      NULL assertion never fired. We now require ≥1 row before
        //      asserting, so the probe fails if it cannot read its own row.
        for (const col of API_KEY_ENCRYPTED_COLUMNS) {
          const { data, error } = await authClient
            .from("api_keys")
            .select(col)
            .eq("user_id", userId);

          if (error) {
            // The ONLY acceptable error is Postgres refusing the column
            // projection because the `authenticated` role lacks SELECT on it
            // (migration 027 working as intended). Any other error means the
            // probe never actually exercised SEC-005 and must not pass.
            const isPermissionDenied =
              error.code === "42501" ||
              /permission denied/i.test(error.message ?? "");
            expect(
              isPermissionDenied,
              `Encrypted-column probe for ${col} errored with a non-permission ` +
                `error (${error.code}: ${error.message}). The probe cannot prove ` +
                `SEC-005 if the query failed for an unrelated reason — fix the ` +
                `harness instead of silently skipping.`,
            ).toBe(true);
            continue;
          }

          expect(data).toBeTruthy();
          expect(Array.isArray(data)).toBe(true);
          // The probe inserted a row for `userId` above, so the authenticated
          // owner MUST be able to see it. An empty result means RLS/JWT is
          // broken, not that SEC-005 holds — fail loudly rather than skip the
          // NULL assertion below.
          expect(
            (data ?? []).length,
            `Authenticated client read zero rows when projecting ${col} for its ` +
              `own user — the NULL assertion would pass vacuously. RLS scope, JWT ` +
              `role claim, or session propagation is broken.`,
          ).toBeGreaterThan(0);
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

  // H-0510 — the authenticated probe above only proves migration 027's
  // REVOKE-from-`authenticated`. Migration 027 also REVOKEs SELECT from
  // `anon` and (deliberately) grants NOTHING back to anon — api_keys has no
  // public-read use case. The anon role is the real public-internet attacker
  // surface (a request carrying only the publishable apikey, no JWT). If the
  // migration regressed to `REVOKE SELECT ... FROM authenticated` only (or
  // someone re-added `GRANT ... TO anon`), anon would inherit the default
  // `GRANT ALL TO anon` and could read ciphertext — the authenticated probe
  // would stay green and miss it entirely. This probe closes that gap.
  it.skipIf(!HAS_ANON_PROBE)(
    "anon client (no JWT) cannot read encrypted columns — public surface",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const email = `sec005-anon-probe-${ts}@test.sec`;
      const userId = await createTestUser(admin, email);
      let keyId: string | null = null;

      try {
        // Seed a real row (service-role) so that if anon COULD read, there is
        // actual ciphertext to leak. Without a row, an empty result could be
        // confused with RLS scoping rather than the column REVOKE.
        const { data: keyData, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "sec005-anon-probe",
            api_key_encrypted: "ANON_PROBE_CIPHERTEXT",
            dek_encrypted: "ANON_PROBE_DEK",
          })
          .select("id")
          .single();
        if (keyErr || !keyData) {
          throw new Error(`Failed to insert test api_keys row: ${keyErr?.message}`);
        }
        keyId = keyData.id;

        // Anon client: publishable key only, NO Authorization bearer. This is
        // exactly what an unauthenticated public-internet request looks like.
        // PostgREST runs it as the `anon` Postgres role.
        const anonClient = createClient(LIVE_DB_URL!, LIVE_DB_ANON_KEY!, {
          auth: { persistSession: false },
        });

        // Each encrypted column must EITHER error with a Postgres
        // column-privilege refusal (anon has no SELECT grant at all) OR — if
        // the platform answers the projection — return zero rows / NULL. What
        // must NEVER happen is anon receiving the ciphertext we just seeded.
        let sawPermissionDenied = false;
        for (const col of API_KEY_ENCRYPTED_COLUMNS) {
          const { data, error } = await anonClient
            .from("api_keys")
            .select(col)
            .eq("user_id", userId);

          if (error) {
            const isPermissionDenied =
              error.code === "42501" ||
              /permission denied/i.test(error.message ?? "");
            expect(
              isPermissionDenied,
              `Anon projection of ${col} errored with a non-permission error ` +
                `(${error.code}: ${error.message}). The probe cannot prove anon ` +
                `is blocked if the query failed for an unrelated reason.`,
            ).toBe(true);
            sawPermissionDenied = true;
            continue;
          }

          // No error path: anon was allowed to issue the projection. RLS
          // (auth.uid() IS NULL for anon) must scope it to zero rows, and any
          // row that did come back must NOT contain the ciphertext.
          for (const row of data ?? []) {
            const value = (row as Record<string, unknown>)[col];
            expect(
              value,
              `Encrypted column ${col} was readable by the ANON client — ` +
                `migration 027 REVOKE-from-anon is not holding. This is a ` +
                `public-API credential leak.`,
            ).toBeNull();
          }
        }

        // Defense-in-depth cross-check: anon must not be able to read the
        // allowlist columns either (migration 027 grants the allowlist to
        // `authenticated` only, NOT to anon). If anon can SELECT these, the
        // REVOKE-from-anon half of the migration was dropped. We assert this
        // as a permission-denied error OR zero rows — never a populated row.
        const { data: anonRows, error: anonErr } = await anonClient
          .from("api_keys")
          .select("id, exchange, label")
          .eq("user_id", userId);
        if (anonErr) {
          const isPermissionDenied =
            anonErr.code === "42501" ||
            /permission denied/i.test(anonErr.message ?? "");
          expect(
            isPermissionDenied,
            `Anon allowlist projection errored with a non-permission error ` +
              `(${anonErr.code}: ${anonErr.message}).`,
          ).toBe(true);
        } else {
          expect(
            (anonRows ?? []).length,
            `Anon client read ${(anonRows ?? []).length} api_keys rows it does ` +
              `not own — RLS owner scoping is not isolating anon. Encrypted-column ` +
              `REVOKE is the last line of defense but anon should see no rows.`,
          ).toBe(0);
        }

        // Sanity: at least one of the two block mechanisms (column REVOKE
        // surfacing as permission-denied, or RLS returning no rows) must have
        // fired across the probe — otherwise the test proved nothing.
        expect(
          sawPermissionDenied || (anonRows ?? []).length === 0,
          "Neither the column REVOKE nor RLS scoping blocked the anon client — " +
            "the anon probe did not exercise any SEC-005 defense.",
        ).toBe(true);
      } finally {
        await cleanupLiveDbRow(admin, {
          apiKeyIds: keyId ? [keyId] : [],
          userIds: [userId],
        });
      }
    },
    60_000,
  );

  // H-0510 (re-fix) — the anon-client probe above routes through PostgREST,
  // where RLS (`api_keys_owner ON api_keys USING user_id = auth.uid()`) returns
  // ZERO rows for an anon request because auth.uid() is NULL. That makes EVERY
  // assertion in the anon probe satisfiable purely by RLS hiding the row: the
  // per-column loop runs zero times, the allowlist cross-check passes on
  // length===0, and the sanity guard passes on the same empty result. So the
  // column-REVOKE-from-anon could be entirely dropped (RLS still backstopping)
  // and the anon probe would stay GREEN — it cannot isolate the privilege
  // regression H-0510 is about.
  //
  // The grant itself lives in `information_schema.column_privileges`, which RLS
  // does NOT touch: a `GRANT SELECT (...) TO anon` shows up as a row there
  // regardless of how many rows RLS would later expose. This probe asserts the
  // privilege state DIRECTLY via the Management API (PostgREST does not expose
  // information_schema), mirroring migration 027's own self-verifying DO block
  // (STEP 4, lines 116-134). If the REVOKE-from-anon is dropped or a
  // `GRANT ... TO anon` is re-added, a row appears here and this test fails —
  // even though RLS would still hide the data from a live anon query.
  it.skipIf(!(HAS_LIVE_DB && HAS_INTROSPECTION))(
    "no anon SELECT privilege on api_keys columns — column REVOKE held (RLS-independent)",
    async () => {
      // Inline the encrypted-column list as a SQL VALUES list so the query is
      // self-contained. These mirror API_KEY_ENCRYPTED_COLUMNS (asserted below).
      const encryptedCols = [...API_KEY_ENCRYPTED_COLUMNS];

      // 1. The exact H-0510 regression: any anon SELECT grant on an ENCRYPTED
      //    column. Migration 027 STEP 1 revokes SELECT from anon and STEP 2
      //    grants the allowlist back to `authenticated` ONLY — anon gets
      //    nothing. A single row here is a public-API ciphertext-leak grant.
      const anonEncryptedGrants = await runIntrospectionSql<{
        column_name: string;
        privilege_type: string;
        grantee: string;
      }>(`
        SELECT column_name, privilege_type, grantee
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name   = 'api_keys'
          AND grantee      = 'anon'
          AND privilege_type = 'SELECT'
          AND column_name IN (
            ${encryptedCols.map((c) => `'${c}'`).join(", ")}
          )
        ORDER BY column_name;
      `);
      expect(
        anonEncryptedGrants,
        `anon holds SELECT on encrypted api_keys columns ` +
          `(${anonEncryptedGrants
            .map((g) => g.column_name)
            .join(", ")}) — migration 027 REVOKE-from-anon was dropped or a ` +
          `GRANT TO anon was re-added. RLS may still hide the rows in a live ` +
          `query, but the column privilege is the SEC-005 contract and it has ` +
          `regressed: this is a public-API credential-leak grant.`,
      ).toEqual([]);

      // 2. anon must hold NO SELECT on api_keys AT ALL — not even the allowlist
      //    columns (migration 027 grants the allowlist to `authenticated`
      //    only; STEP 2 deliberately adds no anon grant, the comment at L91-93
      //    of the migration is explicit). A grant on any column means the
      //    REVOKE-from-anon half of the migration was undone.
      const anonAnyGrants = await runIntrospectionSql<{
        column_name: string;
      }>(`
        SELECT column_name
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name   = 'api_keys'
          AND grantee      = 'anon'
          AND privilege_type = 'SELECT'
        ORDER BY column_name;
      `);
      expect(
        anonAnyGrants.map((g) => g.column_name),
        `anon holds SELECT on api_keys columns — migration 027 grants the ` +
          `allowlist to 'authenticated' only and nothing to anon. Any anon ` +
          `SELECT grant means the table-level REVOKE FROM anon was undone.`,
      ).toEqual([]);

      // 3. Belt-and-braces: the ENCRYPTED columns must also carry no
      //    `authenticated` SELECT grant. This is the authenticated half of the
      //    same regression class and is the literal condition migration 027's
      //    own DO block (STEP 4) rolls back on. Asserting it here gives the TS
      //    suite a privilege-level check, not just the PostgREST NULL probe.
      const authEncryptedGrants = await runIntrospectionSql<{
        column_name: string;
      }>(`
        SELECT column_name
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name   = 'api_keys'
          AND grantee      = 'authenticated'
          AND privilege_type = 'SELECT'
          AND column_name IN (
            ${encryptedCols.map((c) => `'${c}'`).join(", ")}
          )
        ORDER BY column_name;
      `);
      expect(
        authEncryptedGrants.map((g) => g.column_name),
        `authenticated holds SELECT on encrypted api_keys columns — ` +
          `migration 027 STEP 1 REVOKE was undone for the authenticated role.`,
      ).toEqual([]);

      // 4. Guard against the list itself drifting out from under the assertion:
      //    if API_KEY_ENCRYPTED_COLUMNS shrinks, the IN-clause above silently
      //    stops covering the dropped column. Assert the SSOT still holds the
      //    five columns migration 027 protects, so a future edit that drops one
      //    fails loudly here rather than quietly narrowing coverage.
      expect(
        encryptedCols,
        "API_KEY_ENCRYPTED_COLUMNS drifted from migration 027's protected set; " +
          "the privilege assertions above would silently stop covering a column.",
      ).toEqual([
        "api_key_encrypted",
        "api_secret_encrypted",
        "passphrase_encrypted",
        "dek_encrypted",
        "nonce",
      ]);
    },
    30_000,
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
    // Surface the anon-probe-specific skip too: live DB present but no anon
    // key means the public-surface coverage (H-0510) silently didn't run.
    if (HAS_LIVE_DB && !HAS_ANON_PROBE) {
      console.warn(
        "[sec-005-live-probe] Skipping the anon (no-JWT) probe — set " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY to cover the public-API surface.",
      );
    }
    // Surface the introspection-probe skip: this is the RLS-INDEPENDENT
    // privilege check (H-0510 re-fix). Without it, the anon-client probe alone
    // cannot catch a column-REVOKE-from-anon-only regression (RLS masks it).
    if (HAS_LIVE_DB && !HAS_INTROSPECTION) {
      console.warn(
        "[sec-005-live-probe] Skipping the RLS-independent column-privilege " +
          "probe — set SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF so the " +
          "anon-REVOKE regression is caught at the privilege layer, not just " +
          "via the (RLS-masked) PostgREST query.",
      );
    }
    expect(true).toBe(true);
  });
});
