import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { deriveSeriesBundle, fixtureBenchmarkPrices } from "@/lib/factsheet/build-payload";
import { BasisProvider, leverageEligibleFor, useBasis, useBasisSeriesView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 169 (D-25, SC4) — the leverage toggle keeps the PERSISTED Sharpe and
 * Sortino on the cash basis.
 *
 * Since plan 169-01 the single-key cash headline at L=1 is the persisted
 * `strategy_analytics` value (overlaid from `metricsByBasis.cash_settlement`),
 * the same number discovery, recommendations and my-strategies show. The
 * levered arm of `useBasisSeriesView` re-derives every KPI from `L·r` in
 * TypeScript and used to re-pin the two leverage-invariant ratios only for the
 * MTM and smoothed bases, on the premise that cash's L=1 value "already equals
 * the client recompute". That premise is now false: without the cash re-pin,
 * moving the leverage input off 1 would swap the stored Sharpe for a recomputed
 * one, and the founder rule is "calculate Sharpe once; every page reads it".
 */

const N = 48;

function makeReturns(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    out.push(Math.sin((i + seed) * 1.3) * 0.02 + Math.cos((i + seed) * 0.7) * 0.01);
  }
  return out;
}

function makeDates(): string[] {
  // Inside the bundled BTC price history (it starts 2023-04-26), so the BTC
  // comparator leg really moves (see basis-context.leverage.test.tsx).
  const start = Date.UTC(2024, 0, 2);
  return Array.from({ length: N }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

const STRAT = makeReturns(0);
const DATES = makeDates();

/** The persisted cash headline, as readSingleKeyBasisOpts builds it for a rankable row. */
const CASH_SCALARS = {
  cumulative_return: 0.27,
  volatility: 0.33,
  max_drawdown: -0.09,
  cagr: 0.21,
  sharpe: 1.5, // the re-pin target (leverage-invariant)
  sortino: 2.0, // the re-pin target (leverage-invariant)
  calmar: 2.3,
};

/** What the levered client re-derive gives at L=2, with no persisted overlay. */
const LEVERED_CLIENT = deriveSeriesBundle(
  STRAT.map((r, i) => ({ date: DATES[i], value: 2 * r })),
  {
    periodsPerYear: 365,
    isArithmetic: false,
    markets: ["BTC"],
    strategyName: "Test Strategy",
    benchmarkPrices: fixtureBenchmarkPrices([STRAT.map((r, i) => ({ date: DATES[i], value: r }))]),
  },
).strategyMetrics;

function makeCashPayload(o: { withPersistedCash?: boolean } = {}): FactsheetPayload {
  const { withPersistedCash = true } = o;
  const p: Record<string, unknown> = {
    ingestSource: "csv",
    strategyName: "Test Strategy",
    markets: ["BTC"],
    strategyMetrics: { cum_ret: 0.27, ann_vol: 0.33, sharpe: 1.5, sortino: 2.0, n: N },
    strategyReturns: STRAT,
    dates: DATES,
    periodsPerYear: 365,
  };
  if (withPersistedCash) p.metricsByBasis = { cash_settlement: CASH_SCALARS };
  return p as unknown as FactsheetPayload;
}

function bothWrapper({ children }: { children: ReactNode }) {
  return (
    <BasisProvider>
      <LeverageProvider>{children}</LeverageProvider>
    </BasisProvider>
  );
}

function useViewProbe(payload: FactsheetPayload) {
  const basis = useBasis();
  const lev = useLeverage();
  const view = useBasisSeriesView(payload);
  return { basis, lev, view };
}

describe("169 D-25 useBasisSeriesView — the cash basis re-pins the persisted Sharpe and Sortino under leverage", () => {
  it("fixture guard: the levered client Sharpe and Sortino differ from the persisted ones", () => {
    // If these ever agree, the re-pin assertions below pass for the wrong reason.
    expect(Math.abs(LEVERED_CLIENT.sharpe - CASH_SCALARS.sharpe)).toBeGreaterThan(0.01);
    expect(Math.abs(LEVERED_CLIENT.sortino - CASH_SCALARS.sortino)).toBeGreaterThan(0.01);
  });

  it("cash basis, persisted cash object, L=2: Sharpe 1.5 and Sortino 2.0 stay the persisted values", () => {
    const payload = makeCashPayload();
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    expect(result.current.basis.basis).toBe("cash_settlement");
    act(() => result.current.lev.setLeverage(2));
    const v = result.current.view;
    expect(v).not.toBe(payload); // the levered arm really ran
    expect(v.strategyMetrics.sharpe).toBe(CASH_SCALARS.sharpe);
    expect(v.strategyMetrics.sortino).toBe(CASH_SCALARS.sortino);
    // The homogeneous scalars stay levered (the client re-derive × L is the honest value).
    expect(v.strategyMetrics.cagr).toBeCloseTo(LEVERED_CLIENT.cagr, 10);
    expect(v.strategyMetrics.ann_vol).toBeCloseTo(LEVERED_CLIENT.ann_vol, 10);
    expect(v.strategyMetrics.max_dd).toBeCloseTo(LEVERED_CLIENT.max_dd, 10);
  });

  it("cash basis, a persisted null Sortino at L=2: withheld as \"—\", never the client value", () => {
    const payload = makeCashPayload();
    (payload.metricsByBasis as Record<string, Record<string, unknown>>).cash_settlement = {
      ...CASH_SCALARS,
      sortino: null,
    };
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(Number.isNaN(result.current.view.strategyMetrics.sortino)).toBe(true);
    expect(result.current.view.strategyMetrics.sharpe).toBe(CASH_SCALARS.sharpe);
  });

  it("cash basis at L=0: the honest derived values stand (the B-1 rule), not the persisted non-zero ones", () => {
    const payload = makeCashPayload();
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(0));
    const v = result.current.view;
    expect(Number.isNaN(v.strategyMetrics.sharpe)).toBe(true);
    expect(Number.isNaN(v.strategyMetrics.sortino)).toBe(true);
  });

  it("a payload with no persisted cash object keeps today's levered client values", () => {
    const payload = makeCashPayload({ withPersistedCash: false });
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    const v = result.current.view;
    expect(v.strategyMetrics.sharpe).toBeCloseTo(LEVERED_CLIENT.sharpe, 10);
    expect(v.strategyMetrics.sortino).toBeCloseTo(LEVERED_CLIENT.sortino, 10);
  });
});

/**
 * Review round 1, SFH M-2. At L=1 the cash headline is the STORED value; at
 * L != 1 the leverage-variant scalars (Since Inception, CAGR, volatility,
 * drawdown) are the TypeScript re-derive over the displayed series. D-25 (i)
 * accepts that seam on a clean series, where the two agree. On two kinds of
 * row they do not agree by construction, so moving the input from 1.00 to
 * 1.01 changed "Since Inception" by far more than 1% and presented the gap as
 * the effect of leverage:
 *   - H-1, a chain-broken row: the stored figure covers only the stretch after
 *     the last break, the re-derive covers the whole series;
 *   - H-2, a row whose stored headline was computed under a returns convention
 *     TypeScript cannot reproduce (a `simple` sum, or an active-day Sharpe and
 *     volatility): the re-derive compounds calendar days.
 * The leveraged view cannot be derived on the L=1 headline's basis for those
 * rows, so the what-if is withheld for them, as it already is for a composite:
 * the view stays the L=1 view by reference, and the eligibility predicate the
 * ControlBar and the KpiStrip read says no.
 */
describe("169 SFH M-2 — no leverage what-if on a row whose stored headline the re-derive cannot continue", () => {
  function flagged(dataQuality: Record<string, unknown>): FactsheetPayload {
    const p = makeCashPayload() as unknown as Record<string, unknown>;
    p.dataQuality = { composite: false, insufficientWindow: false, ...dataQuality };
    return p as unknown as FactsheetPayload;
  }

  it.each([
    ["chain-broken (H-1)", { twrChainBroken: true, headlineCoversFrom: "2024-01-20" }],
    ["stored under a returns convention the re-derive cannot reproduce (H-2)", { returnsConventionOverride: true }],
  ])("%s: not leverage-eligible, and L=2 keeps the L=1 view by reference", (_label, dq) => {
    const payload = flagged(dq);
    expect(leverageEligibleFor(payload, "cash_settlement")).toBe(false);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view, "the levered arm ran on a row it cannot continue").toBe(payload);
  });

  it("CONTROL: a clean single-key payload with the same dataQuality shape still levers", () => {
    const payload = flagged({});
    expect(leverageEligibleFor(payload, "cash_settlement")).toBe(true);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).not.toBe(payload);
  });
});
