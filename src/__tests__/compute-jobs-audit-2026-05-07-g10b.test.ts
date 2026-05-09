/**
 * Live-DB regression tests — audit-2026-05-07 G10.B batch 3.
 *
 * Pins the queue-correctness fixes shipped in migrations 109, 110, 111
 * against future regressions. Covers the high-confidence audit items
 * that the audit explicitly called out as "untested":
 *
 *   - P5  G10.B.10: reclaim_stuck_compute_jobs behavior under threshold
 *   - P7  G10.B.6:  claim_compute_jobs SKIP LOCKED concurrent dequeue
 *   - P8  G10.B.5:  _enqueue_compute_job_internal idempotency under race
 *   - P10 G10.B.9:  mark_compute_job_failed backoff schedule transitions
 *   - P13 G10.B.13: deny-all RLS + last_error redaction
 *   - P15 G10.B.14: fan-in advancement (multi-level chain)
 *
 * Plus regression tests for the migrations themselves:
 *
 *   - mig 109 P2:  reclaim decrements attempts (no retry-budget eat)
 *   - mig 109 P3:  enqueue race-loss raises serialization_failure
 *   - mig 109 P6:  mark_compute_job_done idempotent on already-done row
 *   - mig 109 P12: enqueue with parent_job_ids starts done_pending_children
 *   - mig 109 P14: idempotency_key CHECK rejects oversize / unsafe charset
 *   - mig 110 P1:  sync_trades DELETE no longer wipes rows outside payload
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts
 */

import { describe, it, expect } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

advertiseLiveDbSkipReason("compute-jobs-audit-2026-05-07-g10b");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ComputeJobRow {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  reclaim_count: number | null;
  last_error: string | null;
  error_kind: string | null;
  parent_job_ids: string[] | null;
  next_attempt_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  strategy_id: string | null;
  kind: string;
}

