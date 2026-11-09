import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { countFactsheetCensus } from "../../../../../scripts/factsheet-census/count";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody, FactsheetView, advancedSectionContent } from "./FactsheetView";
import { AdvancedDisclosure } from "./AdvancedDisclosure";
import { CHART_HINT_ID, CHART_HINT_TEXT } from "./chart-hint";
import { censusPayloadA, censusPayloadB, censusPayloadC } from "./test-fixtures/census-payloads";

/**
 * Phase 196 plan 11 (D-04, LEAN-05, SC-5) — the document layout's page rules, measured on the
 * three census fixtures on every CI run.
 *
 * WHY this file exists: SC-5 says the factsheet is leaner by a number (one hint, one
 * small-sample warning, no repeated metric, no empty frame). A number nobody re-measures decays:
 * the next panel that prints its own hint, its own short-record sentence or its own copy of a
 * headline figure would ship green. These arms run the same counter the production census uses
 * (`countFactsheetCensus`) over the real markup, so such an edit fails here, naming the count,
 * before it ships. Each count arm sits beside a positive control that proves the counter still
 * finds real charts and labels: a counter that finds nothing would pass every "zero" arm
 * vacuously.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
  lsStore.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
  Object.defineProperty(window, "localStorage", { value: localStorageMock, configurable: true });
  window.history.replaceState({}, "", "/");
});

// Several arms render the whole page (Advanced open) repeatedly; under a loaded machine the
// 5 s default is too tight. This file only.
vi.setConfig({ testTimeout: 60_000 });

function mountView(payload: FactsheetPayload) {
  return render(<FactsheetView payload={payload} />);
}

function advancedEl(container: HTMLElement): HTMLDetailsElement {
  const el = container.querySelector<HTMLDetailsElement>("details#factsheet-advanced");
  expect(el, "details#factsheet-advanced did not render").not.toBeNull();
  return el!;
}

/** Open Advanced and wait for its lazily mounted heatmaps, so the open count is the real one. */
async function openAdvanced(container: HTMLElement) {
  fireEvent.click(advancedEl(container).querySelector("summary")!);
  await waitFor(
    () => {
      if (!container.textContent?.includes("Monthly Returns")) throw new Error("heatmaps not mounted yet");
    },
    { timeout: 10_000 },
  );
}

