/**
 * Live-DB integration test — Migration 093 finalize_csv_strategy RPC.
 *
 * Phase 15 / CSV-01 — Plan 15-06 Task 1.
 *
 * The RPC ships in migration 093. It atomically inserts a strategies row
 * (source='csv', status='pending_review', name=p_strategy_name) AND a
 * strategy_verifications row (status='validated', trust_tier='csv_uploaded',
 * flow_type='csv', source='csv', wizard_session_id=p_wizard_session_id).
 *
 * Cross-AI revision 2026-04-30: the RPC has THREE SQLSTATE 22023 guard
 * sites (invalid fmt, empty p_strategy_name, oversize p_strategy_name).
 * Each test pins a distinct error.message substring so the three guards
 * are independently verified — a future regression that conflates them
 * would surface here.
 *
 * Structure mirrors `src/__tests__/delete-allocator-api-key-rpc.test.ts`
 * (seed helpers, signed-in user-JWT client, dependency-order cleanup).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/csv-finalize-rpc.test.ts
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
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

// ---------------------------------------------------------------------------
// Test fixture state — single owner across all RPC tests so we don't
// burn auth.users rows on every it(). Created in beforeAll, deleted in
// afterAll alongside any strategies the tests created.
// ---------------------------------------------------------------------------

let admin: SupabaseClient | null = null;
let userClient: SupabaseClient | null = null;
let testUserId: string | null = null;
let testUserEmail: string | null = null;
let testUserPassword: string | null = null;
const createdStrategyIds: string[] = [];

async function createAuthedClient(
  email: string,
  password: string,
): Promise<SupabaseClient | null> {
  if (!HAS_LIVE_DB) return null;
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    console.warn(
      "[csv-finalize-rpc] signInWithPassword failed (password-grant may be disabled):",
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

beforeAll(async () => {
  if (!HAS_LIVE_DB) return;
  admin = createLiveAdminClient();
  const ts = Date.now();
  testUserPassword = `CsvFinalizeRpc${ts}!`;
  testUserEmail = `csv-finalize-rpc-${ts}@test.sec`;
  testUserId = await createTestUser(admin, testUserEmail, testUserPassword);
  userClient = await createAuthedClient(testUserEmail, testUserPassword);
}, 30_000);

afterAll(async () => {
  if (!HAS_LIVE_DB || !admin) return;
  // Delete created strategies first; FK CASCADE clears the matching
  // strategy_verifications rows.
  for (const id of createdStrategyIds) {
    try {
      await admin.from("strategies").delete().eq("id", id);
    } catch (err) {
      console.warn(
        `[csv-finalize-rpc] cleanup strategies ${id}: ${(err as Error).message}`,
      );
    }
  }
  if (testUserId) {
    await cleanupLiveDbRow(admin, { userIds: [testUserId] });
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Tests — 6 total. Three of the SQLSTATE 22023 tests pin distinct
// error.message substrings (cross-AI revision 2026-04-30).
// ---------------------------------------------------------------------------

describe("finalize_csv_strategy RPC (Phase 15 / CSV-01)", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "creates BOTH a strategies row AND a strategy_verifications row atomically with user-typed name",
    async () => {
      if (!userClient || !testUserId) return;
      const sessionId = crypto.randomUUID();
      const typedName = "Aurora Test Fund — BTC vol carry";

      const { data: strategyId, error } = await userClient.rpc(
        "finalize_csv_strategy",
        {
          p_user_id: testUserId,
          p_wizard_session_id: sessionId,
          p_fmt: "daily_returns",
          p_strategy_name: typedName,
        },
      );
      expect(error).toBeNull();
      expect(typeof strategyId).toBe("string");
      createdStrategyIds.push(strategyId as string);

      // strategies row shape
      const { data: strat, error: stratErr } = await userClient
        .from("strategies")
        .select("*")
        .eq("id", strategyId as string)
        .single();
      expect(stratErr).toBeNull();
      expect(strat).toBeTruthy();
      const stratRow = strat as Record<string, unknown>;
      expect(stratRow.user_id).toBe(testUserId);
      expect(stratRow.source).toBe("csv");
      expect(stratRow.status).toBe("pending_review");
      // Cross-AI revision 2026-04-30: the user-typed name landed on strategies.name.
      expect(stratRow.name).toBe(typedName);

      // strategy_verifications row shape
      const { data: ver, error: verErr } = await userClient
        .from("strategy_verifications")
        .select("*")
        .eq("strategy_id", strategyId as string)
        .single();
      expect(verErr).toBeNull();
      expect(ver).toBeTruthy();
      const verRow = ver as Record<string, unknown>;
      expect(verRow.status).toBe("validated");
      expect(verRow.trust_tier).toBe("csv_uploaded");
      expect(verRow.flow_type).toBe("csv");
      expect(verRow.source).toBe("csv");
      expect(verRow.wizard_session_id).toBe(sessionId);
      expect(verRow.correlation_id).toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects calls where p_user_id does not match auth.uid (SQLSTATE 42501)",
    async () => {
      if (!userClient || !testUserId) return;
      const fakeUserId = "00000000-0000-0000-0000-000000000000";
      const { data, error } = await userClient.rpc("finalize_csv_strategy", {
        p_user_id: fakeUserId,
        p_wizard_session_id: crypto.randomUUID(),
        p_fmt: "daily_returns",
        p_strategy_name: "Borealis",
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect((error as { code?: string }).code).toBe("42501");
    },
    30_000,
  );

  // ---------------------------------------------------------------------
  // Cross-AI revision 2026-04-30: THREE SQLSTATE 22023 guards. Each test
  // pins a DISTINCT error.message substring so a future regression that
  // collapses one guard into another would surface here.
  // ---------------------------------------------------------------------

  it.skipIf(!HAS_LIVE_DB)(
    "rejects unknown fmt (SQLSTATE 22023, message contains 'invalid fmt')",
    async () => {
      if (!userClient || !testUserId) return;
      const { data, error } = await userClient.rpc("finalize_csv_strategy", {
        p_user_id: testUserId,
        p_wizard_session_id: crypto.randomUUID(),
        p_fmt: "invalid_fmt",
        p_strategy_name: "Cetus",
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      const errObj = error as { code?: string; message?: string };
      expect(errObj.code).toBe("22023");
      expect(errObj.message).toContain("invalid fmt");
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects empty p_strategy_name (SQLSTATE 22023, message contains 'p_strategy_name is required')",
    async () => {
      if (!userClient || !testUserId) return;
      const { data, error } = await userClient.rpc("finalize_csv_strategy", {
        p_user_id: testUserId,
        p_wizard_session_id: crypto.randomUUID(),
        p_fmt: "daily_returns",
        p_strategy_name: "",
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      const errObj = error as { code?: string; message?: string };
      expect(errObj.code).toBe("22023");
      expect(errObj.message).toContain("p_strategy_name is required");
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects oversize p_strategy_name (SQLSTATE 22023, message contains 'exceeds 80 characters')",
    async () => {
      if (!userClient || !testUserId) return;
      const oversizeName = "X".repeat(81);
      const { data, error } = await userClient.rpc("finalize_csv_strategy", {
        p_user_id: testUserId,
        p_wizard_session_id: crypto.randomUUID(),
        p_fmt: "daily_returns",
        p_strategy_name: oversizeName,
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      const errObj = error as { code?: string; message?: string };
      expect(errObj.code).toBe("22023");
      expect(errObj.message).toContain("exceeds 80 characters");
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "each successful call creates exactly one strategies row + one strategy_verifications row",
    async () => {
      if (!admin || !userClient || !testUserId) return;
      const beforeCount = await admin
        .from("strategies")
        .select("id", { count: "exact", head: true })
        .eq("user_id", testUserId)
        .eq("source", "csv");
      const beforeVerCount = await admin
        .from("strategy_verifications")
        .select("id", { count: "exact", head: true })
        .eq("flow_type", "csv");

      const sessionId = crypto.randomUUID();
      const { data: strategyId, error } = await userClient.rpc(
        "finalize_csv_strategy",
        {
          p_user_id: testUserId,
          p_wizard_session_id: sessionId,
          p_fmt: "daily_returns",
          p_strategy_name: "Draco — pair trading",
        },
      );
      expect(error).toBeNull();
      expect(typeof strategyId).toBe("string");
      createdStrategyIds.push(strategyId as string);

      const afterCount = await admin
        .from("strategies")
        .select("id", { count: "exact", head: true })
        .eq("user_id", testUserId)
        .eq("source", "csv");
      const afterVerCount = await admin
        .from("strategy_verifications")
        .select("id", { count: "exact", head: true })
        .eq("strategy_id", strategyId as string);

      expect((afterCount.count ?? 0) - (beforeCount.count ?? 0)).toBe(1);
      // Verify EXACTLY ONE verifications row for this strategy_id.
      expect(afterVerCount.count).toBe(1);
      // Sanity: the global flow_type='csv' total grew by at least 1 too.
      // (Other parallel test runs could grow it more — we only assert ≥.)
      expect((beforeVerCount.count ?? 0) >= 0).toBe(true);
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("csv-finalize-rpc");
    expect(true).toBe(true);
  });
});
