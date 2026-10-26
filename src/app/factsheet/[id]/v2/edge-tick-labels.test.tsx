/** @vitest-environment jsdom */
/**
 * Phase 170.1.3 NARROWCHARTS plan 02 (D-02, D-03, D-03a): the two shared factsheet emitters that
 * the scenario composer mounts anchor their edge labels INWARD, so a label's box stays inside
 * its own svg instead of being cut by it.
 *
 * Why this matters: at 390 px the composer drew "2025" as "025" (the brush year tick sits on the
 * viewBox's left edge) and "P95 +1.0%" cut at the right edge. The fix is anchoring only
 * (`fitTickLabel` in `src/lib/chart-ticks.ts`): a label that fits keeps `text-anchor="middle"`
 * and its x, so a chart whose labels were never cut is byte-identical, which keeps desktop
 * unchanged where nothing was cut and keeps server and browser markup equal (React #418).
 *
 * Every expected anchor and string below is typed by hand; none is computed by the code under
 * test. The breakpoint is the only input that changes between the desktop (font 9 / 9) and
 * mobile (font 15 / 16) arms.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { useBreakpoint } from "@/hooks/useBreakpoint";

vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

import { FactsheetProvider } from "./factsheet-context";
import { BasisProvider } from "./basis-context";
import { MasterBrush } from "./MasterBrush";
import { QuantileBoxPlotPanel, EndOfYearBarsPanel } from "./DistributionPanels";
import { TimeSeriesChart } from "./TimeSeriesChart";
import { CHART_CONFIGS } from "./chart-configs";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

const lsStore = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => void lsStore.set(k, v),
    removeItem: (k: string) => void lsStore.delete(k),
    clear: () => lsStore.clear(),
    key: () => null,
    length: 0,
  });
  vi.mocked(useBreakpoint).mockReturnValue("desktop");
});

function dailyRows(n: number, startUtc: number) {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(startUtc + i * 86_400_000).toISOString().slice(0, 10),
    value: Math.sin(i / 7) * 0.008 + 0.0005,
  }));
}

function apiPayload(rows: { date: string; value: number }[]): Extract<FactsheetPayload, { ingestSource: "api" }> {
  const p = buildFactsheetPayload(
    {
      id: "edge-tick-labels",
      name: "Edge Tick Labels",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-10-21T00:00:00Z",
      trustTier: null,
      assetClass: "crypto",
      ingestSource: "api",
    },
    rows,
  );
  if (!p || p.ingestSource !== "api") throw new Error("fixture must build on the api arm");
  return p;
}

function mountBrush(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <BasisProvider>
        <MasterBrush />
      </BasisProvider>
    </FactsheetProvider>,
  );
}

function mountQuantiles(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <QuantileBoxPlotPanel />
    </FactsheetProvider>,
  );
}

/** The year tick `<text>` elements of the brush, in axis order. */
function yearTexts(container: HTMLElement): { label: string; anchor: string | null; x: string | null }[] {
  return Array.from(container.querySelectorAll("svg text"))
    .filter((t) => /^\d{4}$/.test(t.textContent ?? ""))
    .map((t) => ({ label: t.textContent ?? "", anchor: t.getAttribute("text-anchor"), x: t.getAttribute("x") }));
}

function refText(container: HTMLElement, prefix: "P5 " | "P95 "): Element {
  const hit = Array.from(container.querySelectorAll("svg text")).find((t) => (t.textContent ?? "").startsWith(prefix));
  if (!hit) throw new Error(`no ${prefix.trim()} reference label in the svg`);
  return hit;
}

// 2024-01-01 .. 800 days: year ticks 2024 (idx 0, the left edge) and 2025 / 2026 inside the range.
const SPAN_START = Date.UTC(2024, 0, 1);
// 2025-01-01 is the LAST row: the last year tick sits on the viewBox's right edge.
const END_ON_JAN_FIRST = Date.UTC(2025, 0, 1) - 360 * 86_400_000;

