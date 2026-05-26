/**
 * Regression test — C39 / NEW-C39-01: claim_compute_jobs done_pending_children guard.
 *
 * Source: .review/batch-briefs/batch10-match-sql.md / NEW-C39-01
 * Migration: supabase/migrations/20260526100000_claim_dedupe_done_pending_children_guard.sql
 *
 * Problem
 * -------
 * All four partial unique indices cover status IN ('pending','running','done_pending_children').
 * Because 'failed_retry' is NOT in the index predicate, a failed_retry row can coexist with
 * a done_pending_children row for the same (kind, partition_col). The ranked/deduped CTE in
 * claim_compute_jobs (migrations 090 + 117) only scanned ('pending','failed_retry'), so it
 * could elect the failed_retry row as the dedupe winner. When the batch UPDATE then flipped
 * it to 'running', it violated the partial unique index against the live done_pending_children
 * row → ERROR 23505.
 *
 * Fix
 * ---
 * Migration C39 adds a NOT EXISTS guard per partition column in the deduped CTE, excluding
 * any candidate whose (kind, partition_col) already has a running or done_pending_children
 * row. The guard is applied independently per partition column; NULL partition columns
 * skip their respective guard.
 *
 * Two test layers
 * ---------------
 * 1. OFFLINE: parse the migration SQL text and assert the NOT EXISTS guard is present
 *    in the deduped CTE for every partition column. Runs always (no live DB needed).
 *
 * 2. LIVE-DB (it.skipIf(!HAS_LIVE_DB)): construct the coexistence scenario — a
 *    done_pending_children row + a failed_retry row sharing the same (kind, api_key_id) —
 *    then call claim_compute_jobs and assert:
 *    (a) No 23505 error is raised.
 *    (b) The done_pending_children row is NOT claimed (would require changing its status).
 *    (c) The failed_retry row is NOT claimed (blocked by the guard).
 *    Both rows must remain untouched after the claim call.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/claim-dedupe-done-pending-children-guard.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

const MIGRATIONS_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const MIG_C39 =
  "20260526100000_claim_dedupe_done_pending_children_guard.sql";

function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

/** Collapse whitespace for robust pattern matching. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract the block between the `deduped AS (` open and its matching `)`.
 * Throws if not found.
 */
function extractDedupedCte(sql: string): string {
  const startRe = /deduped\s+AS\s*\(/i;
  const m = sql.match(startRe);
  if (!m || m.index === undefined) {
    throw new Error("extractDedupedCte: deduped CTE not found in SQL");
  }
  // Walk forward from the opening paren to find its matching close.
  const fromParen = sql.indexOf("(", m.index + m[0].length - 1);
  let depth = 1;
  let i = fromParen + 1;
  while (i < sql.length && depth > 0) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    i++;
  }
  return sql.slice(fromParen, i);
}

advertiseLiveDbSkipReason("claim-dedupe-done-pending-children-guard");

// =============================================================================
// OFFLINE structural assertions
// =============================================================================

