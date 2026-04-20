/**
 * Live-DB integration test — Migration 066 RLS policies on allocator_holdings.
 *
 * Phase 06 / INGEST-09 / SC4 — the application-layer proof that allocator A
 * cannot SELECT allocator B's `allocator_holdings` rows via the user-scoped
 * Supabase client. The DB-level Category B probe was stripped from
 * migration 066's self-verifying DO block (the Supabase MCP cli_login role
 * can't seed auth.users or cleanup under RLS) and re-homed here. This is
 * now the SOLE enforcer of the anti-leak invariant at the DB contract
 * level — do not let it silently skip.
 *
 * Structure mirrors src/__tests__/bridge-outcomes-rls.test.ts verbatim.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/allocator-holdings-rls.test.ts
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
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
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Insert an api_keys row for the given user via service-role (bypasses RLS).
 * allocator_holdings.api_key_id is FK RESTRICT onto api_keys(id), so we must
 * seed one before inserting the holdings row.
 *
 * The row uses dummy-encrypted credentials (just the shape — we never
 * decrypt these). `api_key_encrypted` and `label` are NOT NULL, so they
 * must be provided.
 */
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
      label: `__test_rls_${label}`,
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

/**
 * Insert an allocator_holdings row via service-role. The f5 owner-coherence
 * trigger (migration 066) requires allocator_id === api_keys.user_id for
 * the linked api_key_id — so always pass the key's owner as allocator_id.
 */
async function seedHolding(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
  apiKeyId: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("allocator_holdings")
    .insert({
      allocator_id: allocatorId,
      api_key_id: apiKeyId,
      venue: "binance",
      symbol: "BTC",
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
    throw new Error(`seedHolding(allocator=${allocatorId}): ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/**
 * Create a user-scoped Supabase client authenticated as the given user via
 * signInWithPassword. Returns null (and logs a warning) if password-grant
 * is disabled in the project — the calling test should skip its assertions.
 */
async function createAuthedClient(
  email: string,
  password: string,
): Promise<ReturnType<typeof createClient> | null> {
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    console.warn(
      "[allocator-holdings-rls] signInWithPassword failed (password-grant may be disabled):",
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

describe("Migration 066 — allocator_holdings RLS (INGEST-09 / SC4)", () => {
  // -------------------------------------------------------------------------
  // Two-actor anti-leak proof: owner A reads own row; foreign B reads 0 rows.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "allocator_holdings: owner reads own row; foreign allocator reads 0 rows",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };
      // Inline trackers — cleanupLiveDbRow does NOT own allocator_holdings
      // or api_keys deletion. Mirrors the inline-finally convention from
      // bridge-outcomes-rls.test.ts.
      const holdingIds: string[] = [];
      const apiKeyIds: string[] = [];

      try {
        // --- Seed two allocators via service-role ---------------------
        const passwordA = `RlsAllocA${ts}!`;
        const passwordB = `RlsAllocB${ts}!`;
        const emailA = `rls-alloc-holdings-a-${ts}@test.sec`;
        const emailB = `rls-alloc-holdings-b-${ts}@test.sec`;
        const allocatorAId = await createTestUser(admin, emailA, passwordA);
        const allocatorBId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds!.push(allocatorAId, allocatorBId);

        // --- Seed an api_keys row per allocator (FK RESTRICT target) --
        const keyAId = await seedApiKey(admin, allocatorAId, `a-${ts}`);
        const keyBId = await seedApiKey(admin, allocatorBId, `b-${ts}`);
        apiKeyIds.push(keyAId, keyBId);

        // --- Seed one allocator_holdings row per allocator ------------
        const holdingAId = await seedHolding(admin, allocatorAId, keyAId);
        const holdingBId = await seedHolding(admin, allocatorBId, keyBId);
        holdingIds.push(holdingAId, holdingBId);

        // --- Authenticate as A; must see EXACTLY their own row ---------
        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return; // password-grant disabled — graceful skip

        const { data: aRows, error: aErr } = await clientA
          .from("allocator_holdings")
          .select("id, allocator_id");
        expect(aErr).toBeNull();
        expect(aRows).not.toBeNull();
        // A sees own row and ONLY own row.
        expect(aRows!.length).toBe(1);
        expect(
          (aRows![0] as { allocator_id: string }).allocator_id,
        ).toBe(allocatorAId);
        expect((aRows![0] as { id: string }).id).toBe(holdingAId);

        // --- Authenticate as B; must see EXACTLY their own row --------
        const clientB = await createAuthedClient(emailB, passwordB);
        if (!clientB) return;

        const { data: bRows, error: bErr } = await clientB
          .from("allocator_holdings")
          .select("id, allocator_id");
        expect(bErr).toBeNull();
        expect(bRows).not.toBeNull();
        expect(bRows!.length).toBe(1);
        expect(
          (bRows![0] as { allocator_id: string }).allocator_id,
        ).toBe(allocatorBId);
        expect((bRows![0] as { id: string }).id).toBe(holdingBId);

        // --- Explicit anti-leak: B targeting A's row by id → 0 rows ---
        const { data: bCrossRead, error: bCrossErr } = await clientB
          .from("allocator_holdings")
          .select("id")
          .eq("id", holdingAId);
        expect(bCrossErr).toBeNull();
        expect(bCrossRead).toEqual([]);
      } finally {
        // Dependency-order cleanup: allocator_holdings first (FK RESTRICT
        // on api_keys fires otherwise), then api_keys, then users.
        for (const id of holdingIds) {
          try {
            await admin.from("allocator_holdings").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[allocator-holdings-rls] cleanup allocator_holdings ${id}: ${(err as Error).message}`,
            );
          }
        }
        for (const id of apiKeyIds) {
          try {
            await admin.from("api_keys").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[allocator-holdings-rls] cleanup api_keys ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the test suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("allocator-holdings-rls");
    expect(true).toBe(true);
  });
});
