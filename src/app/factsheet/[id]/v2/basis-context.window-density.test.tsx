import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";

import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt, BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { compute } from "@/lib/factsheet/compute";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { pct, pctSigned, ratio as num } from "./format";

/**
 * Phase 169.1 plan 06 (SC10, D-27, D-32, D-36) — a gapped composite's selected
 * range shows the ENGINE's Ann. Vol, Sharpe and Sortino.
 *
 * The engine computes a composite's headline risk statistics over the series
 * `run_stitch_composite_job` hands `compute_all_metrics`: `gap_fill_daily_returns`
 * of the stitched series (densify_policy "zero_fill"), every calendar day from
 * the first to the last, an absent day as 0.0. Until this plan the browser ran
 * them over the PRESENT days, so on a composite with interior gaps a selected
 * range's three risk cells disagreed with the engine's figure for the same days.
 *
 * The truth here is `compute()` with NO conventions over a zero-filled twin built
 * in this file, never the helper under test. The fixture is chosen so the
 * zero-filled and the present-day figures differ at the strip's precision, and
 * each case asserts both.
 *
 * Harness and fixture copied from `basis-context.window-arithmetic.test.tsx`
 * (plan 169.1-03): the REAL FactsheetBody inside the REAL FactsheetProvider, the
 * range driven by the same `setXRange` / `resetXRange` the MasterBrush uses.
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
  id: "s-169-1-06-density",
  name: "Window Density Composite",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
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
 * observations 111, 120, ..., 282. The window's 200 observations span 220
 * calendar days, so the zero-filled twin carries 20 extra 0.0 days.
 */
const GAP_BEFORE = new Set(Array.from({ length: 20 }, (_, k) => 111 + 9 * k));
const DATES = (() => {
  const out: string[] = [];
  let offset = 0;
  for (let i = 0; i < N; i++) {
    if (GAP_BEFORE.has(i)) offset += 1;
    out.push(addDays(START, i + offset));
  }
  return out;
})();

/** 30 zero-return days, all inside the window (105, 111, ..., 279), for the active case. */
const ZERO_AT = new Set(Array.from({ length: 30 }, (_, k) => 105 + 6 * k));

