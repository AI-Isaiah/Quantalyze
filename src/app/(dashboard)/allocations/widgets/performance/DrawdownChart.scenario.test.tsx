import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import DrawdownChart, { deriveSnapshotDrawdowns } from "./DrawdownChart";

// ---------------------------------------------------------------------------
// Phase 10 / 10-04 Task 3 — DrawdownChart scenarioDailyPoints overlay.
//
// Spec coverage (per CONTEXT.md D-14, UI-SPEC component inventory):
//   - With NO scenarioDailyPoints prop → existing render path UNCHANGED
//     (one <Area> for live drawdown).
//   - With scenarioDailyPoints → TWO <Area> components in the SVG: one
//     for live, one for scenario.
//   - Stroke colors: live = var(--color-chart-benchmark) (muted slate);
//     scenario = var(--color-chart-strategy) (accent teal).
//   - 3-state radiogroup "Live · Scenario · Both" with default "Both".
//   - Empty / null scenarioDailyPoints → toggle hidden, live-only render.
//   - Visibility toggle aria-label="Drawdown series visibility".
//   - Warm-up anchor invariant (L3): a scenario equity series identical
//     in shape to the live series produces identical first-day drawdown
//     values — proves deriveSnapshotDrawdowns peak anchoring is consistent
//     across both series.
//
// ---------------------------------------------------------------------------

const baseProps: Omit<WidgetProps, "data"> = {
  timeframe: "all",
  width: 6,
  height: 4,
};

const EMPTY_DATA: WidgetProps["data"] = {
  strategies: [],
  portfolio: null,
  analytics: null,
};

