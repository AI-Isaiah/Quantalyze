import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 170.5 plan 04 (D-07) — the two adapters around `computeV2Joint`:
 * `readV2BenchmarkJoint` (the light path, one admin read) and
 * `v2JointFromBuildResult` (a factsheet build result mapped to the same closed
 * status). The closed status is what lets the panel say WHY a figure is a dash:
 * a failed read is `error`, never "not computed" (failure is not absence).
 */

const bench = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/factsheet/benchmark-read", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/factsheet/benchmark-read")>()),
  readFactsheetBenchmark: bench.read,
}));
const sentry = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: sentry.capture }));

import { buildFactsheetPayload } from "./build-payload";
import type { BenchmarkPricesOpt } from "./build-payload";
import { computeV2Joint, readV2BenchmarkJoint, v2JointFromBuildResult } from "./v2-joint";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "./types";

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}
function closes(start: string, end: string, seed: number): DailyPrice[] {
  const out: DailyPrice[] = [];
  let x = seed >>> 0;
  let c = 100;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    c = Math.round(c * (1 + Math.round((x / 0x7fffffff - 0.5) * 0.06 * 1e6) / 1e6) * 1e6) / 1e6;
    out.push({ date: d, close: c });
  }
  return out;
}
function strategyRows(dates: string[], seed = 12345): DailyReturn[] {
  let x = seed >>> 0;
  return dates.map((date) => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    return { date, value: Math.round((x / 0x7fffffff - 0.5) * 0.1 * 1e6) / 1e6 };
  });
}
const opt = (prices: DailyPrice[]): BenchmarkPricesOpt => ({
  prices,
  through: prices[prices.length - 1]?.date ?? null,
  dropped: [],
});
const NULLS = { alpha: null, beta: null, correlation: null, ir: null, treynor: null };

// ── the admin double: records every call of the one read ───────────────────
type Result = { data: unknown; error: unknown };
const admin = vi.hoisted(() => ({
  result: { data: null, error: null } as { data: unknown; error: unknown },
  throws: false,
  calls: [] as Array<[string, ...unknown[]]>,
}));
function fakeAdmin() {
  const b: Record<string, unknown> = {};
  b.from = (t: string) => (admin.calls.push(["from", t]), b);
  b.select = (s: string) => (admin.calls.push(["select", s]), b);
  b.eq = (c: string, v: unknown) => (admin.calls.push(["eq", c, v]), b);
  b.maybeSingle = async (): Promise<Result> => {
    if (admin.throws) throw new Error("socket hang up");
    return admin.result;
  };
  return b as never;
}
const ID = "00000000-0000-4000-8000-000000000170";
const ROWS = strategyRows(days("2026-01-01", "2026-06-30"));
const row = (analytics: Record<string, unknown>, asset_class: string | null = "crypto") => ({
  data: { id: ID, asset_class, strategy_analytics: analytics },
  error: null,
});
const COMPLETE = { computation_status: "complete", daily_returns: ROWS, returns_series: null, data_quality_flags: null };

