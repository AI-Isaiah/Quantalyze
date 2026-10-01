import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";

import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt, BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { arithmeticUnderwater, compute } from "@/lib/factsheet/compute";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { pct, pctSigned, ratio as num } from "./format";

/**
 * Phase 169.1 plan 03 (SC10, D-27 as amended, D-28, D-30) — the zoom window
 * follows the strategy's OWN conventions.
 *
 * Plan 169.1-02 re-derived a selected range with `isArithmetic: false` and on
 * the calendar day basis whatever the strategy was computed under, because the
 * payload carried neither convention. So on a composite stored with ARITHMETIC
 * compounding the window's Cum. Return and CAGR were geometric beside an
 * arithmetic equity chart (the window's return was not the rise the chart drew),
 * and on an ACTIVE-day-basis strategy the window's vol, Sharpe and Sortino were
 * diluted by the zero days the engine excludes. The founder chose to fix it here
 * ("Fix it in plan 14 (Recommended)", 2026-09-26).
 *
 * The strip is rendered through the REAL FactsheetBody inside the REAL
 * FactsheetProvider, and the range is driven by the same `setXRange` /
 * `resetXRange` the MasterBrush and "Reset view" use.
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
  id: "s-169-1-03-arith",
  name: "Window Conventions Composite",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const START = "2024-01-01";
const N = 400;
const LO = 100;
const HI = 299;

const stratValue = (i: number) => 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004;

/**
 * 20 calendar days are ABSENT, all inside the window: one before each of the
 * observations 111, 120, ..., 282. The calendar-day count from date 100 to date
 * 299 inclusive is therefore 220, not the window's 200 observations, so a CAGR
 * annualized over the calendar days is told apart from one over observations.
 */
const GAP_BEFORE = new Set(Array.from({ length: 20 }, (_, k) => 111 + 9 * k));
function datesFor(gapped: boolean): string[] {
  const out: string[] = [];
  let offset = 0;
  for (let i = 0; i < N; i++) {
    if (gapped && GAP_BEFORE.has(i)) offset += 1;
    out.push(addDays(START, i + offset));
  }
  return out;
}

/** 30 zero-return days, all inside the window (105, 111, ..., 279). */
const ZERO_AT = new Set(Array.from({ length: 30 }, (_, k) => 105 + 6 * k));

/** The persisted full-record headline, distinct from any computed value. */
const STORED_CASH = {
  cumulative_return: 0.4321,
  cagr: 0.3456,
  sharpe: 3.21,
  sortino: 4.32,
  calmar: 5.43,
  max_drawdown: -0.0654,
  volatility: 0.0987,
};

