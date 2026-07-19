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
};

// A thenable chain mirroring the PostgREST builder shape the helper awaits:
//   admin.from(t).select(sel).in(col, ids).eq(col, val).order(col, opts)
function buildChain() {
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => buildChain() }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => buildChain() }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    rec.sentry.push({ err, opts });
  },
}));

import { readPublicVerificationSignals } from "./queries";

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
