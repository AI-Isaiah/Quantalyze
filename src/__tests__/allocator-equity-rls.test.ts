/**
 * Live-DB integration test — Migration 070 RLS policies on
 * allocator_equity_snapshots.
 *
 * Phase 07 / PURGE-02 — the TDD Red gate for the Phase 07 data substrate.
 * Mirrors `src/__tests__/allocator-holdings-rls.test.ts` verbatim (allocator
 * A reads own row; foreign allocator reads 0 rows; service-role bypasses
 * RLS for the worker write path). This is the sole application-layer enforcer
 * of the anti-leak invariant for the `allocator_equity_snapshots` table — do
 * not let it silently skip.
 *
 * Unlike `allocator_holdings`, equity snapshots have NO FK to api_keys — the
 * row is keyed on (allocator_id, asof) and carries the per-symbol breakdown
 * in `breakdown jsonb`. So the seed path is simpler: no seedApiKey is needed.
 * The f9 `history_depth_months` column is written on every seed row so the
 * column shape is exercised end-to-end.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully (with `advertiseLiveDbSkipReason`) when those are
 * absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/allocator-equity-rls.test.ts
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
 * Insert an allocator_equity_snapshots row via service-role (bypasses RLS).
 * The row uses today's date as `asof` with an offset in days passed via the
 * `daysAgo` parameter so two rows per allocator don't collide on the
 * (allocator_id, asof) primary key.
 *
 * Always sets `history_depth_months = 24` (per VOICES-ACCEPTED f9 — Binance
 * / Bybit retention cap) so the column shape is exercised.
 */
