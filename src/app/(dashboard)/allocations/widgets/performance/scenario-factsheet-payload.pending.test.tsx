import { useEffect } from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, render, waitFor, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { coveredDays, figureRecord, gateAnnualized, shortTrackNote } from "@/lib/figure-gate";
import type { OwnBookDeltaPayload, PeerPercentilePayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import { buildScenarioFactsheetPayload } from "./scenario-factsheet-payload";

/**
 * Phase 213 plan 10, decision (d), SC-4: while a blend leg's asset-class probe is
 * open, the basis the composer holds (`blendBasis`) is the interim one, so the
 * factsheet preview must show NO number computed on it. One optional input
 * (`basisPending`) to `buildScenarioFactsheetPayload` holds every basis-dependent
 * slot silently; every basis-invariant slot is untouched and the default is
 * byte-identical.
 *
 * Two layers, because each proves something the other cannot:
 *  - builder-level: which fields move and which do not (so a held field cannot be
 *    silently widened to the whole payload, and the default-off build is unchanged);
 *  - a differential render of the REAL `FactsheetBody` (the composer's mount shape),
 *    pending versus settled over the same blend, because the user reads the rendered
 *    rail, not the payload. The settled render is asserted FIRST on every slot, so a
 *    dash in the pending render is the hold and not an empty fixture.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => void lsStore.set(k, v)),
  removeItem: vi.fn((k: string) => void lsStore.delete(k)),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
beforeAll(async () => {
  await import("@/app/factsheet/[id]/v2/HeatmapPanels");
});

/** n consecutive calendar days of a varied, non-degenerate daily return series. */
function series(n: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  const d = new Date(Date.UTC(2023, 0, 1));
  for (let i = 0; i < n; i++) {
    out.push({
      date: d.toISOString().slice(0, 10),
      value: 0.0015 + Math.sin(i * 0.27) * 0.005 - (i % 9 === 0 ? 0.004 : 0),
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const PEER: PeerPercentilePayload = { cohortSize: 42, sharpe: 71, sortino: 64, max_dd: 58 };
const OWN_BOOK: OwnBookDeltaPayload = {
  sharpe: 0.4,
  sortino: 0.6,
  max_dd: 0.01,
  blend_n: 400,
  book_n: 300,
  span_days: 300,
  records: {
    blend: { spanDays: 400, observations: 400, crypto: false },
    book: { spanDays: 300, observations: 300, crypto: false },
  },
};

const INTERIM = 365; // the nullish => 365 rule while a probe is open
const FINAL = 252; // the basis the leg settles on (traditional)

describe("buildScenarioFactsheetPayload decision (d): basisPending, builder level", () => {
  it("decision (d): ann_vol, sharpe and sortino are NaN, figureRecord is absent, and the six rolling series are empty while pending", () => {
    const rets = series(400);
    const settled = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM });
    // Non-vacuity: the unheld build has real numbers in every one of these slots.
    expect(Number.isFinite(settled.strategyMetrics.ann_vol)).toBe(true);
    expect(Number.isFinite(settled.strategyMetrics.sharpe)).toBe(true);
    expect(Number.isFinite(settled.strategyMetrics.sortino)).toBe(true);
    expect(settled.figureRecord).toBeDefined();
    expect(settled.strategyRollingVol.length).toBeGreaterThan(0);
    expect(settled.strategyRollingVol1y).not.toBeNull();

    const held = buildScenarioFactsheetPayload({
      portfolioDaily: rets,
      periodsPerYear: INTERIM,
      basisPending: true,
    });
    expect(Number.isNaN(held.strategyMetrics.ann_vol)).toBe(true);
    expect(Number.isNaN(held.strategyMetrics.sharpe)).toBe(true);
    expect(Number.isNaN(held.strategyMetrics.sortino)).toBe(true);
    expect("figureRecord" in held).toBe(false);
    expect(held.strategyRollingVol).toEqual([]);
    expect(held.strategyRollingSharpe).toEqual([]);
    expect(held.strategyRollingSortino).toEqual([]);
    expect(held.strategyRollingVol1y).toBeNull();
    expect(held.strategyRollingSharpe1y).toBeNull();
    expect(held.strategyRollingSortino1y).toBeNull();
    // The verdict that names a cause is dropped, and so is the 1y window.
    expect(held.rollingWindow.annualization).toBeUndefined();
    expect(held.rollingWindow1y).toBeNull();
  });

  it("decision (d): the bootstrap Sharpe and Sortino are the silent NaN form; the basis-invariant Max Drawdown interval and the resample counts are untouched", () => {
    const rets = series(400);
    const settled = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM });
    const held = buildScenarioFactsheetPayload({
      portfolioDaily: rets,
      periodsPerYear: INTERIM,
      basisPending: true,
    });
    expect(Number.isFinite(settled.bootstrapCI.sharpe.point)).toBe(true);
    expect(Number.isNaN(held.bootstrapCI.sharpe.point)).toBe(true);
    expect(Number.isNaN(held.bootstrapCI.sharpe.lo)).toBe(true);
    expect(Number.isNaN(held.bootstrapCI.sortino.hi)).toBe(true);
    expect(held.bootstrapCI.sharpe.hist.bins).toEqual([]);
    // No n_valid: a 0 here would print "no resample has a Sharpe" under the table.
    expect(held.bootstrapCI.sharpe.n_valid).toBeUndefined();
    expect(held.bootstrapCI.max_dd).toEqual(settled.bootstrapCI.max_dd);
    expect(held.bootstrapCI.n_resamples).toBe(settled.bootstrapCI.n_resamples);
    expect(held.bootstrapCI.block_len).toBe(settled.bootstrapCI.block_len);
    expect(held.bootstrapCI.n).toBe(settled.bootstrapCI.n);
  });

  it("decision (d): every basis-invariant field equals the unheld build (equity, drawdowns, returns, heatmaps, streaks, quantiles, the other metrics)", () => {
    const rets = series(400);
    const settled = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM });
    const held = buildScenarioFactsheetPayload({
      portfolioDaily: rets,
      periodsPerYear: INTERIM,
      basisPending: true,
    });
    expect(held.dates).toEqual(settled.dates);
    expect(held.strategyEquity).toEqual(settled.strategyEquity);
    expect(held.strategyDrawdowns).toEqual(settled.strategyDrawdowns);
    expect(held.strategyReturns).toEqual(settled.strategyReturns);
    expect(held.monthlyReturns).toEqual(settled.monthlyReturns);
    expect(held.dailyHeatmap).toEqual(settled.dailyHeatmap);
    expect(held.streaks).toEqual(settled.streaks);
    expect(held.quantiles).toEqual(settled.quantiles);
    expect(held.calmarByYear).toEqual(settled.calmarByYear);
    expect(held.rollingBetaWindow).toEqual(settled.rollingBetaWindow);
    // Every scalar metric except the three held ones (and the CAGR / Calmar pair, whose
    // verdicts agree on this record, see the next case) is the same number.
    const { ann_vol: _a, sharpe: _s, sortino: _so, ...heldRest } = held.strategyMetrics;
    const { ann_vol: _a2, sharpe: _s2, sortino: _so2, ...settledRest } = settled.strategyMetrics;
    expect(heldRest).toEqual(settledRest);
  });

  it("decision (d): CAGR and Calmar are unchanged when the 365 and 252 gate verdicts agree on the blend record (120 days: both clear)", () => {
    const rets = series(120);
    const at365 = gateAnnualized(
      figureRecord({ seriesStart: rets[0].date, seriesEnd: rets[119].date, observations: 120, periodsPerYear: 365 }),
    );
    const at252 = gateAnnualized(
      figureRecord({ seriesStart: rets[0].date, seriesEnd: rets[119].date, observations: 120, periodsPerYear: 252 }),
    );
    expect(at365).toBe(at252);
    const settled = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM });
    const held = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM, basisPending: true });
    expect(Number.isFinite(settled.strategyMetrics.cagr)).toBe(true);
    expect(held.strategyMetrics.cagr).toBe(settled.strategyMetrics.cagr);
    expect(held.strategyMetrics.calmar).toBe(settled.strategyMetrics.calmar);
  });

  it("decision (d): CAGR and Calmar are NaN when the verdicts differ (70 days: 252 clears on 70 observations, 365 needs a 90-day span)", () => {
    const rets = series(70);
    const rec = (ppy: number) =>
      figureRecord({ seriesStart: rets[0].date, seriesEnd: rets[69].date, observations: 70, periodsPerYear: ppy });
    expect(gateAnnualized(rec(365))).not.toBe(gateAnnualized(rec(252)));
    const settled = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM });
    // Non-vacuity: the unheld build has a finite CAGR and Calmar to withhold.
    expect(Number.isFinite(settled.strategyMetrics.cagr)).toBe(true);
    expect(Number.isFinite(settled.strategyMetrics.calmar)).toBe(true);
    const held = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: INTERIM, basisPending: true });
    expect(Number.isNaN(held.strategyMetrics.cagr)).toBe(true);
    expect(Number.isNaN(held.strategyMetrics.calmar)).toBe(true);
  });

  it("decision (d): basisPending omitted or false builds a payload deep-equal to today's", () => {
    const rets = series(400);
    const today = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: FINAL });
    expect(buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: FINAL, basisPending: false })).toEqual(
      today,
    );
    // The held build is a different payload, so the equality above is not vacuous.
    expect(
      buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: FINAL, basisPending: true }),
    ).not.toEqual(today);
  });

  it("decision (d): the peer and own-book carve-outs are left off while pending (each prints a sample/{N} basis caption) and present once settled", () => {
    const rets = series(400);
    const carveOuts = { scenarioPeer: PEER, scenarioOwnBookDelta: OWN_BOOK };
    const settled = buildScenarioFactsheetPayload({ portfolioDaily: rets, periodsPerYear: FINAL, ...carveOuts });
    expect(settled.scenarioPeer).toEqual(PEER);
    expect(settled.scenarioOwnBookDelta).toEqual(OWN_BOOK);
    const held = buildScenarioFactsheetPayload({
      portfolioDaily: rets,
      periodsPerYear: INTERIM,
      basisPending: true,
      ...carveOuts,
    });
    expect("scenarioPeer" in held).toBe(false);
    expect("scenarioOwnBookDelta" in held).toBe(false);
    // The basis-invariant mandate carve-out is not a basis consumer and is kept.
    const mandate = { constituents: [] } as never;
    expect(
      buildScenarioFactsheetPayload({ portfolioDaily: rets, basisPending: true, scenarioMandate: mandate })
        .scenarioMandate,
    ).toBe(mandate);
  });

  it("decision (d): a degenerate (empty) blend is unchanged by basisPending", () => {
    expect(buildScenarioFactsheetPayload({ portfolioDaily: [], basisPending: true })).toEqual(
      buildScenarioFactsheetPayload({ portfolioDaily: [] }),
    );
  });
});

