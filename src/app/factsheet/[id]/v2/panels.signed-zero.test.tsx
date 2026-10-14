/** @vitest-environment jsdom */
/**
 * Phase 170.6 DISPLAYPOLISH plan 04 (D-02, D-03, D-04, D-05): the factsheet's table panels
 * print no signed zero and colour no figure by its raw sign.
 *
 * Every expected string and tone below is typed by hand. None is computed by the code under
 * test. A figure that ROUNDS to zero at the precision its cell prints is "0.0%" / "0.00" /
 * "0.0pp" with no sign, and carries no positive or negative colour (D-02, D-03). A max drawdown
 * is red only when it rounds below zero, and is never green (D-04).
 *
 * Fixtures come from `buildFactsheetPayload` / `buildScenarioFactsheetPayload` and each test
 * overwrites only the inputs it needs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload, StressWindow } from "@/lib/factsheet/types";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { StressWindowsPanel } from "./StressWindowsPanel";
import { AllocatorSection, OwnBookDeltaPanel, StyleDriftPanel } from "./BatchDPanels";
import { BootstrapCIPanel, CalmarByYearPanel } from "./AnalyticalPanels";
import { CorrelationsMatrixPanel, CorrelationStripPanel, EndOfYearBarsPanel, QuantileBoxPlotPanel } from "./DistributionPanels";

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
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});

const POSITIVE = "--color-positive";
const NEGATIVE = "--color-negative";
const MUTED = "var(--color-text-muted)";
const U2212 = "−";

function dailyRows(n: number) {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.008 + 0.0005,
  }));
}

function apiPayload(): Extract<FactsheetPayload, { ingestSource: "api" }> {
  const p = buildFactsheetPayload(
    {
      id: "signed-zero-panels",
      name: "Signed Zero Panels",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      assetClass: "crypto",
      ingestSource: "api",
    },
    dailyRows(400),
  );
  if (!p || p.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  return p;
}

function mount(payload: FactsheetPayload, ui: React.ReactElement) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      {ui}
    </FactsheetProvider>,
  );
}

function styleOf(el: Element): string {
  return el.getAttribute("style") ?? "";
}

/** True when the cell carries a red, green or accent-free tone token. */
function hasTone(el: Element): boolean {
  const s = styleOf(el);
  return s.includes(POSITIVE) || s.includes(NEGATIVE);
}

/** The cells of the row whose first cell reads `label`. */
function rowCells(container: HTMLElement, label: string): HTMLElement[] {
  const rows = Array.from(container.querySelectorAll("tr"));
  const row = rows.find(r => r.querySelector("td")?.textContent === label);
  if (!row) throw new Error(`row not found: ${label}`);
  return Array.from(row.querySelectorAll("td")) as HTMLElement[];
}

/* ------------------------------------------------------------------ */
/* Stress windows                                                      */
/* ------------------------------------------------------------------ */

function stressWindow(patch: Partial<StressWindow>): StressWindow {
  return {
    name: "Aug 2024 unwind",
    note: "JPY carry-trade unwind",
    start: "2024-08-02",
    end: "2024-08-09",
    days: 8,
    expectedCalendarDays: 8,
    coverage: "full",
    stratReturn: 0.021,
    benchReturn: 0.012,
    stratMaxDD: -0.042,
    benchMaxDD: -0.031,
    ...patch,
  };
}

function stressCells(patch: Partial<StressWindow>) {
  const base = apiPayload();
  const payload: FactsheetPayload = {
    ...base,
    stressWindows: { windows: [stressWindow(patch)], benchName: "BTC", totalCatalogued: 5, droppedOutOfRange: 4, droppedPartial: 0 },
  };
  const { container } = mount(payload, <StressWindowsPanel />);
  const cells = Array.from(container.querySelectorAll("tbody tr td")) as HTMLElement[];
  // Event, Window, Days, Strategy, Strat DD, Bench, Bench DD.
  const [, , , stratRet, stratDD, benchRet, benchDD] = cells;
  return { stratRet, stratDD, benchRet, benchDD };
}

