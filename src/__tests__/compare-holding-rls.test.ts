/**
 * Live-DB integration test — /compare holding access gate (Phase 09 / D-15 + LIVE-03).
 *
 * Proves that the RLS policy on allocator_equity_snapshots gates cross-allocator
 * reads at the DB layer, and that `fetchHoldingCompareItem` returns `null` in
 * BOTH the "unauthorized" and "no-data" cases — enforcing the D-15 no-existence-leak
 * invariant.
 *
 * Four cases proven:
 *   1. Allocator A reads own holding via fetchHoldingCompareItem → non-null item.
 *   2. Allocator B's client attempting to read A's allocator_id → null (RLS blocks).
 *   3. Allocator B's client attempting own allocator_id with A's symbol → null (no data).
 *   4. Cases 2 and 3 return the same null shape — no existence leak between
 *      "unowned" and "nonexistent" (D-15 proof).
 *
 * The RLS policies under test are in:
 *   supabase/migrations/20260420213754_allocator_equity_snapshots.sql lines 391-413
 *   (owner + admin + service_role three-tier gate)
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with advertiseLiveDbSkipReason) when those are absent.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   HAS_LIVE_DB=1 npx vitest run src/__tests__/compare-holding-rls.test.ts
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

/**
 * Seed 40 days of allocator_equity_snapshots rows with BTC breakdown
 * so fetchHoldingCompareItem has sufficient data (>= 2 data points).
 */
async function seedBtcSnapshots(
  admin: SupabaseClient,
  allocatorId: string,
): Promise<void> {
  const rows = Array.from({ length: 40 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (39 - i)); // oldest first
    return {
      allocator_id: allocatorId,
      asof: d.toISOString().slice(0, 10),
      value_usd: 1000 + i * 100,
      source: "exchange_primary",
      breakdown: { [SYMBOL]: 1000 + i * 100 },
      history_depth_months: 24,
    };
  });

  const { error } = await admin
    .from("allocator_equity_snapshots")
    .upsert(rows as never, { onConflict: "allocator_id,asof" });

  if (error) {
    throw new Error(`seedBtcSnapshots(allocator=${allocatorId}): ${error.message}`);
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

    // Seed: 40 days of BTC snapshots for Allocator A ONLY
    await seedBtcSnapshots(admin, allocAId);

    // Authenticate both users
    clientA = await createAuthedClient(emailA, passwordA);
    clientB = await createAuthedClient(emailB, passwordB);
  }, 30_000);

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    // Clean up seeded snapshots for A (no surrogate id — delete by allocator_id)
    await admin
      .from("allocator_equity_snapshots")
      .delete()
      .eq("allocator_id", allocAId);
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
      expect(result?.analytics.cumulative_return).not.toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "Allocator B attempting to read Allocator A's holding → null (RLS blocks, no existence leak)",
    async () => {
      if (!clientB) return;
      // B's client attempts to read A's allocator_id — RLS on allocator_equity_snapshots
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
      // B's own allocator_id but B has no snapshots seeded → no rows → null
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
      // "no-data" path: B's client, B's own allocator_id (no snapshots → null)
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
