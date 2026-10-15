import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { EventSignature, EventSignaturesSet, FactsheetPayload } from "@/lib/factsheet/types";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { CHART_CONFIGS, type ChartConfig } from "./chart-configs";
import { FactsheetProvider } from "./factsheet-context";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { HistogramChart } from "./HistogramChart";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";
import { MonthlyReturnsHeatmap, DailyReturnsHeatmap } from "./HeatmapPanels";

/**
 * Phase 170.6 DISPLAYPOLISH plan 05 (D-02, D-03, D-06): the factsheet v2 chart
 * components print through the one rounded-sign rule in `display-sign.ts`.
 *
 * A figure that rounds to zero at its printed precision prints with no sign and
 * takes the neutral tone: `-0.0%`, `-0.00` and `+0.0%` never appear, and a bar
 * whose tooltip reads a rounded zero is not drawn red. Every expected string in
 * this file is typed by hand; none is computed by the code under test.
 *
 * TimeSeriesChart cases drive the real component: the crosshair tooltip and the
 * legend are reached by a pointer move over a viewBox-sized box (jsdom has no
 * layout), exactly as TimeSeriesChart.window-gesture.test.tsx does.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/hooks/useBreakpoint", () => ({ useBreakpoint: vi.fn(() => "desktop" as const) }));

const lsStore = new Map<string, string>();
const VB_W = 880;
const PLOT_LEFT = 50;
const PLOT_W = 800;

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
  // jsdom has no layout: a box the size of the viewBox makes a client coordinate
  // equal to its viewBox coordinate.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: VB_W, bottom: 280, width: VB_W, height: 280, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// TimeSeriesChart
// ---------------------------------------------------------------------------

const N = 12;
const START_MS = Date.UTC(2026, 0, 1);

/** 12 consecutive days of a non-trivial return series: the payload's arrays are N long. */
function basePayload(): FactsheetPayload {
  const daily: DailyPoint[] = Array.from({ length: N }, (_, i) => ({
    date: new Date(START_MS + i * 86_400_000).toISOString().slice(0, 10),
    value: i % 2 === 0 ? 0.01 : -0.008,
  }));
  return buildScenarioFactsheetPayload({ portfolioDaily: daily }) as unknown as FactsheetPayload;
}

/** `fill` everywhere, `at` replaced at the listed indices. */
function series(fill: number, at: Record<number, number>): number[] {
  return Array.from({ length: N }, (_, i) => (i in at ? at[i] : fill));
}

const cfg = (key: string): ChartConfig => CHART_CONFIGS.find((c) => c.key === key)!;

/** viewBox x of observation `idx` when all N points are visible. */
const xOf = (idx: number) => PLOT_LEFT + (idx / (N - 1)) * PLOT_W;

function mount(config: ChartConfig, patch: Partial<FactsheetPayload>) {
  const payload = { ...basePayload(), ...patch } as FactsheetPayload;
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <TimeSeriesChart config={config} />
    </FactsheetProvider>,
  );
}

/** Alternating series: even indices `mean - spread`, odd `mean + spread`, so the 12-point mean is `mean`. */
function around(mean: number, spread: number): number[] {
  return Array.from({ length: N }, (_, i) => (i % 2 === 0 ? mean - spread : mean + spread));
}

/** The y-axis tick labels: the <text> nodes at the y-label x (PAD.left 50 minus 6). */
function yTickLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('text[x="44"]')).map((t) => t.textContent ?? "");
}

/** Move the pointer over observation `idx` and return the tooltip's value texts. */
async function hover(r: ReturnType<typeof mount>, idx: number): Promise<string[]> {
  const svg = r.container.querySelector("svg")!;
  await act(async () => {
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: xOf(idx), clientY: 100 });
  });
  // The tooltip's value cells are the end-anchored, semibold <text> nodes. The y-axis ticks are
  // end-anchored too but regular weight, so selecting on the weight keeps a tick from standing
  // in for a tooltip value.
  return Array.from(svg.querySelectorAll('text[text-anchor="end"][font-weight="600"]')).map(
    (t) => t.textContent ?? "",
  );
}

