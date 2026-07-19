/**
 * Phase 126 (FACTSHEET-01) — security + correctness contract for
 * `readPublicVerificationSignals`, the service-role projection that makes the
 * api_verified badge visible to the PUBLIC on published factsheets/lists.
 *
 * Two guarantees this pins:
 *
 *   1. SECURITY (no-leak): the public shape exposes ONLY `trust_tier` + `status`.
 *      strategy_verifications carries internals (wizard_session_id, flow_type,
 *      source, …) that must NEVER reach a public client. The test feeds a DB row
 *      that INCLUDES those internals and asserts they are dropped, AND asserts
 *      the SELECT column list never requests them.
 *
 *   2. SCOPE: the read is gated to PUBLISHED strategies (defence-in-depth) and
 *      returns the LATEST verification per strategy. Fail-soft on error (empty
 *      map → null tier → badge hides → page still renders; no throw, no invented
 *      data).
 *
 * These are the RED-provable guards for the founder-decision "Option B"
 * (service-role projection, NOT an RLS widening). The non-owner *visibility*
 * regression (anon/admin now SEE the badge) is pinned end-to-end in
 * e2e/sfox-badge.spec.ts — the real SSR/RLS regression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const rec = {
  selectCols: [] as string[],
  inCalls: [] as [string, readonly unknown[]][],
  eqCalls: [] as [string, unknown][],
  orderCalls: [] as [string, unknown][],
  response: { data: null, error: null } as QueryResult,
  sentry: [] as { err: unknown; opts: unknown }[],
  // For the getStrategyDetail integration test: the RLS strategies read.
  strategyRow: null as unknown,
  strategyError: null as unknown,
};

// A thenable chain mirroring the PostgREST builder shape the helper awaits:
//   admin.from("strategy_verifications").select(sel).in(col, ids).eq(col, val).order(col, opts)
function buildVerificationChain() {
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    rec.selectCols.push(cols);
    return chain;
  };
  chain.in = (col: string, ids: readonly unknown[]) => {
    rec.inCalls.push([col, ids]);
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    rec.eqCalls.push([col, val]);
    return chain;
  };
  chain.order = (col: string, opts: unknown) => {
    rec.orderCalls.push([col, opts]);
    return chain;
  };
  chain.then = (
    onFulfilled: (v: QueryResult) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(rec.response).then(onFulfilled, onRejected);
  return chain;
}

// The RLS-scoped strategies read used by getStrategyDetail — resolves via
// .single(). NOTE: it embeds NO strategy_verifications, exactly modelling the
// non-owner reality (the old owner-only embed returned zero verification rows).
function buildStrategiesChain() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
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
    from: (table: string) =>
      table === "strategies" ? buildStrategiesChain() : buildVerificationChain(),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  // getStrategyDetail's trust_tier + readPublicVerificationSignals both read
  // strategy_verifications via the admin client -> the verification chain.
  createAdminClient: () => ({ from: () => buildVerificationChain() }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    rec.sentry.push({ err, opts });
  },
}));

import { readPublicVerificationSignals, getStrategyDetail } from "./queries";

// A verification row AS RETURNED BY THE DB — deliberately loaded with internals
// that must NOT survive the projection.
const dbRow = (over: Record<string, unknown> = {}) => ({
  strategy_id: "s1",
  trust_tier: "api_verified",
  status: "validated",
  created_at: "2026-07-19T00:00:00Z",
  // internals that must be dropped + never selected:
  wizard_session_id: "leak-wizard-uuid",
  flow_type: "onboard",
  source: "sfox",
  strategies: { status: "published" },
  ...over,
});

beforeEach(() => {
  rec.selectCols = [];
  rec.inCalls = [];
  rec.eqCalls = [];
  rec.orderCalls = [];
  rec.response = { data: null, error: null };
  rec.sentry = [];
  rec.strategyRow = null;
  rec.strategyError = null;
});

describe("readPublicVerificationSignals — public projection contract", () => {
  it("exposes ONLY trust_tier + status (drops verification internals)", async () => {
    rec.response = { data: [dbRow()], error: null };

    const map = await readPublicVerificationSignals(["s1"]);
    const signal = map.get("s1");

    expect(signal).toEqual({ trust_tier: "api_verified", status: "validated" });
    // Exactly two keys — no wizard_session_id / flow_type / source passthrough.
    expect(Object.keys(signal ?? {}).sort()).toEqual(["status", "trust_tier"]);
    expect(signal).not.toHaveProperty("wizard_session_id");
    expect(signal).not.toHaveProperty("flow_type");
    expect(signal).not.toHaveProperty("source");
  });

  it("never SELECTs verification internals from the DB", async () => {
    rec.response = { data: [dbRow()], error: null };
    await readPublicVerificationSignals(["s1"]);

    expect(rec.selectCols).toHaveLength(1);
    const sel = rec.selectCols[0];
    for (const forbidden of ["wizard_session_id", "flow_type", "source", "api_key", "encrypted", "*"]) {
      expect(sel).not.toContain(forbidden);
    }
    // The two public fields ARE requested.
    expect(sel).toContain("trust_tier");
    expect(sel).toContain("status");
  });

  it("gates the read to PUBLISHED strategies (defence-in-depth)", async () => {
    rec.response = { data: [dbRow()], error: null };
    await readPublicVerificationSignals(["s1"]);

    expect(rec.eqCalls).toContainEqual(["strategies.status", "published"]);
    expect(rec.inCalls[0]?.[0]).toBe("strategy_id");
  });

  it("keeps the LATEST verification per strategy (newest created_at first)", async () => {
    rec.response = {
      data: [
        dbRow({ trust_tier: "api_verified", created_at: "2026-07-19T00:00:00Z" }),
        dbRow({ trust_tier: "self_reported", created_at: "2026-01-01T00:00:00Z" }),
      ],
      error: null,
    };
    const map = await readPublicVerificationSignals(["s1"]);
    // rows arrive newest-first (the helper orders desc); first wins.
    expect(map.get("s1")?.trust_tier).toBe("api_verified");
  });

  it("fail-soft: a DB error yields an EMPTY map (badge hides, page still renders) + logs", async () => {
    rec.response = { data: null, error: { message: "boom" } };
    const map = await readPublicVerificationSignals(["s1"]);
    expect(map.size).toBe(0);
    expect(rec.sentry).toHaveLength(1);
  });

  it("short-circuits on empty input without querying", async () => {
    const map = await readPublicVerificationSignals([]);
    expect(map.size).toBe(0);
    expect(rec.selectCols).toHaveLength(0);
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
    // The trust_tier read went through the service-role helper (published-gated).
    expect(rec.eqCalls).toContainEqual(["strategies.status", "published"]);
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
