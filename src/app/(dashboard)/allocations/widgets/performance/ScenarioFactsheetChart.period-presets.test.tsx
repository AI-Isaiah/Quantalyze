import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { formatDay } from "@/lib/utils";
import { ScenarioFactsheetChart } from "./ScenarioFactsheetChart";

/**
 * Phase 239 (CACHE-02) — the composer's 3M/6M/12M presets are the last N CALENDAR months
 * ending on the latest day, and they roll when the series grows.
 *
 * Founder ruling, 2026-11-24 (239-CONTEXT.md):
 *   Q4: "Presets roll, manual stays (Recommended)"
 *   Q5: "12 calendar months (Recommended)"
 *
 * The preset used to be a fixed count of axis points (252 for 12M) registered as a manual
 * range, so it neither covered 12 calendar months nor followed a new latest day. These arms
 * read the brush header (the two edge dates the brush prints) and the range eyebrow.
 *
 * localStorage + Sentry stubs mirror ScenarioFactsheetChart.opening-range.test.tsx.
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
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true`.
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

/** The engine's daily RETURN series: `n` UTC-consecutive days from `startISO`. */
function makeReturnsSeries(n: number, startISO = "2024-01-01", drift = 0.002): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.3) * 0.004,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

function chart(portfolioDaily: DailyPoint[]) {
  return (
    <ScenarioFactsheetChart
      equityDailyPoints={[]}
      scenarioSeries={[]}
      benchmark={undefined}
      portfolioDaily={portfolioDaily}
    />
  );
}

/** The two edge dates the brush header prints. */
function brushEdges(container: HTMLElement): string {
  const brush = within(container).getByLabelText("Master timeline brush");
  return brush.querySelector(".normal-case")?.textContent ?? "";
}

const edges = (start: string, end: string) => `${formatDay(start)} – ${formatDay(end)}`;

function clickPeriod(container: HTMLElement, label: string) {
  const tablist = within(container).getByRole("tablist", { name: "Period" });
  act(() => {
    fireEvent.click(within(tablist).getByRole("tab", { name: label }));
  });
}

function eyebrows(container: HTMLElement): string[] {
  const els = Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="range-eyebrow-"]'));
  // Anti-vacuity: a chart that rendered no eyebrow would pass every `every(...)` check.
  expect(els.length).toBeGreaterThanOrEqual(1);
  return els.map((el) => el.textContent ?? "");
}

describe("ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02)", () => {
  it("12M is the last 12 calendar months ending on the latest day", () => {
    // 500 days from 2024-01-01: the latest day is 2025-05-14.
    const { container } = render(chart(makeReturnsSeries(500)));
    clickPeriod(container, "12M");
    expect(brushEdges(container)).toBe(edges("2024-05-14", "2025-05-14"));
    for (const text of eyebrows(container)) expect(text).toMatch(/^Selected range/);
  });

  it("12M preset rolls to the new latest day on back growth", () => {
    const { container, rerender } = render(chart(makeReturnsSeries(500)));
    clickPeriod(container, "12M");
    // 30 newer days arrive: the latest day is now 2025-06-13.
    rerender(chart(makeReturnsSeries(530)));
    expect(brushEdges(container)).toBe(edges("2024-06-13", "2025-06-13"));
  });

  it("12M preset still ends on the latest day after front growth", () => {
    const { container, rerender } = render(chart(makeReturnsSeries(500)));
    clickPeriod(container, "12M");
    // 30 earlier days arrive (from 2023-12-02); the latest day is still 2025-05-14.
    rerender(chart(makeReturnsSeries(530, "2023-12-02")));
    expect(brushEdges(container)).toBe(edges("2024-05-14", "2025-05-14"));
  });

  it("a preset on a short series is Full history", () => {
    // 200 days is shorter than 12 calendar months.
    const { container } = render(chart(makeReturnsSeries(200)));
    clickPeriod(container, "12M");
    for (const text of eyebrows(container)) expect(text).toMatch(/^Full history/);
    expect(container.querySelectorAll('[data-testid^="range-reset-"]').length).toBe(0);
  });

  it("every period tab stays aria-selected false", () => {
    const { container } = render(chart(makeReturnsSeries(500)));
    for (const label of ["3M", "6M", "12M", "ALL"]) {
      clickPeriod(container, label);
      const tabs = within(within(container).getByRole("tablist", { name: "Period" })).getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["3M", "6M", "12M", "ALL"]);
      for (const tab of tabs) expect(tab.getAttribute("aria-selected")).toBe("false");
    }
  });

  // Smoke arm, not a PROOF-01 gate: on a one-point axis every window equals the full range.
  it("a one-point series ignores a preset", () => {
    const { container } = render(chart(makeReturnsSeries(1)));
    expect(() => clickPeriod(container, "12M")).not.toThrow();
    expect(container.querySelectorAll('[data-testid^="range-reset-"]').length).toBe(0);
  });
});
