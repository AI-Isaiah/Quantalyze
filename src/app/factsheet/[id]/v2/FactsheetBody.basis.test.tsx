import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { mtmDisabledReasonCopy } from "./basis-context";

/**
 * Phase 90 Wave-0 (90-02 Task 2) — TDD RED scaffold for the FS-03 cash/MTM
 * basis toggle: the composite discriminator (BOTH directions), the
 * server-truth MTM gate, the closed-set disabled-reason copy, and the
 * no-persistence-on-toggle invariant (GUARD-04 companion). Lands in 90-05.
 *
 * DOM-level only, mirroring GUARD-02 (FactsheetBody.scenario-mode.test.tsx):
 * it renders the REAL FactsheetBody tree and imports NO not-yet-existing module
 * (no basis-context / basis-metrics). The not-yet-existing optional payload
 * fields are supplied via casts (per 90-02 <interfaces>) so `tsc --noEmit`
 * stays clean.
 *
 * Discriminator note (CONTEXT D2): FactsheetPayload has NO `apiKeyId` field, so
 * compositeness CANNOT be (and must never be) derived from `apiKeyId === null`.
 * These fixtures discriminate purely on `dataQuality.composite === true` — the
 * server-authoritative marker. A composite fixture sets it true; the single-key
 * fixture omits the field entirely.
 *
 * RED (assertions 1–3) fail today because the toggle does not exist yet.
 * GREEN-by-construction (assertions 4–5) pass today AND after: a single-key
 * payload emits none of the Phase-90 composite strings (byte-identity scope).
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount. Stub block mirrors GUARD-02 verbatim.
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
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

function makeReturnsSeries(n: number, drift = 0.0015): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.27) * 0.005,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

// Sentinel per-basis scalar sets — MTM values are deliberately distinguishable
// from cash so a later relabel test can prove the swap. Server key names
// (cumulative_return / volatility / max_drawdown) per 90-02 <interfaces>.
const CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};
const MTM = {
  cumulative_return: 0.5,
  volatility: 0.11,
  max_drawdown: -0.038,
  cagr: 0.26,
  sharpe: 1.2,
  sortino: 1.9,
  calmar: 2.7,
};

function base(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  }) as unknown as FactsheetPayload;
}

// (a) single-key: NONE of the new fields (byte-identical to today).
function fixtureSingleKey(): FactsheetPayload {
  return base();
}
// (b) composite, MTM GATED with the options-book reason.
function fixtureCompositeGated(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH },
    mtmGate: { available: false, reason: "unsmoothed_options_book" },
  } as unknown as FactsheetPayload;
}
// (c) composite, MTM AVAILABLE (both bases present).
function fixtureCompositeAvailable(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH, mark_to_market: MTM },
    mtmGate: { available: true },
  } as unknown as FactsheetPayload;
}
// (d) composite, MTM gated with NO reason → generic fallback copy.
function fixtureCompositeNoReason(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH },
    mtmGate: { available: false },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody
        payload={payload}
        hideHeader
        hideAllocatorSection
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
}

beforeEach(() => {
  lsStore.clear();
  localStorageMock.setItem.mockClear();
});

describe("FactsheetBody — Phase 90 FS-03 basis toggle (RED until 90-05)", () => {
  it("discriminator dir 1 (RED): composite fixtures render the 'Metrics basis' toggle with Cash settlement active by default", () => {
    for (const payload of [
      fixtureCompositeGated(),
      fixtureCompositeAvailable(),
    ]) {
      const { container } = renderBody(payload);
      const group = container.querySelector(
        '[role="group"][aria-label="Metrics basis"]',
      );
      expect(group, "the composite basis toggle group").not.toBeNull();
      const cash = within(group as HTMLElement).getByText("Cash settlement");
      const mtm = within(group as HTMLElement).getByText("Mark-to-market");
      expect(cash).toBeTruthy();
      expect(mtm).toBeTruthy();
      // Cash settlement is the active default.
      expect(cash.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("MTM gate = server truth (RED): available → enabled; gated → aria-disabled with EXACT reason copy", () => {
    // Scope each fixture's query to its OWN container: the three renders below
    // accumulate in document.body within this single test (RTL cleanup only runs
    // afterEach), so a body-scoped `getByText("Mark-to-market")` would match every
    // prior render. `within(x.container)` isolates each render's toggle.
    // (c) available: MTM segment is NOT disabled.
    const c = renderBody(fixtureCompositeAvailable());
    const cMtm = within(c.container).getByText("Mark-to-market");
    expect(cMtm.getAttribute("aria-disabled")).not.toBe("true");

    // (b) gated on the options-book reason: disabled + the rewritten Phase-102
    // honest copy (the dropped daily-mark smoothing framing is gone).
    const b = renderBody(fixtureCompositeGated());
    const bMtm = within(b.container).getByText("Mark-to-market");
    expect(bMtm.getAttribute("aria-disabled")).toBe("true");
    expect(bMtm.getAttribute("title")).toBe(
      "Mark-to-market unavailable: composites that include an options book report cash settlement only.",
    );

    // (d) gated with no reason: the basis-agnostic default fallback copy (Phase 102
    // rewrote "for this composite" → "for this strategy").
    const d = renderBody(fixtureCompositeNoReason());
    const dMtm = within(d.container).getByText("Mark-to-market");
    expect(dMtm.getAttribute("aria-disabled")).toBe("true");
    expect(dMtm.getAttribute("title")).toBe(
      "Mark-to-market unavailable for this strategy.",
    );
  });

  it("no persistence (RED): clicking Mark-to-market writes NOTHING to localStorage or the URL", () => {
    const searchBefore = window.location.search;
    const { getByText } = renderBody(fixtureCompositeAvailable());
    fireEvent.click(getByText("Mark-to-market"));

    const factsheetWrites = localStorageMock.setItem.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && /^factsheet/.test(call[0] as string),
    );
    expect(factsheetWrites).toEqual([]);
    expect(window.location.search).toBe(searchBefore);
  });
});

describe("FactsheetBody — Phase 90 single-key parity (GREEN today AND after)", () => {
  it("discriminator dir 2 (GREEN): single-key renders NO 'Metrics basis' toggle and NO 'Mark-to-market' text", () => {
    const { container, queryByText } = renderBody(fixtureSingleKey());
    expect(
      container.querySelector('[aria-label="Metrics basis"]'),
    ).toBeNull();
    expect(queryByText("Mark-to-market")).toBeNull();
  });

  it("byte-identity spot-check (GREEN): single-key static markup emits none of the Phase-90 composite strings", () => {
    const payload = fixtureSingleKey();
    const html = renderToStaticMarkup(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody
          payload={payload}
          hideHeader
          hideAllocatorSection
          hideFooter={false}
        />
      </FactsheetProvider>,
    );
    expect(html).not.toContain("BASIS ·");
    expect(html).not.toContain("Metrics basis");
    // The Phase-90 gap label uses the em-dash phrasing "— no data". The
    // HeatmapPanels month-cell title ": no data" (colon form) is a DIFFERENT,
    // pre-existing string and is intentionally OUT of scope for this pin.
    expect(html).not.toContain("— no data");
  });
});

/**
 * Phase 102 (MTM-01 / MTM-03) — the SINGLE-KEY options MTM toggle. These fixtures
 * discriminate purely on the server-truth `payload.mtmGate` (NEVER an api-key
 * heuristic — Pitfall 1): a single-key options strategy carries an `mtmGate`; a
 * non-options single-key strategy does not. All additive — every pre-existing
 * assertion above stays byte-untouched.
 */
