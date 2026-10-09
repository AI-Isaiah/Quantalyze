/**
 * Phase 170.5 (D-05, D-06) - getStrategyDetailV2 must project `trust_tier`.
 *
 * Root cause: the v2 SELECT never fetched `trust_tier`, so
 * `strategy.trust_tier` was `undefined` at runtime. `Disclaimer` treats
 * undefined as `self_reported` (an API-verified strategy's footer called it
 * self-reported) and `VerifiedBadge` fails closed on anything but
 * `api_verified` (the header chip never showed). The tier is now read through
 * `readPublicVerificationSignals` (the published-gated
 * `get_published_trust_signals` SECDEF RPC), the same public reader behind the
 * factsheet's TrustTierLabel.
 *
 * WHY each case matters:
 *   A/B - the projection exists and carries the tier the RPC returned.
 *   C   - an RPC failure is fail-soft: the page still renders, the tier is
 *         null (never an invented API claim) and the failure is captured.
 *   D   - the RPC is the ONLY trust read; a raw strategy_verifications SELECT
 *         would bypass the published gate and the column allow-list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const ID = "11111111-1111-4111-8111-111111111111";

type QueryResult = { data: unknown; error: unknown };

const rec = vi.hoisted(() => ({
  rpcCalls: [] as [string, Record<string, unknown>][],
  fromTables: [] as string[],
  rpcResponse: { data: [], error: null } as { data: unknown; error: unknown },
  sentry: [] as { err: unknown; opts: unknown }[],
}));

function strategyRow() {
  return {
    id: ID,
    name: "Tier Test Strategy",
    start_date: "2025-01-01",
    supported_exchanges: ["Binance"],
    strategy_types: ["systematic"],
    subtypes: [],
    markets: ["crypto"],
    leverage_range: null,
    avg_daily_turnover: null,
    strategy_analytics: null,
  };
}

function buildChain(table: string) {
  const result: QueryResult = { data: strategyRow(), error: null };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  void table;
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      rec.fromTables.push(table);
      return buildChain(table);
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      rec.rpcCalls.push([name, params]);
      return Promise.resolve(rec.rpcResponse);
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => buildChain("admin") }),
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    rec.sentry.push({ err, opts });
  },
}));

// 2026-10-09 Phase 170.5 (D-07): isolate the trust-tier tests from the joint read
// (getStrategyDetailV2 now reads the factsheet's live joint through an admin chain this
// file's thin mock does not model). Default: computed with null values.
vi.mock("@/lib/factsheet/v2-joint", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/v2-joint")>()),
  readV2BenchmarkJoint: vi.fn(async () => ({
    values: { alpha: null, beta: null, correlation: null, ir: null, treynor: null },
    status: { kind: "computed", paired: 0, flatLeg: false },
  })),
}));

import { getStrategyDetailV2 } from "./queries";

beforeEach(() => {
  rec.rpcCalls = [];
  rec.fromTables = [];
  rec.sentry = [];
  rec.rpcResponse = { data: [], error: null };
  // The fail-soft path logs to console.error by design; keep the run quiet.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getStrategyDetailV2 - trust_tier projection (Phase 170.5 D-05)", () => {
  it("A: an api_verified RPC row projects strategy.trust_tier = api_verified through get_published_trust_signals", async () => {
    rec.rpcResponse = {
      data: [{ strategy_id: ID, trust_tier: "api_verified", status: "published" }],
      error: null,
    };
    const result = await getStrategyDetailV2(ID);
    expect(result).not.toBeNull();
    expect(result!.strategy.trust_tier).toBe("api_verified");
    expect(rec.rpcCalls).toContainEqual([
      "get_published_trust_signals",
      { p_strategy_ids: [ID] },
    ]);
  });

  it("B: a csv_uploaded RPC row projects strategy.trust_tier = csv_uploaded", async () => {
    rec.rpcResponse = {
      data: [{ strategy_id: ID, trust_tier: "csv_uploaded", status: "published" }],
      error: null,
    };
    const result = await getStrategyDetailV2(ID);
    expect(result!.strategy.trust_tier).toBe("csv_uploaded");
  });

  it("C: an RPC failure is fail-soft - no throw, trust_tier null, failure captured to Sentry", async () => {
    rec.rpcResponse = { data: null, error: { message: "rpc down", code: "XX000" } };
    const result = await getStrategyDetailV2(ID);
    expect(result).not.toBeNull();
    expect(result!.strategy.trust_tier).toBeNull();
    expect(rec.sentry.length).toBeGreaterThanOrEqual(1);
  });

  it("D: the RPC is the only trust read - no raw strategy_verifications table access", async () => {
    rec.rpcResponse = {
      data: [{ strategy_id: ID, trust_tier: "api_verified", status: "published" }],
      error: null,
    };
    await getStrategyDetailV2(ID);
    expect(rec.fromTables).not.toContain("strategy_verifications");
  });
});
