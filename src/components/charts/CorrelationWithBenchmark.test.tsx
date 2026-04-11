import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  CorrelationWithBenchmark,
  resolveBenchmarkCorrelation,
} from "./CorrelationWithBenchmark";
import type { StrategyAnalytics } from "@/lib/types";

// ---------------------------------------------------------------------------
// Recharts ResponsiveContainer requires a measured parent to render in
// jsdom. Mock it so render tests don't collapse to zero-size. Pattern
// borrowed from allocations/widgets/attribution/attribution.test.tsx.
// ---------------------------------------------------------------------------
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Build a minimal StrategyAnalytics-shaped object that has exactly the two
 * fields resolveBenchmarkCorrelation reads. The `as StrategyAnalytics` cast
 * is acceptable because the resolver takes a Pick<…> slice.
 */
function buildAnalytics(opts: {
  returns_series?: { date: string; value: number }[] | null;
  metrics_json?: Record<string, unknown> | null;
}): StrategyAnalytics {
  return {
    returns_series: opts.returns_series ?? null,
    metrics_json: opts.metrics_json ?? null,
    // The rest of StrategyAnalytics is unused by the resolver but must
    // be cast-compatible.
  } as unknown as StrategyAnalytics;
}

/**
 * Build a cumulative-returns series from daily simple returns. Seeds at
 * value 1.0 like `(1+r).cumprod()`. The returned array is ONE point longer
 * than `dailyReturns` because the seed is included.
 */
function cumulativeFromDaily(
  startDate: string,
  dailyReturns: number[],
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const base = new Date(`${startDate}T00:00:00Z`);
  let cum = 1;
  // Seed row (i=0) corresponds to startDate with cum = 1.0.
  out.push({ date: startDate, value: cum });
  for (let i = 0; i < dailyReturns.length; i++) {
    cum *= 1 + dailyReturns[i];
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i + 1);
    out.push({ date: d.toISOString().slice(0, 10), value: cum });
  }
  return out;
}

// ---------------------------------------------------------------------------
// resolveBenchmarkCorrelation — pure helper tests
// ---------------------------------------------------------------------------

