import { describe, expect, it } from "vitest";

import {
  ACTIVE_PORTFOLIO_ID as SEED_ACTIVE_PORTFOLIO_ID,
  ALLOCATOR_ACTIVE as SEED_ALLOCATOR_ACTIVE,
  ALLOCATOR_COLD as SEED_ALLOCATOR_COLD,
  ALLOCATOR_STALLED as SEED_ALLOCATOR_STALLED,
  COLD_PORTFOLIO_ID as SEED_COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID as SEED_STALLED_PORTFOLIO_ID,
  STRATEGY_PROFILES,
  STRATEGY_UUIDS,
  approximateMwr,
  formatSignedPct,
  generatePortfolioAnalyticsJSONB,
  type PortfolioAnalyticsHolding,
} from "../../scripts/seed-demo-data";
import {
  ACTIVE_PORTFOLIO_ID,
  ALLOCATOR_ACTIVE_ID,
  ALLOCATOR_COLD_ID,
  ALLOCATOR_STALLED_ID,
  COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID,
} from "@/lib/demo";
import { adaptPortfolioAnalytics } from "@/lib/portfolio-analytics-adapter";

/**
 * Seed-integrity tests.
 *
 * The canonical source of truth for demo allocator + portfolio UUIDs is
 * `src/lib/demo.ts` (read by the public /demo route). The seed script holds
 * its own parallel copy — this test asserts both copies stay in sync so drift
 * never silently breaks the demo lane.
 *
 * It also locks in the shape of `generatePortfolioAnalyticsJSONB()` so the
 * rows it writes round-trip cleanly through `adaptPortfolioAnalytics()` — the
 * same parser the /demo page uses to hydrate its hero cards.
 */

describe("seed strategy profiles", () => {
  it("exposes exactly 8 demo strategies", () => {
    expect(STRATEGY_PROFILES).toHaveLength(8);
    expect(STRATEGY_UUIDS).toHaveLength(8);
  });

  it("every strategy profile points at its matching STRATEGY_UUIDS slot", () => {
    for (let i = 0; i < STRATEGY_PROFILES.length; i++) {
      expect(STRATEGY_PROFILES[i].id).toBe(STRATEGY_UUIDS[i]);
    }
  });
});

describe("seed allocator UUIDs match src/lib/demo.ts", () => {
  it("ALLOCATOR_ACTIVE matches", () => {
    expect(SEED_ALLOCATOR_ACTIVE).toBe(ALLOCATOR_ACTIVE_ID);
  });

  it("ALLOCATOR_COLD matches", () => {
    expect(SEED_ALLOCATOR_COLD).toBe(ALLOCATOR_COLD_ID);
  });

  it("ALLOCATOR_STALLED matches", () => {
    expect(SEED_ALLOCATOR_STALLED).toBe(ALLOCATOR_STALLED_ID);
  });
});

describe("seed portfolio UUIDs match src/lib/demo.ts", () => {
  it("ACTIVE_PORTFOLIO_ID matches", () => {
    expect(SEED_ACTIVE_PORTFOLIO_ID).toBe(ACTIVE_PORTFOLIO_ID);
  });

  it("COLD_PORTFOLIO_ID matches", () => {
    expect(SEED_COLD_PORTFOLIO_ID).toBe(COLD_PORTFOLIO_ID);
  });

  it("STALLED_PORTFOLIO_ID matches", () => {
    expect(SEED_STALLED_PORTFOLIO_ID).toBe(STALLED_PORTFOLIO_ID);
  });
});

// ---------- generatePortfolioAnalyticsJSONB ----------

function buildActiveHoldings(): PortfolioAnalyticsHolding[] {
  return [
    {
      strategy_id: STRATEGY_PROFILES[0].id,
      strategy_name: STRATEGY_PROFILES[0].name,
      weight: 0.4,
      profile: STRATEGY_PROFILES[0],
    },
    {
      strategy_id: STRATEGY_PROFILES[1].id,
      strategy_name: STRATEGY_PROFILES[1].name,
      weight: 0.35,
      profile: STRATEGY_PROFILES[1],
    },
    {
      strategy_id: STRATEGY_PROFILES[2].id,
      strategy_name: STRATEGY_PROFILES[2].name,
      weight: 0.25,
      profile: STRATEGY_PROFILES[2],
    },
  ];
}

