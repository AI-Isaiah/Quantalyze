/**
 * Live-DB integration test — Migration 114 RLS hardening on positions
 * (audit-2026-05-07 G12.D.1).
 *
 * Why this test exists
 * --------------------
 * Migration 040's `positions_read` was published-OR-owned: any authenticated
 * user could SELECT every column of positions for a published strategy
 * (realized_pnl, fee_total, exit_price_avg, duration_days, size_peak,
 * opened_at, closed_at) — full reverse-engineering of the strategy's
 * lifecycle without any allocation. Migration 114 replaces the policy with
 * owner-only, mirroring `trades_read` at 002:58-60.
 *
 * This test is the application-layer proof that the new policy holds:
 *   - Manager A owns a PUBLISHED strategy with a positions row.
 *   - Allocator B (no allocation, no relationship) authenticates and
 *     SELECTs from positions targeting A's strategy_id.
 *   - Expected: 0 rows. RLS hides them.
 *
 * Why owner-only and not allocator-with-allocation: the audit's preferred
 * remediation is parity with trades_read (CRITICAL conf=9). Tighter is
 * safer; an allocator-disclosure-tier helper does not yet exist in the
 * schema (verified pre-flight: `grep has_strategy_disclosure_tier` returned
 * no migration hits). If/when that helper lands, positions_read can be
 * relaxed to mirror it — but not before.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB). Mirrors the convention used by
 * src/__tests__/allocator-holdings-rls.test.ts and
 * src/__tests__/bridge-outcomes-rls.test.ts.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/positions-rls-g12d-disclosure-tier.test.ts
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
 * Insert a published strategy owned by `managerId`. Published status is the
 * configuration that the OLD policy (published-OR-owned) leaked through —
 * if RLS was still wrong, allocator B would see the position because the
 * strategy is published. Owner-only (migration 114) blocks regardless of
 * status, so the test asserts the new policy.
 */
async function seedPublishedStrategy(
  admin: ReturnType<typeof createLiveAdminClient>,
  managerId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("strategies")
    .insert({
      user_id: managerId,
      name: `__test_g12d_rls_${label}`,
      status: "published",
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedPublishedStrategy(${label}): ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/**
 * Insert one positions row for the given strategy via the service-role
 * client (bypasses RLS for fixture seeding). Mirrors the worker's reconstruct
 * path's column shape; only the columns required by 040's NOT NULL set are
 * filled.
 */
async function seedPosition(
  admin: ReturnType<typeof createLiveAdminClient>,
  strategyId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("positions")
    .insert({
      strategy_id: strategyId,
      symbol: "BTC/USDT",
      side: "long",
      status: "open",
      entry_price_avg: 50000,
      size_base: 0.1,
      size_peak: 0.1,
      fill_count: 1,
      opened_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedPosition(strategy=${strategyId}): ${error?.message}`);
  }
  return (data as { id: string }).id;
}

/**
 * Create a user-scoped Supabase client authenticated as the given user via
 * signInWithPassword. Returns null (and logs a warning) if password-grant
 * is disabled in the project — the calling test should skip its assertions.
 *
 * Verbatim convention from allocator-holdings-rls.test.ts.
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
      "[positions-rls-g12d] signInWithPassword failed (password-grant may be disabled):",
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

describe("Migration 114 — positions RLS owner-only (G12.D.1)", () => {
  // -------------------------------------------------------------------------
  // Two-actor anti-leak proof:
  //   - Manager A owns a published strategy with a positions row.
  //   - Allocator B (no allocation) reads positions → 0 rows.
  //   - Manager A reads own positions → exactly 1 row.
  //
  // Failure of this test is the regression signal that 040's leaky policy
  // has reappeared. The OLD policy returned 1 row to B (because the
  // strategy is published); the NEW policy returns 0.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "positions: foreign authenticated user reads 0 rows from a published strategy's positions",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };
      // Inline tracker — cleanupLiveDbRow does NOT delete positions rows.
      // The strategy CASCADE on positions handles cleanup transitively
      // when the strategy row is deleted, but we track explicitly so a
      // failed CASCADE doesn't silently leave orphaned test rows.
      const positionIds: string[] = [];

      try {
        // --- Seed manager A + foreign allocator B via service-role ---
        const passwordA = `RlsMgrA${ts}!`;
        const passwordB = `RlsAllocB${ts}!`;
        const emailA = `rls-positions-mgr-a-${ts}@test.sec`;
        const emailB = `rls-positions-alloc-b-${ts}@test.sec`;
        const managerAId = await createTestUser(admin, emailA, passwordA);
        const allocatorBId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds!.push(managerAId, allocatorBId);

        // --- Seed a PUBLISHED strategy owned by A. Published is the
        //     configuration that the OLD policy leaked through. The NEW
        //     policy must block B regardless of status.
        const stratAId = await seedPublishedStrategy(
          admin,
          managerAId,
          `a-${ts}`,
        );
        cleanup.strategyIds!.push(stratAId);

        // --- Seed one positions row for that strategy ---------------
        const posAId = await seedPosition(admin, stratAId);
        positionIds.push(posAId);

        // --- Authenticate as B (foreign allocator, no allocation) ---
        const clientB = await createAuthedClient(emailB, passwordB);
        if (!clientB) return; // password-grant disabled — graceful skip

        // --- Anti-leak: B targeting A's positions by strategy_id → 0 rows ---
        const { data: bRows, error: bErr } = await clientB
          .from("positions")
          .select("id, strategy_id, realized_pnl, fee_total, exit_price_avg")
          .eq("strategy_id", stratAId);
        expect(bErr).toBeNull();
        // Critical assertion: zero rows. The OLD policy returned 1 here.
        expect(bRows).toEqual([]);

        // --- Belt-and-braces: B targeting the position by id → 0 rows ---
        const { data: bByIdRows, error: bByIdErr } = await clientB
          .from("positions")
          .select("id")
          .eq("id", posAId);
        expect(bByIdErr).toBeNull();
        expect(bByIdRows).toEqual([]);

        // --- Authenticate as A; must see EXACTLY their own row ------
        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return;

        const { data: aRows, error: aErr } = await clientA
          .from("positions")
          .select("id, strategy_id")
          .eq("strategy_id", stratAId);
        expect(aErr).toBeNull();
        expect(aRows).not.toBeNull();
        expect(aRows!.length).toBe(1);
        expect((aRows![0] as { id: string }).id).toBe(posAId);
        expect(
          (aRows![0] as { strategy_id: string }).strategy_id,
        ).toBe(stratAId);
      } finally {
        // Dependency-order cleanup. positions has FK ON DELETE CASCADE
        // to strategies, so deleting the strategy purges positions
        // transitively, but we delete explicitly first to surface any
        // CASCADE failures via console.warn instead of leaving orphans.
        for (const id of positionIds) {
          try {
            await admin.from("positions").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[positions-rls-g12d] cleanup positions ${id}: ${(err as Error).message}`,
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
    advertiseLiveDbSkipReason("positions-rls-g12d-disclosure-tier");
    expect(true).toBe(true);
  });
});
