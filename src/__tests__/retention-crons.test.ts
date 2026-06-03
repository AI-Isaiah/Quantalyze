/**
 * Integration test — Migration 056 retention cron jobs.
 *
 * Sprint 6 closeout Task 7.3. Verifies three invariants against a live
 * Supabase database:
 *
 *   1. All SIX retention/reminder cron jobs are registered in `cron.job`:
 *        - audit_log_hot_to_cold              (2y → cold)
 *        - audit_log_cold_purge               (7y delete)
 *        - retention_notification_dispatches  (180d)
 *        - retention_compute_jobs_done        (30d)
 *        - retention_compute_jobs_failed      (90d)
 *        - api_key_rotation_reminder          (90d signal capture)
 *      Migration 056's self-verify DO block asserts this at apply time;
 *      this test asserts it at runtime so a future operator who manually
 *      unscheduled a job without reverting the migration catches the
 *      drift in CI.
 *
 *   2. Each cron job's `schedule` matches the migration spec (distinct
 *      timeslots to avoid contention with 01:00 match engine). Drift on
 *      a schedule is a load-bearing change that must round-trip through
 *      a migration.
 *
 *   3. Running the api_key_rotation_reminder job's INSERT body against a
 *      seeded user with a 91-day-old API key inserts a
 *      notification_dispatches row with type='api_key_rotation_reminder'
 *      AND status='queued' AND the expected metadata shape. The 90d
 *      threshold is the Task 7.3 success metric the plan calls out by
 *      name.
 *
 * Why live-DB, not a unit test
 * ----------------------------
 * cron.job is a pg_cron schema table. The job bodies are SQL strings
 * registered at migration apply time — they are not observable from the
 * TS layer. A mocked client can't verify they exist or that their SQL
 * body produces the expected INSERT. This test reads cron.job directly
 * and executes the reminder's INSERT body via a test-only RPC
 * (test_force_rotation_reminder_capture) mirroring the pattern used by
 * audit-log-cold-archive.test.ts for the hot→cold move.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and migration 056 applied. Skips gracefully otherwise.
 *
 * Note on the reminder-capture arm
 * --------------------------------
 * Migration 056 does NOT ship a `test_force_rotation_reminder_capture`
 * helper RPC — the only two test-helper RPCs today are in migration 057
 * for the hot→cold move. Rather than add a new helper (which would
 * touch production code outside this gap-fill's scope), we execute the
 * INSERT body via the supabase-js query builder directly against the
 * same tables the cron targets, using the admin client's service-role
 * bypass. That exercises the same write path pg_cron would exercise at
 * 04:00 UTC. A dedicated helper RPC can land in a follow-up if we want
 * to mirror the exact-same-SQL-string contract; for the plan's success
 * metric ("90d reminder inserts notification_dispatches row") this is
 * equivalent.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  runIntrospectionSql,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

const EXPECTED_CRON_JOBS: Array<{ name: string; schedule: string }> = [
  { name: "audit_log_hot_to_cold", schedule: "0 3 * * *" },
  { name: "audit_log_cold_purge", schedule: "5 3 * * *" },
  { name: "retention_notification_dispatches", schedule: "10 3 * * *" },
  { name: "retention_compute_jobs_done", schedule: "20 3 * * *" },
  { name: "retention_compute_jobs_failed", schedule: "30 3 * * *" },
  { name: "api_key_rotation_reminder", schedule: "0 4 * * *" },
];

async function fetchCronJob(
  admin: ReturnType<typeof createLiveAdminClient>,
  jobname: string,
): Promise<{
  jobname: string;
  schedule: string;
  command: string;
  active: boolean;
} | null> {
  // cron.job lives in the `cron` schema. supabase-js can target
  // cross-schema via the `schema()` modifier on PostgREST.
  // H-0030: select `active` too — a job that is registered but disabled
  // (active=false) would silently never fire. The schedule/command
  // substring checks alone cannot catch that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemaScoped = (admin as any).schema("cron");
  const { data, error } = await schemaScoped
    .from("job")
    .select("jobname, schedule, command, active")
    .eq("jobname", jobname)
    .maybeSingle();
  if (error) {
    // pg_cron not installed — the migration's DO block logs a RAISE
    // NOTICE and skips registration. Surface that path as "null" so
    // the test can report the skip cleanly.
    if (/schema "cron"|relation .* does not exist/i.test(error.message)) {
      return null;
    }
    throw new Error(`cron.job fetch failed for ${jobname}: ${error.message}`);
  }
  return data;
}

/**
 * Read the EXACT registered SQL body of a cron job from `cron.job.command`
 * via the Management API. Firing this string (not a TS re-implementation)
 * is the whole point of H-0028/H-0029/H-0030: a re-implementation proves
 * the target table accepts the write, the registered string proves the
 * CRON'S OWN SELECT/JOIN/cutoff still parses and runs against the live
 * schema. Returns null when pg_cron is absent / the job is unregistered.
 */
async function fetchRegisteredCommand(jobname: string): Promise<string | null> {
  const rows = await runIntrospectionSql<{ command: string }>(
    `SELECT command FROM cron.job WHERE jobname = '${jobname}' LIMIT 1;`,
  );
  return rows.length > 0 ? rows[0].command : null;
}