describe("generatePortfolioAnalyticsJSONB", () => {
  it("is deterministic — the same seed produces byte-identical output", () => {
    const holdings = buildActiveHoldings();
    const a = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9001);
    const b = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9001);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces distinct output for different seeds", () => {
    const holdings = buildActiveHoldings();
    const a = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9001);
    const b = generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, holdings, 9002);
    expect(a.total_return_twr).not.toBe(b.total_return_twr);
  });

  it("populates all demo-critical fields without nulls", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );

    // Scalars the /demo hero depends on directly.
    expect(payload.computation_status).toBe("complete");
    expect(payload.total_return_twr).not.toBeNull();
    expect(Number.isFinite(payload.total_return_twr)).toBe(true);
    expect(payload.portfolio_sharpe).not.toBeNull();
    expect(Number.isFinite(payload.portfolio_sharpe)).toBe(true);
    expect(payload.portfolio_max_drawdown).not.toBeNull();
    expect(Number.isFinite(payload.portfolio_max_drawdown)).toBe(true);
    expect(payload.portfolio_volatility).not.toBeNull();
    expect(Number.isFinite(payload.portfolio_volatility)).toBe(true);
    expect(payload.avg_pairwise_correlation).not.toBeNull();
    expect(Number.isFinite(payload.avg_pairwise_correlation)).toBe(true);
    expect(typeof payload.narrative_summary).toBe("string");
    expect(payload.narrative_summary.length).toBeGreaterThan(20);

    // Structured fields.
    expect(payload.attribution_breakdown).toHaveLength(3);
    expect(payload.attribution_breakdown[0].strategy_id).toBe(STRATEGY_UUIDS[0]);
    expect(payload.attribution_breakdown[0].strategy_name).toBe(
      STRATEGY_PROFILES[0].name,
    );
    expect(Number.isFinite(payload.attribution_breakdown[0].contribution)).toBe(
      true,
    );

    expect(payload.risk_decomposition).toHaveLength(3);
    expect(payload.correlation_matrix).not.toBeNull();
    expect(Object.keys(payload.correlation_matrix)).toHaveLength(3);
    expect(payload.correlation_matrix[STRATEGY_UUIDS[0]][STRATEGY_UUIDS[0]]).toBe(1);

    expect(payload.benchmark_comparison).not.toBeNull();
    expect(payload.benchmark_comparison.symbol).toBe("BTC");
    expect(payload.benchmark_comparison.stale).toBe(false);

    expect(payload.portfolio_equity_curve.length).toBeGreaterThan(300);
    expect(payload.portfolio_equity_curve[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(payload.portfolio_equity_curve[0].value)).toBe(true);

    expect(Object.keys(payload.rolling_correlation).length).toBe(1);
  });

  it("handles the 2-strategy STALLED persona without collapsing", () => {
    const holdings: PortfolioAnalyticsHolding[] = [
      {
        strategy_id: STRATEGY_PROFILES[6].id,
        strategy_name: STRATEGY_PROFILES[6].name,
        weight: 0.65,
        profile: STRATEGY_PROFILES[6],
      },
      {
        strategy_id: STRATEGY_PROFILES[3].id,
        strategy_name: STRATEGY_PROFILES[3].name,
        weight: 0.35,
        profile: STRATEGY_PROFILES[3],
      },
    ];
    const payload = generatePortfolioAnalyticsJSONB(
      STALLED_PORTFOLIO_ID,
      holdings,
      9003,
    );
    expect(payload.attribution_breakdown).toHaveLength(2);
    expect(payload.risk_decomposition).toHaveLength(2);
    expect(Object.keys(payload.rolling_correlation).length).toBe(1);
  });

  it("output round-trips through adaptPortfolioAnalytics without returning null", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );

    // The adapter requires id + computed_at on the Supabase row. The seed
    // payload above omits them because Postgres generates them via DEFAULT;
    // stitch in deterministic values so the adapter has what it needs.
    const rowLike = {
      id: "00000000-0000-4000-8000-000000009001",
      computed_at: "2025-12-31T00:00:00Z",
      ...payload,
    };

    const adapted = adaptPortfolioAnalytics(rowLike);
    expect(adapted).not.toBeNull();
    if (!adapted) return;

    expect(adapted.portfolio_id).toBe(ACTIVE_PORTFOLIO_ID);
    expect(adapted.computation_status).toBe("complete");
    expect(adapted.total_return_twr).toBe(payload.total_return_twr);
    expect(adapted.portfolio_sharpe).toBe(payload.portfolio_sharpe);
    expect(adapted.attribution_breakdown).toHaveLength(3);
    expect(adapted.risk_decomposition).toHaveLength(3);
    expect(adapted.correlation_matrix).not.toBeNull();
    expect(adapted.benchmark_comparison).not.toBeNull();
    expect(adapted.portfolio_equity_curve).not.toBeNull();
    expect(adapted.rolling_correlation).not.toBeNull();
  });

  // ---- PR 11 review fixes ----

  it("rejects 1-strategy holdings (H1 review finding)", () => {
    const single: PortfolioAnalyticsHolding[] = [
      {
        strategy_id: STRATEGY_PROFILES[0].id,
        strategy_name: STRATEGY_PROFILES[0].name,
        weight: 1.0,
        profile: STRATEGY_PROFILES[0],
      },
    ];
    expect(() =>
      generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, single, 9001),
    ).toThrow(/at least 2 entries/);
  });

  it("rejects empty holdings", () => {
    expect(() =>
      generatePortfolioAnalyticsJSONB(ACTIVE_PORTFOLIO_ID, [], 9001),
    ).toThrow();
  });

  it("component_var is unit-correct (risk contribution, not variance-squared)", () => {
    // C1 review finding: the previous formula was `(w*vol)^2` which is
    // dimensionally wrong. Under the fixed diagonal+correlation approximation,
    // component_var should roughly sum to the portfolio vol (within ~5% for a
    // low-correlation 3-strategy book).
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );
    const sumComponentVar = payload.risk_decomposition.reduce(
      (s, r) => s + r.component_var,
      0,
    );
    const portVol = payload.portfolio_volatility;
    expect(portVol).toBeGreaterThan(0);
    // Accept a 15% approximation error — we're using a constant-correlation
    // approximation of the full covariance matrix.
    const rel = Math.abs(sumComponentVar - portVol) / portVol;
    expect(rel).toBeLessThan(0.15);
  });

  it("narrative never contains the '+-' double-sign artifact (H3 review finding)", () => {
    // Run the generator against many seeds to hit both positive- and
    // negative-topContributor branches.
    for (const seed of [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008]) {
      const payload = generatePortfolioAnalyticsJSONB(
        ACTIVE_PORTFOLIO_ID,
        buildActiveHoldings(),
        seed,
      );
      expect(payload.narrative_summary).not.toContain("+-");
      expect(payload.narrative_summary).not.toContain("+−");
    }
  });

  it("total_return_mwr equals total_return_twr under no-flows approximation (M2)", () => {
    const payload = generatePortfolioAnalyticsJSONB(
      ACTIVE_PORTFOLIO_ID,
      buildActiveHoldings(),
      9001,
    );
    // Both are rounded to 5 decimals so compare rounded.
    const mwr = payload.total_return_mwr;
    const twr = payload.total_return_twr;
    expect(Math.abs(mwr - twr)).toBeLessThan(1e-4);
  });

  it("adapter round-trips the 2-strategy STALLED persona (M1)", () => {
    const stalled: PortfolioAnalyticsHolding[] = [
      {
        strategy_id: STRATEGY_PROFILES[6].id,
        strategy_name: STRATEGY_PROFILES[6].name,
        weight: 0.65,
        profile: STRATEGY_PROFILES[6],
      },
      {
        strategy_id: STRATEGY_PROFILES[3].id,
        strategy_name: STRATEGY_PROFILES[3].name,
        weight: 0.35,
        profile: STRATEGY_PROFILES[3],
      },
    ];
    const payload = generatePortfolioAnalyticsJSONB(
      STALLED_PORTFOLIO_ID,
      stalled,
      9003,
    );
    const rowLike = {
      id: "00000000-0000-4000-8000-000000009003",
      computed_at: "2025-12-31T00:00:00Z",
      ...payload,
    };
    const adapted = adaptPortfolioAnalytics(rowLike);
    expect(adapted).not.toBeNull();
    if (!adapted) return;
    expect(adapted.attribution_breakdown).toHaveLength(2);
    expect(adapted.risk_decomposition).toHaveLength(2);
    expect(adapted.rolling_correlation).not.toBeNull();
    expect(Object.keys(adapted.rolling_correlation ?? {}).length).toBe(1);
  });
});

describe("formatSignedPct", () => {
  it("prefixes positive values with '+'", () => {
    expect(formatSignedPct(0.1234)).toBe("+12.34%");
  });

  it("renders negative values as '-' without an extra '+'", () => {
    expect(formatSignedPct(-0.0123)).toBe("-1.23%");
  });

  it("prefixes zero with '+'", () => {
    expect(formatSignedPct(0)).toBe("+0.00%");
  });

  it("respects the digits arg", () => {
    expect(formatSignedPct(0.1234, 1)).toBe("+12.3%");
  });
});

describe("approximateMwr", () => {
  it("returns TWR under no-flow approximation (M2 fix)", () => {
    expect(approximateMwr(0.18)).toBe(0.18);
    expect(approximateMwr(-0.04)).toBe(-0.04);
    expect(approximateMwr(0)).toBe(0);
  });
});
