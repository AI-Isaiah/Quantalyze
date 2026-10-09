/**
 * Phase 170.5 plan 04 (D-07) — stored-row parity. `v2-joint.parity.test.ts`
 * proves the pure core equals the builder on the same rows. This file proves the
 * LIGHT READ resolves a STORED row the way the factsheet does: one analytics row
 * (an equity-curve-only `returns_series`, `data_quality_flags.cumulative_method`
 * "simple") goes through `readV2BenchmarkJoint` and through the factsheet's own
 * resolve-and-build (`fetchAndBuildPayloadWithReason`), and the five figures must
 * be `toBe`-equal. Reading that curve as geometric (the default) would move every
 * figure, so a light path that ignored the row's method is RED here.
 *
 * Tables the builder read for this row (recorded by the double, asserted below):
 * `strategies` (the select both paths issue) and `strategy_analytics_series` (the
 * conventions echo, answered "no row"). Every other table answers empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const bench = vi.hoisted(() => ({ prices: null as unknown }));
vi.mock("@/lib/factsheet/benchmark-read", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/benchmark-read")>()),
  readFactsheetBenchmark: async () => bench.prices,
}));

const fake = vi.hoisted(() => ({
  strategyRow: null as unknown,
  tablesRead: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    fake.tablesRead.push(table);
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["select", "eq", "in", "order", "limit", "or", "gt", "gte", "lt", "lte", "is", "abortSignal"]) {
      b[m] = self;
    }
    const one = async () =>
      table === "strategies" ? { data: fake.strategyRow, error: null } : { data: null, error: null };
    b.maybeSingle = one;
    b.single = one;
    // A list read (awaited without maybeSingle) answers an empty page.
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve, reject);
    return b;
  }
  const client = { from: (t: string) => builder(t) };
  return { createAdminClient: () => client };
});

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAndBuildPayloadWithReason } from "./fetch-and-build-payload";
import { readV2BenchmarkJoint, v2JointFromBuildResult } from "./v2-joint";
import { withPublishedOnly } from "@/lib/visibility";
import type { BenchmarkPricesOpt } from "./build-payload";
import type { DailyPrice } from "./types";

const ID = "00000000-0000-4000-8000-000000000171";
const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** About 120 calendar days of a "simple" curve: level = 1 + cumulative sum of the daily returns. */
function simpleCurve(start: string, n: number) {
  let x = 20260921;
  let level = 1;
  const out: Array<{ date: string; value: number }> = [{ date: start, value: level }];
  for (let k = 1; k < n; k++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    level = Math.round((level + Math.round((x / 0x7fffffff - 0.5) * 0.04 * 1e6) / 1e6) * 1e6) / 1e6;
    out.push({ date: addDays(start, k), value: level });
  }
  return out;
}
function btcCloses(start: string, end: string): DailyPrice[] {
  const out: DailyPrice[] = [];
  let x = 99;
  let c = 100;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    c = Math.round(c * (1 + Math.round((x / 0x7fffffff - 0.5) * 0.06 * 1e6) / 1e6) * 1e6) / 1e6;
    out.push({ date: d, close: c });
  }
  return out;
}
const fin = (v: number) => (Number.isFinite(v) ? v : null);

beforeEach(() => {
  fake.tablesRead = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const prices = btcCloses("2026-01-01", "2026-05-15");
  bench.prices = { prices, through: prices[prices.length - 1].date, dropped: [] } satisfies BenchmarkPricesOpt;
  fake.strategyRow = {
    id: ID,
    name: "Stored Row Parity",
    codename: null,
    disclosure_tier: "exploratory",
    status: "published",
    markets: ["crypto"],
    strategy_types: ["quant"],
    description: null,
    subtypes: [],
    supported_exchanges: [],
    leverage_range: null,
    aum: null,
    max_capacity: null,
    avg_daily_turnover: null,
    start_date: "2026-01-02",
    benchmark: null,
    asset_class: "crypto",
    returns_denominator_config: null,
    strategy_analytics: {
      computation_status: "complete",
      computed_at: "2026-09-21T00:00:00Z",
      daily_returns: null,
      returns_series: simpleCurve("2026-01-02", 120),
      data_quality_flags: { cumulative_method: "simple" },
      metrics_json_by_basis: null,
    },
  };
});

describe("one stored row: the light read and the factsheet resolve-and-build print the same five figures (D-07)", () => {
  it("toBe-equal alpha, beta, correlation, IR and Treynor, and the same computed paired count", async () => {
    const light = await readV2BenchmarkJoint(createAdminClient(), ID);
    const built = await fetchAndBuildPayloadWithReason(ID, withPublishedOnly);
    expect(built.payload).not.toBeNull();
    const fromBuilder = v2JointFromBuildResult(built);
    const j = built.payload!.comparators.btc.joint!;

    expect(light.status.kind).toBe("computed");
    expect(fromBuilder.status.kind).toBe("computed");
    expect(light.values.alpha).toBe(fromBuilder.values.alpha);
    expect(light.values.beta).toBe(fromBuilder.values.beta);
    expect(light.values.correlation).toBe(fromBuilder.values.correlation);
    expect(light.values.ir).toBe(fromBuilder.values.ir);
    expect(light.values.treynor).toBe(fromBuilder.values.treynor);
    // ... and both are the payload's own joint, mapped.
    expect(light.values.alpha).toBe(fin(j.alpha));
    expect(light.values.beta).toBe(fin(j.beta));
    expect(light.values.correlation).toBe(fin(j.corr));
    expect(light.values.ir).toBe(fin(j.info_ratio));
    expect(light.values.treynor).toBe(fin(j.treynor));
    if (light.status.kind === "computed" && fromBuilder.status.kind === "computed") {
      expect(light.status.paired).toBe(fromBuilder.status.paired);
    }
  });

  it("the double served the tables this file says it did", async () => {
    await readV2BenchmarkJoint(createAdminClient(), ID);
    await fetchAndBuildPayloadWithReason(ID, withPublishedOnly);
    expect([...new Set(fake.tablesRead)].sort()).toEqual(["strategies", "strategy_analytics_series"]);
  });
});
