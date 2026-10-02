import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 166 (D-12 / D-18) — BYTE PIN on the KPI projection the two percentile
 * callers send to PostgREST.
 *
 * Phase 159 D-03 froze these bytes: `getPercentiles` (both branches) and
 * `getOwnRowPercentiles` must project exactly the seven KPI columns, in this
 * order, comma-space separated, followed by the RANK-01 gate column. Until
 * Phase 166 that rule was prose only. The list is now DERIVED from
 * `PERCENTILE_METRICS` (percentile-core.ts), so a reorder, a rename or a
 * changed separator there would silently change the projection, and with it
 * which rows rank. This pin is what makes that visible.
 *
 * ⛔ The expected string below is written out BY HAND and must stay that way.
 * Recomputing it from `PERCENTILE_METRICS` would make the pin agree with
 * whatever the source says, so it could never fail.
 */
const PINNED_KPI_PROJECTION =
  "strategy_analytics (cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return, computation_status)";

const recorded = vi.hoisted(() => ({ selects: [] as string[] }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        recorded.selects.push(columns);
        return chain;
      };
      chain.eq = () => chain;
      // Both callers await the chain directly. Resolve to an empty population:
      // the select has already been recorded by then, and `< 5` returns null.
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled);
      return chain;
    },
  }),
}));

// queries.ts imports the admin client; mock it so the module loads in vitest.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({}) }),
}));

import { getPercentiles, getOwnRowPercentiles } from "./queries";

beforeEach(() => {
  recorded.selects = [];
});

describe("percentile KPI projection — byte pin (Phase 159 D-03, Phase 166 D-18)", () => {
  it("getPercentiles() without a category projects the pinned KPI list byte-for-byte", async () => {
    await getPercentiles();
    expect(recorded.selects).toEqual([`id, ${PINNED_KPI_PROJECTION}`]);
  });

  it("getPercentiles(slug) projects the same pinned KPI list byte-for-byte", async () => {
    await getPercentiles("some-slug");
    expect(recorded.selects).toEqual([
      `id, discovery_categories!inner(slug), ${PINNED_KPI_PROJECTION}`,
    ]);
  });

  it("getOwnRowPercentiles() projects the same pinned KPI list byte-for-byte", async () => {
    await getOwnRowPercentiles([]);
    expect(recorded.selects).toEqual([`id, ${PINNED_KPI_PROJECTION}`]);
  });
});
