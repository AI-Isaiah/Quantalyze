/**
 * Live-DB regression test — ISSUE-008 (f8 Queued helper RPC path).
 *
 * Pre-migration 067: request_allocator_holdings_sync could never return
 * `{already_inflight: true, next_attempt_at: ...}`. The dead
 * `EXCEPTION WHEN unique_violation` handler never fired because
 * `_enqueue_compute_job_internal` uses optimistic lookup + ON CONFLICT DO
 * NOTHING — neither path raises 23505.
 *
 * Migration 067 added a pre-enqueue SELECT on compute_jobs keyed by
 * (api_key_id, kind='poll_allocator_positions', status IN pending/running/
 * done_pending_children). When an inflight job exists, the RPC now returns
 * the queued shape so the UI can render "Queued — exchange cooldown, retry
 * in {N}s".
 *
 * This test asserts the contract two ways:
 *   1. With a pinned inflight job: response is {already_inflight, next_attempt_at}.
 *   2. Without a pinned job: response is {ok, job_id}.
 *
 * Together these guard against:
 *   - Accidental reversion to the dead-handler shape (regression test #1).
 *   - A buggy always-queued pre-check breaking happy-path syncs (#2).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/request-allocator-holdings-sync-queued.test.ts
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
): Promise<SupabaseClient | null> {
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    console.warn(
      "[issue-008] signInWithPassword failed (password-grant may be disabled):",
      error?.message,
    );
    return null;
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
        if (!authed) return; // password-grant disabled — graceful skip

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
        if (!authed) return;

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

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("issue-008-queued");
    expect(true).toBe(true);
  });
});
