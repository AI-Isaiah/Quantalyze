import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import type { FactsheetPayload, DailyReturn } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { BuildFactsheetOpts } from "@/lib/factsheet/build-payload";
import { readSingleKeyBasisOpts, singleKeyDataQuality } from "@/lib/factsheet/composite-read-path";
import { BasisProvider, leverageEligibleFor, useBasisSeriesView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 169.1 plan 04 (D-83 (c)) — a single-key payload whose RESOLVED conventions
 * are not the defaults stays leverage-ineligible.
 *
 * WHY: the client leverage re-derive scales the daily returns and recomputes from
 * L=1. It does not continue a stored headline computed as a `simple` sum or with
 * an active-day Sharpe and volatility, so a levered what-if would show figures no
 * run vouches for. Phase 169 withheld the what-if from the LIVE config; since this
 * plan the flag is derived from the resolved conventions, the frozen echo first.
 * So a strategy whose echo says `simple` while its config says geometric must
 * still be ineligible: that is the case the config-only decision got wrong.
 *
 * The payloads are built the way the factsheet build builds them: the opts are
 * `{ dataQuality: singleKeyDataQuality(dqf), ...readSingleKeyBasisOpts(...) }`,
 * then `buildFactsheetPayload`. A default payload keeps its leverage.
 */

const N = 60;
const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 2);

const SERIES: DailyReturn[] = Array.from({ length: N }, (_, i) => ({
  date: new Date(START + i * DAY).toISOString().slice(0, 10),
  // Mixed sign, a zero every 7th day so an active day basis excludes something.
  value: i % 7 === 6 ? 0 : Math.sin(i * 1.3) * 0.02 + Math.cos(i * 0.7) * 0.01,
}));

const STRATEGY = {
  id: "s-169-1-04",
  name: "Convention Ineligible Fixture",
  types: ["quant"],
  markets: ["BTC"],
  computedAt: "2024-03-02T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  description: "fixture",
  subtypes: [],
  supportedExchanges: [],
  leverageRange: null,
  aum: null,
  maxCapacity: null,
  avgDailyTurnover: null,
  startDate: "2024-01-02",
  benchmark: "BTC",
  ingestSource: "csv" as const,
};

const noAdmin = () => {
  throw new Error("getAdmin must not be called for a clean non-options row");
};

async function buildSingleKey(config: unknown, cashConventions: Record<string, unknown> | null) {
  const singleKeyOpts = await readSingleKeyBasisOpts(noAdmin, STRATEGY.id, null, null, "complete", undefined, config, {
    cashConventions,
  });
  const opts: BuildFactsheetOpts = { dataQuality: singleKeyDataQuality(null), ...singleKeyOpts };
  return buildFactsheetPayload(STRATEGY, SERIES, opts) as FactsheetPayload;
}

function bothWrapper({ children }: { children: ReactNode }) {
  return (
    <BasisProvider>
      <LeverageProvider>{children}</LeverageProvider>
    </BasisProvider>
  );
}

function useViewProbe(payload: FactsheetPayload) {
  const lev = useLeverage();
  const view = useBasisSeriesView(payload);
  return { lev, view };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("169.1-04 D-83 (c): a non-default resolved convention withholds the leverage what-if", () => {
  it("ECHO SIMPLE, CONFIG GEOMETRIC: the arithmetic payload is ineligible and L=2 is the base view by reference", async () => {
    const payload = await buildSingleKey(
      { cumulative_method: "geometric" },
      { cumulative_method: "simple", day_basis: "calendar" },
    );
    expect(payload.cumulativeMethod).toBe("arithmetic");
    expect(payload.dataQuality?.composite).toBe(false);
    expect(payload.dataQuality?.returnsConventionOverride).toBe(true);
    expect(payload.periodsPerYear).toBe(365);
    expect(leverageEligibleFor(payload, "cash_settlement")).toBe(false);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).toBe(payload);
  });

  it("ECHO ACTIVE ONLY: a geometric active-day payload is ineligible and L=2 is the base view by reference", async () => {
    const payload = await buildSingleKey(null, { cumulative_method: "geometric", day_basis: "active" });
    expect("cumulativeMethod" in payload).toBe(false);
    expect(payload.dayBasis).toBe("active");
    expect(leverageEligibleFor(payload, "cash_settlement")).toBe(false);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    expect(result.current.view).toBe(payload);
  });

  it("DEFAULT: a geometric calendar payload keeps its leverage; at L=2 the returns double and the volatility doubles", async () => {
    const payload = await buildSingleKey(null, { cumulative_method: "geometric", day_basis: "calendar" });
    expect("cumulativeMethod" in payload).toBe(false);
    expect("dayBasis" in payload).toBe(false);
    expect(payload.dataQuality?.returnsConventionOverride).toBeUndefined();
    expect(leverageEligibleFor(payload, "cash_settlement")).toBe(true);
    const { result } = renderHook(() => useViewProbe(payload), { wrapper: bothWrapper });
    act(() => result.current.lev.setLeverage(2));
    const v = result.current.view;
    expect(v).not.toBe(payload);
    for (let i = 0; i < N; i++) expect(v.strategyReturns[i]).toBeCloseTo(2 * payload.strategyReturns[i], 12);
    expect(v.strategyEquity).not.toBe(payload.strategyEquity);
    expect(v.strategyMetrics.ann_vol).toBeCloseTo(2 * payload.strategyMetrics.ann_vol, 10);
    expect(v.dates).toEqual(payload.dates);
  });
});