const LEVERAGE_INPUT_LABEL =
  "Leverage multiplier (1× = unlevered; excludes borrow / funding cost)";

// (e) single-key options, MTM AVAILABLE — carries ONLY mark_to_market (never a
//     cash_settlement key — the SC-4 keystone). No dataQuality.composite.
function fixtureSingleKeyMtmAvailable(): FactsheetPayload {
  return {
    ...base(),
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
  } as unknown as FactsheetPayload;
}
// (f) single-key options, MTM gated with an honest single-key reason.
function fixtureSingleKeyMtmGated(): FactsheetPayload {
  return {
    ...base(),
    mtmGate: { available: false, reason: "mtm_summary_coverage_incomplete" },
  } as unknown as FactsheetPayload;
}
// (g) single-key options, MTM available AND leverageable (periodsPerYear present
//     so the leverage input renders on the cash basis). Drives LEV-MTM-1.
function fixtureSingleKeyMtmLeverage(): FactsheetPayload {
  return {
    ...base(),
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
    periodsPerYear: 365,
  } as unknown as FactsheetPayload;
}

// Read the numeric value cell for a KPI label within a rendered container.
function kpiValue(container: HTMLElement, label: string): string {
  const labelEl = within(container).getAllByText(label)[0]!;
  const cell = labelEl.parentElement as HTMLElement;
  // The value <p> is the label's sibling inside the cell div.
  const value = cell.querySelector("p:last-child");
  return value?.textContent ?? "";
}

