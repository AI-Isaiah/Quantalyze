/**
 * Phase 194 plan 11 (D-04 as superseded by D-15): `getOwnCapitalStrategies` computes the
 * strategy's TOTAL record SERVER-side and ships it as three scalars.
 *
 * WHY THIS MATTERS: the Holdings Sharpe is withheld or marked `<1y` from the strategy's
 * total record (crypto: 90 calendar days; non-crypto: 60 return observations). The record
 * has to be measured on the server because the return series never crosses the RSC
 * boundary (review round 3 E2). If this producer reported a wrong span, a few weeks of
 * returns would print a confident annualised Sharpe next to the allocator's own money,
 * or a long record would be dashed out. Each case below is therefore an oracle taken from
 * the calendar (days between two dates), never read back off the code under test.
 *
 * The dashboard half of the table has its own producer; its cases live in
 * `queries.my-allocation.test.ts` ("194 plan 11" block), so the two halves are pinned by
 * the same expectations.
 */

import { describe, it, expect } from "vitest";
import { vi } from "vitest";

const state = vi.hoisted(() => ({
  queryResult: { data: null as unknown, error: null as unknown },
}));

function builder() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(state.queryResult).then(resolve),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => builder() }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => builder() }),
}));

import { getOwnCapitalStrategies } from "./queries";

const USER = "00000000-0000-4000-8000-0000000000bb";

/** Two direct daily returns: the span is the calendar distance between `first` and `last`. */
function row(over: {
  first?: string;
  last?: string;
  asset_class?: string | null;
  record_observations?: unknown;
  flags?: unknown;
  noSeries?: boolean;
}) {
  return {
    id: "s-1",
    name: "Helios Basis",
    codename: null,
    disclosure_tier: "exploratory",
    status: "private",
    capital_ownership: "own_capital",
    asset_class: over.asset_class === undefined ? "crypto" : over.asset_class,
    strategy_analytics: {
      daily_returns: over.noSeries
        ? null
        : [
            { date: over.first ?? "2026-01-01", value: 0.001 },
            { date: over.last ?? "2026-03-02", value: 0.002 },
          ],
      cagr: 0.4,
      sharpe: 1.8,
      volatility: 0.3,
      max_drawdown: -0.12,
      returns_series: null,
      data_quality_flags: over.flags ?? null,
      record_observations: over.record_observations,
    },
  };
}

async function read(r: ReturnType<typeof row>) {
  state.queryResult = { data: [r], error: null };
  const out = await getOwnCapitalStrategies(USER);
  expect(out).not.toBeNull();
  return out![0] as unknown as Record<string, unknown>;
}

describe("getOwnCapitalStrategies: the total-record scalars (194 D-15)", () => {
  it("a series from 2026-01-01 to 2026-03-02 covers 61 days (31 + 28 + 2, both ends counted)", async () => {
    const out = await read(row({}));
    expect(out.figure_span_days).toBe(61);
  });

  it("a chain-broken row's span starts at headline_since: 2026-02-01 to 2026-03-02 covers 30 days", async () => {
    const out = await read(row({ flags: { headline_since: "2026-02-01" } }));
    expect(out.figure_span_days).toBe(30);
  });

  it("a headline_since that is not an ISO day is ignored, never guessed", async () => {
    const out = await read(row({ flags: { headline_since: "last tuesday" } }));
    expect(out.figure_span_days).toBe(61);
  });

  it("no dated series: the span is null, not 0", async () => {
    const out = await read(row({ noSeries: true }));
    expect(out.figure_span_days).toBeNull();
  });

  it("a stored record_observations of 59 reaches figure_observations; an absent one is null", async () => {
    expect((await read(row({ record_observations: 59 }))).figure_observations).toBe(59);
    expect((await read(row({}))).figure_observations).toBeNull();
    // A non-number never reads as a count.
    expect((await read(row({ record_observations: "59" }))).figure_observations).toBeNull();
  });

  it("asset_class crypto is figure_crypto true; traditional and an unset class are false", async () => {
    expect((await read(row({ asset_class: "crypto" }))).figure_crypto).toBe(true);
    expect((await read(row({ asset_class: "traditional" }))).figure_crypto).toBe(false);
    expect((await read(row({ asset_class: null }))).figure_crypto).toBe(false);
  });

  it("a strategy with no analytics row still gets a crypto verdict and an unknown record", async () => {
    const r = row({});
    (r as unknown as { strategy_analytics: unknown }).strategy_analytics = null;
    const out = await read(r);
    expect(out.figure_span_days).toBeNull();
    expect(out.figure_observations).toBeNull();
    expect(out.figure_crypto).toBe(true);
  });

  it("T-194-24: only the three scalars cross; no series, flags, metrics blob or raw alias is added", async () => {
    const out = await read(
      row({ record_observations: 120, flags: { headline_since: "2026-02-01", composite: true } }),
    );
    const analytics = out.strategy_analytics as Record<string, unknown>;
    for (const key of ["returns_series", "daily_returns", "data_quality_flags", "metrics_json", "record_observations"]) {
      expect(key in analytics, `strategy_analytics.${key}`).toBe(false);
      expect(key in out, `row.${key}`).toBe(false);
    }
    // `asset_class` is selected to decide the verdict and is not itself shipped.
    expect("asset_class" in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain("composite");
    expect(JSON.stringify(out)).not.toContain("headline_since");
  });
});