describe("resolveBenchmarkCorrelation", () => {
  it("uses server-side btc_rolling_correlation_90d when present", () => {
    const serverSeries = [
      { date: "2024-04-01", value: 0.12 },
      { date: "2024-04-02", value: 0.18 },
      { date: "2024-04-03", value: 0.22 },
    ];
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-04-01", value: 1.0 }],
        metrics_json: {
          btc_rolling_correlation_90d: serverSeries,
          benchmark_returns: [{ date: "2024-04-01", value: 1.0 }],
        },
      }),
    );
    expect(message).toBeNull();
    // Returns the exact server array when shape is valid.
    expect(series).toEqual(serverSeries);
  });

  it("returns 'Benchmark data unavailable.' when there is no benchmark", () => {
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [
          { date: "2024-01-01", value: 1.0 },
          { date: "2024-01-02", value: 1.01 },
        ],
        metrics_json: { something_else: 1 },
      }),
    );
    expect(series).toEqual([]);
    expect(message).toBe("Benchmark data unavailable.");
  });

  it("returns 'Benchmark data unavailable.' when metrics_json is null", () => {
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: null,
      }),
    );
    expect(series).toEqual([]);
    expect(message).toBe("Benchmark data unavailable.");
  });

  it("returns '0 days so far' when returns_series is empty but benchmark present", () => {
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [],
        metrics_json: {
          benchmark_returns: [
            { date: "2024-01-01", value: 1.0 },
            { date: "2024-01-02", value: 1.02 },
          ],
        },
      }),
    );
    expect(series).toEqual([]);
    expect(message).toBe(
      "Insufficient data — 90 days needed, 0 days so far.",
    );
  });

  it("returns a '{N} days so far' message when aligned daily returns < 90", () => {
    // 30 matching dates of daily returns — strategy cumulative has 31 points
    // (seed + 30 steps), daily map has 30 entries after cumulative -> daily.
    const dailyStrat = Array.from({ length: 30 }, (_, i) =>
      Math.sin(i * 0.3) * 0.01,
    );
    const dailyBench = Array.from({ length: 30 }, (_, i) =>
      Math.cos(i * 0.3) * 0.01,
    );
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: cumulativeFromDaily("2024-01-01", dailyStrat),
        metrics_json: {
          benchmark_returns: cumulativeFromDaily("2024-01-01", dailyBench),
        },
      }),
    );
    expect(series).toEqual([]);
    expect(message).toBe(
      "Insufficient data — 90 days needed, 30 days so far.",
    );
  });

  it("falls back to client-side computation when server series is absent and aligned count >= 90", () => {
    // 120 daily-return pairs → 31 rolling-90 windows.
    const N = 120;
    const dailyStrat = Array.from({ length: N }, (_, i) => Math.sin(i * 0.2) * 0.01);
    const dailyBench = Array.from({ length: N }, (_, i) =>
      Math.sin(i * 0.2) * 0.01 + Math.cos(i * 0.1) * 0.005,
    );
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: cumulativeFromDaily("2024-01-01", dailyStrat),
        metrics_json: {
          benchmark_returns: cumulativeFromDaily("2024-01-01", dailyBench),
        },
      }),
    );
    expect(message).toBeNull();
    // N pairs - 90 window + 1 = 31 output points.
    expect(series.length).toBe(N - 90 + 1);
    for (const p of series) {
      expect(typeof p.date).toBe("string");
      expect(Number.isFinite(p.value)).toBe(true);
      // Correlation is always in [-1, 1].
      expect(p.value).toBeGreaterThanOrEqual(-1);
      expect(p.value).toBeLessThanOrEqual(1);
    }
  });

  it("converts cumulative -> daily before correlating (not the cumulative curves themselves)", () => {
    // Build two series where the CUMULATIVE curves are both monotonically
    // increasing and therefore trivially ~1 Pearson-correlated, but the
    // DAILY returns are uncorrelated (one alternates +/-, the other is
    // near-constant small positive).
    //
    // If the resolver incorrectly correlates cumulative curves, the rolling
    // correlation will be ~1. The correct behavior is a correlation near 0.
    const N = 100;
    const dailyStrat = Array.from({ length: N }, (_, i) =>
      // Alternating sign — zero mean, high variance
      (i % 2 === 0 ? 0.02 : -0.018),
    );
    const dailyBench = Array.from({ length: N }, () =>
      // Constant tiny positive drift
      0.0005,
    );
    // Note: dailyBench has zero variance → pearson() returns 0 by
    // construction. That's perfect for this test: cumulative curves are
    // both monotone (correlation ~1 if used wrong), but daily-return
    // correlation collapses to 0.
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: cumulativeFromDaily("2024-01-01", dailyStrat),
        metrics_json: {
          benchmark_returns: cumulativeFromDaily("2024-01-01", dailyBench),
        },
      }),
    );
    expect(message).toBeNull();
    expect(series.length).toBeGreaterThan(0);
    // If the resolver had correlated cumulative curves (bug), every value
    // would be ~1. Because benchmark daily variance is 0, pearson() returns
    // exactly 0, so every value must be 0 under correct behavior.
    for (const p of series) {
      expect(p.value).toBe(0);
    }
  });

  it("intersects by date when strategy and benchmark have different coverage", () => {
    // Strategy has 100 daily returns starting 2024-01-01.
    // Benchmark has the same 100 daily returns plus 30 more at the front
    // (so only 100 dates overlap after the intersection).
    const dailyStrat = Array.from({ length: 100 }, (_, i) => 0.001 + i * 0.0001);
    const dailyBench = Array.from({ length: 130 }, (_, i) => 0.001 + i * 0.0001);
    const analytics = buildAnalytics({
      returns_series: cumulativeFromDaily("2024-02-01", dailyStrat),
      metrics_json: {
        // Benchmark starts 30 days earlier
        benchmark_returns: cumulativeFromDaily("2024-01-02", dailyBench),
      },
    });
    const { series, message } = resolveBenchmarkCorrelation(analytics);
    expect(message).toBeNull();
    // 100 daily pairs intersect, yielding 100 - 90 + 1 = 11 windows.
    expect(series.length).toBe(11);
  });

  it("falls through to client-side when server series has malformed entries", () => {
    // Server field present but entries fail the shape validator — resolver
    // should fall through rather than return a bogus series.
    const N = 120;
    const dailyStrat = Array.from({ length: N }, (_, i) => Math.sin(i * 0.2) * 0.01);
    const dailyBench = Array.from({ length: N }, (_, i) =>
      Math.sin(i * 0.2) * 0.01 + Math.cos(i * 0.1) * 0.005,
    );
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: cumulativeFromDaily("2024-01-01", dailyStrat),
        metrics_json: {
          // Malformed: wrong types for value.
          btc_rolling_correlation_90d: [
            { date: "2024-04-01", value: "not-a-number" },
            { date: 123, value: 0.1 },
          ],
          benchmark_returns: cumulativeFromDaily("2024-01-01", dailyBench),
        },
      }),
    );
    expect(message).toBeNull();
    expect(series.length).toBe(N - 90 + 1);
  });

  it("falls through to client-side when server series is an empty array", () => {
    const N = 120;
    const dailyStrat = Array.from({ length: N }, (_, i) => Math.sin(i * 0.2) * 0.01);
    const dailyBench = Array.from({ length: N }, (_, i) =>
      Math.sin(i * 0.2) * 0.01 + Math.cos(i * 0.1) * 0.005,
    );
    const { series, message } = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: cumulativeFromDaily("2024-01-01", dailyStrat),
        metrics_json: {
          btc_rolling_correlation_90d: [], // empty → fall through
          benchmark_returns: cumulativeFromDaily("2024-01-01", dailyBench),
        },
      }),
    );
    expect(message).toBeNull();
    expect(series.length).toBe(N - 90 + 1);
  });
});

