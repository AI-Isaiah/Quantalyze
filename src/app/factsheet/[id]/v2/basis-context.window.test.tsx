import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { useEffect } from "react";
import { buildFactsheetPayload, deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import { compute } from "@/lib/factsheet/compute";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import {
  BasisProvider,
  useBasis,
  useBasisSeriesView,
  useWindowedView,
  resolveRangeScope,
  windowView,
  WINDOW_FOLLOW_FIELDS,
  type Basis,
  type RangeScope,
  type WindowedView,
} from "./basis-context";

/**
 * Phase 169.1 plan 02 (SC10, D-27) — the zoom window drives the KPIs through ONE
 * windowed view. These cases pin the pure pieces (`resolveRangeScope`,
 * `windowView`) and the hook's by-reference full-history arm.
 *
 * Why each matters:
 *   - the full / selected decision is what labels the numbers; a wrong "full"
 *     shows window figures under "Full history" and the reverse (T-169-43);
 *   - the window figures must be the shared bundle's figures for the slice
 *     (compute() / jointMetrics), never a stored full-record scalar (D-25, D-27);
 *   - a window the page cannot annualize must withhold EVERY field it would
 *     otherwise show, or a full-history figure reads as the range's (W1);
 *   - at full history the view must be the SAME object, so a reset restores the
 *     stored values exactly (D-10 overlay, D-25 re-pin).
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
});

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const STRATEGY = {
  id: "s-169-1-02-window",
  name: "Window Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const START = "2024-01-01";

/** A 400-day crypto record with BTC closes covering every interval. */
function build400(): FactsheetPayload {
  const n = 400;
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({
    date: addDays(START, i),
    value: 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004,
  }));
  const btc: DailyPrice[] = Array.from({ length: n + 1 }, (_, i) => ({
    date: addDays(START, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt });
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

function datesView(n: number, start = START): FactsheetPayload {
  return { dates: Array.from({ length: n }, (_, i) => addDays(start, i)) } as unknown as FactsheetPayload;
}

describe("resolveRangeScope — full history vs a selected range (D-27, W3)", () => {
  it("[0, cashLen-1] is full under cash, under a longer MTM axis and under a shorter one", () => {
    const cashLen = 300;
    for (const viewLen of [300, 360, 240]) {
      const view = datesView(viewLen);
      const s = resolveRangeScope([0, cashLen - 1], cashLen, view);
      expect(s.kind, `viewLen ${viewLen}`).toBe("full");
      // A full scope names the VIEW's first and last dates (W3), never the
      // date at the cash-sized reset index.
      expect(s.start).toBe(view.dates[0]);
      expect(s.end).toBe(view.dates[viewLen - 1]);
      expect(s.n).toBe(viewLen);
    }
  });

  it("[0, viewLen-1] is full", () => {
    const view = datesView(360);
    expect(resolveRangeScope([0, 359], 300, view).kind).toBe("full");
    const shorter = datesView(240);
    expect(resolveRangeScope([0, 239], 300, shorter).kind).toBe("full");
  });

  it("a range starting after 0, or ending before the shorter axis end, is selected with the clamped dates and count", () => {
    const view = datesView(400);
    const a = resolveRangeScope([100, 299], 400, view);
    expect(a).toMatchObject({ kind: "selected", start: view.dates[100], end: view.dates[299], n: 200, startIdx: 100, endIdx: 299 });
    const b = resolveRangeScope([0, 398], 400, view);
    expect(b.kind).toBe("selected");
    expect(b.n).toBe(399);
    const c = resolveRangeScope([1, 399], 400, view);
    expect(c.kind).toBe("selected");
    // A crafted range past the axis clamps to it (T-169-44).
    const d = resolveRangeScope([350, 9999], 300, datesView(360));
    expect(d).toMatchObject({ kind: "selected", startIdx: 350, endIdx: 359, n: 10 });
  });
});

describe("windowView — the slice's figures come from the shared bundle (D-25, D-27)", () => {
  it("over [100, 299] strategyMetrics == compute(slice) and the BTC joint == the bundle's jointMetrics on the slice", () => {
    const base = build400();
    // A distinctive stored cash headline: no window figure may come from it.
    const withStored = {
      ...base,
      metricsByBasis: { cash_settlement: { sharpe: 9.87, sortino: 8.76, cagr: 7.65, cumulative_return: 6.54 } },
    } as unknown as FactsheetPayload;
    const w = windowView(withStored, 100, 299);
    const rets = base.strategyReturns.slice(100, 300);
    const dates = base.dates.slice(100, 300);
    const { eq: _eq, dd: _dd, ...expected } = compute(rets, dates, 0, base.periodsPerYear!);
    expect(w.withheld).toBeUndefined();
    expect(w.strategyMetrics).toEqual(expected);
    expect(w.strategyMetrics.sharpe).not.toBe(9.87);
    expect(w.dates).toEqual(dates);
    expect(w.strategyReturns).toEqual(rets);

    const bundle = deriveSeriesBundle(
      rets.map((value, i) => ({ date: dates[i], value })),
      {
        periodsPerYear: base.periodsPerYear!,
        isArithmetic: false,
        markets: base.markets,
        strategyName: base.strategyName,
        missingSegments: base.missingSegments,
        benchmarkPrices: base.benchmarkPrices ?? { unavailable: true },
      },
    );
    expect(base.comparators.btc.joint, "fixture: the full record has a BTC joint").not.toBeNull();
    expect(w.comparators.btc.joint).toEqual(bundle.comparators.btc.joint);
    expect(w.comparators.btc.summary).toEqual(bundle.comparators.btc.summary);
    expect(w.comparators.btc.joint).not.toEqual(base.comparators.btc.joint);

    // Fields outside the follow-list stay the base view's, by reference.
    expect(w.correlations).toBe(withStored.correlations);
    expect(w.correlationMatrix).toBe(withStored.correlationMatrix);
    expect(w.styleDrift).toBe(withStored.styleDrift);
    expect(w.strategyRollingSharpe).toBe(withStored.strategyRollingSharpe);
  });

  it("a 1-point slice withholds: every numeric scalar but n is NaN, comparators carry no summary or joint, nothing throws", () => {
    const base = build400();
    const w = windowView(base, 150, 150);
    expect(w.withheld).toBe("short-slice");
    expect(w.strategyMetrics.n).toBe(1);
    for (const [k, v] of Object.entries(w.strategyMetrics)) {
      if (k === "n") continue;
      if (typeof v === "number") expect(Number.isNaN(v), `strategyMetrics.${k}`).toBe(true);
    }
    for (const key of ["btc", "spx", "none"] as const) {
      expect(w.comparators[key].summary).toBeNull();
      expect(w.comparators[key].joint).toBeNull();
      expect(w.comparators[key].jointWithheld ?? null).toBeNull();
    }
  });

  // Plan-check round 1 W1: iterate the exported constant, so a field added to the
  // follow-list later is covered without a new assertion.
  it.each([
    ["short-slice", (b: FactsheetPayload) => windowView(b, 150, 150)],
    [
      "no-annualization-basis",
      (b: FactsheetPayload) => {
        const noBasis = { ...b } as Record<string, unknown>;
        delete noBasis.periodsPerYear;
        return windowView(noBasis as unknown as FactsheetPayload, 100, 299);
      },
    ],
  ] as const)("the %s withheld form replaces EVERY follow-list field", (cause, make) => {
    const base = build400();
    const w: WindowedView = make(base);
    expect(w.withheld).toBe(cause);
    for (const field of WINDOW_FOLLOW_FIELDS) {
      expect(w[field], `${field} must not be the base object`).not.toBe(base[field]);
      expect(w[field], `${field} must not deep-equal the base value`).not.toEqual(base[field]);
    }
    const [s, e] = cause === "short-slice" ? [150, 150] : [100, 299];
    // dates / returns: the window's own (no annualization needed).
    expect(w.dates).toEqual(base.dates.slice(s, e + 1));
    expect(w.strategyReturns).toEqual(base.strategyReturns.slice(s, e + 1));
    expect(w.strategyEquity).toEqual([]);
    expect(w.strategyDrawdowns).toEqual([]);
    expect(w.strategyWorst10).toEqual([]);
    // strategyMetrics: NaN scalars, the window's count and dates (the rail's
    // Start / End Date rows read start / end off this object).
    expect(w.strategyMetrics.n).toBe(e - s + 1);
    expect(w.strategyMetrics.start).toBe(base.dates[s]);
    expect(w.strategyMetrics.end).toBe(base.dates[e]);
    for (const k of ["cum_ret", "cagr", "ann_vol", "sharpe", "sortino", "calmar", "max_dd", "longest_dd", "years"] as const) {
      expect(Number.isNaN(w.strategyMetrics[k]), `strategyMetrics.${k}`).toBe(true);
    }
    for (const v of Object.values(w.quantiles)) expect(Number.isNaN(v)).toBe(true);
    for (const k of ["sharpe", "sortino", "max_dd"] as const) {
      expect(Number.isNaN(w.bootstrapCI[k].point)).toBe(true);
      expect(Number.isNaN(w.bootstrapCI[k].lo)).toBe(true);
      expect(Number.isNaN(w.bootstrapCI[k].hi)).toBe(true);
      expect(w.bootstrapCI[k].hist.bins).toEqual([]);
    }
    expect(w.bootstrapCI.sharpe.n_valid).toBe(0);
    expect(w.bootstrapCI.n_resamples).toBe(0);
    expect(w.bootstrapCI.block_len).toBe(0);
    expect(w.bootstrapCI.n).toBe(e - s + 1);
    for (const key of ["btc", "spx", "none"] as const) {
      expect(w.comparators[key].summary).toBeNull();
      expect(w.comparators[key].joint).toBeNull();
      expect(w.comparators[key].jointWithheld).toBeNull();
    }
  });
});

type ProbeRead = { base: FactsheetPayload; view: WindowedView; scope: RangeScope };
const reads: ProbeRead[] = [];
/** The latest render's read (renders push, so the module binding is never reassigned). */
const latest = (): ProbeRead => reads[reads.length - 1];

function Probe({ payload, basisTo }: { payload: FactsheetPayload; basisTo?: Basis }) {
  const base = useBasisSeriesView(payload);
  const { view, scope } = useWindowedView(payload);
  const { setXRange, resetXRange } = useXRange();
  const { setBasis } = useBasis();
  useEffect(() => {
    if (basisTo) setBasis(basisTo);
  }, [basisTo, setBasis]);
  reads.push({ base, view, scope });
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange([100, 299] as const)}>zoom</button>
      <button data-testid="reset" onClick={() => resetXRange()}>reset</button>
    </>
  );
}

function mountProbe(payload: FactsheetPayload, basisTo?: Basis) {
  reads.length = 0;
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <Probe payload={payload} basisTo={basisTo} />
      </BasisProvider>
    </FactsheetProvider>,
  );
}