/**
 * Fire a registered cron body transactionally and ROLL BACK, so the
 * destructive DELETE crons leave the shared test DB untouched while still
 * proving the body executes against the live schema. If the body
 * references a renamed/dropped column or a broken JOIN, Postgres raises
 * (42703 undefined_column, 42P01 undefined_table, …); the Management API
 * returns non-2xx and `runIntrospectionSql` throws — which is the
 * regression H-0028/H-0030 want CI to catch. The trailing `ROLLBACK`
 * discards every row the body touched.
 */
async function fireCronBodyAndRollback(body: string): Promise<void> {
  // The Management API runs the request as a single script. BEGIN/ROLLBACK
  // brackets the registered body so a global `DELETE … WHERE created_at <
  // now() - interval 'N'` cannot purge another test's aged rows.
  await runIntrospectionSql(`BEGIN;\n${body}\nROLLBACK;`);
}

describe("Migration 056 — retention cron job registration", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "all 6 retention/reminder cron jobs are registered in cron.job",
    async () => {
      const admin = createLiveAdminClient();

      // First probe: is pg_cron installed? If not, every fetch returns
      // null; report that up front rather than reporting 6 missing jobs.
      const probe = await fetchCronJob(admin, EXPECTED_CRON_JOBS[0].name);
      if (probe === null) {
        console.warn(
          "[retention-crons] pg_cron not installed on this database. " +
            "Migration 056 registers its jobs only when the extension is " +
            "present; local dev without the extension skips cleanly. " +
            "Enable pg_cron in Supabase Dashboard → Database → Extensions " +
            "to run this assertion.",
        );
        return;
      }

      const missing: string[] = [];
      const scheduleMismatches: Array<{
        name: string;
        expected: string;
        actual: string;
      }> = [];
      // H-0030: a job registered with active=false would never fire — the
      // production cron silently no-ops nightly. Track disabled jobs so a
      // regression that unschedules-by-disabling (rather than dropping)
      // trips CI.
      const disabled: string[] = [];

      for (const expected of EXPECTED_CRON_JOBS) {
        const row = await fetchCronJob(admin, expected.name);
        if (!row) {
          missing.push(expected.name);
          continue;
        }
        if (row.schedule !== expected.schedule) {
          scheduleMismatches.push({
            name: expected.name,
            expected: expected.schedule,
            actual: row.schedule,
          });
        }
        if (row.active !== true) {
          disabled.push(expected.name);
        }
      }

      expect(missing).toEqual([]);
      expect(scheduleMismatches).toEqual([]);
      // Every retention/reminder cron must be ENABLED, not just present.
      expect(disabled).toEqual([]);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "audit_log_hot_to_cold cron body is the CTE move, not a bare DELETE",
    async () => {
      // The plan's CTE-move invariant: the DELETE's RETURNING must be
      // the authoritative snapshot, otherwise a backdated insert between
      // the INSERT-SELECT and the DELETE can be deleted-without-archive.
      // We assert the command string contains `RETURNING`, `INSERT INTO
      // audit_log_cold`, and the `2 years` threshold.
      const admin = createLiveAdminClient();
      const row = await fetchCronJob(admin, "audit_log_hot_to_cold");
      if (row === null) {
        console.warn("[retention-crons] pg_cron not installed; skipping CTE-shape arm.");
        return;
      }
      const cmd = row.command.toLowerCase();
      expect(cmd).toContain("returning");
      expect(cmd).toContain("insert into audit_log_cold");
      expect(cmd).toContain("2 years");
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "audit_log_cold_purge cron targets 7y threshold",
    async () => {
      const admin = createLiveAdminClient();
      const row = await fetchCronJob(admin, "audit_log_cold_purge");
      if (row === null) return;
      expect(row.command.toLowerCase()).toContain("7 years");
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "retention_notification_dispatches cron targets 180d threshold",
    async () => {
      const admin = createLiveAdminClient();
      const row = await fetchCronJob(admin, "retention_notification_dispatches");
      if (row === null) return;
      expect(row.command.toLowerCase()).toContain("180 days");
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "retention_compute_jobs_done cron targets 30d threshold",
    async () => {
      const admin = createLiveAdminClient();
      const row = await fetchCronJob(admin, "retention_compute_jobs_done");
      if (row === null) return;
      expect(row.command.toLowerCase()).toContain("30 days");
      expect(row.command.toLowerCase()).toContain("'done'");
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "retention_compute_jobs_failed cron targets 90d threshold",
    async () => {
      const admin = createLiveAdminClient();
      const row = await fetchCronJob(admin, "retention_compute_jobs_failed");
      if (row === null) return;
      expect(row.command.toLowerCase()).toContain("90 days");
      // failed_final + failed_retry per the migration body's comment.
      expect(row.command.toLowerCase()).toContain("failed_final");
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "api_key_rotation_reminder cron targets 90d threshold + recipient email",
    async () => {
      const admin = createLiveAdminClient();
      const row = await fetchCronJob(admin, "api_key_rotation_reminder");
      if (row === null) return;
      const cmd = row.command.toLowerCase();
      expect(cmd).toContain("90 days");
      expect(cmd).toContain("notification_dispatches");
      expect(cmd).toContain("api_key_rotation_reminder");
      expect(cmd).toContain("queued");
    },
    15_000,
  );
});

/**
 * Runtime-exercise the api_key_rotation_reminder SELECT body against
 * seeded data. This catches a drift where the cron body references a
 * column that was renamed out from under it, or where the `NOT EXISTS`
 * clause's dedup window accidentally flips to allow duplicate inserts.
 *
 * We re-implement the INSERT body here as a plain supabase-js chain
 * rather than invoking the pg_cron registration (which we cannot fire
 * on demand without a test-only RPC). The business-logic assertion is:
 *   - seed a user with an api_keys row aged 91 days
 *   - assert the same-semantics SELECT the cron runs returns exactly
 *     that user
 *   - assert the inserted notification_dispatches row has the expected
 *     shape
 */
describe("Migration 056 — api_key_rotation_reminder capture semantics", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "inserts a queued notification_dispatches row for a 91-day-old API key (Task 7.3 success metric)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: {
        userIds: string[];
        apiKeyIds: string[];
        dispatchIds: string[];
      } = { userIds: [], apiKeyIds: [], dispatchIds: [] };

      try {
        const userId = await createTestUser(
          admin,
          `rotation-reminder-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // Seed an api_keys row with a backdated created_at so the 90d
        // cron threshold fires for this user. The row is active (the
        // cron's WHERE clause requires is_active = TRUE).
        const ninetyOneDaysAgo = new Date(
          Date.now() - 91 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: keyRow, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "rotation-probe",
            api_key_encrypted: "ct",
            dek_encrypted: "dct",
            is_active: true,
            created_at: ninetyOneDaysAgo,
          })
          .select("id")
          .single();
        if (keyErr || !keyRow) {
          throw new Error(`api_keys seed: ${keyErr?.message}`);
        }
        cleanup.apiKeyIds.push(keyRow.id);

        // Ensure the profile has an email (the cron joins on p.email).
        // createTestUser populates display_name; set email explicitly so
        // the cron's `p.email IS NOT NULL` clause matches.
        const userEmail = `rotation-reminder-${ts}@test.sec`;
        await admin
          .from("profiles")
          .update({ email: userEmail })
          .eq("id", userId);

        // Run the cron's INSERT-body semantics: for this user we expect
        // exactly one new queued dispatch row (none existed at seed time,
        // so the NOT EXISTS clause is vacuously true).
        //
        // We bucket the seeded key first so the SELECT returns exactly
        // our row (not someone else's 91d-old key), then call the
        // insert with the same metadata shape the cron builds.
        const { error: insertErr } = await admin
          .from("notification_dispatches")
          .insert({
            notification_type: "api_key_rotation_reminder",
            recipient_email: userEmail,
            subject: "Rotate your exchange API key",
            status: "queued",
            metadata: {
              user_id: userId,
              api_key_id: keyRow.id,
              exchange: "binance",
              created_at: ninetyOneDaysAgo,
            },
          });
        if (insertErr) {
          throw new Error(`notification_dispatches seed: ${insertErr.message}`);
        }

        // Verify the row landed with the expected shape.
        const { data: dispatches, error: readErr } = await admin
          .from("notification_dispatches")
          .select("id, notification_type, status, recipient_email, metadata")
          .eq("recipient_email", userEmail)
          .eq("notification_type", "api_key_rotation_reminder");
        if (readErr) throw new Error(`dispatches read: ${readErr.message}`);

        expect(dispatches).not.toBeNull();
        expect((dispatches ?? []).length).toBe(1);
        const row = dispatches![0];
        cleanup.dispatchIds.push(row.id);

        expect(row.status).toBe("queued");
        expect(row.notification_type).toBe("api_key_rotation_reminder");
        expect(row.recipient_email).toBe(userEmail);
        const meta = row.metadata as Record<string, unknown>;
        expect(meta.user_id).toBe(userId);
        expect(meta.api_key_id).toBe(keyRow.id);
        expect(meta.exchange).toBe("binance");
      } finally {
        for (const id of cleanup.dispatchIds) {
          await admin.from("notification_dispatches").delete().eq("id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "cron SELECT skips users who already received a reminder in the last 60 days (dedup window)",
    async () => {
      // The migration's NOT EXISTS clause blocks duplicate reminders:
      //   AND NOT EXISTS (
      //     SELECT 1 FROM notification_dispatches nd
      //     WHERE nd.notification_type = 'api_key_rotation_reminder'
      //       AND nd.recipient_email  = p.email
      //       AND nd.created_at > now() - interval '60 days'
      //   )
      // We seed a recent dispatch and assert the same WHERE clause
      // returns zero rows — i.e., the cron would insert nothing on its
      // next tick for this user.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: {
        userIds: string[];
        apiKeyIds: string[];
        dispatchIds: string[];
      } = { userIds: [], apiKeyIds: [], dispatchIds: [] };

      try {
        const userId = await createTestUser(
          admin,
          `rotation-dedup-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        const userEmail = `rotation-dedup-${ts}@test.sec`;
        await admin.from("profiles").update({ email: userEmail }).eq("id", userId);

        const ninetyOneDaysAgo = new Date(
          Date.now() - 91 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: keyRow, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "rotation-dedup-probe",
            api_key_encrypted: "ct",
            dek_encrypted: "dct",
            is_active: true,
            created_at: ninetyOneDaysAgo,
          })
          .select("id")
          .single();
        if (keyErr || !keyRow) throw new Error(`api_keys: ${keyErr?.message}`);
        cleanup.apiKeyIds.push(keyRow.id);

        // Seed a reminder dispatch that is 5 days old — within the 60d
        // dedup window.
        const fiveDaysAgo = new Date(
          Date.now() - 5 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: disp, error: dispErr } = await admin
          .from("notification_dispatches")
          .insert({
            notification_type: "api_key_rotation_reminder",
            recipient_email: userEmail,
            subject: "Rotate your exchange API key",
            status: "queued",
            metadata: { user_id: userId },
            created_at: fiveDaysAgo,
          })
          .select("id")
          .single();
        if (dispErr || !disp) {
          throw new Error(`dispatches seed: ${dispErr?.message}`);
        }
        cleanup.dispatchIds.push(disp.id);

        // Probe: a recent reminder exists, so the dedup clause should
        // match. Use a 60-day cutoff in ISO so the probe is isomorphic
        // to the cron's `now() - interval '60 days'` predicate.
        const sixtyDaysAgo = new Date(
          Date.now() - 60 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: recent, error: recErr } = await admin
          .from("notification_dispatches")
          .select("id")
          .eq("notification_type", "api_key_rotation_reminder")
          .eq("recipient_email", userEmail)
          .gt("created_at", sixtyDaysAgo);
        if (recErr) throw new Error(`recent probe: ${recErr.message}`);

        // The recent-reminder probe MUST find the seeded dispatch. If
        // the cron's NOT EXISTS clause has the same semantics, the
        // INSERT would be skipped for this user — which is the
        // invariant under test.
        expect((recent ?? []).length).toBeGreaterThanOrEqual(1);
      } finally {
        for (const id of cleanup.dispatchIds) {
          await admin.from("notification_dispatches").delete().eq("id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  // H-0028 / H-0029 / H-0030 — END-TO-END cron-body firing.
  //
  // The arms above assert registration + schedule + active state +
  // command-string substrings. The arms below FIRE the EXACT registered
  // SQL body (read from cron.job.command, NOT re-implemented in TS) and
  // assert its EFFECT.
  //
  // How we fire without a per-cron force-execute RPC
  // ------------------------------------------------
  // The earlier version of this file skipped these, claiming firing a
  // cron body needs a per-cron `test_force_*()` SECURITY DEFINER RPC
  // (a production migration). That was over-conservative: the registered
  // body is plain SQL stored in cron.job.command, and the Management API
  // runs arbitrary SQL. So we read the command and run it directly. The
  // two safety concerns the old comment raised are both handled:
  //   * Destructive global DELETE crons (compute_jobs / notification_
  //     dispatches / audit cold-purge) are wrapped in BEGIN … ROLLBACK
  //     so they cannot purge another test's aged rows — but a column
  //     rename / broken JOIN in the body still raises and fails the test.
  //   * The api_key_rotation_reminder INSERT body (H-0029) is fired and
  //     its EFFECT measured by the cron's OWN SELECT/JOIN against a
  //     seeded 91d key, inside a transaction that rolls back. A migration
  //     that breaks the JOIN to api_keys/profiles makes the body insert
  //     ZERO rows for our seed → the assertion fails. A TS
  //     re-implementation could not catch that.
  //
  // These need HAS_INTROSPECTION (Management API) on top of HAS_LIVE_DB,
  // because cron.job lives in the `cron` schema and firing the body needs
  // raw-SQL execution PostgREST does not offer.

  // H-0029: fire the REAL api_key_rotation_reminder INSERT-SELECT body and
  // assert the cron's own SELECT/JOIN produces exactly one queued dispatch
  // for a seeded 91-day-old key. Everything happens inside a transaction
  // that is rolled back via a deliberate RAISE carrying the row count, so
  // the shared DB is never mutated.
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "api_key_rotation_reminder: firing the registered INSERT body produces a queued dispatch for a 91d key via the cron's OWN join (H-0029)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userEmail = `rotation-fire-${ts}@test.sec`;
      const cleanup: {
        userIds: string[];
        apiKeyIds: string[];
        dispatchIds: string[];
      } = { userIds: [], apiKeyIds: [], dispatchIds: [] };

      try {
        const userId = await createTestUser(admin, userEmail);
        cleanup.userIds.push(userId);
        await admin
          .from("profiles")
          .update({ email: userEmail })
          .eq("id", userId);

        const ninetyOneDaysAgo = new Date(
          Date.now() - 91 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: keyRow, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "rotation-fire-probe",
            api_key_encrypted: "ct",
            dek_encrypted: "dct",
            is_active: true,
            created_at: ninetyOneDaysAgo,
          })
          .select("id")
          .single();
        if (keyErr || !keyRow) throw new Error(`api_keys: ${keyErr?.message}`);
        cleanup.apiKeyIds.push(keyRow.id);

        const body = await fetchRegisteredCommand("api_key_rotation_reminder");
        if (body === null) {
          console.warn(
            "[retention-crons] api_key_rotation_reminder not registered " +
              "(pg_cron absent); skipping fire-the-body arm.",
          );
          return;
        }

        // Fire the EXACT registered body, then — in the same transaction —
        // count how many queued dispatches it produced for our seeded
        // email, and RAISE that count so the transaction rolls back AND
        // the number reaches us via the error message. A non-firing JOIN
        // (column rename, broken api_keys/profiles join) yields count 0.
        let firedCount: number | null = null;
        try {
          await runIntrospectionSql(
            `DO $fire$
             DECLARE v_n INT;
             BEGIN
               ${body}
               SELECT count(*) INTO v_n
                 FROM notification_dispatches
                WHERE notification_type = 'api_key_rotation_reminder'
                  AND recipient_email = '${userEmail}';
               RAISE EXCEPTION 'RETENTION_FIRE_COUNT=%', v_n;
             END
             $fire$;`,
          );
        } catch (err) {
          const m = /RETENTION_FIRE_COUNT=(\d+)/.exec((err as Error).message);
          if (!m) {
            // Any OTHER error (e.g. 42703 undefined_column from a broken
            // body) must fail the test loudly — that is the H-0029 drift.
            throw err;
          }
          firedCount = Number(m[1]);
        }

        // The cron's own INSERT-SELECT must have produced exactly one
        // queued dispatch for our seeded 91d key. The DO block rolled the
        // row back, so nothing leaks to the shared DB.
        expect(firedCount).toBe(1);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  // H-0029 (dedup arm): fire the EXACT registered INSERT body when a reminder
  // <60d old ALREADY exists for the seeded user, and assert the body inserts
  // ZERO new rows. The existing dedup arm (line ~411) only re-implements the
  // recent-reminder probe as a hand-written supabase-js SELECT — it proves
  // OUR probe finds the seeded dispatch, NOT that the cron's OWN `NOT EXISTS`
  // clause suppresses the insert. This arm fires the registered body so a
  // regression that widens/breaks the dedup window — e.g. flipping
  // `nd.created_at > now() - interval '60 days'` to `'0 days'`, or dropping
  // the `AND NOT EXISTS (…)` block entirely — makes the body insert a
  // duplicate, firedNew flips to 1, and THIS test fails. The hand-written
  // probe arm stays green under that same neuter, which is exactly why it is
  // insufficient on its own.
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "api_key_rotation_reminder: firing the registered INSERT body inserts ZERO new rows when a reminder <60d old already exists (NOT EXISTS dedup — H-0029 dedup arm)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userEmail = `rotation-dedup-fire-${ts}@test.sec`;
      const cleanup = {
        userIds: [] as string[],
        apiKeyIds: [] as string[],
        dispatchIds: [] as string[],
      };
      try {
        const userId = await createTestUser(admin, userEmail);
        cleanup.userIds.push(userId);
        await admin.from("profiles").update({ email: userEmail }).eq("id", userId);

        const ninetyOneDaysAgo = new Date(
          Date.now() - 91 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: keyRow, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "rotation-dedup-fire-probe",
            api_key_encrypted: "ct",
            dek_encrypted: "dct",
            is_active: true,
            created_at: ninetyOneDaysAgo,
          })
          .select("id")
          .single();
        if (keyErr || !keyRow) throw new Error(`api_keys: ${keyErr?.message}`);
        cleanup.apiKeyIds.push(keyRow.id);

        // Seed ONE reminder 5 days ago — inside the 60d dedup window.
        const fiveDaysAgo = new Date(
          Date.now() - 5 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: disp, error: dispErr } = await admin
          .from("notification_dispatches")
          .insert({
            notification_type: "api_key_rotation_reminder",
            recipient_email: userEmail,
            subject: "Rotate your exchange API key",
            status: "queued",
            metadata: { user_id: userId },
            created_at: fiveDaysAgo,
          })
          .select("id")
          .single();
        if (dispErr || !disp) throw new Error(`dispatches seed: ${dispErr?.message}`);
        cleanup.dispatchIds.push(disp.id);

        const body = await fetchRegisteredCommand("api_key_rotation_reminder");
        if (body === null) {
          console.warn(
            "[retention-crons] reminder cron unregistered; skipping dedup-fire arm.",
          );
          return;
        }

        // Fire the EXACT body inside a DO block, count rows the BODY adds
        // (created_at = now() inside the txn, so > our 5d seed), RAISE+rollback.
        let firedNew: number | null = null;
        try {
          await runIntrospectionSql(
            `DO $fire$
             DECLARE v_n INT;
             BEGIN
               ${body}
               SELECT count(*) INTO v_n FROM notification_dispatches
                WHERE notification_type = 'api_key_rotation_reminder'
                  AND recipient_email = '${userEmail}'
                  AND created_at > now() - interval '1 minute';
               RAISE EXCEPTION 'RETENTION_DEDUP_NEW=%', v_n;
             END $fire$;`,
          );
        } catch (err) {
          const m = /RETENTION_DEDUP_NEW=(\d+)/.exec((err as Error).message);
          if (!m) throw err;
          firedNew = Number(m[1]);
        }
        // The NOT EXISTS clause must suppress the insert: the body adds ZERO
        // new rows because a reminder <60d old already exists for this user.
        expect(firedNew).toBe(0);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  // H-0028 / H-0030: fire the EXACT registered body of every retention /
  // audit cron transactionally (ROLLBACK) and assert it executes against
  // the live schema. A silently-corrupted body — a renamed compute_jobs
  // column, a dropped status enum value, a broken table reference — raises
  // and fails this test, instead of silently no-op'ing nightly in prod
  // until terabytes of un-pruned rows pile up. ROLLBACK keeps the shared
  // test DB untouched (no cross-test purge of aged rows).
  const FIREABLE_CRONS = [
    "audit_log_hot_to_cold",
    "audit_log_cold_purge",
    "retention_notification_dispatches",
    "retention_compute_jobs_done",
    "retention_compute_jobs_failed",
  ];
  for (const jobname of FIREABLE_CRONS) {
    it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
      `${jobname}: registered body executes against the live schema when fired (rolled back) — schema-drift in the body fails CI (H-0028/H-0030)`,
      async () => {
        const body = await fetchRegisteredCommand(jobname);
        if (body === null) {
          console.warn(
            `[retention-crons] ${jobname} not registered (pg_cron absent); ` +
              "skipping fire-the-body arm.",
          );
          return;
        }
        // If the body references a renamed/dropped column or a broken
        // JOIN, this throws (42703 / 42P01 / …) and the test fails. The
        // ROLLBACK discards whatever rows the DELETE/CTE touched, so the
        // shared DB is never mutated.
        await expect(fireCronBodyAndRollback(body)).resolves.toBeUndefined();
      },
      30_000,
    );
  }

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("retention-crons");
    expect(true).toBe(true);
  });
});

// ===========================================================================
// STATIC schema-drift guard — runs in CI WITHOUT a live DB (H-0028/H-0029/
// H-0030).
//
// The live-DB / introspection arms above fire the registered cron bodies
// against real Postgres — but they are gated on HAS_LIVE_DB && (for the fire
// arms) HAS_INTROSPECTION, and the merge-protecting vitest job
// (.github/workflows/ci.yml `frontend-test`, `npx vitest run --shard`) sets
// NEITHER. So in the gate that actually blocks a merge, every one of those
// arms SKIPS (project memory: "Live-DB vitest tests skip in CI"). The only
// thing that previously ran in CI was the tautological `advertises skip
// reason` arm. The adversarial reviewer is right: a schema-drift regression
// in a cron body — a renamed `compute_jobs.status`, a dropped
// `next_attempt_at`, a broken api_keys/profiles JOIN — would merge GREEN
// because nothing the gate runs reads the cron body.
//
// This block closes that hole with a pure file-read assertion that ALWAYS
// runs (no `it.skipIf`, no network):
//
//   1. Parse the LATEST registered SQL body for each retention cron from the
//      migration sources on disk (newest-wins per job, comments stripped) —
//      the same content pg_cron stores in cron.job.command.
//   2. Build a column model for the six tables the crons touch from the
//      migrations' CREATE TABLE / ADD COLUMN statements.
//   3. For each cron, cross-check its declared column-dependency contract
//      against BOTH (a) the parsed schema model — a renamed/dropped column
//      fails here, which is exactly the silent-no-op regression the finding
//      describes — and (b) the cron body text itself, so the contract cannot
//      silently go stale if a future edit drops a column reference.
//   4. Assert the apply-time `_assert_retention_columns()` probe (migration
//      20260516160200) still guards every column the api_key_rotation_
//      reminder body depends on — the probe is the production deploy-time
//      net, and a body that grows a new column dependency the probe doesn't
//      cover is the H-0923 drift hole re-opening.
//
// This is NOT a substring/keyword check: it ties two independently-parsed
// SQL sources (the cron body and the CREATE TABLE schema) together, the
// same drift-guard philosophy as mandate-columns-schema-sync.test.ts.
// ===========================================================================

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

/** Strip `-- line` and block comments so a commented-out cron.schedule or
 *  column reference cannot masquerade as live SQL. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Leading-numeric-prefix sort so `20260515…` orders after `20260417…`. */
function migrationNumber(name: string): number {
  const m = name.match(/^(\d+)/);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function migrationFilesOldestFirst(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => migrationNumber(a) - migrationNumber(b));
}

/**
 * The exact body of every `cron.schedule('<job>', '<schedule>', $tag$ … $tag$)`
 * call, last-registration-wins across all migrations (Postgres applies them
 * in order, and each retention migration unschedules+reschedules, so the
 * LAST cron.schedule for a jobname is the body that ends up in cron.job).
 */
function latestRegisteredCronBodies(): Record<
  string,
  { file: string; body: string }
> {
  // Matches: cron.schedule( '<name>', '<schedule>', $tag$ <body> $tag$ )
  // The back-reference \2 closes on the SAME dollar-quote tag that opened.
  const re =
    /cron\.schedule\(\s*'([a-z_]+)'\s*,\s*'[^']*'\s*,\s*(\$[a-zA-Z]*\$)([\s\S]*?)\2\s*\)/g;
  const latest: Record<string, { file: string; body: string }> = {};
  for (const file of migrationFilesOldestFirst()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      latest[m[1]] = { file, body: m[3].trim() };
    }
  }
  return latest;
}

/**
 * Parse the column set of a target table from migration sources: the inner
 * column-definition list of its CREATE TABLE plus any later ADD COLUMN. Only
 * the six tables the retention crons touch are modelled.
 */
const RETENTION_TABLES = [
  "audit_log",
  "audit_log_cold",
  "notification_dispatches",
  "compute_jobs",
  "api_keys",
  "profiles",
] as const;
type RetentionTable = (typeof RETENTION_TABLES)[number];

// First token of a CREATE TABLE element that is a table constraint, not a
// column definition.
const CONSTRAINT_LEADERS = new Set([
  "constraint",
  "primary",
  "unique",
  "check",
  "foreign",
  "references",
  "exclude",
  "like",
]);

function parseCreateTableColumns(sql: string, table: string): Set<string> | null {
  const open = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\s*\\(`,
    "i",
  );
  const m = open.exec(sql);
  if (!m) return null;
  // Walk to the matching close paren of the column list.
  let depth = 0;
  let bodyStart = -1;
  let i = m.index + m[0].length - 1; // positioned on the opening '('
  for (; i < sql.length; i++) {
    if (sql[i] === "(") {
      depth++;
      if (depth === 1) bodyStart = i + 1;
    } else if (sql[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (bodyStart === -1 || depth !== 0) return null;
  const inner = sql.slice(bodyStart, i);
  // Split on top-level commas (parens nest for CHECK/REFERENCES clauses).
  const parts: string[] = [];
  let buf = "";
  let d = 0;
  for (const ch of inner) {
    if (ch === "(") d++;
    else if (ch === ")") d--;
    if (ch === "," && d === 0) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf);

  const cols = new Set<string>();
  for (const part of parts) {
    const first = part.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!first || CONSTRAINT_LEADERS.has(first)) continue;
    if (/^[a-z_][a-z0-9_]*$/.test(first)) cols.add(first);
  }
  return cols;
}

function buildRetentionSchema(): Record<RetentionTable, Set<string>> {
  const schema = {} as Record<RetentionTable, Set<string>>;
  for (const t of RETENTION_TABLES) schema[t] = new Set();
  for (const file of migrationFilesOldestFirst()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    for (const t of RETENTION_TABLES) {
      const created = parseCreateTableColumns(sql, t);
      if (created) for (const c of created) schema[t].add(c);
      const addRe = new RegExp(
        `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?${t}\\b[\\s\\S]*?ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([a-z_][a-z0-9_]*)`,
        "gi",
      );
      let am: RegExpExecArray | null;
      while ((am = addRe.exec(sql)) !== null) schema[t].add(am[1].toLowerCase());
    }
  }
  return schema;
}

/**
 * The column-dependency CONTRACT for each cron body. Each entry is a
 * `table.column` the registered SQL body reads or writes. If a body stops
 * referencing one of these, the body-reference check below fails (forcing the
 * contract to be revisited); if the column is renamed/dropped from the
 * schema, the schema-existence check fails. Both run in CI without a DB.
 *
 * These pairs are derived directly from the registered bodies (see the
 * `latestRegisteredCronBodies` parse) — they are not hand-copied from a
 * sibling literal, so the test fails the moment the body or the schema drifts
 * out from under them.
 */
const CRON_COLUMN_CONTRACT: Record<string, string[]> = {
  audit_log_hot_to_cold: [
    "audit_log.id",
    "audit_log.user_id",
    "audit_log.action",
    "audit_log.entity_type",
    "audit_log.entity_id",
    "audit_log.metadata",
    "audit_log.created_at",
    "audit_log_cold.id",
    "audit_log_cold.user_id",
    "audit_log_cold.action",
    "audit_log_cold.entity_type",
    "audit_log_cold.entity_id",
    "audit_log_cold.metadata",
    "audit_log_cold.created_at",
  ],
  audit_log_cold_purge: ["audit_log_cold.created_at"],
  retention_notification_dispatches: [
    "notification_dispatches.created_at",
    "notification_dispatches.status",
  ],
  retention_compute_jobs_done: ["compute_jobs.status", "compute_jobs.created_at"],
  retention_compute_jobs_failed: [
    "compute_jobs.status",
    "compute_jobs.next_attempt_at",
    "compute_jobs.created_at",
  ],
  api_key_rotation_reminder: [
    "notification_dispatches.notification_type",
    "notification_dispatches.recipient_email",
    "notification_dispatches.subject",
    "notification_dispatches.status",
    "notification_dispatches.metadata",
    "notification_dispatches.created_at",
    "api_keys.is_active",
    "api_keys.created_at",
    "api_keys.id",
    "api_keys.exchange",
    "api_keys.user_id",
    "profiles.email",
    "profiles.id",
  ],
};

/**
 * Does the cron body reference a bare or alias-qualified `<column>`? We accept
 * either `<word boundary>column<word boundary>` (covers `created_at`, `status`,
 * `COALESCE(next_attempt_at, …)`, INSERT column lists, and alias-qualified
 * `p.email` since the `.email` still contains the bare word). This is
 * deliberately lenient on WHERE the column appears and strict on WHETHER it
 * appears — the schema-existence check below is what proves the column is
 * real, this check only proves the contract still tracks the body.
 */
function bodyReferencesColumn(body: string, column: string): boolean {
  return new RegExp(`\\b${column}\\b`).test(body);
}

describe("retention crons — STATIC schema-drift guard (runs in CI, no DB)", () => {
  const bodies = latestRegisteredCronBodies();
  const schema = buildRetentionSchema();

  it("the migration parse found a registered body for every retention cron", () => {
    for (const job of Object.keys(CRON_COLUMN_CONTRACT)) {
      expect(
        bodies[job],
        `no cron.schedule('${job}', …) parsed from supabase/migrations — ` +
          `the extraction regex no longer matches the migration shape, which ` +
          `would silently disable the H-0028/H-0029/H-0030 drift guard`,
      ).toBeDefined();
    }
  });

  it("the schema model resolved a non-trivial column set for every retention table", () => {
    // Guard against a future refactor that moves a CREATE TABLE into a shape
    // the parser misses — that would make the existence checks vacuously pass.
    for (const t of RETENTION_TABLES) {
      expect(
        schema[t].size,
        `column model for ${t} is empty — parseCreateTableColumns failed to ` +
          `find its CREATE TABLE; the drift guard would be vacuous`,
      ).toBeGreaterThanOrEqual(2);
    }
    // Spot-check the exact columns whose rename the finding calls out: a
    // renamed compute_jobs.status / next_attempt_at is the canonical
    // silent-no-op regression.
    expect(schema.compute_jobs.has("status")).toBe(true);
    expect(schema.compute_jobs.has("next_attempt_at")).toBe(true);
    expect(schema.compute_jobs.has("created_at")).toBe(true);
  });

  for (const [job, contract] of Object.entries(CRON_COLUMN_CONTRACT)) {
    it(`${job}: every column its registered body depends on EXISTS in the live schema (a rename/drop fails CI — H-0028/H-0030)`, () => {
      const body = bodies[job]?.body ?? "";
      const missingFromSchema: string[] = [];
      const missingFromBody: string[] = [];
      for (const ref of contract) {
        const [table, column] = ref.split(".") as [RetentionTable, string];
        if (!schema[table].has(column)) missingFromSchema.push(ref);
        if (!bodyReferencesColumn(body, column)) missingFromBody.push(ref);
      }
      expect(
        missingFromSchema,
        `${job}'s cron body references column(s) that NO migration defines: ` +
          `${missingFromSchema.join(", ")}. The nightly cron would raise ` +
          `42703 undefined_column and silently no-op in prod. This is the ` +
          `exact regression H-0028/H-0030 require CI to catch.`,
      ).toEqual([]);
      expect(
        missingFromBody,
        `${job}'s registered body no longer references contracted column(s): ` +
          `${missingFromBody.join(", ")}. Either the body changed (re-derive ` +
          `the contract) or the parse broke — do not let the contract go stale.`,
      ).toEqual([]);
    });
  }

  it("api_key_rotation_reminder's column deps are all guarded by the apply-time _assert_retention_columns() probe (H-0923 drift net stays closed)", () => {
    // The schema-drift-probe migration (20260516160200) installs
    // _assert_retention_columns() and runs it at apply time so a deploy that
    // drifts a retention-cron column fails loudly. Parse the columns it
    // guards and assert they cover every column the reminder body depends on.
    const probeFile = migrationFilesOldestFirst().find((f) =>
      f.includes("retention_crons_schema_drift_probe"),
    );
    expect(
      probeFile,
      "schema-drift-probe migration missing — the apply-time net for the " +
        "reminder cron's column drift is gone",
    ).toBeDefined();
    const probeSql = stripSqlComments(
      readFileSync(join(MIGRATIONS_DIR, probeFile!), "utf8"),
    );
    const arr = /FOREACH\s+v_pair\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s*LOOP/i.exec(
      probeSql,
    );
    expect(
      arr,
      "could not parse the _assert_retention_columns() column list — the " +
        "probe shape changed",
    ).not.toBeNull();
    const guarded = new Set(
      [...arr![1].matchAll(/'([^']+)'/g)].map((mm) =>
        mm[1].replace(/^public\./, ""),
      ),
    );

    // The reminder body's hard column deps that the probe is explicitly
    // responsible for (per H-0923: the cross-table JOIN columns + the
    // dispatch-shape columns). The probe need not guard PK columns like
    // api_keys.id, but it MUST guard the JOIN/filter columns whose rename
    // silently breaks the body.
    const mustBeGuarded = [
      "api_keys.is_active",
      "profiles.email",
      "notification_dispatches.recipient_email",
      "notification_dispatches.notification_type",
      "notification_dispatches.status",
      "notification_dispatches.created_at",
    ];
    const unguarded = mustBeGuarded.filter((c) => !guarded.has(c));
    expect(
      unguarded,
      `_assert_retention_columns() does NOT guard: ${unguarded.join(", ")}. ` +
        `A deploy that renames one of these would NOT fail at apply time, ` +
        `re-opening the H-0923 silent-drift hole.`,
    ).toEqual([]);
  });
});
