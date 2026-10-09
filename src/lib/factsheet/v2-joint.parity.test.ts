import { describe, it, expect } from "vitest";
import { buildFactsheetPayload } from "./build-payload";
import type { BenchmarkPricesOpt } from "./build-payload";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "./align";
import { computeV2Joint } from "./v2-joint";
import type { DailyPrice, DailyReturn } from "./types";

/**
 * Phase 170.5 plan 04 (D-07) — the parity oracle that makes "v2 matches the
 * factsheet exactly" true. `computeV2Joint` is compared, with `toBe` (same code,
 * same floats), to the figures `buildFactsheetPayload` puts on
 * `comparators.btc.joint` for the same daily-return rows and the same
 * BenchmarkPricesOpt. It never compares against the stored Python metrics
 * (RESEARCH Pitfall 4).
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
function days(a: string, b: string): string[] {
  const o: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) o.push(d);
  return o;
}
const weekdays = (a: string, b: string) => days(a, b).filter((d) => dow(d) !== 0 && dow(d) !== 6);

/** Deterministic BTC closes, every calendar day. */
function closes(start: string, end: string, seed: number): DailyPrice[] {
  const out: DailyPrice[] = [];
  let x = seed >>> 0;
  let c = 100;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    const r = Math.round((x / 0x7fffffff - 0.5) * 0.06 * 1e6) / 1e6;
    c = Math.round(c * (1 + r) * 1e6) / 1e6;
    out.push({ date: d, close: c });
  }
  return out;
}
/** Deterministic strategy returns on the given dates. */
function strategyRows(dates: string[], seed = 12345): DailyReturn[] {
  let x = seed >>> 0;
  return dates.map((date) => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    return { date, value: Math.round((x / 0x7fffffff - 0.5) * 0.1 * 1e6) / 1e6 };
  });
}
const opt = (prices: DailyPrice[], dropped: string[] = []): BenchmarkPricesOpt => ({
  prices,
  through: prices.length ? prices[prices.length - 1].date : null,
  dropped,
});

const STRATEGY = {
  id: "s-170-5-04",
  name: "V2 Joint Parity Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-09T00:00:00Z",
  trustTier: null,
  assetClass: "crypto" as string | null,
  ingestSource: "csv" as const,
};
const TRADITIONAL = { ...STRATEGY, assetClass: "traditional" };

function build(strategy: typeof STRATEGY, rows: DailyReturn[], benchmarkPrices: BenchmarkPricesOpt) {
  const p = buildFactsheetPayload(strategy, rows, { benchmarkPrices });
  if (!p) throw new Error("fixture must build");
  return p;
}
/** The factsheet's own number to the helper's number: a ratio that does not exist is NaN there and null here. */
const fin = (v: number) => (Number.isFinite(v) ? v : null);
/** Paired intervals as the builder's own alignment counts them. */
function pairedCount(dates: string[], b: BenchmarkPricesOpt): number {
  if ("unavailable" in b) return 0;
  return alignCoveredReturns(b.prices, b.dropped, dates, COMPARATOR_CALENDARS.btc).paired.filter(Boolean).length;
}