describe("MasterBrush year ticks anchor inward (D-02, D-03a)", () => {
  for (const bp of ["desktop", "mobile"] as const) {
    it(`${bp}: the first year tick starts at PAD.left, an interior one stays centred`, () => {
      vi.mocked(useBreakpoint).mockReturnValue(bp);
      const { container } = mountBrush(apiPayload(dailyRows(800, SPAN_START)));
      const ticks = yearTexts(container);
      expect(ticks.map((t) => t.label)).toEqual(["2024", "2025", "2026"]);
      // The first tick is drawn at the left padding (6) and would be cut by half its width.
      expect(ticks[0].anchor).toBe("start");
      expect(ticks[0].x).toBe("6");
      // Interior ticks sit far from both edges and keep today's anchor.
      expect(ticks[1].anchor).toBe("middle");
      expect(ticks[2].anchor).toBe("middle");
    });
  }

  it("mobile: a year tick on the right edge ends at its tick", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const { container } = mountBrush(apiPayload(dailyRows(361, END_ON_JAN_FIRST)));
    const ticks = yearTexts(container);
    expect(ticks.map((t) => t.label)).toEqual(["2024", "2025"]);
    expect(ticks[0].anchor).toBe("start");
    expect(ticks[1].anchor).toBe("end");
    // Anchoring does not move the label: x is still the tick position (1100 - 6).
    expect(ticks[1].x).toBe("1094");
  });
});

describe("QuantileBoxPlotPanel P5/P95 reference labels anchor inward (D-02, D-03a)", () => {
  // min == p05 and max == p95 put the labels exactly on the plot's two ends (x 30 and 850 of 880).
  const EDGE_QUANTILES = { p05: -0.01, p25: -0.004, p50: 0, p75: 0.004, p95: 0.01, min: -0.01, max: 0.01, mean: 0.0002 };
  // A wide tail range keeps both labels mid-range: lo = -0.04 and hi = 0.04.
  const MID_QUANTILES = { p05: -0.01, p25: -0.004, p50: 0, p75: 0.004, p95: 0.01, min: -0.05, max: 0.05, mean: 0.0002 };

  it("mobile: P95 on the right end ends at its tick, P5 on the left end starts at it, text unchanged", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const payload: FactsheetPayload = { ...apiPayload(dailyRows(400, SPAN_START)), quantiles: EDGE_QUANTILES };
    const { container } = mountQuantiles(payload);
    const p95 = refText(container, "P95 ");
    const p5 = refText(container, "P5 ");
    expect(p95.getAttribute("text-anchor")).toBe("end");
    expect(p95.textContent).toBe("P95 +1.0%");
    expect(p5.getAttribute("text-anchor")).toBe("start");
    expect(p5.textContent).toBe("P5 -1.0%");
  });

  it("mobile: labels well inside the range keep text-anchor middle", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const payload: FactsheetPayload = { ...apiPayload(dailyRows(400, SPAN_START)), quantiles: MID_QUANTILES };
    const { container } = mountQuantiles(payload);
    expect(refText(container, "P95 ").getAttribute("text-anchor")).toBe("middle");
    expect(refText(container, "P5 ").getAttribute("text-anchor")).toBe("middle");
  });

  it("desktop: a label whose box fits keeps text-anchor middle even on the range end", () => {
    // Font 9: "P95 +1.0%" is 9 * 9 * 0.6 = 48.6 wide, half 24.3, and the tick is at 850 of 880.
    const payload: FactsheetPayload = { ...apiPayload(dailyRows(400, SPAN_START)), quantiles: EDGE_QUANTILES };
    const { container } = mountQuantiles(payload);
    expect(refText(container, "P95 ").getAttribute("text-anchor")).toBe("middle");
    expect(refText(container, "P5 ").getAttribute("text-anchor")).toBe("middle");
  });
});