describe("FactsheetBody — Phase 102 single-key options MTM toggle", () => {
  it("SK-TOGGLE-1: single-key options with an available mtmGate renders the toggle; activating MTM relabels the KPI scalars", () => {
    const { container } = renderBody(fixtureSingleKeyMtmAvailable());
    const group = container.querySelector(
      '[role="group"][aria-label="Metrics basis"]',
    );
    expect(group, "the single-key options basis toggle group").not.toBeNull();
    // Default cash active; activate mark_to_market.
    fireEvent.click(within(container).getByText("Mark-to-market"));
    // The seven mapped scalars relabel from the PERSISTED mark_to_market object
    // (MTM.cumulative_return 0.5 → +50.0%; MTM.sharpe 1.2 → 1.20), never cash.
    expect(kpiValue(container, "Cum. Return")).toBe("+50.0%");
    expect(kpiValue(container, "Sharpe")).toBe("1.20");
  });

  it("SK-TOGGLE-2: single-key options gated → mark_to_market aria-disabled with the mapped reason copy inline", () => {
    const { container } = renderBody(fixtureSingleKeyMtmGated());
    const mtm = within(container).getByText("Mark-to-market");
    expect(mtm.getAttribute("aria-disabled")).toBe("true");
    // Copy-agnostic: assert the WIRING (the server reason flows to the mapped
    // copy) — the exact string is pinned in Task 3's basis-context tests.
    const expected = mtmDisabledReasonCopy("mtm_summary_coverage_incomplete");
    expect(mtm.getAttribute("title")).toBe(expected);
    // The inline disabled-reason paragraph mirrors the same mapped copy.
    expect(within(container).getAllByText(expected).length).toBeGreaterThan(0);
  });

  it("SK-BYTE-1: a single-key payload with NO mtmGate renders NO SegmentedControl (byte-identity scope)", () => {
    const { container, queryByText } = renderBody(fixtureSingleKey());
    expect(
      container.querySelector('[role="group"][aria-label="Metrics basis"]'),
    ).toBeNull();
    expect(queryByText("Mark-to-market")).toBeNull();
  });

  it("LEV-MTM-1 (no-fabrication guard): leverage=2 under MTM shows PERSISTED MTM scalars and NO MODELED eyebrow", () => {
    const { container } = renderBody(fixtureSingleKeyMtmLeverage());
    // On the cash basis the leverage input is visible — dial it to 2×.
    const input = within(container).getByLabelText(LEVERAGE_INPUT_LABEL);
    fireEvent.change(input, { target: { value: "2" } });
    // Switch to mark_to_market: leverage models the CASH return path, so under an
    // MTM label the hook MUST short-circuit to the persisted overlay (no recompute).
    fireEvent.click(within(container).getByText("Mark-to-market"));
    // KPI cells show the persisted MTM scalars (MTM.cum 0.5 → +50.0%), NOT a
    // leverage-scaled cash number. Neuter check: remove the basis guard in
    // useLeveragedMetrics → leveraged cash renders here + a MODELED eyebrow → RED.
    expect(kpiValue(container, "Cum. Return")).toBe("+50.0%");
    // No fabricated MODELED line under MTM.
    expect(within(container).queryByText(/MODELED/)).toBeNull();
  });
});

/**
 * Phase 103 (MTM-04) — the KEYSTONE falsifiable per-basis SERIES test. This is the
 * test that did NOT exist in Phase 102 (Nyquist): it proves the CHARTS and every
 * DAILIES-DERIVABLE panel — INCLUDING correlations (MTM-04 correction: the strategy
 * leg regresses the basis-selected dailies, so ρ follows the basis) — read the MTM
 * bundle under mark_to_market. Falsifiable BOTH ways:
 *   - neuter the useBasisSeriesView merge (return payload always) → the charts +
 *     dailies-derivable panels stay cash under MTM → the MTM sentinels vanish → RED.
 *   - correlations NOT following (bundle omits them) → RED the other way (the MTM
 *     sentinel correlation would be missing under MTM).
 *
 * The fixture's MTM bundle carries DISTINGUISHABLE sentinels the cash top-level
 * cannot produce: a shorter 200-day axis, a single MTM-only gap span
 * ("5d — no data"), a calmar-by-year row for the impossible year "1999", a
 * P5 quantile of exactly -9.0% ("P5 -9.0%"), and an MTM-only correlation
 * ("SENTINEL_MTM_BTC") that REPLACES the cash "SENTINEL_BTC" under mark_to_market.
 */
