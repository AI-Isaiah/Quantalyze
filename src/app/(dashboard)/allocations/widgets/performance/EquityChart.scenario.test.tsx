import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { EquityChart, toWealth } from "./EquityChart";

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
  it("T1: no scenarioSeries → no toggle present, no scenario overlay path in DOM", () => {
    const { container, queryByRole } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        initialPeriod="ALL"
      />,
    );
    expect(queryByRole("radiogroup", { name: "Equity series visibility" })).toBeNull();
    // ADVERSARIAL-EQ-3: query by data-testid (was: stroke attribute).
    // The live baseline now correctly resolves to the chart-strategy
    // token (was previously broken `var(--chart-strategy)`), so the
    // stroke selector no longer differentiates live vs scenario. The
    // scenario path carries `data-testid="equity-chart-scenario-overlay"`
    // for unambiguous test discrimination.
    const scenarioPaths = container.querySelectorAll(
      '[data-testid="equity-chart-scenario-overlay"]',
    );
    expect(scenarioPaths.length).toBe(0);
  });

  it("T2: with scenarioSeries → SVG contains the scenario overlay path", () => {
    const { container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={toWealth(makeWealthSeries(60, 1.0, 0.002))}
        initialPeriod="ALL"
      />,
    );
    const scenarioPaths = container.querySelectorAll(
      '[data-testid="equity-chart-scenario-overlay"]',
    );
    expect(scenarioPaths.length).toBeGreaterThanOrEqual(1);
    // Sanity: the scenario overlay still uses the chart-strategy token
    // for its stroke (visual identity unchanged from Phase 10).
    expect(scenarioPaths[0].getAttribute("stroke")).toBe(
      "var(--color-chart-strategy)",
    );
  });

  it("T3: visibility toggle is a radiogroup of 3 radios (Live / Scenario / Both)", () => {
    const { getByRole, getAllByRole } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={toWealth(makeWealthSeries(60, 1.0, 0.002))}
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
        scenarioSeries={toWealth(makeWealthSeries(60, 1.0, 0.002))}
        initialPeriod="ALL"
      />,
    );
    const both = getByRole("radio", { name: "Both" });
    expect(both.getAttribute("aria-checked")).toBe("true");
    // Scenario overlay present.
    expect(
      container.querySelectorAll(
        '[data-testid="equity-chart-scenario-overlay"]',
      ).length,
    ).toBeGreaterThanOrEqual(1);
    // Live baseline is the non-overlay chart-strategy line — fill="none",
    // strokeWidth=1.75, no scenario data-testid.
    const liveLines = Array.from(
      container.querySelectorAll(
        'svg path[stroke="var(--color-chart-strategy)"]',
      ),
    ).filter(
      (p) =>
        p.getAttribute("fill") === "none" &&
        !p.hasAttribute("data-testid"),
    );
    expect(liveLines.length).toBeGreaterThanOrEqual(1);
  });

  it("T5: toggle to 'Live' hides the scenario overlay path", () => {
    const { getByRole, container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={toWealth(makeWealthSeries(60, 1.0, 0.002))}
        initialPeriod="ALL"
      />,
    );
    const live = getByRole("radio", { name: "Live" });
    fireEvent.click(live);
    expect(live.getAttribute("aria-checked")).toBe("true");
    const scenarioPaths = container.querySelectorAll(
      '[data-testid="equity-chart-scenario-overlay"]',
    );
    expect(scenarioPaths.length).toBe(0);
  });

  it("T6: toggle to 'Scenario' shows scenario path AND de-emphasizes (or hides) the live baseline", () => {
    const { getByRole, container } = render(
      <EquityChart
        equityDailyPoints={makeWealthSeries(60)}
        scenarioSeries={toWealth(makeWealthSeries(60, 1.0, 0.002))}
        initialPeriod="ALL"
      />,
    );
    const scenario = getByRole("radio", { name: "Scenario" });
    fireEvent.click(scenario);
    expect(scenario.getAttribute("aria-checked")).toBe("true");
    // Scenario path still present
    expect(
      container.querySelectorAll(
        '[data-testid="equity-chart-scenario-overlay"]',
      ).length,
    ).toBeGreaterThanOrEqual(1);
    // Live path either: (a) absent, or (b) rendered with reduced stroke-opacity (visually muted).
    // Live path = chart-strategy stroke, fill=none, no scenario data-testid.
    const liveLines = Array.from(
      container.querySelectorAll(
        'svg path[stroke="var(--color-chart-strategy)"]',
      ),
    ).filter(
      (p) =>
        p.getAttribute("fill") === "none" &&
        !p.hasAttribute("data-testid"),
    );
    const lineOnly = liveLines[0];
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
        '[data-testid="equity-chart-scenario-overlay"]',
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
        scenarioSeries={toWealth(makeWealthSeries(60, 1.0, 0.002))}
        initialPeriod="ALL"
      />,
    );
    const group = getByRole("radiogroup", { name: "Equity series visibility" });
    expect(group.getAttribute("aria-label")).toBe("Equity series visibility");
  });
});

