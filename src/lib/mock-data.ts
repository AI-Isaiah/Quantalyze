import type { Strategy, StrategyAnalytics } from "./types";

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function generateSparkline(points: number, trend: number): number[] {
  const data: number[] = [];
  let value = 1;
  for (let i = 0; i < points; i++) {
    value *= 1 + (trend / points) + (Math.random() - 0.48) * 0.03;
    data.push(value);
  }
  return data;
}

function generateDrawdownSparkline(points: number): number[] {
  const data: number[] = [];
  let peak = 1;
  let value = 1;
  for (let i = 0; i < points; i++) {
    value *= 1 + (Math.random() - 0.48) * 0.025;
    if (value > peak) peak = value;
    data.push((value - peak) / peak);
  }
  return data;
}

const STRATEGY_NAMES = [
  "Alpha Momentum", "Quantum Edge", "Volatility Harvest", "Delta Flow",
  "Trend Rider Pro", "Smart Beta Crypto", "Arb Machine", "Risk Parity X",
  "Directional Alpha", "Market Maker V3", "Mean Revert Plus", "Basis Hunter",
  "Funding Farmer", "Breakout Signal", "Neutral Grid", "Momentum Prime",
];

const TYPE_SETS: [string[], string[]][] = [
  [["Directional"], ["Trend Following"]],
  [["Directional"], ["Momentum"]],
  [["Directional"], ["Breakout"]],
  [["Bidirectional"], ["Mean Reversion"]],
  [["Market Neutral"], ["Statistical Arbitrage"]],
  [["Market Neutral"], ["Market Making"]],
  [["Delta Neutral"], ["Basis Trading"]],
  [["Delta Neutral"], ["Funding Rate"]],
  [["Arbitrage"], ["Statistical Arbitrage"]],
];

export function generateMockStrategies(count: number): (Strategy & { analytics: StrategyAnalytics })[] {
  return Array.from({ length: count }, (_, i) => {
    const [types, subtypes] = TYPE_SETS[i % TYPE_SETS.length];
    const cumulReturn = randomBetween(-0.1, 1.5);
    const cagr = randomBetween(-0.05, 0.8);
    const sharpe = randomBetween(-0.5, 3.5);
    const maxDd = randomBetween(-0.6, -0.02);
    const vol = randomBetween(0.05, 0.6);

    const strategy: Strategy = {
      id: `mock-${i}`,
      user_id: `user-${i % 5}`,
      category_id: null,
      api_key_id: null,
      name: STRATEGY_NAMES[i % STRATEGY_NAMES.length],
      description: `${types[0]} strategy using ${subtypes[0].toLowerCase()} approach`,
      strategy_types: types,
      subtypes,
      markets: [Math.random() > 0.3 ? "Futures" : "Spot"],
      supported_exchanges: ["Binance", ...(Math.random() > 0.5 ? ["OKX"] : [])],
      leverage_range: `${Math.floor(randomBetween(1, 3))}x - ${Math.floor(randomBetween(3, 10))}x`,
      avg_daily_turnover: randomBetween(50000, 5000000),
      aum: randomBetween(100000, 50000000),
      max_capacity: randomBetween(1000000, 100000000),
      start_date: `202${Math.floor(randomBetween(1, 4))}-0${Math.floor(randomBetween(1, 9))}-01`,
      status: i < 2 ? "draft" : "published",
      is_example: i >= count - 3,
      benchmark: "BTC",
      created_at: new Date().toISOString(),
    };

    const analytics: StrategyAnalytics = {
      id: `analytics-${i}`,
      strategy_id: strategy.id,
      computed_at: new Date().toISOString(),
      computation_status: "complete",
      computation_error: null,
      benchmark: "BTC",
      cumulative_return: cumulReturn,
      cagr,
      volatility: vol,
      sharpe,
      sortino: sharpe * randomBetween(1.0, 1.5),
      calmar: cagr / Math.abs(maxDd),
      max_drawdown: maxDd,
      max_drawdown_duration_days: Math.floor(randomBetween(5, 120)),
      six_month_return: randomBetween(-0.2, 0.5),
      sparkline_returns: generateSparkline(90, cumulReturn),
      sparkline_drawdown: generateDrawdownSparkline(90),
      metrics_json: null,
      returns_series: null,
      drawdown_series: null,
      monthly_returns: null,
      daily_returns: null,
      rolling_metrics: null,
      return_quantiles: null,
      trade_metrics: null,
    };

    return { ...strategy, analytics };
  });
}

export const MOCK_STRATEGIES = generateMockStrategies(20);

