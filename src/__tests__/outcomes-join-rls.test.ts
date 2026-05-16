/**
 * Live-DB integration test — Phase 5 outcomes fan-out + nested match_decisions
 * join + cross-allocator isolation (Voice-D11).
 *
 * Seeds 2 allocators, 2 strategies (original + replacement), a
 * match_decisions row per allocator (with the new original_strategy_id
 * column from migration 064), and a bridge_outcomes row per allocator.
 * Then calls getMyAllocationDashboard for each allocator and asserts:
 *   - outcomes[0].match_decision.original_strategy.{id,name} resolves
 *     from the 1-FK nested Supabase embed
 *   - cross-allocator isolation: allocator 1 cannot see allocator 2's row
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

/**
 * Phase B follow-up: `getMyAllocationDashboard` now asserts
 * `auth.uid() === userId` (audit-2026-05-07 H-0502 backstop). A live-DB
 * test that calls the function with an admin-seeded userId must spoof
 * the server client's `auth.getUser()` to return that user — otherwise
 * the backstop throws before any DB query runs. We hoist a mutable
 * `mockAuthUserId` so each call can switch its caller identity.
 */
const authMock = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/supabase/server", async () => {
  // Use the live admin client for actual SELECTs but override auth.getUser
  // to return whichever test user the current call wants to impersonate.
  const helpers = await import("@/lib/test-helpers/live-db");
  return {
    createClient: async () => {
      if (!helpers.HAS_LIVE_DB) {
        return {
          from: () => ({}),
          auth: {
            getUser: async () => ({
              data: { user: null },
              error: null,
            }),
          },
        };
      }
      const base = helpers.createLiveAdminClient();
      // Swap the auth surface for a controllable stub.
      const proxied: typeof base = Object.create(base);
      Object.defineProperty(proxied, "auth", {
        value: {
          getUser: async () => ({
            data: {
              user: authMock.userId ? { id: authMock.userId } : null,
            },
            error: null,
          }),
        },
      });
      return proxied;
    },
  };
});

