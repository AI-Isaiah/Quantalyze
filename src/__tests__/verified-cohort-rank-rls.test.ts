/**
 * Live-DB integration test — Migration 20260626120000
 * get_verified_cohort_rank SECURITY DEFINER RPC (Phase 42 / PEER-03, v1.2.2).
 *
 * The Scenario composer's hypothetical-blend Peer-Percentile (ADR-0025) ranks
 * the blend against the platform's REAL verified-strategy universe. That cohort
 * is unreadable from a normal authed client: strategy_verifications RLS
 * (migration 093) grants an allocator SELECT only on THEIR OWN strategies'
 * verification rows, so the cross-tenant verified aggregate is reachable ONLY
 * through this privileged DEFINER RPC.
 *
 * This file pins the security contract end-to-end against the live TEST
 * Supabase project (qmnijlgmdhviwzwfyzlc):
 *
 *   1. No-identity result shape — a non-admin authed client calling
 *      rpc('get_verified_cohort_rank', ...) gets back ONLY
 *      { cohort_n, sharpe_pct, sortino_pct, max_dd_pct }. The result object
 *      carries NO per-strategy id / name / returns / PII key (T-42-01).
 *   2. Min-N empty — when the verified+published cohort is < 20, the RPC
 *      returns a row with cohort_n set but the three pct columns NULL (honest
 *      empty; T-42-02). In TEST there are no clients, so the natural cohort is
 *      below the floor → assert the NULL-rank shape directly.
 *   3. No cross-tenant leak — a normal authed allocator SELECTing
 *      strategy_verifications directly sees only their OWN rows (owner-scope
 *      RLS). This re-pins the boundary that forces the RPC path: the aggregate
 *      cannot be hand-rolled from a client join.
 *   4. Auth gate — an anon / unauthenticated rpc call is rejected (the RPC is
 *      REVOKEd from anon + the in-fn auth.role()/auth.uid() guard raises 42501),
 *      not served (T-42-03).
 *
 * Structure mirrors `src/__tests__/strategy-verifications-rls.test.ts` (two-
 * actor sign-in, service-role seed, dependency-order cleanup).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Skips
 * gracefully (via `advertiseLiveDbSkipReason`) when those are absent (standard
 * CI without live DB). Requires the migration applied to TEST first.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   export NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # for the anon-reject case
 *   npx vitest run src/__tests__/verified-cohort-rank-rls.test.ts
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

const RPC = "get_verified_cohort_rank";

// The exact set of columns the RPC RETURNS. Anything outside this set in a
// result row would be an identity/PII leak.
const ALLOWED_KEYS = ["cohort_n", "sharpe_pct", "sortino_pct", "max_dd_pct"];

// Keys that must NEVER appear in the RPC result (per-strategy identity / PII).
const FORBIDDEN_KEYS = [
  "id",
  "strategy_id",
  "name",
  "codename",
  "user_id",
  "daily_returns",
  "sharpe",
  "sortino",
  "max_drawdown",
];

/**
 * Sign in as the given user and return a client carrying the user's JWT.
 * Returns null if password-grant is disabled. Mirrors
 * strategy-verifications-rls.test.ts:createAuthedClient.
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
      "[verified-cohort-rank-rls] signInWithPassword failed (password-grant may be disabled):",
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

describe("Migration 20260626120000 — get_verified_cohort_rank (Phase 42 / PEER-03)", () => {
  // -------------------------------------------------------------------------
  // 1 + 2. An authed allocator calling the RPC gets back ONLY the 4 aggregate
  //        scalars (no identity keys), and in the TEST project the cohort is
  //        below min-N=20 so the percentiles are NULL (honest empty).
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "authed rpc returns only aggregate scalars (no identity keys) and a NULL-rank row below min-N",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const password = `CohortRankAuthed${ts}!`;
        const email = `cohort-rank-authed-${ts}@test.sec`;
        const userId = await createTestUser(admin, email, password);
        cleanup.userIds.push(userId);

        const client = await createAuthedClient(email, password);
        if (!client) return; // password-grant disabled — graceful skip

        const { data, error } = await client.rpc(RPC, {
          p_sharpe: 1.5,
          p_sortino: 2.0,
          p_max_dd: 0.1, // magnitude of the blend's max_dd
        });

        // The authed call must succeed (the guard only rejects anon).
        expect(error).toBeNull();
        expect(data).not.toBeNull();

        // RETURNS TABLE → an array with exactly one row.
        expect(Array.isArray(data)).toBe(true);
        const rows = data as Record<string, unknown>[];
        expect(rows.length).toBe(1);
        const row = rows[0];

        // --- No-identity invariant (T-42-01): the row carries ONLY the four
        //     allowed aggregate keys; no per-strategy identity/PII key. ---
        expect(Object.keys(row).sort()).toEqual([...ALLOWED_KEYS].sort());
        for (const k of FORBIDDEN_KEYS) {
          expect(k in row).toBe(false);
        }

        // cohort_n is always a present integer (the honest count).
        expect(typeof row.cohort_n).toBe("number");

        // --- Min-N invariant (T-42-02): the TEST project has no real verified
        //     clients, so the cohort is below min-N=20 and the three
        //     percentiles are NULL. (If TEST ever crosses 20 verified+published
        //     strategies this assertion documents the boundary to revisit.) ---
        if ((row.cohort_n as number) < 20) {
          expect(row.sharpe_pct).toBeNull();
          expect(row.sortino_pct).toBeNull();
          expect(row.max_dd_pct).toBeNull();
        } else {
          // Above the floor the percentiles must be integers in [0, 100].
          for (const k of ["sharpe_pct", "sortino_pct", "max_dd_pct"] as const) {
            expect(typeof row[k]).toBe("number");
            expect(row[k] as number).toBeGreaterThanOrEqual(0);
            expect(row[k] as number).toBeLessThanOrEqual(100);
          }
        }
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // 3. No cross-tenant leak — a normal authed allocator cannot read another
  //    allocator's strategy_verifications rows directly (owner-scope RLS).
  //    This is WHY the aggregate must go through the DEFINER RPC: a hand-rolled
  //    client join would return a silently-tiny (own-only) cohort, never the
  //    cross-tenant verified universe.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "a normal authed client cannot read peers' verification rows directly (forces the RPC path)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const seededStrategyIds: string[] = [];

      try {
        // Quant A owns a verified strategy; quant B is the foreign reader.
        const passwordA = `CohortLeakA${ts}!`;
        const passwordB = `CohortLeakB${ts}!`;
        const emailA = `cohort-leak-a-${ts}@test.sec`;
        const emailB = `cohort-leak-b-${ts}@test.sec`;
        const aId = await createTestUser(admin, emailA, passwordA);
        const bId = await createTestUser(admin, emailB, passwordB);
        cleanup.userIds.push(aId, bId);

        // Seed a published strategy + a verification row owned by A
        // (service-role bypasses RLS for fixture setup).
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: aId,
            name: `__test_cohort_leak_${ts}`,
            status: "published",
            source: "csv",
            strategy_types: [],
            subtypes: [],
            markets: [],
            supported_exchanges: [],
          } as never)
          .select("id")
          .single();
        if (stratErr || !stratData) {
          throw new Error(`seed strategy: ${stratErr?.message}`);
        }
        const strategyId = (stratData as { id: string }).id;
        seededStrategyIds.push(strategyId);

        const { error: verErr } = await admin
          .from("strategy_verifications")
          .insert({
            strategy_id: strategyId,
            wizard_session_id: crypto.randomUUID(),
            status: "validated",
            trust_tier: "csv_uploaded",
            flow_type: "csv",
            source: "csv",
          } as never);
        if (verErr) {
          throw new Error(`seed verification: ${verErr.message}`);
        }

        // Foreign user B asks for A's verification row → 0 rows (owner-scope
        // RLS, NOT a permission error — that's the SELECT-RLS contract).
        const clientB = await createAuthedClient(emailB, passwordB);
        if (!clientB) return;

        const { data: bCrossRead, error: bCrossErr } = await clientB
          .from("strategy_verifications")
          .select("id, strategy_id, trust_tier")
          .eq("strategy_id", strategyId);
        expect(bCrossErr).toBeNull();
        expect(bCrossRead).toEqual([]);
      } finally {
        for (const id of seededStrategyIds) {
          try {
            // FK CASCADE clears the verification row.
            await admin.from("strategies").delete().eq("id", id);
          } catch (err) {
            console.warn(
              `[verified-cohort-rank-rls] cleanup strategies ${id}: ${(err as Error).message}`,
            );
          }
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // 4. Auth gate — an anon (unauthenticated) rpc call is rejected, not served.
  //    The RPC is REVOKEd from anon AND the in-fn auth.role()/auth.uid() guard
  //    raises 42501. Either failure shape is acceptable; what must NOT happen
  //    is the anon caller receiving a cohort row.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "anon rpc call is rejected (REVOKE anon + in-fn 42501 guard)",
    async () => {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!anonKey) {
        console.warn(
          "[verified-cohort-rank-rls] NEXT_PUBLIC_SUPABASE_ANON_KEY absent — skipping anon-reject case.",
        );
        return;
      }

      // A bare anon-key client with no session → auth.role()='anon'.
      const anonClient = createClient(LIVE_DB_URL!, anonKey, {
        auth: { persistSession: false },
      });

      const { data, error } = await anonClient.rpc(RPC, {
        p_sharpe: 1.5,
        p_sortino: 2.0,
        p_max_dd: 0.1,
      });

      // The anon call must be rejected: either a permission/42501 error, or
      // (if PostgREST short-circuits the REVOKE) no served cohort row.
      if (error) {
        const msg = `${error.message} ${error.code ?? ""}`.toLowerCase();
        expect(msg).toMatch(
          /permission denied|not authorized|authenticated session|42501|insufficient/,
        );
      } else {
        // No error path: the anon caller must NOT receive a cohort row.
        expect(data).toBeFalsy();
      }
    },
    30_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("verified-cohort-rank-rls");
    expect(true).toBe(true);
  });
});