function bundleFromScenario(p: FactsheetPayload) {
  return {
    dates: p.dates,
    strategyReturns: p.strategyReturns,
    // Phase 103 Finding C sentinel: an equity curve whose endpoint/base ratio the
    // calm cash series can never produce. periodReturn(3Y/5Y) = last/eq[0]-1 =
    // 6.54/1 - 1 = +554.00%. If the 3Y/5Y rows revert to cash equity → gone → RED.
    strategyEquity: p.strategyEquity.map((_, i, arr) => (i === arr.length - 1 ? 6.54 : 1)),
    strategyDrawdowns: p.strategyDrawdowns,
    strategyRollingVol: p.strategyRollingVol,
    // Phase 103 Finding B sentinel: a constant rolling-Sharpe the calm cash series
    // can never produce (9.87 in every Now/Avg/Min/Max cell). If the rolling table
    // reverts to cash under MTM, "9.87" vanishes → RED.
    strategyRollingSharpe: p.strategyRollingSharpe.map(() => 9.87),
    strategyRollingSortino: p.strategyRollingSortino,
    rollingWindow: p.rollingWindow,
    rollingBetaWindow: p.rollingBetaWindow,
    strategyWorst10: p.strategyWorst10,
    comparators: p.comparators,
    monthlyReturns: p.monthlyReturns,
    dailyHeatmap: p.dailyHeatmap,
    // MTM-only coverage mask (the cash top-level base() carries NONE), so the
    // cumulative chart's gap seam is the falsifiable "charts followed" proof.
    missingSegments: [{ start: "2023-03-01", end: "2023-03-05", kind: "gap" as const, days: 5 }],
    // Sentinel quantiles: P5 = -9.0% is far outside the calm cash distribution.
    // Tail Ratio (P95/|P5|) = |0.08 / -0.09| = 0.888… → "0.89" — a checkable
    // arithmetic identity against the P5/P95 rows shown (Finding A).
    quantiles: { p05: -0.09, p25: -0.02, p50: 0.0234, p75: 0.03, p95: 0.08, min: -0.2, max: 0.2, mean: 0.01 },
    // Phase 103 Finding A sentinel: an extended distribution scalar (skew = -7.77)
    // the calm cash series can never produce, plus a profit-factor feeding the
    // common-sense ratio. If ExtendedMetrics reverts to cash strategyMetrics → gone.
    strategyMetrics: { ...p.strategyMetrics, skew: -7.77, profit_factor: 2 },
    streaks: p.streaks,
    // Sentinel year the cash series (all 2023) can never produce.
    calmarByYear: [{ year: "1999", ret: 0.42, max_dd: -0.1, calmar: 4.2, days: 250 }],
    // Phase 103 Finding #6 sentinel: an MTM resample count BELOW 252 while the cash
    // series (300 days) clears it — the low-N reliability warning must fire under MTM
    // ("drawn from 180 observations") and NOT under cash.
    bootstrapCI: { ...p.bootstrapCI, n: 180 },
    styleDrift: p.styleDrift,
    stressWindows: p.stressWindows,
    // Phase 103 (MTM-04 correction) sentinel: correlations FOLLOW the basis (the
    // strategy leg regresses the basis-selected dailies). The MTM-only ρ label
    // ("SENTINEL_MTM_RHO") REPLACES the cash "SENTINEL_BTC" under mark_to_market;
    // the matrix carries an MTM-only diagonal label ("MTMASSET"). If correlations
    // wrongly stayed cash (bundle omits them) → these sentinels missing under MTM → RED.
    correlations: [{ name: "SENTINEL_MTM_RHO", rho: -0.91 }],
    correlationMatrix: { labels: ["S", "MTMASSET"], matrix: [[1, -0.91], [-0.91, 1]] },
  };
}

// (h) single-key options, MTM available WITH a full per-basis SERIES bundle whose
//     values are distinguishable from the cash top-level (distinct axis + gap +
//     sentinel calmar year + sentinel P5). The cash top-level carries "SENTINEL_BTC"
//     correlation; the MTM bundle carries "SENTINEL_MTM_RHO" — under mark_to_market
//     the correlation strip must SWAP to the MTM sentinel (MTM-04 correction).
function fixtureSingleKeyMtmBundle(): FactsheetPayload {
  const cash = base(); // 300 days
  const mtm = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(200, 0.004),
    benchmark: null,
  }) as unknown as FactsheetPayload;
  return {
    ...cash,
    correlations: [{ name: "SENTINEL_BTC", rho: 0.42 }],
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
    seriesByBasis: { mark_to_market: bundleFromScenario(mtm) },
  } as unknown as FactsheetPayload;
}

// (i) §IV benchmark-joint fixture: an ACTIVE BTC comparator carrying a joint under
//     BOTH bases. The cash comparator joint (alpha +11.00%) and the MTM bundle's
//     comparator joint (alpha +420.00%, beta 3.33, IR 6.66) are distinguishable, so
//     §IV must SWAP to the MTM joint under mark_to_market (it regresses the MTM
//     strategy leg). Distinct sentinels avoid collision with the 9.87 rolling-Sharpe.
const CASH_JOINT = {
  alpha: 0.11, beta: 1.11, corr: 0.5, r2: 0.25, info_ratio: 0.22,
  treynor: 0.1, tracking_error: 0.05, up_capture: 1.1, down_capture: 0.9,
};
const MTM_JOINT = {
  alpha: 4.2, beta: 3.33, corr: -0.9, r2: 0.81, info_ratio: 6.66,
  treynor: 0.5, tracking_error: 0.07, up_capture: 1.5, down_capture: 0.4,
};
function fixtureSingleKeyMtmJoint(): FactsheetPayload {
  const cash = base();
  const mtm = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(200, 0.004),
    benchmark: null,
  }) as unknown as FactsheetPayload;
  const mtmBundle = bundleFromScenario(mtm);
  return {
    ...cash,
    activeComparator: "btc",
    comparators: {
      ...cash.comparators,
      btc: { ...cash.comparators.btc, joint: CASH_JOINT },
    },
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
    seriesByBasis: {
      mark_to_market: {
        ...mtmBundle,
        comparators: {
          ...mtmBundle.comparators,
          btc: { ...mtmBundle.comparators.btc, joint: MTM_JOINT },
        },
      },
    },
  } as unknown as FactsheetPayload;
}

