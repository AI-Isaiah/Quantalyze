/**
 * Live-DB integration test — /compare holding access gate (Phase 09 / D-15 + LIVE-03,
 * reseeded on allocator_holdings by Phase 167.1.1 / D-03).
 *
 * Proves that the owner RLS policy `allocator_holdings_owner_select` gates
 * cross-allocator reads at the DB layer, and that `fetchHoldingCompareItem`
 * returns `null` in BOTH the "unauthorized" and "no-data" cases — enforcing the
 * D-15 no-existence-leak invariant. The adapter prices a holding from
 * `allocator_holdings.mark_price`, so that is the table seeded here.
 *
 * Four cases proven:
 *   1. Allocator A reads own holding via fetchHoldingCompareItem → "ready" item
 *      with at least 30 priced days.
 *   2. Allocator B's client attempting to read A's allocator_id → null (RLS blocks).
 *   3. Allocator B's client attempting own allocator_id with A's symbol → null (no data).
 *   4. Cases 2 and 3 return the same null shape — no existence leak between
 *      "unowned" and "nonexistent" (D-15 proof).
 *
 * The RLS policy under test is `allocator_holdings_owner_select` (baseline
 * schema, supabase/schema/baseline.sql). Each seeded row sits behind a real
 * `api_keys` row (FK RESTRICT, and the owner-coherence trigger requires the
 * holding's allocator_id to be the key's owner).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with advertiseLiveDbSkipReason) when those are absent.
 *
 * ⛔ Never run this against the project the Supabase CLI is linked to from a
 * developer checkout: that link is PRODUCTION. Its live proof is CI's
 * `frontend-live-db-lane`, which runs it on a private local stack.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";
import { fetchHoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOLDING_REF = "holding:binance:BTC:spot";
const SYMBOL = "BTC";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a user-scoped Supabase client authenticated as the given user via
 * signInWithPassword. Returns null if password-grant is disabled — calling
 * test should skip its assertions.
 */
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
      "[compare-holding-rls] signInWithPassword failed (password-grant may be disabled):",
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

/** Synthetic api_keys row for the allocator (FK RESTRICT target of allocator_holdings). */
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
      label: `__test_compare_rls_${label}`,
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
 * Seed 40 consecutive days of BTC spot allocator_holdings rows (mark_price > 0,
 * synthetic values) under one key, so fetchHoldingCompareItem has at least
 * HOLDING_COMPARE_MIN_PRICED_DAYS priced days.
 */
async function seedBtcHoldings(
  admin: SupabaseClient,
  allocatorId: string,
  apiKeyId: string,
): Promise<void> {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (40 - i)); // oldest first, all in the past
    const mark = 50000 + i * 10;
    return {
      allocator_id: allocatorId,
      api_key_id: apiKeyId,
      venue: "binance",
      symbol: SYMBOL,
      asof: d.toISOString().slice(0, 10),
      holding_type: "spot",
      side: "flat",
      quantity: 0.1,
      value_usd: mark * 0.1,
      mark_price: mark,
    };
  });

  const { error } = await admin.from("allocator_holdings").insert(rows as never);

  if (error) {
    throw new Error(`seedBtcHoldings(allocator=${allocatorId}): ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("/compare holding RLS access gate (live-DB)", () => {
  advertiseLiveDbSkipReason("compare-holding-rls");

  let admin: SupabaseClient;
  let allocAId: string;
  let allocBId: string;
  let emailA: string;
  let emailB: string;
  let passwordA: string;
  let passwordB: string;
  let clientA: SupabaseClient | null;
  let clientB: SupabaseClient | null;

  let apiKeyAId: string | null = null;

  const cleanup: { userIds: string[] } = { userIds: [] };

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    const ts = Date.now();

    emailA = `rls-compare-alloc-a-${ts}@test.sec`;
    emailB = `rls-compare-alloc-b-${ts}@test.sec`;
    passwordA = `CompareRlsA${ts}!`;
    passwordB = `CompareRlsB${ts}!`;

    // Create two distinct test users
    allocAId = await createTestUser(admin, emailA, passwordA);
    allocBId = await createTestUser(admin, emailB, passwordB);
    cleanup.userIds.push(allocAId, allocBId);

    // Seed: a key and 40 days of BTC spot holdings for Allocator A ONLY
    apiKeyAId = await seedApiKey(admin, allocAId, `a-${ts}`);
    await seedBtcHoldings(admin, allocAId, apiKeyAId);

    // Authenticate both users
    clientA = await createAuthedClient(emailA, passwordA);
    clientB = await createAuthedClient(emailB, passwordB);
  }, 30_000);

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    // Dependency order: holdings first (FK RESTRICT on api_keys), then the key,
    // then the users.
    await admin.from("allocator_holdings").delete().eq("allocator_id", allocAId);
    if (apiKeyAId) await admin.from("api_keys").delete().eq("id", apiKeyAId);
    // Clean up test users
    await cleanupLiveDbRow(admin, cleanup);
  });

  it.skipIf(!HAS_LIVE_DB)(
    "Allocator A reads own holding via fetchHoldingCompareItem → non-null item",
    async () => {
      if (!clientA) return; // password-grant disabled — graceful skip
      const result = await fetchHoldingCompareItem({
        allocator_id: allocAId,
        holding_ref: HOLDING_REF,
        supabase: clientA,
      });
      expect(result).not.toBeNull();
      expect(result?.kind).toBe("holding");
      expect(result?.symbol).toBe(SYMBOL);
      expect(result?.venue).toBe("binance");
      expect(result?.holding_type).toBe("spot");
      // Phase 167.1.1 / D-03: a crypto spot holding is "ready" and carries its
      // priced-day count (40 seeded days, minimum 30).
      expect(result?.historyState).toBe("ready");
      expect(result?.analytics?.priced_days).toBeGreaterThanOrEqual(30);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Allocator B attempting to read Allocator A's holding → null (RLS blocks, no existence leak)",
    async () => {
      if (!clientB) return;
      // B's client attempts to read A's allocator_id — RLS on allocator_holdings
      // blocks the read: WHERE allocator_id = auth.uid() returns zero rows for B
      const result = await fetchHoldingCompareItem({
        allocator_id: allocAId, // A's id, queried through B's client
        holding_ref: HOLDING_REF,
        supabase: clientB,
      });
      expect(result).toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Allocator B attempting own allocator_id with A's symbol → null (no data for B)",
    async () => {
      if (!clientB) return;
      // B's own allocator_id but B has no holdings seeded → no rows → null
      const result = await fetchHoldingCompareItem({
        allocator_id: allocBId,
        holding_ref: HOLDING_REF,
        supabase: clientB,
      });
      expect(result).toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Both 'unauthorized' and 'no-data' return the same null shape — no existence leak (D-15)",
    async () => {
      if (!clientB) return;
      // "unauthorized" path: B's client, A's allocator_id (RLS blocks → zero rows → null)
      const crossAllocator = await fetchHoldingCompareItem({
        allocator_id: allocAId,
        holding_ref: HOLDING_REF,
        supabase: clientB,
      });
      // "no-data" path: B's client, B's own allocator_id (no holdings → null)
      const noData = await fetchHoldingCompareItem({
        allocator_id: allocBId,
        holding_ref: HOLDING_REF,
        supabase: clientB,
      });
      // Both return null — same null shape, no way to distinguish ownership from absence
      expect(crossAllocator).toBeNull();
      expect(noData).toBeNull();
      // Both must be strictly equal (null === null) — no object returned in either case
      expect(crossAllocator).toBe(noData);
    },
    30_000,
  );
});
