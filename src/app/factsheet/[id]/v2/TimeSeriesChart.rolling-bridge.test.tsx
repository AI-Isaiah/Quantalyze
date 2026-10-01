/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { BenchmarkPricesOpt, DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { buildFactsheetPayload, type BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { CHART_CONFIGS, type ChartConfig } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";

/**
 * Phase 169.1 plan 09 (D-38 as narrowed by D-84, D-27): the Rolling Sharpe chart's
 * STRATEGY line is one continuous path across the days the active day basis
 * excluded.
 *
 * Why this matters: since 169.1-06 the active-basis rolling Sharpe is null on every
 * day the basis excludes (a zero-return day), exactly as the engine's. Those values
 * are right and must not change (D-27), but `buildPath` used to start a new subpath
 * after every null, so the line broke at every zero-return day and read as dozens
 * of fragments. The fix changes only the DRAWING, and only where the basis made the
 * exclusion (the `metricsBasisSeries` mask, D-84):
 *   - the leading warm-up stays a gap, and trailing nulls draw nothing;
 *   - a no-dispersion window (founder D7, null since Phase 166.2) stays a gap: no
 *     Sharpe exists there, so a line across it would show a value where none is;
 *   - the comparator line, and every other chart's line, still break at a null
 *     (Phase 169.5 plan 02 relies on the comparator breaking past `through`).
 *
 * Paths are read the way `TimeSeriesChart.coverage-gap.test.tsx` reads them: the
 * strategy line by its stroke colour, `M` counted as a path command token.
 *
 * localStorage and sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount even at persist={false}.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

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
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01";
const STRATEGY = {
  id: "s-169-1-09-bridge",
  name: "Rolling Bridge Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;

/** BTC closes on every fixture date, so the comparator block is fully covered. */
function btcOpt(dates: string[]): BenchmarkPricesOpt {
  const prices: DailyPrice[] = [addDays(dates[0], -1), ...dates].map((date, j) => ({
    date,
    close: 50000 * (1 + 0.03 * Math.sin(j * 0.9) + 0.01 * Math.cos(j * 0.23)),
  }));
  return { prices, through: prices[prices.length - 1].date, dropped: [] };
}

function build(rows: DailyReturn[], opts: Partial<BuildFactsheetOpts> = {}): FactsheetPayload {
  const dates = rows.map((r) => r.date);
  const p = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: btcOpt(dates), ...opts } as BuildFactsheetOpts);
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

const ROLLING_SHARPE = CHART_CONFIGS.find((c) => c.key === "rollingSharpe")!;

function renderPaths(payload: FactsheetPayload, config: ChartConfig) {
  const { container } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <TimeSeriesChart config={config} />
    </FactsheetProvider>,
  );
  const paths = Array.from(container.querySelectorAll("path[stroke]"));
  const byStroke = (token: string) => {
    const p = paths.find((el) => (el.getAttribute("stroke") ?? "").includes(token));
    return p ? (p.getAttribute("d") ?? "") : null;
  };
  return { byStroke };
}

/** Count the path's pen-down moves: one "M" per drawn segment. */
const segments = (d: string | null) => (d ?? "").split(" ").filter((t) => t === "M").length;
/** Every drawn point as [x, y], in path order. */
function points(d: string | null): Array<[number, number]> {
  const toks = (d ?? "").split(" ").filter(Boolean);
  const out: Array<[number, number]> = [];
  for (let i = 0; i < toks.length; i += 3) out.push([Number(toks[i + 1]), Number(toks[i + 2])]);
  return out;
}

// --- The hand-built shape (10 dates) -------------------------------------------
// Rolling Sharpe: warm-up null x3, finite, finite, null, null, finite, finite, null.
const SHAPE_SHARPE: Array<number | null> = [null, null, null, 0.8, 1.1, null, null, 1.3, 0.9, null];
const INTERIOR_NULLS = [5, 6];
const TRAILING_NULL = 9;
// The comparator's rolling Sharpe: an interior null at 5, trailing nulls 8..9 (its
// last finite index, 7, sits before the strategy's last finite index, 8).
const CMP_SHARPE: Array<number | null> = [null, null, null, 0.4, 0.5, null, 0.6, 0.7, null, null];

/**
 * A payload whose strategy rolling Sharpe is SHAPE_SHARPE. `zeroAtInteriorNulls`
 * puts a 0 return on the two interior-null days (so the active basis EXCLUDED them);
 * otherwise those days carry a non-zero return (a no-dispersion null, founder D7).
 * The trailing day is always a 0 return.
 */
function shapePayload(opts: { dayBasis?: "active"; zeroAtInteriorNulls: boolean }): FactsheetPayload {
  const rows = Array.from({ length: SHAPE_SHARPE.length }, (_, i) => ({ date: addDays(START, i), value: value(i) }));
  const base = build(rows);
  const strategyReturns = base.strategyReturns.map((r, i) =>
    i === TRAILING_NULL || (opts.zeroAtInteriorNulls && INTERIOR_NULLS.includes(i)) ? 0 : r,
  );
  for (const i of INTERIOR_NULLS) {
    if (!opts.zeroAtInteriorNulls) expect(strategyReturns[i], `return[${i}] must be non-zero`).not.toBe(0);
  }
  const btc = base.comparators.btc;
  return {
    ...base,
    ...(opts.dayBasis ? { dayBasis: opts.dayBasis } : {}),
    strategyReturns,
    strategyRollingSharpe: [...SHAPE_SHARPE],
    comparators: { ...base.comparators, btc: { ...btc, rollingSharpe: [...CMP_SHARPE] } },
  };
}

