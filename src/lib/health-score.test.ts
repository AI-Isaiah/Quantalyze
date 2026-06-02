/**
 * H-1075 — computePortfolioHealthScore unit tests.
 *
 * The Sprint 4 portfolio-level health score (0-100) drives the KpiStrip
 * score badge banding (Healthy >= 70, Moderate >= 40, Concerning < 40).
 * It has four 25-point components:
 *   - sharpe:      0 pts at <= 0, 25 pts at >= 2.0 (linear in between)
 *   - drawdown:    25 pts at 0% DD, 0 pts at -30%+ (inverted — smaller is better)
 *   - correlation: 25 pts at avg corr <= 0.1, 0 pts at >= 0.8 (inverted — lower is better)
 *   - capacity:    fixed placeholder of 20 until capacity data lands
 *
 * A regression that flips the drawdown sign, swaps the correlation
 * scaler bounds, or breaks the null-guard would silently invert health
 * signaling (users see green on a concerning portfolio) or crash the
 * dashboard. These tests pin the 25-point math and the label/color bucketing.
 */

import { describe, it, expect } from "vitest";
import {
  computePortfolioHealthScore,
  HEALTH_THRESHOLD_HEALTHY,
  HEALTH_THRESHOLD_MODERATE,
} from "./health-score";
import type { PortfolioAnalytics } from "./types";

function makeAnalytics(
  over: Partial<PortfolioAnalytics> = {},
): PortfolioAnalytics {
  return {
    id: "pa-1",
    portfolio_id: "pf-1",
    computed_at: "2026-05-25T00:00:00Z",
    computation_status: "complete",
    computation_error: null,
    total_aum: 1_000_000,
    total_return_twr: 0.1,
    total_return_mwr: 0.1,
    portfolio_sharpe: 1.0,
    portfolio_volatility: 0.1,
    portfolio_max_drawdown: -0.1,
    avg_pairwise_correlation: 0.3,
    return_24h: 0,
    return_mtd: 0,
    return_ytd: 0,
    narrative_summary: null,
    correlation_matrix: null,
    attribution_breakdown: null,
    risk_decomposition: null,
    benchmark_comparison: null,
    optimizer_suggestions: null,
    portfolio_equity_curve: null,
    rolling_correlation: null,
    ...over,
  };
}

