import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cloneElement, createElement, type ReactElement } from "react";
import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import DrawdownChart, { deriveSnapshotDrawdowns } from "./DrawdownChart";

// Recharts ResponsiveContainer produces width=0/height=0 in jsdom by
// default which suppresses the SVG path render and breaks DOM-introspection
// tests. Stub it with a fixed-size wrapper so child paths actually render.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const FakeResponsiveContainer = ({ children }: { children: ReactElement }) => {
    const child = children as ReactElement<{ width?: number; height?: number }>;
    const cloned = cloneElement(child, { width: 600, height: 200 });
    return createElement(
      "div",
      { style: { width: 600, height: 200 } },
      cloned,
    );
  };
  return { ...actual, ResponsiveContainer: FakeResponsiveContainer };
});

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
  timeframe: "ALL" as const,
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

  // M-0200 — T3 above uses `.includes()`, which would also pass on a
  // near-miss token like `var(--color-chart-strategy-bright)`. Production
  // (DrawdownChart.tsx) sets the scenario stroke to the EXACT canonical
  // token `var(--color-chart-strategy)` and the live stroke to
  // `var(--color-chart-benchmark)`. This stricter variant asserts exact
  // equality so a future rename to a longer/variant token name fails here
  // instead of slipping through the substring match.
  it("M-0200: scenario stroke is EXACTLY 'var(--color-chart-strategy)' and live is EXACTLY 'var(--color-chart-benchmark)' (no variant tokens)", () => {
    const { container } = render(
      <DrawdownChart
        {...baseProps}
        data={EMPTY_DATA}
        equityDailyPoints={LIVE_EQUITY}
        scenarioDailyPoints={SCENARIO_EQUITY}
      />,
    );
    const strokes = Array.from(
      container.querySelectorAll("path.recharts-area-curve"),
    ).map((c) => c.getAttribute("stroke") ?? "");

    // Exact-match predicates: a longer token (e.g. "...-strategy-bright")
    // would fail `===` while still passing the `.includes()` check in T3.
    expect(strokes).toContain("var(--color-chart-strategy)");
    expect(strokes).toContain("var(--color-chart-benchmark)");
    // And neither curve carries a strategy/benchmark variant token.
    for (const s of strokes) {
      if (s.includes("color-chart-strategy")) {
        expect(s).toBe("var(--color-chart-strategy)");
      }
      if (s.includes("color-chart-benchmark")) {
        expect(s).toBe("var(--color-chart-benchmark)");
      }
    }
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

  // H-0166 — Pitfall 1 negative coverage. T8 above only proves the helper is
  // pure (same input twice → same output). It does NOT exercise the
  // cumulative-RETURN-vs-cumulative-WEALTH shape mismatch that
  // DrawdownChart.tsx:32-39 warns about. The widget feeds
  // scenarioDailyPoints straight into deriveSnapshotDrawdowns (line 96),
  // which expects WEALTH form (~1.0 start). If a caller forgets the
  // `point.value + 1` conversion and passes RETURN form (~0.0 start), the
  // peak anchors near zero and the drawdowns blow past the real -100% floor.
  // These tests pin that observable divergence so a future caller that
  // bypasses the queries.ts conversion has a failing contract test, not a
  // silent miscompare.
  describe("H-0166: Pitfall 1 — wealth-form vs return-form divergence", () => {
    // A series that rises to a peak then dips, expressed both ways.
    const WEALTH_FORM: DailyPoint[] = [
      { date: "2026-03-01", value: 1.0 },
      { date: "2026-03-02", value: 1.1 },
      { date: "2026-03-03", value: 0.99 },
      { date: "2026-03-04", value: 1.05 },
    ];
    const RETURN_FORM: DailyPoint[] = WEALTH_FORM.map((p) => ({
      date: p.date,
      value: p.value - 1, // 0.0, 0.10, -0.01, 0.05 — the un-converted form
    }));

    it("correct WEALTH form yields drawdowns inside the valid [-1, 0] band", () => {
      const dd = deriveSnapshotDrawdowns(WEALTH_FORM);
      // peak=1.1 → day3 drawdown = (0.99-1.1)/1.1 = -0.10; day4 = -0.0455.
      expect(dd.map((p) => Number(p.value.toFixed(4)))).toEqual([
        0, 0, -0.1, -0.0455,
      ]);
      for (const p of dd) {
        expect(p.value).toBeLessThanOrEqual(0);
        expect(p.value).toBeGreaterThanOrEqual(-1);
      }
    });

    it("un-converted RETURN form (0.0-start) produces impossible sub-(-100%) drawdowns — the silent miscompare", () => {
      const dd = deriveSnapshotDrawdowns(RETURN_FORM);
      // peak=0.10 → day3 = (-0.01-0.10)/0.10 = -1.10 (i.e. -110%, which is
      // impossible for a real wealth drawdown bounded at -100%).
      const minDd = Math.min(...dd.map((p) => p.value));
      expect(minDd).toBeLessThan(-1);

      // And the two forms genuinely diverge — NOT a tautology like T8.
      const wealthDd = deriveSnapshotDrawdowns(WEALTH_FORM);
      const anyDiffer = dd.some(
        (p, i) => Math.abs(p.value - wealthDd[i].value) > 1e-6,
      );
      expect(anyDiffer).toBe(true);
    });

    it("the widget renders the scenario Area from the helper output, so a return-form caller paints the broken curve (no detection)", () => {
      // The chart does NOT detect the shape mismatch — it trusts the caller
      // contract. Passing RETURN_FORM still renders an Area (no error/flag),
      // which is precisely why the unit-level contract assertions above are
      // the defense. This documents the absence of a guard at the component.
      const { container } = render(
        <DrawdownChart
          {...baseProps}
          data={EMPTY_DATA}
          equityDailyPoints={LIVE_EQUITY}
          scenarioDailyPoints={RETURN_FORM}
        />,
      );
      const curves = container.querySelectorAll("path.recharts-area-curve");
      // Two areas render (live + scenario) with no validation error — the
      // broken curve is painted silently. FLAG: a component-level guard
      // would be a production fix, out of scope for a test-only change.
      expect(curves.length).toBeGreaterThanOrEqual(2);
    });
  });
});
