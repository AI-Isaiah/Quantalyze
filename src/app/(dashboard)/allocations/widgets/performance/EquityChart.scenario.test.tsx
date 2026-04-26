import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart } from "./EquityChart";

// ---------------------------------------------------------------------------
// Phase 10 / 10-04 Task 2 — EquityChart scenarioSeries overlay + 3-state
// visibility toggle.
//
// Spec coverage (per CONTEXT.md D-14, UI-SPEC component inventory):
//   - With NO scenarioSeries → existing render path UNCHANGED (no overlay,
//     no toggle).
//   - With scenarioSeries → second SVG path renders using
//     var(--color-chart-strategy) accent stroke alongside the live baseline.
//   - 3-state radiogroup "Live · Scenario · Both" with default "Both".
//   - Toggling to "Live" hides the scenario overlay path.
//   - Toggling to "Scenario" hides (or de-emphasizes) the live baseline.
//   - Empty scenarioSeries (length=0) hides the toggle entirely.
//   - Visibility toggle has aria-label="Equity series visibility".
//
// jsdom rendering caveat: ResizeObserver is undefined in jsdom; the chart's
// fallback width of 960px is used. Existing EquityChart.test.tsx relies on
// the same idiom — preserved verbatim here.
// ---------------------------------------------------------------------------

function makeWealthSeries(n: number, start = 1.0, drift = 0.001): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  let v = start;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: v });
    v *= 1 + drift + Math.sin(i * 0.3) * 0.005;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

describe("EquityChart — scenarioSeries overlay + visibility toggle (10-04)", () => {
  it("T1: no scenarioSeries → no toggle present, no scenario stroke color in DOM", () => {
    const { container, queryByRole } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        initialPeriod="ALL"
      />,
    );
    expect(queryByRole("radiogroup", { name: "Equity series visibility" })).toBeNull();
    // No path uses the canonical scenario accent token.
    const scenarioPaths = container.querySelectorAll(
      'svg path[stroke="var(--color-chart-strategy)"]',
    );
    expect(scenarioPaths.length).toBe(0);
  });

  it("T2: with scenarioSeries → SVG contains a path with stroke var(--color-chart-strategy)", () => {
    const { container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={makeWealthSeries(60, 1.0, 0.002)}
        initialPeriod="ALL"
      />,
    );
    const scenarioPaths = container.querySelectorAll(
      'svg path[stroke="var(--color-chart-strategy)"]',
    );
    expect(scenarioPaths.length).toBeGreaterThanOrEqual(1);
  });

  it("T3: visibility toggle is a radiogroup of 3 radios (Live / Scenario / Both)", () => {
    const { getByRole, getAllByRole } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={makeWealthSeries(60, 1.0, 0.002)}
        initialPeriod="ALL"
      />,
    );
    const group = getByRole("radiogroup", { name: "Equity series visibility" });
    expect(group).toBeTruthy();
    const radios = getAllByRole("radio");
    expect(radios).toHaveLength(3);
    const labels = radios.map((r) => r.textContent?.trim());
    expect(labels).toEqual(["Live", "Scenario", "Both"]);
  });

  it("T4: default toggle = 'Both' → both paths visible", () => {
    const { getByRole, container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={makeWealthSeries(60, 1.0, 0.002)}
        initialPeriod="ALL"
      />,
    );
    const both = getByRole("radio", { name: "Both" });
    expect(both.getAttribute("aria-checked")).toBe("true");
    // Scenario path present
    expect(
      container.querySelectorAll(
        'svg path[stroke="var(--color-chart-strategy)"]',
      ).length,
    ).toBeGreaterThanOrEqual(1);
    // Live baseline path also present (existing token chart-strategy without color- prefix)
    expect(
      container.querySelectorAll('svg path[stroke="var(--chart-strategy)"]')
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("T5: toggle to 'Live' hides the scenario overlay path", () => {
    const { getByRole, container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={makeWealthSeries(60, 1.0, 0.002)}
        initialPeriod="ALL"
      />,
    );
    const live = getByRole("radio", { name: "Live" });
    fireEvent.click(live);
    expect(live.getAttribute("aria-checked")).toBe("true");
    const scenarioPaths = container.querySelectorAll(
      'svg path[stroke="var(--color-chart-strategy)"]',
    );
    expect(scenarioPaths.length).toBe(0);
  });

  it("T6: toggle to 'Scenario' shows scenario path AND de-emphasizes (or hides) the live baseline", () => {
    const { getByRole, container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={makeWealthSeries(60, 1.0, 0.002)}
        initialPeriod="ALL"
      />,
    );
    const scenario = getByRole("radio", { name: "Scenario" });
    fireEvent.click(scenario);
    expect(scenario.getAttribute("aria-checked")).toBe("true");
    // Scenario path still present
    expect(
      container.querySelectorAll(
        'svg path[stroke="var(--color-chart-strategy)"]',
      ).length,
    ).toBeGreaterThanOrEqual(1);
    // Live path either: (a) absent, or (b) rendered with reduced stroke-opacity (visually muted)
    const liveLines = Array.from(
      container.querySelectorAll(
        'svg path[stroke="var(--chart-strategy)"]',
      ),
    );
    const lineOnly = liveLines.find(
      (p) => p.getAttribute("fill") === "none",
    );
    if (lineOnly != null) {
      const op = lineOnly.getAttribute("stroke-opacity");
      expect(op).not.toBeNull();
      const opNum = Number(op);
      expect(Number.isFinite(opNum)).toBe(true);
      expect(opNum).toBeLessThan(1);
    }
    // (else: live line entirely absent — the alternative valid implementation)
  });

  it("T7: empty scenarioSeries (length=0) → toggle hidden, no overlay path", () => {
    const { queryByRole, container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={[]}
        initialPeriod="ALL"
      />,
    );
    expect(
      queryByRole("radiogroup", { name: "Equity series visibility" }),
    ).toBeNull();
    expect(
      container.querySelectorAll(
        'svg path[stroke="var(--color-chart-strategy)"]',
      ).length,
    ).toBe(0);
  });

  it("T8: scenarioSeries=null → toggle hidden (graceful degradation)", () => {
    const { queryByRole } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={null}
        initialPeriod="ALL"
      />,
    );
    expect(
      queryByRole("radiogroup", { name: "Equity series visibility" }),
    ).toBeNull();
  });

  it("T9: visibility toggle radiogroup has aria-label='Equity series visibility'", () => {
    const { getByRole } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={makeWealthSeries(60, 1.0, 0.002)}
        initialPeriod="ALL"
      />,
    );
    const group = getByRole("radiogroup", { name: "Equity series visibility" });
    expect(group.getAttribute("aria-label")).toBe("Equity series visibility");
  });
});