// ---------------------------------------------------------------------------
// Differential render of the REAL FactsheetBody, the composer's mount shape.
// ---------------------------------------------------------------------------

function mount(
  portfolioDaily: DailyPoint[],
  periodsPerYear: number,
  basisPending: boolean,
  carveOuts: { scenarioPeer?: PeerPercentilePayload; scenarioOwnBookDelta?: OwnBookDeltaPayload } = {},
) {
  const payload = buildScenarioFactsheetPayload({ portfolioDaily, periodsPerYear, basisPending, ...carveOuts });
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideHeader hideFooter={false} />
    </FactsheetProvider>,
  );
  return { payload, ...view };
}

async function settleHeatmaps(container: HTMLElement) {
  const heatmaps = container.querySelector("#factsheet-heatmaps");
  if (heatmaps) {
    await waitFor(() => expect(heatmaps.querySelectorAll(".animate-pulse").length).toBe(0));
  }
}

/** The rail row's value cell: the text the user reads beside a metric label. */
function railValue(container: HTMLElement, label: string): string {
  const cells = Array.from(container.querySelectorAll("tr")).filter(
    (tr) => tr.querySelector("td")?.textContent?.trim() === label,
  );
  expect(cells.length, `no rail row labelled ${label}`).toBeGreaterThan(0);
  return cells[0].querySelectorAll("td")[1]?.textContent?.trim() ?? "";
}

