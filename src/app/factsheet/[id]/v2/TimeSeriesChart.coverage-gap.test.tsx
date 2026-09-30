/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { BenchmarkPricesOpt, DailyPrice, DailyReturn } from "@/lib/factsheet/types";
import { buildFactsheetPayload, deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { alignCoveredReturns } from "@/lib/factsheet/align";
import { cumEq } from "@/lib/factsheet/compute";
import { rollingBeta } from "@/lib/factsheet/rolling";
import { CHART_CONFIGS } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 169.5 BENCHCOMPARE plan 02 Task 3 (SC3, D-09, D-21, D-58, D-59 as amended,
 * the D-60 fix, D-64): a comparator's per-day CHART series are null wherever the
 * coverage-aware helper has no return, and the chart breaks the comparator line
 * there instead of drawing a flat one. Its rolling vol / Sharpe / Sortino run over
 * each window's NON-NULL points on the smaller of the strategy's and the
 * comparator's basis, and its rolling beta over each window's PAIRED intervals.
 *
 * Every literal below was computed independently of the code under test (a
 * separate script over the same synthetic closes: population sd times the square
 * root of the basis; beta as population covariance over population variance of
 * the paired points), never read back from `rolling.ts`.
 *
 * The synthetic SPX shape (weekday closes only) reaches the builder through ONE
 * named seam: a partial mock of `@/lib/factsheet/benchmarks` that replaces
 * `SPX_DAILY` and keeps BTC_DAILY, ETH_DAILY, GLD_DAILY and IEF_DAILY real
 * (169 D-60, plan-check round 3 info). BTC reaches it through the
 * `benchmarkPrices` argument, as on the route.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/factsheet/benchmarks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/factsheet/benchmarks")>();
  // Weekday closes 2024-12-02 .. 2025-03-31: 100 + 5 sin(0.7 k) + 0.1 k.
  const spx: Array<{ date: string; close: number }> = [];
  let k = 0;
  for (let t = Date.UTC(2024, 11, 2); t <= Date.UTC(2025, 2, 31); t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    spx.push({ date: new Date(t).toISOString().slice(0, 10), close: 100 + 5 * Math.sin(0.7 * k) + 0.1 * k });
    k++;
  }
  return { ...real, SPX_DAILY: spx };
});

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(Date.parse(`${d}T00:00:00Z`) + n * DAY);
const days = (a: string, n: number) => Array.from({ length: n }, (_, i) => addDays(a, i));
function weekdays(a: string, n: number): string[] {
  const out: string[] = [];
  for (let d = a; out.length < n; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}
const stratValues = (n: number) =>
  Array.from({ length: n }, (_, i) => 0.01 * Math.sin(i * 1.1) + 0.004 * Math.cos(i * 0.37));
const rows = (dates: string[]): DailyReturn[] => {
  const v = stratValues(dates.length);
  return dates.map((date, i) => ({ date, value: v[i] }));
};
/** Synthetic 7-day BTC close for a date (days counted from 2024-12-01). */
function btcClose(d: string): number {
  const j = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.UTC(2024, 11, 1)) / DAY);
  return 50000 * (1 + 0.03 * Math.sin(j * 0.9) + 0.01 * Math.cos(j * 0.23));
}
function btcOpt(dates: string[], dropped: string[] = []): BenchmarkPricesOpt {
  const prices: DailyPrice[] = dates.filter((d) => !dropped.includes(d)).map((date) => ({ date, close: btcClose(date) }));
  return { prices, through: prices[prices.length - 1].date, dropped };
}

function bundle(clipped: DailyReturn[], periodsPerYear: number, benchmarkPrices: BenchmarkPricesOpt) {
  return deriveSeriesBundle(clipped, {
    periodsPerYear,
    isArithmetic: false,
    markets: [],
    strategyName: "Coverage Gap Fixture",
    benchmarkPrices,
  });
}

// 40 calendar days from Wednesday 2025-01-01 (a 7-day crypto strategy). With 40
// points both rolling windows fall back to 30 (pickRollingWindow).
const A_DATES = days("2025-01-01", 40);
const A_ROWS = rows(A_DATES);
const W = 30;

/** Count the path's pen-down moves: one "M" per drawn segment. */
const segments = (d: string | null) => (d ?? "").split(" ").filter((t) => t === "M").length;