describe("TimeSeriesChart tooltip and legend values (D-02, D-06)", () => {
  it("a percent series at -0.0004 reads 0.0% in the tooltip", async () => {
    const r = mount(cfg("dailyReturns"), { strategyReturns: series(0.012, { 5: -0.0004 }) });
    const texts = await hover(r, 5);
    expect(texts).toContain("0.0%");
    expect(texts.join(" ")).not.toMatch(/-0\.0%|\+0\.0%/);
  });

  it("the legend value next to the series name reads 0.0% too", async () => {
    const r = mount(cfg("dailyReturns"), { strategyReturns: series(0.012, { 5: -0.0004 }) });
    await hover(r, 5);
    const legend = Array.from(r.container.querySelectorAll("button[aria-pressed] span.font-mono")).map(
      (s) => s.textContent,
    );
    expect(legend).toContain("0.0%");
  });

  it("a growth series at 0.9996 reads 0.0% in the tooltip", async () => {
    const r = mount(cfg("cumulative"), { strategyEquity: series(1.02, { 5: 0.9996 }) });
    const texts = await hover(r, 5);
    expect(texts).toContain("0.0%");
    expect(texts.join(" ")).not.toMatch(/-0\.0%|\+0\.0%/);
  });

  it("a ratio series at -0.004 reads 0.00 in the tooltip", async () => {
    const r = mount(cfg("rollingSharpe"), { strategyRollingSharpe: series(1.5, { 5: -0.004 }) });
    const texts = await hover(r, 5);
    expect(texts).toContain("0.00");
    expect(texts.join(" ")).not.toMatch(/-0\.00|\+0\.00/);
  });

  it("figures that round away from zero keep their sign: +25.0%, -3.0%, +1.50", async () => {
    const pct = mount(cfg("dailyReturns"), { strategyReturns: series(0.012, { 5: 0.25 }) });
    expect(await hover(pct, 5)).toContain("+25.0%");
    pct.unmount();

    const neg = mount(cfg("dailyReturns"), { strategyReturns: series(0.012, { 5: -0.03 }) });
    expect(await hover(neg, 5)).toContain("-3.0%");
    neg.unmount();

    const growth = mount(cfg("cumulative"), { strategyEquity: series(1.02, { 5: 1.25 }) });
    expect(await hover(growth, 5)).toContain("+25.0%");
    growth.unmount();

    const ratio = mount(cfg("rollingSharpe"), { strategyRollingSharpe: series(1.5, {}) });
    expect(await hover(ratio, 5)).toContain("+1.50");
  });
});

describe("TimeSeriesChart y-axis tick labels (D-02, D-06)", () => {
  it("no y tick on a percent, growth or ratio chart prints +0.0%, -0.0%, +0.00 or -0.00", () => {
    const charts: Array<[string, Partial<FactsheetPayload>]> = [
      ["dailyReturns", { strategyReturns: series(0.012, { 5: -0.012 }) }],
      ["cumulative", { strategyEquity: around(1, 0.01) }],
      ["rollingSharpe", { strategyRollingSharpe: around(0, 1) }],
    ];
    for (const [key, patch] of charts) {
      const labels = yTickLabels(mount(cfg(key), patch).container);
      expect(labels.length, `${key} ticks`).toBeGreaterThanOrEqual(3);
      expect(labels.join(" "), `${key}: ${labels.join(" ")}`).not.toMatch(/[-+]0\.0+%?(\s|$)/);
    }
  });
});

