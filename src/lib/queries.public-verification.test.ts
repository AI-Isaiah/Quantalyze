/**
 * Phase 126 (FACTSHEET-01) — security + correctness contract for
 * `readPublicVerificationSignals`, the reader that makes the api_verified badge
 * visible to the PUBLIC on published factsheets/lists.
 *
 * Phase 126-04 (hardening): the projection is now a correct-by-construction DB
 * primitive — the `get_published_trust_signals(uuid[])` SECURITY DEFINER
 * function (migration 135). The helper calls it via a NORMAL server client (no
 * `createAdminClient`). The column allow-list (trust_tier+status) and the
 * published-gate live in the function's RETURNS TABLE signature and WHERE
 * clause; the migration's self-verify DO block behaviorally proves the
 * published-gate (a published strategy's signal is returned, a non-published
 * one's is NOT). These vitest guards pin the APP-LAYER contract:
 *
 *   1. SECURITY (no-leak): the helper maps ONLY `trust_tier` + `status` even
 *      when the RPC row carries internals (defence against a widened RETURNS
 *      TABLE ever leaking through). It reads via the RPC — NOT a raw
 *      `strategy_verifications` table SELECT (reverting to a table `select("*")`
 *      fails these guards).
 *
 *   2. SCOPE: the read routes through `get_published_trust_signals` (the
 *      published-gated primitive) and keeps the LATEST row per strategy.
 *      Fail-soft on error (empty map → null tier → badge hides → page still
 *      renders; no throw, no invented data).
 *
 * The non-owner *visibility* regression (anon/admin now SEE the badge) is pinned
 * end-to-end in e2e/sfox-badge.spec.ts — the real SSR/RLS regression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const rec = {
  selectCols: [] as string[],
  rpcCalls: [] as [string, Record<string, unknown>][],
  response: { data: null, error: null } as QueryResult,
  sentry: [] as { err: unknown; opts: unknown }[],
  // For the getStrategyDetail integration test: the RLS strategies read.
  strategyRow: null as unknown,
  strategyError: null as unknown,
};

// A chain mirroring the RLS strategies read used by getStrategyDetail — resolves
// via .single(). It embeds NO strategy_verifications (the non-owner reality: the
// old owner-only embed returned zero verification rows). Any raw table SELECT on
// strategy_verifications would land here and push to rec.selectCols, tripping
// the "reads via the RPC, not a table select" guard.
function buildStrategiesChain() {
  const chain: Record<string, unknown> = {};
  chain.select = (cols?: string) => {
    if (typeof cols === "string") rec.selectCols.push(cols);
    return chain;
  };
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = () =>
    Promise.resolve({ data: rec.strategyRow, error: rec.strategyError });
  chain.maybeSingle = () =>
    Promise.resolve({ data: rec.strategyRow, error: rec.strategyError });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    // The trust-signal read now goes through the DB primitive, NOT a table read.
    rpc: (name: string, params: Record<string, unknown>) => {
      rec.rpcCalls.push([name, params]);
      return Promise.resolve(rec.response);
    },
    from: (table: string) => {
      if (table === "strategies") return buildStrategiesChain();
      // Any OTHER table read (e.g. a regression to a raw strategy_verifications
      // SELECT) is recorded so the "reads via the RPC" guard can catch it.
      return buildStrategiesChain();
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  // readPublicVerificationSignals no longer uses the admin client, but queries.ts
  // imports createAdminClient at module load for OTHER functions — mock it so the
  // import resolves under vitest.
  createAdminClient: () => ({ from: () => buildStrategiesChain() }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    rec.sentry.push({ err, opts });
  },
}));

import { readPublicVerificationSignals, getStrategyDetail } from "./queries";

// An RPC row AS RETURNED BY get_published_trust_signals. The function's RETURNS
// TABLE is (strategy_id, trust_tier, status); here we deliberately load the row
// with EXTRA internals to prove the app-layer mapping drops anything beyond the
// two public fields even if a widened RETURNS TABLE ever leaked them through.
const rpcRow = (over: Record<string, unknown> = {}) => ({
  strategy_id: "s1",
  trust_tier: "api_verified",
  status: "validated",
  // internals that must be dropped by the app-layer mapping if ever present:
  wizard_session_id: "leak-wizard-uuid",
  flow_type: "onboard",
  source: "sfox",
  ...over,
});

beforeEach(() => {
  rec.selectCols = [];
  rec.rpcCalls = [];
  rec.response = { data: null, error: null };
  rec.sentry = [];
  rec.strategyRow = null;
  rec.strategyError = null;
});

describe("readPublicVerificationSignals — public projection contract", () => {
  it("exposes ONLY trust_tier + status (drops any extra columns the RPC returns)", async () => {
    rec.response = { data: [rpcRow()], error: null };

    const map = await readPublicVerificationSignals(["s1"]);
    const signal = map.get("s1");

    expect(signal).toEqual({ trust_tier: "api_verified", status: "validated" });
    // Exactly two keys — no wizard_session_id / flow_type / source passthrough.
    expect(Object.keys(signal ?? {}).sort()).toEqual(["status", "trust_tier"]);
    expect(signal).not.toHaveProperty("wizard_session_id");
    expect(signal).not.toHaveProperty("flow_type");
    expect(signal).not.toHaveProperty("source");
  });

  it("reads via the get_published_trust_signals RPC, NOT a raw strategy_verifications table SELECT", async () => {
    rec.response = { data: [rpcRow()], error: null };
    await readPublicVerificationSignals(["s1"]);

    // The trust signal comes from the published-gated DB primitive.
    expect(rec.rpcCalls).toHaveLength(1);
    const [name, params] = rec.rpcCalls[0];
    expect(name).toBe("get_published_trust_signals");
    expect(params).toEqual({ p_strategy_ids: ["s1"] });
    // A regression to a raw `.from("strategy_verifications").select(...)` (or a
    // `select("*")`) would land on a table chain and push to selectCols — proving
    // the read never re-widens back to a direct table projection.
    expect(rec.selectCols).toHaveLength(0);
  });

  it("gates the read to PUBLISHED strategies via the primitive (the published-gate lives in the DB fn)", async () => {
    rec.response = { data: [rpcRow()], error: null };
    await readPublicVerificationSignals(["s1"]);

    // The published-gate is `WHERE strategies.status='published'` INSIDE
    // get_published_trust_signals (migration 135, behaviorally proven in its
    // self-verify DO block). At the app layer we pin that the read routes through
    // THAT function (not an un-gated table read) with the requested ids.
    expect(rec.rpcCalls[0]?.[0]).toBe("get_published_trust_signals");
    expect(rec.rpcCalls[0]?.[1]).toEqual({ p_strategy_ids: ["s1"] });
  });

  it("keeps the LATEST row per strategy (defensive keep-first on the RPC result)", async () => {
    // The DB function returns DISTINCT ON (strategy_id) newest-first; the helper
    // keeps the first row per id as belt-and-suspenders.
    rec.response = {
      data: [
        rpcRow({ trust_tier: "api_verified" }),
        rpcRow({ trust_tier: "self_reported" }),
      ],
      error: null,
    };
    const map = await readPublicVerificationSignals(["s1"]);
    expect(map.get("s1")?.trust_tier).toBe("api_verified");
  });

  it("fail-soft: an RPC error yields an EMPTY map (badge hides, page still renders) + logs", async () => {
    rec.response = { data: null, error: { message: "boom" } };
    const map = await readPublicVerificationSignals(["s1"]);
    expect(map.size).toBe(0);
    expect(rec.sentry).toHaveLength(1);
  });

  it("short-circuits on empty input without calling the RPC", async () => {
    const map = await readPublicVerificationSignals([]);
    expect(map.size).toBe(0);
    expect(rec.rpcCalls).toHaveLength(0);
  });
});

describe("getStrategyDetail — class closure: non-owner sees the api_verified tier", () => {
  it("projects trust_tier from the service-role helper even when the RLS strategies read carries NO verification embed (the non-owner reality)", async () => {
    // A published strategy owned by SOMEONE ELSE — the RLS strategies read still
    // returns the published row, but (pre-126) the owner-only verification embed
    // returned zero rows for this non-owner viewer. The service-role helper does.
    rec.strategyRow = {
      id: "s1",
      user_id: "some-other-owner",
      status: "published",
      name: "Someone else's strategy",
      strategy_analytics: null,
      disclosure_tier: "exploratory", // keeps loadManagerIdentity from touching profiles
    };
    rec.response = {
      data: [
        {
          strategy_id: "s1",
          trust_tier: "api_verified",
          status: "validated",
          created_at: "2026-07-19T00:00:00Z",
        },
      ],
      error: null,
    };

    const result = await getStrategyDetail("s1");

    expect(result).not.toBeNull();
    // The badge signal a non-owner sees — RED on pre-126 code (embed empty -> null).
    expect(result!.strategy.trust_tier).toBe("api_verified");
    // The trust_tier read went through the published-gated DB primitive, keyed on
    // the strategy id — NOT the owner-only RLS embed.
    expect(rec.rpcCalls).toContainEqual([
      "get_published_trust_signals",
      { p_strategy_ids: ["s1"] },
    ]);
  });

  it("fail-soft: a verification read error leaves trust_tier null without failing the page", async () => {
    rec.strategyRow = {
      id: "s2",
      user_id: "some-other-owner",
      status: "published",
      name: "X",
      strategy_analytics: null,
      disclosure_tier: "exploratory",
    };
    rec.response = { data: null, error: { message: "boom" } };

    const result = await getStrategyDetail("s2");

    expect(result).not.toBeNull();
    expect(result!.strategy.trust_tier).toBeNull();
    expect(rec.sentry.length).toBeGreaterThanOrEqual(1);
  });
});