describe("169.1-09 D-38 / D-84: the active-basis rolling Sharpe line is continuous across excluded days", () => {
  it("end to end: an active-basis payload from buildFactsheetPayload with zero days after the warm-up draws ONE strategy segment", () => {
    // 300 days; from day 200 every 7th day is a 0 return. With 200 active days
    // before them, the 126-day window is warm by then, so each zero day is an
    // interior null of the active-basis rolling Sharpe.
    const rows = Array.from({ length: 300 }, (_, i) => ({
      date: addDays(START, i),
      value: i >= 200 && i % 7 === 0 ? 0 : value(i),
    }));
    const p = build(rows, { dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    expect(p.dayBasis).toBe("active");
    const rs = p.strategyRollingSharpe;
    const firstFinite = rs.findIndex((v) => v != null);
    const lastFinite = rs.length - 1 - [...rs].reverse().findIndex((v) => v != null);
    const interior = rs
      .map((v, i) => (v == null && i > firstFinite && i < lastFinite ? i : -1))
      .filter((i) => i >= 0);
    // Precondition: the fixture really has interior nulls, each on an excluded (zero) day.
    expect(interior.length).toBeGreaterThan(5);
    for (const i of interior) expect(p.strategyReturns[i], `return[${i}]`).toBe(0);
    expect(firstFinite).toBeGreaterThan(0);

    const before = [...rs];
    const { byStroke } = renderPaths(p, ROLLING_SHARPE);
    const strat = byStroke("--color-accent");
    expect(strat, "strategy path").not.toBeNull();
    expect(segments(strat)).toBe(1);
    // One drawn point per finite value: nothing is drawn at an excluded day.
    expect(points(strat)).toHaveLength(rs.filter((v) => v != null).length);
    // The chart never rewrites the engine's values (D-27).
    expect(p.strategyRollingSharpe).toBe(rs);
    expect(p.strategyRollingSharpe).toEqual(before);
  });

  it("shape: excluded interior nulls are bridged, the warm-up stays a gap and the trailing null draws nothing", () => {
    const active = shapePayload({ dayBasis: "active", zeroAtInteriorNulls: true });
    const calendar = shapePayload({ zeroAtInteriorNulls: true });
    const rsRef = active.strategyRollingSharpe;
    const a = renderPaths(active, ROLLING_SHARPE).byStroke("--color-accent");
    const c = renderPaths(calendar, ROLLING_SHARPE).byStroke("--color-accent");
    expect(segments(a)).toBe(1);
    // The same four points as the unbridged line: the bridge adds no point at the
    // warm-up, at an excluded day or at the trailing null. Only the pen changes.
    expect(points(a)).toEqual(points(c));
    expect(points(a)).toHaveLength(4);
    expect(active.strategyRollingSharpe).toBe(rsRef);
    expect(active.strategyRollingSharpe).toEqual(SHAPE_SHARPE);
  });

  it("D-84: the calendar basis excludes no day, so the same nulls stay a gap (two segments)", () => {
    const p = shapePayload({ zeroAtInteriorNulls: true });
    expect(p.dayBasis).toBeUndefined();
    expect(segments(renderPaths(p, ROLLING_SHARPE).byStroke("--color-accent"))).toBe(2);
  });

  it("D-84 / founder D7: on the active basis, a null on a NON-zero day (no dispersion) stays a gap (two segments)", () => {
    const p = shapePayload({ dayBasis: "active", zeroAtInteriorNulls: false });
    const rsRef = p.strategyRollingSharpe;
    expect(segments(renderPaths(p, ROLLING_SHARPE).byStroke("--color-accent"))).toBe(2);
    expect(p.strategyRollingSharpe).toBe(rsRef);
    expect(p.strategyRollingSharpe).toEqual(SHAPE_SHARPE);
  });

  it("scoping: the comparator line in the same chart still breaks at its interior null and draws nothing past its last finite index", () => {
    const p = shapePayload({ dayBasis: "active", zeroAtInteriorNulls: true });
    const { byStroke } = renderPaths(p, ROLLING_SHARPE);
    const cmp = byStroke("--color-text-muted");
    const strat = byStroke("--color-accent");
    expect(cmp, "comparator path").not.toBeNull();
    expect(segments(cmp)).toBe(2);
    // Comparator finite at 3, 4, 6, 7; the strategy's points sit at 3, 4, 7, 8, so the
    // strategy's third point shares the comparator's last x (index 7).
    const cmpPts = points(cmp);
    expect(cmpPts).toHaveLength(4);
    expect(cmpPts[cmpPts.length - 1][0]).toBe(points(strat)[2][0]);
  });

  it("scoping: rollingSharpe is the only chart config that opts into the bridge", () => {
    const optedIn = CHART_CONFIGS.filter((c) => (c as { bridgeBasisExcludedDays?: boolean }).bridgeBasisExcludedDays).map(
      (c) => c.key,
    );
    expect(optedIn).toEqual(["rollingSharpe"]);
  });
});