describe("TimeSeriesChart y tick labels stay inside the svg and off the plot (D-02, D-03a, WR-02)", () => {
  // The Overview's Rolling Sortino (30d) values are in the thousands: "+1000.00" is 8 chars.
  function mountSortino(values: number[]) {
    const daily = dailyRows(values.length, Date.UTC(2026, 0, 1));
    const base = buildScenarioFactsheetPayload({ portfolioDaily: daily }) as unknown as FactsheetPayload;
    const payload = { ...base, strategyRollingSortino: values } as FactsheetPayload;
    const config = CHART_CONFIGS.find((c) => c.key === "rollingSortino")!;
    return render(
      <FactsheetProvider payload={payload} persist={false}>
        <TimeSeriesChart config={config} />
      </FactsheetProvider>,
    );
  }

  /** The y tick labels: end-anchored 10 px mono texts whose string is a signed 2-decimal number. */
  function yTicks(container: HTMLElement): { label: string; x: string | null; anchor: string | null }[] {
    return Array.from(container.querySelectorAll("svg text"))
      .filter((t) => t.getAttribute("font-size") === "10" && /^[+-]?\d+\.\d\d$/.test(t.textContent ?? ""))
      .map((t) => ({ label: t.textContent ?? "", x: t.getAttribute("x"), anchor: t.getAttribute("text-anchor") }));
  }

  /** Where the plot starts: the left end of the horizontal gridlines. */
  function plotLeft(container: HTMLElement): number {
    const xs = Array.from(container.querySelectorAll("svg line"))
      .filter((l) => l.getAttribute("y1") === l.getAttribute("y2"))
      .map((l) => Number(l.getAttribute("x1")));
    expect(xs.length).toBeGreaterThan(0);
    return Math.min(...xs);
  }

  it("an 8-character tick grows the gutter from 50 to 56, so its box starts 2 units inside the svg", () => {
    const { container } = mountSortino(Array.from({ length: 12 }, (_, i) => 500 + i * 250));
    const ticks = yTicks(container);
    expect(ticks.map((t) => t.label)).toEqual(["0.00", "+1000.00", "+2000.00", "+3000.00"]);
    // "+1000.00" at font 10 is 8 * 6 = 48 wide; with the 6-unit gap that needs 54, rounded up to 56.
    expect(plotLeft(container)).toBe(56);
    for (const t of ticks) {
      expect(t.anchor).toBe("end");
      expect(t.x).toBe("50");
    }
  });

  it("a 9-character tick grows the gutter to 60 instead of reaching onto the plot", () => {
    const { container } = mountSortino(Array.from({ length: 12 }, (_, i) => 2000 + i * 1000));
    const ticks = yTicks(container);
    // Precondition: the widest label really is "+10000.00" (9 chars = 54 wide).
    expect(ticks.map((t) => t.label)).toContain("+10000.00");
    // 54 + the 6-unit gap = 60: the label ends at 54 (gutter - 6), starts at 0, and the plot starts at 60.
    expect(plotLeft(container)).toBe(60);
    for (const t of ticks) {
      expect(t.anchor).toBe("end");
      expect(t.x).toBe("54");
    }
  });

  it("ticks that fit everywhere keep the gutter at 50 and x = 44", () => {
    const { container } = mountSortino(Array.from({ length: 12 }, (_, i) => 1 + i * 0.25));
    const ticks = yTicks(container);
    expect(ticks.length).toBeGreaterThan(1);
    expect(plotLeft(container)).toBe(50);
    for (const t of ticks) expect(t.x).toBe("44");
  });
});

describe("EndOfYearBarsPanel legend stays inside the svg (D-02, D-03c)", () => {
  const legend = (container: HTMLElement) => {
    const text = Array.from(container.querySelectorAll("svg text")).find((t) => t.textContent === "Edge Tick Labels");
    if (!text) throw new Error("no strategy legend text in the EOY svg");
    const swatch = Array.from(container.querySelectorAll("svg rect")).find((r) => r.getAttribute("x") === "60" && r.getAttribute("width") === "10");
    if (!swatch) throw new Error("no strategy legend swatch in the EOY svg");
    return { text, swatch };
  };
  const mountEoy = () =>
    render(
      <FactsheetProvider payload={apiPayload(dailyRows(800, SPAN_START))} persist={false}>
        <EndOfYearBarsPanel fullHistoryWithheld={false} />
      </FactsheetProvider>,
    );

  it("mobile: font 16 sits on baseline 17, so its box does not start above the svg; the swatch follows", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const { text, swatch } = legend(mountEoy().container);
    expect(text.getAttribute("font-size")).toBe("16");
    expect(text.getAttribute("y")).toBe("17");
    // The swatch keeps its desktop relation to the baseline: it ends on it (baseline - 6).
    expect(swatch.getAttribute("y")).toBe("11");
    expect(text.textContent).toBe("Edge Tick Labels");
  });

  it("desktop: font 10 stays on baseline 12 and the swatch on 6 (nothing was cut, nothing moves)", () => {
    const { text, swatch } = legend(mountEoy().container);
    expect(text.getAttribute("font-size")).toBe("10");
    expect(text.getAttribute("y")).toBe("12");
    expect(swatch.getAttribute("y")).toBe("6");
  });
});