describe("StressWindowsPanel: signed zero and tone (D-02, D-03, D-04)", () => {
  it("control: non-zero figures keep their digits and their red or green", () => {
    const c = stressCells({});
    expect(c.stratRet.textContent).toBe("+2.1%");
    expect(styleOf(c.stratRet)).toContain(POSITIVE);
    expect(c.stratDD.textContent).toBe("-4.2%");
    expect(styleOf(c.stratDD)).toContain(NEGATIVE);
    expect(c.benchRet.textContent).toBe("+1.2%");
    expect(styleOf(c.benchRet)).toContain(POSITIVE);
    expect(c.benchDD.textContent).toBe("-3.1%");
    expect(styleOf(c.benchDD)).toContain(NEGATIVE);
  });

  it("a strategy return of -0.0004 prints '0.0%' with no colour (today '-0.0%' in red)", () => {
    const { stratRet } = stressCells({ stratReturn: -0.0004 });
    expect(stratRet.textContent).toBe("0.0%");
    expect(hasTone(stratRet)).toBe(false);
  });

  it("a strategy return of +0.0004 prints '0.0%' with no colour (today '+0.0%' in green)", () => {
    const { stratRet } = stressCells({ stratReturn: 0.0004 });
    expect(stratRet.textContent).toBe("0.0%");
    expect(hasTone(stratRet)).toBe(false);
  });

  it("a bench return of -0.0004 prints '0.0%' with no colour", () => {
    const { benchRet } = stressCells({ benchReturn: -0.0004 });
    expect(benchRet.textContent).toBe("0.0%");
    expect(hasTone(benchRet)).toBe(false);
  });

  it("a strategy max DD of 0 prints '0.0%' with no negative colour (today red)", () => {
    const { stratDD } = stressCells({ stratMaxDD: 0 });
    expect(stratDD.textContent).toBe("0.0%");
    expect(styleOf(stratDD)).not.toContain(NEGATIVE);
    expect(hasTone(stratDD)).toBe(false);
  });

  it("a strategy max DD of -0.0004 prints '0.0%' with no colour", () => {
    const { stratDD } = stressCells({ stratMaxDD: -0.0004 });
    expect(stratDD.textContent).toBe("0.0%");
    expect(hasTone(stratDD)).toBe(false);
  });

  it("a positive max DD (+0.004) is never green: '0.4%', no tone", () => {
    const { stratDD, benchDD } = stressCells({ stratMaxDD: 0.004, benchMaxDD: 0.004 });
    expect(stratDD.textContent).toBe("0.4%");
    expect(hasTone(stratDD)).toBe(false);
    expect(benchDD.textContent).toBe("0.4%");
    expect(hasTone(benchDD)).toBe(false);
  });

  it("a bench max DD of 0 prints '0.0%' with no negative colour", () => {
    const { benchDD } = stressCells({ benchMaxDD: 0 });
    expect(benchDD.textContent).toBe("0.0%");
    expect(hasTone(benchDD)).toBe(false);
  });

  it("a null bench stays '—' in the muted colour (unchanged)", () => {
    const { benchRet, benchDD } = stressCells({ benchReturn: null, benchMaxDD: null });
    expect(benchRet.textContent).toBe("—");
    expect(benchDD.textContent).toBe("—");
    expect(styleOf(benchRet)).toContain(MUTED);
    expect(styleOf(benchDD)).toContain(MUTED);
  });
});

/* ------------------------------------------------------------------ */
/* Own-book delta                                                      */
/* ------------------------------------------------------------------ */

function ownBookCell(delta: { sharpe: number | null; sortino: number | null; max_dd: number | null }, label: string) {
  const portfolioDaily: DailyPoint[] = Array.from({ length: 300 }, (_, i) => ({
    date: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10),
    value: 0.0015 + Math.sin(i * 0.27) * 0.005,
  }));
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily,
    benchmark: null,
    scenarioOwnBookDelta: { ...delta, blend_n: 287, book_n: 412 },
  });
  const { container } = mount(payload, <OwnBookDeltaPanel />);
  return rowCells(container, label)[1];
}