export function generateDetailAnalytics(strategyId: string): StrategyAnalytics {
  const base = MOCK_STRATEGIES.find((s) => s.id === strategyId);
  const cagr = base?.analytics.cagr ?? 0.3;

  const startDate = new Date("2023-01-01");
  const days = 500;
  const returnsSeries: { date: string; value: number }[] = [];
  const drawdownSeries: { date: string; value: number }[] = [];
  let cumulative = 1;
  let peak = 1;

  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dailyReturn = (cagr / 365) + (Math.random() - 0.48) * 0.025;
    cumulative *= 1 + dailyReturn;
    if (cumulative > peak) peak = cumulative;
    const dd = (cumulative - peak) / peak;
    returnsSeries.push({ date: d.toISOString().split("T")[0], value: cumulative });
    drawdownSeries.push({ date: d.toISOString().split("T")[0], value: dd });
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthlyReturns: Record<string, Record<string, number>> = {};
  for (const year of ["2023", "2024", "2025"]) {
    monthlyReturns[year] = {};
    for (const m of months) {
      monthlyReturns[year][m] = randomBetween(-0.08, 0.12);
    }
  }

  const rollingMetrics: Record<string, { date: string; value: number }[]> = {
    "sharpe_30d": [],
    "sharpe_90d": [],
    "sharpe_365d": [],
  };
  for (let i = 0; i < 365; i++) {
    const d = new Date("2024-06-01");
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    rollingMetrics["sharpe_30d"].push({ date: dateStr, value: randomBetween(-0.5, 3) });
    rollingMetrics["sharpe_90d"].push({ date: dateStr, value: randomBetween(0, 2.5) });
    rollingMetrics["sharpe_365d"].push({ date: dateStr, value: randomBetween(0.5, 2) });
  }

  return {
    id: `detail-${strategyId}`,
    strategy_id: strategyId,
    computed_at: new Date().toISOString(),
    computation_status: "complete",
    computation_error: null,
    benchmark: "BTC",
    cumulative_return: cumulative - 1,
    cagr,
    volatility: randomBetween(0.1, 0.4),
    sharpe: randomBetween(0.5, 3),
    sortino: randomBetween(0.8, 4),
    calmar: randomBetween(0.5, 5),
    max_drawdown: Math.min(...drawdownSeries.map((d) => d.value)),
    max_drawdown_duration_days: Math.floor(randomBetween(10, 80)),
    six_month_return: randomBetween(-0.1, 0.4),
    sparkline_returns: base?.analytics.sparkline_returns ?? [],
    sparkline_drawdown: base?.analytics.sparkline_drawdown ?? [],
    metrics_json: {
      var_1d_95: randomBetween(-0.05, -0.01),
      var_1m_99: randomBetween(-0.15, -0.03),
      cvar: randomBetween(-0.08, -0.02),
      gini: randomBetween(0.3, 0.7),
      omega: randomBetween(1, 3),
      gain_pain: randomBetween(0.5, 2),
      tail_ratio: randomBetween(0.8, 1.5),
      outlier_win: randomBetween(0.01, 0.05),
      outlier_loss: randomBetween(0.01, 0.05),
      alpha: randomBetween(-0.1, 0.3),
      beta: randomBetween(0.1, 1.2),
      info_ratio: randomBetween(-0.5, 2),
      treynor: randomBetween(-0.1, 0.5),
      correlation: randomBetween(0.1, 0.9),
      mtd: randomBetween(-0.05, 0.08),
      three_month: randomBetween(-0.1, 0.2),
      ytd: randomBetween(-0.15, 0.4),
      best_day: randomBetween(0.02, 0.1),
      worst_day: randomBetween(-0.1, -0.02),
      best_month: randomBetween(0.05, 0.3),
      worst_month: randomBetween(-0.2, -0.03),
    },
    returns_series: returnsSeries,
    drawdown_series: drawdownSeries,
    monthly_returns: monthlyReturns,
    daily_returns: null,
    rolling_metrics: rollingMetrics,
    return_quantiles: {
      "Daily": [randomBetween(-0.05, -0.02), randomBetween(-0.01, 0), randomBetween(0, 0.005), randomBetween(0.005, 0.015), randomBetween(0.02, 0.06)],
      "Weekly": [randomBetween(-0.1, -0.04), randomBetween(-0.02, 0), randomBetween(0, 0.01), randomBetween(0.01, 0.03), randomBetween(0.04, 0.12)],
      "Monthly": [randomBetween(-0.15, -0.05), randomBetween(-0.03, 0), randomBetween(0, 0.02), randomBetween(0.02, 0.05), randomBetween(0.06, 0.2)],
    },
    trade_metrics: {
      total_trades: Math.floor(randomBetween(500, 10000)),
      win_rate: randomBetween(0.4, 0.65),
      maker_pct: randomBetween(0.3, 0.7),
      long_pct: randomBetween(0.4, 0.6),
    },
  };
}
