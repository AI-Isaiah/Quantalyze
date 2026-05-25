/**
 * Test-gap closure — migrations 089 (claim_failed_retry) + 090
 * (claim_dedupe_partition_keys).
 *
 * Source: audit-2026-05-07 / reverify-2026-05-25 / testgap / SQL.md
 * Findings: H-1244, M-1134, H-1239, H-1241.
 *
 * Two layers, mirroring the repo's established migration-test pattern
 * (see mandate-columns-schema-sync.test.ts, match-decisions-schema.test.ts,
 * compute-jobs-audit-2026-05-07-residual.test.ts):
 *
 *   1. OFFLINE (always runs): parse the migration SQL text and assert the
 *      load-bearing structural invariants each finding worries about a future
 *      migration silently reverting:
 *        - M-1134: idx_compute_jobs_priority_pending recreated with the WIDENED
 *          predicate that includes failed_retry (else the throttle probe stops
 *          being index-only at high failed_retry volume).
 *        - H-1239: the NULL-partition dedupe branch is `(<col> IS NULL OR rn = 1)`
 *          for every partition column (else NULL-partition rows get wrongly
 *          deduped against unrelated rows).
 *        - H-1241: the priority RPC's row_number() windows tie-break on
 *          `CASE priority WHEN 'high' ... , next_attempt_at` (else an older
 *          low-priority row could win the dedupe over a newer high-priority one).
 *        - H-1244: both claim RPCs still `attempts = attempts + 1` on every
 *          claim — the increment is load-bearing for the failed_final terminal.
 *
 *   2. LIVE-DB (it.skipIf gated on HAS_LIVE_DB / HAS_INTROSPECTION): exercise the
 *      runtime semantics the offline layer can only approximate:
 *        - H-1244: insert a failed_retry row at attempts=2, claim it (→ attempts=3),
 *          mark_compute_job_failed → status MUST be failed_final (mig 089 + the
 *          current mark_compute_job_failed interplay). Needs FK-valid fixtures.
 *        - M-1134: the INSTALLED index predicate (pg_indexes.indexdef) includes
 *          failed_retry — catches drift where the migration applied but a later
 *          one reverted the predicate on the live DB.
 *
 * Run live-DB locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   # for the indexdef introspection assertion:
 *   export SUPABASE_ACCESS_TOKEN=...  SUPABASE_PROJECT_REF=...
 *   npx vitest run src/__tests__/claim-failed-retry-dedupe-migrations.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  runIntrospectionSql,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const MIG_089 = "20260428155809_claim_failed_retry.sql";
const MIG_090 = "20260428190907_claim_dedupe_partition_keys.sql";

function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

/**
 * Extract a single CREATE OR REPLACE FUNCTION <name>( ... ) $$ body $$ block.
 * Returns the whole-statement text (signature + body) so assertions can target
 * either. Throws if not found — guards against a vacuous pass if the migration
 * is renamed/refactored such that the function disappears.
 */
function extractFunctionBlock(sql: string, fnName: string): string {
  // Match from `CREATE OR REPLACE FUNCTION <fnName>(` to the closing `$$;`
  // (the dollar-quoted body terminator used by both migrations).
  const startRe = new RegExp(
    `CREATE OR REPLACE FUNCTION\\s+${fnName}\\s*\\(`,
    "i",
  );
  const startMatch = sql.match(startRe);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(
      `extractFunctionBlock: ${fnName} not found in migration (renamed?)`,
    );
  }
  const from = startMatch.index;
  const end = sql.indexOf("$$;", from);
  if (end === -1) {
    throw new Error(
      `extractFunctionBlock: closing $$; for ${fnName} not found`,
    );
  }
  return sql.slice(from, end + 3);
}