describe("TimeSeriesChart labels drawn on the plot (D-02, D-06)", () => {
  it("the drawdown-pit label for a depth of -0.0004 reads 0.0%, and -0.153 still reads -15.3%", () => {
    const flat = mount(cfg("worstDDs"), {
      strategyWorst10: [{ start: 1, trough: 4, recover: 8, depth: -0.0004 }],
    });
    const flatLabels = Array.from(flat.container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(flatLabels).toContain("#1 0.0%");
    expect(flatLabels.join(" | ")).not.toContain("-0.0%");
    flat.unmount();

    const deep = mount(cfg("worstDDs"), {
      strategyWorst10: [{ start: 1, trough: 4, recover: 8, depth: -0.153 }],
    });
    const deepLabels = Array.from(deep.container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(deepLabels).toContain("#1 -15.3%");
  });

  it("the drawdown-pit label for a depth that prints 0.0% is muted, not red; a real -15.3% depth stays red (D-03, found by the plan 12 guard)", () => {
    const pit = (container: HTMLElement, text: string) =>
      Array.from(container.querySelectorAll("text")).find((t) => t.textContent === text);
    const flat = mount(cfg("worstDDs"), {
      strategyWorst10: [{ start: 1, trough: 4, recover: 8, depth: -0.0004 }],
    });
    expect(pit(flat.container, "#1 0.0%")?.getAttribute("fill")).toBe("var(--color-text-muted)");
    flat.unmount();

    const deep = mount(cfg("worstDDs"), {
      strategyWorst10: [{ start: 1, trough: 4, recover: 8, depth: -0.153 }],
    });
    expect(pit(deep.container, "#1 -15.3%")?.getAttribute("fill")).toBe("var(--color-negative)");
  });

  it("the avg label of a percent series at -0.0004 reads avg 0.0%; a ratio at -0.004 reads avg 0.00", () => {
    const pct = mount(cfg("rollingVol"), { strategyRollingVol: around(-0.0004, 0.01) });
    const pctLabels = Array.from(pct.container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(pctLabels).toContain("avg 0.0%");
    pct.unmount();

    const ratio = mount(cfg("rollingSharpe"), { strategyRollingSharpe: around(-0.004, 1) });
    const ratioLabels = Array.from(ratio.container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(ratioLabels).toContain("avg 0.00");
  });

  it("the avg label of a positive percent series keeps no plus: avg 25.0%", () => {
    const pct = mount(cfg("rollingVol"), { strategyRollingVol: around(0.25, 0.05) });
    const labels = Array.from(pct.container.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(labels).toContain("avg 25.0%");
  });
});

describe("TimeSeriesChart daily-return bar fill takes the rounded sign (D-03, O-3)", () => {
  /** The strategy series' bars, in index order (every index here draws a bar). */
  function strategyBars(container: HTMLElement): string[] {
    const bars = Array.from(container.querySelectorAll('g[clip-path] > g:first-child > rect'));
    return bars.map((b) => b.getAttribute("fill") ?? "");
  }

  it("a bar whose tooltip reads 0.0% is muted; +0.012 is positive; -0.012 is negative", async () => {
    const r = mount(cfg("dailyReturns"), {
      strategyReturns: series(0.02, { 3: -0.0004, 4: 0.012, 6: -0.012 }),
    });
    const fills = strategyBars(r.container);
    expect(fills.length, "one bar per observation").toBe(N);
    expect(fills[3]).toBe("var(--color-text-muted)");
    expect(fills[4]).toBe("var(--color-positive)");
    expect(fills[6]).toBe("var(--color-negative)");
    // The tooltip at that bar reads the rounded zero the muted fill is drawn for.
    expect(await hover(r, 3)).toContain("0.0%");
  });

  it("a bar at +0.0004 (tooltip 0.0%) is muted too, not green", () => {
    const r = mount(cfg("dailyReturns"), { strategyReturns: series(0.02, { 3: 0.0004 }) });
    expect(strategyBars(r.container)[3]).toBe("var(--color-text-muted)");
  });
});

// ---------------------------------------------------------------------------
// HistogramChart, SignaturePanels, CrossSignaturePanels, HeatmapPanels (Task 2)
// ---------------------------------------------------------------------------

describe("HistogramChart zoom ticks (D-02, D-06)", () => {
  it("a wheel zoom that leaves the lower bound a hair below zero prints 0.00%, not -0.00%", async () => {
    // Strategy returns alternate +-0.01, so the natural range is +-0.011 (1.1 x the largest
    // |return|). A wheel tick of deltaY -577 at the right edge of the plot scales the span by
    // exp(-577 x 0.0012) = 0.50037, which moves the lower bound from -0.011 to about -0.0000082
    // (hand arithmetic: 0.011 x (1 - 2 x 0.50037)). That is -0.00082%, which prints at 2 dp.
    const payload = { ...basePayload(), strategyReturns: around(0, 0.01) } as FactsheetPayload;
    const r = render(
      <FactsheetProvider payload={payload} persist={false}>
        <HistogramChart />
      </FactsheetProvider>,
    );
    const svg = r.container.querySelector("svg")!;
    await act(async () => {
      fireEvent.wheel(svg, { deltaY: -577, clientX: 850, clientY: 100 });
    });
    const hint = r.container.querySelector("header p")!.textContent ?? "";
    expect(hint, hint).toMatch(/zoom 0\.00% … /);
    expect(hint).not.toContain("-0.00%");
    expect(hint).not.toContain("+0.00%");
  });

  it("a plain +-1.1% window still prints signed ends", () => {
    const payload = { ...basePayload(), strategyReturns: around(0, 0.01) } as FactsheetPayload;
    const r = render(
      <FactsheetProvider payload={payload} persist={false}>
        <HistogramChart />
      </FactsheetProvider>,
    );
    const ticks = Array.from(r.container.querySelectorAll("svg text")).map((t) => t.textContent ?? "");
    expect(ticks).toContain("-1.1%");
    expect(ticks).toContain("+1.1%");
    expect(ticks).toContain("0%");
  });
});

/** A 29-point trace alternating -a, +a (hand-typed shape; the domain is +-a). */
function trace29(a: number): number[] {
  return Array.from({ length: 29 }, (_, i) => (i % 2 === 0 ? -a : a));
}
function tinySignature(a: number): EventSignature {
  const t = trace29(a);
  return { mean: t, median: t, p25: t, p75: t, p05: t, p95: t };
}
function signatureSet(winOfEquity: EventSignature): EventSignaturesSet {
  return {
    horizonDays: 7,
    winCount: 1,
    lossCount: 0,
    benchWinCount: 0,
    benchLossCount: 0,
    eligibleWinCount: 1,
    eligibleLossCount: 0,
    winOfBenchmark: null,
    lossOfBenchmark: null,
    winOfEquity,
    lossOfEquity: null,
  };
}

function apiPayload(): FactsheetPayload {
  const daily = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2025, 5, 1) + i * 86_400_000).toISOString().slice(0, 10),
    value: (i % 2 === 0 ? 1 : -1) * 0.006,
  }));
  const p = buildFactsheetPayload(
    {
      id: "p05-signed-zero",
      name: "Signed Zero Strategy",
      types: ["quant"],
      markets: ["crypto"],
      computedAt: "2026-09-30T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    daily,
    { benchmarkPrices: { unavailable: true } },
  );
  if (!p || p.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  return p;
}

/** The end-anchored y-tick texts of every chart in the container. */
function svgYTickTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('svg text[text-anchor="end"]')).map((t) => t.textContent ?? "");
}