beforeEach(() => {
  bench.read.mockReset();
  sentry.capture.mockReset();
  admin.result = { data: null, error: null };
  admin.throws = false;
  admin.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("readV2BenchmarkJoint — the light path", () => {
  it("a returned admin error is `error` with five nulls, logged and captured with a stable stage tag", async () => {
    admin.result = { data: null, error: { code: "57014", message: "canceling statement" } };
    const got = await readV2BenchmarkJoint(fakeAdmin(), ID);
    expect(got).toEqual({ values: NULLS, status: { kind: "error" } });
    expect(sentry.capture).toHaveBeenCalledTimes(1);
    expect(sentry.capture.mock.calls[0][1]).toMatchObject({ tags: { stage: "v2-joint", strategy_id: ID } });
    expect(bench.read).not.toHaveBeenCalled();
  });

  it("a thrown admin read is `error` too", async () => {
    admin.throws = true;
    expect((await readV2BenchmarkJoint(fakeAdmin(), ID)).status).toEqual({ kind: "error" });
  });

  it("an absent row (published per RLS but invisible to the admin read) is `error`, not a data fact", async () => {
    admin.result = { data: null, error: null };
    expect((await readV2BenchmarkJoint(fakeAdmin(), ID)).status).toEqual({ kind: "error" });
  });

  it("a non-terminal computation_status is `not_computed`", async () => {
    admin.result = row({ ...COMPLETE, computation_status: "computing" });
    expect((await readV2BenchmarkJoint(fakeAdmin(), ID)).status).toEqual({ kind: "not_computed" });
  });

  it("a composite is `needs_builder` and never reaches the BTC read", async () => {
    admin.result = row({ ...COMPLETE, data_quality_flags: { composite: true } });
    const got = await readV2BenchmarkJoint(fakeAdmin(), ID);
    expect(got).toEqual({ values: NULLS, status: { kind: "needs_builder" } });
    expect(bench.read).not.toHaveBeenCalled();
  });

  it("a native unit is `native_unit` and never reaches the BTC read", async () => {
    admin.result = row({ ...COMPLETE, data_quality_flags: { native_unit: "BTC" } });
    const got = await readV2BenchmarkJoint(fakeAdmin(), ID);
    expect(got).toEqual({ values: NULLS, status: { kind: "native_unit", unit: "BTC" } });
    expect(bench.read).not.toHaveBeenCalled();
  });

  it("a malformed native_unit does not fire the native-unit rung", async () => {
    admin.result = row({ ...COMPLETE, data_quality_flags: { native_unit: "<b>x</b>" } });
    bench.read.mockResolvedValue({ unavailable: true });
    expect((await readV2BenchmarkJoint(fakeAdmin(), ID)).status).toEqual({ kind: "benchmark_unavailable" });
  });

  it("fewer than 2 distinct dated points is `not_computed`", async () => {
    admin.result = row({ ...COMPLETE, daily_returns: [{ date: "2026-01-01", value: 0.01 }, { date: "2026-01-01", value: 0.02 }] });
    expect((await readV2BenchmarkJoint(fakeAdmin(), ID)).status).toEqual({ kind: "not_computed" });
    expect(bench.read).not.toHaveBeenCalled();
  });

  it("the unavailable marker from the BTC read is `benchmark_unavailable`", async () => {
    admin.result = row(COMPLETE);
    bench.read.mockResolvedValue({ unavailable: true });
    const got = await readV2BenchmarkJoint(fakeAdmin(), ID);
    expect(got).toEqual({ values: NULLS, status: { kind: "benchmark_unavailable" } });
  });

  it("closes from the BTC read give `computed`, equal to computeV2Joint on the resolved series", async () => {
    const prices = opt(closes("2025-12-31", "2026-06-30", 99));
    admin.result = row(COMPLETE);
    bench.read.mockResolvedValue(prices);
    const got = await readV2BenchmarkJoint(fakeAdmin(), ID);
    const want = computeV2Joint(ROWS, prices, "crypto");
    expect(got.status.kind).toBe("computed");
    expect(got).toEqual(want);
    expect(bench.read.mock.calls[0][2]).toBeUndefined();
    expect(bench.read.mock.calls[0][3]).toBe(ID);
  });

  it("the read asks for asset_class and the four series columns, by id, behind the published-only predicate (T-170.5-09)", async () => {
    admin.result = row(COMPLETE);
    bench.read.mockResolvedValue({ unavailable: true });
    await readV2BenchmarkJoint(fakeAdmin(), ID);
    const select = admin.calls.find((c) => c[0] === "select")![1] as string;
    expect(select.replace(/\s+/g, " ")).toContain(
      "asset_class, strategy_analytics ( daily_returns, returns_series, data_quality_flags, computation_status )",
    );
    expect(admin.calls).toContainEqual(["from", "strategies"]);
    expect(admin.calls).toContainEqual(["eq", "id", ID]);
    expect(admin.calls).toContainEqual(["eq", "status", "published"]);
  });
});

// ── the builder path ───────────────────────────────────────────────────────
const STRATEGY = {
  id: "s-170-5-04b",
  name: "V2 Joint Adapter Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-09T00:00:00Z",
  trustTier: null,
  assetClass: "crypto" as string | null,
  ingestSource: "csv" as const,
};
function payloadOf(rows: DailyReturn[], benchmarkPrices: BenchmarkPricesOpt, returnsUnit?: string): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices, ...(returnsUnit ? { returnsUnit } : {}) });
  if (!p) throw new Error("fixture must build");
  return p;
}
const fin = (v: number) => (Number.isFinite(v) ? v : null);