// (j) PARITY fixture (STEP-3, Phase-103 F3): the bundle's TS-recomputed seven
//     headline scalars DELIBERATELY DIVERGE from the persisted MTM object. This is
//     the REAL cross-runtime divergence the earlier FAKED keystone hid by forcing
//     bundle == persisted: on a gappy composite the client TS compute() over the
//     SPARSE rows (no gap-fill) yields Sharpe ≈ Python/√(N/D), and under
//     `cumulative_method:"simple"` (Zavara allocated-capital) Python is arithmetic
//     Σr while TS is geometric — so the bundle's own strategyMetrics can NOT equal
//     the persisted seven. The F3 overlay in useBasisSeriesView must make the rail
//     DISPLAY the PERSISTED seven (MTM.*, the KpiStrip source), NOT these divergent
//     bundle values — that is what makes KpiStrip == rail BY CONSTRUCTION. The
//     divergent numbers are the neuter witnesses: strip the overlay and the rail
//     falls back to the bundle's +90.00% / 5.50 and the parity assertions RED.
function fixtureSingleKeyMtmParity(): FactsheetPayload {
  const cash = base(); // 300-day calm cash series (rail cash cum ≠ +50%)
  const mtm = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(200, 0.004),
    benchmark: null,
  }) as unknown as FactsheetPayload;
  const bundle = bundleFromScenario(mtm);
  // The bundle's seven diverge from the persisted MTM (the sparse-TS /
  // arithmetic-vs-geometric gap). The persisted MTM object is authoritative.
  const divergentBundle = {
    ...bundle,
    strategyMetrics: {
      ...bundle.strategyMetrics,
      cum_ret: 0.9, // persisted MTM.cumulative_return 0.5 → the rail must show +50%, not +90%
      ann_vol: 0.99, // persisted MTM.volatility 0.11
      max_dd: -0.5, // persisted MTM.max_drawdown -0.038
      cagr: 0.88, // persisted MTM.cagr 0.26
      sharpe: 5.5, // persisted MTM.sharpe 1.2 → the rail must show 1.20, not 5.50
      sortino: 6.6, // persisted MTM.sortino 1.9
      calmar: 7.7, // persisted MTM.calmar 2.7
    },
  };
  return {
    ...cash,
    metricsByBasis: { mark_to_market: MTM },
    mtmGate: { available: true },
    seriesByBasis: { mark_to_market: divergentBundle },
  } as unknown as FactsheetPayload;
}

// Read a rail row's STRATEGY value cell, scoped to a specific Panel <section> by its
// <h3> title so "Sharpe"/"Sortino" (which also label the Rolling Metrics table)
// resolve unambiguously. Rail rows are <tr><td>label</td><td>strategy</td><td>bench</td>.
function railValue(container: HTMLElement, panelTitle: string, rowLabel: string): string {
  const heading = within(container)
    .getAllByText(panelTitle)
    .find((el) => el.tagName === "H3");
  const section = heading?.closest("section") as HTMLElement;
  const labelTd = Array.from(section.querySelectorAll("td")).find(
    (td) => td.textContent === rowLabel,
  );
  return (labelTd?.nextElementSibling as HTMLElement | null)?.textContent ?? "";
}

// Strip +/% so "+50.0%", "-3.80%", "1.20" all parse to their numeric value.
const numOf = (s: string): number => Number(s.replace(/[+%]/g, ""));

