/**
 * Review round 2 F6 — `hasAnyOwnStrategies`, the narrow existence read that
 * replaced a whole-list fetch used for a boolean.
 *
 * WHAT THIS PROTECTS (the contract, not the SQL):
 *
 *  1. THE TRI-STATE. `null` means the read FAILED; `false` means the read
 *     SUCCEEDED and the owner genuinely has no strategies. The allocations page
 *     renders a temporarily-unavailable notice for the first and the definitive
 *     "No strategies yet." empty state + wizard CTA for the second. Collapsing
 *     them tells an owner who HAS strategies that they have none — the exact
 *     regression `getMyStrategies`'s own `null`-never-`[]` contract exists to
 *     prevent, which this replacement had to inherit whole.
 *
 *  2. THE NARROWNESS. The predecessor selected `*, strategy_analytics (*)` —
 *     daily_returns, returns_series, drawdown_series, rolling_metrics,
 *     monthly_returns and sparklines for every non-archived strategy — and then
 *     made a SECOND, serial round-trip through `readPublicVerificationSignals`
 *     to shape rows that were discarded on the next line, on every SSR render
 *     of the allocations money surface. The projection assertions below are the
 *     only thing standing between this and a quiet re-widening; the mock is a
 *     RECORDING one so the assertion reads the chain that was actually built,
 *     not a re-spelling of the source.
 *
 *  3. THE PREDICATE. Owner-scoped (`user_id`) and W-4 archived-excluded, the
 *     same two filters `getMyStrategies` carries, so "does this owner have any
 *     strategies?" cannot start meaning something different from the list the
 *     owner is shown.
 *
 * Harness: the recording PostgREST builder from
 * `queries.own-capital-strategies.test.ts`, extended to capture the filter
 * arguments. `vi.spyOn` + `restoreAllMocks` throughout (never a leaked
 * `vi.stubGlobal`) — CI runs Node 22 against a Node 25 local.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({
  queryResult: { data: null as unknown, error: null as unknown },
  calls: {
    select: [] as unknown[],
    eq: [] as unknown[][],
    neq: [] as unknown[][],
    limit: [] as unknown[],
  },
  rpc: null as null | ((...args: unknown[]) => Promise<unknown>),
}));

/**
 * A recording PostgREST builder. Every filter returns the same thenable, so the
 * ORDER of the chain in queries.ts may change without this mock lying — but the
 * arguments are captured, which is what the projection assertions read.
 */
function builder() {
  const chain = {
    select: (...args: unknown[]) => {
      state.calls.select.push(args[0]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      state.calls.eq.push(args);
      return chain;
    },
    neq: (...args: unknown[]) => {
      state.calls.neq.push(args);
      return chain;
    },
    limit: (...args: unknown[]) => {
      state.calls.limit.push(args[0]);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(state.queryResult).then(resolve),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => builder(),
    // A spy rather than an omission: an omitted `rpc` would surface as a
    // TypeError that could be mistaken for an unrelated harness fault. This way
    // "the second round-trip is gone" is an assertion, not an accident.
    rpc: (...args: unknown[]) => state.rpc!(...args),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => builder(),
    rpc: (...args: unknown[]) => state.rpc!(...args),
  }),
}));

import { hasAnyOwnStrategies } from "./queries";

const USER = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  state.queryResult = { data: null, error: null };
  state.calls = { select: [], eq: [], neq: [], limit: [] };
  state.rpc = vi.fn(async () => ({ data: null, error: null }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hasAnyOwnStrategies — the null-vs-empty contract (F6)", () => {
  it("a row present ⇒ true", async () => {
    state.queryResult = { data: [{ id: "s-1" }], error: null };
    await expect(hasAnyOwnStrategies(USER)).resolves.toBe(true);
  });

  it("a SUCCESSFUL empty read ⇒ false — the definitive 'this account has none', which the page is allowed to state", async () => {
    state.queryResult = { data: [], error: null };
    const out = await hasAnyOwnStrategies(USER);
    expect(out).toBe(false);
    // Explicitly NOT null: an empty account must reach the empty state, or the
    // wizard CTA becomes unreachable for every new owner.
    expect(out).not.toBeNull();
  });

  it("a FAILED read ⇒ null, never false — a DB blip may not be reported as an empty account", async () => {
    // The load-bearing case. `false` here would tell an owner with a full
    // catalog that they have no strategies, and would do it silently.
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.queryResult = {
      data: null,
      error: { message: "connection refused (test)" },
    };

    const out = await hasAnyOwnStrategies(USER);
    expect(out).toBeNull();
    expect(out).not.toBe(false);
  });

  it("a null payload with NO error ⇒ false — PostgREST's empty-result shape is still a successful read", async () => {
    state.queryResult = { data: null, error: null };
    await expect(hasAnyOwnStrategies(USER)).resolves.toBe(false);
  });
});

describe("hasAnyOwnStrategies — the read is NARROW and owner-scoped (F6)", () => {
  it("projects only `id`, stops at the first row, and makes no second round-trip", async () => {
    state.queryResult = { data: [{ id: "s-1" }], error: null };

    await hasAnyOwnStrategies(USER);

    // ONE round-trip, one projection.
    expect(state.calls.select).toEqual(["id"]);
    // The falsifier for a re-widening: the predecessor's projection pulled the
    // whole analytics embed, which is where the JSONB series columns live.
    expect(String(state.calls.select[0])).not.toContain("strategy_analytics");
    expect(String(state.calls.select[0])).not.toContain("*");
    // An existence question needs exactly one row.
    expect(state.calls.limit).toEqual([1]);
    // …and no trust-signal RPC. `readPublicVerificationSignals` was the SECOND,
    // serial round-trip the boolean never needed.
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("carries the SAME predicate as the ranked list — owner-scoped and archived-excluded", async () => {
    state.queryResult = { data: [], error: null };

    await hasAnyOwnStrategies(USER);

    // Owner scope is the tenant control, not a convenience filter.
    expect(state.calls.eq).toEqual([["user_id", USER]]);
    // W-4: archived ≠ a strategy the owner has. `getMyStrategies` excludes them
    // from the list, so an account holding only archived rows must answer
    // "none" here too — otherwise the page hides the empty state from an owner
    // whose visible list is empty.
    expect(state.calls.neq).toEqual([["status", "archived"]]);
  });
});