describe("OwnBookDeltaPanel: signed zero and favourability tone (D-02, D-03, O-4)", () => {
  it("control: non-zero deltas keep their digits, U+2212 minus and favourability colour", () => {
    expect(ownBookCell({ sharpe: 0.24, sortino: -0.18, max_dd: 0.018 }, "Sharpe").textContent).toBe("+0.24");
    const sortino = ownBookCell({ sharpe: 0.24, sortino: -0.18, max_dd: 0.018 }, "Sortino");
    expect(sortino.textContent).toBe(`${U2212}0.18`);
    expect(styleOf(sortino)).toContain(NEGATIVE);
    const dd = ownBookCell({ sharpe: 0.24, sortino: -0.18, max_dd: 0.018 }, "Max DD (blend vs book)");
    expect(dd.textContent).toBe("+1.8pp");
    expect(styleOf(dd)).toContain(POSITIVE);
    const deeper = ownBookCell({ sharpe: 0.24, sortino: -0.18, max_dd: -0.023 }, "Max DD (blend vs book)");
    expect(deeper.textContent).toBe(`${U2212}2.3pp`);
    expect(styleOf(deeper)).toContain(NEGATIVE);
  });

  it("a Sharpe delta of -0.004 prints '0.00' with no colour (today '−0.00' in red)", () => {
    const cell = ownBookCell({ sharpe: -0.004, sortino: 0.1, max_dd: 0.005 }, "Sharpe");
    expect(cell.textContent).toBe("0.00");
    expect(hasTone(cell)).toBe(false);
  });

  it("a Sortino delta of +0.004 prints '0.00' with no colour (today '+0.00' in green)", () => {
    const cell = ownBookCell({ sharpe: 0.1, sortino: 0.004, max_dd: 0.005 }, "Sortino");
    expect(cell.textContent).toBe("0.00");
    expect(hasTone(cell)).toBe(false);
  });

  it("a max DD delta of +0.0004 prints '0.0pp' with no colour (today '+0.0pp' in green)", () => {
    const cell = ownBookCell({ sharpe: 0.1, sortino: 0.1, max_dd: 0.0004 }, "Max DD (blend vs book)");
    expect(cell.textContent).toBe("0.0pp");
    expect(hasTone(cell)).toBe(false);
  });

  it("a max DD delta of -0.0004 prints '0.0pp' with no colour (today '−0.0pp' in red)", () => {
    const cell = ownBookCell({ sharpe: 0.1, sortino: 0.1, max_dd: -0.0004 }, "Max DD (blend vs book)");
    expect(cell.textContent).toBe("0.0pp");
    expect(hasTone(cell)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Allocator section                                                   */
/* ------------------------------------------------------------------ */

function allocatorValue(patch: Record<string, number | null>, label: string): HTMLElement {
  const base = apiPayload();
  const portfolios = base.allocatorPortfolios;
  if (!portfolios || portfolios.length === 0) throw new Error("fixture must carry allocator portfolios");
  const payload: FactsheetPayload = {
    ...base,
    allocatorPortfolios: [{ ...portfolios[0], ...patch }, ...portfolios.slice(1)],
  };
  const { container } = mount(payload, <AllocatorSection />);
  return rowCells(container, label)[1];
}

describe("AllocatorSection: signed zero and drawdown tone (D-02, D-04)", () => {
  it("a Max Drawdown of 0 prints '0.0%' with no negative colour (today red)", () => {
    const cell = allocatorValue({ max_dd: 0 }, "Max Drawdown");
    expect(cell.textContent).toBe("0.0%");
    expect(styleOf(cell)).not.toContain(NEGATIVE);
  });

  it("a Max Drawdown of -0.0004 prints '0.0%' with no negative colour", () => {
    const cell = allocatorValue({ max_dd: -0.0004 }, "Max Drawdown");
    expect(cell.textContent).toBe("0.0%");
    expect(styleOf(cell)).not.toContain(NEGATIVE);
  });

  it("a Max Drawdown of -0.052 prints '-5.2%' in the negative colour", () => {
    const cell = allocatorValue({ max_dd: -0.052 }, "Max Drawdown");
    expect(cell.textContent).toBe("-5.2%");
    expect(styleOf(cell)).toContain(NEGATIVE);
  });

  it("a Max Drawdown of +0.004 (never green) prints '0.4%' with no colour", () => {
    const cell = allocatorValue({ max_dd: 0.004 }, "Max Drawdown");
    expect(cell.textContent).toBe("0.4%");
    expect(hasTone(cell)).toBe(false);
  });

  it("'Correlation with MultiMarket' of -0.004 prints '0.00'; +0.35 prints '+0.35'", () => {
    expect(allocatorValue({ corr: -0.004 }, "Correlation with MultiMarket").textContent).toBe("0.00");
    expect(allocatorValue({ corr: 0.004 }, "Correlation with MultiMarket").textContent).toBe("0.00");
    expect(allocatorValue({ corr: 0.35 }, "Correlation with MultiMarket").textContent).toBe("+0.35");
  });

  it("'Cum. Return' of -0.0004 prints '0.0%'; the tail mean of -0.00004 prints '0.00%'", () => {
    expect(allocatorValue({ cum_ret: -0.0004 }, "Cum. Return (full window)").textContent).toBe("0.0%");
    expect(allocatorValue({ cum_ret: 0.0123 }, "Cum. Return (full window)").textContent).toBe("+1.2%");
    expect(allocatorValue({ tail_mm_mean: -0.00004 }, "MultiMarket mean return").textContent).toBe("0.00%");
    expect(allocatorValue({ tail_mm_median: 0.00004 }, "MultiMarket median return").textContent).toBe("0.00%");
  });
});

/* ------------------------------------------------------------------ */
/* Style drift                                                         */
/* ------------------------------------------------------------------ */

describe("StyleDriftPanel: signed zero (D-02)", () => {
  it("skew of -0.004 and a ratio delta that rounds to zero print unsigned", () => {
    const base = apiPayload();
    const sd = base.styleDrift;
    if (!sd) throw new Error("fixture must carry styleDrift");
    const payload: FactsheetPayload = {
      ...base,
      styleDrift: {
        ...sd,
        h1: { ...sd.h1, sharpe: 1, ann_vol: 0.2, skew: -0.004 },
        h2: { ...sd.h2, sharpe: 1.0004, ann_vol: 0.19996, skew: 0.004 },
      },
    };
    const { container } = mount(payload, <StyleDriftPanel />);
    // Sharpe: 1.00 / 1.00, delta 0.0004 -> "0.00" (today "+0.00").
    expect(rowCells(container, "Sharpe").map(c => c.textContent)).toEqual(["Sharpe", "1.00", "1.00", "0.00"]);
    // Ann. Volatility: 20.0% / 20.0%, delta -0.00004 -> "0.0pp" (today "-0.0pp").
    expect(rowCells(container, "Ann. Volatility").map(c => c.textContent)).toEqual(["Ann. Volatility", "20.0%", "20.0%", "0.0pp"]);
    // Skew: -0.004 prints "0.00" (today "-0.00"), +0.004 prints "0.00" (today "+0.00"), delta +0.008 -> "+0.01".
    expect(rowCells(container, "Skew").map(c => c.textContent)).toEqual(["Skew", "0.00", "0.00", "+0.01"]);
  });
});

/* ------------------------------------------------------------------ */
/* Bootstrap, calmar, quantiles, correlations, end-of-year             */
/* ------------------------------------------------------------------ */

describe("BootstrapCIPanel: signed zero (D-02)", () => {
  it("a Sharpe point of -0.004 and a CI of [-0.0004, 0.0004] print '0.00'; a max DD of -0.00004 prints '0.00%'", () => {
    const base = apiPayload();
    const b = base.bootstrapCI;
    const payload: FactsheetPayload = {
      ...base,
      bootstrapCI: {
        ...b,
        sharpe: { ...b.sharpe, point: -0.004, lo: -0.0004, hi: 0.0004 },
        max_dd: { ...b.max_dd, point: -0.00004, lo: -0.00004, hi: 0 },
      },
    };
    const { container } = mount(payload, <BootstrapCIPanel />);
    expect(rowCells(container, "Sharpe").map(c => c.textContent)).toEqual(["Sharpe", "0.00", "[0.00, 0.00]"]);
    expect(rowCells(container, "Max Drawdown").map(c => c.textContent)).toEqual(["Max Drawdown", "0.00%", "[0.00%, 0.00%]"]);
    expect(container.textContent).not.toContain("-0.00");
  });

  it("control: a Sharpe point of -0.42 keeps its sign and digits", () => {
    const base = apiPayload();
    const b = base.bootstrapCI;
    const payload: FactsheetPayload = {
      ...base,
      bootstrapCI: { ...b, sharpe: { ...b.sharpe, point: -0.42, lo: -0.9, hi: 0.05 } },
    };
    const { container } = mount(payload, <BootstrapCIPanel />);
    expect(rowCells(container, "Sharpe").map(c => c.textContent)).toEqual(["Sharpe", "-0.42", "[-0.90, 0.05]"]);
  });
});

describe("CalmarByYearPanel: signed zero (D-02)", () => {
  it("a year return of -0.00004 prints '0.00%' and a Calmar of -0.004 prints '0.00'", () => {
    const base = apiPayload();
    const payload: FactsheetPayload = {
      ...base,
      calmarByYear: [{ year: "2024", ret: -0.00004, max_dd: -0.00004, calmar: -0.004, days: 250 }],
    };
    const { container } = mount(payload, <CalmarByYearPanel />);
    const cells = Array.from(container.querySelectorAll("tbody tr")[0].querySelectorAll("td")).map(c => c.textContent);
    expect(cells.slice(1, 4)).toEqual(["0.00%", "0.00%", "0.00"]);
  });
});

describe("QuantileBoxPlotPanel: signed zero (D-02)", () => {
  it("a median of -0.0004 prints '0.0%'; P5 and P95 keep their signs", () => {
    const base = apiPayload();
    const payload: FactsheetPayload = {
      ...base,
      quantiles: { p05: -0.03, p25: -0.01, p50: -0.0004, p75: 0.01, p95: 0.03, min: -0.05, max: 0.05, mean: 0.0002 },
    };
    const { container } = mount(payload, <QuantileBoxPlotPanel />);
    const kpi = (label: string) =>
      Array.from(container.querySelectorAll("p"))
        .find(p => p.textContent === label)
        ?.nextElementSibling?.textContent;
    expect(kpi("Median")).toBe("0.0%");
    expect(kpi("P5")).toBe("-3.0%");
    expect(kpi("P95")).toBe("+3.0%");
    expect(kpi("P25")).toBe("-1.0%");
    expect(kpi("P75")).toBe("+1.0%");
  });

  it("an axis end that rounds to zero prints '0.0%' (lo of -0.0004 is not '-0.0%')", () => {
    const base = apiPayload();
    const payload: FactsheetPayload = {
      ...base,
      quantiles: { p05: -0.0004, p25: -0.0002, p50: 0.0001, p75: 0.0003, p95: 0.0009, min: -0.0004, max: 0.0009, mean: 0.0001 },
    };
    const { container } = mount(payload, <QuantileBoxPlotPanel />);
    expect(container.textContent).not.toContain("-0.0%");
    expect(container.textContent).not.toContain("+0.0%");
  });
});

describe("CorrelationStripPanel and CorrelationsMatrixPanel: signed zero (D-02, D-06)", () => {
  it("a correlation of -0.004 prints '0.00' in the strip's value text and in the matrix cell", () => {
    const base = apiPayload();
    const payload: FactsheetPayload = {
      ...base,
      correlations: [
        { name: "ETH", rho: -0.004 },
        { name: "SPX", rho: 0.35 },
        { name: "Gold", rho: -0.35 },
      ],
      correlationMatrix: {
        labels: ["Strategy", "ETH", "SPX"],
        matrix: [
          [1, -0.004, 0.35],
          [-0.004, 1, 0.1],
          [0.35, 0.1, 1],
        ],
      },
    };
    const strip = mount(payload, <CorrelationStripPanel />);
    const texts = Array.from(strip.container.querySelectorAll("svg text")).map(t => t.textContent);
    // Row value text: "0.00" (today "-0.00"), "+0.35", "-0.35".
    expect(texts).toContain("0.00");
    expect(texts).toContain("+0.35");
    expect(texts).toContain("-0.35");
    expect(texts).not.toContain("-0.00");
    expect(texts).not.toContain("+0.00");
    // Axis ticks unchanged: -1.0, -0.5, 0.0, 0.5, 1.0.
    expect(texts).toEqual(expect.arrayContaining(["-1.0", "-0.5", "0.0", "0.5", "1.0"]));
    strip.unmount();

    const matrix = mount(payload, <CorrelationsMatrixPanel />);
    const cells = Array.from(matrix.container.querySelectorAll("svg text")).map(t => t.textContent);
    expect(cells).toContain("0.00");
    expect(cells).not.toContain("-0.00");
    expect(cells).toContain("0.35");
    expect(cells).toContain("1.00");
  });
});

describe("EndOfYearBarsPanel: signed zero (D-02, D-06)", () => {
  it("a year that rounds to zero prints '0.0%'; a real year keeps its sign", () => {
    const base = apiPayload();
    const payload: FactsheetPayload = {
      ...base,
      strategyMetrics: { ...base.strategyMetrics, yearly: { "2024": -0.0004, "2025": 0.021, "2026": -0.034 } },
    };
    const { container } = mount(payload, <EndOfYearBarsPanel />);
    const texts = Array.from(container.querySelectorAll("svg text")).map(t => t.textContent);
    expect(texts).toContain("0.0%");
    expect(texts).toContain("+2.1%");
    expect(texts).toContain("-3.4%");
    expect(texts).not.toContain("-0.0%");
    expect(texts).not.toContain("+0.0%");
  });
});
