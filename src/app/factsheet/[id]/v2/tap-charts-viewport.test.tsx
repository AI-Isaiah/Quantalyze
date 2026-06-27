/** @vitest-environment jsdom */
/**
 * Phase 47 Plan 03 / CHART-01a + CHART-02 + CHART-03 — Wave-2 viewport-branch
 * coverage for the TAP-REVEAL charts that live in the two factsheet panel files:
 *
 *   - AnalyticalPanels: StreakDistributionPanel (tap-reveal) + BootstrapCIPanel
 *     (legibility/portrait only — no hover)
 *   - HeatmapPanels: DailyReturnsHeatmap (cell tap-reveal)
 *
 * (DailyHeatmap's new isMobile branch + tap path is covered by the EXTENDED
 *  src/components/charts/DailyHeatmap.test.tsx — not duplicated here.)
 *
 * Why this test exists IN THIS WAVE (not at the Plan-05 gate): Tasks 1-2 grew a
 * new `isMobile ? mobileValue : todaysLiteral` conditional + a `useTapPin` path
 * in each panel. The branch-coverage ratchet (vitest.config.ts branches ≥ 72) is
 * a BLOCKING CI gate, so both arms of every new conditional must be exercised in
 * the same wave they were introduced. This single combined test renders each
 * panel with `useBreakpoint()` forced to BOTH "mobile" and "desktop", and drives
 * a synthetic TOUCH tap on StreakDistribution.
 *
 * It also doubles as a FALSIFIABLE desktop byte-identity assertion: the
 * StreakDistribution desktop root `viewBox` must equal the literal
 * `0 0 440 200` — a mutation of the desktop VB_H literal makes it FAIL (the
 * in-wave half of the no-recompute proof; Plan 05 bakes the full Playwright
 * golden).
 *
 * Zero net-new deps — uses the already-installed `vitest` +
 * `@testing-library/react`, the `buildFactsheetPayload` fixture builder (the
 * no-hover-panels-viewport.test.tsx analog), and `vi.mock` of the breakpoint
 * seam.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";

// Mock the breakpoint seam: a typed handle so each render can pick the branch.
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));
import { useBreakpoint } from "@/hooks/useBreakpoint";

import { FactsheetProvider } from "./factsheet-context";
import { StreakDistributionPanel, BootstrapCIPanel } from "./AnalyticalPanels";
import { DailyReturnsHeatmap } from "./HeatmapPanels";

const mockedUseBreakpoint = vi.mocked(useBreakpoint);

function setBreakpoint(bp: "mobile" | "tablet" | "desktop") {
  mockedUseBreakpoint.mockReturnValue(bp);
}

/**
 * Build a real `FactsheetPayload` from synthetic daily returns. 400 days spans
 * >1 calendar year so `streaks` (winsByLength/lossesByLength) and `dailyHeatmap`
 * are populated. `ingestSource: "api"` is fine; the tap charts read the
 * csv-derivable streak/heatmap fields either way.
 */
function makeApiPayload(): FactsheetPayload {
  const dailyReturns = Array.from({ length: 400 }).map((_, i) => {
    const dayOfYear = i % 360;
    const year = 2023 + Math.floor(i / 360);
    const month = String((Math.floor(dayOfYear / 28) % 12) + 1).padStart(2, "0");
    const day = String((dayOfYear % 28) + 1).padStart(2, "0");
    // Alternating sign with runs so consecutive-streak buckets are non-empty.
    return { date: `${year}-${month}-${day}`, value: Math.sin(i / 3) * 0.008 };
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

/** All root viewBox strings rendered by a panel. */
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

describe("[CHART-01a/02/03] tap-reveal panels — both viewport branches", () => {
  // ---- Render-without-throwing in BOTH branches (covers each isMobile arm) ----

  const panels: Array<{ name: string; node: React.ReactElement }> = [
    { name: "StreakDistributionPanel", node: <StreakDistributionPanel /> },
    { name: "BootstrapCIPanel", node: <BootstrapCIPanel /> },
    { name: "DailyReturnsHeatmap", node: <DailyReturnsHeatmap /> },
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

  // ---- Desktop byte-identity: StreakDistribution literal viewBox (falsifiable) ----

  it("StreakDistribution desktop svgs all use the literal viewBox 0 0 440 200", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<StreakDistributionPanel />);
    const vbs = viewBoxes(container);
    expect(vbs.length).toBeGreaterThan(0); // two side-by-side histograms
    for (const vb of vbs) expect(vb).toBe("0 0 440 200");
  });

  it("BootstrapCI desktop svgs all use the literal viewBox 0 0 340 36", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<BootstrapCIPanel />);
    const vbs = viewBoxes(container);
    expect(vbs.length).toBeGreaterThan(0);
    for (const vb of vbs) expect(vb).toBe("0 0 340 36");
  });

  // ---- Mobile differs from desktop (proves the conditional is LIVE) ----

  it("StreakDistribution mobile viewBox height differs from desktop (taller portrait)", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<StreakDistributionPanel />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<StreakDistributionPanel />).container);
    expect(dH).toBe(200);
    expect(mH).toBeGreaterThan(dH);
  });

  it("BootstrapCI mobile viewBox height differs from desktop", () => {
    setBreakpoint("desktop");
    const dH = firstViewBoxHeight(renderPanel(<BootstrapCIPanel />).container);
    setBreakpoint("mobile");
    const mH = firstViewBoxHeight(renderPanel(<BootstrapCIPanel />).container);
    expect(dH).toBe(36);
    expect(mH).toBeGreaterThan(dH);
  });

  // ---- Synthetic touch tap pins the StreakDistribution reveal (CHART-01a) ----

  it("a synthetic touch tap on StreakDistribution pins a reveal reusing the existing Length…streak copy", () => {
    setBreakpoint("mobile");
    const { container } = renderPanel(<StreakDistributionPanel />);
    // First histogram svg (the "Wins" StreakHist).
    const svg = container.querySelector("svg")!;
    expect(svg).not.toBeNull();

    // jsdom returns a 0-sized rect; stub it to the viewBox (W=440, H=280 on the
    // mobile branch) so the pointer→bar math resolves. Tap the left portion of
    // the plot region (HIST_PAD.left=42 .. so x≈70 lands in the first bar).
    const W = 440;
    const H = 280; // VB_H_MOBILE
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON() {} }) as DOMRect;

    const cx = 70; // inside the plot region, first bar(s)
    const cy = H / 2;
    fireEvent.pointerDown(svg, { clientX: cx, clientY: cy, pointerType: "touch", pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: cx, clientY: cy, pointerType: "touch", pointerId: 1 });

    const reveal = container.querySelector('svg [data-tap-reveal="streak"] text');
    expect(reveal).not.toBeNull();
    // The pinned reveal reuses the existing per-bar <title> copy (no new format).
    expect(reveal?.textContent ?? "").toMatch(/^Length \d+\+?: \d+ streaks?$/);
  });

  it("StreakDistribution does NOT show the pinned reveal by default (desktop mouse render)", () => {
    setBreakpoint("desktop");
    const { container } = renderPanel(<StreakDistributionPanel />);
    expect(container.querySelector('svg [data-tap-reveal="streak"]')).toBeNull();
  });
});