describe("v2JointFromBuildResult — the builder path", () => {
  it.each(["read_error", "not_visible"])("%s is `error` (failure is not absence)", (reason) => {
    expect(v2JointFromBuildResult({ payload: null, reason })).toEqual({ values: NULLS, status: { kind: "error" } });
  });

  it.each(["not_computed", "composite_unbuildable", "too_few_points", "malformed_series"])(
    "%s is `not_computed`",
    (reason) => {
      expect(v2JointFromBuildResult({ payload: null, reason })).toEqual({
        values: NULLS,
        status: { kind: "not_computed" },
      });
    },
  );

  it("an unrecognised reason is `error`, never absence", () => {
    expect(v2JointFromBuildResult({ payload: null, reason: "something_new" }).status).toEqual({ kind: "error" });
  });

  it("payload.returnsUnit is `native_unit`", () => {
    const p = payloadOf(ROWS, opt(closes("2025-12-31", "2026-06-30", 99)), "BTC");
    expect(v2JointFromBuildResult({ payload: p, reason: null })).toEqual({
      values: NULLS,
      status: { kind: "native_unit", unit: "BTC" },
    });
  });

  it("an unavailable benchmarkPrices marker is `benchmark_unavailable`", () => {
    const p = payloadOf(ROWS, { unavailable: true });
    expect(v2JointFromBuildResult({ payload: p, reason: null }).status).toEqual({ kind: "benchmark_unavailable" });
  });

  it("jointWithheld is `below_floor` with the builder's own paired count and floor", () => {
    const p = payloadOf(strategyRows(days("2026-01-01", "2026-01-20")), opt(closes("2025-12-31", "2026-01-09", 5)));
    expect(p.comparators.btc.jointWithheld).toEqual({ paired: 9, floor: 10 });
    expect(v2JointFromBuildResult({ payload: p, reason: null })).toEqual({
      values: NULLS,
      status: { kind: "below_floor", paired: 9, floor: 10 },
    });
  });

  it("a joint maps to `computed` with the factsheet's own five figures, equal to computeV2Joint", () => {
    const prices = opt(closes("2025-12-31", "2026-06-30", 99));
    const p = payloadOf(ROWS, prices);
    const j = p.comparators.btc.joint!;
    const got = v2JointFromBuildResult({ payload: p, reason: null });
    expect(got.values.alpha).toBe(fin(j.alpha));
    expect(got.values.beta).toBe(fin(j.beta));
    expect(got.values.correlation).toBe(fin(j.corr));
    expect(got.values.ir).toBe(fin(j.info_ratio));
    expect(got.values.treynor).toBe(fin(j.treynor));
    expect(got).toEqual(computeV2Joint(ROWS, prices, "crypto"));
  });

  it("a JSON round-trip turns a NaN ratio into null on the payload; the mapped value stays null, never 0", () => {
    const flat = days("2026-01-01", "2026-04-30").map((date) => ({ date, value: 0 }));
    const p = JSON.parse(JSON.stringify(payloadOf(flat, opt(closes("2025-12-31", "2026-04-30", 99))))) as FactsheetPayload;
    expect(p.comparators.btc.joint!.corr).toBeNull();
    const got = v2JointFromBuildResult({ payload: p, reason: null });
    expect(got.values.correlation).toBeNull();
    expect(got.status.kind).toBe("computed");
  });

  it("a payload with a BTC joint but no benchmarkPrices throws rather than inventing a paired count", () => {
    const p = payloadOf(ROWS, opt(closes("2025-12-31", "2026-06-30", 99)));
    const stripped = { ...p, benchmarkPrices: undefined } as FactsheetPayload;
    expect(() => v2JointFromBuildResult({ payload: stripped, reason: null })).toThrow(
      "v2JointFromBuildResult: payload has a BTC joint but no benchmarkPrices",
    );
  });
});