async function seedEquitySnapshot(
  admin: ReturnType<typeof createLiveAdminClient>,
  allocatorId: string,
  daysAgo: number,
  valueUsd: number,
): Promise<string> {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const asof = d.toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("allocator_equity_snapshots")
    .upsert(
      {
        allocator_id: allocatorId,
        asof,
        value_usd: valueUsd,
        source: "exchange_primary",
        history_depth_months: 24,
      } as never,
      { onConflict: "allocator_id,asof" },
    )
    .select("asof")
    .single();
  if (error || !data) {
    throw new Error(
      `seedEquitySnapshot(allocator=${allocatorId}, asof=${asof}): ${error?.message}`,
    );
  }
  return asof;
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
      "[allocator-equity-rls] signInWithPassword failed (password-grant may be disabled):",
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

describe("Migration 070 — allocator_equity_snapshots RLS (Phase 07 TDD Red gate)", () => {
  // -------------------------------------------------------------------------
  // Owner A reads own row; foreign allocator B reads 0 rows.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "allocator_equity_snapshots: owner reads own row; foreign allocator reads 0 rows",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };
      // Track the (allocator_id, asof) composite key for each seeded row so
      // cleanup can delete via the PK (no surrogate id column on this table).
      const seeded: Array<{ allocatorId: string; asof: string }> = [];

      try {
        // --- Seed two allocators via service-role ---------------------
        const passwordA = `RlsEquityA${ts}!`;
        const passwordB = `RlsEquityB${ts}!`;
        const emailA = `rls-alloc-equity-a-${ts}@test.sec`;
        const emailB = `rls-alloc-equity-b-${ts}@test.sec`;
        const allocatorAId = await createTestUser(admin, emailA, passwordA);
        const allocatorBId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds!.push(allocatorAId, allocatorBId);

        // --- Seed one allocator_equity_snapshots row per allocator -----
        const asofA = await seedEquitySnapshot(admin, allocatorAId, 0, 10000);
        const asofB = await seedEquitySnapshot(admin, allocatorBId, 0, 20000);
        seeded.push({ allocatorId: allocatorAId, asof: asofA });
        seeded.push({ allocatorId: allocatorBId, asof: asofB });

        // --- Authenticate as A; must see EXACTLY their own row ---------
        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return; // password-grant disabled — graceful skip

        const { data: aRows, error: aErr } = await clientA
          .from("allocator_equity_snapshots")
          .select("allocator_id, asof, value_usd, history_depth_months");
        expect(aErr).toBeNull();
        expect(aRows).not.toBeNull();
        // A sees own row and ONLY own row.
        expect(aRows!.length).toBe(1);
        expect(
          (aRows![0] as { allocator_id: string }).allocator_id,
        ).toBe(allocatorAId);
        expect((aRows![0] as { asof: string }).asof).toBe(asofA);
        // f9: history_depth_months flowed through
        expect(
          (aRows![0] as { history_depth_months: number | null })
            .history_depth_months,
        ).toBe(24);

        // --- Authenticate as B; must see EXACTLY their own row --------
        const clientB = await createAuthedClient(emailB, passwordB);
        if (!clientB) return;

        const { data: bRows, error: bErr } = await clientB
          .from("allocator_equity_snapshots")
          .select("allocator_id, asof");
        expect(bErr).toBeNull();
        expect(bRows).not.toBeNull();
        expect(bRows!.length).toBe(1);
        expect(
          (bRows![0] as { allocator_id: string }).allocator_id,
        ).toBe(allocatorBId);
        expect((bRows![0] as { asof: string }).asof).toBe(asofB);

        // --- Explicit anti-leak: B targeting A's row by PK → 0 rows ---
        const { data: bCrossRead, error: bCrossErr } = await clientB
          .from("allocator_equity_snapshots")
          .select("allocator_id")
          .eq("allocator_id", allocatorAId)
          .eq("asof", asofA);
        expect(bCrossErr).toBeNull();
        expect(bCrossRead).toEqual([]);
      } finally {
        // Dependency-order cleanup: equity snapshots first, then users.
        for (const row of seeded) {
          try {
            await admin
              .from("allocator_equity_snapshots")
              .delete()
              .eq("allocator_id", row.allocatorId)
              .eq("asof", row.asof);
          } catch (err) {
            console.warn(
              `[allocator-equity-rls] cleanup allocator_equity_snapshots ` +
                `(${row.allocatorId}, ${row.asof}): ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // Allocator A can read own rows (direct happy-path assertion, separate
  // from the anti-leak two-actor proof above).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "allocator_equity_snapshots: owner reads multi-day own series",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };
      const seeded: Array<{ allocatorId: string; asof: string }> = [];

      try {
        const passwordA = `RlsEquityOwn${ts}!`;
        const emailA = `rls-alloc-equity-own-${ts}@test.sec`;
        const allocatorAId = await createTestUser(admin, emailA, passwordA);
        cleanup.userIds!.push(allocatorAId);

        // Seed three days of history — asserts owner can read >1 row.
        for (const [idx, value] of [10000, 10100, 10250].entries()) {
          const asof = await seedEquitySnapshot(admin, allocatorAId, idx, value);
          seeded.push({ allocatorId: allocatorAId, asof });
        }

        const clientA = await createAuthedClient(emailA, passwordA);
        if (!clientA) return;

        const { data: ownRows, error: ownErr } = await clientA
          .from("allocator_equity_snapshots")
          .select("allocator_id, asof, value_usd")
          .eq("allocator_id", allocatorAId)
          .order("asof", { ascending: true });
        expect(ownErr).toBeNull();
        expect(ownRows).not.toBeNull();
        expect(ownRows!.length).toBe(3);
        for (const row of ownRows!) {
          expect((row as { allocator_id: string }).allocator_id).toBe(
            allocatorAId,
          );
        }
      } finally {
        for (const row of seeded) {
          try {
            await admin
              .from("allocator_equity_snapshots")
              .delete()
              .eq("allocator_id", row.allocatorId)
              .eq("asof", row.asof);
          } catch (err) {
            console.warn(
              `[allocator-equity-rls] cleanup (own) allocator_equity_snapshots ` +
                `(${row.allocatorId}, ${row.asof}): ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // service_role can INSERT + SELECT unconditionally (belt-and-suspenders
  // verification that the `allocator_equity_snapshots_service_all` policy
  // actually engages — not just that bypassrls is on).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "allocator_equity_snapshots: service_role inserts + reads any row",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: Parameters<typeof cleanupLiveDbRow>[1] = {
        userIds: [],
        strategyIds: [],
      };
      const seeded: Array<{ allocatorId: string; asof: string }> = [];

      try {
        const passwordA = `RlsEquitySvc${ts}!`;
        const emailA = `rls-alloc-equity-svc-${ts}@test.sec`;
        const allocatorAId = await createTestUser(admin, emailA, passwordA);
        cleanup.userIds!.push(allocatorAId);

        // service_role INSERT must succeed (matches worker write path).
        const asof = await seedEquitySnapshot(admin, allocatorAId, 0, 99999);
        seeded.push({ allocatorId: allocatorAId, asof });

        // service_role SELECT must return the seeded row (no RLS filter).
        const { data, error } = await admin
          .from("allocator_equity_snapshots")
          .select("allocator_id, value_usd, source, history_depth_months")
          .eq("allocator_id", allocatorAId)
          .eq("asof", asof)
          .single();
        expect(error).toBeNull();
        expect(data).not.toBeNull();
        expect((data as { value_usd: number }).value_usd).toBe(99999);
        expect((data as { source: string }).source).toBe("exchange_primary");
        expect(
          (data as { history_depth_months: number | null })
            .history_depth_months,
        ).toBe(24);
      } finally {
        for (const row of seeded) {
          try {
            await admin
              .from("allocator_equity_snapshots")
              .delete()
              .eq("allocator_id", row.allocatorId)
              .eq("asof", row.asof);
          } catch (err) {
            console.warn(
              `[allocator-equity-rls] cleanup (svc) allocator_equity_snapshots ` +
                `(${row.allocatorId}, ${row.asof}): ${(err as Error).message}`,
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
    advertiseLiveDbSkipReason("allocator-equity-rls");
    expect(true).toBe(true);
  });
});
