import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload, JointMetrics } from "@/lib/factsheet/types";
import { coveredDays } from "@/lib/figure-gate";
import { BasisProvider, useBasisSeriesView, windowView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 194 plan 21 (D-11 as superseded by D-15) - the joint gate reaches the two client
 * re-derives, the selected-range view and the levered view, with no per-reader logic.
 *
 * Why each case matters: `buildComparatorBlock` gates alpha, information ratio, tracking
 * error and Treynor on the strategy's TOTAL record. A zoomed or levered view re-derives
 * the comparator block in the browser; if `rederiveArgs` stopped carrying the record, a
 * 60-day crypto record would show an annualized alpha the moment a client zoomed or
 * levered it (the record reads as unknown, so the value is kept), and the strip would
 * disagree with the full-history view it was derived from. In the other direction, a
 * zoom must never withhold a cleared record's figure for being a short range (D-15: the
 * client who zooms wants the figures and knows they are less stable): short, not withheld.
 *
 * Expected spans come from the fixture dates written here, never from the builder.
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
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01";

const STRATEGY = {
  id: "s-194-21-joint-record",
  name: "Joint Record Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;
const rowsOf = (n: number): DailyReturn[] => Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: value(i) }));

/** A real csv-arm payload with BTC from the bundled fixture, leverage-eligible (single-key, geometric, 365). */
function buildPayload(n: number): FactsheetPayload {
  const p = buildFactsheetPayload(STRATEGY, rowsOf(n), {});
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BasisProvider>
      <LeverageProvider>{children}</LeverageProvider>
    </BasisProvider>
  );
}

function useProbe(payload: FactsheetPayload) {
  const lev = useLeverage();
  const view = useBasisSeriesView(payload);
  return { lev, view };
}

const FOUR = ["alpha", "info_ratio", "tracking_error", "treynor"] as const;
const UNTOUCHED = ["beta", "corr", "r2", "up_capture", "down_capture"] as const;

function lever(payload: FactsheetPayload, L: number): FactsheetPayload {
  const { result } = renderHook(() => useProbe(payload), { wrapper });
  act(() => result.current.lev.setLeverage(L));
  expect(result.current.view, "fixture: the leverage arm re-derived the view").not.toBe(payload);
  return result.current.view;
}

function expectWithheld(joint: JointMetrics | null) {
  expect(joint).not.toBeNull();
  for (const k of FOUR) expect(joint![k], k).toBeNaN();
  for (const k of UNTOUCHED) expect(Number.isFinite(joint![k]), k).toBe(true);
}

describe("windowView follows the total record (D-15)", () => {
  it("a 60-day crypto record zoomed to its last 30 dates: the four annualized joint figures are NaN, withheld over the slice's span", () => {
    const payload = buildPayload(60);
    expect(payload.figureRecord?.spanDays).toBe(60);
    const w = windowView(payload, 30, 59);
    expect(w.withheld).toBeUndefined();
    expect(w.dates.length).toBe(30);
    // Fixture: BTC covers every slice date, so all 30 pair and the span is first to last date.
    expect(w.comparators.btc.dailyReturns!.every(r => r != null)).toBe(true);
    expectWithheld(w.comparators.btc.joint);
    expect(w.comparators.btc.jointAnnualization).toEqual({
      state: "withheld",
      days: coveredDays(addDays(START, 30), addDays(START, 59)),
    });
  });

  it("a cleared 400-day record zoomed to its last 30 dates keeps the values, short over the slice's span", () => {
    const payload = buildPayload(400);
    expect(payload.figureRecord?.spanDays).toBe(400);
    const w = windowView(payload, 370, 399);
    // The same zoom of the same payload with the record removed is the unknown (`null`) state.
    const { figureRecord: _record, ...noRecord } = payload;
    const ref = windowView(noRecord as FactsheetPayload, 370, 399);
    expect(ref.comparators.btc.jointAnnualization).toBeUndefined();
    for (const k of FOUR) {
      expect(Number.isFinite(w.comparators.btc.joint![k]), k).toBe(true);
      expect(w.comparators.btc.joint![k], k).toBe(ref.comparators.btc.joint![k]);
    }
    expect(w.comparators.btc.jointAnnualization).toEqual({
      state: "short",
      days: coveredDays(addDays(START, 370), addDays(START, 399)),
    });
  });
});

describe("the leverage arm follows the total record (D-15)", () => {
  it("L=2 on the 60-day crypto record: the four annualized joint figures are NaN and the marker says withheld", () => {
    const view = lever(buildPayload(60), 2);
    expectWithheld(view.comparators.btc.joint);
    expect(view.comparators.btc.jointAnnualization).toEqual({ state: "withheld", days: 60 });
  });

  it("L=2 on a cleared 400-day record: the four are finite and no marker is set (400 paired days is a full year)", () => {
    const view = lever(buildPayload(400), 2);
    for (const k of FOUR) expect(Number.isFinite(view.comparators.btc.joint![k]), k).toBe(true);
    expect("jointAnnualization" in view.comparators.btc).toBe(false);
  });
});

describe("the KPI strip prints what the block says (D-15)", () => {
  function stripCell(label: string): string {
    const lab = screen.getAllByTestId("factsheet-kpi-label").find(l => l.textContent === label);
    if (!lab) throw new Error(`no strip cell ${label}`);
    return lab.parentElement!.querySelector('[data-testid="factsheet-kpi-value"]')!.textContent ?? "";
  }

  function mount(payload: FactsheetPayload) {
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
      </FactsheetProvider>,
    );
  }

  it("a 60-day crypto record: the alpha and IR cells are a dash", () => {
    const payload = { ...buildPayload(60), activeComparator: "btc" } as FactsheetPayload;
    mount(payload);
    expect(stripCell("α vs BTC")).toBe("—");
    expect(stripCell("IR vs BTC")).toBe("—");
  });

  it("a cleared 400-day record that pairs only 60 days with BTC: the cells print their values", () => {
    const rows = rowsOf(400);
    // BTC closes from the day before the 341st date through the last: 60 paired intervals.
    const from = addDays(START, 339);
    const prices = Array.from({ length: 61 }, (_, i) => ({
      date: addDays(from, i),
      close: 40000 + ((i * 37) % 11) * 250 + i * 13,
    }));
    const payload = buildFactsheetPayload(STRATEGY, rows, {
      benchmarkPrices: { prices, through: prices[60].date, dropped: [] },
    });
    expect(payload).not.toBeNull();
    expect(payload!.comparators.btc.jointAnnualization).toEqual({ state: "short", days: 60 });
    mount({ ...payload!, activeComparator: "btc" } as FactsheetPayload);
    expect(stripCell("α vs BTC")).toMatch(/%$/);
    expect(stripCell("IR vs BTC")).toMatch(/^-?\d+\.\d{2}$/);
  });
});
