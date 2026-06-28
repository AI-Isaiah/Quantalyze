/** @vitest-environment jsdom */
/**
 * Phase 47 Plan 02 / CHART-02 + CHART-03 — Wave-1 viewport-branch coverage for
 * the five NO-hover hand-rolled SVG panels (the ones that get legibility +
 * portrait ONLY, never a new interaction surface):
 *
 *   - DistributionPanels: EndOfYearBars / QuantileBoxPlot / CorrelationStrip /
 *     CorrelationsMatrix
 *   - SignaturePanels: SignaturesSection
 *   - CrossSignaturePanels: CrossSignaturesSection
 *   - HistogramChart
 *   - MasterBrush
 *
 * Why this test exists IN THIS WAVE (not at the Plan-05 gate): each panel grew
 * a new `isMobile ? mobileValue : todaysLiteral` conditional. The branch-
 * coverage ratchet (vitest.config.ts branches ≥ 72) is a BLOCKING CI gate with
 * only ~3.5pts of headroom, so the new branches must be exercised in the same
 * wave they're introduced. This single combined test renders every tuned panel
 * with `useBreakpoint()` forced to BOTH `"mobile"` and `"desktop"`, exercising
 * both arms of each conditional.
 *
 * It also doubles as a FALSIFIABLE desktop byte-identity + keep-all-cells
 * assertion:
 *   - the desktop render's root `viewBox` must equal today's literal VB dims —
 *     a mutation of a desktop VB_H literal in a panel makes the matching
 *     assertion FAIL (the in-wave half of the no-recompute proof; Plan 05 bakes
 *     the full Playwright golden).
 *   - the dense panels' mobile viewBox height differs from desktop (proves the
 *     conditional is LIVE, not dead).
 *   - the CorrelationsMatrix renders the SAME cell count in both branches
 *     (CHART-03 keep-all-cells: no row/col drop at 320px).
 *
 * Zero net-new deps — uses the already-installed `vitest` +
 * `@testing-library/react`, the `buildFactsheetPayload` fixture builder
 * (ComparatorPicker.test.tsx analog), and `vi.mock` of the breakpoint seam
 * (the cleanest seam per the plan's interfaces note).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// Mock the breakpoint seam: a typed handle so each render can pick the branch.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
import { useBreakpoint } from "@/hooks/useBreakpoint";

import { FactsheetProvider } from "./factsheet-context";
import {
  EndOfYearBarsPanel,
  QuantileBoxPlotPanel,
  CorrelationStripPanel,
  CorrelationsMatrixPanel,
} from "./DistributionPanels";
import { SignaturesSection } from "./SignaturePanels";
import { CrossSignaturesSection } from "./CrossSignaturePanels";
import { HistogramChart } from "./HistogramChart";
import { MasterBrush } from "./MasterBrush";

const mockedUseBreakpoint = vi.mocked(useBreakpoint);

function setBreakpoint(bp: "mobile" | "tablet" | "desktop") {
  mockedUseBreakpoint.mockReturnValue(bp);
}

/**
 * Build a real `FactsheetPayload` from synthetic daily returns. `ingestSource:
 * "api"` is required so `eventSignatures` / `benchEventSignatures` are populated
 * — SignaturesSection + CrossSignaturesSection return null on the csv arm. 200
 * days clears every internal length threshold; a couple of year boundaries
 * (2023→2024) so EndOfYearBars renders ≥2 rows. BTC is the active comparator so
 * the correlation matrix + strip have ≥1 benchmark row.
 */
