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

/**
 * Seed N daily equity snapshots for an allocator (migration 077 cascade
 * coverage). The snapshot FK is to auth.users(id), NOT api_keys(id), which is
 * exactly why migration 069's holdings-only cascade left stale equity behind
 * — the bug 077 closes. Returns the asof strings seeded so the test can count
 * precisely.
 */
async function seedEquitySnapshots(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
  days = 3,
): Promise<string[]> {
  const rows: { allocator_id: string; asof: string; value_usd: number }[] = [];
  const asofs: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    asofs.push(d);
    rows.push({ allocator_id: allocatorId, asof: d, value_usd: 1000 + i });
  }
  const { error } = await admin
    .from("allocator_equity_snapshots")
    .upsert(rows as never, { onConflict: "allocator_id,asof" });
  if (error) {
    throw new Error(`seedEquitySnapshots(${allocatorId}): ${error.message}`);
  }
  return asofs;
}

async function countSnapshots(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
): Promise<number> {
  const { count } = await admin
    .from("allocator_equity_snapshots")
    .select("*", { count: "exact", head: true })
    .eq("allocator_id", allocatorId);
  return count ?? 0;
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

// ===========================================================================
// H-1183: Migration 077 — last-key snapshot cascade.
//
// delete_allocator_api_key now ALSO deletes allocator_equity_snapshots when
// p_cascade_holdings=true AND the delete drops the caller's api_keys count to
// zero. The snapshot FK is to auth.users(id), not api_keys(id), so prior to
// 077 deleting a key left a full stale equity series behind — which collides
// with the reconstruct UPSERT (DO NOTHING) and produces a permanently empty
// dashboard on delete-and-reconnect. These tests pin the three branches of
// the 077 last-key gate. The pre-077 function (no snapshot cascade) would
// FAIL case (a): snapshots would survive a sole-key cascade=true delete.
// ===========================================================================
describe("Migration 077 — delete_allocator_api_key last-key equity-snapshot cascade", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "cascade=true + SOLE key + seeded snapshots: snapshots are wiped (count → 0)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const apiKeyIds: string[] = [];
      try {
        const password = `Rpc077SoleA${ts}!`;
        const email = `rpc077-sole-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds!.push(ownerId);

        const keyId = await seedApiKey(admin, ownerId, `sole-${ts}`);
        apiKeyIds.push(keyId);
        // Holdings are required by the cascade path (cascade=true deletes
        // them first; the api_keys delete then succeeds). Seed one.
        await seedHolding(admin, ownerId, keyId);
        await seedEquitySnapshots(admin, ownerId, 3);
        expect(await countSnapshots(admin, ownerId)).toBe(3);

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        const { error } = await clientOwner.rpc("delete_allocator_api_key", {
          p_api_key_id: keyId,
          p_cascade_holdings: true,
        });
        expect(error).toBeNull();

        // Sole key gone → remaining key count 0 → snapshot cascade fires.
        const { count: keyCount } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId);
        expect(keyCount).toBe(0);
        // FLAGSHIP 077 assertion: equity series is wiped.
        expect(await countSnapshots(admin, ownerId)).toBe(0);
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

  it.skipIf(!HAS_LIVE_DB)(
    "cascade=true + MULTI-key (delete 1 of 2) + seeded snapshots: snapshots SURVIVE (last-key gate not met)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const apiKeyIds: string[] = [];
      try {
        const password = `Rpc077MultiA${ts}!`;
        const email = `rpc077-multi-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds!.push(ownerId);

        // TWO keys — deleting one leaves one behind, so v_remaining_keys=1
        // and the snapshot cascade must NOT fire.
        const keyId1 = await seedApiKey(admin, ownerId, `multi1-${ts}`);
        const keyId2 = await seedApiKey(admin, ownerId, `multi2-${ts}`);
        apiKeyIds.push(keyId1, keyId2);
        await seedHolding(admin, ownerId, keyId1);
        await seedEquitySnapshots(admin, ownerId, 3);
        expect(await countSnapshots(admin, ownerId)).toBe(3);

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        const { error } = await clientOwner.rpc("delete_allocator_api_key", {
          p_api_key_id: keyId1,
          p_cascade_holdings: true,
        });
        expect(error).toBeNull();

        // key1 gone, key2 remains.
        const { count: key1Count } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId1);
        expect(key1Count).toBe(0);
        const { count: key2Count } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId2);
        expect(key2Count).toBe(1);
        // Multi-key invariant: snapshots untouched (remaining N-1 keys'
        // first-writer-wins aggregated series stays accurate).
        expect(await countSnapshots(admin, ownerId)).toBe(3);
        // key1 already removed by RPC; key2 cleaned below.
        apiKeyIds.splice(apiKeyIds.indexOf(keyId1), 1);
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

  it.skipIf(!HAS_LIVE_DB)(
    "cascade=false + SOLE key + NO holdings + seeded snapshots: snapshots SURVIVE (only hard-delete wipes equity)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = { userIds: [] };
      const apiKeyIds: string[] = [];
      try {
        const password = `Rpc077SoftA${ts}!`;
        const email = `rpc077-soft-${ts}@test.sec`;
        const ownerId = await createTestUser(admin, email, password);
        cleanup.userIds!.push(ownerId);

        // No holdings, so cascade=false succeeds (the api_keys delete won't
        // hit the FK RESTRICT). This isolates the cascade-flag gate: the
        // snapshot cascade is guarded by `IF p_cascade_holdings THEN` and
        // must NOT run when cascade=false, even on a sole-key delete.
        const keyId = await seedApiKey(admin, ownerId, `soft-${ts}`);
        apiKeyIds.push(keyId);
        await seedEquitySnapshots(admin, ownerId, 3);
        expect(await countSnapshots(admin, ownerId)).toBe(3);

        const clientOwner = await createAuthedClient(email, password);
        if (!clientOwner) return;

        const { data, error } = await clientOwner.rpc(
          "delete_allocator_api_key",
          { p_api_key_id: keyId, p_cascade_holdings: false },
        );
        expect(error).toBeNull();
        expect(data).toBe(0); // 0 holdings deleted

        const { count: keyCount } = await admin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("id", keyId);
        expect(keyCount).toBe(0);
        // cascade=false → equity series preserved (the user did NOT ask for
        // a clean slate; soft path must not destroy derived history).
        expect(await countSnapshots(admin, ownerId)).toBe(3);
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
});