// ---------------------------------------------------------------------------
// H-0165 — Pitfall 1 (cumulative RETURN vs cumulative WEALTH) for the
// EquityChart scenario overlay.
//
// The existing S14b suite only feeds WEALTH-form fixtures (makeWealthSeries
// starts at 1.0), so the wealth-vs-return contract violation can't surface.
// Investigating the actual render reveals WHY a chart-level negative test
// cannot fail here: EquityChart re-anchors every overlay to 1.0 at the
// visible window's first positive value (EquityChart.tsx:382-410 via
// `ov / baseValue`). That re-anchoring absorbs the +1 wealth offset, so a
// monotonic return-form series renders the SAME path as its wealth-form
// twin. The overlay therefore always departs from the 0% baseline — the
// chart is robust to the Pitfall-1 mistake by construction.
//
// What we CAN pin (correct-behavior assertions):
//   (1) a WEALTH-form scenario overlay departs from the same y-baseline as
//       the live line (both start at 100% / 0%), and
//   (2) the chart's internal re-anchoring makes a return-form twin render
//       identically — documenting the absorption so a future refactor that
//       removes the `ov / baseValue` re-anchoring (and thus re-exposes the
//       Pitfall-1 footgun) breaks this test.
//
// The actual load-bearing +1 conversion for the live baseline lives in
// `liveBaselineMetricsFromHoldings` (queries.ts:1706,1716). That function is
// NOT exported, so a regression test on it would require a production export
// change — FLAGGED as out of scope for this test-only task.
// ---------------------------------------------------------------------------

describe("EquityChart — H-0165 Pitfall 1 scenario overlay anchoring", () => {
  // First Y-coordinate of an SVG path's initial "M x,y" command.
  function firstY(d: string | null): number {
    const m = (d ?? "").match(/^M[\d.]+,([\d.]+)/);
    return m ? Number(m[1]) : NaN;
  }

  function scenarioOverlayD(container: HTMLElement): string | null {
    return container
      .querySelector('[data-testid="equity-chart-scenario-overlay"]')
      ?.getAttribute("d") ?? null;
  }

  function liveLineD(container: HTMLElement): string | null {
    const live = Array.from(
      container.querySelectorAll(
        'svg path[stroke="var(--color-chart-strategy)"]',
      ),
    ).find(
      (p) =>
        p.getAttribute("fill") === "none" && !p.hasAttribute("data-testid"),
    );
    return live?.getAttribute("d") ?? null;
  }

  it("(1) WEALTH-form scenario overlay departs from the SAME baseline as the live line (starts at 100%)", () => {
    const live = makeWealthSeries(60, 1.0, 0.001);
    const scenario = toWealth(makeWealthSeries(60, 1.0, 0.003));
    const { container } = render(
      <EquityChart
        equityDailyPoints={live}
        scenarioSeries={scenario}
        initialPeriod="ALL"
      />,
    );
    const oY = firstY(scenarioOverlayD(container));
    const lY = firstY(liveLineD(container));
    expect(Number.isFinite(oY)).toBe(true);
    expect(Number.isFinite(lY)).toBe(true);
    // Both anchored to 1.0 at the window start ⇒ identical first y-pixel.
    // A regression that fails to anchor the scenario overlay to 100% would
    // start it at a different y than the live baseline.
    expect(Math.abs(oY - lY)).toBeLessThan(0.01);
  });

  it("(2) chart re-anchoring absorbs the +1 offset: a RETURN-form twin renders a visually-equivalent overlay (no Pitfall-1 divergence at the chart)", () => {
    const live = makeWealthSeries(60, 1.0, 0.001);
    const wealth = toWealth(makeWealthSeries(60, 1.0, 0.003));
    // Return form = wealth - 1 (the un-converted 0.0-start shape the caller
    // is contractually required to +1 before passing — Pitfall 1). Cast
    // required because the test intentionally passes invalid (return-form)
    // data to document that the chart's re-anchoring absorbs the Pitfall-1
    // mistake — not a real call site, purely a negative-documentation test.
    const returnForm = wealth.map((p) => ({
      date: p.date,
      value: p.value - 1,
    })) as unknown as import("./EquityChart").WealthPoint[];

    const wealthRender = render(
      <EquityChart
        equityDailyPoints={live}
        scenarioSeries={wealth}
        initialPeriod="ALL"
      />,
    );
    const wealthPath = scenarioOverlayD(wealthRender.container);
    wealthRender.unmount();

    const returnRender = render(
      <EquityChart
        equityDailyPoints={live}
        scenarioSeries={returnForm}
        initialPeriod="ALL"
      />,
    );
    const returnPath = scenarioOverlayD(returnRender.container);

    expect(wealthPath).not.toBeNull();
    expect(returnPath).not.toBeNull();

    // Parse both paths into (x,y) vertex pairs.
    function vertices(d: string): Array<[number, number]> {
      return [...d.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [
        Number(m[1]),
        Number(m[2]),
      ]);
    }
    const wv = vertices(wealthPath!);
    const rv = vertices(returnPath!);

    // The `ov / baseValue` re-anchoring (EquityChart.tsx:382-410) normalizes
    // BOTH forms to the same shape, so the two overlays coincide to within
    // sub-pixel float drift (NOT byte-identical — the different baseValue
    // divisor introduces ~0.01px rounding). Same vertex count, and every
    // vertex within 0.05px. A refactor that removes the re-anchoring (re-
    // exposing the Pitfall-1 footgun) would shift the return-form overlay
    // wholesale — far beyond this tolerance — and fail this assertion.
    expect(rv.length).toBe(wv.length);
    for (let i = 0; i < wv.length; i++) {
      expect(Math.abs(rv[i][0] - wv[i][0])).toBeLessThan(0.05);
      expect(Math.abs(rv[i][1] - wv[i][1])).toBeLessThan(0.05);
    }
  });
});
