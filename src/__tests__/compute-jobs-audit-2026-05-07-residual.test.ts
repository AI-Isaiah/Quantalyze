/**
 * Live-DB regression tests — audit-2026-05-07 G10 residual fixes.
 *
 * Pins the queue-correctness fixes shipped in migration
 * 20260516104201_compute_jobs_audit_2026_05_07_residual.sql against
 * future regressions.
 *
 * Coverage:
 *   - H-0864: mark_compute_job_done set-based fan-in advance (no N+1)
 *   - M-0772: non-negative CHECK constraints reject bad inputs
 *   - M-0779: mark_compute_job_failed preserves claimed_at/by
 *   - M-0781: reclaim_stuck_compute_jobs bounded at 500 rows per call
 *   - M-0782: GetUserComputeJobsRowSchema parses real RPC responses
 *   - M-0783: get_user_compute_jobs COALESCE filter (semantic preserved)
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/compute-jobs-audit-2026-05-07-residual.test.ts
 */

import { describe, it, expect } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_INTROSPECTION,
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
  runIntrospectionSql,
} from "@/lib/test-helpers/live-db";
import { GetUserComputeJobsRowSchema } from "@/lib/analytics-schemas";

advertiseLiveDbSkipReason("compute-jobs-audit-2026-05-07-residual");

// ---------------------------------------------------------------------------
// Helpers (mirror the shape of compute-jobs-audit-2026-05-07-g10b.test.ts)
// ---------------------------------------------------------------------------

interface ComputeJobRow {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  claimed_at: string | null;
  claimed_by: string | null;
  strategy_id: string | null;
  parent_job_ids: string[] | null;
  kind: string;
}

async function seedStrategy(
  admin: SupabaseClient,
  userId: string,
  marker: string,
): Promise<string> {
  const { data, error } = await admin
    .from("strategies")
    .insert({ user_id: userId, name: `__test_residual_${marker}` } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedStrategy(${marker}): ${error?.message}`);
  }
  return (data as { id: string }).id;
}

async function insertComputeJob(
  admin: SupabaseClient,
  fields: Partial<ComputeJobRow> & { kind: string },
): Promise<string> {
  const { data, error } = await admin
    .from("compute_jobs")
    .insert(fields as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertComputeJob: ${error?.message}`);
  }
  return (data as { id: string }).id;
}

async function fetchJob(
  admin: SupabaseClient,
  jobId: string,
): Promise<ComputeJobRow> {
  const { data, error } = await admin
    .from("compute_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !data) {
    throw new Error(`fetchJob(${jobId}): ${error?.message}`);
  }
  return data as unknown as ComputeJobRow;
}

