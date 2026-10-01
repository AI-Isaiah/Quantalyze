import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, screen, within } from "@testing-library/react";

// Count deriveSeriesBundle calls AS IMPORTED BY basis-context.tsx: a passthrough
// over the real implementation, so every figure is genuinely computed.
vi.mock("@/lib/factsheet/build-payload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/factsheet/build-payload")>();
  return { ...actual, deriveSeriesBundle: vi.fn(actual.deriveSeriesBundle) };
});

import { buildFactsheetPayload, deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import { compute } from "@/lib/factsheet/compute";
import { MIN_PAIRED_OBSERVATIONS, pairedFloorReason } from "@/lib/factsheet/joint";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { headlineCoverageCaveat, isoToMonthDay, windowCoverageCaveat } from "./MetricsColumn";
import { useWindowedView, type WindowedView } from "./basis-context";
import { pct, pctSigned, ratio as num } from "./format";

const deriveSpy = vi.mocked(deriveSeriesBundle);

/**
 * Phase 169.1 plan 02 (SC10, D-27) — the KPI strip follows the MasterBrush zoom
 * window. Founder, 2026-09-25: "when I look at a different time, it should
 * adjust all KPIs, as why would I want to zoom into a certain part of the
 * strategy?" Before this plan the charts moved and the strip kept describing the
 * whole record, so the page showed a window it did not measure.
 *
 * The strip is rendered through the REAL FactsheetBody inside the REAL
 * FactsheetProvider; a sibling harness drives the SAME `setXRange` /
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
  id: "s-169-1-02-strip",
  name: "Window Strip Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-09-30T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "api" as const,
};

const START = "2024-01-01";

const stratValue = (i: number) => 0.0009 + Math.sin(i * 0.31) * 0.012 + Math.cos(i * 0.07) * 0.004;

/**
 * An `n`-day crypto record. BTC closes run from the day before the first date
 * through `btcThroughIdx` (default: the last date), so every interval up to
 * there pairs with BTC.
 */
function build400(
  n = 400,
  btcThroughIdx = n - 1,
  opts: Parameters<typeof buildFactsheetPayload>[2] = {},
): FactsheetPayload {
  const rows: DailyReturn[] = Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: stratValue(i) }));
  const btc: DailyPrice[] = Array.from({ length: btcThroughIdx + 2 }, (_, i) => ({
    date: addDays(START, i - 1),
    close: 40000 * (1 + 0.15 * Math.sin(i * 0.05)) + ((i * 37) % 11) * 120,
  }));
  const opt: BenchmarkPricesOpt = { prices: btc, through: btc[btc.length - 1].date, dropped: [] };
  const payload = buildFactsheetPayload(STRATEGY, rows, { benchmarkPrices: opt, ...opts });
  if (!payload) throw new Error("fixture must build a payload");
  return payload;
}

/**
 * The stored full-record headline (the persisted overlay of 169-01, D-10) is
 * deliberately distinct from compute()'s, so a cell that keeps showing it while
 * zoomed is caught.
 */
function withStoredHeadline(p: FactsheetPayload): FactsheetPayload {
  return {
    ...p,
    strategyMetrics: {
      ...p.strategyMetrics,
      cum_ret: 0.4321,
      cagr: 0.3456,
      sharpe: 3.21,
      sortino: 4.32,
      calmar: 5.43,
      max_dd: -0.0654,
      ann_vol: 0.0987,
    },
  } as FactsheetPayload;
}

function RangeHarness({ range = [100, 299] as const }: { range?: readonly [number, number] }) {
  const { setXRange, resetXRange } = useXRange();
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>
      <button data-testid="reset" onClick={() => resetXRange()}>reset</button>
    </>
  );
}