/** Collapse all runs of whitespace to single spaces for robust matching. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

advertiseLiveDbSkipReason("claim-failed-retry-dedupe-migrations");

// ===========================================================================
// OFFLINE structural assertions
// ===========================================================================

describe("Migration 089/090 — offline SQL structural invariants", () => {
  // -------------------------------------------------------------------------
  // M-1134 — idx_compute_jobs_priority_pending widened predicate.
  // The throttle probe SELECT relies on this partial index covering
  // failed_retry rows for an index-only scan. A revert to `status = 'pending'`
  // would silently degrade to heap fetches at high failed_retry volume.
  // -------------------------------------------------------------------------
  it("M-1134: migration 089 recreates idx_compute_jobs_priority_pending with a predicate that includes failed_retry", () => {
    const sql = readMigration(MIG_089);

    // There must be a CREATE INDEX for the throttle-probe index.
    const createIdxRe =
      /CREATE INDEX[\s\S]*?idx_compute_jobs_priority_pending([\s\S]*?);/i;
    const m = sql.match(createIdxRe);
    expect(m, "CREATE INDEX idx_compute_jobs_priority_pending not found").not.toBeNull();

    const idxStmt = normalizeWs(m![1]);
    // The widened predicate must include BOTH pending AND failed_retry in the
    // status IN (...) clause.
    expect(idxStmt).toMatch(/status IN \('pending', ?'failed_retry'\)/i);
    expect(idxStmt).toMatch(/priority IN \('normal', ?'high'\)/i);
  });

  // -------------------------------------------------------------------------
  // H-1239 — NULL-partition dedupe branch.
  // The deduped CTE must skip a partition column's rank check when that column
  // is NULL: `(<col> IS NULL OR rn_x = 1)`. A revert to `IS NOT NULL` or
  // dropping the OR would wrongly collapse NULL-partition rows together.
  // -------------------------------------------------------------------------
  it("H-1239: migration 090 dedupe branch is `(<col> IS NULL OR rn = 1)` for all four partition columns in BOTH RPCs", () => {
    const sql = readMigration(MIG_090);

    for (const fnName of [
      "claim_compute_jobs",
      "claim_compute_jobs_with_priority",
    ]) {
      const block = normalizeWs(extractFunctionBlock(sql, fnName));
      expect(
        block,
        `${fnName}: portfolio_id null-skip branch`,
      ).toMatch(/\(portfolio_id IS NULL OR rn_p = 1\)/i);
      expect(
        block,
        `${fnName}: strategy_id null-skip branch`,
      ).toMatch(/\(strategy_id IS NULL OR rn_s = 1\)/i);
      expect(
        block,
        `${fnName}: allocator_id null-skip branch`,
      ).toMatch(/\(allocator_id IS NULL OR rn_a = 1\)/i);
      expect(
        block,
        `${fnName}: api_key_id null-skip branch`,
      ).toMatch(/\(api_key_id IS NULL OR rn_k = 1\)/i);

      // Negative guard: the broken inversion must NOT be present. This is what
      // makes the test fail if a future migration flips IS NULL → IS NOT NULL.
      expect(
        block,
        `${fnName}: must NOT use IS NOT NULL in the dedupe branch`,
      ).not.toMatch(/(portfolio_id|strategy_id|allocator_id|api_key_id) IS NOT NULL OR rn_/i);
    }
  });

  // -------------------------------------------------------------------------
  // H-1241 — priority tie-break inside each partition.
  // The priority RPC's four row_number() windows must ORDER BY the priority
  // CASE expression FIRST, then next_attempt_at — so the higher-priority row
  // wins the dedupe even when it is newer. A revert to ordering on
  // next_attempt_at alone would let an older low-priority row win.
  // -------------------------------------------------------------------------
  it("H-1241: migration 090 priority RPC orders every partition row_number() by `CASE priority ... , next_attempt_at`", () => {
    const sql = readMigration(MIG_090);
    const block = normalizeWs(
      extractFunctionBlock(sql, "claim_compute_jobs_with_priority"),
    );

    // Each partition window must contain the priority CASE inside its ORDER BY.
    // The CASE expression: high=0, normal=1, else=2. (`\s*` after `(` because
    // migration 090's priority windows wrap across lines — normalizeWs leaves a
    // single space after the open-paren, unlike the legacy RPC's one-liners.)
    const priorityCase =
      /ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, ?next_attempt_at/i;

    // Count the partition windows and assert each carries the priority tie-break.
    const windowCount = (
      block.match(/row_number\(\) OVER \(\s*PARTITION BY kind, /gi) ?? []
    ).length;
    expect(windowCount, "expected 4 partition windows in priority RPC").toBe(4);

    const priorityOrderByCount = (block.match(new RegExp(priorityCase.source, "gi")) ?? [])
      .length;
    expect(
      priorityOrderByCount,
      "every partition window must tie-break on priority CASE then next_attempt_at",
    ).toBe(4);

    // The legacy (non-priority) RPC must NOT carry the priority CASE in its
    // window ORDER BY (it ties only on next_attempt_at) — assert it stays that
    // way so a copy-paste error doesn't accidentally couple them.
    const legacyBlock = normalizeWs(
      extractFunctionBlock(sql, "claim_compute_jobs"),
    );
    expect(
      legacyBlock,
      "legacy claim_compute_jobs windows must order only on next_attempt_at",
    ).toMatch(/row_number\(\) OVER \(PARTITION BY kind, portfolio_id ORDER BY next_attempt_at\)/i);
  });

  // -------------------------------------------------------------------------
  // H-1244 (offline half) — attempts increment is preserved on every claim.
  // The failed_final terminal depends on each re-claim bumping attempts; if a
  // future migration guards it (e.g. `WHERE attempts < max`) jobs loop forever.
  // The runtime terminal transition is verified in the live-DB block below.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // M-1130 (offline half) — the apply-time DO blocks in migrations 089/090
  // self-verify the live function body (pg_get_functiondef LIKE '%...%'), but
  // those run ONLY at apply time. No standing CI test parses the migration
  // SOURCE for the two literals the DO blocks guard: the widened failed_retry
  // filter (mig 089) and the H-B hardened search_path (both). H-1239/H-1241
  // above already pin `row_number() OVER` + the four `PARTITION BY kind, <col>`
  // windows; this adds the remaining two so a migration edit that dropped the
  // failed_retry filter or the search_path hardening fails offline in CI —
  // not only when a fresh DB apply happens to run the DO block.
  //
  // The COMPLEMENTARY live check (pg_get_functiondef on the INSTALLED function
  // — catches a function silently REPLACED outside the migration tree) is
  // FLAGGED: it requires a live DB / introspection and is not runnable
  // offline. See M-1130 in the testgap report.
  it("M-1130: claim_compute_jobs_with_priority body includes the failed_retry filter in migrations 089 AND 090", () => {
    for (const file of [MIG_089, MIG_090]) {
      const block = normalizeWs(
        extractFunctionBlock(
          readMigration(file),
          "claim_compute_jobs_with_priority",
        ),
      );
      // The widened candidate filter (mig 089) — without it, failed_retry rows
      // whose backoff elapsed are never re-claimed and retry jobs stall.
      expect(
        block,
        `${file}: priority RPC must filter status IN ('pending', 'failed_retry')`,
      ).toMatch(/status IN \('pending', ?'failed_retry'\)/i);
    }
  });

  it("M-1130: both claim RPCs keep the H-B hardened `SET search_path = public, pg_temp` in migrations 089 AND 090", () => {
    for (const file of [MIG_089, MIG_090]) {
      const sql = readMigration(file);
      for (const fnName of [
        "claim_compute_jobs",
        "claim_compute_jobs_with_priority",
      ]) {
        const block = normalizeWs(extractFunctionBlock(sql, fnName));
        // H-B hardening (audit): SECURITY DEFINER functions must pin
        // search_path so an attacker cannot shadow unqualified objects. A
        // revert to a default / pg_catalog-bearing search_path is the exact
        // regression the apply-time DO block guards — pin it offline too.
        expect(
          block,
          `${file} ${fnName}: must SET search_path = public, pg_temp`,
        ).toMatch(/SET search_path = public, pg_temp/i);
      }
    }
  });

  it("H-1244: both claim RPCs increment `attempts = attempts + 1` unconditionally in migrations 089 and 090", () => {
    for (const file of [MIG_089, MIG_090]) {
      const sql = readMigration(file);
      for (const fnName of [
        "claim_compute_jobs",
        "claim_compute_jobs_with_priority",
      ]) {
        const block = normalizeWs(extractFunctionBlock(sql, fnName));
        expect(
          block,
          `${file} ${fnName}: unconditional attempts increment`,
        ).toMatch(/attempts = attempts \+ 1/i);
        // Guard against a regression that gates the claim on attempts < max in
        // the candidate SELECT (which would skip the increment for exhausted
        // rows and break the failed_final terminal). No such predicate should
        // appear in the claim candidate filter.
        expect(
          block,
          `${file} ${fnName}: claim filter must NOT guard on attempts < max_attempts`,
        ).not.toMatch(/attempts\s*<\s*max_attempts/i);
      }
    }
  });
});

// ===========================================================================
// LIVE-DB runtime semantics
// ===========================================================================

interface ComputeJobRow {
  id: string;
  status: string;
  attempts: number;
  strategy_id: string | null;
}

async function seedStrategy(
  admin: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("strategies")
    .insert({
      user_id: userId,
      name: `g21-failedretry-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      status: "pending_review",
      source: "okx",
      strategy_types: [],
      subtypes: [],
      markets: [],
      supported_exchanges: [],
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to seed strategy: ${error?.message}`);
  }
  return data.id as string;
}

describe("Migration 089/090 — live-DB runtime semantics", () => {
  const cleanupUserIds: string[] = [];
  const cleanupStrategyIds: string[] = [];
  const cleanupJobIds: string[] = [];

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    const admin = createLiveAdminClient();
    for (const id of cleanupJobIds) {
      try {
        await admin.from("compute_jobs").delete().eq("id", id);
      } catch {
        /* strategies/users cleanup reports its own failures below */
      }
    }
    await cleanupLiveDbRow(admin, {
      strategyIds: cleanupStrategyIds,
      userIds: cleanupUserIds,
    });
  });

  // -------------------------------------------------------------------------
  // H-1244 (runtime half) — the failed_final terminal transition.
  // Insert a sync_trades failed_retry row at attempts=2, claim it via the
  // priority RPC (→ attempts=3), then mark_compute_job_failed → failed_final.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "H-1244: failed_retry re-claim increments attempts to max then mark_failed transitions to failed_final",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g21-failedretry-${ts}@test.sec`,
      );
      cleanupUserIds.push(userId);
      const strategyId = await seedStrategy(admin, userId);
      cleanupStrategyIds.push(strategyId);

      // failed_retry row already attempted twice; backoff long elapsed.
      const { data: inserted, error: insErr } = await admin
        .from("compute_jobs")
        .insert({
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "failed_retry",
          priority: "normal",
          exchange: "okx",
          next_attempt_at: "2020-01-01T00:00:00Z",
          attempts: 2,
          max_attempts: 3,
        })
        .select("id, status, attempts, strategy_id")
        .single<ComputeJobRow>();
      expect(insErr, `insert failed_retry job: ${insErr?.message}`).toBeNull();
      const jobId = inserted!.id;
      cleanupJobIds.push(jobId);

      // Claim it — must increment attempts 2 → 3.
      const { data: claimed, error: claimErr } = await admin.rpc(
        "claim_compute_jobs_with_priority",
        { p_batch_size: 5, p_worker_id: "g21-max-attempts" },
      );
      expect(claimErr, `claim RPC: ${claimErr?.message}`).toBeNull();
      const claimedRow = (claimed as ComputeJobRow[] | null)?.find(
        (r) => r.id === jobId,
      );
      expect(claimedRow, "claim must return our failed_retry row").toBeDefined();
      expect(
        claimedRow!.attempts,
        "claim must increment attempts on failed_retry re-claim (2 → 3)",
      ).toBe(3);

      // mark_compute_job_failed: at attempts >= max_attempts the row must
      // transition to failed_final regardless of error_kind=transient.
      const { error: markErr } = await admin.rpc("mark_compute_job_failed", {
        p_job_id: jobId,
        p_error_kind: "transient",
        p_error: "final attempt",
      });
      expect(markErr, `mark_compute_job_failed: ${markErr?.message}`).toBeNull();

      const { data: finalRow, error: readErr } = await admin
        .from("compute_jobs")
        .select("status")
        .eq("id", jobId)
        .single<{ status: string }>();
      expect(readErr, `read final status: ${readErr?.message}`).toBeNull();
      expect(
        finalRow!.status,
        "after 3rd attempt, mark_failed must transition to failed_final",
      ).toBe("failed_final");
    },
    60_000,
  );

  // -------------------------------------------------------------------------
  // M-1134 (runtime half) — the INSTALLED index predicate includes
  // failed_retry. Mirrors the migration's own DO-block assertion but as a
  // standing regression gate that catches a later migration reverting it.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "M-1134: installed idx_compute_jobs_priority_pending predicate includes failed_retry",
    async () => {
      const rows = await runIntrospectionSql<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_compute_jobs_priority_pending'",
      );
      expect(
        rows.length,
        "idx_compute_jobs_priority_pending must exist",
      ).toBe(1);
      expect(
        rows[0].indexdef,
        `partial index predicate must include failed_retry, got: ${rows[0]?.indexdef}`,
      ).toMatch(/failed_retry/);
    },
    30_000,
  );

  it("advertises live-DB skip reason when env is missing", () => {
    advertiseLiveDbSkipReason("claim-failed-retry-dedupe-migrations.test.ts");
    expect(true).toBe(true);
  });
});