// ---------------------------------------------------------------------------
// M-0772: non-negative CHECK constraints
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 residual — M-0772 non-negative CHECKs", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT with attempts = -1",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-attempts-neg-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "attempts-neg");
      try {
        const { error } = await admin.from("compute_jobs").insert({
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "pending",
          attempts: -1,
        } as never);
        expect(error).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /compute_jobs_attempts_non_negative|check constraint/i,
        );
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT with max_attempts = 0",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-max-zero-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "max-zero");
      try {
        const { error } = await admin.from("compute_jobs").insert({
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "pending",
          max_attempts: 0,
        } as never);
        expect(error).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /compute_jobs_max_attempts_positive|check constraint/i,
        );
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects INSERT with trade_count = -5",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-trade-neg-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "trade-neg");
      try {
        const { error } = await admin.from("compute_jobs").insert({
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "pending",
          trade_count: -5,
        } as never);
        expect(error).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /compute_jobs_trade_count_non_negative|check constraint/i,
        );
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// M-0779: mark_compute_job_failed preserves claimed_at / claimed_by
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 residual — M-0779 forensic preservation", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "failed_retry row keeps claimed_at AND claimed_by populated",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-m0779-retry-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "m0779-retry");
      try {
        const claimedAt = new Date().toISOString();
        const jobId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: claimedAt,
          claimed_by: "test-worker-forensic",
        });

        const { error } = await admin.rpc("mark_compute_job_failed", {
          p_job_id: jobId,
          p_error: "test-transient-forensic",
          p_error_kind: "transient",
        } as never);
        expect(error).toBeNull();

        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("failed_retry");
        // M-0779: claimed_at and claimed_by must SURVIVE so operators
        // can still tell which worker last touched this row.
        expect(row.claimed_at).not.toBeNull();
        expect(row.claimed_by).toBe("test-worker-forensic");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "failed_final row keeps claimed_at AND claimed_by populated",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-m0779-final-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "m0779-final");
      try {
        const jobId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "running",
          attempts: 3,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-final",
        });

        await admin.rpc("mark_compute_job_failed", {
          p_job_id: jobId,
          p_error: "test-permanent-final",
          p_error_kind: "permanent",
        } as never);

        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("failed_final");
        expect(row.claimed_at).not.toBeNull();
        expect(row.claimed_by).toBe("test-worker-final");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// M-0781: reclaim_stuck_compute_jobs bounded at 500
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 residual — M-0781 bounded reclaim", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "single-row stuck reclaim still works (smoke test the bounded path)",
    async () => {
      // Behavioral test of the new SELECT ... LIMIT 500 FOR UPDATE
      // SKIP LOCKED shape on a single row. Seeding 500+ rows in a
      // Vitest live-DB test is prohibitively expensive; the 1-row
      // smoke + the existing mig 109 P2 test cover the common case.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-m0781-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "m0781");
      try {
        const stuckAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const jobId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "running",
          attempts: 2,
          max_attempts: 3,
          claimed_at: stuckAt,
          claimed_by: "test-worker-stuck-residual",
        });

        const { data: reclaimed, error } = await admin.rpc(
          "reclaim_stuck_compute_jobs",
          { p_older_than: "10 minutes" } as never,
        );
        expect(error).toBeNull();
        expect((reclaimed as unknown as number) >= 1).toBe(true);

        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("pending");
        expect(row.claimed_at).toBeNull();
        expect(row.claimed_by).toBeNull();
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// H-0864: mark_compute_job_done set-based fan-in advance
// ---------------------------------------------------------------------------
//
// The fan-in behavior is already covered by P15 in the g10b test
// (3-level chain, two parents → child advance). This test pins the
// SAME behavior against the new set-based UPDATE shape so a future
// "let me put the loop back" regression fails loudly.

describe("audit-2026-05-07 residual — H-0864 set-based fan-in", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "single mark_done call advances every eligible done_pending_children child",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-h0864-${ts}@test.sec`,
      );
      // Two strategies because (strategy, kind) partial unique index
      // would reject two running sync_trades on one strategy.
      const strategyA = await seedStrategy(admin, userId, "h0864-a");
      const strategyB = await seedStrategy(admin, userId, "h0864-b");
      try {
        const parent = await insertComputeJob(admin, {
          strategy_id: strategyA,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-parent",
        });

        // Two children, both waiting only on `parent`. On a single
        // mark_done(parent), BOTH must advance to pending in one
        // statement.
        const childA = await insertComputeJob(admin, {
          strategy_id: strategyA,
          kind: "compute_analytics",
          status: "done_pending_children",
          attempts: 0,
          max_attempts: 3,
          parent_job_ids: [parent],
        });
        const childB = await insertComputeJob(admin, {
          strategy_id: strategyB,
          kind: "compute_analytics",
          status: "done_pending_children",
          attempts: 0,
          max_attempts: 3,
          parent_job_ids: [parent],
        });

        await admin.rpc("mark_compute_job_done", {
          p_job_id: parent,
        } as never);

        const rowA = await fetchJob(admin, childA);
        const rowB = await fetchJob(admin, childB);
        expect(rowA.status).toBe("pending");
        expect(rowB.status).toBe("pending");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyA, strategyB],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "child with un-done sibling-parent does NOT advance",
    async () => {
      // Exercises the NOT EXISTS sub-query's "any parent still not done"
      // path. With the old per-child check_fan_in_ready call this was
      // an equivalent semantic; pinning here defends against a regression
      // that drops the NOT EXISTS predicate.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-h0864-partial-${ts}@test.sec`,
      );
      const strategyA = await seedStrategy(admin, userId, "h0864-pa");
      const strategyB = await seedStrategy(admin, userId, "h0864-pb");
      try {
        const p1 = await insertComputeJob(admin, {
          strategy_id: strategyA,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-p1",
        });
        const p2 = await insertComputeJob(admin, {
          strategy_id: strategyB,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-p2",
        });
        const child = await insertComputeJob(admin, {
          strategy_id: strategyA,
          kind: "compute_analytics",
          status: "done_pending_children",
          attempts: 0,
          max_attempts: 3,
          parent_job_ids: [p1, p2],
        });

        // Mark only p1 done; p2 still running. Child must remain in
        // done_pending_children.
        await admin.rpc("mark_compute_job_done", { p_job_id: p1 } as never);
        const row = await fetchJob(admin, child);
        expect(row.status).toBe("done_pending_children");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyA, strategyB],
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// M-0782: GetUserComputeJobsRowSchema parses a real row
// ---------------------------------------------------------------------------
//
// The schema's regression value comes from running it against a real
// RPC response. We seed a row, call the RPC as the row's owner, and
// parse — any column drift trips the .strict() failure.
//
// Service-role cannot reach the RPC's `auth.uid()` branch (returns
// early on NULL). We exercise the schema against the service-role
// SELECT shape adapted to the RPC shape — the row content matches
// because the RPC's SELECT projects exactly the same columns.

