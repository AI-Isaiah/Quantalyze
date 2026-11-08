import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { buildFactsheetPayload, deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import type { DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { figureRecord } from "@/lib/figure-gate";
import { BasisProvider, useBasis, useBasisSeriesView, windowView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 194 plan 14 (D-15, D-14) - the client re-derives gate on the payload's TOTAL
 * record, and a shorter basis view never shows the cash view's 1y window.
 *
 * Why each case matters:
 *   - the leverage arm and `windowView` re-derive the series bundle in the browser; a
 *     re-derive with no record would silently drop the rolling verdict (an unknown
 *     record reads as "draw it, no note") on exactly the views a client builds by
 *     levering or zooming;
 *   - a zoomed range must NEVER re-gate the rolling verdict (D-15: the total record
 *     withholds, the window only qualifies), so the windowed view keeps the base view's
 *     `rollingWindow`;
 *   - the basis merge `{ ...payload, ...bundle }` leaves any key a bundle omits on the
 *     cash value, so a 400-day cash record's 1y window would show on a 200-day MTM view
 *     unless the builder sets `null`; `undefined` would be dropped by the JSON payload
 *     cache and bring the cash window back.
 *
 * Expected spans and verdicts are written from the fixture dates here, never obtained by
 * calling `deriveSeriesBundle`.
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
  id: "s-194-14-figure-record",
  name: "Figure Record Strategy",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;
const rowsOf = (n: number, shift = 0): DailyReturn[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(START, i + shift), value: value(i + shift) }));

/** A real csv-arm payload, leverage-eligible (single-key, geometric, periodsPerYear 365). */
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
  const basis = useBasis();
  const lev = useLeverage();
  const view = useBasisSeriesView(payload);
  return { basis, lev, view };
}

describe("the leverage arm re-derives on the payload's total record (D-15)", () => {
  it("a 60-day crypto record, levered: the view is levered AND its rolling verdict is the payload's withheld one", () => {
    const payload = buildPayload(60);
    // The record the fixture dates imply: 60 days, under crypto's 90.
    expect(payload.figureRecord).toEqual(
      figureRecord({ seriesStart: START, seriesEnd: addDays(START, 59), observations: null, periodsPerYear: 365 }),
    );
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    act(() => result.current.lev.setLeverage(2));
    const view = result.current.view;
    expect(view).not.toBe(payload);
    expect(view.strategyReturns[0]).toBeCloseTo(2 * payload.strategyReturns[0], 12);
    expect(view.rollingWindow.annualization).toEqual({ state: "withheld", days: 60, cause: "gate" });
    expect(view.rollingWindow.annualization).toEqual(payload.rollingWindow.annualization);
  });

  it("a cleared 200-day record, levered: short, days 126, and the 1y keys stay null", () => {
    const payload = buildPayload(200);
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    act(() => result.current.lev.setLeverage(2));
    const view = result.current.view;
    expect(view).not.toBe(payload);
    expect(view.rollingWindow.annualization).toEqual({ state: "short", days: 126, cause: null });
    expect(view.rollingWindow1y).toBeNull();
    expect(view.strategyRollingVol1y).toBeNull();
    expect(view.strategyRollingSharpe1y).toBeNull();
    expect(view.strategyRollingSortino1y).toBeNull();
  });

  it("a 400-day record, levered: the 1y window is full and its volatility scales with the leverage", () => {
    const payload = buildPayload(400);
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    act(() => result.current.lev.setLeverage(2));
    const view = result.current.view;
    expect(view.rollingWindow1y?.annualization).toEqual({ state: "full", days: 365, cause: null });
    const base = payload.strategyRollingVol1y!;
    const levered = view.strategyRollingVol1y!;
    expect(typeof base[399]).toBe("number");
    expect(levered[399]!).toBeCloseTo(2 * base[399]!, 9);
  });
});

describe("windowView never re-gates the rolling verdict (D-15: a range qualifies, it does not withhold)", () => {
  it("a 60-day crypto record zoomed to its last 30 dates keeps the base withheld verdict", () => {
    const payload = buildPayload(60);
    const w = windowView(payload, 30, 59);
    expect(w.withheld).toBeUndefined();
    expect(w.dates.length).toBe(30);
    expect(w.rollingWindow.annualization).toEqual({ state: "withheld", days: 60, cause: "gate" });
    expect(w.rollingWindow).toBe(payload.rollingWindow);
  });

  it("a cleared 200-day record zoomed to its last 30 dates keeps the base short verdict and 126-row window", () => {
    const payload = buildPayload(200);
    const w = windowView(payload, 170, 199);
    expect(w.withheld).toBeUndefined();
    expect(w.dates.length).toBe(30);
    expect(w.rollingWindow).toEqual({
      window: 126,
      label: "6mo",
      enough: true,
      annualization: { state: "short", days: 126, cause: null },
    });
    expect(w.rollingWindow).toBe(payload.rollingWindow);
  });
});

describe("a basis view shorter than a year never shows the cash view's 1y window (merge level)", () => {
  /** 400-day cash payload whose MTM bundle covers only the last 200 days, gated on the payload's record. */
  function withShortMtm(): FactsheetPayload {
    const cash = buildPayload(400);
    expect(cash.rollingWindow1y, "fixture: the cash payload carries a 1y window").not.toBeNull();
    const mtmRows = rowsOf(200, 200);
    const mtm = deriveSeriesBundle(mtmRows, {
      periodsPerYear: cash.periodsPerYear!,
      isArithmetic: false,
      markets: cash.markets,
      strategyName: cash.strategyName,
      benchmarkPrices: cash.benchmarkPrices ?? { unavailable: true },
      figureRecord: cash.figureRecord ?? null,
    });
    return { ...cash, seriesByBasis: { mark_to_market: mtm } } as FactsheetPayload;
  }

  const FOUR = ["rollingWindow1y", "strategyRollingVol1y", "strategyRollingSharpe1y", "strategyRollingSortino1y"] as const;

  function readUnder(payload: FactsheetPayload, to: "cash_settlement" | "mark_to_market"): FactsheetPayload {
    const { result } = renderHook(() => useProbe(payload), { wrapper });
    act(() => result.current.basis.setBasis(to));
    return result.current.view;
  }

  it("under cash the view carries the payload's 1y window and series", () => {
    const payload = withShortMtm();
    const view = readUnder(payload, "cash_settlement");
    expect(view.rollingWindow1y).toEqual(payload.rollingWindow1y);
    expect(view.strategyRollingSharpe1y).toEqual(payload.strategyRollingSharpe1y);
  });

  it("under mark_to_market the four 1y keys are null, not the cash payload's", () => {
    const payload = withShortMtm();
    const view = readUnder(payload, "mark_to_market");
    expect(view.dates.length, "fixture: the view is the 200-day MTM bundle").toBe(200);
    for (const k of FOUR) expect(view[k], k).toBeNull();
  });

  it("the same holds after the public payload cache (JSON round-trip)", () => {
    const cached = JSON.parse(JSON.stringify(withShortMtm())) as FactsheetPayload;
    expect(cached.rollingWindow1y, "fixture: the cached cash payload keeps its 1y window").not.toBeNull();
    const view = readUnder(cached, "mark_to_market");
    expect(view.dates.length).toBe(200);
    for (const k of FOUR) expect(view[k], k).toBeNull();
  });
});
