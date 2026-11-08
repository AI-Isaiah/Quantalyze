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
 *
 * 2026-11-07, Phase 194 plan 18 (D-11 as superseded by D-15) - THE PIN MOVED, on purpose.
 * The KPI list is still the first seven columns, byte for byte, and the gate column is
 * still the eighth. What changed is what follows them: the four scalar record aliases
 * (first and last return date, headline start, observation count) that let the scorer
 * judge each row's TOTAL record, and the strategy's own `asset_class` beside `id`. They
 * ride ALONGSIDE the KPI list (`PERCENTILE_SPAN_COLUMNS`), never inside
 * `PERCENTILE_METRICS`, because the scorer ranks every member of that array. No series
 * array or flags blob is projected: a `returns_series`, `data_quality_flags` or
 * `metrics_json` WITHOUT a `->` path would be a leak (T-194-35) and is asserted absent
 * below.
 */
const PINNED_KPI_PROJECTION =
  "strategy_analytics (cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return, computation_status, series_start:returns_series->0->>date, series_end:returns_series->-1->>date, headline_since:data_quality_flags->>headline_since, record_observations:metrics_json->record_observations)";

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
    expect(recorded.selects).toEqual([`id, asset_class, ${PINNED_KPI_PROJECTION}`]);
  });

  it("getPercentiles(slug) projects the same pinned KPI list byte-for-byte", async () => {
    await getPercentiles("some-slug");
    expect(recorded.selects).toEqual([
      `id, asset_class, discovery_categories!inner(slug), ${PINNED_KPI_PROJECTION}`,
    ]);
  });

  it("getOwnRowPercentiles() projects the same pinned KPI list byte-for-byte", async () => {
    await getOwnRowPercentiles([]);
    expect(recorded.selects).toEqual([`id, asset_class, ${PINNED_KPI_PROJECTION}`]);
  });

  it("the span aliases are scalar JSON paths: no series array, flags blob or metrics blob rides along", async () => {
    await getPercentiles();
    await getPercentiles("some-slug");
    await getOwnRowPercentiles([]);
    expect(recorded.selects).toHaveLength(3);
    for (const select of recorded.selects) {
      // Every reference to a blob column is an aliased `->` / `->>` path, never the bare column.
      for (const blob of ["returns_series", "data_quality_flags", "metrics_json"]) {
        const bare = new RegExp(`(^|[\\s,(])${blob}(?![-\\w])`);
        expect(select, `${blob} must not be projected whole`).not.toMatch(bare);
      }
    }
  });
});
