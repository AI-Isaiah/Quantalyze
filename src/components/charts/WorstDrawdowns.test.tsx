import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WorstDrawdowns } from "./WorstDrawdowns";
import { WORST_DRAWDOWNS_MIN_DAYS } from "@/lib/min-history";
import type { StrategyAnalytics, TimeSeriesPoint } from "@/lib/types";

/**
 * Build a `drawdown_series` of `n` points so the P69 history gate
 * (>= WORST_DRAWDOWNS_MIN_DAYS) is satisfied without affecting
 * server-episode rendering. Values are flat zeros — irrelevant when
 * `drawdown_episodes` is the source of truth.
 */
function paddingSeries(n: number): TimeSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(2020, 0, 1 + i).toISOString().slice(0, 10),
    value: 0,
  }));
}

const SUFFICIENT_HISTORY = paddingSeries(WORST_DRAWDOWNS_MIN_DAYS);

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
    // Default to sufficient history so the P69 gate doesn't suppress
    // server-episode-driven tests. Tests that exercise the gate override
    // this explicitly.
    drawdown_series: SUFFICIENT_HISTORY,
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

afterEach(() => {
  vi.restoreAllMocks();
});

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
    // 0.5% minDepth filter. Padded to satisfy the P69 history gate.
    const dips: TimeSeriesPoint[] = [
      { date: "2023-01-01", value: 0 },
      { date: "2023-01-02", value: -0.1 }, // enter dip 1
      { date: "2023-01-03", value: -0.2 }, // trough 1
      { date: "2023-01-04", value: 0 },    // recovered
      { date: "2023-01-05", value: -0.05 }, // enter dip 2
      { date: "2023-01-06", value: -0.08 }, // trough 2
      { date: "2023-01-07", value: 0 },    // recovered
    ];
    const series = [
      ...dips,
      ...paddingSeries(WORST_DRAWDOWNS_MIN_DAYS - dips.length),
    ];
    const analytics = makeAnalytics({ drawdown_series: series });

    render(<WorstDrawdowns analytics={analytics} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    // Sorted desc by depth — deepest (-20%) first.
    expect(within(bodyRows[0]).getByText("-20.00%")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("-8.00%")).toBeInTheDocument();
  });

  it("renders the empty state when both sources are empty but history is sufficient", () => {
    // Sufficient history (default) but no drawdown_episodes and a flat
    // series — should render the "no meaningful drawdowns" empty state,
    // not the insufficient-history gate.
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
      // Use sufficient padded history to bypass the P69 gate so we
      // assert the original empty-state branch.
      drawdown_series: SUFFICIENT_HISTORY,
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
    // The days cell has a horizontal ellipsis (…) suffix.
    expect(within(row).getByText("62…")).toBeInTheDocument();
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

  it("falls back to client-side segmentation AND logs when every server episode is malformed", () => {
    // P65 regression: previously this fallthrough was silent, masking a
    // server-side schema-drift bug. Now the component must log a stable
    // [WorstDrawdowns] error before falling through, AND still render
    // the client-side segmentation result.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dips: TimeSeriesPoint[] = [
      { date: "2023-01-01", value: 0 },
      { date: "2023-01-02", value: -0.1 },
      { date: "2023-01-03", value: -0.2 }, // trough
      { date: "2023-01-04", value: 0 },    // recovered
    ];
    const series = [
      ...dips,
      ...paddingSeries(WORST_DRAWDOWNS_MIN_DAYS - dips.length),
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

    // Stable prefix + JSON sample of the first malformed entry.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain(
      "[WorstDrawdowns] server drawdown_episodes malformed",
    );
    expect(errorSpy.mock.calls[0][1]).toBe(
      JSON.stringify({ not: "a", valid: "episode" }),
    );
  });

  it("does not log when all server episodes validate cleanly", () => {
    // Positive control for P65: the malformed-only log must not fire on
    // the happy path. Distinguishing this from below-floor filtering
    // (which is intentional) keeps the signal valuable.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2022-05-12", trough: "2022-06-18", recovery: "2022-09-01", depth: -0.342, days: 112 }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not log when all server episodes are below the depth floor", () => {
    // P65 distinction: well-formed entries that all fall below the 0.5%
    // depth floor are intentional filtering, not malformation. The
    // component should fall through to client-side segmentation silently.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2022-05-12", trough: "2022-05-13", recovery: "2022-05-14", depth: -0.001, days: 2 }),
          serverEpisode({ peak: "2023-01-01", trough: "2023-01-02", recovery: "2023-01-03", depth: -0.002, days: 2 }),
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("renders only valid entries when server mixes valid and malformed episodes", () => {
    // Mixed shape: at least one valid entry, so the malformed-only log
    // (P65) does NOT fire. Malformed entries are silently filtered out,
    // matching the established mixed-quality contract.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("renders em-dash for non-current episode with null recovery_date (P66)", () => {
    // Audit P66: previously the recovery cell rendered an empty string
    // when recovery_date is null but is_current is false, breaking
    // column alignment. The cell must now show '—' and the aria label
    // must read "recovered — (N days)" with single spaces.
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          {
            peak_date: "2024-01-01",
            trough_date: "2024-01-10",
            recovery_date: null,
            depth_pct: -0.12,
            duration_days: 30,
            is_current: false,
          },
        ],
      },
    });

    render(<WorstDrawdowns analytics={analytics} />);
    const row = screen.getAllByRole("row")[1];
    // Recovery cell renders the em-dash fallback.
    expect(within(row).getByText("—")).toBeInTheDocument();
    // Aria label has " — " (em-dash, surrounded by single spaces).
    expect(row.getAttribute("aria-label")).toBe(
      "Drawdown 1: -12.00% from 2024-01-01 to 2024-01-10, recovered — (30 days)",
    );
  });

  it("shows insufficient-history empty state below WORST_DRAWDOWNS_MIN_DAYS (P69)", () => {
    // 364 days — one short of the 365-day floor. Top-5 drawdowns must
    // not render even if server episodes are present, because the
    // numbers aren't statistically meaningful yet.
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2024-01-01", trough: "2024-01-10", recovery: "2024-02-01", depth: -0.1, days: 31 }),
        ],
      },
      drawdown_series: paddingSeries(WORST_DRAWDOWNS_MIN_DAYS - 1),
    });

    render(<WorstDrawdowns analytics={analytics} />);
    expect(
      screen.getByText(/Insufficient history for institutional-grade top-5 drawdowns/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the table at exactly WORST_DRAWDOWNS_MIN_DAYS of history (P69)", () => {
    // 365 days — the threshold. Table should render normally.
    const analytics = makeAnalytics({
      metrics_json: {
        drawdown_episodes: [
          serverEpisode({ peak: "2024-01-01", trough: "2024-01-10", recovery: "2024-02-01", depth: -0.1, days: 31 }),
        ],
      },
      drawdown_series: paddingSeries(WORST_DRAWDOWNS_MIN_DAYS),
    });

    render(<WorstDrawdowns analytics={analytics} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("-10.00%")).toBeInTheDocument();
    expect(
      screen.queryByText(/Insufficient history/),
    ).toBeNull();
  });
});
