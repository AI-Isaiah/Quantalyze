/**
 * Phase 170.5 plan 06 Task 2 (D-07, D-06) - the composite builder path.
 *
 * The light path cannot read a composite's series (it lives behind a
 * `server-only` reader), so it answers `needs_builder` and the v2 page asks the
 * factsheet's own builder. `readCompositeV2Joint` maps the build result with
 * `v2JointFromBuildResult` and must never turn a failure into absence.
 *
 * The builder runs on the service-role client, so `withPublishedOnly` is the
 * only row gate (T-170.5-17): the test pins that the very function imported from
 * `@/lib/visibility` is what is passed. The payload fixture is built by the real
 * `buildFactsheetPayload`, so the five figures asserted are the factsheet's own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const builder = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/factsheet/fetch-and-build-payload", () => ({
  fetchAndBuildPayloadWithReason: builder.run,
}));
const sentry = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: sentry.capture }));

import { withPublishedOnly } from "@/lib/visibility";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import type { StrategyV2Detail } from "@/lib/queries";
import { readCompositeV2Joint, withV2Joint } from "./composite-joint";

const ID = "00000000-0000-4000-8000-000000001705";
const NULLS = { alpha: null, beta: null, correlation: null, ir: null, treynor: null };

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
const prices = closes("2025-12-31", "2026-06-30", 99);
const benchmarkPrices: BenchmarkPricesOpt = {
  prices,
  through: prices[prices.length - 1].date,
  dropped: [],
};
const STRATEGY = {
  id: "s-170-5-06",
  name: "Composite Joint Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-09T00:00:00Z",
  trustTier: null,
  assetClass: "crypto" as string | null,
  ingestSource: "csv" as const,
};
function payload(opts: { benchmarkPrices?: BenchmarkPricesOpt } = { benchmarkPrices }): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, strategyRows(days("2026-01-01", "2026-06-30")), opts);
  if (!p) throw new Error("fixture must build");
  return p;
}
const fin = (v: number) => (Number.isFinite(v) ? v : null);

beforeEach(() => {
  builder.run.mockReset();
  sentry.capture.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readCompositeV2Joint (builder path, D-07)", () => {
  it("returns the payload's own BTC joint as the five values, status computed", async () => {
    const p = payload();
    const j = p.comparators.btc.joint!;
    builder.run.mockResolvedValue({ payload: p, reason: null });
    const got = await readCompositeV2Joint(ID);
    expect(got.values).toEqual({
      alpha: fin(j.alpha),
      beta: fin(j.beta),
      correlation: fin(j.corr),
      ir: fin(j.info_ratio),
      treynor: fin(j.treynor),
    });
    expect(got.status.kind).toBe("computed");
  });

  it("calls the builder with (id, withPublishedOnly): the very function from @/lib/visibility (T-170.5-17)", async () => {
    builder.run.mockResolvedValue({ payload: payload(), reason: null });
    await readCompositeV2Joint(ID);
    expect(builder.run).toHaveBeenCalledTimes(1);
    expect(builder.run.mock.calls[0][0]).toBe(ID);
    expect(builder.run.mock.calls[0][1]).toBe(withPublishedOnly);
  });

  it("a read_error result is status error, not absence", async () => {
    builder.run.mockResolvedValue({ payload: null, reason: "read_error" });
    expect(await readCompositeV2Joint(ID)).toEqual({ values: NULLS, status: { kind: "error" } });
  });

  it("a composite_unbuildable result is not_computed (a data condition, not an outage)", async () => {
    builder.run.mockResolvedValue({ payload: null, reason: "composite_unbuildable" });
    expect(await readCompositeV2Joint(ID)).toEqual({ values: NULLS, status: { kind: "not_computed" } });
  });

  it("a builder rejection is status error, captured once with stage v2-composite-joint", async () => {
    builder.run.mockRejectedValue(new Error("builder down"));
    const got = await readCompositeV2Joint(ID);
    expect(got).toEqual({ values: NULLS, status: { kind: "error" } });
    expect(sentry.capture).toHaveBeenCalledTimes(1);
    expect(sentry.capture.mock.calls[0][1]).toEqual({
      tags: { stage: "v2-composite-joint", strategy_id: ID },
    });
  });

  it("a throw from the MAPPER is also status error and captured (the mapping sits inside the try)", async () => {
    // A BTC joint but no benchmarkPrices: the plan-04 unreachable shape, so the real
    // v2JointFromBuildResult throws. Built from a real payload with the field stripped.
    const stripped = { ...payload(), benchmarkPrices: undefined } as FactsheetPayload;
    builder.run.mockResolvedValue({ payload: stripped, reason: null });
    const got = await readCompositeV2Joint(ID);
    expect(got).toEqual({ values: NULLS, status: { kind: "error" } });
    expect(sentry.capture).toHaveBeenCalledTimes(1);
    expect(sentry.capture.mock.calls[0][1]).toEqual({
      tags: { stage: "v2-composite-joint", strategy_id: ID },
    });
  });
});

describe("withV2Joint (pure merge)", () => {
  const OTHER = { sentinel: true };
  const detail = {
    strategy: { id: ID },
    panel1: OTHER,
    panel6Inputs: { trade_metrics: null, data_quality_flags: null },
    panel7Inputs: {
      benchmark_greeks: { alpha: null, beta: null, ir: null, treynor: null },
      benchmark_joint: { kind: "needs_builder" },
      correlation_analytics: { returns_series: null, metrics_json: { k: 1 } },
    },
    history_days: 7,
  } as unknown as StrategyV2Detail;
  const joint = {
    values: { alpha: 0.1, beta: 0.2, correlation: 0.3, ir: 0.4, treynor: 0.5 },
    status: { kind: "computed", paired: 90, flatLeg: false },
  } as const;

  it("replaces benchmark_greeks and benchmark_joint with the joint's", () => {
    const merged = withV2Joint(detail, joint);
    expect(merged.panel7Inputs.benchmark_greeks).toEqual(joint.values);
    expect(merged.panel7Inputs.benchmark_joint).toEqual(joint.status);
  });

  it("returns a new object and leaves every other field the same reference", () => {
    const merged = withV2Joint(detail, joint);
    expect(merged).not.toBe(detail);
    expect(merged.panel7Inputs).not.toBe(detail.panel7Inputs);
    expect(merged.strategy).toBe(detail.strategy);
    expect(merged.panel1).toBe(detail.panel1);
    expect(merged.panel6Inputs).toBe(detail.panel6Inputs);
    expect(merged.panel7Inputs.correlation_analytics).toBe(detail.panel7Inputs.correlation_analytics);
    // the input is not mutated
    expect(detail.panel7Inputs.benchmark_joint).toEqual({ kind: "needs_builder" });
  });
});
