import { describe, it, expect } from "vitest";
import {
  buildScenarioPeerRankRequest,
  PEER_RANK_MIN_OBS,
} from "./scenario-peer-request";

/**
 * Phase 42 Plan 04 (PEER-01/02/03) — the composer's peer-rank fetch gate.
 *
 * Encodes WHY the suppression rules matter:
 *   - A blend below the 252-obs sample floor cannot be ranked honestly → no
 *     fetch, scenarioPeer stays null, the panel is absent (PEER-03).
 *   - A degenerate blend (null / non-finite ranking metric) cannot be ranked →
 *     no fetch.
 *   - When it qualifies, the body carries the ENGINE's sample/252-basis
 *     sharpe/sortino/max_drawdown verbatim (PEER-02) — maxDD forwarded as the
 *     engine's signed magnitude (the route applies Math.abs, plan 02).
 */

const FULL = { sharpe: 1.42, sortino: 1.88, max_drawdown: -0.123, n: 504 };

describe("buildScenarioPeerRankRequest — sample-floor + finite gate (PEER-03)", () => {
  it("returns the request body from the engine sample-basis metrics when n >= 252 and finite", () => {
    expect(buildScenarioPeerRankRequest(FULL)).toEqual({
      sharpe: 1.42,
      sortino: 1.88,
      maxDD: -0.123,
      n: 504,
    });
  });

  it("forwards maxDD as the engine's SIGNED value (the route owns Math.abs, not this gate)", () => {
    const req = buildScenarioPeerRankRequest({ ...FULL, max_drawdown: -0.25 });
    expect(req?.maxDD).toBe(-0.25);
  });

  it("suppresses (null) exactly at the sample floor boundary n = 251", () => {
    expect(buildScenarioPeerRankRequest({ ...FULL, n: 251 })).toBeNull();
  });

  it("qualifies at exactly n = 252 (the inclusive floor)", () => {
    expect(buildScenarioPeerRankRequest({ ...FULL, n: PEER_RANK_MIN_OBS })).not.toBeNull();
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

  it("is a pure function of its input (same metrics → identical body, reload-stable)", () => {
    const a = buildScenarioPeerRankRequest(FULL);
    const b = buildScenarioPeerRankRequest({ ...FULL });
    expect(a).toEqual(b);
  });
});
