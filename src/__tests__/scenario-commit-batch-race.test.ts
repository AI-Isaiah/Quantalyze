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
  let userClientA: SupabaseClient;
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

      // Fire the two RPC calls "concurrently" — Promise.all is the
      // closest we can get to true concurrency over the wire from a
      // single test process, and it's enough to force overlapping
      // SELECTs in the pre-fix path. (Pre-fix would surface as one
      // result with error=null and one with error.code='23505' on
      // uniq_match_dec_thumbup_per_pair_holding.)
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
        userClientA.rpc(
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

      // No caller may surface a unique-violation on the match_decisions
      // index — that's the specific failure mode 083 fixes. (T2 may
      // still fail on bridge_outcomes_allocator_match_decision_unique
      // because both attempts insert a bridge_outcome against the same
      // match_decision_id; that's a separate, expected-by-design
      // collision and surfaces as ERRCODE 23505 referencing
      // bridge_outcomes_allocator_match_decision_unique — NOT
      // uniq_match_dec_thumbup_per_pair_holding.)
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
});
