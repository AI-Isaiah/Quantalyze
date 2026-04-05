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
