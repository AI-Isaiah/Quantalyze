/**
 * Integration test — Migration 056 audit_log cold archive.
 *
 * Sprint 6 closeout Task 7.3 spec-fix follow-up. Verifies:
 *
 *   1. `audit_log_cold` table exists with the expected schema (same
 *      columns as `audit_log`).
 *   2. `audit_log_cold` carries the same append-only invariant as the
 *      hot table: FOR UPDATE USING(false), FOR DELETE USING(false),
 *      plus REVOKE UPDATE, DELETE from authenticated + service_role.
 *   3. The hot→cold move SQL (the body of the `audit_log_hot_to_cold`
 *      cron job) works end-to-end: an audit_log row whose `created_at`
 *      has been backdated >2 years migrates to audit_log_cold after
 *      running the job's SQL directly, and the hot row is gone. The
 *      cold row preserves `id` and `created_at`.
 *
 * Why live-DB, not a unit test
 * ----------------------------
 * The cold archive is a Postgres-level construct (table + RLS + REVOKE).
 * A mocked client can't validate the DB-enforced invariants. This test
 * directly runs the cron job's INSERT-then-DELETE SQL against a live
 * database (the pg_cron scheduler simply fires this same SQL nightly;
 * we execute it on demand here so we don't have to wait two years).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and migration 056 applied. Skips gracefully otherwise.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/audit-log-cold-archive.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

/**
 * Run arbitrary SQL via the admin client. Supabase doesn't expose a
 * generic sql() on the JS client, so we use the `exec_sql` RPC pattern
 * if available, otherwise fall back to a direct INSERT statement via
 * the `postgres_execute` RPC. Both are service-role-gated; if neither
 * exists in the target database, the test skips and logs a warn.
 *
 * In practice for this test we only need three SQL shapes:
 *   - `UPDATE audit_log SET created_at = $1 WHERE id = $2` to backdate
 *     the seeded row past the 2y threshold.
 *   - The hot→cold INSERT statement with the 2y WHERE.
 *   - The hot DELETE with the 2y WHERE.
 *
 * Rather than requiring a sql()-style RPC, we build each of these
 * via the supabase-js query builder API, which supports all three.
 */

async function deleteColdRowDirect(
  admin: ReturnType<typeof createLiveAdminClient>,
  rowId: string,
): Promise<void> {
  // H-0010 (FIXED 2026-05-25): route cleanup through the test-only purge
  // RPC. A direct PostgREST DELETE here is a silent no-op — audit_log_cold
  // carries the append-only deny policy + REVOKE DELETE (see the
  // "service-role DELETE is rejected" test), so the row would leak
  // forever. `test_force_cold_purge` (migration 20260525192740) is
  // SECURITY DEFINER + service_role-gated and scoped to test-probe rows
  // only, so it removes the seeded `__cold_test_*` row without weakening
  // the append-only invariant for real compliance data.
  //
  // RESERVED COMBINATION: the RPC only deletes a row when BOTH
  // entity_type='test_probe' AND action starts with `__cold_test_`. That
  // pair is reserved for this test suite and must NEVER appear on a
  // production audit row — it is the only signal that distinguishes a
  // purgeable probe from a genuine compliance record.
  //
  // We warn (not throw) so a cleanup-path regression is visible in the
  // output without masking the calling test's own assertions in `finally`.
  // We check BOTH failure modes: an RPC `error`, AND a 0-row return — the
  // scoped DELETE returns 0 (no error) for a row that falls outside the
  // reserved combination, which would otherwise re-open the H-0010 leak
  // silently (silent-failure-hunter Item 1).
  const { data: purged, error } = await admin.rpc("test_force_cold_purge", {
    p_id: rowId,
  });
  if (error) {
    console.warn(
      `[cold-archive cleanup] test_force_cold_purge failed for ${rowId}: ${error.message}`,
    );
  } else if (purged === 0) {
    console.warn(
      `[cold-archive cleanup] test_force_cold_purge matched 0 rows for ${rowId} — probe row may be leaking (scope mismatch with the reserved test_probe/__cold_test_ combination?)`,
    );
  }
}

