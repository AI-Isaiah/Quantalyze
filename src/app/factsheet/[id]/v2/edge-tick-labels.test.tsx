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
import { QuantileBoxPlotPanel } from "./DistributionPanels";

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