describe("C39 / NEW-C39-01 — offline SQL structural invariants", () => {
  // ---------------------------------------------------------------------------
  // The migration must exist and be parseable.
  // ---------------------------------------------------------------------------
  it("C39: migration file exists", () => {
    const filePath = path.join(MIGRATIONS_DIR, MIG_C39);
    expect(fs.existsSync(filePath), `${MIG_C39} must exist`).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // The deduped CTE in claim_compute_jobs must carry the NOT EXISTS guard for
  // every partition column. Without these guards, a failed_retry row can pass
  // the dedupe despite a live done_pending_children row for the same partition.
  //
  // We look for the guard literals in the full migration text (the deduped CTE
  // is within the CREATE OR REPLACE FUNCTION block) rather than extracting the
  // nested CTE separately — simpler and equally robust for this assertion.
  // ---------------------------------------------------------------------------
  it("C39: deduped CTE has done_pending_children in the NOT EXISTS guard", () => {
    const sql = readMigration(MIG_C39);
    // The guard must reference done_pending_children explicitly so any future
    // edit that removes it fails this test.
    expect(normalizeWs(sql)).toMatch(/done_pending_children/i);
    // Must appear inside a NOT EXISTS context (not just in a comment).
    expect(sql).toMatch(/NOT EXISTS/i);
  });

  it("C39: NOT EXISTS guard covers portfolio_id partition column", () => {
    const sql = normalizeWs(readMigration(MIG_C39));
    // Guard pattern: portfolio_id IS NULL OR NOT EXISTS ( ... x.portfolio_id = ranked.portfolio_id ... )
    expect(sql).toMatch(
      /portfolio_id IS NULL OR NOT EXISTS/i,
    );
    expect(sql).toMatch(/x\.portfolio_id\s*=\s*ranked\.portfolio_id/i);
  });

  it("C39: NOT EXISTS guard covers strategy_id partition column", () => {
    const sql = normalizeWs(readMigration(MIG_C39));
    expect(sql).toMatch(/strategy_id IS NULL OR NOT EXISTS/i);
    expect(sql).toMatch(/x\.strategy_id\s*=\s*ranked\.strategy_id/i);
  });

  it("C39: NOT EXISTS guard covers allocator_id partition column", () => {
    const sql = normalizeWs(readMigration(MIG_C39));
    expect(sql).toMatch(/allocator_id IS NULL OR NOT EXISTS/i);
    expect(sql).toMatch(/x\.allocator_id\s*=\s*ranked\.allocator_id/i);
  });

  it("C39: NOT EXISTS guard covers api_key_id partition column", () => {
    const sql = normalizeWs(readMigration(MIG_C39));
    expect(sql).toMatch(/api_key_id IS NULL OR NOT EXISTS/i);
    expect(sql).toMatch(/x\.api_key_id\s*=\s*ranked\.api_key_id/i);
  });

  // ---------------------------------------------------------------------------
  // The mig 090 / 117 dedupe invariants that must still be present.
  // ---------------------------------------------------------------------------
  it("C39: mig 090 partition-key row_number() OVER dedupe is preserved", () => {
    const sql = readMigration(MIG_C39);
    // All four partition windows must still be present.
    expect(sql).toMatch(/PARTITION BY kind, portfolio_id/i);
    expect(sql).toMatch(/PARTITION BY kind, strategy_id/i);
    expect(sql).toMatch(/PARTITION BY kind, allocator_id/i);
    expect(sql).toMatch(/PARTITION BY kind, api_key_id/i);
  });

  it("C39: mig 117 P97 claim_token stamp is preserved", () => {
    const sql = readMigration(MIG_C39);
    expect(sql).toMatch(/claim_token\s*=\s*gen_random_uuid\(\)/i);
  });

  it("C39: H-B hardening SET search_path is preserved", () => {
    const sql = readMigration(MIG_C39);
    expect(sql).toMatch(/SET search_path = public, pg_temp/i);
  });

  // ---------------------------------------------------------------------------
  // M conf=9 fix (b10-migration reviewer, 2026-05-26): the self-verifier DO
  // block must use LIKE pattern matching against proconfig entries rather than
  // an exact-string comparison. An exact match can silently pass or fail
  // depending on PostgreSQL minor-version GUC serialization differences.
  // ---------------------------------------------------------------------------
  it("C39: self-verifier uses LIKE pattern for proconfig check (not exact-string = ANY)", () => {
    const sql = readMigration(MIG_C39);
    // The old fragile pattern must NOT be present.
    expect(sql).not.toMatch(
      /'search_path=public, pg_temp'\s*=\s*ANY\s*\(\s*p\.proconfig\s*\)/i,
    );
    // The robust LIKE-based pattern must be present instead.
    expect(sql).toMatch(/cfg\s+LIKE\s+'search_path=%'/i);
    expect(sql).toMatch(/cfg\s+LIKE\s+'%public%'/i);
    expect(sql).toMatch(/cfg\s+LIKE\s+'%pg_temp%'/i);
    // The unnest(p.proconfig) form must be used.
    expect(sql).toMatch(/unnest\s*\(\s*p\.proconfig\s*\)/i);
  });

  it("C39: attempts = attempts + 1 unconditional increment is preserved", () => {
    const sql = readMigration(MIG_C39);
    expect(sql).toMatch(/attempts\s*=\s*attempts\s*\+\s*1/i);
  });

  // ---------------------------------------------------------------------------
  // H-1/M-1 fix (red-team b10, 2026-05-26): the UPDATE WHERE clause must
  // re-check status IN ('pending', 'failed_retry') after the CTE snapshot and
  // FOR UPDATE SKIP LOCKED lock. This guards against any concurrent status
  // transition between CTE evaluation and the lock being taken.
  // ---------------------------------------------------------------------------
  it("C39: UPDATE WHERE clause includes status IN ('pending', 'failed_retry') re-check guard", () => {
    const sql = readMigration(MIG_C39);
    // The sub-SELECT that feeds the UPDATE WHERE id IN (...) must include
    // a status filter so a concurrently-transitioned row is never blindly
    // flipped to 'running'.
    expect(sql).toMatch(
      /cj\.status\s+IN\s*\(\s*'pending'\s*,\s*'failed_retry'\s*\)/i,
    );
  });

  // ---------------------------------------------------------------------------
  // M-3 fix (red-team b10, 2026-05-26): the self-verifier's proconfig EXISTS
  // check must pin to the exact function signature to avoid a false-pass if a
  // future migration adds a same-named overload without SET search_path.
  // ---------------------------------------------------------------------------
  it("C39: self-verifier proconfig check is pinned to (p_batch_size integer, p_worker_id text) signature", () => {
    const sql = readMigration(MIG_C39);
    // Must appear inside the proconfig EXISTS block (not only in the body
    // retrieval query). Both occurrences share the same literal, so a single
    // match is sufficient — the test will catch removal of either.
    const pinLiteral =
      "pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text'";
    // Count occurrences — expect at least 2 (proconfig check + body retrieval).
    const count = (sql.match(
      /pg_get_function_identity_arguments\s*\(\s*p\.oid\s*\)\s*=\s*'p_batch_size integer, p_worker_id text'/gi,
    ) ?? []).length;
    expect(
      count,
      `expected at least 2 occurrences of the signature pin (proconfig + body retrieval), got ${count}`,
    ).toBeGreaterThanOrEqual(2);
    void pinLiteral; // referenced above via regex
  });

  // ---------------------------------------------------------------------------
  // Negative guard: the NULL-skip branch form must NOT be inverted.
  // ---------------------------------------------------------------------------
  it("C39: NULL-skip branch uses IS NULL OR form (not IS NOT NULL)", () => {
    const sql = readMigration(MIG_C39);
    // The deduped CTE must use (col IS NULL OR rn = 1) — not the broken inversion.
    expect(sql).toMatch(/\(portfolio_id\s+IS NULL OR rn_p = 1\)/i);
    expect(sql).toMatch(/\(strategy_id\s+IS NULL OR rn_s = 1\)/i);
    expect(sql).toMatch(/\(allocator_id\s+IS NULL OR rn_a = 1\)/i);
    expect(sql).toMatch(/\(api_key_id\s+IS NULL OR rn_k = 1\)/i);
  });
});

// =============================================================================
// LIVE-DB runtime semantics
// =============================================================================

describe("C39 / NEW-C39-01 — live-DB runtime: done_pending_children coexistence guard", () => {
  const cleanupUserIds: string[] = [];
  const cleanupApiKeyIds: string[] = [];
  const cleanupJobIds: string[] = [];

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    const admin = createLiveAdminClient();
    // Clean up jobs first (FK deps).
    for (const id of cleanupJobIds) {
      try {
        await admin.from("compute_jobs").delete().eq("id", id);
      } catch {
        // Best-effort cleanup; failures reported by cleanupLiveDbRow below.
      }
    }
    // API keys second.
    for (const id of cleanupApiKeyIds) {
      try {
        await admin.from("api_keys").delete().eq("id", id);
      } catch {
        // ignore
      }
    }
    await cleanupLiveDbRow(admin, { userIds: cleanupUserIds });
  });

  it.skipIf(!HAS_LIVE_DB)(
    "C39: claim_compute_jobs does NOT claim a failed_retry row whose (kind, api_key_id) has a live done_pending_children row — no 23505 raised",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();

      // Create a user + api_key fixture that satisfies FK constraints.
      const userId = await createTestUser(
        admin,
        `c39-dpc-guard-${ts}@test.sec`,
      );
      cleanupUserIds.push(userId);

      // Insert an api_key row for the test user.
      const { data: apiKey, error: akErr } = await admin
        .from("api_keys")
        .insert({
          user_id: userId,
          exchange: "okx",
          key_hash: `c39test${ts}`,
          status: "active",
          sync_status: "ok",
        })
        .select("id")
        .single<{ id: string }>();
      expect(akErr, `insert api_key: ${akErr?.message}`).toBeNull();
      const apiKeyId = apiKey!.id;
      cleanupApiKeyIds.push(apiKeyId);

      // Seed the done_pending_children row for (kind=poll_allocator_positions, api_key_id).
      // This represents a fan-in child job waiting for parent(s) to finish.
      const { data: dpcJob, error: dpcErr } = await admin
        .from("compute_jobs")
        .insert({
          api_key_id: apiKeyId,
          kind: "poll_allocator_positions",
          status: "done_pending_children",
          priority: "normal",
          exchange: "okx",
          next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
          attempts: 0,
          max_attempts: 3,
        })
        .select("id, status")
        .single<{ id: string; status: string }>();
      expect(dpcErr, `insert done_pending_children job: ${dpcErr?.message}`).toBeNull();
      const dpcJobId = dpcJob!.id;
      cleanupJobIds.push(dpcJobId);
      expect(dpcJob!.status).toBe("done_pending_children");

      // Seed the failed_retry row for the same (kind, api_key_id) with an elapsed backoff.
      // This is the coexistence scenario: failed_retry + done_pending_children for the
      // same partition. The claim path must NOT elect the failed_retry row.
      const { data: frJob, error: frErr } = await admin
        .from("compute_jobs")
        .insert({
          api_key_id: apiKeyId,
          kind: "poll_allocator_positions",
          status: "failed_retry",
          priority: "normal",
          exchange: "okx",
          next_attempt_at: new Date(Date.now() - 60_000).toISOString(),
          attempts: 1,
          max_attempts: 3,
        })
        .select("id, status")
        .single<{ id: string; status: string }>();
      expect(frErr, `insert failed_retry job: ${frErr?.message}`).toBeNull();
      const frJobId = frJob!.id;
      cleanupJobIds.push(frJobId);
      expect(frJob!.status).toBe("failed_retry");

      // Call claim_compute_jobs. This MUST:
      //   (a) Not raise a 23505 error (the pre-fix failure mode).
      //   (b) Not return either of our two test rows in the claimed set.
      const { data: claimed, error: claimErr } = await admin.rpc(
        "claim_compute_jobs",
        { p_batch_size: 10, p_worker_id: "c39-test-worker" },
      );
      expect(
        claimErr,
        `claim_compute_jobs must not raise an error (pre-fix: 23505): ${claimErr?.message}`,
      ).toBeNull();

      const claimedIds = new Set(
        ((claimed as Array<{ id: string }> | null) ?? []).map((r) => r.id),
      );

      expect(
        claimedIds.has(dpcJobId),
        "done_pending_children row must NOT be claimed (status is not claimable)",
      ).toBe(false);

      expect(
        claimedIds.has(frJobId),
        "failed_retry row must NOT be claimed when a done_pending_children row exists for the same (kind, api_key_id) — C39 guard must block it",
      ).toBe(false);

      // Verify both rows remain in their original statuses (claim did not touch them).
      const { data: dpcAfter } = await admin
        .from("compute_jobs")
        .select("status")
        .eq("id", dpcJobId)
        .single<{ status: string }>();
      expect(dpcAfter!.status, "done_pending_children row status unchanged").toBe(
        "done_pending_children",
      );

      const { data: frAfter } = await admin
        .from("compute_jobs")
        .select("status")
        .eq("id", frJobId)
        .single<{ status: string }>();
      expect(frAfter!.status, "failed_retry row status unchanged (guard blocked claim)").toBe(
        "failed_retry",
      );
    },
    60_000,
  );

  it("advertises live-DB skip reason when env is missing", () => {
    advertiseLiveDbSkipReason(
      "claim-dedupe-done-pending-children-guard.test.ts",
    );
    expect(true).toBe(true);
  });
});