function build(
  { composite = true, zeros = false }: { composite?: boolean; zeros?: boolean },
  opts: Partial<BuildFactsheetOpts> = {},
): FactsheetPayload {
  const rows: DailyReturn[] = DATES.map((date, i) => ({
    date,
    value: zeros && ZERO_AT.has(i) ? 0 : stratValue(i),
  }));
  const last = DATES[DATES.length - 1];
  const span = Math.round((Date.parse(last) - Date.parse(START)) / DAY);
  const btc: DailyPrice[] = Array.from({ length: span + 2 }, (_, i) => ({
    date: addDays(START, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const benchmarkPrices: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  // No metricsByBasis: the strip's full-history cells are computed, and the
  // windowed cells are what this file reads.
  const payload = buildFactsheetPayload(STRATEGY, rows, {
    benchmarkPrices,
    ...(composite ? { dataQuality: { composite: true } } : {}),
    ...opts,
  } as BuildFactsheetOpts);
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

/** The slice [LO, HI] zero-filled onto every calendar day, built independently of compute.ts. */
function zeroFilledTwin(payload: FactsheetPayload): { rets: number[]; dates: string[] } {
  const present = new Map<string, number>();
  for (let i = LO; i <= HI; i++) present.set(payload.dates[i], payload.strategyReturns[i]);
  const rets: number[] = [];
  const dates: string[] = [];
  for (let d = payload.dates[LO]; d <= payload.dates[HI]; d = addDays(d, 1)) {
    dates.push(d);
    rets.push(present.get(d) ?? 0);
  }
  return { rets, dates };
}

function RangeHarness() {
  const { setXRange, resetXRange } = useXRange();
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange([LO, HI])}>zoom</button>
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

type Risk = { "Ann. Vol": string; Sharpe: string; Sortino: string };
const riskText = (m: { ann_vol: number; sharpe: number; sortino: number }): Risk => ({
  "Ann. Vol": pct(m.ann_vol, 1),
  Sharpe: num(m.sharpe),
  Sortino: num(m.sortino),
});
const riskCells = (c: Record<string, string>): Risk => ({
  "Ann. Vol": c["Ann. Vol"],
  Sharpe: c.Sharpe,
  Sortino: c.Sortino,
});

/** Every one of the three cells differs between the two figures, so a pass cannot be an accident of rounding. */
function expectAllThreeDiffer(a: Risk, b: Risk) {
  for (const k of ["Ann. Vol", "Sharpe", "Sortino"] as const) expect(a[k], k).not.toBe(b[k]);
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

describe("a gapped composite's selected range: Ann. Vol, Sharpe and Sortino over the zero-filled calendar series, as the engine computes them (D-32, D-27)", () => {
  for (const method of ["geometric", "arithmetic"] as const) {
    it(`calendar basis, ${method}: the three cells are compute() of the slice's zero-filled twin, not of its present days`, async () => {
      const payload = build({}, { cumulativeMethod: method });
      const twin = zeroFilledTwin(payload);
      expect(twin.rets.length).toBe(220); // 200 present + 20 absent days
      const engine = riskText(compute(twin.rets, twin.dates, 0, payload.periodsPerYear!));
      const slice = payload.strategyReturns.slice(LO, HI + 1);
      const presentDays = riskText(compute(slice, payload.dates.slice(LO, HI + 1), 0, payload.periodsPerYear!));
      expectAllThreeDiffer(engine, presentDays);

      mount(payload);
      await click("zoom");
      const cells = stripCells();
      expect(riskCells(cells)).toEqual(engine);
      if (method === "geometric") {
        // The density moves ONLY the three risk cells (D-36): the compounded
        // figures stay compute() of the present-day slice.
        const m = compute(slice, payload.dates.slice(LO, HI + 1), 0, payload.periodsPerYear!);
        expect(cells["Cum. Return"]).toBe(pctSigned(m.cum_ret, 1));
        expect(cells.CAGR).toBe(pctSigned(m.cagr, 1));
        expect(cells.Calmar).toBe(num(m.calmar));
        expect(cells["Max DD"]).toBe(pct(m.max_dd, 1));
      }
    });
  }

  it("compounding does not touch the three cells, and the arithmetic CAGR is still the slice's sum over its calendar days times periodsPerYear", async () => {
    const read = async (opts: Partial<BuildFactsheetOpts>) => {
      const view = mount(build({}, opts));
      await click("zoom");
      const c = stripCells();
      view.unmount();
      return c;
    };
    const geo = await read({});
    const ari = await read({ cumulativeMethod: "arithmetic" });
    expect(riskCells(ari)).toEqual(riskCells(geo));

    const payload = build({}, { cumulativeMethod: "arithmetic" });
    const twin = zeroFilledTwin(payload);
    const slice = payload.strategyReturns.slice(LO, HI + 1);
    const cagr = (sum(slice) / twin.rets.length) * payload.periodsPerYear!;
    // 14b's value equals the zero-filled twin's mean times periodsPerYear.
    expect(cagr).toBeCloseTo((sum(twin.rets) / twin.rets.length) * payload.periodsPerYear!, 15);
    expect(ari.CAGR).toBe(pctSigned(cagr, 1));
  });

  it("active basis: the three cells are compute() of the slice's non-zero returns (a filled 0.0 day is excluded anyway), unchanged from plan 169.1-03", async () => {
    const payload = build({ zeros: true }, { cumulativeMethod: "arithmetic", dayBasis: "active" } as Partial<BuildFactsheetOpts>);
    const slice = payload.strategyReturns.slice(LO, HI + 1);
    const sliceDates = payload.dates.slice(LO, HI + 1);
    const keep = slice.map((r) => r !== 0);
    const active = compute(slice.filter((_, i) => keep[i]), sliceDates.filter((_, i) => keep[i]), 0, payload.periodsPerYear!);

    mount(payload);
    await click("zoom");
    expect(riskCells(stripCells())).toEqual(riskText(active));
  });

  it("a single-key payload with the same gaps: the three cells are compute() of the present-day slice (the single-key engine does not zero-fill)", async () => {
    const payload = build({ composite: false });
    const presentDays = riskText(
      compute(payload.strategyReturns.slice(LO, HI + 1), payload.dates.slice(LO, HI + 1), 0, payload.periodsPerYear!),
    );
    const twin = zeroFilledTwin(payload);
    expectAllThreeDiffer(presentDays, riskText(compute(twin.rets, twin.dates, 0, payload.periodsPerYear!)));

    mount(payload);
    await click("zoom");
    expect(riskCells(stripCells())).toEqual(presentDays);
  });

  it("a reset returns every strip cell to its pre-zoom text", async () => {
    const payload = build({});
    mount(payload);
    const before = stripCells();
    await click("zoom");
    expect(stripCells()).not.toEqual(before);
    await click("reset");
    expect(stripCells()).toEqual(before);
  });
});