describe("tracer: one chart hint (D-04)", () => {
  it("renders one visible hint under the drawdown chart, with the UI-SPEC copy", async () => {
    const { container } = mountView(censusPayloadA());
    await openAdvanced(container);
    const hints = container.querySelectorAll(`#${CHART_HINT_ID}`);
    expect(hints).toHaveLength(1);
    const hint = hints[0] as HTMLElement;
    expect(hint.textContent).toBe(CHART_HINT_TEXT);
    expect(hint.className).not.toContain("sr-only");
    const equity = container.querySelector('[data-census-section="equity"]')!;
    expect(equity.contains(hint)).toBe(true);
    // Placed after the drawdown chart: the last figure of the equity container precedes it.
    const figures = equity.querySelectorAll("figure");
    expect(figures).toHaveLength(2);
    expect(figures[1].compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("points every chart and the brush at the hint and renders no hint of their own", async () => {
    const { container } = mountView(censusPayloadA());
    await openAdvanced(container);
    expect(container.querySelector('[id^="chart-help-"]')).toBeNull();
    expect(container.textContent).not.toContain("Ctrl/Cmd + wheel to zoom");
    // The interactive charts: every TimeSeriesChart (a focusable role=img) and the histogram.
    const charts = Array.from(
      container.querySelectorAll<SVGElement>(
        'figure svg[role="img"][tabindex="0"], figure svg[role="img"][aria-label^="Distribution of daily returns"]',
      ),
    );
    expect(charts.length, "no charts found: the arm would pass vacuously").toBeGreaterThanOrEqual(6);
    for (const svg of charts) {
      expect(svg.getAttribute("aria-describedby"), svg.getAttribute("aria-label") ?? "chart").toBe(CHART_HINT_ID);
    }
    const brush = container.querySelector('[aria-label="Master brush — full timeline equity overview"]');
    expect(brush, "the brush frame was not found").not.toBeNull();
    expect(brush!.getAttribute("aria-describedby")).toBe(CHART_HINT_ID);
  });

  it("states every interaction the per-chart texts stated, except the open item recorded in the SUMMARY", () => {
    // The sr-only text said: arrow keys pan, plus/minus zoom, Home (or zero) resets, Ctrl/Cmd +
    // wheel zooms toward the cursor, the wheel alone scrolls the page, drag pans, drag the left
    // axis scales Y, drag the bottom axis scales X. The visible histogram line said Ctrl/Cmd +
    // wheel zooms and double-click resets.
    for (const phrase of ["Ctrl/Cmd + wheel zooms", "drag pans", "drag an axis to scale it", "double-click resets", "arrow keys pan", "plus and minus zoom", "Home resets"]) {
      expect(CHART_HINT_TEXT, phrase).toContain(phrase);
    }
  });

  it("the full layout keeps its per-chart hints exactly as before", async () => {
    const payload = censusPayloadA();
    const view = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideFooter />
      </FactsheetProvider>,
    );
    await waitFor(
      () => {
        if (!view.container.textContent?.includes("Monthly Returns")) throw new Error("heatmaps not mounted yet");
      },
      { timeout: 10_000 },
    );
    const { container } = view;
    expect(container.querySelector(`#${CHART_HINT_ID}`)).toBeNull();
    expect(container.querySelectorAll('[id^="chart-help-"]').length).toBeGreaterThanOrEqual(6);
    expect(container.textContent).toContain("Ctrl/Cmd + wheel to zoom · double-click to reset");
    const described = Array.from(container.querySelectorAll('svg[aria-describedby]')).map((e) => e.getAttribute("aria-describedby"));
    expect(described.length).toBeGreaterThanOrEqual(6);
    for (const d of described) expect(d).toMatch(/^chart-help-/);
    expect(countFactsheetCensus(container).visibleChartHints).toBe(1);
  });
});


/** Render the full layout (the allocator mounts' shape) and wait for the lazy heatmaps. */
async function mountFull(payload: FactsheetPayload) {
  const view = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideFooter />
    </FactsheetProvider>,
  );
  await waitFor(
    () => {
      if (!view.container.textContent?.includes("Monthly Returns")) throw new Error("heatmaps not mounted yet");
    },
    { timeout: 10_000 },
  );
  return view;
}

const SHORT_TRACK_SUFFIX = /Rolling figures are annualized from a [\d,]+-day window, under one year/;
const NOT_ENOUGH_CARD = /—\s*Not (enough data|available)\s*$/;

function cardHeadings(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("section > h3"))
    .map((h) => h.textContent?.trim() ?? "")
    .filter((t) => NOT_ENOUGH_CARD.test(t));
}

describe("one small-sample warning (D-04, UI-SPEC)", () => {
  it("fixture B (a record under a year): the strip's note renders once and nothing else says so", async () => {
    const { container } = mountView(censusPayloadB());
    // Closed: the strip's note is the one statement.
    expect(container.querySelectorAll('[data-testid="strip-figure-gate-note"]')).toHaveLength(1);
    expect(countFactsheetCensus(container).warningKinds).toEqual(["strip-figure-gate-note x1"]);
    await openAdvanced(container);
    expect(container.querySelectorAll('[data-testid="strip-figure-gate-note"]')).toHaveLength(1);
    const c = countFactsheetCensus(container);
    expect(c.smallSampleWarnings).toBe(1);
    expect(c.warningKinds).toEqual(["strip-figure-gate-note x1"]);
    // The family members the counter might miss if its regexes drifted: read the DOM directly.
    expect(container.textContent).not.toMatch(SHORT_TRACK_SUFFIX);
    expect(container.textContent).not.toContain("Bootstrap resamples are drawn from");
    expect(cardHeadings(container)).toEqual([]);
    expect(container.querySelector('[data-testid="figure-gate-note"]')).toBeNull();
  });

  it("fixture C (withheld, under 90 days): at most one warning, no card, closed and open", async () => {
    const { container } = mountView(censusPayloadC());
    expect(countFactsheetCensus(container).smallSampleWarnings).toBeLessThanOrEqual(1);
    await openAdvanced(container);
    const c = countFactsheetCensus(container);
    expect(c.smallSampleWarnings).toBeLessThanOrEqual(1);
    expect(cardHeadings(container)).toEqual([]);
    expect(container.textContent).not.toMatch(SHORT_TRACK_SUFFIX);
  });

  it("the full layout on B keeps the rolling suffix as at HEAD (the allocator mounts are unchanged)", async () => {
    const { container } = await mountFull(censusPayloadB());
    const c = countFactsheetCensus(container);
    expect(c.warningKinds.join(" "), "the full layout lost a family member").toMatch(/rolling-subtitle x[1-9]/);
    expect(c.smallSampleWarnings).toBeGreaterThanOrEqual(2);
  });

  it("the full layout on C keeps its not-enough-data cards as at HEAD", async () => {
    const { container } = await mountFull(censusPayloadC());
    expect(cardHeadings(container).length, "the full layout lost its cards").toBeGreaterThanOrEqual(1);
  });
});

