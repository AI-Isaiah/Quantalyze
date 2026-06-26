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
 *   5. Cohort-definition correctness (rls-policy-auditor fixes) — by seeding a
 *      >=20-row verified+published cohort with KNOWN metrics, this pins the four
 *      fixes the auditor flagged:
 *        (a) verification-status cohort — a strategy whose ONLY verification row
 *            is status='draft' is EXCLUDED (the old `trust_tier IS NOT NULL`
 *            predicate was a tautology since trust_tier is NOT NULL; the honest
 *            predicate is status='published');
 *        (b) nullable-metric exclusion — a published+verified strategy with NULL
 *            sharpe/sortino/max_drawdown is excluded from BOTH the cohort_n
 *            denominator AND the rank, so the denominator equals the rankable
 *            population (min-N counts only rankable rows);
 *        (c) decile quantization — every returned percentile is a multiple of 10
 *            (probe-resistance: a single percentile step reveals only a decile
 *            bucket, never an individual peer value);
 *        (d) max_dd parity direction — the RPC mirrors getPercentiles
 *            (queries.ts:175-186: count abs<=p_max_dd then 100-that, BEFORE
 *            quantization), so a blend shallower than the whole cohort ranks
 *            high and one deeper than all ranks low.
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

  // -------------------------------------------------------------------------
  // 5. Cohort-definition correctness (rls-policy-auditor fixes). Seed a
  //    deterministic >=20-row verified+published cohort with KNOWN sharpe /
  //    sortino / max_drawdown values, plus two rows that MUST be excluded
  //    (a draft-only verification, and a published+verified row with NULL
  //    metrics). Then assert: the excluded rows do NOT inflate cohort_n; the
  //    returned percentiles are decile-quantized; and the max_dd direction
  //    matches getPercentiles (shallower blend ⇒ higher percentile).
  //
  //    Note: this exercises the REAL TEST project, which may already carry
  //    rows from concurrent suites. The assertions are written to be robust to
  //    a non-empty baseline: we pin RELATIVE invariants (the draft-only and
  //    NULL-metric strategies we seed are absent from the count delta; the
  //    percentiles are multiples of 10; an extreme-good / extreme-bad blend
  //    ranks at the top / bottom decile) rather than an absolute cohort_n.
  // -------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "cohort = status='published' verifications with all metrics non-null; percentiles are decile-quantized; max_dd mirrors getPercentiles",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const seededStrategyIds: string[] = [];

      // Helper: seed one published strategy + its analytics row + verification.
      // `verStatus` controls the verification status (cohort gate); pass
      // metrics=null to seed a NULL-metric (non-rankable) row.
      async function seedStrategy(
        ownerId: string,
        label: string,
        verStatus: string,
        metrics: { sharpe: number; sortino: number; max_drawdown: number } | null,
      ): Promise<string> {
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: ownerId,
            name: `__test_cohort_${label}_${ts}`,
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
          throw new Error(`seed strategy ${label}: ${stratErr?.message}`);
        }
        const sid = (stratData as { id: string }).id;
        seededStrategyIds.push(sid);

        const { error: anErr } = await admin.from("strategy_analytics").insert({
          strategy_id: sid,
          computation_status: "complete",
          sharpe: metrics ? metrics.sharpe : null,
          sortino: metrics ? metrics.sortino : null,
          max_drawdown: metrics ? metrics.max_drawdown : null,
        } as never);
        if (anErr) throw new Error(`seed analytics ${label}: ${anErr.message}`);

        const { error: verErr } = await admin
          .from("strategy_verifications")
          .insert({
            strategy_id: sid,
            wizard_session_id: crypto.randomUUID(),
            status: verStatus,
            trust_tier: "csv_uploaded",
            flow_type: "csv",
            source: "csv",
          } as never);
        if (verErr) throw new Error(`seed verification ${label}: ${verErr.message}`);
        return sid;
      }

      try {
        const password = `CohortDefn${ts}!`;
        const email = `cohort-defn-${ts}@test.sec`;
        const userId = await createTestUser(admin, email, password);
        cleanup.userIds.push(userId);

        // Baseline cohort_n BEFORE seeding (TEST may carry rows from other
        // suites). We measure the DELTA our seed contributes.
        const client = await createAuthedClient(email, password);
        if (!client) return; // password-grant disabled — graceful skip

        const baseline = await client.rpc(RPC, {
          p_sharpe: 0,
          p_sortino: 0,
          p_max_dd: 0,
        });
        expect(baseline.error).toBeNull();
        const baselineN = (baseline.data as { cohort_n: number }[])[0]
          .cohort_n;

        // Seed 20 RANKABLE rows (status='published' verification, non-null
        // metrics) with deterministic, spread-out sharpe/sortino and
        // max_drawdown magnitudes so the cohort is fully published-verified.
        const RANKABLE = 20;
        for (let i = 0; i < RANKABLE; i++) {
          // sharpe 0.1..2.0, sortino 0.2..4.0, |max_dd| 0.01..0.20
          await seedStrategy(userId, `rank${i}`, "published", {
            sharpe: (i + 1) * 0.1,
            sortino: (i + 1) * 0.2,
            max_drawdown: -((i + 1) * 0.01),
          });
        }

        // Seed an EXCLUDED row whose ONLY verification is status='draft'
        // (must NOT count — the old trust_tier-tautology would have counted it).
        await seedStrategy(userId, "draftonly", "draft", {
          sharpe: 99,
          sortino: 99,
          max_drawdown: -0.99,
        });

        // Seed an EXCLUDED row that IS published+verified but has NULL metrics
        // (must NOT inflate cohort_n — nullable-denominator fix).
        await seedStrategy(userId, "nullmetrics", "published", null);

        // Re-read cohort_n. The delta must equal EXACTLY the 20 rankable rows:
        // the draft-only and NULL-metric strategies are excluded from both the
        // denominator and the rank.
        const after = await client.rpc(RPC, {
          p_sharpe: 0,
          p_sortino: 0,
          p_max_dd: 0,
        });
        expect(after.error).toBeNull();
        const afterRow = (after.data as Record<string, unknown>[])[0];
        const afterN = afterRow.cohort_n as number;
        expect(afterN - baselineN).toBe(RANKABLE);

        // With cohort_n >= 20 the percentiles are non-null AND decile-quantized
        // (multiples of 10). Probe an extreme-GOOD blend: sharpe/sortino above
        // every cohort value ⇒ top decile; a shallower |max_dd| than the whole
        // cohort ⇒ also top decile (getPercentiles direction).
        const top = await client.rpc(RPC, {
          p_sharpe: 1000, // above the whole cohort
          p_sortino: 1000,
          p_max_dd: 0.001, // shallower than every cohort drawdown magnitude
        });
        expect(top.error).toBeNull();
        const topRow = (top.data as Record<string, unknown>[])[0];

        for (const k of ["sharpe_pct", "sortino_pct", "max_dd_pct"] as const) {
          const v = topRow[k] as number;
          expect(typeof v).toBe("number");
          // Decile-quantized: a multiple of 10 in [0, 100].
          expect(v % 10).toBe(0);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
        // sharpe/sortino above the whole cohort ⇒ 100th percentile (top decile).
        // (1000 is above any real Sharpe/Sortino, so this is baseline-robust.)
        expect(topRow.sharpe_pct as number).toBe(100);
        expect(topRow.sortino_pct as number).toBe(100);
        // A near-zero |max_dd| (0.001) is shallower than essentially every
        // cohort drawdown ⇒ getPercentiles counts ~0 strategies with abs<=0.001,
        // percentile~0, inverted 100-~0 ⇒ TOP decile. We assert it lands in the
        // top half (>=50) — a direct `>=` count (the OLD buggy direction) would
        // have produced the OPPOSITE (a near-zero percentile) here, so this
        // pins the corrected getPercentiles parity direction. The exact value
        // can dip below 100 only if a baseline strategy has |dd|<=0.001
        // (a near-flat curve), hence the >=50 floor rather than ==100.
        expect(topRow.max_dd_pct as number).toBeGreaterThanOrEqual(50);

        // Probe an extreme-BAD blend: below every sharpe/sortino ⇒ bottom
        // decile; a DEEPER |max_dd| than the whole cohort ⇒ also bottom.
        const bottom = await client.rpc(RPC, {
          p_sharpe: -1000,
          p_sortino: -1000,
          p_max_dd: 1000, // deeper than every cohort drawdown magnitude
        });
        expect(bottom.error).toBeNull();
        const bottomRow = (bottom.data as Record<string, unknown>[])[0];
        for (const k of ["sharpe_pct", "sortino_pct", "max_dd_pct"] as const) {
          expect((bottomRow[k] as number) % 10).toBe(0);
        }
        // sharpe/sortino below the whole cohort ⇒ 0th percentile.
        // (-1000 is below any real Sharpe/Sortino, so this is baseline-robust.)
        expect(bottomRow.sharpe_pct as number).toBe(0);
        expect(bottomRow.sortino_pct as number).toBe(0);
        // A |max_dd| of 1000 is deeper than EVERY real cohort drawdown ⇒
        // getPercentiles counts ALL cohort strategies with abs<=1000,
        // percentile=100, inverted 100-100=0 ⇒ BOTTOM decile. 1000 exceeds any
        // real drawdown magnitude so this IS baseline-robust and exact. (A
        // direct `>=` count — the OLD buggy direction — would have returned
        // ~100 here, the OPPOSITE; this exactly pins the corrected direction.)
        expect(bottomRow.max_dd_pct as number).toBe(0);
      } finally {
        for (const id of seededStrategyIds) {
          try {
            // FK CASCADE clears strategy_analytics + strategy_verifications.
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
    60_000,
  );

  // This test always runs (no skipIf) and advertises the skip reason when
  // HAS_LIVE_DB is false, so the suite doesn't fail silently.
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("verified-cohort-rank-rls");
    expect(true).toBe(true);
  });
});