function buildComposite(
  { gapped = true, zeros = false }: { gapped?: boolean; zeros?: boolean },
  opts: Partial<BuildFactsheetOpts> = {},
): FactsheetPayload {
  const dates = datesFor(gapped);
  const rows: DailyReturn[] = dates.map((date, i) => ({
    date,
    value: zeros && ZERO_AT.has(i) ? 0 : stratValue(i),
  }));
  const last = dates[dates.length - 1];
  const span = Math.round((Date.parse(last) - Date.parse(START)) / DAY);
  const btc: DailyPrice[] = Array.from({ length: span + 2 }, (_, i) => ({
    date: addDays(START, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const benchmarkPrices: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, {
    benchmarkPrices,
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: STORED_CASH },
    ...opts,
  } as BuildFactsheetOpts);
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

function RangeHarness({ range = [LO, HI] as const }: { range?: readonly [number, number] }) {
  const { setXRange, resetXRange } = useXRange();
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>
      <button data-testid="reset" onClick={() => resetXRange()}>reset</button>
    </>
  );
}

function mount(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness />
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

function stripCells(): Record<string, string> {
  const labels = screen.getAllByTestId("factsheet-kpi-label");
  const values = screen.getAllByTestId("factsheet-kpi-value");
  const out: Record<string, string> = {};
  labels.forEach((l, i) => {
    out[l.textContent ?? ""] = values[i].textContent ?? "";
  });
  return out;
}

/** The text of the cells in the rail row whose first cell is `label`, in the panel titled `title`. */
function railRow(title: string, label: string): string[] {
  const h = [...document.querySelectorAll("h3")].find((el) => el.textContent === title);
  const p = h?.closest("section");
  if (!p) throw new Error(`no panel titled "${title}"`);
  const tr = [...p.querySelectorAll("tr")].find((r) => r.querySelector("td")?.textContent === label);
  if (!tr) throw new Error(`no row "${label}" in "${title}"`);
  return [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "");
}

// MetricsColumn's own number rendering (two decimals).
const railPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "—");
const railNum = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—");

const SEVEN = ["Cum. Return", "CAGR", "Sharpe", "Sortino", "Calmar", "Max DD", "Ann. Vol"] as const;

function expectedSeven(m: {
  cum_ret: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  max_dd: number;
  ann_vol: number;
}): Record<(typeof SEVEN)[number], string> {
  return {
    "Cum. Return": pctSigned(m.cum_ret, 1),
    CAGR: pctSigned(m.cagr, 1),
    Sharpe: num(m.sharpe),
    Sortino: num(m.sortino),
    Calmar: num(m.calmar),
    "Max DD": pct(m.max_dd, 1),
    "Ann. Vol": pct(m.ann_vol, 1),
  };
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const calendarDaysInclusive = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;

describe("an arithmetic composite's selected range shows the arithmetic figures its chart draws (SC10, D-27 as amended, D-28)", () => {
  it("Cum. Return is the sum of the window's returns, the rise the arithmetic equity chart draws across the window", async () => {
    const payload = buildComposite({}, { cumulativeMethod: "arithmetic" });
    const slice = payload.strategyReturns.slice(LO, HI + 1);
    // The window's arithmetic return IS the rise of the full-history arithmetic
    // equity curve across the window: that is what the chart shows the user.
    expect(sum(slice)).toBeCloseTo(payload.strategyEquity[HI] - payload.strategyEquity[LO - 1], 12);

    mount(payload);
    await click("zoom");
    expect(stripCells()["Cum. Return"]).toBe(pctSigned(sum(slice), 1));
  });

  it("CAGR is the window's sum over its CALENDAR days times periodsPerYear; Max DD is the window's own arithmetic underwater; Calmar is their ratio", async () => {
    const payload = buildComposite({}, { cumulativeMethod: "arithmetic" });
    const slice = payload.strategyReturns.slice(LO, HI + 1);
    const days = calendarDaysInclusive(payload.dates[LO], payload.dates[HI]);
    expect(days).toBe(220); // the fixture's 20 absent days are inside the window
    const cagr = (sum(slice) / days) * payload.periodsPerYear!;
    // Re-seeded at the window's first day, as the windowed drawdown chart is.
    const maxDd = Math.min(...arithmeticUnderwater(slice));

    mount(payload);
    await click("zoom");
    const cells = stripCells();
    expect(cells.CAGR).toBe(pctSigned(cagr, 1));
    expect(cells["Max DD"]).toBe(pct(maxDd, 1));
    expect(cells.Calmar).toBe(num(cagr / Math.abs(maxDd)));
  });

  it("compounding does not touch Sharpe, Sortino or Ann. Vol: the arithmetic and geometric builds of the same composite show the same windowed values", async () => {
    // D-32: on this GAPPED composite the engine's windowed Sharpe is that of the
    // zero-filled calendar series, which plan 169.1-06 pins red-first. No value is
    // pinned here; only the method-invariance, which is engine-true.
    const read = async (opts: Partial<BuildFactsheetOpts>) => {
      const view = mount(buildComposite({}, opts));
      await click("zoom");
      const c = stripCells();
      view.unmount();
      return [c.Sharpe, c.Sortino, c["Ann. Vol"]];
    };
    expect(await read({ cumulativeMethod: "arithmetic" })).toEqual(await read({}));
  });

  it("on a GAPLESS arithmetic composite the windowed Sharpe, Sortino and Ann. Vol are compute() of the slice (zero-filling a gapless series is the identity)", async () => {
    const payload = buildComposite({ gapped: false }, { cumulativeMethod: "arithmetic" });
    const m = compute(
      payload.strategyReturns.slice(LO, HI + 1),
      payload.dates.slice(LO, HI + 1),
      0,
      payload.periodsPerYear!,
    );
    mount(payload);
    await click("zoom");
    const cells = stripCells();
    const want = expectedSeven(m);
    expect(cells.Sharpe).toBe(want.Sharpe);
    expect(cells.Sortino).toBe(want.Sortino);
    expect(cells["Ann. Vol"]).toBe(want["Ann. Vol"]);
  });

  it("a reset returns every strip cell to its pre-zoom text, the persisted cash_settlement scalars", async () => {
    const payload = buildComposite({}, { cumulativeMethod: "arithmetic" });
    mount(payload);
    const before = stripCells();
    expect(before.Sharpe).toBe("3.21");
    expect(before["Cum. Return"]).toBe(pctSigned(STORED_CASH.cumulative_return, 1));
    await click("zoom");
    expect(stripCells()).not.toEqual(before);
    await click("reset");
    expect(stripCells()).toEqual(before);
  });
});

describe("an active-day-basis strategy's selected range excludes the zero days the engine excludes (D-30, D-36)", () => {
  const P_OPTS = { cumulativeMethod: "arithmetic", dayBasis: "active" } as Partial<BuildFactsheetOpts>;

  it("Ann. Vol, Sharpe and Sortino are compute() of the window's NON-ZERO returns; CAGR is their mean times periodsPerYear", async () => {
    const payload = buildComposite({ zeros: true }, P_OPTS);
    const slice = payload.strategyReturns.slice(LO, HI + 1);
    const sliceDates = payload.dates.slice(LO, HI + 1);
    const keep = slice.map((r) => r !== 0);
    const active = slice.filter((_, i) => keep[i]);
    expect(active.length).toBe(170); // the fixture's 30 zero days are inside the window
    const am = compute(active, sliceDates.filter((_, i) => keep[i]), 0, payload.periodsPerYear!);
    const cagr = (sum(active) / active.length) * payload.periodsPerYear!;

    mount(payload);
    await click("zoom");
    const cells = stripCells();
    const want = expectedSeven(am);
    expect(cells["Ann. Vol"]).toBe(want["Ann. Vol"]);
    expect(cells.Sharpe).toBe(want.Sharpe);
    expect(cells.Sortino).toBe(want.Sortino);
    expect(cells.CAGR).toBe(pctSigned(cagr, 1));
  });

  it("Win Rate and Profit Factor (and skew, kurtosis, VaR, CVaR in compute()) keep ALL the window's returns, zero days included, as the engine's do (D-36, W2)", async () => {
    const payload = buildComposite({ zeros: true }, P_OPTS);
    const slice = payload.strategyReturns.slice(LO, HI + 1);
    const sliceDates = payload.dates.slice(LO, HI + 1);
    const plain = compute(slice, sliceDates, 0, payload.periodsPerYear!);

    mount(payload);
    await click("zoom");
    expect(railRow("Returns", "Win Rate (days)")[1]).toBe(railPct(plain.win_rate));
    expect(railRow("Returns", "Profit Factor")[1]).toBe(railNum(plain.profit_factor));

    const conv = { cumulativeMethod: "arithmetic", dayBasis: "active", calendarDense: true } as const;
    const withConv = (compute as (...a: unknown[]) => ReturnType<typeof compute>)(
      slice,
      sliceDates,
      0,
      payload.periodsPerYear!,
      conv,
    );
    for (const k of ["skew", "kurt", "var95", "cvar95", "win_rate", "profit_factor"] as const) {
      expect(withConv[k], k).toBe(plain[k]);
    }
  });
});

describe("a payload without conventions is unchanged (D-28)", () => {
  it("the same composite built WITHOUT conventions shows the geometric compute() of the slice in every windowed cell", async () => {
    // GAPLESS (plan 169.1-06, D-32): on a gapped composite the engine's windowed
    // Ann. Vol, Sharpe and Sortino are those of the zero-filled calendar series,
    // pinned in basis-context.window-density.test.tsx; zero-filling a gapless
    // series is the identity, so every cell here is compute() of the slice.
    const payload = buildComposite({ gapped: false });
    const m = compute(
      payload.strategyReturns.slice(LO, HI + 1),
      payload.dates.slice(LO, HI + 1),
      0,
      payload.periodsPerYear!,
    );
    mount(payload);
    await click("zoom");
    const cells = stripCells();
    const want = expectedSeven(m);
    for (const label of SEVEN) expect(cells[label], label).toBe(want[label]);
  });
});

describe("the payload carries a convention only when it is not the default (D-27 as amended, D-30, D-83 (b))", () => {
  it("arithmetic + active carries both keys", () => {
    const p = buildComposite({}, { cumulativeMethod: "arithmetic", dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    expect((p as { cumulativeMethod?: string }).cumulativeMethod).toBe("arithmetic");
    expect((p as { dayBasis?: string }).dayBasis).toBe("active");
  });

  it("no opts, and geometric + calendar, carry neither key", () => {
    for (const p of [
      buildComposite({}),
      buildComposite({}, { cumulativeMethod: "geometric", dayBasis: "calendar" } as Partial<BuildFactsheetOpts>),
    ]) {
      expect("cumulativeMethod" in p).toBe(false);
      expect("dayBasis" in p).toBe(false);
    }
  });
});