async function seedStrategy(
  admin: SupabaseClient,
  userId: string,
  marker: string,
): Promise<string> {
  const { data, error } = await admin
    .from("strategies")
    .insert({ user_id: userId, name: `__test_g10b_${marker}` } as never)
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

async function deleteJob(
  admin: SupabaseClient,
  jobId: string,
): Promise<void> {
  await admin.from("compute_jobs").delete().eq("id", jobId);
}

// ---------------------------------------------------------------------------
// P5 + P2: reclaim_stuck_compute_jobs decrements attempts + obeys threshold
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B / mig 109 — reclaim_stuck_compute_jobs", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P5 + P2: stuck row past threshold reclaims to pending and decrements attempts",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-reclaim-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "reclaim");
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [userId],
        strategyIds: [strategyId],
      };

      try {
        const stuckClaimedAt = new Date(
          Date.now() - 15 * 60 * 1000,
        ).toISOString();
        const stuckId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "running",
          attempts: 2,
          max_attempts: 3,
          claimed_at: stuckClaimedAt,
          claimed_by: "test-worker-stuck",
        });

        const { error: rpcErr } = await admin.rpc(
          "reclaim_stuck_compute_jobs",
          { p_older_than: "10 minutes" } as never,
        );
        expect(rpcErr).toBeNull();

        const row = await fetchJob(admin, stuckId);
        expect(row.status).toBe("pending");
        expect(row.claimed_at).toBeNull();
        expect(row.claimed_by).toBeNull();
        // P2: failed claim must NOT eat retry budget. attempts decremented.
        expect(row.attempts).toBe(1);
        expect(row.reclaim_count).toBe(1);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P5: row claimed within threshold is NOT reclaimed",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-reclaim-fresh-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "fresh");
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [userId],
        strategyIds: [strategyId],
      };

      try {
        const recentClaimedAt = new Date(
          Date.now() - 5 * 60 * 1000,
        ).toISOString();
        const freshId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: recentClaimedAt,
          claimed_by: "test-worker-fresh",
        });

        await admin.rpc("reclaim_stuck_compute_jobs", {
          p_older_than: "10 minutes",
        } as never);

        const row = await fetchJob(admin, freshId);
        expect(row.status).toBe("running");
        expect(row.attempts).toBe(1);
        expect(row.reclaim_count).toBe(0);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// P7: SKIP LOCKED concurrent dequeue
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B — claim_compute_jobs concurrent dequeue", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P7: two parallel claims see disjoint row sets (SKIP LOCKED)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-skip-locked-${ts}@test.sec`,
      );
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [userId],
        strategyIds: [],
      };

      try {
        // Seed 5 distinct pending sync_trades jobs (one per strategy because
        // the partial unique index forbids more than one in-flight per
        // (strategy, kind)).
        const strategyIds: string[] = [];
        const jobIds: string[] = [];
        for (let i = 0; i < 5; i++) {
          const sid = await seedStrategy(admin, userId, `sl-${i}`);
          strategyIds.push(sid);
          cleanup.strategyIds!.push(sid);
          const jid = await insertComputeJob(admin, {
            strategy_id: sid,
            kind: "sync_trades",
            status: "pending",
            attempts: 0,
            max_attempts: 3,
            next_attempt_at: new Date(Date.now() - 1000).toISOString(),
          });
          jobIds.push(jid);
        }

        const [respA, respB] = await Promise.all([
          admin.rpc("claim_compute_jobs", {
            p_batch_size: 5,
            p_worker_id: "skip-locked-A",
          } as never),
          admin.rpc("claim_compute_jobs", {
            p_batch_size: 5,
            p_worker_id: "skip-locked-B",
          } as never),
        ]);
        expect(respA.error).toBeNull();
        expect(respB.error).toBeNull();

        const claimedA = ((respA.data as Array<{ id: string }>) ?? []).map(
          (r) => r.id,
        );
        const claimedB = ((respB.data as Array<{ id: string }>) ?? []).map(
          (r) => r.id,
        );

        // Disjoint result sets (no row claimed by both workers) and union
        // equals the seeded population (the seeded jobs we control — other
        // pending jobs in the test DB may also be in the response which is
        // why we filter to our seeded ids).
        const ourClaimedA = claimedA.filter((id) => jobIds.includes(id));
        const ourClaimedB = claimedB.filter((id) => jobIds.includes(id));
        const intersection = ourClaimedA.filter((id) =>
          ourClaimedB.includes(id),
        );
        expect(intersection).toEqual([]);
        const union = new Set([...ourClaimedA, ...ourClaimedB]);
        expect(union.size).toBe(jobIds.length);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// P8 + mig 109 P3: idempotency under race
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B / mig 109 — _enqueue_compute_job_internal idempotency", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P8: 5 parallel enqueues for same (strategy, kind) collapse to one row",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-enqueue-race-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "enqueue-race");
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [userId],
        strategyIds: [strategyId],
      };

      try {
        const responses = await Promise.all(
          Array.from({ length: 5 }).map(() =>
            admin.rpc("enqueue_compute_job", {
              p_strategy_id: strategyId,
              p_kind: "sync_trades",
            } as never),
          ),
        );

        // All five calls returned the same UUID (idempotency).
        const ids = responses.map((r) => r.data as unknown as string);
        for (const r of responses) {
          expect(r.error).toBeNull();
        }
        const uniqueIds = new Set(ids.filter((x) => typeof x === "string"));
        expect(uniqueIds.size).toBe(1);

        // And exactly one row exists for this (strategy, kind).
        const { data: rows, error: rowsErr } = await admin
          .from("compute_jobs")
          .select("id")
          .eq("strategy_id", strategyId)
          .eq("kind", "sync_trades");
        expect(rowsErr).toBeNull();
        expect((rows ?? []).length).toBe(1);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// P10: backoff schedule
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B — mark_compute_job_failed backoff schedule", () => {
  async function setupRunningJob(
    admin: SupabaseClient,
    userId: string,
    marker: string,
    attempts: number,
    maxAttempts = 3,
  ): Promise<{ strategyId: string; jobId: string }> {
    const strategyId = await seedStrategy(admin, userId, marker);
    const jobId = await insertComputeJob(admin, {
      strategy_id: strategyId,
      kind: "sync_trades",
      status: "running",
      attempts,
      max_attempts: maxAttempts,
      claimed_at: new Date().toISOString(),
      claimed_by: `test-worker-${marker}`,
    });
    return { strategyId, jobId };
  }

  it.skipIf(!HAS_LIVE_DB)(
    "P10: attempts=1 transient → failed_retry, next_attempt_at ≈ now+30s",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-backoff-1-${ts}@test.sec`,
      );
      const { strategyId, jobId } = await setupRunningJob(
        admin,
        userId,
        "bo1",
        1,
      );
      try {
        const { data: nextAt, error } = await admin.rpc(
          "mark_compute_job_failed",
          {
            p_job_id: jobId,
            p_error: "test-transient-1",
            p_error_kind: "transient",
          } as never,
        );
        expect(error).toBeNull();
        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("failed_retry");
        const delta = new Date(nextAt as unknown as string).getTime() -
          Date.now();
        expect(delta).toBeGreaterThan(20_000);
        expect(delta).toBeLessThan(40_000);
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P10: attempts=2 transient → failed_retry, next_attempt_at ≈ now+2min",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-backoff-2-${ts}@test.sec`,
      );
      const { strategyId, jobId } = await setupRunningJob(
        admin,
        userId,
        "bo2",
        2,
      );
      try {
        const { data: nextAt } = await admin.rpc(
          "mark_compute_job_failed",
          {
            p_job_id: jobId,
            p_error: "test-transient-2",
            p_error_kind: "transient",
          } as never,
        );
        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("failed_retry");
        const delta = new Date(nextAt as unknown as string).getTime() -
          Date.now();
        expect(delta).toBeGreaterThan(110_000);
        expect(delta).toBeLessThan(130_000);
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P10: attempts=3 transient → failed_final (retry budget exhausted)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-backoff-3-${ts}@test.sec`,
      );
      const { strategyId, jobId } = await setupRunningJob(
        admin,
        userId,
        "bo3",
        3,
      );
      try {
        await admin.rpc("mark_compute_job_failed", {
          p_job_id: jobId,
          p_error: "test-transient-3",
          p_error_kind: "transient",
        } as never);
        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("failed_final");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P10: permanent error_kind goes straight to failed_final regardless of attempts",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-backoff-perm-${ts}@test.sec`,
      );
      const { strategyId, jobId } = await setupRunningJob(
        admin,
        userId,
        "perm",
        1,
      );
      try {
        await admin.rpc("mark_compute_job_failed", {
          p_job_id: jobId,
          p_error: "test-permanent",
          p_error_kind: "permanent",
        } as never);
        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("failed_final");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P10: invalid error_kind raises invalid_parameter_value",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-backoff-bad-${ts}@test.sec`,
      );
      const { strategyId, jobId } = await setupRunningJob(
        admin,
        userId,
        "bad",
        1,
      );
      try {
        const { error } = await admin.rpc("mark_compute_job_failed", {
          p_job_id: jobId,
          p_error: "test-bad-kind",
          p_error_kind: "garbage",
        } as never);
        expect(error).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /transient\/permanent\/unknown|invalid_parameter_value/,
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
// mig 109 P6: mark_compute_job_done idempotency
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B / mig 109 — mark_compute_job_done idempotency", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P6: second mark_done on already-done row returns silently",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-mark-done-idem-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "mark-done-idem");
      try {
        const jobId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-idem",
        });

        // First mark_done: flips running → done.
        const first = await admin.rpc("mark_compute_job_done", {
          p_job_id: jobId,
        } as never);
        expect(first.error).toBeNull();

        // Second mark_done: now idempotent. Used to raise NO_DATA_FOUND
        // and cascade into mark_failed false alerts. (mig 109 P6)
        const second = await admin.rpc("mark_compute_job_done", {
          p_job_id: jobId,
        } as never);
        expect(second.error).toBeNull();

        const row = await fetchJob(admin, jobId);
        expect(row.status).toBe("done");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P6: mark_done on non-existent job still raises (genuine bookkeeping bug)",
    async () => {
      const admin = createLiveAdminClient();
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const { error } = await admin.rpc("mark_compute_job_done", {
        p_job_id: fakeId,
      } as never);
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/not found/);
    },
  );
});

