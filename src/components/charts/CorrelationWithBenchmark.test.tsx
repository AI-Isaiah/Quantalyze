import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CorrelationWithBenchmark,
  resolveBenchmarkCorrelation,
} from "./CorrelationWithBenchmark";
import type { StrategyAnalytics } from "@/lib/types";
import { CORRELATION_90D_MIN_DAYS } from "@/lib/min-history";

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
 * Build a minimal StrategyAnalytics-shaped object that has exactly the
 * fields resolveBenchmarkCorrelation reads. The cast is acceptable because
 * the resolver takes a Pick<…>+Partial slice.
 */
function buildAnalytics(opts: {
  returns_series?: { date: string; value: number }[] | null;
  metrics_json?: Record<string, unknown> | null;
  computation_status?: StrategyAnalytics["computation_status"];
}): StrategyAnalytics {
  return {
    returns_series: opts.returns_series ?? null,
    metrics_json: opts.metrics_json ?? null,
    computation_status: opts.computation_status ?? "complete",
  } as unknown as StrategyAnalytics;
}

// ---------------------------------------------------------------------------
// resolveBenchmarkCorrelation — pure helper tests
// ---------------------------------------------------------------------------

describe("resolveBenchmarkCorrelation", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns kind:'ok' with the server-side btc_rolling_correlation_90d when present", () => {
    const serverSeries = [
      { date: "2024-04-01", value: 0.12 },
      { date: "2024-04-02", value: 0.18 },
      { date: "2024-04-03", value: 0.22 },
    ];
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-04-01", value: 1.0 }],
        metrics_json: {
          btc_rolling_correlation_90d: serverSeries,
          benchmark_returns: [{ date: "2024-04-01", value: 1.0 }],
        },
      }),
    );
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") {
      // Returns the exact server array when shape is valid.
      expect(resolved.series).toEqual(serverSeries);
    }
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns kind:'unavailable' when precomputed is absent and status is not 'computing'", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [
          { date: "2024-01-01", value: 1.0 },
          { date: "2024-01-02", value: 1.01 },
        ],
        metrics_json: { something_else: 1 },
        computation_status: "complete",
      }),
    );
    expect(resolved.kind).toBe("unavailable");
    if (resolved.kind === "unavailable") {
      expect(resolved.message).toMatch(/unavailable/i);
    }
  });

  it("returns kind:'unavailable' when metrics_json is null", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: null,
        computation_status: "complete",
      }),
    );
    expect(resolved.kind).toBe("unavailable");
  });

  it("returns kind:'computing' with friendly copy when precomputed is absent and status is 'computing'", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: { something_else: 1 },
        computation_status: "computing",
      }),
    );
    expect(resolved.kind).toBe("computing");
    if (resolved.kind === "computing") {
      expect(resolved.message).toBe("Computing analytics…");
    }
  });

  it("returns kind:'computing' when metrics_json is null and status is 'computing'", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: null,
        metrics_json: null,
        computation_status: "computing",
      }),
    );
    expect(resolved.kind).toBe("computing");
  });

  it("returns kind:'insufficient' with min-history copy when precomputed is empty array", () => {
    // Server explicitly returned [] meaning "history below 250-day floor".
    // Strategy returns_series has 50 cumulative points → 49 daily samples.
    const stratSeries = Array.from({ length: 50 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      value: 1 + i * 0.001,
    }));
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: stratSeries,
        metrics_json: { btc_rolling_correlation_90d: [] },
      }),
    );
    expect(resolved.kind).toBe("insufficient");
    if (resolved.kind === "insufficient") {
      expect(resolved.message).toContain("90-day BTC correlation");
      expect(resolved.message).toContain(String(CORRELATION_90D_MIN_DAYS));
      expect(resolved.message).toContain("49"); // length-1 daily samples
    }
  });

  it("falls back to a generic insufficient message when returns_series is null", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: null,
        metrics_json: { btc_rolling_correlation_90d: [] },
      }),
    );
    expect(resolved.kind).toBe("insufficient");
    if (resolved.kind === "insufficient") {
      expect(resolved.message).toContain("90-day BTC correlation");
      expect(resolved.message).toContain(String(CORRELATION_90D_MIN_DAYS));
    }
  });

  // -------------------------------------------------------------------------
  // P67: previously this test asserted a silent client-side fallback when
  // the server payload was malformed. The audit (G11.A P64 + P67) replaced
  // that fallthrough with explicit logging + an `unavailable` outcome —
  // recomputing on the client diverges from the server pipeline.
  //
  // OLD assertion: `expect(message).toBeNull()` + a 31-point client series.
  // NEW assertion: console.error called + kind === 'unavailable'.
  // -------------------------------------------------------------------------
  it("logs and returns kind:'unavailable' when server series has malformed entries (was: silent client fallback)", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: {
          // Malformed: wrong types for value and date.
          btc_rolling_correlation_90d: [
            { date: "2024-04-01", value: "not-a-number" },
            { date: 123, value: 0.1 },
          ],
        },
      }),
    );
    expect(resolved.kind).toBe("unavailable");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const message = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain("[CorrelationWithBenchmark]");
    expect(message).toContain("btc_rolling_correlation_90d malformed");
  });

  it("M-0395: treats an out-of-[-1,1]-range correlation value as malformed -> unavailable", () => {
    // A rolling correlation is mathematically bounded to [-1, 1]. A producer
    // regression emitting 1.5 (or -2.0) is finite, so pre-fix it passed the
    // typeof+isFinite guard and rendered as a confident 1.5 correlation point.
    // It must now route through the malformed -> unavailable branch.
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: {
          btc_rolling_correlation_90d: [
            { date: "2024-04-01", value: 0.3 },
            { date: "2024-04-02", value: 1.5 }, // out of range
            { date: "2024-04-03", value: -2.0 }, // out of range
          ],
        },
      }),
    );
    expect(resolved.kind).toBe("unavailable");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0] as string).toContain(
      "btc_rolling_correlation_90d malformed",
    );
  });

  it("accepts boundary correlation values of exactly -1 and 1 (inclusive)", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: {
          btc_rolling_correlation_90d: [
            { date: "2024-04-01", value: -1 },
            { date: "2024-04-02", value: 1 },
          ],
        },
      }),
    );
    expect(resolved.kind).toBe("ok");
  });

  it("logs and returns kind:'unavailable' when precomputed is a non-array primitive", () => {
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: [{ date: "2024-01-01", value: 1.0 }],
        metrics_json: {
          btc_rolling_correlation_90d: "broken",
        },
      }),
    );
    expect(resolved.kind).toBe("unavailable");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const message = consoleErrorSpy.mock.calls[0]?.[0] as string;
    // For non-arrays we log `typeof` rather than a JSON sample.
    expect(message).toContain("string");
  });

  // -------------------------------------------------------------------------
  // P64: previously this test asserted the resolver fell through to a
  // client-side recompute when the server returned []. The new contract
  // treats empty server output as the authoritative "history below
  // institutional-grade threshold" signal and surfaces the friendly
  // min-history message — no client fallback.
  //
  // OLD assertion: `expect(message).toBeNull()` + a 31-point client series.
  // NEW assertion: kind === 'insufficient' with a min-history message.
  // -------------------------------------------------------------------------
  it("returns kind:'insufficient' (NOT a client fallback) when server series is an empty array (was: silent client fallback)", () => {
    const N = 120;
    const stratSeries = Array.from({ length: N }, (_, i) => ({
      date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
      value: 1 + i * 0.001,
    }));
    const resolved = resolveBenchmarkCorrelation(
      buildAnalytics({
        returns_series: stratSeries,
        metrics_json: {
          btc_rolling_correlation_90d: [], // empty → insufficient
        },
      }),
    );
    expect(resolved.kind).toBe("insufficient");
    if (resolved.kind === "insufficient") {
      expect(resolved.message).toContain("90-day BTC correlation");
    }
  });
});