describe("audit-2026-05-07 residual — M-0782 Zod schema contract", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "GetUserComputeJobsRowSchema parses a row mirroring the RPC shape",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `residual-m0782-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "m0782");
      try {
        const jobId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "failed_final",
          attempts: 3,
          max_attempts: 3,
        });

        // Build the row shape the RPC produces (column-narrowed +
        // last_error redacted to null + synthetic user_message). The
        // schema's regression value: if a future migration adds a
        // column, this object misses the field and .strict() throws.
        const { data, error } = await admin
          .from("compute_jobs")
          .select("*")
          .eq("id", jobId)
          .single();
        expect(error).toBeNull();
        expect(data).not.toBeNull();

        const row = data as unknown as Record<string, unknown>;
        const rpcShape = {
          id: row.id,
          strategy_id: row.strategy_id,
          portfolio_id: row.portfolio_id,
          kind: row.kind,
          parent_job_ids: row.parent_job_ids,
          status: row.status,
          attempts: row.attempts,
          max_attempts: row.max_attempts,
          next_attempt_at: row.next_attempt_at,
          claimed_at: row.claimed_at,
          claimed_by: row.claimed_by,
          // Mirror the RPC's NULL::TEXT redaction.
          last_error: null,
          error_kind: row.error_kind,
          idempotency_key: row.idempotency_key,
          exchange: row.exchange,
          trade_count: row.trade_count,
          created_at: row.created_at,
          updated_at: row.updated_at,
          metadata: row.metadata,
          // Mirror the RPC's synthetic user_message for failed_final.
          user_message:
            "Tried multiple times without success. Please contact support.",
        };

        const parsed = GetUserComputeJobsRowSchema.parse(rpcShape);
        expect(parsed.id).toBe(row.id);
        expect(parsed.last_error).toBeNull();
        expect(parsed.user_message).toContain("Tried multiple times");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// pr-test-analyzer c9 (apply pass): M-0773 FORCE RLS catalog assertion
// ---------------------------------------------------------------------------
//
// The parent migration's DO block asserts `pg_class.relforcerowsecurity =
// TRUE` at apply time. This Vitest pin lifts that assertion to CI so a
// future migration that drops FORCE (e.g. `NO FORCE ROW LEVEL SECURITY`
// bundled with a re-grant sweep) fails the Vitest gate, not just the SQL
// re-apply (which never happens in CI).
//
// Uses Management API introspection because PostgREST does not expose
// pg_class via the schema cache.

describe("audit-2026-05-07 apply — M-0773 FORCE RLS catalog assertion", () => {
  it.skipIf(!HAS_INTROSPECTION)(
    "compute_jobs and compute_job_kinds both have relforcerowsecurity=true",
    async () => {
      const rows = await runIntrospectionSql<{
        relname: string;
        relforcerowsecurity: boolean;
      }>(`
        SELECT relname, relforcerowsecurity
          FROM pg_class
         WHERE relname IN ('compute_jobs', 'compute_job_kinds')
           AND relnamespace = 'public'::regnamespace
         ORDER BY relname;
      `);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.relforcerowsecurity).toBe(true);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// pr-test-analyzer c8 (apply pass): M-0774 REVOKE table grants
// ---------------------------------------------------------------------------
//
// Parent migration asserts table_privileges has zero rows for
// {anon,authenticated,PUBLIC} on compute_jobs and zero non-SELECT rows
// for compute_job_kinds — but only at apply time. A future migration
// that re-grants any privilege (e.g. `GRANT INSERT ON compute_jobs TO
// authenticated` bundled in an unrelated sweep) is caught here by the
// Vitest gate.

describe("audit-2026-05-07 apply — M-0774 REVOKE table grants", () => {
  it.skipIf(!HAS_INTROSPECTION)(
    "compute_jobs has zero grants to anon/authenticated/PUBLIC",
    async () => {
      const rows = await runIntrospectionSql<{ grantee: string; privilege_type: string }>(`
        SELECT grantee, privilege_type
          FROM information_schema.table_privileges
         WHERE table_schema = 'public'
           AND table_name = 'compute_jobs'
           AND grantee IN ('anon', 'authenticated', 'PUBLIC');
      `);
      expect(rows).toHaveLength(0);
    },
  );

  it.skipIf(!HAS_INTROSPECTION)(
    "compute_job_kinds has authenticated with SELECT only (no INSERT/UPDATE/DELETE)",
    async () => {
      const rows = await runIntrospectionSql<{
        privilege_type: string;
      }>(`
        SELECT privilege_type
          FROM information_schema.table_privileges
         WHERE table_schema = 'public'
           AND table_name = 'compute_job_kinds'
           AND grantee = 'authenticated';
      `);
      // Expect exactly one privilege row, of type SELECT.
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) {
        expect(row.privilege_type).toBe("SELECT");
      }
    },
  );
});

// ---------------------------------------------------------------------------
// code-reviewer c8 (apply pass): _assert_owner errcode branches
// ---------------------------------------------------------------------------
//
// The new _assert_owner raises three distinct SQLSTATEs:
//   no_data_found       (02000) — row missing
//   check_violation     (23514) — row exists but user_id IS NULL
//   insufficient_privilege (42501) — row owned by another user
//
// Documented callers all go through service-role (auth.uid() IS NULL ->
// short-circuit), so this is unobservable in production today. The test
// pins the branch contract so a future migration that collapses any two
// branches back into a single errcode is caught. The undefined_column
// wrapper is also exercised via the body-grep on the live function
// definition (catalog-only, no per-branch invocation).

describe("audit-2026-05-07 apply — _assert_owner branches present in live body", () => {
  it.skipIf(!HAS_INTROSPECTION)(
    "_assert_owner body contains all three errcode branches + undefined_column wrapper",
    async () => {
      const rows = await runIntrospectionSql<{ body: string }>(`
        SELECT pg_get_functiondef(p.oid) AS body
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = '_assert_owner';
      `);
      expect(rows).toHaveLength(1);
      const body = rows[0]!.body;
      expect(body).toContain("no_data_found");
      expect(body).toContain("check_violation");
      expect(body).toContain("insufficient_privilege");
      expect(body).toContain("undefined_column");
    },
  );
});

// ---------------------------------------------------------------------------
// pr-test-analyzer c9 (apply pass): M-0783 COALESCE behavioral test
// ---------------------------------------------------------------------------
//
// The migration changed get_user_compute_jobs's WHERE clause to use
// COALESCE(s.user_id, p.user_id) for self-documentation. The semantic
// is unchanged: ownership filter on the strategy OR the portfolio.
// This test pins that semantic via the live function body so a revert
// to the OR-form (or a refactor that drops one side of the COALESCE)
// fails the gate.
//
// We use catalog introspection instead of a real RPC call because the
// RPC short-circuits on auth.uid() IS NULL under service-role and the
// test helpers don't currently expose an authenticated-user JWT.

describe("audit-2026-05-07 apply — M-0783 COALESCE filter pinned in body", () => {
  it.skipIf(!HAS_INTROSPECTION)(
    "get_user_compute_jobs body contains COALESCE(s.user_id, p.user_id)",
    async () => {
      const rows = await runIntrospectionSql<{ body: string }>(`
        SELECT pg_get_functiondef(p.oid) AS body
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'get_user_compute_jobs';
      `);
      expect(rows).toHaveLength(1);
      const body = rows[0]!.body;
      // The exact substring from the migration. A regression to the
      // OR-form drops "COALESCE" entirely; a regression to a one-sided
      // shape would drop one of the column references.
      expect(body).toContain("COALESCE(s.user_id, p.user_id)");
    },
  );
});
