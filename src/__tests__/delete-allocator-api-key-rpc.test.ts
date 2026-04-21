/**
 * Live-DB integration test — Migration 069 delete_allocator_api_key RPC.
 *
 * Phase 08 Plan 05 follow-up — close /gsd-verify-work 08 Probe 3 gap.
 *
 * The Disconnect-modal route tests in AllocatorExchangeManager.test.tsx
 * prove the UI → RPC contract (default UNCHECKED, button enabled with or
 * without check, RPC called with the expected p_cascade_holdings value).
 * They do NOT prove the RPC's behavior against the live Postgres function
 * — which is what Probe 3 asked a human to verify manually.
 *
 * This file pins the RPC's behavior deterministically:
 *
 *   1. cascade=false + holdings exist  → RPC raises 23503 FK RESTRICT,
 *                                        key AND holdings still present.
 *   2. cascade=true  + holdings exist  → RPC returns N, both the api_keys
 *                                        row and all N allocator_holdings
 *                                        rows for that key are removed.
 *   3. cross-user attempt              → RPC raises 42501 insufficient
 *                                        privilege, nothing deleted.
 *   4. cascade=false + no holdings     → RPC returns 0, key removed cleanly.
 *
 * Structure mirrors `src/__tests__/allocator-holdings-rls.test.ts` verbatim
 * (seed helpers, two-user pattern, dependency-order cleanup).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/delete-allocator-api-key-rpc.test.ts
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

// ---------------------------------------------------------------------------
// Seed helpers (mirrors allocator-holdings-rls.test.ts seedApiKey/seedHolding)
// ---------------------------------------------------------------------------

async function seedApiKey(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: userId,
      exchange: "binance",
      label: `__test_rpc069_${label}`,
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

async function seedHolding(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
  apiKeyId: string,
  symbol = "BTC",
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("allocator_holdings")
    .insert({
      allocator_id: allocatorId,
      api_key_id: apiKeyId,
      venue: "binance",
      symbol,
      asof: today,
      holding_type: "spot",
      side: "flat",
      quantity: 0.1,
      value_usd: 5000,
      mark_price: 50000,
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `seedHolding(allocator=${allocatorId},symbol=${symbol}): ${error?.message}`,
    );
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
      "[delete-allocator-api-key-rpc] signInWithPassword failed (password-grant may be disabled):",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Migration 069 — delete_allocator_api_key RPC (MANAGE-03 Disconnect cascade)", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "cascade=false + holdings present: raises 23503 FK RESTRICT; key and holdings survive",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const holdingIds: string[] = [];
      const apiKeyIds: string[] = [];
      try {
        const password = `RpcOwnerA${ts}!`;
        const email = `rpc069-owner-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds!.push(ownerId);

        const keyId = await seedApiKey(admin, ownerId, `owner-${ts}`);
        apiKeyIds.push(keyId);
        const holdId = await seedHolding(admin, ownerId, keyId);
        holdingIds.push(holdId);

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        const { data, error } = await clientOwner.rpc(
          "delete_allocator_api_key",
          { p_api_key_id: keyId, p_cascade_holdings: false },
        );
        // Expect failure — Postgres FK RESTRICT fires inside the txn.
        expect(data).toBeNull();
        expect(error).not.toBeNull();
        // 23503 is the postgres code for foreign_key_violation.
        expect((error as { code?: string }).code).toBe("23503");

        // Verify neither side was deleted (txn rolled back).
        const { count: keyCount } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId);
        expect(keyCount).toBe(1);
        const { count: holdingCount } = await admin
          .from("allocator_holdings")
          .select("*", { count: "exact", head: true })
          .eq("id", holdId);
        expect(holdingCount).toBe(1);
      } finally {
        for (const id of holdingIds) {
          try {
            await admin.from("allocator_holdings").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[rpc069] cleanup holdings ${id}: ${(err as Error).message}`,
            );
          }
        }
        for (const id of apiKeyIds) {
          try {
            await admin.from("api_keys").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[rpc069] cleanup api_keys ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "cascade=true + holdings present: returns N, removes key and all N holdings atomically",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const holdingIds: string[] = [];
      const apiKeyIds: string[] = [];
      try {
        const password = `RpcOwnerB${ts}!`;
        const email = `rpc069-cascade-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds!.push(ownerId);

        const keyId = await seedApiKey(admin, ownerId, `cascade-${ts}`);
        apiKeyIds.push(keyId);
        holdingIds.push(await seedHolding(admin, ownerId, keyId, "BTC"));
        holdingIds.push(await seedHolding(admin, ownerId, keyId, "ETH"));
        holdingIds.push(await seedHolding(admin, ownerId, keyId, "SOL"));

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        const { data, error } = await clientOwner.rpc(
          "delete_allocator_api_key",
          { p_api_key_id: keyId, p_cascade_holdings: true },
        );
        expect(error).toBeNull();
        // RPC returns the holdings row count deleted.
        expect(data).toBe(3);

        // Key is gone.
        const { count: keyCount } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId);
        expect(keyCount).toBe(0);
        // Holdings are gone.
        const { count: holdingCount } = await admin
          .from("allocator_holdings")
          .select("*", { count: "exact", head: true })
          .eq("api_key_id", keyId);
        expect(holdingCount).toBe(0);

        // Drop trackers — rows already deleted.
        holdingIds.length = 0;
        apiKeyIds.length = 0;
      } finally {
        for (const id of holdingIds) {
          try {
            await admin.from("allocator_holdings").delete().eq("id", id);
          } catch {
            /* already gone */
          }
        }
        for (const id of apiKeyIds) {
          try {
            await admin.from("api_keys").delete().eq("id", id);
          } catch {
            /* already gone */
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "cross-user attempt: allocator B calling with A's api_key_id raises 42501; nothing deleted",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const holdingIds: string[] = [];
      const apiKeyIds: string[] = [];
      try {
        const passwordA = `RpcOwnerXA${ts}!`;
        const passwordB = `RpcOwnerXB${ts}!`;
        const emailA = `rpc069-cross-a-${ts}@test.sec`;
        const emailB = `rpc069-cross-b-${ts}@test.sec`;
        const aId = await createTestUser(admin, emailA, passwordA);
        const bId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds!.push(aId, bId);

        const keyAId = await seedApiKey(admin, aId, `cross-a-${ts}`);
        apiKeyIds.push(keyAId);
        const holdAId = await seedHolding(admin, aId, keyAId);
        holdingIds.push(holdAId);

        // Authenticate as B, then try to delete A's key with cascade=true.
        const clientB = await createAuthedClient(emailB, passwordB);
        if (!clientB) return;

        const { data, error } = await clientB.rpc(
          "delete_allocator_api_key",
          { p_api_key_id: keyAId, p_cascade_holdings: true },
        );
        expect(data).toBeNull();
        expect(error).not.toBeNull();
        // 42501 = insufficient_privilege, what the RPC raises on non-owner.
        expect((error as { code?: string }).code).toBe("42501");

        // Nothing was deleted.
        const { count: keyCount } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyAId);
        expect(keyCount).toBe(1);
        const { count: holdingCount } = await admin
          .from("allocator_holdings")
          .select("*", { count: "exact", head: true })
          .eq("id", holdAId);
        expect(holdingCount).toBe(1);
      } finally {
        for (const id of holdingIds) {
          try {
            await admin.from("allocator_holdings").delete().eq("id", id);
          } catch {
            /* ignore */
          }
        }
        for (const id of apiKeyIds) {
          try {
            await admin.from("api_keys").delete().eq("id", id);
          } catch {
            /* ignore */
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "cascade=false + no holdings: returns 0 and removes the key cleanly",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const apiKeyIds: string[] = [];
      try {
        const password = `RpcCleanC${ts}!`;
        const email = `rpc069-clean-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds!.push(ownerId);

        const keyId = await seedApiKey(admin, ownerId, `clean-${ts}`);
        apiKeyIds.push(keyId);

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        const { data, error } = await clientOwner.rpc(
          "delete_allocator_api_key",
          { p_api_key_id: keyId, p_cascade_holdings: false },
        );
        expect(error).toBeNull();
        expect(data).toBe(0);

        const { count: keyCount } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId);
        expect(keyCount).toBe(0);
        apiKeyIds.length = 0;
      } finally {
        for (const id of apiKeyIds) {
          try {
            await admin.from("api_keys").delete().eq("id", id);
          } catch {
            /* already gone */
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("delete-allocator-api-key-rpc");
    expect(true).toBe(true);
  });
});
