import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BenchmarkPricesOpt } from "@/lib/factsheet/build-payload";
import { compute } from "@/lib/factsheet/compute";
import type { DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { isoToMonthDay } from "./MetricsColumn";
import { pct, pctSigned, ratio as num } from "./format";

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