describe("empty sections are not rendered (D-04)", () => {
  it("every fixture mounts every Advanced section it has content for, and names them", async () => {
    for (const make of [censusPayloadA, censusPayloadB, censusPayloadC]) {
      const { container, unmount } = mountView(make());
      const line = advancedEl(container).querySelector("summary")!.textContent ?? "";
      for (const title of ["Performance", "Distribution", "Heatmaps", "Stress Windows", "Streaks"]) {
        // Stress Windows has none on a record outside the catalogue; the line is checked
        // against the mounted sections in the arm below rather than assumed here.
        if (title !== "Stress Windows") expect(line, title).toContain(title);
      }
      unmount();
    }
  });

  it("a record with no heatmap data mounts no Heatmaps section and does not name it", async () => {
    const payload = { ...censusPayloadA(), monthlyReturns: [], dailyHeatmap: [] } as FactsheetPayload;
    const { container } = mountView(payload);
    const line = advancedEl(container).querySelector("summary")!.textContent ?? "";
    expect(line).not.toContain("Heatmaps");
    expect(line, "the other sections are still named").toContain("Distribution");
    fireEvent.click(advancedEl(container).querySelector("summary")!);
    await waitFor(() => expect(advancedEl(container).querySelector("[data-advanced-contents]")).not.toBeNull());
    expect(container.querySelector("#factsheet-heatmaps")).toBeNull();
    expect(container.querySelector("#factsheet-dist"), "a section WITH content vanished").not.toBeNull();
  });

  it("a record with no streaks mounts no Streaks section and does not name it", async () => {
    const base = censusPayloadA();
    const payload = { ...base, streaks: { ...base.streaks, totalWins: 0, totalLosses: 0 } } as FactsheetPayload;
    const { container } = mountView(payload);
    expect(advancedEl(container).querySelector("summary")!.textContent).not.toContain("Streaks");
    fireEvent.click(advancedEl(container).querySelector("summary")!);
    await waitFor(() => expect(advancedEl(container).querySelector("[data-advanced-contents]")).not.toBeNull());
    expect(container.querySelector("#factsheet-streak")).toBeNull();
  });

  it("a stress section that would draw only its 'all outside the record' line is not rendered", async () => {
    const base = censusPayloadA();
    const payload = {
      ...base,
      stressWindows: { ...base.stressWindows, windows: [], totalCatalogued: 3 },
    } as FactsheetPayload;
    const { container } = mountView(payload);
    expect(advancedEl(container).querySelector("summary")!.textContent).not.toContain("Stress Windows");
    fireEvent.click(advancedEl(container).querySelector("summary")!);
    await waitFor(() => expect(advancedEl(container).querySelector("[data-advanced-contents]")).not.toBeNull());
    expect(container.querySelector("#factsheet-stress")).toBeNull();
    expect(container.textContent).not.toContain("catalogued stress windows");
  });

  it("advancedSectionContent: each predicate flips on its own field and no other", () => {
    const base = censusPayloadA();
    const all = advancedSectionContent(base, true);
    expect(all).toEqual({
      "factsheet-perf": true,
      "factsheet-dist": true,
      "factsheet-heatmaps": true,
      "factsheet-stress": all["factsheet-stress"],
      "factsheet-signatures": true,
      "factsheet-streak": true,
    });
    expect(advancedSectionContent(base, false)["factsheet-signatures"]).toBe(false);
    // Performance: no record, no charts.
    expect(advancedSectionContent({ ...base, dates: [], strategyReturns: [] }, true)["factsheet-perf"]).toBe(false);
    // Distribution: needs a finite return, a yearly row, a correlation or a matrix label.
    const noDist = {
      ...base,
      strategyReturns: base.strategyReturns.map(() => NaN),
      strategyMetrics: { ...base.strategyMetrics, yearly: {} },
      correlations: [],
      correlationMatrix: { ...base.correlationMatrix, labels: [] },
    } as FactsheetPayload;
    expect(advancedSectionContent(noDist, true)["factsheet-dist"]).toBe(false);
    expect(advancedSectionContent({ ...noDist, correlations: base.correlations }, true)["factsheet-dist"]).toBe(true);
    expect(advancedSectionContent({ ...noDist, strategyMetrics: base.strategyMetrics }, true)["factsheet-dist"]).toBe(true);
    // Heatmaps: either grid is enough.
    const noHeat = { ...base, monthlyReturns: [], dailyHeatmap: [] } as FactsheetPayload;
    expect(advancedSectionContent(noHeat, true)["factsheet-heatmaps"]).toBe(false);
    expect(advancedSectionContent({ ...noHeat, monthlyReturns: base.monthlyReturns }, true)["factsheet-heatmaps"]).toBe(true);
    expect(advancedSectionContent({ ...noHeat, dailyHeatmap: base.dailyHeatmap }, true)["factsheet-heatmaps"]).toBe(true);
  });

  it("Advanced with no section and no rail is not rendered; with a rail alone it is", () => {
    const none = render(
      <AdvancedDisclosure sections={[]} hasRailContent={false}>
        <p data-probe>inside</p>
      </AdvancedDisclosure>,
    );
    expect(none.container.innerHTML).toBe("");
    none.unmount();
    const railOnly = render(
      <AdvancedDisclosure sections={[]} hasRailContent>
        <p data-probe>inside</p>
      </AdvancedDisclosure>,
    );
    expect(railOnly.container.querySelector("details#factsheet-advanced")).not.toBeNull();
    expect(railOnly.container.textContent).toContain("Detailed metrics");
  });

  it("a record with no observations, streaks, stress windows or correlations has no section with content", () => {
    const base = censusPayloadA();
    const empty = {
      ...base,
      dates: [],
      strategyReturns: [],
      monthlyReturns: [],
      dailyHeatmap: [],
      streaks: { ...base.streaks, totalWins: 0, totalLosses: 0 },
      stressWindows: { ...base.stressWindows, windows: [] },
      correlations: [],
      correlationMatrix: { ...base.correlationMatrix, labels: [] },
      strategyMetrics: { ...base.strategyMetrics, yearly: {} },
    } as FactsheetPayload;
    const view = advancedSectionContent(empty, false);
    expect(Object.values(view).some(Boolean)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The KPI strip's comparator line (OQ-2, T-196-25)
// ---------------------------------------------------------------------------------------------

const BENCH_ORDER = ["cum_ret", "cagr", "sharpe", "sortino", "calmar", "max_dd", "ann_vol"] as const;

/** Independent oracle: print a decimal as a percent at `dp` places by arithmetic, not by the app's
 *  formatters. A value that rounds to zero is unsigned (the repo's display-sign rule). */
function percentOf(v: number, dp: number, plus: boolean): string {
  const body = Math.abs(v * 100).toFixed(dp);
  const isZero = Number(body) === 0;
  const sign = isZero ? "" : v < 0 ? "-" : plus ? "+" : "";
  return `${sign}${body}%`;
}
function ratioOf(v: number): string {
  const body = Math.abs(v).toFixed(2);
  return `${Number(body) === 0 ? "" : v < 0 ? "-" : ""}${body}`;
}

function benchLines(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-bench"]'));
}

describe("the KPI strip's comparator line (OQ-2)", () => {
  it("prints, under each of the seven headline cells, the comparator's value in the cell's own format", () => {
    const payload = censusPayloadA();
    const s = payload.comparators.btc.summary!;
    const { container } = mountView(payload);
    const lines = benchLines(container).map((l) => l.textContent);
    expect(lines).toEqual([
      `BTC ${percentOf(s.cum_ret, 1, true)}`,
      `BTC ${percentOf(s.cagr, 1, true)}`,
      `BTC ${ratioOf(s.sharpe)}`,
      `BTC ${ratioOf(s.sortino)}`,
      `BTC ${ratioOf(s.calmar)}`,
      `BTC ${percentOf(s.max_dd, 1, false)}`,
      `BTC ${percentOf(s.ann_vol, 1, false)}`,
    ]);
    // Each line sits inside the cell of the figure it compares: one per headline label, in order.
    const labels = Array.from(container.querySelectorAll('[data-testid="factsheet-kpi-label"]')).map((l) => l.textContent);
    expect(labels.slice(0, 7)).toEqual(["Cum. Return", "CAGR", "Sharpe", "Sortino", "Calmar", "Max DD", "Ann. Vol"]);
    for (const line of benchLines(container)) {
      expect(line.parentElement!.querySelector('[data-testid="factsheet-kpi-label"]')).not.toBeNull();
    }
    expect(BENCH_ORDER).toHaveLength(7);
  });

  it("agrees with the rail's own comparator cells (one source, the rail's arguments)", () => {
    const payload = censusPayloadA();
    const { container } = render(
      <FactsheetProvider payload={payload} persist={false}>
        <FactsheetBody payload={payload} hideFooter />
      </FactsheetProvider>,
    );
    // The full layout's rail still prints the headline rows with a comparator column. Read the
    // benchmark cell of the Sharpe row: it is the same number the strip's line prints, at the
    // rail's 2 decimals versus the strip's 2 (ratios) or 1 (percent) decimals.
    const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>("table.text-fixed-12 > tbody > tr"));
    const sharpeRow = rows.find((r) => r.cells[0]?.textContent?.trim() === "Sharpe" && r.cells.length >= 3);
    expect(sharpeRow, "the rail's Sharpe row with a benchmark cell was not found").toBeDefined();
    const railBench = sharpeRow!.cells[sharpeRow!.cells.length - 1].textContent!.trim();
    const doc = mountView(payload);
    const stripSharpe = benchLines(doc.container)[2].textContent!;
    expect(stripSharpe).toBe(`BTC ${railBench}`);
  });

  it("prints a muted dash, with no tone, for a comparator value that is not finite", () => {
    const base = censusPayloadA();
    const payload = {
      ...base,
      comparators: {
        ...base.comparators,
        btc: { ...base.comparators.btc, summary: { ...base.comparators.btc.summary!, sharpe: NaN, cum_ret: NaN } },
      },
    } as FactsheetPayload;
    const { container } = mountView(payload);
    const lines = benchLines(container);
    expect(lines[0].textContent).toBe("BTC —");
    expect(lines[2].textContent).toBe("BTC —");
    expect(lines[1].textContent, "a finite neighbour must keep its value").not.toBe("BTC —");
    for (const line of lines) {
      expect(line.className).toContain("text-text-muted");
      expect(line.className).not.toMatch(/positive|negative/);
      expect(line.getAttribute("style") ?? "").not.toContain("color");
    }
  });

  it("prints dashes for every line on a row whose headline is withheld (no measured span to compare)", () => {
    const base = censusPayloadA();
    const payload = {
      ...base,
      dataQuality: { ...(base.dataQuality ?? {}), twrChainBroken: true, headlineWithheld: true },
    } as FactsheetPayload;
    const { container } = mountView(payload);
    const lines = benchLines(container).map((l) => l.textContent);
    expect(lines).toHaveLength(7);
    expect(lines.every((t) => t === "BTC —")).toBe(true);
  });

  it("withholds the annualised comparator figures with the strategy's own gate (fixture C, comparator on)", () => {
    // Fixture C is under 90 days: CAGR, Sharpe, Sortino, Calmar and Ann. Vol are withheld on the
    // total record. The comparator's annualised figures ride the same gate, so a comparator
    // figure never shows where the strategy's is withheld. Cum. Return and Max DD are not
    // annualised and stay.
    const payload = { ...censusPayloadC(), activeComparator: "btc" } as FactsheetPayload;
    const { container } = mountView(payload);
    const cells = Array.from(container.querySelectorAll('[data-testid="factsheet-kpi-label"]')).slice(0, 7);
    const own = cells.map((c) => c.parentElement!.querySelector('[data-testid="factsheet-kpi-value"]')!.textContent);
    const bench = benchLines(container).map((l) => l.textContent!.replace(/^BTC /, ""));
    expect(bench).toHaveLength(7);
    const withheld = own.flatMap((v, i) => (v === "—" ? [i] : []));
    expect(withheld.length, "no strategy cell is withheld: the arm would be vacuous").toBeGreaterThanOrEqual(3);
    for (const i of withheld) expect(bench[i], `cell ${i}: strategy withheld, comparator must be too`).toBe("—");
    expect(bench[0], "Cum. Return is not annualised and keeps its comparator value").not.toBe("—");
  });

  it("renders no line with no comparator, and none in the full layout", async () => {
    const none = mountView({ ...censusPayloadA(), activeComparator: "none" } as FactsheetPayload);
    expect(benchLines(none.container)).toHaveLength(0);
    none.unmount();
    const c = mountView(censusPayloadC());
    expect(benchLines(c.container)).toHaveLength(0);
    c.unmount();
    const full = await mountFull(censusPayloadA());
    expect(benchLines(full.container)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// SC-5 after-targets on the three fixtures
// ---------------------------------------------------------------------------------------------

/** The rolling tables' labels repeat the strip's Sharpe and Sortino and each other: 196-09's open
 *  item 1, a planner or founder call (relabel, merge, or exempt in the counter). */
const ROLLING_REPEATS_OPEN_ITEM: Record<string, string[]> = {
  A: ["sharpe", "sortino", "volatility"],
  B: ["sharpe", "sortino"],
  C: ["sharpe", "sortino"],
};

describe.each([
  ["A", censusPayloadA],
  ["B", censusPayloadB],
  ["C", censusPayloadC],
] as const)("SC-5 after-targets, fixture %s (document layout)", (name, make) => {
  it("closed: 3 content blocks plus the Advanced row, 2 charts, 0 repeated metrics, 1 hint", () => {
    const { container } = mountView(make());
    const c = countFactsheetCensus(container);
    // Positive controls first: a counter that finds nothing would pass every zero below.
    expect(c.charts, "the counter found no chart: the zero arms would be vacuous").toBe(2);
    expect(c.masterBrush).toBe(1);
    expect(c.metricLabels, "the counter found no Main metrics labels").toEqual(
      expect.arrayContaining(["start date", "var 95%", "sharpe", "max drawdown"]),
    );
    // The targets.
    expect(c.sections, "strip + equity + Main metrics + the Advanced row").toBe(4);
    expect(c.repeatedMetrics).toEqual([]);
    expect(c.smallSampleWarnings).toBeLessThanOrEqual(1);
    expect(c.visibleChartHints).toBe(1);
    expect(c.onRequestRows).toBe(0);
  });

  it("open: no repeat beyond the pinned rolling-table open item, 1 hint, 0 on-request rows, at most 1 warning", async () => {
    const { container } = mountView(make());
    await openAdvanced(container);
    const c = countFactsheetCensus(container);
    // Positive control: Advanced's contents are counted (proves the open count is not the closed one).
    expect(c.charts, "Advanced contents were not counted").toBeGreaterThanOrEqual(6);
    expect(c.visibleChartHints).toBe(1);
    expect(c.onRequestRows).toBe(0);
    expect(c.smallSampleWarnings).toBeLessThanOrEqual(1);
    // OPEN ITEM (196-09 item 1), pinned, NOT accepted: the SC-5 target is 0 repeated metrics
    // with Advanced open, and the Rolling Metrics tables miss it. This arm goes RED the day the
    // rolling labels are relabelled, merged or exempted; then set the expectation to [] and
    // delete this note.
    expect(c.repeatedMetrics).toEqual(ROLLING_REPEATS_OPEN_ITEM[name]);
  });
});

// axe `heading-order` on the e2e lane (PR #1235): the opening view's equity figure put an <h3>
// straight after the masthead <h1>, because its Performance <h2> lived on the CollapsibleSection
// the document layout no longer renders. Every heading may go at most one level deeper than the
// heading before it, closed and with Advanced open.
describe("heading order (axe heading-order)", () => {
  function headingJumps(container: HTMLElement): string[] {
    const levels = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) => ({
      level: Number(h.tagName[1]),
      text: (h.textContent ?? "").trim(),
    }));
    const jumps: string[] = [];
    for (let i = 1; i < levels.length; i++) {
      if (levels[i].level > levels[i - 1].level + 1)
        jumps.push(`h${levels[i - 1].level} "${levels[i - 1].text}" -> h${levels[i].level} "${levels[i].text}"`);
    }
    return jumps;
  }

  it.each([
    ["A", censusPayloadA],
    ["B", censusPayloadB],
    ["C", censusPayloadC],
  ])("fixture %s: no heading skips a level, closed or with Advanced open", async (_n, make) => {
    const { container } = mountView(make());
    expect(headingJumps(container)).toEqual([]);
    fireEvent.click(advancedEl(container).querySelector("summary")!);
    await waitFor(() => expect(advancedEl(container).open).toBe(true));
    expect(headingJumps(container)).toEqual([]);
  });
});