describe("Phase 5 outcomes fan-out + nested match_decisions join (Voice-D11)", () => {
  const toCleanup = {
    allocatorIds: [] as string[],
    strategyIds: [] as string[],
    decisionIds: [] as string[],
    outcomeIds: [] as string[],
    portfolioIds: [] as string[],
  };

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    const admin = createLiveAdminClient();
    // Reverse FK order
    if (toCleanup.outcomeIds.length) {
      await admin
        .from("bridge_outcomes")
        .delete()
        .in("id", toCleanup.outcomeIds);
    }
    if (toCleanup.decisionIds.length) {
      await admin
        .from("match_decisions")
        .delete()
        .in("id", toCleanup.decisionIds);
    }
    if (toCleanup.portfolioIds.length) {
      await admin
        .from("portfolios")
        .delete()
        .in("id", toCleanup.portfolioIds);
    }
    if (toCleanup.strategyIds.length) {
      await admin
        .from("strategies")
        .delete()
        .in("id", toCleanup.strategyIds);
    }
    if (toCleanup.allocatorIds.length) {
      for (const userId of toCleanup.allocatorIds) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
      }
    }
  });

  it.skipIf(!HAS_LIVE_DB)(
    "seeds 2 allocators + match_decisions + bridge_outcomes; getMyAllocationDashboard resolves nested payload.match_decision.original_strategy.name AND isolates across allocators",
    async () => {
      const admin = createLiveAdminClient();
      const stamp = Date.now();

      // Seed 2 allocators
      const alloc1 = await createTestUser(
        admin,
        `p5-alloc1-${stamp}@test.sec`,
      );
      const alloc2 = await createTestUser(
        admin,
        `p5-alloc2-${stamp}@test.sec`,
      );
      toCleanup.allocatorIds.push(alloc1, alloc2);

      // Seed 2 strategies (orig + replacement)
      const S_ORIG_NAME = `Phase5-Orig-${stamp}`;
      const S_REPL_NAME = `Phase5-Repl-${stamp}`;
      const { data: origStrat, error: origErr } = await admin
        .from("strategies")
        .insert({ name: S_ORIG_NAME, user_id: alloc1 })
        .select("id")
        .single();
      if (origErr || !origStrat) throw origErr ?? new Error("no orig strat");
      const { data: replStrat, error: replErr } = await admin
        .from("strategies")
        .insert({ name: S_REPL_NAME, user_id: alloc1 })
        .select("id")
        .single();
      if (replErr || !replStrat) throw replErr ?? new Error("no repl strat");
      toCleanup.strategyIds.push(
        (origStrat as { id: string }).id,
        (replStrat as { id: string }).id,
      );
      const S_ORIG_ID = (origStrat as { id: string }).id;
      const S_REPL_ID = (replStrat as { id: string }).id;

      // Seed a real (is_test=false) portfolio per allocator — getMyAllocationDashboard
      // early-returns empty when portfolio is null.
      for (const allocId of [alloc1, alloc2]) {
        const { data: portfolio, error: portErr } = await admin
          .from("portfolios")
          .insert({
            user_id: allocId,
            name: "Phase5 test portfolio",
            is_test: false,
          })
          .select("id")
          .single();
        if (portErr || !portfolio) throw portErr ?? new Error("no portfolio");
        toCleanup.portfolioIds.push((portfolio as { id: string }).id);
      }

      // Seed 1 match_decisions row per allocator (sent_as_intro with the new
      // original_strategy_id column).
      for (const allocId of [alloc1, alloc2]) {
        const { data: decision, error: decisionErr } = await admin
          .from("match_decisions")
          .insert({
            allocator_id: allocId,
            strategy_id: S_REPL_ID,
            original_strategy_id: S_ORIG_ID,
            decision: "sent_as_intro",
          })
          .select("id")
          .single();
        if (decisionErr || !decision)
          throw decisionErr ?? new Error("no decision");
        toCleanup.decisionIds.push((decision as { id: string }).id);

        // Seed 1 bridge_outcomes row per allocator with match_decision_id FK
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000)
          .toISOString()
          .slice(0, 10);
        const { data: outcome, error: outcomeErr } = await admin
          .from("bridge_outcomes")
          .insert({
            allocator_id: allocId,
            strategy_id: S_REPL_ID,
            match_decision_id: (decision as { id: string }).id,
            kind: "allocated",
            percent_allocated: 5,
            allocated_at: thirtyDaysAgo,
            delta_30d: 0.05,
          })
          .select("id")
          .single();
        if (outcomeErr || !outcome)
          throw outcomeErr ?? new Error("no outcome");
        toCleanup.outcomeIds.push((outcome as { id: string }).id);
      }

      // Call getMyAllocationDashboard for allocator 1 — sign in as alloc1
      // first so the H-0502 auth backstop passes.
      const { getMyAllocationDashboard } = await import("@/lib/queries");
      authMock.userId = alloc1;
      const result1 = await getMyAllocationDashboard(alloc1);
      expect(result1.outcomes).toBeDefined();
      expect(result1.outcomes.length).toBeGreaterThanOrEqual(1);
      const o1 = result1.outcomes[0];
      expect(o1.match_decision).not.toBeNull();
      expect(o1.match_decision?.original_strategy.id).toBe(S_ORIG_ID);
      expect(o1.match_decision?.original_strategy.name).toBe(S_ORIG_NAME);
      expect(o1.replacement_strategy).not.toBeNull();
      expect(o1.replacement_strategy?.id).toBe(S_REPL_ID);
      expect(o1.replacement_strategy?.name).toBe(S_REPL_NAME);

      // Cross-allocator isolation — switch identity to alloc2 first.
      authMock.userId = alloc2;
      const result2 = await getMyAllocationDashboard(alloc2);
      expect(result2.outcomes.length).toBeGreaterThanOrEqual(1);
      const o2 = result2.outcomes[0];
      expect(o2.id).not.toBe(o1.id); // different outcome id

      // Phase B pr-test-analyzer F3 — cross-tenant exfiltration probe.
      // alloc2 (signed in) tries to call getMyAllocationDashboard(alloc1).
      // The H-0502 backstop must throw BEFORE any data is returned;
      // mocks above use admin client for actual SELECTs but the backstop
      // gates the return value channel.
      authMock.userId = alloc2;
      await expect(getMyAllocationDashboard(alloc1)).rejects.toThrow(
        /userId does not match authenticated user/,
      );
    },
    60_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("outcomes-join-rls");
    expect(true).toBe(true);
  });
});
