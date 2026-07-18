/** @vitest-environment jsdom */
/**
 * Phase 117 / UIFIX-02 — clip-proof focus indicators under overflow (WCAG 2.4.7).
 *
 * WHY (Rule 9 — intent, not just behavior): a focus-visible indicator drawn as a
 * positive-offset CSS `outline` (or the browser DEFAULT outline) paints OUTSIDE
 * the element's border box, so an ancestor `overflow-x-auto` / `overflow-hidden`
 * container CLIPS it at the scroll-viewport edge — the keyboard-focus ring becomes
 * invisible exactly at the sites that scroll. The fix is the in-repo CLIP-PROOF
 * idiom (`focus-visible:ring-2 ring-inset ring-accent`): an INSET box-shadow ring
 * paints INSIDE the element bounds, so it is always within the scroll viewport and
 * never clipped. Full-opacity `ring-accent` (NOT `ring-accent/20`) is required to
 * clear the WCAG 1.4.11 ≥3:1 non-text-contrast floor the UI-SPEC binds this to.
 *
 * These assertions render the LIVE DOM the route ships (real FactsheetBody /
 * HeatmapPanels / DistributionPanels via FactsheetProvider) and are RED on the
 * unfixed tree (positive-offset outline / no explicit ring) → GREEN after 117-02
 * Task 2 repoints the className at each enumerated overflow site.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";
import { MonthlyReturnsHeatmap, DailyReturnsHeatmap } from "./HeatmapPanels";
import { CorrelationsMatrixPanel } from "./DistributionPanels";

// The correlation matrix branches on useBreakpoint; pin desktop so the region
// renders deterministically (mirrors no-hover-panels-viewport.test.tsx).
vi.mock("@/hooks/useBreakpoint", () => ({
  useBreakpoint: vi.fn(() => "desktop" as const),
}));

// FactsheetBody render harness stubs (mirrors FactsheetView.kpistrip.test.tsx).
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

// The clip-proof tokens every fixed overflow site must carry. `outline-none`
// SUPPRESSES the UA default outline — without it, keyboard focus paints BOTH the
// inset accent ring AND the browser outline, and the latter (drawn outside the
// box) is still clipped at the scroll edge: the exact defect UIFIX-02 targets.
const RING_TOKENS = [
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-inset",
  "focus-visible:ring-accent",
] as const;

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

function renderBody() {
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
}

// A real API payload (400 days, crypto) so the heatmap grids + correlation
// matrix clear their length thresholds and render their scroll regions.
function makeApiPayload(): FactsheetPayload {
  const dailyReturns = Array.from({ length: 400 }).map((_, i) => {
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

describe("[UIFIX-02] factsheet section-nav — clip-proof focus ring, not a clipped positive-offset outline", () => {
  it("every section-nav anchor carries the inset ring tokens and NOT the outside-painting outline-offset (WCAG 2.4.7)", () => {
    renderBody();
    const nav = screen.getByRole("navigation", { name: "Factsheet sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      for (const token of RING_TOKENS) {
        expect(link.className).toContain(token);
      }
      // The positive-offset outline draws OUTSIDE the element → clipped by the
      // nav's overflow-x-auto. It must be gone.
      expect(link.className).not.toContain("outline-offset-1");
      // /20-opacity accent fails WCAG 1.4.11 ≥3:1 — full opacity only.
      expect(link.className).not.toContain("ring-accent/20");
    }
  });
});

describe("[UIFIX-02] HeatmapPanels — clip-proof focus ring on the scroll regions", () => {
  it("the monthly-returns scroll region carries the inset ring tokens (WCAG 2.4.7)", () => {
    render(
      <FactsheetProvider payload={makeApiPayload()}>
        <MonthlyReturnsHeatmap />
      </FactsheetProvider>,
    );
    const region = screen.getByRole("region", { name: /Monthly returns/i });
    for (const token of RING_TOKENS) {
      expect(region.className).toContain(token);
    }
    expect(region.className).not.toContain("ring-accent/20");
  });

  it("the daily-returns-calendar scroll region carries the inset ring tokens (WCAG 2.4.7)", () => {
    render(
      <FactsheetProvider payload={makeApiPayload()}>
        <DailyReturnsHeatmap />
      </FactsheetProvider>,
    );
    const region = screen.getByRole("region", { name: /Daily returns calendar/i });
    for (const token of RING_TOKENS) {
      expect(region.className).toContain(token);
    }
    expect(region.className).not.toContain("ring-accent/20");
  });
});

describe("[UIFIX-02] DistributionPanels — clip-proof focus ring on the correlation-matrix region", () => {
  it("the correlation-matrix scroll region carries the inset ring tokens (WCAG 2.4.7)", () => {
    render(
      <FactsheetProvider payload={makeApiPayload()}>
        <CorrelationsMatrixPanel />
      </FactsheetProvider>,
    );
    const region = screen.getByRole("region", { name: /Correlation matrix/i });
    for (const token of RING_TOKENS) {
      expect(region.className).toContain(token);
    }
    expect(region.className).not.toContain("ring-accent/20");
  });
});