function mount(payload: FactsheetPayload, range?: readonly [number, number]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={range} />
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
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

async function click(testId: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

const SEVEN = ["Cum. Return", "CAGR", "Sharpe", "Sortino", "Calmar", "Max DD", "Ann. Vol"] as const;

function expectedSeven(m: ReturnType<typeof compute>): Record<(typeof SEVEN)[number], string> {
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

describe("KPI strip follows the zoom window (SC10, D-27)", () => {
  it("narrowing to [100, 299] moves the seven scalars to compute() of the slice; the stored headline is not shown", async () => {
    const payload = withStoredHeadline(build400());
    mount(payload);
    const before = stripCells();
    expect(before.Sharpe).toBe("3.21");

    await click("zoom");
    const after = stripCells();
    const slice = compute(
      payload.strategyReturns.slice(100, 300),
      payload.dates.slice(100, 300),
      0,
      payload.periodsPerYear!,
    );
    const want = expectedSeven(slice);
    for (const label of SEVEN) {
      expect(after[label], label).toBe(want[label]);
      expect(after[label], `${label} moved off the stored value`).not.toBe(before[label]);
    }
  });

  it("a reset returns every strip cell to its pre-zoom text, the stored Sharpe included", async () => {
    const payload = withStoredHeadline(build400());
    mount(payload);
    const before = stripCells();
    await click("zoom");
    expect(stripCells()).not.toEqual(before);
    await click("reset");
    expect(stripCells()).toEqual(before);
    expect(stripCells().Sharpe).toBe("3.21");
  });

  it("the eyebrow reads Full history before the zoom and after the reset, Selected range with the slice's dates while zoomed", async () => {
    const payload = build400();
    mount(payload);
    const full = `Full history: ${isoToMonthDay(payload.dates[0])} – ${isoToMonthDay(payload.dates[399])}`;
    expect(screen.getByTestId("range-eyebrow-strip").textContent).toBe(full);
    await click("zoom");
    expect(screen.getByTestId("range-eyebrow-strip").textContent).toBe(
      `Selected range: ${isoToMonthDay(payload.dates[100])} – ${isoToMonthDay(payload.dates[299])}`,
    );
    await click("reset");
    expect(screen.getByTestId("range-eyebrow-strip").textContent).toBe(full);
  });

  it("the short-track caveat states the WINDOW's observation count while zoomed", async () => {
    const payload = build400();
    const { container } = mount(payload);
    expect(container.textContent).not.toMatch(/Only \d+ observations? — annualized/);
    await click("zoom");
    expect(container.textContent).toContain("Only 200 observations — annualized");
  });
});

/** A sibling reader of the windowed view, outside FactsheetBody's own providers (cash, L = 1). */
const windowReads: WindowedView[] = [];
function WindowProbe({ payload }: { payload: FactsheetPayload }) {
  windowReads.push(useWindowedView(payload).view);
  return null;
}

function mountScenario(payload: FactsheetPayload, range: readonly [number, number]) {
  windowReads.length = 0;
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={range} />
      <WindowProbe payload={payload} />
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

function scenarioPayload(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: Array.from({ length: 120 }, (_, i) => ({ date: addDays("2025-03-01", i), value: stratValue(i) })),
    benchmark: null,
    periodsPerYear: 365,
  });
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

function hasPanel(title: string): boolean {
  return [...document.querySelectorAll("h3")].some((el) => el.textContent === title);
}

describe("the window holds across basis and leverage and never fabricates a figure (SC10, D-27)", () => {
  it("under MTM (basis set first, then the range) the strip's Sharpe is compute() of the MTM slice, not the cash slice and not the persisted MTM scalar", async () => {
    const cash = build400();
    const mtmRows: DailyReturn[] = Array.from({ length: 400 }, (_, i) => ({
      date: addDays(START, i),
      value: 0.0006 + Math.sin(i * 0.23 + 1) * 0.013,
    }));
    const payload = build400(400, 399, {
      mtmGate: { available: true },
      mtmSeries: { dailyReturns: mtmRows, gapSpans: [] },
      metricsByBasis: {
        mark_to_market: {
          cumulative_return: 0.5,
          volatility: 0.3,
          max_drawdown: -0.2,
          cagr: 0.4,
          sharpe: 6.66,
          sortino: 7.77,
          calmar: 2,
        },
      },
    } as Parameters<typeof buildFactsheetPayload>[2]);
    expect(payload.seriesByBasis?.mark_to_market, "fixture: the MTM bundle is present").toBeDefined();
    mount(payload);
    await act(async () => {
      fireEvent.click(screen.getByText("Mark-to-market"));
    });
    expect(stripCells().Sharpe).toBe("6.66");
    await click("zoom");
    const mtmSlice = compute(mtmRows.slice(100, 300).map((r) => r.value), mtmRows.slice(100, 300).map((r) => r.date), 0, payload.periodsPerYear!);
    const cashSlice = compute(cash.strategyReturns.slice(100, 300), cash.dates.slice(100, 300), 0, payload.periodsPerYear!);
    expect(stripCells().Sharpe).toBe(num(mtmSlice.sharpe));
    expect(num(mtmSlice.sharpe)).not.toBe(num(cashSlice.sharpe));
    expect(stripCells().Sharpe).not.toBe("6.66");
  });

  it("on cash at leverage 2 the window shows compute() of the LEVERED slice, with no re-pin to the persisted Sharpe / Sortino", async () => {
    const base = build400();
    const payload = {
      ...base,
      metricsByBasis: {
        cash_settlement: {
          cumulative_return: 0.5,
          volatility: 0.3,
          max_drawdown: -0.2,
          cagr: 0.4,
          sharpe: 5.55,
          sortino: 6.66,
          calmar: 2,
        },
      },
    } as FactsheetPayload;
    mount(payload);
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Leverage multiplier/), { target: { value: "2" } });
    });
    // Full history at L = 2: the leverage arm re-pins the two invariant ratios (D-25).
    expect(stripCells().Sharpe).toBe("5.55");
    expect(stripCells().Sortino).toBe("6.66");
    await click("zoom");
    const levered = compute(
      base.strategyReturns.slice(100, 300).map((r) => 2 * r),
      base.dates.slice(100, 300),
      0,
      base.periodsPerYear!,
    );
    expect(stripCells().Sharpe).toBe(num(levered.sharpe));
    expect(stripCells().Sortino).toBe(num(levered.sortino));
    expect(stripCells().CAGR).toBe(pctSigned(levered.cagr, 1));
    expect(stripCells()["Max DD"]).toBe(pct(levered.max_dd, 1));
  });

  it("a BTC comparator whose prices stop inside the window is measured over the paired intervals only; a window wholly after them is the unavailable form", async () => {
    const payload = build400(400, 250);
    const { unmount } = mount(payload);
    await click("zoom");
    const slice = payload.strategyReturns.slice(100, 300).map((value, i) => ({ date: payload.dates[100 + i], value }));
    const expected = vi.mocked(deriveSeriesBundle).getMockImplementation()!(slice, {
      periodsPerYear: payload.periodsPerYear!,
      isArithmetic: false,
      markets: payload.markets,
      strategyName: payload.strategyName,
      missingSegments: payload.missingSegments,
      benchmarkPrices: payload.benchmarkPrices ?? { unavailable: true },
    }).comparators.btc;
    expect(expected.through).toBe(payload.dates[250]);
    expect(expected.summary).not.toBeNull();
    expect(railRow("Main Metrics", "Cumulative Return")[2]).toBe(
      `${expected.summary!.cum_ret >= 0 ? "+" : ""}${(expected.summary!.cum_ret * 100).toFixed(2)}%`,
    );
    expect(stripCells()["α vs BTC"]).toBe(pctSigned(expected.joint!.alpha, 1));
    unmount();

    mount(payload, [300, 399]);
    await click("zoom");
    expect(railRow("Main Metrics", "Cumulative Return")[2]).toBe("—");
    expect(railRow("Main Metrics", "Sharpe")[2]).toBe("—");
    expect(stripCells()["α vs BTC"] ?? "—").toBe("—");
  });

  it("below the paired floor inside a window the strip keeps 9 cells, alpha and IR read the em-dash, and the strip AND §IV name the range's count (D-85)", async () => {
    const payload = build400();
    mount(payload, [100, 107]);
    expect(screen.queryAllByTestId("joint-floor-reason")).toHaveLength(0);
    await click("zoom");
    const cells = stripCells();
    expect(Object.keys(cells)).toHaveLength(9);
    expect(cells["α vs BTC"]).toBe("—");
    expect(cells["IR vs BTC"]).toBe("—");
    const sentence = pairedFloorReason("BTC", 8, "range", MIN_PAIRED_OBSERVATIONS);
    expect(sentence).toBe("Alpha and beta need at least 10 days paired with BTC; the selected range has 8.");
    const reasons = screen.getAllByTestId("joint-floor-reason").map((el) => el.textContent);
    expect(reasons).toEqual([sentence, sentence]);
  });

  // 169.1 review round 1 (SFH MEDIUM-2). D-78 dropped the chain-broken caveat inside
  // a window, but the window re-derive compounds every return in the slice, while the
  // engine compounds only the record from `headlineCoversFrom` on. A range starting
  // before that day showed a break-spanning Cum. Return / CAGR / Max DD with nothing
  // on the page saying so. The strip and the rail are asserted SEPARATELY, by each
  // surface's own subject, so a fix to only one of them stays red.
  function chainBroken(headlineCoversFrom: string | null | undefined): FactsheetPayload {
    const base = build400();
    return {
      ...base,
      dataQuality: { ...(base.dataQuality ?? {}), twrChainBroken: true, headlineCoversFrom },
    } as FactsheetPayload;
  }
  const STRIP_SUBJECT = "Cum. Return, CAGR, Calmar and Max DD";
  const RAIL_SUBJECT = "Cumulative Return, CAGR and Calmar";

  it("on a chain-broken record a range starting before the break keeps a caveat on the strip and the rail; the stored-headline caveat returns on reset", async () => {
    const payload = chainBroken("2024-06-01");
    const stored = headlineCoverageCaveat(payload.dataQuality, "cash_settlement", "Cum. Return, CAGR and Calmar");
    expect(stored).not.toBeNull();
    const { container } = mount(payload); // zoom [100, 299]: 2024-04-10 to 2024-10-26
    expect(container.textContent).toContain(`⚠ ${stored}`);
    await click("zoom");
    expect(container.textContent).not.toContain(stored!);
    const strip = windowCoverageCaveat(payload.dataQuality, "cash_settlement", payload.dates[100], STRIP_SUBJECT);
    const rail = windowCoverageCaveat(payload.dataQuality, "cash_settlement", payload.dates[100], RAIL_SUBJECT);
    // The sentence is pinned literally once, so the date and the claim are read, not just echoed.
    expect(strip).toBe(
      "This range starts before Jun 1, 2024, where the record resumes after its last break in the return chain. Its Cum. Return, CAGR, Calmar and Max DD compound returns from before that date, which the full-history figures leave out.",
    );
    expect(container.textContent, "the KPI strip names the break").toContain(`⚠ ${strip}`);
    expect(container.textContent, "the rail's Main Metrics names the break").toContain(`⚠ ${rail}`);
    await click("reset");
    expect(container.textContent).toContain(`⚠ ${stored}`);
    expect(container.textContent).not.toContain(strip!);
    expect(container.textContent).not.toContain(rail!);
  });

  it("on a chain-broken record a range starting after the break, or on its first day, shows no caveat", async () => {
    for (const range of [[200, 299], [152, 299]] as const) {
      const payload = chainBroken("2024-06-01");
      expect(payload.dates[152]).toBe("2024-06-01");
      const { container, unmount } = mount(payload, range);
      await click("zoom");
      expect(screen.getByTestId("range-eyebrow-strip").textContent).toMatch(/^Selected range/);
      expect(container.textContent, `range ${range.join("-")}`).not.toMatch(/break in the return chain/);
      unmount();
    }
  });

  it("on a chain-broken record whose break date cannot be named, every range keeps a caveat with no date", async () => {
    const payload = chainBroken(null);
    const { container } = mount(payload, [200, 299]);
    await click("zoom");
    const strip = windowCoverageCaveat(payload.dataQuality, "cash_settlement", payload.dates[200], STRIP_SUBJECT);
    expect(strip).toBe(
      "The record has a break in the return chain at a date this view cannot name, so this range may span it. Its Cum. Return, CAGR, Calmar and Max DD are compounded across any break inside it.",
    );
    expect(container.textContent).toContain(`⚠ ${strip}`);
    expect(container.textContent).toContain(
      `⚠ ${windowCoverageCaveat(payload.dataQuality, "cash_settlement", payload.dates[200], RAIL_SUBJECT)}`,
    );
  });

  it("a chain-broken record with no stored headline overlay (headlineCoversFrom absent) shows no caveat in a window, as at full history", async () => {
    const payload = chainBroken(undefined);
    const { container } = mount(payload);
    expect(container.textContent).not.toMatch(/break in the return chain/);
    await click("zoom");
    expect(container.textContent).not.toMatch(/break in the return chain/);
  });

  it("the short-track caveat states a 60-observation window's count; an 800-observation record with no zoom shows none", async () => {
    const long = build400(800);
    const { container, unmount } = mount(long, [100, 159]);
    expect(container.textContent).not.toMatch(/Only \d+ observations? — annualized/);
    await click("zoom");
    expect(container.textContent).toContain("Only 60 observations — annualized");
    unmount();
  });

  it("the strip and the rail at one window run deriveSeriesBundle ONCE, and a second render at that window runs it zero more times", async () => {
    const payload = build400();
    mount(payload);
    deriveSpy.mockClear();
    await click("zoom");
    expect(screen.getByTestId("range-eyebrow-strip").textContent).toMatch(/^Selected range/);
    expect(screen.getByTestId("range-eyebrow-rail").textContent).toMatch(/^Selected range/);
    expect(deriveSpy).toHaveBeenCalledTimes(1);
    deriveSpy.mockClear();
    // The same window again: a new range object, the same indices.
    await click("zoom");
    expect(deriveSpy).toHaveBeenCalledTimes(0);
  });

  it("the Scenario mount shows window figures equal to compute() of its slice, keeps its inert comparator blocks, renders no leverage control, and resets exactly (D-82, W2)", async () => {
    const payload = scenarioPayload();
    expect(payload.periodsPerYear).toBe(365);
    mountScenario(payload, [10, 60]);
    const before = stripCells();
    const benchBefore = railRow("Main Metrics", "Sharpe")[2];
    expect(screen.queryByLabelText(/Leverage multiplier/)).toBeNull();

    await click("zoom");
    expect(screen.getByTestId("range-eyebrow-strip").textContent).toMatch(/^Selected range: /);
    const slice = compute(payload.strategyReturns.slice(10, 61), payload.dates.slice(10, 61), 0, 365);
    const cells = stripCells();
    expect(cells.Sharpe).toBe(num(slice.sharpe));
    expect(cells.CAGR).toBe(pctSigned(slice.cagr, 1));
    expect(cells["Max DD"]).toBe(pct(slice.max_dd, 1));
    // The BTC column keeps its unavailable form: the same text as at full history.
    expect(railRow("Main Metrics", "Sharpe")[2]).toBe(benchBefore);
    const w = windowReads[windowReads.length - 1];
    expect(w.withheld).toBeUndefined();
    for (const key of ["btc", "spx", "none"] as const) {
      expect(w.comparators[key], `${key} stays the base block`).toBe(payload.comparators[key]);
    }
    expect(screen.queryByLabelText(/Leverage multiplier/)).toBeNull();

    await click("reset");
    expect(stripCells()).toEqual(before);
  });

  it("a Scenario payload with no periodsPerYear withholds every window figure on the strip AND the rail, with one sentence (D-82, W1)", async () => {
    const full = scenarioPayload();
    const noBasis = { ...full } as Record<string, unknown>;
    delete noBasis.periodsPerYear;
    const payload = noBasis as unknown as FactsheetPayload;
    mountScenario(payload, [10, 60]);
    const railCells: Array<[string, string]> = [
      ["Main Metrics", "Sharpe"],
      ["Main Metrics", "CAGR"],
      ["Max Drawdown", "Max Drawdown"],
      ["Extended Metrics", "P5 (daily)"],
      ["Extended Metrics", "P95 (daily)"],
      ["Bootstrap 95% Confidence", "Sharpe"],
      ["Bootstrap 95% Confidence", "Max Drawdown"],
      ["Compound Performance", "Start Date"],
      ["Compound Performance", "End Date"],
    ];
    const stripFull = stripCells();
    const railFull = railCells.map(([t, l]) => railRow(t, l)[1]);
    expect(hasPanel("Worst 10 Drawdowns")).toBe(true);
    expect(screen.queryByTestId("window-withheld-reason")).toBeNull();

    await click("zoom");
    const strip = stripCells();
    for (const [label, text] of Object.entries(strip)) {
      expect(text, label).toBe("—");
      expect(text).not.toBe(stripFull[label]);
    }
    expect(screen.getByTestId("window-withheld-reason").textContent).toBe(
      "The figures for a selected range need an annualization basis this view does not carry. Resetting the range shows the full-history figures.",
    );
    railCells.forEach(([t, l], i) => {
      const v = railRow(t, l)[1];
      expect(v, `${t} / ${l}`).not.toBe(railFull[i]);
      if (t !== "Compound Performance") expect(v, `${t} / ${l}`).toBe("—");
    });
    expect(railRow("Compound Performance", "Start Date")[1]).toBe(isoToMonthDay(payload.dates[10]));
    expect(railRow("Compound Performance", "End Date")[1]).toBe(isoToMonthDay(payload.dates[60]));
    expect(hasPanel("Worst 10 Drawdowns")).toBe(false);
    expect(within(document.body).queryByText(/stationary block-bootstrap resamples/)).toBeNull();
  });
});
