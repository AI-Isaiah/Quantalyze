import { describe, it, expect, vi, afterAll } from "vitest";
import { render, within } from "@testing-library/react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";
import { FactsheetProvider } from "./factsheet-context";
import { FactsheetBody } from "./FactsheetView";

/**
 * Phase 134 (smoothed_mtm kill-switch) — the DARK (flag-OFF) default of the
 * SegmentedControl smoothed segment. SMOOTHED_MTM_UI_ENABLED is a build-time
 * module-load const read from process.env at import time, so the flag must be
 * FORCED OFF before closed-sets is imported. vi.hoisted runs before all static
 * imports — delete the env here so the const reads false even if a sibling file
 * leaked "true" into this worker's process.env (isolate resets the module
 * registry, not process.env).
 *
 * The ON posture (segment renders enabled/disabled per bundle presence) is the
 * whole "Phase 133 SMTM-01 smoothed basis render surfaces" suite in
 * FactsheetBody.basis.test.tsx, which opts the flag ON via the same hoisted idiom.
 *
 * The load-bearing pin: with the flag OFF the smoothed segment is HIDDEN (not
 * rendered at all — never merely disabled), the control is the byte-identical
 * two-segment cash/MTM toggle, and no smoothed disabled-reason paragraph renders.
 */
vi.hoisted(() => {
  delete process.env.NEXT_PUBLIC_SMOOTHED_MTM_ENABLED;
});
afterAll(() => {
  delete process.env.NEXT_PUBLIC_SMOOTHED_MTM_ENABLED;
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

const CASH = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};
const SMOOTHED = {
  cumulative_return: 0.44,
  volatility: 0.09,
  max_drawdown: -0.03,
  cagr: 0.22,
  sharpe: 1.7,
  sortino: 2.4,
  calmar: 3.3,
};

function base(): FactsheetPayload {
  return buildScenarioFactsheetPayload({
    portfolioDaily: makeReturnsSeries(300),
    benchmark: null,
  }) as unknown as FactsheetPayload;
}

// The FLAGSHIP options composite: MTM honestly gated OFF (unsmoothed_options_book),
// smoothed OPEN with a persisted basis. This is exactly the fixture that renders
// THREE segments when the flag is ON (FactsheetBody.basis.test.tsx). With the flag
// OFF it must collapse to the two-segment cash/MTM control.
function fixtureCompositeSmoothedFlagship(): FactsheetPayload {
  return {
    ...base(),
    dataQuality: { composite: true },
    metricsByBasis: { cash_settlement: CASH, smoothed_mtm: SMOOTHED },
    mtmGate: { available: false, reason: "unsmoothed_options_book" },
    smoothedGate: { available: true },
  } as unknown as FactsheetPayload;
}

function renderBody(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody
        payload={payload}
        hideHeader
        hideAllocatorSection
        hideFooter={false}
      />
    </FactsheetProvider>,
  );
}

describe("FactsheetBody — Phase 134 smoothed_mtm kill-switch (UI dark default)", () => {
  it("flag OFF: the smoothed segment is NOT rendered — the control is the two-segment cash/MTM toggle", () => {
    const { container } = renderBody(fixtureCompositeSmoothedFlagship());
    const group = container.querySelector(
      '[role="group"][aria-label="Metrics basis"]',
    );
    // The control still renders (mtmGate present) — the flag only hides the THIRD segment.
    expect(group, "the cash/MTM basis toggle still renders").not.toBeNull();
    const g = within(group as HTMLElement);
    // cash + MTM segments are UNAFFECTED by the flag.
    expect(g.getByText("Cash settlement")).toBeTruthy();
    expect(g.getByText("Mark-to-market")).toBeTruthy();
    // The smoothed segment is HIDDEN — not merely disabled, absent from the DOM.
    expect(
      g.queryByText("Smoothed mark-to-market"),
      "dark launch: the smoothed segment must NOT be rendered when SMOOTHED_MTM_UI_ENABLED is off",
    ).toBeNull();
  });

  it("flag OFF: no smoothed disabled-reason paragraph leaks anywhere in the body", () => {
    const { container } = renderBody(fixtureCompositeSmoothedFlagship());
    // The smoothed pending/unavailable copy must not surface while the basis is dark.
    expect(container.textContent ?? "").not.toMatch(/smoothed/i);
  });
});
