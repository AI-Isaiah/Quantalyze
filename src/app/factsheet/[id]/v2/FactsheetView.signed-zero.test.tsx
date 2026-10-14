import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 170.6 DISPLAYPOLISH plan 01, the tracer (D-02, D-03, D-05): the KPI strip renders
 * a value that rounds to zero as an unsigned `0.00` / `0.0%`, never `-0.00` / `-0.0%`.
 *
 * Renders the REAL KpiStrip through the REAL FactsheetBody (the kpistrip test's idiom and
 * stubs), with the strategy's Sharpe and Ann. Vol overwritten AFTER the payload is built so
 * the cells receive a raw negative that rounds to zero at the precision they print at.
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
// Installed per test: `unstubGlobals: true` restores stubbed globals before every test.
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

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

function renderStrip() {
  const payload = buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  });
  payload.strategyMetrics.sharpe = -0.004;
  payload.strategyMetrics.ann_vol = -0.0004;
  const { container } = render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} scenarioMode hideAllocatorSection />
    </FactsheetProvider>,
  );
  const grid = Array.from(container.querySelectorAll<HTMLElement>("div.grid")).find((el) =>
    /@[\w[\]-]*:grid-cols-\d/.test(el.className),
  );
  expect(grid, "the KPI strip grid must render").toBeDefined();
  return grid!;
}

function valueOf(grid: HTMLElement, label: string): string {
  const tile = Array.from(grid.children).find((t) => t.querySelector("p")?.textContent?.trim() === label);
  expect(tile, `the ${label} tile must render`).toBeDefined();
  return (tile!.querySelectorAll("p")[1].textContent ?? "").trim();
}

describe("FactsheetView KPI strip, 170.6 D-02: a rounded zero prints unsigned", () => {
  it("a Sharpe of -0.004 reads 0.00, an Ann. Vol of -0.0004 reads 0.0%", () => {
    const grid = renderStrip();
    expect(valueOf(grid, "Sharpe")).toBe("0.00");
    expect(valueOf(grid, "Ann. Vol")).toBe("0.0%");
  });

  it("the strip carries no -0.00 and no -0.0% anywhere", () => {
    const text = renderStrip().textContent ?? "";
    expect(text).not.toContain("-0.00");
    expect(text).not.toContain("-0.0%");
  });
});