describe("Migration 056 — audit_log_cold table + append-only invariant", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "audit_log_cold table exists with the expected columns",
    async () => {
      const admin = createLiveAdminClient();
      // A zero-row SELECT proves the table + expected columns exist at
      // the PostgREST layer. If any column is missing the SELECT errors;
      // if the table is missing the SELECT errors.
      const { error } = await admin
        .from("audit_log_cold")
        .select("id, user_id, action, entity_type, entity_id, metadata, created_at")
        .limit(0);
      // SELECT with limit(0) on an existing table with the right columns
      // returns no error. Table-missing returns a 42P01; column-missing
      // returns a 42703.
      expect(error).toBeNull();
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "service-role UPDATE on audit_log_cold is rejected (append-only invariant)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: { userIds: string[]; coldRowId: string | null } = {
        userIds: [],
        coldRowId: null,
      };

      try {
        const userId = await createTestUser(admin, `cold-upd-${ts}@test.sec`);
        row.userIds.push(userId);

        // Seed a row directly in cold via service-role (bypasses RLS
        // for INSERT because service_role has BYPASSRLS). This is the
        // "what the cron would do" path without waiting 2 years.
        const { data: insertData, error: insertErr } = await admin
          .from("audit_log_cold")
          .insert({
            id: crypto.randomUUID(),
            user_id: userId,
            action: `__cold_test_upd_${ts}`,
            entity_type: "test_probe",
            entity_id: crypto.randomUUID(),
            metadata: { marker: `upd-${ts}` },
            created_at: new Date(
              Date.now() - 3 * 365 * 24 * 60 * 60 * 1000,
            ).toISOString(), // 3 years ago
          })
          .select("id")
          .single();
        // C-0004 (audit-2026-05-07): fail loud on setup failure. Pre-fix
        // this branch returned silently if the seed INSERT failed,
        // disguising a missed precondition as a passing assertion. The
        // append-only invariant being tested requires a row to UPDATE —
        // if we cannot seed one, the test must fail, not skip.
        expect(insertErr).toBeNull();
        expect(insertData).toBeTruthy();
        row.coldRowId = insertData!.id as string;

        // Attempt to UPDATE — must fail or affect zero rows.
        const { data: updated, error: updateErr } = await admin
          .from("audit_log_cold")
          .update({ action: "__tampered_action" })
          .eq("id", row.coldRowId)
          .select("id, action");

        if (updateErr) {
          expect(updateErr.message.toLowerCase()).toMatch(
            /permission denied|must be owner|not allowed|insufficient/,
          );
        } else {
          expect(updated).toEqual([]);
        }

        // Re-read: action must be untouched.
        const { data: reread } = await admin
          .from("audit_log_cold")
          .select("action")
          .eq("id", row.coldRowId)
          .single();
        expect(reread?.action).toBe(`__cold_test_upd_${ts}`);
      } finally {
        if (row.coldRowId) await deleteColdRowDirect(admin, row.coldRowId);
        await cleanupLiveDbRow(admin, { userIds: row.userIds });
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "service-role DELETE on audit_log_cold is rejected (append-only invariant)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: { userIds: string[]; coldRowId: string | null } = {
        userIds: [],
        coldRowId: null,
      };

      try {
        const userId = await createTestUser(admin, `cold-del-${ts}@test.sec`);
        row.userIds.push(userId);

        const { data: insertData, error: insertErr } = await admin
          .from("audit_log_cold")
          .insert({
            id: crypto.randomUUID(),
            user_id: userId,
            action: `__cold_test_del_${ts}`,
            entity_type: "test_probe",
            entity_id: crypto.randomUUID(),
            metadata: { marker: `del-${ts}` },
            created_at: new Date(
              Date.now() - 3 * 365 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          })
          .select("id")
          .single();
        // C-0004 (audit-2026-05-07): fail loud on setup failure.
        // Pre-fix this branch swallowed seed-INSERT errors and returned
        // early, hiding a precondition miss as a passing test. The
        // append-only DELETE invariant requires a row to attempt to
        // DELETE; without one the test is unable to make its claim.
        expect(insertErr).toBeNull();
        expect(insertData).toBeTruthy();
        row.coldRowId = insertData!.id as string;

        // Attempt DELETE — must fail or affect zero rows.
        const { data: deleted, error: deleteErr } = await admin
          .from("audit_log_cold")
          .delete()
          .eq("id", row.coldRowId)
          .select("id");

        if (deleteErr) {
          expect(deleteErr.message.toLowerCase()).toMatch(
            /permission denied|must be owner|not allowed|insufficient/,
          );
        } else {
          expect(deleted).toEqual([]);
        }

        // Re-read: row must still exist.
        const { data: reread, error: rereadErr } = await admin
          .from("audit_log_cold")
          .select("id")
          .eq("id", row.coldRowId)
          .maybeSingle();
        expect(rereadErr).toBeNull();
        expect(reread?.id).toBe(row.coldRowId);
      } finally {
        if (row.coldRowId) await deleteColdRowDirect(admin, row.coldRowId);
        await cleanupLiveDbRow(admin, { userIds: row.userIds });
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "hot→cold move (full CTE): backdated hot row lands in cold AND is removed from hot via test_force_hot_to_cold_move RPC (I5 + I6)",
    async () => {
      // This test now exercises BOTH halves of the move — the INSERT
      // into cold AND the DELETE from hot. It does so by calling the
      // test_force_hot_to_cold_move RPC (migration 057), which runs the
      // exact same CTE body as the pg_cron audit_log_hot_to_cold job.
      // The RPC is SECURITY DEFINER + service_role EXECUTE, so it
      // bypasses the migration-049 DELETE deny that PostgREST sees.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: { userIds: string[] } = { userIds: [] };
      const marker = `move-${ts}`;
      // H-0010: the moved row lands in cold; hoist its id so `finally` can
      // purge it via the test-only RPC instead of leaking it.
      let movedColdId: string | null = null;

      try {
        const userId = await createTestUser(admin, `cold-mov-${ts}@test.sec`);
        row.userIds.push(userId);

        // Seed a row with an explicitly-backdated created_at. The hot
        // audit_log allows service_role INSERT with a non-default
        // created_at — we leverage that to simulate a 3-year-old row
        // without waiting.
        const threeYearsAgo = new Date(
          Date.now() - 3 * 365 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: backdatedInsert, error: backdatedErr } = await admin
          .from("audit_log")
          .insert({
            user_id: userId,
            action: `__cold_test_${marker}_backdated`,
            entity_type: "test_probe",
            entity_id: crypto.randomUUID(),
            metadata: { marker },
            created_at: threeYearsAgo,
          })
          .select("id, created_at")
          .single();
        // C-0004 (audit-2026-05-07): fail loud on setup failure. The
        // hot→cold move test cannot make its claim without a backdated
        // hot row to migrate. Pre-fix this branch returned silently on
        // a rejected seed INSERT, presenting a missing precondition as
        // a passing assertion.
        expect(backdatedErr).toBeNull();
        expect(backdatedInsert).toBeTruthy();

        const backdatedId = backdatedInsert!.id as string;
        // After the move below, this id exists in cold — record it for
        // `finally` cleanup (H-0010).
        movedColdId = backdatedId;

        // Invoke the test-only RPC that runs the cron's CTE body.
        const { data: moveCount, error: rpcErr } = await admin.rpc(
          "test_force_hot_to_cold_move",
        );
        expect(rpcErr).toBeNull();
        // At least our seeded row was moved (other rows from other
        // tests or real 2y+ production data may also be in flight).
        expect(typeof moveCount).toBe("number");
        expect(moveCount as number).toBeGreaterThanOrEqual(1);

        // Cold side: row is present with preserved id + created_at.
        const { data: coldRow, error: coldReadErr } = await admin
          .from("audit_log_cold")
          .select("id, user_id, action, created_at")
          .eq("id", backdatedId)
          .single();
        expect(coldReadErr).toBeNull();
        expect(coldRow).not.toBeNull();
        expect(coldRow!.id).toBe(backdatedId);
        expect(coldRow!.user_id).toBe(userId);
        expect(coldRow!.action).toBe(`__cold_test_${marker}_backdated`);
        const coldTs = new Date(coldRow!.created_at).getTime();
        const expectedTs = new Date(threeYearsAgo).getTime();
        expect(Math.abs(coldTs - expectedTs)).toBeLessThan(1000);

        // Hot side: the row must be GONE. This is the I6-critical
        // assertion that the prior test could not make — PostgREST
        // DELETE is denied, so only the superuser-bypassing CTE can
        // produce this end-state.
        const { data: hotAfter, error: hotReadErr } = await admin
          .from("audit_log")
          .select("id")
          .eq("id", backdatedId)
          .maybeSingle();
        expect(hotReadErr).toBeNull();
        expect(hotAfter).toBeNull();
      } finally {
        // H-0010: purge the moved cold row via the test-only RPC so this
        // test no longer leaks a `__cold_test_*` probe into the archive.
        // (Before the RPC existed, a PostgREST DELETE here was a deny-
        // policy no-op and the row leaked forever.)
        if (movedColdId) await deleteColdRowDirect(admin, movedColdId);
        await cleanupLiveDbRow(admin, { userIds: row.userIds });
      }
    },
    45_000,
  );

  // H-0010 (FIXED 2026-05-25) — cold-row cleanup must actually remove the
  // seeded probe row. The append-only deny policy + REVOKE on
  // audit_log_cold means a service-role PostgREST DELETE is a no-op (see
  // the append-only DELETE test above: `expect(deleted).toEqual([])`), so
  // `deleteColdRowDirect` used to swallow the failure and leak the row
  // forever — `__cold_test_*` rows accumulated across runs and any future
  // `count(*) ... WHERE entity_type = 'test_probe'` probe would false-flag
  // a regression.
  //
  // The fix ships `test_force_cold_purge(p_id uuid)` (migration
  // 20260525192740) — a SECURITY DEFINER, service_role-only,
  // test-probe-scoped RPC — and routes `deleteColdRowDirect` through it.
  // This test asserts the CORRECT end-state: after cleanup, the seeded
  // cold probe row is GONE. Was `it.fails` while deferred; now passes.
  it.skipIf(!HAS_LIVE_DB)(
    "H-0010: cold-row cleanup actually removes the seeded probe row via the test_force_cold_purge RPC",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      let coldRowId: string | null = null;

      try {
        const userId = await createTestUser(admin, `cold-leak-${ts}@test.sec`);
        cleanup.userIds.push(userId);

        const { data: insertData, error: insertErr } = await admin
          .from("audit_log_cold")
          .insert({
            id: crypto.randomUUID(),
            user_id: userId,
            action: `__cold_test_leak_${ts}`,
            entity_type: "test_probe",
            entity_id: crypto.randomUUID(),
            metadata: { marker: `leak-${ts}` },
            created_at: new Date(
              Date.now() - 3 * 365 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          })
          .select("id")
          .single();
        expect(insertErr).toBeNull();
        expect(insertData).toBeTruthy();
        coldRowId = insertData!.id as string;

        // Attempt the cleanup path used by every test in this file.
        await deleteColdRowDirect(admin, coldRowId);

        // Correct behavior: the probe row is gone. Assert the re-read
        // itself did NOT error first, so a failed SELECT can't make
        // `reread` null-ish and pass this for the wrong reason
        // (silent-failure-hunter Item 2).
        const { data: reread, error: rereadErr } = await admin
          .from("audit_log_cold")
          .select("id")
          .eq("id", coldRowId)
          .maybeSingle();
        expect(rereadErr).toBeNull();
        expect(reread).toBeNull();
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(HAS_LIVE_DB)(
    "advertises skip reason when live DB is unavailable",
    () => {
      advertiseLiveDbSkipReason("audit-log-cold-archive");
      expect(true).toBe(true);
    },
  );
});