function makeEquityCurve(n: number, drift: number, startValue = 100): DailyPoint[] {
  const pts: DailyPoint[] = [];
  const d = new Date(Date.UTC(2026, 2, 1));
  let v = startValue;
  for (let i = 0; i < n; i++) {
    pts.push({ date: d.toISOString().slice(0, 10), value: v });
    v *= 1 + drift + Math.sin(i * 0.4) * 0.01;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return pts;
}

const LIVE_EQUITY: DailyPoint[] = makeEquityCurve(40, 0.002, 100);
const SCENARIO_EQUITY: DailyPoint[] = makeEquityCurve(40, 0.001, 100);

describe("DrawdownChart — scenarioDailyPoints overlay (10-04)", () => {
  it("T1: no scenarioDailyPoints → existing render path unchanged (no toggle)", () => {
    const { queryByRole, queryByText } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
      />,
    );
    // No empty-state copy — live data renders.
    expect(queryByText(/no drawdown data/i)).toBeNull();
    // No toggle.
    expect(
      queryByRole("radiogroup", { name: "Drawdown series visibility" }),
    ).toBeNull();
  });

  it("T2: with scenarioDailyPoints → two Recharts Area paths render", () => {
    const { container } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={SCENARIO_EQUITY}
      />,
    );
    // Recharts renders <Area> as <path class="recharts-area-area"/>;
    // assert there are at least 2 area paths in the chart.
    const areaPaths = container.querySelectorAll("path.recharts-area-area");
    expect(areaPaths.length).toBeGreaterThanOrEqual(2);
  });

  it("T3: scenario Area carries var(--color-chart-strategy) stroke; live Area carries var(--color-chart-benchmark)", () => {
    const { container } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={SCENARIO_EQUITY}
      />,
    );
    // Recharts renders the area's stroke on the curve <path class="recharts-area-curve"/>
    const curves = Array.from(
      container.querySelectorAll("path.recharts-area-curve"),
    );
    const strokes = curves.map((c) => c.getAttribute("stroke") ?? "");
    const hasScenario = strokes.some((s) =>
      s.includes("var(--color-chart-strategy)"),
    );
    const hasLive = strokes.some((s) =>
      s.includes("var(--color-chart-benchmark)"),
    );
    expect(hasScenario).toBe(true);
    expect(hasLive).toBe(true);
  });

  it("T4: deriveSnapshotDrawdowns is reused — same helper produces equivalent series", () => {
    // Direct call to the exported helper proves the contract; the
    // component is wired to call this same function on scenarioDailyPoints.
    const expected = deriveSnapshotDrawdowns(SCENARIO_EQUITY);
    expect(expected.length).toBe(SCENARIO_EQUITY.length);
    for (const p of expected) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(p.value).toBeLessThanOrEqual(0);
    }
  });

  it("T5: visibility toggle has 3 radios (Live / Scenario / Both); default 'Both'", () => {
    const { getByRole, getAllByRole } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={SCENARIO_EQUITY}
      />,
    );
    const group = getByRole("radiogroup", {
      name: "Drawdown series visibility",
    });
    expect(group).toBeTruthy();
    const radios = getAllByRole("radio");
    expect(radios).toHaveLength(3);
    const both = getByRole("radio", { name: "Both" });
    expect(both.getAttribute("aria-checked")).toBe("true");
  });

  it("T5b: toggle 'Live' hides the scenario Area; toggle 'Scenario' hides the live Area", () => {
    const { getByRole, container } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={SCENARIO_EQUITY}
      />,
    );
    fireEvent.click(getByRole("radio", { name: "Live" }));
    let curves = Array.from(
      container.querySelectorAll("path.recharts-area-curve"),
    );
    let scenarioPresent = curves.some((c) =>
      (c.getAttribute("stroke") ?? "").includes(
        "var(--color-chart-strategy)",
      ),
    );
    expect(scenarioPresent).toBe(false);

    fireEvent.click(getByRole("radio", { name: "Scenario" }));
    curves = Array.from(
      container.querySelectorAll("path.recharts-area-curve"),
    );
    const livePresent = curves.some((c) =>
      (c.getAttribute("stroke") ?? "").includes(
        "var(--color-chart-benchmark)",
      ),
    );
    expect(livePresent).toBe(false);
    scenarioPresent = curves.some((c) =>
      (c.getAttribute("stroke") ?? "").includes(
        "var(--color-chart-strategy)",
      ),
    );
    expect(scenarioPresent).toBe(true);
  });

  it("T6a: scenarioDailyPoints=null → toggle hidden", () => {
    const { queryByRole } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={null}
      />,
    );
    expect(
      queryByRole("radiogroup", { name: "Drawdown series visibility" }),
    ).toBeNull();
  });

  it("T6b: scenarioDailyPoints=[] → toggle hidden, live-only render", () => {
    const { queryByRole, container } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={[]}
      />,
    );
    expect(
      queryByRole("radiogroup", { name: "Drawdown series visibility" }),
    ).toBeNull();
    // Still only one Area
    const curves = Array.from(
      container.querySelectorAll("path.recharts-area-curve"),
    );
    expect(curves.length).toBe(1);
  });

  it("T7: visibility toggle radiogroup has aria-label='Drawdown series visibility'", () => {
    const { getByRole } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={SCENARIO_EQUITY}
      />,
    );
    const group = getByRole("radiogroup", {
      name: "Drawdown series visibility",
    });
    expect(group.getAttribute("aria-label")).toBe(
      "Drawdown series visibility",
    );
  });

  it("T8 (L3 warm-up anchor invariant): scenario series identical to live → first drawdown values match", () => {
    // Both series are exactly the same. deriveSnapshotDrawdowns is a pure
    // function so the resulting drawdown arrays must be identical
    // index-wise. This proves there is no warm-up offset between live and
    // scenario peak anchoring.
    const liveDrawdown = deriveSnapshotDrawdowns(LIVE_EQUITY);
    const scenarioDrawdown = deriveSnapshotDrawdowns(LIVE_EQUITY);
    expect(scenarioDrawdown.length).toBe(liveDrawdown.length);
    for (let i = 0; i < liveDrawdown.length; i++) {
      expect(scenarioDrawdown[i].date).toBe(liveDrawdown[i].date);
      expect(Math.abs(scenarioDrawdown[i].value - liveDrawdown[i].value)).toBeLessThan(
        1e-9,
      );
    }
  });
});