function makeApiPayload(): FactsheetPayload {
  const dailyReturns = Array.from({ length: 400 }).map((_, i) => {
    // Span 2023-01 → 2024-ish so there is more than one calendar year.
    const dayOfYear = i % 360;
    const year = 2023 + Math.floor(i / 360);
    const month = String((Math.floor(dayOfYear / 28) % 12) + 1).padStart(2, "0");
    const day = String((dayOfYear % 28) + 1).padStart(2, "0");
    return { date: `${year}-${month}-${day}`, value: Math.sin(i / 9) * 0.006 };
  });
  const payload = buildFactsheetPayload(
    {
      id: "test-strategy",
      name: "Test Strategy",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-06-27T00:00:00Z",
      trustTier: null,
      ingestSource: "api",
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

/** Render a panel inside the provider; return its container for SVG queries. */
function renderPanel(node: React.ReactElement) {
  return render(<FactsheetProvider payload={makeApiPayload()}>{node}</FactsheetProvider>);
}

/** All root viewBox strings rendered by a panel (Signatures renders many). */
function viewBoxes(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("svg")).map(
    svg => svg.getAttribute("viewBox") ?? "",
  );
}

/** The viewBox HEIGHT (4th token of "0 0 W H") of the first svg. */
function firstViewBoxHeight(container: HTMLElement): number {
  const parts = (viewBoxes(container)[0] ?? "").split(/\s+/);
  return Number(parts[3]);
}

beforeEach(() => {
  setBreakpoint("desktop");
});

describe("[CHART-02/03] no-hover panels — both viewport branches", () => {
  // ---- Render-without-throwing in BOTH branches (covers each isMobile arm) ----

  const panels: Array<{ name: string; node: React.ReactElement }> = [
    { name: "EndOfYearBarsPanel", node: <EndOfYearBarsPanel /> },
    { name: "QuantileBoxPlotPanel", node: <QuantileBoxPlotPanel /> },
    { name: "CorrelationStripPanel", node: <CorrelationStripPanel /> },
    { name: "CorrelationsMatrixPanel", node: <CorrelationsMatrixPanel /> },
    { name: "SignaturesSection", node: <SignaturesSection /> },
    { name: "CrossSignaturesSection", node: <CrossSignaturesSection /> },
    { name: "HistogramChart", node: <HistogramChart /> },
    { name: "MasterBrush", node: <MasterBrush /> },
  ];

  for (const { name, node } of panels) {
    it(`${name} renders on the desktop branch (isMobile=false) with ≥1 svg`, () => {
      setBreakpoint("desktop");
      const { container } = renderPanel(node);
      expect(viewBoxes(container).length).toBeGreaterThan(0);
    });

    it(`${name} renders on the mobile branch (isMobile=true) with ≥1 svg`, () => {
      setBreakpoint("mobile");
      const { container } = renderPanel(node);
      expect(viewBoxes(container).length).toBeGreaterThan(0);
    });
  }

  // ---- Desktop byte-identity: exact desktop viewBox literals (falsifiable) ----

  it("QuantileBoxPlotPanel desktop viewBox is the literal 0 0 880 130", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<QuantileBoxPlotPanel />);
    expect(viewBoxes(container)[0]).toBe("0 0 880 130");
  });

  it("SignaturesSection desktop panels all use the literal viewBox 0 0 880 230", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<SignaturesSection />);
    const vbs = viewBoxes(container);
    expect(vbs.length).toBeGreaterThan(0);
    for (const vb of vbs) expect(vb).toBe("0 0 880 230");
  });

  it("CrossSignaturesSection desktop panels all use the literal viewBox 0 0 880 200", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<CrossSignaturesSection />);
    const vbs = viewBoxes(container);
    expect(vbs.length).toBeGreaterThan(0);
    for (const vb of vbs) expect(vb).toBe("0 0 880 200");
  });

  it("HistogramChart desktop viewBox is the literal 0 0 880 200", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<HistogramChart />);
    expect(viewBoxes(container)[0]).toBe("0 0 880 200");
  });

  it("MasterBrush desktop viewBox is the literal 0 0 1100 60", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<MasterBrush />);
    expect(viewBoxes(container)[0]).toBe("0 0 1100 60");
  });

  it("EndOfYearBarsPanel desktop viewBox is 880-wide (width literal unchanged)", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<EndOfYearBarsPanel />);
    expect(viewBoxes(container)[0]).toMatch(/^0 0 880 \d+$/);
  });

  it("CorrelationStripPanel desktop viewBox is 880-wide (width literal unchanged)", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<CorrelationStripPanel />);
    expect(viewBoxes(container)[0]).toMatch(/^0 0 880 \d+$/);
  });

  // ---- Mobile differs from desktop (proves the conditional is LIVE) ----

  it("QuantileBoxPlot mobile viewBox height differs from desktop (taller portrait)", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<QuantileBoxPlotPanel />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<QuantileBoxPlotPanel />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  it("SignaturesSection mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<SignaturesSection />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<SignaturesSection />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  it("CrossSignaturesSection mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<CrossSignaturesSection />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<CrossSignaturesSection />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  it("HistogramChart mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<HistogramChart />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<HistogramChart />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  it("MasterBrush mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<MasterBrush />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<MasterBrush />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  it("EndOfYearBars mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<EndOfYearBarsPanel />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<EndOfYearBarsPanel />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  it("CorrelationStrip mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<CorrelationStripPanel />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<CorrelationStripPanel />).container);
    expect(mH).toBeGreaterThan(dH);
  });

  // ---- CHART-03 keep-all-cells: matrix cell count equal across branches ----

  it("CorrelationsMatrix renders the SAME cell count on mobile and desktop (no row/col drop)", () => {
    // Cell <rect>s are the matrix data cells; their count is N×N and must be
    // identical across viewports — never sliced/filtered at 320px.
    const cellCount = (container: HTMLElement) =>
      container.querySelectorAll("svg rect").length;

    setBreakpoint("desktop");
    const dCount = cellCount(renderPanel(<CorrelationsMatrixPanel />).container);
    setBreakpoint("mobile");
    const mCount = cellCount(renderPanel(<CorrelationsMatrixPanel />).container);

    expect(dCount).toBeGreaterThan(0);
    expect(mCount).toBe(dCount);
  });
});
