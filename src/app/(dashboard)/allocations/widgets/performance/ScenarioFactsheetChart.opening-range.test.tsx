import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { ScenarioFactsheetChart } from "./ScenarioFactsheetChart";

/**
 * Phase 201.1 plan 04 (D-07, SC-7) — the composer opens on the FULL range even when
 * its return series reaches the chart AFTER the chart mounted.
 *
 * Why this matters: the composer fetches the added strategies' returns lazily, on the
 * first add. Before that lands, `portfolioDaily` is `[]`, the synthesized payload has
 * `dates: []`, and `FactsheetProvider` sees a 1-point axis. If the provider seeded its
 * range from that axis once and never followed it, the user saw
 * `Selected range: <d> – <same d>`, a "Reset to full history" control and dashes in the
 * KPI strip until they pressed the control (UAT 2026-11-12). The intent pinned here: a
 * range the user did NOT set always follows the series. The assertions read the eyebrow
 * PREFIX, never a full date string, so they hold whatever the date helpers' spacing is.
 *
 * localStorage + Sentry stubs mirror scenario-shared-window.test.tsx (the provider's
 * persistence primitive touches them on mount even with persist={false}).
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
// Installed PER TEST: `vitest.config.ts` sets `unstubGlobals: true`, which restores
// stubbed globals before every test (same reason as scenario-shared-window.test.tsx).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

// Copied from scenario-shared-window.test.tsx: the engine's `portfolio_daily_returns`
// (daily RETURN form), UTC consecutive days from 2024-01-01.
function makeReturnsSeries(n: number, drift = 0.002): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < n; i++) {
    pts.push({
      date: d.toISOString().slice(0, 10),
      value: drift + Math.sin(i * 0.3) * 0.004,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const EM_DASH = "—";

function chartProps(portfolioDaily: DailyPoint[]) {
  return {
    equityDailyPoints: [] as DailyPoint[],
    scenarioSeries: [] as DailyPoint[],
    benchmark: undefined,
    portfolioDaily,
  };
}

function assertOpensOnFullHistory(container: HTMLElement) {
  const eyebrows = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid^="range-eyebrow-"]'),
  );
  // Anti-vacuity: a chart that rendered no eyebrow would pass every `every(...)` below.
  expect(eyebrows.length).toBeGreaterThanOrEqual(1);
  for (const el of eyebrows) {
    expect(el.textContent ?? "").toMatch(/^Full history/);
    expect(el.textContent ?? "").not.toMatch(/^Selected range/);
  }
  expect(container.querySelectorAll('[data-testid^="range-reset-"]').length).toBe(0);

  const kpiValues = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="factsheet-kpi-value"]'),
  ).map((el) => (el.textContent ?? "").trim());
  expect(kpiValues.length).toBeGreaterThanOrEqual(1);
  // The first return figure prints a number, and the strip is not all dashes.
  expect(kpiValues[0]).not.toBe(EM_DASH);
  expect(kpiValues.some((v) => v !== EM_DASH)).toBe(true);
}

describe("ScenarioFactsheetChart — opens on the full range when the series grows after mount (D-07)", () => {
  it("rerender arm: empty series at mount, 120 points after → Full history, no reset control, KPI figures", () => {
    const { container, rerender } = render(
      <ScenarioFactsheetChart {...chartProps([])} />,
    );
    rerender(<ScenarioFactsheetChart {...chartProps(makeReturnsSeries(120))} />);
    assertOpensOnFullHistory(container);
  });

  it("control arm: 120 points at mount → Full history, no reset control, KPI figures", () => {
    const { container } = render(
      <ScenarioFactsheetChart {...chartProps(makeReturnsSeries(120))} />,
    );
    assertOpensOnFullHistory(container);
  });
});
