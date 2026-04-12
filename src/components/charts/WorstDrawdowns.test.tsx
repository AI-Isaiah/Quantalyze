import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WorstDrawdowns } from "./WorstDrawdowns";
import type { StrategyAnalytics, TimeSeriesPoint } from "@/lib/types";

function makeAnalytics(
  overrides: Partial<StrategyAnalytics> = {},
): StrategyAnalytics {
  return {
    id: "a1",
    strategy_id: "s1",
    computed_at: new Date().toISOString(),
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: null,
    cagr: null,
    volatility: null,
    sharpe: null,
    sortino: null,
    calmar: null,
    max_drawdown: null,
    max_drawdown_duration_days: null,
    six_month_return: null,
    sparkline_returns: null,
    sparkline_drawdown: null,
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    ...overrides,
  };
}

/** Build a server-shape episode (snake_case, negative decimal depth). */
function serverEpisode(over: {
  peak: string;
  trough: string;
  recovery: string | null;
  depth: number;
  days: number;
  current?: boolean;
}) {
  return {
    peak_date: over.peak,
    trough_date: over.trough,
    recovery_date: over.recovery,
    depth_pct: over.depth,
    duration_days: over.days,
    is_current: over.current ?? false,
  };
}

describe("WorstDrawdowns", () => {
  it("renders a table with 5 rows when given 5 server-side episodes", () => {
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2022-05-12", trough: "2022-06-18", recovery: "2022-09-01", depth: -0.342, days: 112 }),
          serverEpisode({ peak: "2023-01-04", trough: "2023-02-10", recovery: "2023-04-30", depth: -0.21, days: 116 }),
          serverEpisode({ peak: "2021-11-10", trough: "2021-12-01", recovery: "2022-01-15", depth: -0.18, days: 66 }),
          serverEpisode({ peak: "2020-03-05", trough: "2020-03-23", recovery: "2020-06-01", depth: -0.15, days: 88 }),
          serverEpisode({ peak: "2024-02-01", trough: "2024-02-20", recovery: "2024-04-01", depth: -0.09, days: 59 }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const bodyRows = screen.getAllByRole("row").slice(1); // skip header
    expect(bodyRows).toHaveLength(5);
  });

  it("preserves server order (does not re-sort)", () => {
    // Intentionally out of order — verify the component renders them
    // as-given rather than imposing its own sort.
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2022-05-12", trough: "2022-06-18", recovery: "2022-09-01", depth: -0.342, days: 112 }),
          serverEpisode({ peak: "2023-01-04", trough: "2023-02-10", recovery: "2023-04-30", depth: -0.21, days: 116 }),
          serverEpisode({ peak: "2020-03-05", trough: "2020-03-23", recovery: "2020-06-01", depth: -0.15, days: 88 }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    // First row should be the deepest (-34.20%) because that's what was supplied first.
    expect(within(bodyRows[0]).getByText("-34.20%")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("-21.00%")).toBeInTheDocument();
    expect(within(bodyRows[2]).getByText("-15.00%")).toBeInTheDocument();
  });

  it("falls back to client-side segmentation when drawdown_episodes is absent", () => {
    // Drawdown series with two distinct dips big enough to survive the
    // 0.5% minDepth filter.
    const series: TimeSeriesPoint[] = [
      { date: "2023-01-01", value: 0 },
      { date: "2023-01-02", value: -0.1 }, // enter dip 1
      { date: "2023-01-03", value: -0.2 }, // trough 1
      { date: "2023-01-04", value: 0 },    // recovered
      { date: "2023-01-05", value: -0.05 }, // enter dip 2
      { date: "2023-01-06", value: -0.08 }, // trough 2
      { date: "2023-01-07", value: 0 },    // recovered
    ];
    const analytics = makeAnalytics({ drawdown_series: series });

    render(<WorstDrawdowns analytics={analytics} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    // Sorted desc by depth — deepest (-20%) first.
    expect(within(bodyRows[0]).getByText("-20.00%")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("-8.00%")).toBeInTheDocument();
  });

  it("renders the empty state when both sources are empty", () => {
    render(<WorstDrawdowns analytics={makeAnalytics()} />);
    expect(
      screen.getByText(/No meaningful drawdowns — largest < 0\.5%\./),
    ).toBeInTheDocument();
    // No table should be rendered in the empty state.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("also renders the empty state when drawdown_episodes is an empty array", () => {
    const analytics = makeAnalytics({
      metrics_json: { drawdown_episodes: [] },
      drawdown_series: [],
    });
    render(<WorstDrawdowns analytics={analytics} />);
    expect(
      screen.getByText(/No meaningful drawdowns — largest < 0\.5%\./),
    ).toBeInTheDocument();
  });

  it("renders ongoing drawdowns with 'ongoing' label and ellipsis on days", () => {
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({
            peak: "2023-08-01",
            trough: "2023-08-15",
            recovery: null,
            depth: -0.125,
            days: 62,
            current: true,
          }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const row = screen.getAllByRole("row")[1];
    const ongoingCell = within(row).getByText("ongoing");
    expect(ongoingCell).toBeInTheDocument();
    expect(ongoingCell.className).toContain("text-warning");
    // The days cell has a horizontal ellipsis (\u2026) suffix.
    expect(within(row).getByText("62\u2026")).toBeInTheDocument();
  });

  it("formats negative decimals as two-decimal percentages with sign preserved", () => {
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2024-01-01", trough: "2024-01-10", recovery: "2024-02-01", depth: -0.1234, days: 31 }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    expect(screen.getByText("-12.34%")).toBeInTheDocument();
  });

  it("normalizes snake_case server fields into the rendered row", () => {
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({
            peak: "2022-05-12",
            trough: "2022-06-18",
            recovery: "2022-09-01",
            depth: -0.342,
            days: 112,
          }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("2022-05-12")).toBeInTheDocument();
    expect(within(row).getByText("2022-06-18")).toBeInTheDocument();
    expect(within(row).getByText("2022-09-01")).toBeInTheDocument();
    expect(within(row).getByText("-34.20%")).toBeInTheDocument();
    expect(within(row).getByText("112")).toBeInTheDocument();
    // Aria label wires everything together for assistive tech.
    expect(row.getAttribute("aria-label")).toBe(
      "Drawdown 1: -34.20% from 2022-05-12 to 2022-06-18, recovered 2022-09-01 (112 days)",
    );
  });

  it("falls back to client-side segmentation when every server episode is malformed", () => {
    // All drawdown_episodes entries fail isServerEpisode (missing / wrong-type
    // fields). Regression test for the silent-drop bug: previously returned
    // an empty array and showed the empty state instead of falling through
    // to the client-side `drawdown_series` segmentation.
    const series: TimeSeriesPoint[] = [
      { date: "2023-01-01", value: 0 },
      { date: "2023-01-02", value: -0.1 },
      { date: "2023-01-03", value: -0.2 }, // trough
      { date: "2023-01-04", value: 0 },    // recovered
    ];
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          { not: "a", valid: "episode" },
          { peak_date: 123, trough_date: null }, // wrong types
        ],
      },
      drawdown_series: series,
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(1);
    expect(within(bodyRows[0]).getByText("-20.00%")).toBeInTheDocument();
  });

  it("renders only valid entries when server mixes valid and malformed episodes", () => {
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2022-05-12", trough: "2022-06-18", recovery: "2022-09-01", depth: -0.342, days: 112 }),
          { junk: "entry" }, // malformed — filtered
          serverEpisode({ peak: "2023-01-04", trough: "2023-02-10", recovery: "2023-04-30", depth: -0.21, days: 116 }),
          { peak_date: 999 }, // malformed — filtered
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(bodyRows[0]).getByText("-34.20%")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("-21.00%")).toBeInTheDocument();
  });
});