describe("FactsheetBody — Phase 103 MTM-04 per-basis SERIES (charts + panels follow)", () => {
  it("KEYSTONE: charts + dailies-derivable panels follow the MTM bundle; external panels stay cash (falsifiable BOTH ways)", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmBundle());

    // Default cash: the MTM sentinels are ABSENT; the cash correlation is present.
    expect(container.textContent).not.toContain("5d — no data");
    expect(container.textContent).not.toContain("1999");
    expect(container.textContent).not.toContain("P5 -9.0%");
    expect(container.textContent).toContain("SENTINEL_BTC");
    expect(container.textContent).not.toContain("SENTINEL_MTM_RHO");

    // Toggle to mark_to_market.
    fireEvent.click(getByText("Mark-to-market"));

    // (1) CHARTS follow: the cumulative chart renders the MTM bundle's gap seam.
    //     Neuter the useBasisSeriesView merge → charts stay cash → NO gap → RED.
    expect(container.textContent).toContain("5d — no data");
    // The basis-aware caption confirms the charts followed (not the fallback copy).
    expect(getByText("Charts show the mark-to-market series.")).toBeTruthy();

    // (1b) DAILIES-DERIVABLE panels follow: Calmar-by-year (sentinel year) AND the
    //      quantile box (sentinel P5). Both go RED if the merge is neutered.
    expect(container.textContent).toContain("1999");
    expect(container.textContent).toContain("P5 -9.0%");

    // (1c) CORRELATIONS FOLLOW MTM (MTM-04 correction): the correlation strip SWAPS
    //      from the cash "SENTINEL_BTC" to the bundle's "SENTINEL_MTM_RHO", and the
    //      matrix shows the MTM-only "MTMASSET" label. Falsifiable the other way — a
    //      bundle omitting correlations (passthrough) would keep the cash sentinel.
    expect(container.textContent).toContain("SENTINEL_MTM_RHO");
    expect(container.textContent).toContain("MTMASSET");
    expect(container.textContent).not.toContain("SENTINEL_BTC");
  });

  it("cash unchanged + toggling back restores cash (the MTM sentinels disappear)", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmBundle());
    expect(container.textContent).not.toContain("1999");
    expect(container.textContent).not.toContain("5d — no data");

    fireEvent.click(getByText("Mark-to-market"));
    expect(container.textContent).toContain("1999");
    expect(container.textContent).toContain("5d — no data");

    fireEvent.click(getByText("Cash settlement"));
    expect(container.textContent).not.toContain("1999");
    expect(container.textContent).not.toContain("5d — no data");
    // Cash caption is empty (unchanged idiom), never the MTM copy.
    expect(container.textContent).not.toContain("Charts show the mark-to-market series.");
  });

  it("FALLBACK: bundle ABSENT under MTM → charts stay cash + honest fallback caption; KpiStrip scalars STILL swap (Phase 102 preserved)", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmAvailable()); // no seriesByBasis
    fireEvent.click(getByText("Mark-to-market"));
    // No bundle → charts DID NOT follow → no MTM gap seam.
    expect(container.textContent).not.toContain("5d — no data");
    // Honest fallback caption (stale cache / not-yet-backfilled — Zavara pre-backfill).
    expect(
      getByText(
        "Charts show the cash-settlement series. Mark-to-market applies to summary metrics only.",
      ),
    ).toBeTruthy();
    // The persisted MTM scalar overlay (Phase 102) still relabels the KpiStrip.
    expect(kpiValue(container, "Cum. Return")).toBe("+50.0%");
    // F4: the rail eyebrow must NOT claim "BASIS · MARK-TO-MARKET" here — the series
    // bundle is ABSENT so the rail's dailies panels render CASH. Gating the eyebrow
    // on `basis` alone (the neuter) would mislabel that cash rail as MTM → this
    // assertion reddens.
    expect(container.textContent).not.toContain("BASIS · MARK-TO-MARKET");
  });

  it("NO-PERSISTENCE: toggling the bundle fixture writes NOTHING to localStorage or the URL", () => {
    const searchBefore = window.location.search;
    const { getByText } = renderBody(fixtureSingleKeyMtmBundle());
    fireEvent.click(getByText("Mark-to-market"));
    const factsheetWrites = localStorageMock.setItem.mock.calls.filter(
      (call) => typeof call[0] === "string" && /^factsheet/.test(call[0] as string),
    );
    expect(factsheetWrites).toEqual([]);
    expect(window.location.search).toBe(searchBefore);
  });
});

/**
 * Phase 103 (MTM-04 follow-through) — the dailies-derivable RAIL panels that read
 * the persisted-cash scalars while their paired charts render MTM. Each assertion
 * is falsifiable: the MTM sentinel (only reachable through the bundle) must appear
 * under mark_to_market and vanish under cash. Reverting the panel to `payload.*`
 * reddens the corresponding case.
 */