describe("computePortfolioHealthScore", () => {
  it("returns null when analytics is null (dashboard null-guard)", () => {
    expect(computePortfolioHealthScore(null)).toBeNull();
  });

  // F2 H-1076 — a portfolio with no computed data (any scored axis null) must
  // NOT score as "Healthy". Before the fix, null coerced to 0 and the inverted
  // drawdown/correlation math made 0 the BEST value: all-null → 0+25+25+20 = 70
  // = "Healthy", a green badge over a portfolio with nothing computed.
  it("H-1076: returns null when a scored axis is null (no false 'Healthy' over empty data)", () => {
    // The exact empty/analytics-pending shape that previously scored 70.
    expect(
      computePortfolioHealthScore(
        makeAnalytics({
          portfolio_sharpe: null,
          portfolio_max_drawdown: null,
          avg_pairwise_correlation: null,
        }),
      ),
    ).toBeNull();
    // Any single missing scored axis is enough — health needs all three.
    expect(
      computePortfolioHealthScore(makeAnalytics({ portfolio_max_drawdown: null })),
    ).toBeNull();
    expect(
      computePortfolioHealthScore(makeAnalytics({ avg_pairwise_correlation: null })),
    ).toBeNull();
    expect(
      computePortfolioHealthScore(makeAnalytics({ portfolio_sharpe: null })),
    ).toBeNull();
  });

  it("awards full 25 pts per scored component for perfect inputs", () => {
    // sharpe=2.0 → 25, dd=0 → 25, corr=0.1 → 25, capacity placeholder=20.
    const result = computePortfolioHealthScore(
      makeAnalytics({
        portfolio_sharpe: 2.0,
        portfolio_max_drawdown: 0,
        avg_pairwise_correlation: 0.1,
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.components).toEqual({
      sharpe: 25,
      drawdown: 25,
      correlation: 25,
      capacity: 20,
    });
    expect(result!.total).toBe(95);
    expect(result!.label).toBe("Healthy");
    expect(result!.color).toBe("positive");
  });

  it("gives 0 sharpe pts when portfolio_sharpe <= 0", () => {
    expect(
      computePortfolioHealthScore(makeAnalytics({ portfolio_sharpe: 0 }))!
        .components.sharpe,
    ).toBe(0);
    expect(
      computePortfolioHealthScore(makeAnalytics({ portfolio_sharpe: -1 }))!
        .components.sharpe,
    ).toBe(0);
  });

  it("scales the sharpe component linearly toward 25 at sharpe=2.0", () => {
    // sharpe=1.0 sits halfway in [0, 2.0] → 12 or 13 pts (Math.round of 12.5).
    const mid = computePortfolioHealthScore(
      makeAnalytics({ portfolio_sharpe: 1.0 }),
    )!.components.sharpe;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(25);
  });

  it("INVERTS drawdown — a mild DD scores high, a deep DD scores 0", () => {
    // dd = -0.05 (mild) must score MORE than dd = -0.30 (deep). If the sign
    // were flipped, mild DD would wrongly collapse to 0.
    const mild = computePortfolioHealthScore(
      makeAnalytics({ portfolio_max_drawdown: -0.05 }),
    )!.components.drawdown;
    const deep = computePortfolioHealthScore(
      makeAnalytics({ portfolio_max_drawdown: -0.3 }),
    )!.components.drawdown;
    expect(mild).toBeGreaterThan(deep);
    expect(deep).toBe(0);
  });

  it("gives 0 drawdown pts at or beyond -30% drawdown", () => {
    expect(
      computePortfolioHealthScore(
        makeAnalytics({ portfolio_max_drawdown: -0.5 }),
      )!.components.drawdown,
    ).toBe(0);
  });

  it("INVERTS correlation — lower avg_pairwise_correlation = higher score", () => {
    const lowCorr = computePortfolioHealthScore(
      makeAnalytics({ avg_pairwise_correlation: 0.1 }),
    )!.components.correlation;
    const highCorr = computePortfolioHealthScore(
      makeAnalytics({ avg_pairwise_correlation: 0.8 }),
    )!.components.correlation;
    expect(lowCorr).toBeGreaterThan(highCorr);
    expect(lowCorr).toBe(25);
    expect(highCorr).toBe(0);
  });

  it("labels 'Concerning' / 'negative' when total < the moderate threshold", () => {
    // Worst case: sharpe 0, dd 0, corr 0, capacity 20 → total 20 < 40.
    const result = computePortfolioHealthScore(
      makeAnalytics({
        portfolio_sharpe: 0,
        portfolio_max_drawdown: -0.4,
        avg_pairwise_correlation: 0.9,
      }),
    )!;
    expect(result.total).toBeLessThan(HEALTH_THRESHOLD_MODERATE);
    expect(result.label).toBe("Concerning");
    expect(result.color).toBe("negative");
  });

  it("labels 'Moderate' / 'warning' between the two thresholds", () => {
    // sharpe 1.0 (~13), dd -0.15 (~12 or 13), corr 0.45 (~12 or 13), capacity 20
    // lands solidly in [40, 70).
    const result = computePortfolioHealthScore(
      makeAnalytics({
        portfolio_sharpe: 1.0,
        portfolio_max_drawdown: -0.15,
        avg_pairwise_correlation: 0.45,
      }),
    )!;
    expect(result.total).toBeGreaterThanOrEqual(HEALTH_THRESHOLD_MODERATE);
    expect(result.total).toBeLessThan(HEALTH_THRESHOLD_HEALTHY);
    expect(result.label).toBe("Moderate");
    expect(result.color).toBe("warning");
  });

  it("H-1076: all-null scored axes return null, NOT a fabricated 70 'Healthy'", () => {
    // REGRESSION (was the bug): this exact input previously coerced each null
    // to 0 via `?? 0`, and the inverted drawdown/correlation math made 0 the
    // BEST value (0 DD → 25, 0 corr → 25), so all-null scored 0+25+25+20 = 70 =
    // "Healthy" — a green badge over a portfolio with nothing computed. The fix
    // returns null when any scored axis is missing.
    expect(
      computePortfolioHealthScore(
        makeAnalytics({
          portfolio_sharpe: null,
          portfolio_max_drawdown: null,
          avg_pairwise_correlation: null,
        }),
      ),
    ).toBeNull();
  });

  it("treats the HEALTHY threshold as inclusive (total === 70 is Healthy)", () => {
    // Locks the `>=` boundary so a future `>` tweak that shifts the band
    // would fail. Uses explicit non-null zeros to land exactly on 70.
    const result = computePortfolioHealthScore(
      makeAnalytics({
        portfolio_sharpe: 0,
        portfolio_max_drawdown: 0,
        avg_pairwise_correlation: 0,
      }),
    )!;
    expect(result.total).toBe(HEALTH_THRESHOLD_HEALTHY);
    expect(result.label).toBe("Healthy");
  });
});
