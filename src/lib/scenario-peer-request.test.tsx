// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { buildScenarioPeerRankRequest } from "./scenario-peer-request";
import { PeerPercentilePanel } from "@/app/factsheet/[id]/v2/BatchDPanels";
import { FactsheetProvider } from "@/app/factsheet/[id]/v2/factsheet-context";
import { buildScenarioFactsheetPayload } from "@/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload";

/**
 * Phase 42 Plan 04 (PEER-01/02) as amended by 194 D-18 / review WR-02 - the composer's
 * peer-rank request builder.
 *
 * Encodes WHY the rules matter:
 *   - The builder does NOT judge the blend's record. A blend under D-15's minimum (or with
 *     an unknown record, D-17) is still ranked, because D-18 withholds only the annualised
 *     Sharpe and Sortino ranks and keeps Max drawdown. The old record gate returned null for
 *     both a failing and an unknown record, which dropped the Max DD rank too.
 *   - A degenerate blend (null / non-finite ranking metric) cannot be ranked -> no fetch.
 *   - The body carries the ENGINE's sample-basis sharpe/sortino/max_drawdown verbatim
 *     (PEER-02) - maxDD forwarded as the engine's signed magnitude (the route applies Math.abs).
 *   - The panel is where the annualised ranks are blanked for a withheld blend.
 */

const FULL = { sharpe: 1.42, sortino: 1.88, max_drawdown: -0.123, n: 504 };
const withN = (n: number) => ({ ...FULL, n });

describe("buildScenarioPeerRankRequest - finite gate only (194 D-18)", () => {
  it("returns the request body from the engine sample-basis metrics when they are finite", () => {
    expect(buildScenarioPeerRankRequest(FULL)).toEqual({
      sharpe: 1.42,
      sortino: 1.88,
      maxDD: -0.123,
      n: 504,
    });
  });

  it("forwards maxDD as the engine's SIGNED value (the route owns Math.abs, not this gate)", () => {
    expect(buildScenarioPeerRankRequest({ ...FULL, max_drawdown: -0.25 })?.maxDD).toBe(-0.25);
  });

  it("a SHORT blend (59 observations) still builds a request: its Max DD rank must not be dropped", () => {
    expect(buildScenarioPeerRankRequest(withN(59))).toEqual({
      sharpe: 1.42,
      sortino: 1.88,
      maxDD: -0.123,
      n: 59,
    });
  });

  it("suppresses when n is non-finite (degenerate observation count)", () => {
    expect(buildScenarioPeerRankRequest({ ...FULL, n: NaN })).toBeNull();
  });

  it.each([
    ["sharpe null", { sharpe: null }],
    ["sortino null", { sortino: null }],
    ["max_drawdown null", { max_drawdown: null }],
    ["sharpe NaN", { sharpe: NaN }],
    ["sortino +Infinity", { sortino: Infinity }],
    ["max_drawdown -Infinity", { max_drawdown: -Infinity }],
  ])("suppresses when a ranking metric is non-finite: %s", (_label, override) => {
    expect(buildScenarioPeerRankRequest({ ...FULL, ...override })).toBeNull();
  });

  it("is a pure function of its input (same metrics -> identical body, reload-stable)", () => {
    expect(buildScenarioPeerRankRequest(FULL)).toEqual(buildScenarioPeerRankRequest({ ...FULL }));
  });
});

describe("a withheld blend's peer panel - annualised ranks blank, Max DD keeps its rank", () => {
  it("a 30-day crypto blend with a returned rank shows no Sharpe or Sortino rank and a number for Max DD", () => {
    const dates = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    );
    const payload = buildScenarioFactsheetPayload({
      portfolioDaily: dates.map((date, i) => ({ date, value: [0.01, -0.006, 0.012][i % 3] })),
      benchmark: null,
      scenarioPeer: { cohortSize: 40, sharpe: 71, sortino: 64, max_dd: 38 },
    });
    const view = render(
      <FactsheetProvider payload={payload} persist={false}>
        <PeerPercentilePanel />
      </FactsheetProvider>,
    );
    const text = view.container.textContent ?? "";
    expect(text).toContain("Max DD");
    expect(text).toContain("38");
    expect(text).not.toContain("71");
    expect(text).not.toContain("64");
  });
});
