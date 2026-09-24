/**
 * Live-DB regression test — ISSUE-008 (f8 Queued helper RPC path) and the
 * disconnected-key refusal of `public.request_allocator_holdings_sync(uuid)`.
 *
 * LINEAGE. Migration 067 (20260420103104) added a pre-enqueue SELECT on
 * compute_jobs keyed by (api_key_id, kind='poll_allocator_positions', status IN
 * pending/running/done_pending_children), so the RPC returns
 * `{already_inflight: true, next_attempt_at}` when a live job exists and the UI
 * can render "Queued — exchange cooldown, retry in {N}s". The alternative, an
 * `EXCEPTION WHEN unique_violation` handler around the enqueue, never fires:
 * `_enqueue_compute_job_internal` answers a duplicate with an optimistic
 * look-up and ON CONFLICT DO NOTHING, and neither raises 23505.
 * Migration 070 (20260420213754) was re-based on a body older than 067 and
 * lost the prefetch; 076 (20260422122720) inherited 070's shape. From then on
 * the RPC returned `{ok, job_id}` for every call, and this file's first arm
 * never saw the Queued shape.
 * Migration 075 (20260422101911) added a refusal of a soft-disconnected key
 * (`api_key_disconnected`, SQLSTATE P0001); 076 was re-based on 070, not on
 * 075, and lost it.
 * Phase 164.9.1 migration 20260924233749 (allocator_sync_restore_inflight_prefetch)
 * re-bases on 076 and restores both.
 *
 * WHY THESE ARMS COULD NOT CATCH IT BEFORE. Each arm used to `return` quietly
 * when the password sign-in failed, so a lane without password grant reported
 * the arm as passed without calling the RPC. A failed sign-in now THROWS.
 *
 * This file asserts the contract three ways, each against rows it seeded:
 *   1. With a pinned in-flight job: `{already_inflight, next_attempt_at}`, and
 *      sync_status is not flipped to 'syncing'.
 *   2. Without a pinned job: `{ok, job_id}`, and sync_status is 'syncing'.
 *   3. With the key soft-disconnected (and a live job pinned): the call is
 *      refused with P0001 `api_key_disconnected`, is not reported as queued,
 *      and adds no poll job.
 *
 * Together these guard against:
 *   - A re-base that loses the prefetch again (#1 goes RED).
 *   - A buggy always-queued pre-check breaking happy-path syncs (#2).
 *   - A re-base that loses the refusal again, or moves it after the in-flight
 *     look-up (#3 goes RED).
 * The accepted race recorded in the migration header (two concurrent callers
 * that both pass the look-up share one row, and the loser gets `{ok, job_id}`)
 * is not exercised, and no arm is taught to accept `{ok, job_id}` for a live
 * job.
 *
 * Run locally against the local stack (`bash scripts/local-stack/run.sh up`):
 *   npx vitest run --config vitest.livedb.config.ts \
 *     src/__tests__/request-allocator-holdings-sync-queued.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

async function seedApiKey(
  admin: SupabaseClient,
  userId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: userId,
      exchange: "binance",
      label: `__test_issue_008_${label}`,
      api_key_encrypted: "test-encrypted-placeholder",
      is_active: true,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedApiKey(${label}): ${error?.message}`);
  }
  return (data as { id: string }).id;
}

async function pinInflightJob(
  admin: SupabaseClient,
  apiKeyId: string,
  secondsFromNow: number,
): Promise<string> {
  const nextAttempt = new Date(
    Date.now() + secondsFromNow * 1000,
  ).toISOString();
  const { data, error } = await admin
    .from("compute_jobs")
    .insert({
      kind: "poll_allocator_positions",
      api_key_id: apiKeyId,
      status: "pending",
      next_attempt_at: nextAttempt,
      max_attempts: 3,
      attempts: 0,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`pinInflightJob: ${error?.message}`);
  }
  return (data as { id: string }).id;
}

async function createAuthedClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    // Never a skip: an arm that cannot sign in has not called the RPC, and
    // reporting it as passed is how the lost prefetch went unnoticed.
    throw new Error(
      `[issue-008] signInWithPassword failed, so the RPC was never called: ${error?.message ?? "no session"}`,
    );
  }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

describe("ISSUE-008 — request_allocator_holdings_sync f8 Queued path", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "returns {already_inflight, next_attempt_at} when a live job exists",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup = { userIds: [] as string[] };
      const jobIds: string[] = [];
      const apiKeyIds: string[] = [];

      try {
        const email = `issue-008-inflight-${ts}@test.sec`;
        const password = `Issue008Inflight${ts}!`;
        const userId = await createTestUser(admin, email, password);
        cleanup.userIds.push(userId);

        const keyId = await seedApiKey(admin, userId, `inflight-${ts}`);
        apiKeyIds.push(keyId);

        // Pin a live job 600s out so the worker won't claim it.
        const pinnedJobId = await pinInflightJob(admin, keyId, 600);
        jobIds.push(pinnedJobId);

        const authed = await createAuthedClient(email, password);

        const { data, error } = await authed.rpc(
          "request_allocator_holdings_sync",
          { p_api_key_id: keyId },
        );
        expect(error).toBeNull();
        expect(data).toBeTypeOf("object");
        // Primary assertion: the previously-unreachable Queued shape.
        expect((data as Record<string, unknown>).already_inflight).toBe(true);
        expect(
          typeof (data as Record<string, unknown>).next_attempt_at,
        ).toBe("string");

        // The returned next_attempt_at must parse and be in the future
        // (the pinned job is 600s out).
        const nextAttempt = new Date(
          (data as { next_attempt_at: string }).next_attempt_at,
        );
        expect(Number.isNaN(nextAttempt.getTime())).toBe(false);
        expect(nextAttempt.getTime()).toBeGreaterThan(Date.now());

        // Side-effect assertion: sync_status must NOT have been flipped
        // to 'syncing' — the RPC short-circuits before the UPDATE when it
        // sees a queued job.
        const { data: keyRow } = await admin
          .from("api_keys")
          .select("sync_status")
          .eq("id", keyId)
          .single();
        expect((keyRow as { sync_status: string | null }).sync_status).not.toBe(
          "syncing",
        );
      } finally {
        for (const id of jobIds) {
          try {
            await admin.from("compute_jobs").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[issue-008] cleanup compute_jobs ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, {
          apiKeyIds,
          userIds: cleanup.userIds,
        });
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "returns {ok, job_id} when no live job exists (happy path)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup = { userIds: [] as string[] };
      const apiKeyIds: string[] = [];
      let freshlyEnqueuedId: string | null = null;

      try {
        const email = `issue-008-fresh-${ts}@test.sec`;
        const password = `Issue008Fresh${ts}!`;
        const userId = await createTestUser(admin, email, password);
        cleanup.userIds.push(userId);

        const keyId = await seedApiKey(admin, userId, `fresh-${ts}`);
        apiKeyIds.push(keyId);

        const authed = await createAuthedClient(email, password);

        const { data, error } = await authed.rpc(
          "request_allocator_holdings_sync",
          { p_api_key_id: keyId },
        );
        expect(error).toBeNull();
        expect(data).toBeTypeOf("object");
        expect((data as Record<string, unknown>).ok).toBe(true);
        const jobId = (data as { job_id?: string }).job_id;
        expect(typeof jobId).toBe("string");
        freshlyEnqueuedId = jobId ?? null;

        // Side-effect: sync_status IS flipped to 'syncing' on fresh enqueue.
        const { data: keyRow } = await admin
          .from("api_keys")
          .select("sync_status")
          .eq("id", keyId)
          .single();
        expect((keyRow as { sync_status: string | null }).sync_status).toBe(
          "syncing",
        );
      } finally {
        if (freshlyEnqueuedId) {
          try {
            await admin
              .from("compute_jobs")
              .delete()
              .eq("id", freshlyEnqueuedId);
          } catch (err) {
            console.warn(
              `[issue-008] cleanup compute_jobs ${freshlyEnqueuedId}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, {
          apiKeyIds,
          userIds: cleanup.userIds,
        });
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "refuses a soft-disconnected key with P0001 api_key_disconnected, before the in-flight look-up",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup = { userIds: [] as string[] };
      const apiKeyIds: string[] = [];
      let keyId: string | null = null;

      try {
        const email = `issue-008-disconnected-${ts}@test.sec`;
        const password = `Issue008Disconnected${ts}!`;
        const userId = await createTestUser(admin, email, password);
        cleanup.userIds.push(userId);

        keyId = await seedApiKey(admin, userId, `disconnected-${ts}`);
        apiKeyIds.push(keyId);

        // A live job is pinned too, so this arm also fails if the refusal is
        // moved after the in-flight look-up: that order would answer
        // {already_inflight} for a disconnected key.
        const pinnedJobId = await pinInflightJob(admin, keyId, 600);

        const { error: discErr } = await admin
          .from("api_keys")
          .update({ disconnected_at: new Date().toISOString() } as never)
          .eq("id", keyId);
        if (discErr) {
          throw new Error(`disconnect ${keyId}: ${discErr.message}`);
        }

        const authed = await createAuthedClient(email, password);
        const { data, error } = await authed.rpc(
          "request_allocator_holdings_sync",
          { p_api_key_id: keyId },
        );
        expect(error).not.toBeNull();
        expect(error?.code).toBe("P0001");
        expect(error?.message).toBe("api_key_disconnected");
        expect(
          (data as Record<string, unknown> | null)?.already_inflight,
        ).toBeUndefined();

        // No poll job was added for THIS key: the only one is the pinned one.
        const { data: pollRows, error: pollErr } = await admin
          .from("compute_jobs")
          .select("id")
          .eq("api_key_id", keyId)
          .eq("kind", "poll_allocator_positions");
        if (pollErr) throw new Error(`read poll jobs: ${pollErr.message}`);
        expect((pollRows as { id: string }[]).map((r) => r.id)).toEqual([
          pinnedJobId,
        ]);
      } finally {
        if (keyId) {
          try {
            await admin.from("compute_jobs").delete().eq("api_key_id", keyId);
          } catch (err) {
            console.warn(
              `[issue-008] cleanup compute_jobs for ${keyId}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, {
          apiKeyIds,
          userIds: cleanup.userIds,
        });
      }
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("issue-008-queued");
    expect(true).toBe(true);
  });
});
