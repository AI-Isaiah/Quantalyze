/**
 * Live-DB integration test — Migration 083 race-safe M7 reuse-or-create
 * (Phase 10 review-pass / Group A / P1).
 *
 * Pins the M7 race fix shipped in migration 083: two concurrent
 * `commit_scenario_batch` RPC calls with the same `bridge_recommended`
 * tuple — `(allocator_id, original_holding_ref, strategy_id)` — must
 * collapse to EXACTLY ONE `match_decisions` row, not two, and neither
 * caller may receive a unique-violation error.
 *
 * Pre-fix behavior (migration 082, race window):
 *   T1: SELECT id FROM match_decisions WHERE … → no row
 *   T2: SELECT id FROM match_decisions WHERE … → no row
 *   T1: INSERT INTO match_decisions … → success, id=A
 *   T2: INSERT INTO match_decisions … → SQLSTATE 23505 (unique violation
 *        on uniq_match_dec_thumbup_per_pair_holding)
 *   Result: 1 match_decision row + 1 RAISE EXCEPTION → caller-side
 *   error envelope; the loser of the race cannot complete its commit.
 *
 * Post-fix behavior (migration 083 ON CONFLICT … DO UPDATE):
 *   T1: INSERT … ON CONFLICT … RETURNING id → success, id=A (winner)
 *   T2: INSERT … ON CONFLICT … blocks on row lock; once T1 commits,
 *       T2's ON CONFLICT path triggers DO UPDATE → RETURNING id=A
 *       (loser reads the winner's id; no exception)
 *   Result: 1 match_decision row + 0 RAISE EXCEPTIONS. Both callers
 *   succeed. T2's bridge_outcome write is on (allocator_id, A) which
 *   collides with T1's bridge_outcome via
 *   bridge_outcomes_allocator_match_decision_unique → T2 sees the second
 *   bridge_outcome insert raise (expected — bridge_outcomes is keyed
 *   per-decision, two outcomes for the same decision is a real
 *   constraint, not a race we want to mask).
 *
 * Test acceptance: at least ONE caller succeeds AND the post-state has
 * exactly ONE match_decisions row for the tuple. The pre-fix path would
 * have created ONE match_decision then RAISED on the second INSERT,
 * which fails the `at least one caller succeeded` half. The post-fix
 * may have either both succeed (if T2's bridge_outcome insert wins the
 * lock first because T1 was rolled back for unrelated reasons — not
 * applicable here) or one succeed + one fail-on-bridge-outcome-collision;
 * the test asserts the match_decisions row count to gate the actual
 * race fix.
 *
 * Pattern: lifted from src/__tests__/scenario-commit-batch-tx.test.ts:
 * admin client for fixture setup + service role; userClientA for the
 * RPC call (auth.uid() must equal p_allocator_id).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *       + NEXT_PUBLIC_SUPABASE_ANON_KEY (for user-scoped client).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  advertiseLiveDbSkipReason,
  LIVE_DB_URL,
} from "@/lib/test-helpers/live-db";
import type { SupabaseClient } from "@supabase/supabase-js";

const STRATEGY_RACE = "00000000-0000-0000-0000-000000001097";

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_ANON_KEY = Boolean(ANON_KEY);

describe("migration 083 — commit_scenario_batch race-safe M7 (live-DB)", () => {
  advertiseLiveDbSkipReason("scenario-commit-batch-race");

  let admin: SupabaseClient;
  // H-0033 / H-0036: two INDEPENDENT user-scoped sessions for the SAME
  // allocator. `Promise.all` from a single supabase-js client serializes
  // RPC calls over one pooled connection, so the pre-fix SELECT-then-INSERT
  // window never actually opens — the test would pass with AND without the
  // 083 fix. Driving the two RPCs from two clients with SEPARATE access
  // tokens (separate sessions → separate PostgREST connections) is the
  // closest we can get to true overlapping transactions from a test
  // process, so the race window can actually fire.
  let userClientA: SupabaseClient;
  let userClientA2: SupabaseClient;
  let allocatorAId: string;
  let allocatorAEmail: string;
  let allocatorAPassword: string;
  const apiKeyAId = "00000000-0000-0000-0000-000000001098";

  beforeAll(async () => {
    if (!HAS_LIVE_DB || !HAS_ANON_KEY) return;
    admin = createLiveAdminClient();
    const ts = Date.now();

    allocatorAEmail = `phase10-race-A-${ts}@test.local`;
    allocatorAPassword = `LiveDbTest${ts}!`;
    const aResult = await admin.auth.admin.createUser({
      email: allocatorAEmail,
      password: allocatorAPassword,
      email_confirm: true,
    });
    if (aResult.error || !aResult.data.user) {
      throw new Error(
        `Failed to create allocator A: ${aResult.error?.message}`,
      );
    }
    allocatorAId = aResult.data.user.id;
    await admin
      .from("profiles")
      .upsert(
        { id: allocatorAId, display_name: allocatorAEmail },
        { onConflict: "id" },
      );

    // Sign in for the user-scoped RPC client (auth.uid() must equal
    // p_allocator_id inside the RPC body).
    userClientA = createClient(LIVE_DB_URL!, ANON_KEY!);
    const signInA = await userClientA.auth.signInWithPassword({
      email: allocatorAEmail,
      password: allocatorAPassword,
    });
    if (signInA.error) {
      throw new Error(
        `Failed to sign in allocator A: ${signInA.error.message}`,
      );
    }

    // Second INDEPENDENT session for the SAME allocator A. A distinct
    // createClient + signInWithPassword yields a separate access token and
    // its own connection, so the two RPC calls below can genuinely overlap
    // (separate transactions) instead of serializing over one pooled
    // socket. Both tokens carry the same auth.uid(), so both satisfy the
    // RPC's p_allocator_id == auth.uid() ownership check.
    userClientA2 = createClient(LIVE_DB_URL!, ANON_KEY!, {
      auth: { storageKey: "race-session-2", persistSession: false },
    });
    const signInA2 = await userClientA2.auth.signInWithPassword({
      email: allocatorAEmail,
      password: allocatorAPassword,
    });
    if (signInA2.error) {
      throw new Error(
        `Failed to sign in allocator A (session 2): ${signInA2.error.message}`,
      );
    }

    // Seed strategy + analytics + api_key + holding for the test tuple.
    const seedStrat = await admin.from("strategies").upsert(
      [
        {
          id: STRATEGY_RACE,
          user_id: allocatorAId,
          name: "Phase10 race-fix anchor (synthetic)",
          status: "published",
        },
      ],
      { onConflict: "id" },
    );
    if (seedStrat.error) {
      throw new Error(`Failed to seed strategy: ${seedStrat.error.message}`);
    }
    await admin
      .from("strategy_analytics")
      .upsert(
        [{ strategy_id: STRATEGY_RACE, returns_series: [] }],
        { onConflict: "strategy_id" },
      );

    await admin.from("api_keys").upsert(
      [
        {
          id: apiKeyAId,
          user_id: allocatorAId,
          exchange: "binance",
          label: "Phase10 race-fix test (synthetic)",
          api_key_encrypted: "test-only:not-a-real-secret",
          is_active: true,
          kek_version: 1,
        },
      ],
      { onConflict: "id" },
    );

    const today = new Date().toISOString().slice(0, 10);
    const seedHoldings = await admin.from("allocator_holdings").upsert(
      [
        {
          allocator_id: allocatorAId,
          api_key_id: apiKeyAId,
          asof: today,
          venue: "binance",
          symbol: "BTC",
          holding_type: "spot",
          side: "long",
          quantity: 1,
          value_usd: 100,
          mark_price: 100,
        },
      ],
      { onConflict: "allocator_id,venue,symbol,asof" },
    );
    if (seedHoldings.error) {
      throw new Error(
        `Failed to seed allocator_holdings: ${seedHoldings.error.message}`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!HAS_LIVE_DB || !HAS_ANON_KEY) return;
    await admin
      .from("bridge_outcomes")
      .delete()
      .eq("allocator_id", allocatorAId);
    await admin
      .from("match_decisions")
      .delete()
      .eq("allocator_id", allocatorAId);
    await admin
      .from("allocator_holdings")
      .delete()
      .eq("allocator_id", allocatorAId);
    await admin.from("api_keys").delete().eq("id", apiKeyAId);
    await admin
      .from("strategy_analytics")
      .delete()
      .eq("strategy_id", STRATEGY_RACE);
    await admin.from("strategies").delete().eq("id", STRATEGY_RACE);
    await admin.auth.admin.deleteUser(allocatorAId);
  }, 60_000);

  it.skipIf(!HAS_LIVE_DB || !HAS_ANON_KEY)(
    "T_RPC_RACE_SAFE_M7: two concurrent bridge_recommended commits collapse to ONE match_decisions row (no unique-violation)",
    async () => {
      // Sanity: nothing is in the table for this tuple yet.
      const before = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_RACE)
        .eq("kind", "bridge_recommended");
      expect(before.count).toBe(0);

      const diff = {
        kind: "bridge_recommended",
        holding_ref: "holding:binance:BTC:spot",
        strategy_id: STRATEGY_RACE,
        percent_allocated: 4,
      };

      // Fire the two RPC calls concurrently from TWO INDEPENDENT sessions
      // (separate access tokens → separate connections). This is the fix
      // for H-0033/H-0036: a single-client Promise.all serializes over one
      // pooled socket, so the pre-fix SELECT-then-INSERT window never opens
      // and the test would pass with AND without the 083 fix. Two sessions
      // give the two transactions a genuine chance to interleave their
      // SELECTs before either INSERTs — which is precisely the window the
      // pre-fix code mishandles (loser → 23505 on
      // uniq_match_dec_thumbup_per_pair_holding) and the 083 ON CONFLICT
      // path closes.
      const [r1, r2] = await Promise.all([
        userClientA.rpc(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "commit_scenario_batch" as any,
          {
            p_allocator_id: allocatorAId,
            p_diffs: [diff],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ),
        userClientA2.rpc(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "commit_scenario_batch" as any,
          {
            p_allocator_id: allocatorAId,
            p_diffs: [diff],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ),
      ]);

      // At least ONE caller must succeed (post-fix invariant). The
      // pre-fix path would have raised SQLSTATE 23505 on
      // uniq_match_dec_thumbup_per_pair_holding for the loser.
      const successes = [r1, r2].filter((r) => r.error === null);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // H-0034: THIS is the differentiating assertion (not `successes >= 1`,
      // which the pre-fix path also satisfies when it serializes). NO caller
      // may surface a unique-violation on the match_decisions index — that's
      // the EXACT failure mode 083 fixes, and the EXACT signature the pre-fix
      // SELECT-then-INSERT path raises on the race loser when the window
      // actually opens (now that two sessions force the overlap). If 083
      // regressed, the loser's r.error.message would reference
      // uniq_match_dec_thumbup_per_pair_holding and this check fails.
      //
      // (T2 may still fail on bridge_outcomes_allocator_match_decision_unique
      // because both attempts insert a bridge_outcome against the same
      // match_decision_id; that's a separate, expected-by-design collision
      // — ERRCODE 23505 referencing the bridge_outcomes index, NOT the
      // match_decisions index. We assert specifically on the match_decisions
      // index name so that expected collision does not mask a real failure.)
      for (const r of [r1, r2]) {
        if (r.error !== null) {
          expect(r.error.message).not.toMatch(
            /uniq_match_dec_thumbup_per_pair_holding/i,
          );
        }
      }

      // The flagship invariant: exactly ONE match_decisions row exists
      // for the tuple. Two would mean the race went unprotected; zero
      // would mean both rolled back (impossible here — Postgres index
      // inference would not silently drop both).
      const after = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_RACE)
        .eq("kind", "bridge_recommended");
      expect(after.count).toBe(1);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_ANON_KEY)(
    "T_RPC_REUSE_M7_DETERMINISTIC: a bridge_recommended commit against a pre-existing thumbs_up row REUSES that row's id (no 23505), proving ON CONFLICT DO UPDATE without depending on race timing",
    async () => {
      // H-0036: the concurrent test above can only *probabilistically* open
      // the SELECT-then-INSERT window — two Promise.all'd RPCs are concurrent
      // but not barrier-synchronised, so if one transaction fully commits
      // before the other's SELECT runs, BOTH the pre-fix (SELECT-then-skip-
      // INSERT → count=1) and post-fix paths pass and the `count===1`
      // assertion cannot tell them apart. This test removes the timing
      // dependency entirely: we PRE-CREATE the winning match_decisions row
      // ourselves (the deterministic equivalent of "T1 already committed"),
      // then fire the RPC ONCE for the same
      // (allocator_id, strategy_id, COALESCE(original_holding_ref,''))
      // thumbs_up tuple and prove the RPC's INSERT collapses onto the
      // existing row via ON CONFLICT ... DO UPDATE ... RETURNING.
      //
      // Why this is a true regression gate (not a tautology / not satisfied
      // by the pre-fix code):
      //   - pre-fix migration 082 (plain conditional INSERT): a stale SELECT
      //     plus a blind INSERT against the already-present row raises
      //     SQLSTATE 23505 on uniq_match_dec_thumbup_per_pair_holding → the
      //     RPC returns r.error; `r.error === null` fails AND the error
      //     message matches the index name → both new assertions fail.
      //   - a regression to `ON CONFLICT ... DO NOTHING`: the suppressed
      //     conflict returns NO row, so `RETURNING id INTO v_md_id` leaves
      //     v_md_id NULL; the subsequent bridge_outcomes INSERT violates the
      //     match_decision_id NOT NULL / FK → the RPC errors → fails here.
      //   - only the shipped `ON CONFLICT ... DO UPDATE ... RETURNING id`
      //     path returns the EXISTING row's id, so the RPC succeeds, the
      //     returned match_decision_id equals the pre-created id, and the row
      //     count stays at exactly 1.
      const PREEXISTING_REF = "holding:binance:BTC:spot";

      // Belt-and-braces: clear any rows left by the concurrent test above so
      // this deterministic case starts from a known single pre-created row.
      await admin
        .from("bridge_outcomes")
        .delete()
        .eq("allocator_id", allocatorAId);
      await admin
        .from("match_decisions")
        .delete()
        .eq("allocator_id", allocatorAId);

      const seedWinner = await admin
        .from("match_decisions")
        .insert({
          allocator_id: allocatorAId,
          strategy_id: STRATEGY_RACE,
          decision: "thumbs_up",
          decided_by: allocatorAId,
          original_strategy_id: null,
          original_holding_ref: PREEXISTING_REF,
          kind: "bridge_recommended",
        })
        .select("id")
        .single();
      expect(seedWinner.error).toBeNull();
      const winnerId = seedWinner.data?.id as string;
      expect(winnerId).toBeTruthy();

      const diff = {
        kind: "bridge_recommended",
        holding_ref: PREEXISTING_REF,
        strategy_id: STRATEGY_RACE,
        percent_allocated: 7,
      };

      const result = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [diff],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );

      // The pre-fix blind-INSERT path would raise 23505 on the partial
      // unique index here — assert specifically on that index name so the
      // failure is unambiguously the M7-race regression and not some other
      // constraint.
      if (result.error !== null) {
        expect(result.error.message).not.toMatch(
          /uniq_match_dec_thumbup_per_pair_holding/i,
        );
      }
      expect(result.error).toBeNull();

      // The RPC must have REUSED the pre-created row, not inserted a second
      // one: the returned match_decision_id equals winnerId and the row
      // count is still exactly 1. A DO-NOTHING regression would surface a
      // null match_decision_id (RETURNING yields no row) and a downstream
      // bridge_outcomes failure instead of this id.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recorded = (result.data as any)?.recorded;
      expect(Array.isArray(recorded)).toBe(true);
      expect(recorded?.[0]?.match_decision_id).toBe(winnerId);

      const after = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_RACE)
        .eq("kind", "bridge_recommended");
      expect(after.count).toBe(1);
    },
    30_000,
  );
});