describe("useWindowedView — the full-history arm is the base view BY REFERENCE (D-27)", () => {
  it("returns the same object useBasisSeriesView returns at the full range, a windowed view when zoomed, and the same object again after reset", async () => {
    const payload = build400();
    const { getByTestId } = mountProbe(payload);
    expect(latest().scope.kind).toBe("full");
    expect(latest().view).toBe(latest().base);
    expect(latest().view).toBe(payload);

    await act(async () => {
      fireEvent.click(getByTestId("zoom"));
    });
    expect(latest().scope).toMatchObject({ kind: "selected", startIdx: 100, endIdx: 299 });
    expect(latest().view).not.toBe(payload);
    expect(latest().view.strategyMetrics.n).toBe(200);

    await act(async () => {
      fireEvent.click(getByTestId("reset"));
    });
    expect(latest().scope.kind).toBe("full");
    expect(latest().view).toBe(payload);
  });

  it("on an MTM axis longer than cash, the reset range is full and names the MTM view's first and last dates (W3)", async () => {
    const cash = build400();
    const mtmLen = 430;
    const mtmRows: DailyReturn[] = Array.from({ length: mtmLen }, (_, i) => ({
      date: addDays(START, i),
      value: 0.0007 + Math.sin(i * 0.29) * 0.011,
    }));
    const mtmBundle = deriveSeriesBundle(mtmRows, {
      periodsPerYear: cash.periodsPerYear!,
      isArithmetic: false,
      markets: cash.markets,
      strategyName: cash.strategyName,
      benchmarkPrices: { unavailable: true },
    });
    const payload = { ...cash, seriesByBasis: { mark_to_market: mtmBundle } } as FactsheetPayload;
    mountProbe(payload, "mark_to_market");
    await act(async () => {});
    expect(latest().base.dates.length).toBe(mtmLen);
    expect(latest().scope.kind).toBe("full");
    expect(latest().scope.start).toBe(mtmRows[0].date);
    expect(latest().scope.end).toBe(mtmRows[mtmLen - 1].date);
    expect(latest().scope.end).not.toBe(mtmRows[cash.dates.length - 1].date);
    // Under MTM each hook instance builds its own Layer-1 merge object, so the
    // probe's separate useBasisSeriesView call is a different (equal) object; the
    // full arm returns the hook's own base, never a windowed derive.
    expect(latest().view.withheld).toBeUndefined();
    expect(latest().view).toEqual(latest().base);
  });
});