describe("EndOfYearBarsPanel value labels stay inside the svg (G-01, D-02)", () => {
  // Phase 170.1.3 plan 06 (G-01). The founder's 390 px reading cut a six-digit end-of-year value
  // ("+446948.6%") 10.7 px past the right edge of the svg: the labels are start-anchored beside the
  // bars at a fixed right gutter of 80, which only holds a label up to about 7 characters at font 18.
  // The fix grows the gutter from the widest drawn label (the house rule of ReturnQuantiles and
  // TimeSeriesChart); it must NOT flip the label to an end anchor, which would lay it over the bars.
  //
  // Hand-computed, not read from the code under test. 366 daily rows from 2023-05-01 with
  // r_i = 0.03 + sin(i / 15) * 0.05 compound 2023 to 4603.6 (`node -e`), so the strategy label is
  // "+460360.0%" (10 characters) and 2024 is "+966.4%" (7 characters). The default BTC comparator is
  // drawn too, at font 16 with short labels, so it never sets the gutter here.
  //   mobile font 18: 10 * 18 * 0.6 = 108; gutter = ceil((108 + 6) / 4) * 4 = 116; x = 880 - 116 + 6 = 770
  //                   box ends at 770 + 108 = 878 <= 880.
  //   desktop font 11: 10 * 11 * 0.6 = 66; ceil(72 / 4) * 4 = 72 < 80 so the gutter stays 80; x = 806.
  const LONG_START = Date.UTC(2023, 4, 1);
  const longRows = () =>
    Array.from({ length: 366 }, (_, i) => ({
      date: new Date(LONG_START + i * 86_400_000).toISOString().slice(0, 10),
      value: 0.03 + Math.sin(i / 15) * 0.05,
    }));
  const mountEoy = (rows: { date: string; value: number }[]) =>
    render(
      <FactsheetProvider payload={apiPayload(rows)} persist={false}>
        <EndOfYearBarsPanel fullHistoryWithheld={false} />
      </FactsheetProvider>,
    );
  const valueTexts = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("svg text")).filter((t) => /^[+-]\d+\.\d%$/.test(t.textContent ?? ""));

  it("mobile: the six-digit label moves the gutter to 116, so x = 770 and its box ends inside 880", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const texts = valueTexts(mountEoy(longRows()).container);
    const long = texts.find((t) => t.textContent === "+460360.0%");
    if (!long) throw new Error("no +460360.0% value label: the fixture no longer compounds to six digits");
    expect(long.getAttribute("font-size")).toBe("18");
    expect(long.getAttribute("x")).toBe("770");
    expect(long.getAttribute("text-anchor")).toBe("start");
    for (const t of texts) {
      const right = Number(t.getAttribute("x")) + (t.textContent ?? "").length * Number(t.getAttribute("font-size")) * 0.6;
      expect(right).toBeLessThanOrEqual(880);
      // Nothing hidden, truncated or moved onto a bar.
      expect(t.getAttribute("text-anchor")).toBe("start");
    }
  });

  it("mobile: every label shares the grown gutter, so the 7-character 2024 label sits at 770 too", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    const texts = valueTexts(mountEoy(longRows()).container);
    const second = texts.find((t) => t.textContent === "+966.4%");
    if (!second) throw new Error("no +966.4% value label");
    expect(second.getAttribute("x")).toBe("770");
  });

  it("desktop: the same book keeps the gutter at 80 and every label at x = 806", () => {
    const texts = valueTexts(mountEoy(longRows()).container);
    expect(texts.map((t) => t.textContent)).toContain("+460360.0%");
    for (const t of texts) expect(t.getAttribute("x")).toBe("806");
  });

  it("mobile: labels whose box plus the 6 px gap fits in 80 keep the gutter at 80 (no over-growth)", () => {
    vi.mocked(useBreakpoint).mockReturnValue("mobile");
    // A tame book (about 0.01% a day): every strategy and benchmark label stays short.
    const calm = dailyRows(800, SPAN_START).map((r, i) => ({ date: r.date, value: Math.sin(i / 7) * 0.002 + 0.0001 }));
    const texts = valueTexts(mountEoy(calm).container);
    expect(texts.length).toBeGreaterThan(0);
    // Widest here is the 7-character BTC label at font 16: 67.2 + 6 = 73.2, ceil(73.2 / 4) * 4 = 76 < 80,
    // so the minimum holds and x = 880 - 80 + 6 = 806.
    for (const t of texts) {
      // Precondition, so the case cannot pass by accident: every box plus the 6 px gap fits in 80.
      const width = (t.textContent ?? "").length * Number(t.getAttribute("font-size")) * 0.6;
      expect(width + 6).toBeLessThanOrEqual(80);
      expect(t.getAttribute("x")).toBe("806");
    }
  });
});