describe("169.5-02 SC3 / D-09: per-day chart series are null where the helper has no return", () => {
  // BTC closes through D29 (ten days before the strategy's end), with a corrupt
  // close dropped on D15: D15 has no close and D16's interval spans the dropped one.
  const perDayOpt = () => btcOpt(days("2024-12-31", 31), [A_DATES[15]]);

  it("cumulative, cumVsBench, volMatched and the rolling series are null past `through` and across a dropped close; so is dailyReturns (169.5-04)", () => {
    const b = bundle(A_ROWS, 365, perDayOpt()).comparators.btc;
    const nullIdx = [15, 16, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39];
    for (const i of nullIdx) {
      expect(b.cumulative![i], `cumulative[${i}]`).toBeNull();
      expect(b.cumVsBench![i], `cumVsBench[${i}]`).toBeNull();
      expect(b.volMatched![i], `volMatched[${i}]`).toBeNull();
      expect(b.dailyReturns![i], `dailyReturns[${i}] (169.5-04: null, never 0)`).toBeNull();
    }
    for (const i of [30, 35, 39]) {
      expect(b.rollingVol![i]).toBeNull();
      expect(b.rollingSharpe![i]).toBeNull();
      expect(b.rollingSortino![i]).toBeNull();
      expect(b.rollingBeta![i]).toBeNull();
    }
    for (let i = 0; i < 30; i++) {
      if (i === 15 || i === 16) continue;
      expect(typeof b.cumulative![i], `cumulative[${i}]`).toBe("number");
      expect(typeof b.volMatched![i], `volMatched[${i}]`).toBe("number");
    }
    expect(typeof b.rollingVol![29]).toBe("number");
    // The level resumes from its last value after the gap (no forward-filled 0% day).
    const r17 = b.dailyReturns![17];
    if (r17 == null) throw new Error("dailyReturns[17] must carry the series value after the gap");
    expect(r17).not.toBe(0);
    expect(b.cumulative![17]).toBeCloseTo(b.cumulative![14]! * (1 + r17), 14);
    expect(b.through).toBe(A_DATES[29]);
  });

  it("full coverage: no nulls, and the arrays are exactly the compounded helper series", () => {
    const opt = btcOpt(days("2024-12-31", 41));
    const b = bundle(A_ROWS, 365, opt).comparators.btc;
    const helper = alignCoveredReturns((opt as { prices: DailyPrice[] }).prices, [], A_DATES).returns as number[];
    expect(helper.every((r) => r != null)).toBe(true);
    expect(b.cumulative).toEqual(cumEq(helper));
    expect(b.volMatched!.every((v) => v != null)).toBe(true);
    expect(b.cumVsBench!.every((v) => v != null)).toBe(true);
  });

  it("the chart breaks the comparator line over null points; the strategy line is one segment", () => {
    const payload = buildFactsheetPayload(
      { id: "cg", name: "Coverage Gap Fixture", types: [], markets: [], computedAt: "x", trustTier: null, assetClass: "crypto" },
      A_ROWS,
      { benchmarkPrices: perDayOpt() },
    )!;
    expect(payload.activeComparator).toBe("btc");
    const cfg = CHART_CONFIGS.find((c) => c.key === "cumulative")!;
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <TimeSeriesChart config={cfg} />
      </FactsheetProvider>,
    );
    const paths = Array.from(container.querySelectorAll("path[stroke]"));
    const cmpPath = paths.find((p) => (p.getAttribute("stroke") ?? "").includes("--color-text-muted"));
    const stratPath = paths.find((p) => (p.getAttribute("stroke") ?? "").includes("--color-accent"));
    expect(cmpPath, "comparator path").toBeDefined();
    expect(stratPath, "strategy path").toBeDefined();
    // Indices 0..14 and 17..29 are drawn; 15, 16 and 30..39 are gaps.
    expect(segments(cmpPath!.getAttribute("d"))).toBe(2);
    expect(segments(stratPath!.getAttribute("d"))).toBe(1);
  });
});