describe("SignaturePanels and CrossSignaturePanels y ticks (D-02, D-06)", () => {
  // A trace that swings +-0.0004 gives a +-0.04% axis: its nice ticks are multiples of 0.0002,
  // every one of which rounds to zero at one decimal of a percent.
  it("SignaturePanels: ticks on a +-0.04% axis all read 0.0%, none -0.0% or +0.0%", () => {
    const payload = {
      ...apiPayload(),
      eventSignatures: { h7: signatureSet(tinySignature(0.0004)), h1: signatureSet(tinySignature(0.0004)), windowDays: 14 },
    } as unknown as FactsheetPayload;
    const r = render(
      <FactsheetProvider payload={payload} persist={false}>
        <SignaturesSection />
      </FactsheetProvider>,
    );
    const ticks = svgYTickTexts(r.container);
    expect(ticks.length, "y ticks rendered").toBeGreaterThanOrEqual(3);
    expect(ticks.filter((t) => t !== "0.0%"), ticks.join(" ")).toEqual([]);
  });

  it("CrossSignaturePanels: ticks on a +-0.04% axis all read 0.0%, none -0.0% or +0.0%", () => {
    const sig = { h7: signatureSet(tinySignature(0.0004)), h1: signatureSet(tinySignature(0.0004)), windowDays: 14 };
    const payload = {
      ...apiPayload(),
      eventSignatures: sig,
      benchEventSignatures: sig,
    } as unknown as FactsheetPayload;
    const r = render(
      <FactsheetProvider payload={payload} persist={false}>
        <CrossSignaturesSection />
      </FactsheetProvider>,
    );
    const ticks = svgYTickTexts(r.container);
    expect(ticks.length, "y ticks rendered").toBeGreaterThanOrEqual(3);
    expect(ticks.filter((t) => t !== "0.0%"), ticks.join(" ")).toEqual([]);
  });

  it("an axis that really spans +-1% keeps its signs", () => {
    const payload = {
      ...apiPayload(),
      eventSignatures: { h7: signatureSet(tinySignature(0.01)), h1: signatureSet(tinySignature(0.01)), windowDays: 14 },
    } as unknown as FactsheetPayload;
    const r = render(
      <FactsheetProvider payload={payload} persist={false}>
        <SignaturesSection />
      </FactsheetProvider>,
    );
    const ticks = svgYTickTexts(r.container);
    expect(ticks).toContain("0.0%");
    expect(ticks.some((t) => /^-\d/.test(t)), ticks.join(" ")).toBe(true);
    expect(ticks.some((t) => /^\+\d/.test(t)), ticks.join(" ")).toBe(true);
  });
});