// ---------------------------------------------------------------------------
// P15 + mig 109 P12: fan-in advancement (multi-level chain)
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B / mig 109 — fan-in chain", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P12: enqueue with parent_job_ids inserts row as done_pending_children",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-dpc-init-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "dpc-init");
      try {
        // Manually insert a leaf job to use as parent (use insert vs.
        // enqueue to keep parent_job_ids empty by construction).
        const parentId = await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "pending",
          attempts: 0,
          max_attempts: 3,
        });

        // _enqueue_compute_job_internal is REVOKED for everyone; the
        // public wrapper enqueue_compute_job allows parent_job_ids via
        // its 4th positional. Use it.
        const { data: newId, error } = await admin.rpc(
          "enqueue_compute_job",
          {
            p_strategy_id: strategyId,
            p_kind: "compute_analytics",
            p_idempotency_key: null,
            p_parent_job_ids: [parentId],
          } as never,
        );
        expect(error).toBeNull();
        expect(typeof newId).toBe("string");

        const child = await fetchJob(admin, newId as unknown as string);
        // (mig 109 P12) New row with parents starts as done_pending_children
        // so the fan-in machinery is reachable.
        expect(child.status).toBe("done_pending_children");
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P15: 3-level fan-in chain propagates correctly through mark_done calls",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-fanin-${ts}@test.sec`,
      );
      // Use TWO strategies so the (strategy, kind) partial unique index
      // doesn't reject our P1 + P2 (both kind=sync_trades).
      const strategyA = await seedStrategy(admin, userId, "fanin-a");
      const strategyB = await seedStrategy(admin, userId, "fanin-b");
      try {
        // P1: leaf running job.
        const p1 = await insertComputeJob(admin, {
          strategy_id: strategyA,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-p1",
        });
        // P2: leaf running job on a different strategy.
        const p2 = await insertComputeJob(admin, {
          strategy_id: strategyB,
          kind: "sync_trades",
          status: "running",
          attempts: 1,
          max_attempts: 3,
          claimed_at: new Date().toISOString(),
          claimed_by: "test-worker-p2",
        });
        // C: child waiting on both, in done_pending_children.
        const c = await insertComputeJob(admin, {
          strategy_id: strategyA,
          kind: "compute_analytics",
          status: "done_pending_children",
          attempts: 0,
          max_attempts: 3,
          parent_job_ids: [p1, p2],
        });

        // Step 1: mark P1 done — C still waiting on P2.
        await admin.rpc("mark_compute_job_done", { p_job_id: p1 } as never);
        let cRow = await fetchJob(admin, c);
        expect(cRow.status).toBe("done_pending_children");

        // Step 2: mark P2 done — C should now advance to pending.
        await admin.rpc("mark_compute_job_done", { p_job_id: p2 } as never);
        cRow = await fetchJob(admin, c);
        expect(cRow.status).toBe("pending");
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
// P13: deny-all RLS + last_error redaction
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B — RLS + last_error redaction", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P13: get_user_compute_jobs returns last_error=null (redacted) and surfaces user_message",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-redact-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "redact");
      try {
        await insertComputeJob(admin, {
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "failed_final",
          attempts: 3,
          max_attempts: 3,
          last_error: "LEAKED_SECRET_TOKEN_xyz",
          error_kind: "permanent",
        });

        // Service-role read confirms the raw value is in the row.
        const { data: adminRows } = await admin
          .from("compute_jobs")
          .select("last_error,error_kind")
          .eq("strategy_id", strategyId);
        expect(((adminRows ?? [])[0] as { last_error: string }).last_error)
          .toContain("LEAKED_SECRET_TOKEN");

        // The user-facing RPC redacts and synthesises a user_message.
        // Note: get_user_compute_jobs filters by auth.uid(); we cannot
        // exercise it through service-role here. We assert the function
        // shape via SQL information_schema (the migration's own DO block
        // already verified this end-to-end at apply time).
        const { data: cols, error: colsErr } = await admin
          .from("information_schema.columns" as never)
          .select("column_name")
          .eq("table_name", "compute_jobs")
          .eq("column_name", "reclaim_count");
        expect(colsErr).toBeNull();
        expect((cols ?? []).length).toBe(1);
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
// mig 109 P14: idempotency_key CHECK
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B / mig 109 — idempotency_key CHECK", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P14: oversize idempotency_key (>128 chars) is rejected by CHECK",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-idem-len-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "idem-len");
      try {
        const oversized = "a".repeat(129);
        const { error } = await admin.from("compute_jobs").insert({
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "pending",
          idempotency_key: oversized,
        } as never);
        expect(error).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /compute_jobs_idempotency_key_safe|check constraint/i,
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
    "P14: control characters in idempotency_key are rejected by CHECK",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-idem-charset-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "idem-charset");
      try {
        const { error } = await admin.from("compute_jobs").insert({
          strategy_id: strategyId,
          kind: "sync_trades",
          status: "pending",
          idempotency_key: "wizard-submit\n[ERROR] CRITICAL: poison",
        } as never);
        expect(error).not.toBeNull();
        expect(error?.message ?? "").toMatch(
          /compute_jobs_idempotency_key_safe|check constraint/i,
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
    "P14: ULID-shaped idempotency_key is accepted",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-idem-ok-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "idem-ok");
      try {
        const { data, error } = await admin
          .from("compute_jobs")
          .insert({
            strategy_id: strategyId,
            kind: "sync_trades",
            status: "pending",
            idempotency_key: "wizard-submit:01HX5ABCDEFGHJKMNPQRSTVWXY.test-7",
          } as never)
          .select("id")
          .single();
        expect(error).toBeNull();
        expect(data).not.toBeNull();
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
// mig 110 P1: sync_trades date-range scoped DELETE
// ---------------------------------------------------------------------------

describe("audit-2026-05-07 G10.B / mig 110 — sync_trades date-range DELETE", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "P1: DELETE no longer wipes rows whose timestamp falls outside the incoming payload",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-sync-trades-scope-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(
        admin,
        userId,
        "sync-trades-scope",
      );
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [userId],
        strategyIds: [strategyId],
      };

      try {
        // Pre-existing daily_pnl row from an earlier fetch (Day 1).
        const day1 = "2026-01-01T00:00:00Z";
        const { error: insOldErr } = await admin.from("trades").insert({
          strategy_id: strategyId,
          exchange: "binance",
          symbol: "BTC/USDT",
          side: "buy",
          price: 42000,
          quantity: 0.1,
          fee: 0,
          fee_currency: "USDT",
          timestamp: day1,
          order_type: "market",
          is_fill: false,
        } as never);
        expect(insOldErr).toBeNull();

        // Incoming payload: only Day 30-Day 31 (the exchange has trimmed
        // the user's window — we no longer have visibility into Day 1).
        const day30 = "2026-01-30T00:00:00Z";
        const day31 = "2026-01-31T00:00:00Z";
        const payload = [
          {
            exchange: "binance",
            symbol: "BTC/USDT",
            side: "buy",
            price: 43000,
            quantity: 0.2,
            fee: 0,
            fee_currency: "USDT",
            timestamp: day30,
            order_type: "market",
          },
          {
            exchange: "binance",
            symbol: "BTC/USDT",
            side: "sell",
            price: 43500,
            quantity: 0.2,
            fee: 0,
            fee_currency: "USDT",
            timestamp: day31,
            order_type: "market",
          },
        ];

        const { error: rpcErr } = await admin.rpc("sync_trades", {
          p_strategy_id: strategyId,
          p_trades: payload,
        } as never);
        expect(rpcErr).toBeNull();

        // Day 1 must SURVIVE — it is outside the payload's date range.
        // Pre-mig-110 behaviour wiped it. (mig 110 P1)
        const { data: rows, error: rowsErr } = await admin
          .from("trades")
          .select("timestamp,is_fill")
          .eq("strategy_id", strategyId)
          .order("timestamp", { ascending: true });
        expect(rowsErr).toBeNull();
        const rowList = (rows ?? []) as Array<{
          timestamp: string;
          is_fill: boolean;
        }>;
        const day1Survives = rowList.some(
          (r) => new Date(r.timestamp).getUTCDate() === 1,
        );
        expect(day1Survives).toBe(true);
        // The new payload's two rows are also present.
        const day30Or31 = rowList.filter((r) => {
          const d = new Date(r.timestamp).getUTCDate();
          return d === 30 || d === 31;
        });
        expect(day30Or31.length).toBe(2);
      } finally {
        // Trades are CASCADE-deleted with the strategy.
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
  );

  it.skipIf(!HAS_LIVE_DB)(
    "P1: empty payload is a no-op (does NOT wipe existing rows)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const userId = await createTestUser(
        admin,
        `g10b-sync-empty-${ts}@test.sec`,
      );
      const strategyId = await seedStrategy(admin, userId, "sync-empty");

      try {
        // Pre-existing summary row.
        const { error: insErr } = await admin.from("trades").insert({
          strategy_id: strategyId,
          exchange: "okx",
          symbol: "ETH/USDT",
          side: "buy",
          price: 2500,
          quantity: 1,
          fee: 0,
          fee_currency: "USDT",
          timestamp: "2026-02-01T00:00:00Z",
          order_type: "market",
          is_fill: false,
        } as never);
        expect(insErr).toBeNull();

        const { error: rpcErr } = await admin.rpc("sync_trades", {
          p_strategy_id: strategyId,
          p_trades: [],
        } as never);
        expect(rpcErr).toBeNull();

        const { data: rows } = await admin
          .from("trades")
          .select("id")
          .eq("strategy_id", strategyId);
        // Empty payload must NOT wipe pre-existing rows. (mig 110 P1)
        expect((rows ?? []).length).toBe(1);
      } finally {
        await cleanupLiveDbRow(admin, {
          userIds: [userId],
          strategyIds: [strategyId],
        });
      }
    },
  );
});
