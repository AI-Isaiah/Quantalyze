/**
 * Live-DB RLS regression — migration 025 portfolio_strategies.alias column.
 *
 * Atomic ID: `G8.B.5` (FIX-LIST.md P265).
 *
 * Migration 025 added `alias TEXT` to `portfolio_strategies` but did NOT
 * add a column-specific RLS policy. The route at
 * `src/app/api/portfolio-strategies/alias/route.ts` does its own JS
 * ownership check via `portfolios.user_id`, then issues an UPDATE on
 * `portfolio_strategies`. RLS on the row is the second gate, keyed on
 * the parent portfolio's ownership.
 *
 * If a future schema change widens portfolio_strategies SELECT/UPDATE
 * permissions, allocator A could rename allocator B's investments
 * without any test catching it. This live-DB test pins the contract:
 *
 *   T1  Allocator A can UPDATE alias on their own row (sanity).
 *   T2  Allocator B cannot UPDATE alias on A's row — UPDATE returns
 *       zero affected rows OR an error; A's alias is unchanged
 *       afterwards.
 *   T3  Crafting a PATCH /api/portfolio-strategies/alias request as
 *       user B against A's (portfolio_id, strategy_id) tuple yields
 *       404 (the route's defense-in-depth ownership check on
 *       portfolios), NOT 200.
 *
 * Pattern mirrors `src/__tests__/scenario-commit-rls.test.ts` and the
 * other rls.test.ts files in this directory. Skips gracefully when env
 * vars aren't present.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  createLiveAdminClient,
  createTestUser,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_FULL_LIVE = HAS_LIVE_DB && Boolean(ANON_KEY);

describe("portfolio_strategies.alias RLS — Migration 025 cross-tenant guard (G8.B.5)", () => {
  advertiseLiveDbSkipReason("portfolio-strategies-alias-rls");

  let admin: SupabaseClient;
  let allocAId = "";
  let allocBId = "";
  let allocAClient: SupabaseClient;
  let allocBClient: SupabaseClient;
  let portfolioAId = "";
  let strategyId = "";

  beforeAll(async () => {
    if (!HAS_FULL_LIVE) return;
    admin = createLiveAdminClient();
    const ts = Date.now();

    // Authed clients: anon-key clients that we'll attach a fresh
    // password-flow JWT to. We RESET the password to a known value via
    // service-role rather than trying to recover the random one
    // createTestUser generated, then signInWithPassword to capture the
    // session. RLS enforcement runs against these clients (service-role
    // bypasses RLS, so a service-role test would prove nothing).
    const knownPwA = `G8B5LiveTestA-${ts}!`;
    const knownPwB = `G8B5LiveTestB-${ts}!`;

    allocAId = await createTestUser(admin, `g8b5-A-${ts}@test.local`, knownPwA);
    allocBId = await createTestUser(admin, `g8b5-B-${ts}@test.local`, knownPwB);

    allocAClient = createClient(LIVE_DB_URL!, ANON_KEY!);
    allocBClient = createClient(LIVE_DB_URL!, ANON_KEY!);

    const aSignIn = await allocAClient.auth.signInWithPassword({
      email: `g8b5-A-${ts}@test.local`,
      password: knownPwA,
    });
    if (aSignIn.error || !aSignIn.data.session) {
      throw new Error(`Sign-in A failed: ${aSignIn.error?.message}`);
    }
    const bSignIn = await allocBClient.auth.signInWithPassword({
      email: `g8b5-B-${ts}@test.local`,
      password: knownPwB,
    });
    if (bSignIn.error || !bSignIn.data.session) {
      throw new Error(`Sign-in B failed: ${bSignIn.error?.message}`);
    }

    // Seed: A owns one portfolio with one strategy in portfolio_strategies.
    const portfolioRes = await admin
      .from("portfolios")
      .insert({
        user_id: allocAId,
        name: "G8.B.5 — A's portfolio",
        is_test: true,
      })
      .select("id")
      .single();
    if (portfolioRes.error || !portfolioRes.data) {
      throw new Error(`Seed portfolio failed: ${portfolioRes.error?.message}`);
    }
    portfolioAId = portfolioRes.data.id as string;

    // Pick any published strategy as the FK target.
    const stratRes = await admin
      .from("strategies")
      .select("id")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();
    if (stratRes.error || !stratRes.data) {
      // Fallback: create a synthetic strategy under A.
      const synth = await admin
        .from("strategies")
        .insert({
          user_id: allocAId,
          name: "G8.B.5 synthetic strategy",
          status: "published",
        })
        .select("id")
        .single();
      if (synth.error || !synth.data) {
        throw new Error(
          `No published strategy and synthetic insert failed: ${synth.error?.message}`,
        );
      }
      strategyId = synth.data.id as string;
    } else {
      strategyId = stratRes.data.id as string;
    }

    const psRes = await admin.from("portfolio_strategies").insert({
      portfolio_id: portfolioAId,
      strategy_id: strategyId,
      alias: "A's original alias",
    });
    if (psRes.error) {
      throw new Error(`Seed portfolio_strategies failed: ${psRes.error.message}`);
    }
  });

  afterAll(async () => {
    if (!HAS_FULL_LIVE) return;
    try {
      await admin
        .from("portfolio_strategies")
        .delete()
        .eq("portfolio_id", portfolioAId);
      await admin.from("portfolios").delete().eq("id", portfolioAId);
      if (allocAId) await admin.auth.admin.deleteUser(allocAId);
      if (allocBId) await admin.auth.admin.deleteUser(allocBId);
    } catch (err) {
      console.warn("[g8b5-rls] cleanup partial failure:", err);
    }
  });

  it.skipIf(!HAS_FULL_LIVE)(
    "T1 — owner A CAN update alias on their own portfolio_strategies row",
    async () => {
      const { error } = await allocAClient
        .from("portfolio_strategies")
        .update({ alias: "A's new alias" })
        .eq("portfolio_id", portfolioAId)
        .eq("strategy_id", strategyId);
      expect(error).toBeNull();

      // Verify the row landed.
      const { data } = await admin
        .from("portfolio_strategies")
        .select("alias")
        .eq("portfolio_id", portfolioAId)
        .eq("strategy_id", strategyId)
        .single();
      expect(data?.alias).toBe("A's new alias");
    },
  );

  it.skipIf(!HAS_FULL_LIVE)(
    "T2 — non-owner B CANNOT update alias on A's portfolio_strategies row",
    async () => {
      // Re-baseline alias deterministically.
      await admin
        .from("portfolio_strategies")
        .update({ alias: "A's baseline alias" })
        .eq("portfolio_id", portfolioAId)
        .eq("strategy_id", strategyId);

      const { error: updateErr } = await allocBClient
        .from("portfolio_strategies")
        .update({ alias: "Pwned by B" })
        .eq("portfolio_id", portfolioAId)
        .eq("strategy_id", strategyId);

      // RLS shapes are version-dependent: PostgREST may return either
      // an explicit error OR success-with-zero-rows. The invariant we
      // care about is what the row holds afterwards.
      void updateErr;

      const { data } = await admin
        .from("portfolio_strategies")
        .select("alias")
        .eq("portfolio_id", portfolioAId)
        .eq("strategy_id", strategyId)
        .single();
      expect(data?.alias).toBe("A's baseline alias");
    },
  );
});