function bootstrapCi(container: HTMLElement, label: string): string {
  const section = Array.from(container.querySelectorAll("section")).find((s) =>
    s.textContent?.includes("Bootstrap 95% Confidence"),
  );
  expect(section, "no bootstrap panel").toBeTruthy();
  const row = Array.from(section!.querySelectorAll("tr")).find(
    (tr) => tr.querySelector("td")?.textContent?.trim() === label,
  );
  expect(row, `no bootstrap row ${label}`).toBeTruthy();
  const cells = row!.querySelectorAll("td");
  return cells[cells.length - 1].textContent?.trim() ?? "";
}

describe("FactsheetBody decision (d): the preview holds every annualized-risk slot silently while a leg is pending", () => {
  // 200 consecutive days: under one year, so a SETTLED render states its short-record
  // captions (the rail's blend note, the rolling note). The 400-day case below carries
  // the 1y window.
  const SHORT = series(200);

  it("decision (d): Ann. Volatility, Sharpe and Sortino read the dash, no basis caption is printed, and the settled render of the same blend shows numbers and its captions", async () => {
    // SETTLED first (the final 252 basis): numbers and the captions are on offer.
    const settled = mount(SHORT, FINAL, false);
    await settleHeatmaps(settled.container);
    const settledVol = railValue(settled.container, "Ann. Volatility");
    const settledSharpe = railValue(settled.container, "Sharpe");
    const settledSortino = railValue(settled.container, "Sortino");
    for (const v of [settledVol, settledSharpe, settledSortino]) {
      expect(v).not.toBe("—");
      expect(v).toMatch(/\d/);
    }
    const spanDays = coveredDays(SHORT[0].date, SHORT[SHORT.length - 1].date);
    expect(spanDays).toBe(200);
    const blendCaption = shortTrackNote("blend", spanDays);
    expect(settled.container.textContent).toContain(blendCaption);
    expect(settled.container.querySelector('[data-testid="rolling-annualization-note"]')).not.toBeNull();
    const settledBootSharpe = bootstrapCi(settled.container, "Sharpe");
    expect(settledBootSharpe).not.toContain("—");
    const settledMaxDd = bootstrapCi(settled.container, "Max Drawdown");
    settled.unmount();

    // PENDING (the interim 365 basis is live in props, but nothing it computes shows).
    const held = mount(SHORT, INTERIM, true);
    await settleHeatmaps(held.container);
    expect(railValue(held.container, "Ann. Volatility")).toBe("—");
    expect(railValue(held.container, "Sharpe")).toBe("—");
    expect(railValue(held.container, "Sortino")).toBe("—");
    const text = held.container.textContent ?? "";
    expect(text).not.toContain(blendCaption);
    expect(text).not.toMatch(/annualized from/i);
    expect(text).not.toMatch(/Annualized figures appear once/i);
    expect(held.container.querySelector('[data-testid="rolling-annualization-note"]')).toBeNull();
    // The bootstrap's annualized ratios are blanked, its basis-invariant Max Drawdown is not.
    expect(bootstrapCi(held.container, "Sharpe")).toBe("[—, —]");
    expect(bootstrapCi(held.container, "Sortino")).toBe("[—, —]");
    expect(bootstrapCi(held.container, "Max Drawdown")).toBe(settledMaxDd);
    expect(held.container.innerHTML).not.toContain("NaN");
    expect(held.container.innerHTML).not.toContain("Infinity");
    // Basis-invariant surfaces still render: the equity chart's master brush and the
    // heatmaps' headings are present on the held render.
    expect(held.container.querySelector("#factsheet-heatmaps")?.textContent ?? "").toContain("Monthly Returns");
  });

  it("decision (d): the 1y rolling window and its table are not drawn while pending, and are on offer once settled", async () => {
    const LONG = series(400);
    const settled = mount(LONG, FINAL, false);
    await settleHeatmaps(settled.container);
    expect(settled.container.querySelector('[data-testid="rolling-metrics-1y"]')).not.toBeNull();
    settled.unmount();

    const held = mount(LONG, INTERIM, true);
    await settleHeatmaps(held.container);
    expect(held.container.querySelector('[data-testid="rolling-metrics-1y"]')).toBeNull();
    // The six-month rolling table keeps its populated layout with dashes.
    const rollingTable = within(held.container as HTMLElement)
      .getAllByText(/Rolling Metrics \(/)
      .map((h) => h.closest("section"))
      .filter((s): s is HTMLElement => s !== null)[0];
    expect(rollingTable).toBeTruthy();
    const cells = Array.from(rollingTable.querySelectorAll("tbody td")).map((td) => td.textContent?.trim());
    const numeric = cells.filter((c, i) => i % 5 !== 0 && c !== "—");
    expect(numeric, "a rolling table cell carried a number while pending").toEqual([]);
    expect(held.container.innerHTML).not.toContain("NaN");
    expect(held.container.innerHTML).not.toContain("Infinity");
  });

  it("decision (d): no sample/{N} basis caption is printed while pending: the own-book and peer panels are absent, and read sample/252 once settled", async () => {
    const LONG = series(400);
    const carveOuts = { scenarioPeer: PEER, scenarioOwnBookDelta: OWN_BOOK };
    const settled = mount(LONG, FINAL, false, carveOuts);
    await settleHeatmaps(settled.container);
    // Non-vacuity: both panels are on screen and each names the final basis.
    expect(settled.container.textContent).toContain("vs Your Allocation");
    expect(settled.container.textContent).toContain("Delta = blend minus your live allocation · sample/252 basis");
    expect(settled.container.textContent).toContain("hypothetical blend · ranked vs verified strategies · sample/252 basis");
    settled.unmount();

    const held = mount(LONG, INTERIM, true, carveOuts);
    await settleHeatmaps(held.container);
    const text = held.container.textContent ?? "";
    expect(text).not.toMatch(/sample\/\d+ basis/);
    expect(text).not.toContain("vs Your Allocation");
    expect(text).not.toContain("Peer Percentile");
    expect(text).not.toMatch(/Not enough data/i);
    // The populated layout stays: the rolling table keeps its heading, with dashes.
    expect(text).toContain("Rolling Metrics (");
  });
});

describe("FactsheetBody decision (d), CR-01: a zoomed range does not annualize on the interim basis while a leg is pending", () => {
  it("decision (d): a range zoomed BEFORE a leg's probe opened reads the dash for Ann. Volatility, Sharpe and Sortino, and the bootstrap Sharpe and Sortino, once the probe is open", async () => {
    const LONG = series(400);
    const zoom: { to: (r: readonly [number, number]) => void } = { to: () => {} };
    function Grab() {
      const { setXRange } = useXRange();
      useEffect(() => {
        zoom.to = setXRange;
      }, [setXRange]);
      return null;
    }
    const tree = (payload: ReturnType<typeof buildScenarioFactsheetPayload>) => (
      <FactsheetProvider payload={payload} persist={false}>
        <Grab />
        <FactsheetBody payload={payload} scenarioMode hideHeader hideFooter={false} />
      </FactsheetProvider>
    );
    const settledPayload = buildScenarioFactsheetPayload({ portfolioDaily: LONG, periodsPerYear: FINAL });
    const view = render(tree(settledPayload));
    await settleHeatmaps(view.container);
    // The user zooms the preview to the last 120 days BEFORE any probe is open.
    act(() => zoom.to([280, 399]));
    // Non-vacuity: the zoomed, settled strip shows real numbers in every slot the hold blanks.
    for (const label of ["Ann. Volatility", "Sharpe", "Sortino"]) {
      expect(railValue(view.container, label), `${label} settled and zoomed`).toMatch(/\d/);
    }
    expect(bootstrapCi(view.container, "Sharpe")).not.toContain("—");
    expect(view.container.textContent).toContain("Selected range");

    // A drawer leg is added and its probe is open: the SAME provider keeps the zoomed range.
    const heldPayload = buildScenarioFactsheetPayload({
      portfolioDaily: LONG,
      periodsPerYear: INTERIM,
      basisPending: true,
    });
    view.rerender(tree(heldPayload));
    await settleHeatmaps(view.container);
    expect(view.container.textContent).toContain("Selected range");
    expect(railValue(view.container, "Ann. Volatility")).toBe("—");
    expect(railValue(view.container, "Sharpe")).toBe("—");
    expect(railValue(view.container, "Sortino")).toBe("—");
    expect(bootstrapCi(view.container, "Sharpe")).toBe("[—, —]");
    expect(bootstrapCi(view.container, "Sortino")).toBe("[—, —]");
    // The zoomed range's basis-invariant figures still show.
    expect(railValue(view.container, "Max Drawdown")).toMatch(/\d/);
    expect(view.container.innerHTML).not.toContain("NaN");
  });
});
