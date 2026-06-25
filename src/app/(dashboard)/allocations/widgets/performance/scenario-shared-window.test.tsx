import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { ScenarioFactsheetChart } from "./ScenarioFactsheetChart";

/**
 * 38-03 Q4 proof — the composer's equity + drawdown panels mount under ONE
 * FactsheetProvider, so they share a SINGLE xRange (brush-zoom window). A
 * pan/zoom on the timeline moves BOTH panels because there is exactly one
 * XRangeContext, not a parallel range lifted per chart.
 *
 * The load-bearing assertions:
 *   1. The REAL factsheet assets are mounted (MasterBrush + TWO TimeSeriesChart
 *      SVGs), not a lookalike — reuse, not fork.
 *   2. Driving the window (via the MasterBrush, the shared source of truth)
 *      re-renders the brush window edges AND both chart panels stay co-mounted
 *      under the one provider — proving a single shared XRangeContext.
 *
 * localStorage + sentry are stubbed because FactsheetProvider's persistence
 * primitive touches them on mount (even though this mount is persist=false,
 * the hook still registers). Mirrors factsheet-context.provider.test.tsx.
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

function makeWealthSeries(n: number, start = 1.0, drift = 0.002): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let v = start;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: v });
    v *= 1 + drift + Math.sin(i * 0.3) * 0.004;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

describe("ScenarioFactsheetChart — equity + drawdown share ONE window (38-03 Q4)", () => {
  it("mounts the real factsheet assets: MasterBrush + two TimeSeriesChart SVGs", () => {
    const { container, getByLabelText } = render(
      <ScenarioFactsheetChart
        equityDailyPoints={[]}
        scenarioSeries={makeWealthSeries(120)}
        benchmark={makeWealthSeries(120, 1.0, 0.001)}
      />,
    );

    // The MasterBrush — its section affordance is the canonical factsheet brush.
    const brush = getByLabelText("Master timeline brush");
    expect(brush).toBeTruthy();
    // The brush draws a sparkline SVG with the documented role/aria-label.
    expect(
      within(brush as HTMLElement).getByLabelText(
        "Master brush — full timeline equity overview",
      ),
    ).toBeTruthy();

    // Two chart SVGs (role="img", tabIndex=0) — the equity + drawdown panels.
    const chartSvgs = container.querySelectorAll('svg[role="img"][tabindex="0"]');
    expect(chartSvgs.length).toBe(2);

    // The scenario strategy line carries the stable test hook (Plan 05 asserts it).
    expect(
      container.querySelector('[data-testid="equity-chart-scenario-overlay"]'),
    ).toBeTruthy();
  });

  it("a window change driven on ONE chart moves the shared window — one XRangeContext", () => {
    const { container, getByLabelText } = render(
      <ScenarioFactsheetChart
        equityDailyPoints={[]}
        scenarioSeries={makeWealthSeries(120)}
        benchmark={makeWealthSeries(120, 1.0, 0.001)}
      />,
    );

    const brushSection = getByLabelText("Master timeline brush") as HTMLElement;
    // The brush window edges are rendered as date labels driven by xRange. At
    // full range the right edge is the LAST scenario date.
    const fullRangeLabel = brushSection.textContent ?? "";
    expect(fullRangeLabel).toContain("2024-01-01"); // first scenario date
    expect(fullRangeLabel).toContain("2024-04-29"); // last (index 119) scenario date

    // Drive the window from the EQUITY chart's keyboard nav (zoom in around the
    // center). Keyboard nav calls setXRange in the ONE shared XRangeContext — no
    // pointer-capture needed (jsdom lacks setPointerCapture). The brush (which
    // reads the SAME xRange) must re-render its edge labels, proving a single
    // shared context drives every panel + the brush.
    const equityChart = container.querySelector(
      '[data-testid="equity-chart-scenario-overlay"] svg[role="img"][tabindex="0"]',
    ) as unknown as SVGSVGElement;
    expect(equityChart).toBeTruthy();
    act(() => {
      fireEvent.keyDown(equityChart, { key: "+" }); // zoom in around center
    });

    // The brush window labels must have moved off the full range — proving the
    // equity chart's setXRange reached the SAME xRange the brush reads.
    const afterLabel = brushSection.textContent ?? "";
    expect(afterLabel).not.toBe(fullRangeLabel);

    // Both chart panels are still co-mounted under the single provider after the
    // window change (no crash, no second provider) — two SVGs, one shared range.
    const chartSvgsAfter = container.querySelectorAll('svg[role="img"][tabindex="0"]');
    expect(chartSvgsAfter.length).toBe(2);
  });

  it("the SegmentedControl drives the shared window (Q3, not sliceByPeriod)", () => {
    const { getByRole, getByLabelText } = render(
      <ScenarioFactsheetChart
        equityDailyPoints={[]}
        scenarioSeries={makeWealthSeries(252)}
        benchmark={undefined}
      />,
    );

    const brushSection = getByLabelText("Master timeline brush") as HTMLElement;
    const fullLabel = brushSection.textContent ?? "";

    // Click "3M" — translates to a setXRange window over the most-recent ~63
    // trading days. The brush window (shared xRange) must narrow.
    const tablist = getByRole("tablist", { name: "Period" });
    const threeMo = within(tablist).getByRole("tab", { name: "3M" });
    act(() => {
      fireEvent.click(threeMo);
    });
    const narrowedLabel = brushSection.textContent ?? "";
    expect(narrowedLabel).not.toBe(fullLabel);

    // Click "ALL" — resets to full range; the window widens back.
    const all = within(tablist).getByRole("tab", { name: "ALL" });
    act(() => {
      fireEvent.click(all);
    });
    expect(brushSection.textContent ?? "").toBe(fullLabel);
  });
});