describe("computeV2Joint equals the factsheet builder's BTC joint (D-07)", () => {
  it("crypto strategy, 2026-01-01..2026-09-20, BTC covering the span: alpha, beta, corr, IR, Treynor are toBe-equal", () => {
    const rows = strategyRows(days("2026-01-01", "2026-09-20"));
    const prices = opt(closes("2025-12-31", "2026-09-20", 99));
    const j = build(STRATEGY, rows, prices).comparators.btc.joint!;
    const got = computeV2Joint(rows, prices, "crypto");
    expect(got.values.alpha).toBe(fin(j.alpha));
    expect(got.values.beta).toBe(fin(j.beta));
    expect(got.values.correlation).toBe(fin(j.corr));
    expect(got.values.ir).toBe(fin(j.info_ratio));
    expect(got.values.treynor).toBe(fin(j.treynor));
    expect(got.status.kind).toBe("computed");
  });

  it("traditional asset class (252 periods) on weekday rows: same toBe equality", () => {
    const rows = strategyRows(weekdays("2026-01-01", "2026-09-18"), 777);
    const prices = opt(closes("2025-12-31", "2026-09-20", 31));
    const j = build(TRADITIONAL, rows, prices).comparators.btc.joint!;
    const got = computeV2Joint(rows, prices, "traditional");
    expect(got.values.alpha).toBe(fin(j.alpha));
    expect(got.values.beta).toBe(fin(j.beta));
    expect(got.values.correlation).toBe(fin(j.corr));
    expect(got.values.ir).toBe(fin(j.info_ratio));
    expect(got.values.treynor).toBe(fin(j.treynor));
    expect(got.status.kind).toBe("computed");
  });

  it("the asset class moves the figures (252 vs 365), so the parity above is not vacuous", () => {
    const rows = strategyRows(days("2026-01-01", "2026-09-20"));
    const prices = opt(closes("2025-12-31", "2026-09-20", 99));
    const crypto = computeV2Joint(rows, prices, "crypto").values;
    const trad = computeV2Joint(rows, prices, "traditional").values;
    expect(crypto.alpha).not.toBe(trad.alpha);
  });

  it("BTC closes ending before the strategy (partial coverage): toBe-equal figures and the same paired count as the builder's flags", () => {
    const dates = days("2026-01-01", "2026-09-20");
    const rows = strategyRows(dates, 4242);
    const prices = opt(closes("2025-12-31", "2026-07-15", 7));
    const payload = build(STRATEGY, rows, prices);
    const j = payload.comparators.btc.joint!;
    const got = computeV2Joint(rows, prices, "crypto");
    expect(got.values.alpha).toBe(fin(j.alpha));
    expect(got.values.beta).toBe(fin(j.beta));
    expect(got.values.correlation).toBe(fin(j.corr));
    expect(got.values.ir).toBe(fin(j.info_ratio));
    expect(got.values.treynor).toBe(fin(j.treynor));
    expect(got.status.kind).toBe("computed");
    if (got.status.kind !== "computed") return;
    expect(got.status.paired).toBe(pairedCount(payload.dates, prices));
    expect(got.status.paired).toBeLessThan(dates.length);
  });

  it("below the paired floor: 9 paired -> below_floor 9/10, five nulls, and the builder withholds the same", () => {
    const rows = strategyRows(days("2026-01-01", "2026-01-20"));
    const prices = opt(closes("2025-12-31", "2026-01-09", 5));
    const block = build(STRATEGY, rows, prices).comparators.btc;
    expect(block.jointWithheld).toEqual({ paired: 9, floor: 10 });
    expect(block.joint).toBeNull();
    const got = computeV2Joint(rows, prices, "crypto");
    expect(got.status).toEqual({ kind: "below_floor", paired: 9, floor: 10 });
    expect(got.values).toEqual({ alpha: null, beta: null, correlation: null, ir: null, treynor: null });
  });

  it("benchmark prices unavailable: benchmark_unavailable, five nulls, and the builder's BTC block has no joint", () => {
    const rows = strategyRows(days("2026-01-01", "2026-03-01"));
    const prices: BenchmarkPricesOpt = { unavailable: true };
    expect(build(STRATEGY, rows, prices).comparators.btc.joint).toBeNull();
    const got = computeV2Joint(rows, prices, "crypto");
    expect(got.status).toEqual({ kind: "benchmark_unavailable" });
    expect(got.values).toEqual({ alpha: null, beta: null, correlation: null, ir: null, treynor: null });
  });

  it("a flat strategy leg: computed with flatLeg true, and every figure is the builder's, a NaN as null and never 0", () => {
    const dates = days("2026-01-01", "2026-04-30");
    const rows = dates.map((date) => ({ date, value: 0 }));
    const prices = opt(closes("2025-12-31", "2026-04-30", 99));
    const j = build(STRATEGY, rows, prices).comparators.btc.joint!;
    const got = computeV2Joint(rows, prices, "crypto");
    expect(got.status.kind).toBe("computed");
    if (got.status.kind !== "computed") return;
    expect(got.status.flatLeg).toBe(true);
    // The undefined ratios exist as NaN in the factsheet's joint ...
    expect(Number.isNaN(j.corr)).toBe(true);
    // ... and leave the helper as null, never as a substituted 0.
    expect(got.values.correlation).toBeNull();
    expect(got.values.alpha).toBe(fin(j.alpha));
    expect(got.values.beta).toBe(fin(j.beta));
    expect(got.values.ir).toBe(fin(j.info_ratio));
    expect(got.values.treynor).toBe(fin(j.treynor));
  });

  it("a moving strategy leg is not flat", () => {
    const rows = strategyRows(days("2026-01-01", "2026-04-30"));
    const prices = opt(closes("2025-12-31", "2026-04-30", 99));
    const got = computeV2Joint(rows, prices, "crypto");
    expect(got.status.kind === "computed" && got.status.flatLeg).toBe(false);
  });
});