// ---------------------------------------------------------------------------
// Component render smoke tests
// ---------------------------------------------------------------------------

describe("<CorrelationWithBenchmark />", () => {
  it("renders the empty-state message when benchmark is missing", () => {
    render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: [{ date: "2024-01-01", value: 1.0 }],
          metrics_json: null,
        })}
      />,
    );
    expect(screen.getByText("Benchmark data unavailable.")).toBeInTheDocument();
  });

  it("renders the insufficient-data message when aligned count < 90", () => {
    const daily = Array.from({ length: 10 }, () => 0.01);
    render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: cumulativeFromDaily("2024-01-01", daily),
          metrics_json: {
            benchmark_returns: cumulativeFromDaily("2024-01-01", daily),
          },
        })}
      />,
    );
    expect(
      screen.getByText("Insufficient data — 90 days needed, 10 days so far."),
    ).toBeInTheDocument();
  });

  it("renders the chart (not an empty-state) when server-side series is present", () => {
    const serverSeries = Array.from({ length: 10 }, (_, i) => ({
      date: `2024-04-${String(i + 1).padStart(2, "0")}`,
      value: 0.1 + i * 0.02,
    }));
    const { container } = render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: null,
          metrics_json: { btc_rolling_correlation_90d: serverSeries },
        })}
      />,
    );
    // Something rendered (the mocked ResponsiveContainer + Recharts tree).
    // Recharts may or may not paint an SVG in jsdom depending on
    // measurement — the load-bearing assertion is that we're NOT in the
    // empty-state branch.
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText(/Benchmark data unavailable/)).toBeNull();
    expect(screen.queryByText(/Insufficient data/)).toBeNull();
  });
});