describe("HeatmapPanels printed text and tone (D-02, D-03, D-06)", () => {
  // Cell fills as the unmodified code produced them (captured BEFORE the change, plan 05
  // Task 2 step 1) for the fixture below, where the colour scale clamps at +-15.3%.
  const FILL_POSITIVE = "rgb(27, 107, 90)"; // +0.153
  const FILL_NEGATIVE = "rgb(220, 38, 38)"; // -0.153
  const FILL_TINY_NEGATIVE = "rgb(255, 252, 252)"; // -0.0004

  const rows = [
    { year: "2023", byMonth: [0.153, -0.153, -0.0004, -0.00004, null, null, null, null, null, null, null, null], ytd: -0.0004 },
    { year: "2024", byMonth: [0.02, null, null, null, null, null, null, null, null, null, null, null], ytd: 0.2 },
    { year: "2025", byMonth: [null, null, null, null, null, null, null, null, null, null, null, null], ytd: -0.153 },
  ];

  function mountMonthly() {
    const payload = { ...basePayload(), monthlyReturns: rows } as unknown as FactsheetPayload;
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <MonthlyReturnsHeatmap fullHistoryWithheld={false} />
      </FactsheetProvider>,
    );
  }

  /** The cells of one year row: 12 month cells then the YTD cell. */
  function cells(container: HTMLElement, rowIdx: number): HTMLElement[] {
    const tr = container.querySelectorAll("tbody tr")[rowIdx];
    return Array.from(tr.querySelectorAll("td")).slice(1) as HTMLElement[];
  }

  it("month cell text: -0.0004 and -0.00004 read 0.0; 0.153 reads +15; -0.153 reads \u221215", () => {
    const row = cells(mountMonthly().container, 0);
    expect(row[0].textContent).toBe("+15");
    expect(row[1].textContent).toBe("\u221215");
    expect(row[2].textContent).toBe("0.0");
    expect(row[3].textContent).toBe("0.0");
  });

  it("month cell title: -0.00004 reads 0.00%; -0.0004 stays -0.04% (it is not zero at 2 dp); +-0.153 keep their sign", () => {
    const row = cells(mountMonthly().container, 0);
    expect(row[3].getAttribute("title")).toBe("2023-04: 0.00%");
    expect(row[2].getAttribute("title")).toBe("2023-03: -0.04%");
    expect(row[0].getAttribute("title")).toBe("2023-01: +15.30%");
    expect(row[1].getAttribute("title")).toBe("2023-02: -15.30%");
  });

  it("YTD -0.0004 prints 0.0% with no colour; +0.2 is positive green; -0.153 is red", () => {
    const { container } = mountMonthly();
    const ytd = (i: number) => cells(container, i)[12];
    expect(ytd(0).textContent).toBe("0.0%");
    expect(ytd(0).style.color).toBe("");
    expect(ytd(1).textContent).toBe("+20.0%");
    expect(ytd(1).style.color).toBe("var(--color-positive)");
    expect(ytd(2).textContent).toBe("-15.3%");
    expect(ytd(2).style.color).toBe("var(--color-negative)");
  });

  it("cell FILLS are the strings the unmodified code produced (D-06: fills encode magnitude)", () => {
    const row = cells(mountMonthly().container, 0);
    expect(row[0].style.background).toBe(FILL_POSITIVE);
    expect(row[1].style.background).toBe(FILL_NEGATIVE);
    expect(row[2].style.background).toBe(FILL_TINY_NEGATIVE);
  });

  describe("daily calendar reveal", () => {
    function mountDaily() {
      const empty = [null, null, null, null, null, null, null];
      const payload = {
        ...basePayload(),
        dailyHeatmap: [
          {
            year: "2026",
            firstWeekOffset: 0,
            // week 0: Monday -0.00004 (prints 0.00%), Tuesday +0.012, Wednesday -0.012
            cells: [[-0.00004, 0.012, -0.012, null, null, null, null], empty],
          },
        ],
      } as unknown as FactsheetPayload;
      return render(
        <FactsheetProvider payload={payload} persist={false}>
          <DailyReturnsHeatmap />
        </FactsheetProvider>,
      );
    }

    /** Hover week 0, weekday `d`: the grid starts at x 14 (label gutter) and y 14, cells are 14 apart. */
    async function reveal(d: number): Promise<HTMLElement> {
      const r = mountDaily();
      const wrap = r.container.querySelector('[role="img"][aria-label^="Daily-return calendar"]')!;
      await act(async () => {
        fireEvent.pointerMove(wrap, { pointerId: 1, pointerType: "mouse", clientX: 15, clientY: 15 + d * 14 });
      });
      return r.container.querySelector('[role="status"]') as HTMLElement;
    }

    it("a -0.00004 day reads 0.00% with no colour style", async () => {
      const tip = await reveal(0);
      const value = tip.querySelectorAll("span")[1] as HTMLElement;
      expect(value.textContent).toBe("0.00%");
      expect(value.style.color).toBe("");
    });

    it("a +0.012 day reads +1.20% in green; a -0.012 day reads -1.20% in red", async () => {
      const up = (await reveal(1)).querySelectorAll("span")[1] as HTMLElement;
      expect(up.textContent).toBe("+1.20%");
      expect(up.style.color).toBe("var(--color-positive)");
    });

    it("a -0.012 day reads -1.20% in red", async () => {
      const down = (await reveal(2)).querySelectorAll("span")[1] as HTMLElement;
      expect(down.textContent).toBe("-1.20%");
      expect(down.style.color).toBe("var(--color-negative)");
    });
  });
});