describe("FactsheetBody — Phase 103 MTM-04 dailies-derivable rail follow-through", () => {
  it("Finding B: the Rolling Metrics summary TABLE follows MTM (matches its chart)", () => {
    const { getByText } = renderBody(fixtureSingleKeyMtmBundle());
    // Scope to the "Rolling Metrics" summary panel — NOT the rolling charts (which
    // already read the bundle), so this isolates the TABLE's basis follow-through.
    const rollingSection = () =>
      getByText(/Rolling Metrics/).closest("section") as HTMLElement;
    // Cash: the sentinel rolling Sharpe (9.87) is absent from the table.
    expect(rollingSection().textContent).not.toContain("9.87");
    fireEvent.click(getByText("Mark-to-market"));
    // MTM: the table now reads the bundle's rolling arrays (9.87 in every cell).
    // Neuter (RollingMetricsPanel → payload.strategyRolling*) → cash → RED.
    expect(rollingSection().textContent).toContain("9.87");
  });

  it("Finding C: the Cumulative-Returns 3Y/5Y rows follow the MTM equity curve", () => {
    const { getByText } = renderBody(fixtureSingleKeyMtmBundle());
    const cumSection = () =>
      getByText("Cumulative Return Metrics").closest("section") as HTMLElement;
    // Cash: the sentinel 3Y/5Y return (+554.00%) is absent.
    expect(cumSection().textContent).not.toContain("+554.00%");
    fireEvent.click(getByText("Mark-to-market"));
    // MTM: 3Y/5Y recompute from the bundle's equity curve.
    // Neuter (CumulativeReturnsPanel eq → payload.strategyEquity) → cash → RED.
    expect(cumSection().textContent).toContain("+554.00%");
  });

  it("Finding #6: the bootstrap low-N warning reflects the MTM resample count", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmBundle());
    // Cash: 300-day series clears 252 → no low-N warning, and never the MTM count.
    expect(container.textContent).not.toContain("drawn from 180 observations");
    fireEvent.click(getByText("Mark-to-market"));
    // MTM: the bundle's bootstrap n=180 (<252) fires the reliability warning.
    // Neuter (BootstrapCIPanel lowN → view.strategyMetrics.n = cash 300) → RED.
    expect(container.textContent).toContain("drawn from 180 observations");
  });

  it("Finding A: extended distribution scalars + tail-ratio follow MTM (tail == P95/|P5| of the shown rows)", () => {
    const { getByText } = renderBody(fixtureSingleKeyMtmBundle());
    const extSection = () =>
      getByText("Extended Metrics").closest("section") as HTMLElement;
    // Cash: the sentinel skew is absent.
    expect(extSection().textContent).not.toContain("-7.77");
    fireEvent.click(getByText("Mark-to-market"));
    const ext = extSection();
    // Extended scalars follow MTM (skew sentinel from the bundle's strategyMetrics).
    // Neuter (strip strategyMetrics from the bundle) → cash skew → RED.
    expect(ext.textContent).toContain("-7.77");
    // The shown P5/P95 rows and the Tail Ratio are arithmetically consistent:
    // Tail Ratio = |P95 / P5| = |0.08 / -0.09| = 0.89.
    expect(ext.textContent).toContain("-9.00%"); // P5 row
    expect(ext.textContent).toContain("+8.00%"); // P95 row
    expect(ext.textContent).toContain("0.89"); // Tail Ratio == |P95/|P5||
  });

  it("correction: §IV benchmark α/β/IR follow MTM (the joint regresses the MTM strategy leg)", () => {
    const { getByText } = renderBody(fixtureSingleKeyMtmJoint());
    const benchSection = () =>
      getByText(/Benchmark —/).closest("section") as HTMLElement;
    // Cash: §IV shows the cash joint sentinels (alpha +11.00%); the MTM ones absent.
    expect(benchSection().textContent).toContain("+11.00%"); // cash alpha
    expect(benchSection().textContent).not.toContain("+420.00%");
    fireEvent.click(getByText("Mark-to-market"));
    const s = benchSection();
    // MTM: §IV reads view.comparators[cmp].joint (bundle-computed from MTM strat
    // returns + benchmark). Neuter (§IV → cash payload.comparators joint) → cash → RED.
    expect(s.textContent).toContain("+420.00%"); // MTM alpha (ann)
    expect(s.textContent).toContain("3.33"); // MTM beta
    expect(s.textContent).toContain("6.66"); // MTM information ratio
    expect(s.textContent).not.toContain("+11.00%"); // cash alpha gone
  });

  it("F5: the KpiStrip α/IR cells follow MTM (consistent with §IV), no longer suppressed to '—'", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmJoint());
    // Cash: the strip renders the CASH joint α/IR (pctSigned(0.11,1) / num(0.22)).
    expect(kpiValue(container, "α vs BTC")).toBe("+11.0%");
    expect(kpiValue(container, "IR vs BTC")).toBe("0.22");

    fireEvent.click(getByText("Mark-to-market"));

    // MTM + bundle: the strip α/IR SWAP to the bundle's MTM joint (pctSigned(4.2,1)
    // = +420.0%, num(6.66) = 6.66) — consistent with §IV, which shows the same joint.
    // Neuter (revert suppressRelative to `basis === "mark_to_market" || modeled`) →
    // both cells render "—" while §IV shows the MTM joint → these RED.
    expect(kpiValue(container, "α vs BTC")).toBe("+420.0%");
    expect(kpiValue(container, "IR vs BTC")).toBe("6.66");
  });

  it("F8: the KpiStrip low-N caveat reflects the MTM observation count, not cash", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmBundle());
    const caveat =
      "annualized metrics (CAGR, Sharpe, Sortino, Calmar, Ann. Vol) may not be statistically significant";
    // Cash: the 300-day series clears 252 → the KpiStrip caveat is ABSENT.
    expect(container.textContent).not.toContain(caveat);
    fireEvent.click(getByText("Mark-to-market"));
    // MTM: the bundle's ~200-day series is < 252 → the caveat fires, reading the MTM
    // observation count from the view. Neuter (revert to `m.n` = the cash 300) → no
    // caveat under MTM → RED.
    expect(container.textContent).toContain(caveat);
  });

  it("STEP-3 PARITY (F3): the rail §I displays the PERSISTED seven, NOT the divergent bundle TS recompute (overlay wins — neuter → RED)", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmParity());

    // Pre-toggle sanity: the rail §I cash cum_ret is the 300-day scenario's own
    // value, NOT the +50% MTM sentinel — so the post-toggle match is a real swap,
    // not a fixture that already shows MTM under cash.
    expect(railValue(container, "Main Metrics", "Cumulative Return")).not.toBe("+50.00%");

    fireEvent.click(getByText("Mark-to-market"));

    // CORE OF F3: under MTM the rail displays the PERSISTED Python seven (MTM.*),
    // even though the bundle's OWN strategyMetrics carries divergent TS values
    // (cum 0.9 → +90.00%, sharpe 5.50). The F3 overlay in useBasisSeriesView makes
    // view.strategyMetrics carry the persisted seven. NEUTER (remove the overlay) →
    // the rail falls back to the bundle's +90.00% / 5.50 → every line below reddens.
    expect(railValue(container, "Main Metrics", "Cumulative Return")).toBe("+50.00%");
    expect(railValue(container, "Main Metrics", "Sharpe")).toBe("1.20");
    expect(railValue(container, "Main Metrics", "Sortino")).toBe("1.90");
    expect(railValue(container, "Main Metrics", "Calmar")).toBe("2.70");

    // And KpiStrip == rail BY CONSTRUCTION — both now trace to the SAME persisted
    // seven. The three RATIO scalars format identically (2dp `num`) on both surfaces.
    for (const [kpiLabel, railLabel] of [
      ["Sharpe", "Sharpe"],
      ["Sortino", "Sortino"],
      ["Calmar", "Calmar"],
    ] as const) {
      expect(railValue(container, "Main Metrics", railLabel)).toBe(
        kpiValue(container, kpiLabel),
      );
    }

    // The four PERCENTAGE scalars use DIFFERENT display precision by design — the
    // KpiStrip glances at 1dp (`pctSigned`/`pct`), the rail details at 2dp
    // (`pct(_, true)`/`pctNeg`). "== to display precision" therefore means the rail's
    // 2dp value ROUNDED to the strip's 1dp equals the strip value. Now that BOTH read
    // the persisted seven, they trace to ONE number, so this holds by construction.
    const pctPairs: Array<[string, string, string]> = [
      ["Cum. Return", "Main Metrics", "Cumulative Return"],
      ["CAGR", "Main Metrics", "CAGR"],
      ["Ann. Vol", "Main Metrics", "Ann. Volatility"],
      ["Max DD", "Max Drawdown", "Max Drawdown"],
    ];
    for (const [kpiLabel, panel, railLabel] of pctPairs) {
      const kpi = numOf(kpiValue(container, kpiLabel));
      const rail = numOf(railValue(container, panel, railLabel));
      // Rail (2dp) rounded to the strip's 1dp precision must equal the strip value.
      expect(Number(rail.toFixed(1))).toBe(kpi);
    }
    expect(kpiValue(container, "Cum. Return")).toBe("+50.0%");
  });

  it("STEP-4 double-display dissolved: a scalar duplicated across §I and the Extended panel shows the SAME MTM number", () => {
    const { container, getByText } = renderBody(fixtureSingleKeyMtmBundle());
    const extSection = () =>
      getByText("Extended Metrics").closest("section") as HTMLElement;

    // Cash: §I Skew is the calm-scenario value, NOT the bundle's -7.77 sentinel.
    expect(railValue(container, "Main Metrics", "Skew")).not.toBe("-7.77");

    fireEvent.click(getByText("Mark-to-market"));

    // Under MTM the §I Main-Metrics "Skew" row and the Extended-Metrics panel now
    // read the SAME view.strategyMetrics — before the root-cause flip §I stayed cash
    // while Extended followed MTM (the double-display contradiction). Both show the
    // bundle sentinel -7.77. Neuter §I (`m` → payload) → §I reverts to cash → RED.
    expect(railValue(container, "Main Metrics", "Skew")).toBe("-7.77");
    expect(extSection().textContent).toContain("-7.77");
  });
});