describe("169.5-02 D-59 (as amended): comparator rolling series on the smaller basis, over non-null window points", () => {
  it("a 7-day strategy against weekday SPX closes: literal rolling vol on the square root of 252, weekend null, day one inside the first window", () => {
    const spx = bundle(A_ROWS, 365, btcOpt(days("2024-12-31", 41))).comparators.spx;
    // 2025-02-06, a Thursday: 22 non-null points in its window.
    expect(spx.rollingVol![36]).toBeCloseTo(0.36895410296812775, 12);
    // 2025-01-30: the window 0..29 holds index 0, day one's own SPX return (D-64).
    expect(spx.rollingVol![29]).toBeCloseTo(0.37097644493599624, 12);
    expect(spx.rollingVol![38]).toBeNull(); // Saturday 2025-02-08
    expect(spx.rollingSharpe![38]).toBeNull();
    expect(spx.rollingSortino![38]).toBeNull();
  });

  it("BTC on a crypto strategy annualizes on the square root of 365 (literal)", () => {
    const btc = bundle(A_ROWS, 365, btcOpt(days("2024-12-31", 41))).comparators.btc;
    expect(btc.rollingVol![36]).toBeCloseTo(0.36029285397447514, 12);
  });

  it("BTC against a weekday strategy annualizes on the square root of 252, the smaller basis (literal)", () => {
    const dates = weekdays("2025-01-02", 40);
    const opt = btcOpt(days("2025-01-01", 57)); // every day 2025-01-01 .. 2025-02-26
    const btc = bundle(rows(dates), 252, opt).comparators.btc;
    expect(btc.rollingVol![39]).toBeCloseTo(0.4820765121931783, 12);
  });
});

describe("169.5-02 D-60 fix and D-64: comparator rolling beta over PAIRED intervals only", () => {
  it("a 7-day strategy against weekday SPX closes: literal beta over the paired indices; weekend and Monday null", () => {
    const spx = bundle(A_ROWS, 365, btcOpt(days("2024-12-31", 41))).comparators.spx;
    expect(spx.rollingBeta![36]).toBeCloseTo(0.04095991550475073, 12); // 18 paired points
    // The window 0..29 holds index 0, paired on day one (D-64).
    expect(spx.rollingBeta![29]).toBeCloseTo(-0.05928839938210734, 12);
    expect(spx.rollingBeta![38]).toBeNull(); // Saturday
    expect(spx.rollingBeta![39]).toBeNull(); // Sunday
    expect(spx.rollingBeta![33]).toBeNull(); // Monday 2025-02-03: Friday-to-Monday is unpaired
  });

  it("an index whose window holds fewer than 2 paired points is null", () => {
    // BTC closes missing on D5 .. D33: D34 is unpaired, D35 is the window's only paired point.
    const all = days("2024-12-31", 41).filter((d) => !(d >= A_DATES[5] && d <= A_DATES[33]));
    const opt: BenchmarkPricesOpt = { prices: all.map((date) => ({ date, close: btcClose(date) })), through: A_DATES[39], dropped: [] };
    const btc = bundle(A_ROWS, 365, opt).comparators.btc;
    expect(btc.rollingBeta![34]).toBeNull();
    expect(btc.rollingBeta![35]).toBeNull();
    expect(Number.isFinite(btc.rollingBeta![36])).toBe(true);
  });

  it("parity pin: on a dense, fully paired BTC series the beta equals rolling.ts rollingBeta over the helper's full series (index 0 = day one)", () => {
    const opt = btcOpt(days("2024-12-31", 41));
    const btc = bundle(A_ROWS, 365, opt).comparators.btc;
    const full = alignCoveredReturns((opt as { prices: DailyPrice[] }).prices, [], A_DATES);
    expect(full.paired.every(Boolean)).toBe(true);
    const ref = rollingBeta(stratValues(40), full.returns as number[], W);
    for (let i = 0; i < 40; i++) {
      if (ref[i] == null) expect(btc.rollingBeta![i]).toBeNull();
      else expect(Math.abs(btc.rollingBeta![i]! - ref[i]!)).toBeLessThan(1e-12);
    }
  });

  it("D-64 interior gap: a weekday strategy's Monday whose (Friday, Monday] interval misses BTC's Saturday is out of every beta window", () => {
    const dates = weekdays("2025-01-02", 40);
    const opt = btcOpt(
      days("2025-01-01", 57).filter((d) => d !== "2025-02-15"),
    );
    const btc = bundle(rows(dates), 252, opt).comparators.btc;
    expect(dates[32]).toBe("2025-02-17");
    expect(btc.dailyReturns![32]).not.toBe(0); // the series keeps the bridged move
    expect(btc.rollingBeta![32]).toBeNull();
    // Tuesday 2025-02-18: 29 paired points, the Monday excluded.
    expect(btc.rollingBeta![33]).toBeCloseTo(-0.0022422442797806457, 12);
  });
});