// ---------------------------------------------------------------------------
// Component render smoke tests
// ---------------------------------------------------------------------------

describe("<CorrelationWithBenchmark />", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders the unavailable message when benchmark is missing and status is complete", () => {
    render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: [{ date: "2024-01-01", value: 1.0 }],
          metrics_json: null,
          computation_status: "complete",
        })}
      />,
    );
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });

  it("renders 'Computing analytics…' when status is 'computing' and precomputed is absent", () => {
    render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: [{ date: "2024-01-01", value: 1.0 }],
          metrics_json: null,
          computation_status: "computing",
        })}
      />,
    );
    expect(screen.getByText("Computing analytics…")).toBeInTheDocument();
  });

  it("renders the institutional-grade insufficient-history message when server returned []", () => {
    render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: Array.from({ length: 11 }, (_, i) => ({
            date: `2024-01-${String(i + 1).padStart(2, "0")}`,
            value: 1 + i * 0.001,
          })),
          metrics_json: { btc_rolling_correlation_90d: [] },
        })}
      />,
    );
    // 11 cumulative points → 10 daily samples; 250 = CORRELATION_90D_MIN_DAYS.
    expect(
      screen.getByText(
        /Insufficient history for institutional-grade 90-day BTC correlation \(have 10 days, need 250\)\./,
      ),
    ).toBeInTheDocument();
  });

  it("logs an error and renders the unavailable message when precomputed is malformed", () => {
    render(
      <CorrelationWithBenchmark
        analytics={buildAnalytics({
          returns_series: [{ date: "2024-01-01", value: 1.0 }],
          metrics_json: {
            btc_rolling_correlation_90d: [
              { date: "2024-04-01", value: "not-a-number" },
            ],
          },
          computation_status: "complete",
        })}
      />,
    );
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const msg = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("[CorrelationWithBenchmark]");
    expect(msg).toContain("malformed");
  });

  it("renders the chart (NOT an empty-state) when server-side series is present and well-formed", () => {
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
    // measurement — the load-bearing assertion is that we're NOT in any
    // empty-state branch.
    expect(container.firstChild).toBeTruthy();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
    expect(screen.queryByText(/Insufficient history/i)).toBeNull();
    expect(screen.queryByText(/Computing analytics/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M-0399 — DESIGN.md chart-axis token conformance. The 2026-04-29 design
// consolidation moved chart axis ticks to the shared CHART_TICK_STYLE (12px);
// this was the lone v2-rendered chart still hardcoding `tick={{ fontSize: 11,
// … }}`. The visual type-scale test (tests/visual/strategy-v2-type-scale.test.ts)
// only greps Tailwind className strings, so it does NOT catch inline Recharts
// SVG tick props — hence a source-grep guard here (mirrors RollingSortinoChart
// Test 8). Recharts does not reliably paint ticks in jsdom, so a rendered
// fontSize assertion would be non-discriminating; the source guard is exact.
// ---------------------------------------------------------------------------
describe("M-0399: axis ticks use the shared CHART_TICK_STYLE token (DESIGN.md)", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/components/charts/CorrelationWithBenchmark.tsx"),
    "utf-8",
  );

  it("has zero inline tick={{ … fontSize literals (reverting the fix fails this)", () => {
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);
  });

  it("spreads CHART_TICK_STYLE on its axes", () => {
    expect(src).toMatch(/tick=\{CHART_TICK_STYLE\}/);
  });
});
