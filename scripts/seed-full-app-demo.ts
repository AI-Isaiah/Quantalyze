/**
 * scripts/seed-full-app-demo.ts
 *
 * Full-app demo seeder. Replaces the earlier /demo-page-only seed (3 editorial
 * personas, 8 strategies) with a realistic allocator experience for the full
 * dashboard.
 *
 * What it builds
 * --------------
 *   1 allocator (Atlas Family Office)
 *     └─ logs in via demo-allocator@quantalyze.test / DemoAlpha2026!
 *   8 managers (institutional + exploratory mix)
 *     └─ each produces 1-3 strategies
 *   15 strategies spanning real crypto-quant archetypes
 *     └─ 2-4 years of daily returns each, with 2022 LUNA + 2022 FTX + 2024 Q2
 *        regime hits baked in so the correlation story is real
 *     └─ complete strategy_analytics rows (returns_series, monthly, drawdown,
 *        rolling metrics, quantiles, scalars)
 *   3 portfolios owned by the allocator
 *     ├─ "Active Allocation"           — REAL book, 5 holdings, exchange-sync
 *     │    lifecycle with add/trim/re-add/top-up events
 *     ├─ "What-if: Aggressive Tilt"    — SCENARIO, manual deposits
 *     └─ "What-if: Risk-Off"           — SCENARIO, manual deposits
 *
 * Usage
 * -----
 *   SEED_CONFIRM_STAGING=true \
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/seed-full-app-demo.ts
 *
 * The script is deterministic (mulberry32 PRNG), idempotent (wipes its own
 * UUIDs before re-inserting), and wipes the legacy /demo-page seed (persona
 * portfolios + is_example strategies) so the old and new datasets don't
 * collide in the match engine's ranking universe.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// =========================================================================
// Constants — fixed UUIDs (change at your peril)
// =========================================================================

const ALLOCATOR_ID = "a11ca111-1111-4111-8111-111111111111";
const ALLOCATOR_EMAIL = "demo-allocator@quantalyze.test";
const ALLOCATOR_PASSWORD = "DemoAlpha2026!";

const MANAGER_IDS = [
  "ba11a9e0-0000-4000-8000-000000000001", // Polaris Capital
  "ba11a9e0-0000-4000-8000-000000000002", // Helios Quant
  "ba11a9e0-0000-4000-8000-000000000003", // Redline Trading
  "ba11a9e0-0000-4000-8000-000000000004", // Meridian Systematic
  "ba11a9e0-0000-4000-8000-000000000005", // Kepler Alpha
  "ba11a9e0-0000-4000-8000-000000000006", // Astra Vol
  "ba11a9e0-0000-4000-8000-000000000007", // Drift Research
  "ba11a9e0-0000-4000-8000-000000000008", // Midas Liquid
] as const;

const STRATEGY_IDS = Array.from(
  { length: 15 },
  (_, i) => `51a111ed-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
) as readonly string[];

const PORTFOLIO_IDS = {
  active: "fa11e700-0001-4000-8000-000000000001", // REAL book
  aggressive: "fa11e700-0001-4000-8000-000000000002", // What-if
  riskoff: "fa11e700-0001-4000-8000-000000000003", // What-if
} as const;

const API_KEY_IDS = [
  "a9110000-0000-4000-8000-000000000001", // Binance read-only
  "a9110000-0000-4000-8000-000000000002", // OKX read-only
] as const;

// Time window: 4 years of daily returns, ending today (2026-04-08 for this
// demo). Different strategies start at different dates within this window so
// track records vary from 2-4 years.
const SEED_END = new Date("2026-04-08T00:00:00Z");
const SEED_START_EARLIEST = new Date("2022-01-03T00:00:00Z"); // Monday

// =========================================================================
// Legacy /demo seed UUIDs to wipe (from scripts/seed-demo-data.ts)
// =========================================================================

const LEGACY_ALLOCATOR_IDS = [
  "aaaaaaaa-0001-4000-8000-000000000001",
  "aaaaaaaa-0001-4000-8000-000000000002",
  "aaaaaaaa-0001-4000-8000-000000000003",
];
const LEGACY_PORTFOLIO_IDS = [
  "dddddddd-0001-4000-8000-000000000001",
  "dddddddd-0001-4000-8000-000000000002",
  "dddddddd-0001-4000-8000-000000000003",
];

// =========================================================================
// Deterministic PRNG (mulberry32) + Gaussian sampler
// =========================================================================

function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number, mean: number, std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return z * std + mean;
}

// =========================================================================
// Strategy archetypes
// =========================================================================

interface Archetype {
  idx: number;
  id: string;
  name: string;
  codename: string | null;
  managerIdx: number;
  tier: "institutional" | "exploratory";
  startDate: string; // ISO date
  description: string;
  strategy_types: string[];
  subtypes: string[];
  markets: string[];
  exchanges: string[];
  leverage: string;
  aum: number;
  capacity: number;
  avgTurnover: number;
  // Return generation parameters (annualized)
  cagrTarget: number; // intended long-run CAGR
  volAnnual: number; // annualized daily-return std
  // Regime hits: { isoDate, shock } where shock is a one-day return added
  // to the gaussian draw (e.g. -0.15 = -15% on that day)
  regimeHits: Array<{ date: string; shock: number }>;
}

// 8 managers. Each gets 1-3 strategies. Index into MANAGER_IDS.
//
// CAGR + vol bands are calibrated against real crypto-quant track records
// from the 2022-2025 cycle. 2022 LUNA (May 12), 2022 FTX (Nov 10), and the
// 2024 Q2 correction (Apr 15) get explicit regime hits on directional and
// short-vol strategies; arbitrage / basis / carry barely flinch.
const ARCHETYPES: Archetype[] = [
  {
    idx: 0,
    id: STRATEGY_IDS[0],
    name: "Polaris Cross-Exchange Arb",
    codename: null,
    managerIdx: 0,
    tier: "institutional",
    startDate: "2022-03-01",
    description:
      "Latency-arbitrage between Binance and Bybit on the top-20 liquid USDT pairs. Co-located on AWS Tokyo. Capacity-constrained at ~$25M.",
    strategy_types: ["arbitrage"],
    subtypes: ["cross_exchange", "latency_arb"],
    markets: ["BTC", "ETH", "SOL", "crypto_spot"],
    exchanges: ["binance", "bybit"],
    leverage: "1x",
    aum: 18_000_000,
    capacity: 25_000_000,
    avgTurnover: 45_000_000,
    cagrTarget: 0.115,
    volAnnual: 0.05,
    regimeHits: [],
  },
  {
    idx: 1,
    id: STRATEGY_IDS[1],
    name: "Polaris Basis Capture",
    codename: null,
    managerIdx: 0,
    tier: "institutional",
    startDate: "2022-01-15",
    description:
      "Cash-and-carry basis trade across BTC/ETH quarterlies vs spot on Deribit + OKX. Rolls the front-month every expiry.",
    strategy_types: ["arbitrage"],
    subtypes: ["basis_trade", "calendar_spread"],
    markets: ["BTC", "ETH"],
    exchanges: ["deribit", "okx"],
    leverage: "2x",
    aum: 32_000_000,
    capacity: 60_000_000,
    avgTurnover: 8_000_000,
    cagrTarget: 0.092,
    volAnnual: 0.04,
    regimeHits: [{ date: "2022-11-10", shock: -0.015 }],
  },
  {
    idx: 2,
    id: STRATEGY_IDS[2],
    name: "Helios Funding Carry",
    codename: null,
    managerIdx: 1,
    tier: "institutional",
    startDate: "2022-04-01",
    description:
      "Systematic funding-rate harvesting on BTC/ETH perpetuals. Short perp + long spot when funding is positive, delta-hedged 1:1.",
    strategy_types: ["arbitrage", "market_neutral"],
    subtypes: ["funding_rate_carry"],
    markets: ["BTC", "ETH"],
    exchanges: ["binance", "bybit", "okx"],
    leverage: "2.5x",
    aum: 14_500_000,
    capacity: 40_000_000,
    avgTurnover: 6_500_000,
    cagrTarget: 0.135,
    volAnnual: 0.06,
    regimeHits: [
      { date: "2022-05-12", shock: -0.018 },
      { date: "2022-11-10", shock: -0.025 },
    ],
  },
  {
    idx: 3,
    id: STRATEGY_IDS[3],
    name: "Redline BTC Trend",
    codename: null,
    managerIdx: 2,
    tier: "institutional",
    startDate: "2022-01-10",
    description:
      "CTA-style trend-following on BTC using 20/50/200-day moving average crossovers. Fully systematic, no discretionary overrides.",
    strategy_types: ["directional"],
    subtypes: ["trend_following", "cta"],
    markets: ["BTC"],
    exchanges: ["binance"],
    leverage: "1.5x",
    aum: 22_000_000,
    capacity: 100_000_000,
    avgTurnover: 2_800_000,
    cagrTarget: 0.32,
    volAnnual: 0.38,
    regimeHits: [
      { date: "2022-05-12", shock: -0.085 },
      { date: "2022-11-10", shock: -0.12 },
      { date: "2024-04-15", shock: -0.065 },
      { date: "2023-10-20", shock: 0.045 },
      { date: "2024-02-28", shock: 0.055 },
    ],
  },
  {
    idx: 4,
    id: STRATEGY_IDS[4],
    name: "Redline Altcoin Momentum",
    codename: null,
    managerIdx: 2,
    tier: "institutional",
    startDate: "2022-06-01",
    description:
      "Cross-sectional momentum on the top-30 altcoins by market cap, rebalanced weekly. Long top decile, short bottom decile.",
    strategy_types: ["directional", "market_neutral"],
    subtypes: ["momentum", "cross_sectional"],
    markets: ["crypto_spot"],
    exchanges: ["binance"],
    leverage: "1x",
    aum: 6_500_000,
    capacity: 20_000_000,
    avgTurnover: 1_200_000,
    cagrTarget: 0.42,
    volAnnual: 0.48,
    regimeHits: [
      { date: "2022-11-10", shock: -0.18 },
      { date: "2024-04-15", shock: -0.11 },
      { date: "2023-11-05", shock: 0.085 },
    ],
  },
  {
    idx: 5,
    id: STRATEGY_IDS[5],
    name: "Meridian L/S Pairs",
    codename: null,
    managerIdx: 3,
    tier: "institutional",
    startDate: "2022-08-01",
    description:
      "Market-neutral long/short pair trading on cointegrated altcoin pairs. Half-life 3-7 days, 20-40 active pairs at any time.",
    strategy_types: ["market_neutral"],
    subtypes: ["pairs_trading", "cointegration"],
    markets: ["crypto_spot"],
    exchanges: ["binance", "okx"],
    leverage: "1.5x",
    aum: 11_000_000,
    capacity: 35_000_000,
    avgTurnover: 4_000_000,
    cagrTarget: 0.17,
    volAnnual: 0.13,
    regimeHits: [{ date: "2022-11-10", shock: -0.035 }],
  },
  {
    idx: 6,
    id: STRATEGY_IDS[6],
    name: "Meridian Stat Arb",
    codename: null,
    managerIdx: 3,
    tier: "institutional",
    startDate: "2023-01-01",
    description:
      "PCA-based statistical arbitrage on the top 50 crypto pairs. Ornstein-Uhlenbeck mean reversion signals with 1-3 day holding period.",
    strategy_types: ["market_neutral"],
    subtypes: ["stat_arb", "pca"],
    markets: ["crypto_spot"],
    exchanges: ["binance", "okx"],
    leverage: "2x",
    aum: 9_500_000,
    capacity: 30_000_000,
    avgTurnover: 12_000_000,
    cagrTarget: 0.145,
    volAnnual: 0.085,
    regimeHits: [],
  },
  {
    idx: 7,
    id: STRATEGY_IDS[7],
    name: "Astra Short Vol",
    codename: "AV-SV1",
    managerIdx: 5,
    tier: "institutional",
    startDate: "2022-03-15",
    description:
      "Short-volatility carry on BTC weekly options. Sells ATM straddles + delta-hedges daily on Deribit. NEGATIVE SKEW — hedged but not immune.",
    strategy_types: ["delta_neutral"],
    subtypes: ["volatility_harvesting", "short_vol"],
    markets: ["BTC"],
    exchanges: ["deribit"],
    leverage: "1.5x",
    aum: 5_800_000,
    capacity: 15_000_000,
    avgTurnover: 900_000,
    cagrTarget: 0.21,
    volAnnual: 0.18,
    regimeHits: [
      { date: "2022-05-12", shock: -0.11 },
      { date: "2022-11-10", shock: -0.085 },
      { date: "2024-04-15", shock: -0.07 },
    ],
  },
  {
    idx: 8,
    id: STRATEGY_IDS[8],
    name: "Astra Iron Condor Monthly",
    codename: "AV-IC2",
    managerIdx: 5,
    tier: "institutional",
    startDate: "2022-09-01",
    description:
      "Monthly iron condors on BTC options targeting 15-25 delta wings. Risk capped per trade at 2% of NAV. Negative skew in tail events.",
    strategy_types: ["delta_neutral"],
    subtypes: ["options_income", "iron_condor"],
    markets: ["BTC"],
    exchanges: ["deribit"],
    leverage: "1x",
    aum: 3_200_000,
    capacity: 12_000_000,
    avgTurnover: 650_000,
    cagrTarget: 0.16,
    volAnnual: 0.12,
    regimeHits: [
      { date: "2022-11-10", shock: -0.055 },
      { date: "2024-04-15", shock: -0.045 },
    ],
  },
  {
    idx: 9,
    id: STRATEGY_IDS[9],
    name: "Kepler Mean Reversion",
    codename: null,
    managerIdx: 4,
    tier: "institutional",
    startDate: "2023-03-01",
    description:
      "Short-horizon BTC mean reversion using Bollinger bands + volume profile. 1-3 day holding period, tight stops.",
    strategy_types: ["directional"],
    subtypes: ["mean_reversion"],
    markets: ["BTC"],
    exchanges: ["binance"],
    leverage: "1x",
    aum: 4_500_000,
    capacity: 15_000_000,
    avgTurnover: 3_500_000,
    cagrTarget: 0.125,
    volAnnual: 0.14,
    regimeHits: [{ date: "2024-04-15", shock: -0.025 }],
  },
  {
    idx: 10,
    id: STRATEGY_IDS[10],
    name: "Kepler DEX Market Maker",
    codename: null,
    managerIdx: 4,
    tier: "institutional",
    startDate: "2023-05-15",
    description:
      "Delta-neutral grid market-making on Uniswap V3 and Orca. Concentrates liquidity around the spot price, rebalances hourly.",
    strategy_types: ["delta_neutral", "market_making"],
    subtypes: ["dex_mm", "concentrated_liquidity"],
    markets: ["ETH", "SOL"],
    exchanges: ["uniswap_v3", "orca"],
    leverage: "1x",
    aum: 2_800_000,
    capacity: 8_000_000,
    avgTurnover: 5_500_000,
    cagrTarget: 0.18,
    volAnnual: 0.12,
    regimeHits: [{ date: "2024-04-15", shock: -0.035 }],
  },
  {
    idx: 11,
    id: STRATEGY_IDS[11],
    name: "Drift On-Chain Alpha",
    codename: "DR-WH3",
    managerIdx: 6,
    tier: "exploratory",
    startDate: "2023-06-01",
    description:
      "Whale-wallet tracking + smart-money flow signals. Goes long tokens with accelerating net-inflow from top-500 wallets.",
    strategy_types: ["directional"],
    subtypes: ["on_chain_alpha", "alternative_data"],
    markets: ["crypto_spot", "ETH", "SOL"],
    exchanges: ["binance", "coinbase"],
    leverage: "1x",
    aum: 1_800_000,
    capacity: 6_000_000,
    avgTurnover: 850_000,
    cagrTarget: 0.28,
    volAnnual: 0.32,
    regimeHits: [
      { date: "2024-04-15", shock: -0.095 },
      { date: "2023-10-20", shock: 0.07 },
    ],
  },
  {
    idx: 12,
    id: STRATEGY_IDS[12],
    name: "Drift Liquidation Fade",
    codename: "DR-LQ1",
    managerIdx: 6,
    tier: "exploratory",
    startDate: "2023-09-01",
    description:
      "Fades cascading liquidation events on BTC/ETH perps. Enters counter-trend after >$100M in 5-minute liquidations.",
    strategy_types: ["directional"],
    subtypes: ["event_driven", "liquidation_fade"],
    markets: ["BTC", "ETH"],
    exchanges: ["bybit", "binance"],
    leverage: "2x",
    aum: 1_200_000,
    capacity: 5_000_000,
    avgTurnover: 2_200_000,
    cagrTarget: 0.24,
    volAnnual: 0.26,
    regimeHits: [
      { date: "2024-04-15", shock: -0.065 },
      { date: "2022-11-10", shock: -0.085 },
    ],
  },
  {
    idx: 13,
    id: STRATEGY_IDS[13],
    name: "Midas Risk Parity",
    codename: null,
    managerIdx: 7,
    tier: "institutional",
    startDate: "2022-02-01",
    description:
      "Multi-asset risk parity basket (BTC + ETH + PAXG gold + T-bills). Rebalanced quarterly to target 10% annualized vol.",
    strategy_types: ["directional"],
    subtypes: ["risk_parity", "multi_asset"],
    markets: ["BTC", "ETH", "gold"],
    exchanges: ["binance", "kraken"],
    leverage: "1x",
    aum: 19_000_000,
    capacity: 80_000_000,
    avgTurnover: 500_000,
    cagrTarget: 0.08,
    volAnnual: 0.11,
    regimeHits: [
      { date: "2022-05-12", shock: -0.042 },
      { date: "2022-11-10", shock: -0.055 },
    ],
  },
  {
    idx: 14,
    id: STRATEGY_IDS[14],
    name: "Midas ML Factor",
    codename: "MD-ML4",
    managerIdx: 7,
    tier: "exploratory",
    startDate: "2023-11-01",
    description:
      "Gradient-boosted factor model on cross-asset technical + on-chain features. Weekly rebalance, target 10% vol.",
    strategy_types: ["directional", "market_neutral"],
    subtypes: ["machine_learning", "factor_model"],
    markets: ["crypto_spot"],
    exchanges: ["binance", "okx"],
    leverage: "1x",
    aum: 3_800_000,
    capacity: 12_000_000,
    avgTurnover: 1_800_000,
    cagrTarget: 0.19,
    volAnnual: 0.17,
    regimeHits: [{ date: "2024-04-15", shock: -0.05 }],
  },
];

// =========================================================================
// Date helpers
// =========================================================================

function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function businessDaysBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  let d = new Date(start.getTime());
  while (d.getTime() <= end.getTime()) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(dateToIso(d));
    d = addDays(d, 1);
  }
  return out;
}

// =========================================================================
// Return generation
// =========================================================================

interface AnalyticsPayload {
  cumulative_return: number;
  cagr: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  max_drawdown: number;
  max_drawdown_duration_days: number;
  six_month_return: number;
  sparkline_returns: number[]; // cumulative, lightweight
  sparkline_drawdown: number[]; // running drawdown, lightweight
  returns_series: Array<{ date: string; value: number }>; // daily simple returns
  drawdown_series: Array<{ date: string; value: number }>;
  monthly_returns: Array<{ month: string; value: number }>;
  daily_returns: Array<{ date: string; value: number }>;
  rolling_metrics: {
    sharpe_30d: Array<{ date: string; value: number }>;
    sharpe_90d: Array<{ date: string; value: number }>;
    sharpe_180d: Array<{ date: string; value: number }>;
  };
  return_quantiles: {
    p05: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
}

function generateAnalytics(arch: Archetype): AnalyticsPayload {
  const start = new Date(arch.startDate + "T00:00:00Z");
  const dates = businessDaysBetween(start, SEED_END);
  const n = dates.length;

  // Daily targets from annualized params (252 trading days / year).
  const dailyMean = Math.pow(1 + arch.cagrTarget, 1 / 252) - 1;
  const dailyStd = arch.volAnnual / Math.sqrt(252);

  // Deterministic PRNG seeded from the strategy index so each strategy has a
  // unique but reproducible return stream.
  const rng = mulberry32(9001 + arch.idx * 137);

  // Build regime hit lookup
  const hitsByDate = new Map<string, number>();
  for (const { date, shock } of arch.regimeHits) {
    hitsByDate.set(date, (hitsByDate.get(date) ?? 0) + shock);
  }

  const rawReturns: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = gaussian(rng, dailyMean, dailyStd);
    const hit = hitsByDate.get(dates[i]) ?? 0;
    rawReturns[i] = base + hit;
  }

  // Cumulative (geometric) series
  const cumulative: number[] = new Array(n);
  let c = 1;
  for (let i = 0; i < n; i++) {
    c *= 1 + rawReturns[i];
    cumulative[i] = c;
  }
  const cumulative_return = cumulative[n - 1] - 1;
  const years = n / 252;
  const cagr = Math.pow(1 + cumulative_return, 1 / years) - 1;

  const meanR = rawReturns.reduce((s, r) => s + r, 0) / n;
  const variance =
    rawReturns.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / (n - 1);
  const volDaily = Math.sqrt(variance);
  const volatility = volDaily * Math.sqrt(252);

  const sharpe = (meanR * 252) / volatility;

  // Sortino ratio: excess return over downside deviation.
  // CRITICAL: downside deviation is the RMS of negative returns divided by
  // TOTAL observations (n), NOT by the count of negative observations.
  // Dividing by downsides.length inflates the denominator during calm
  // periods (few negatives → small denominator → artificially small
  // downside vol → artificially LARGE Sortino).
  // See: Sortino, F. A., & Price, L. N. (1994).
  const downsideSumSq = rawReturns.reduce(
    (s, r) => s + (r < 0 ? r * r : 0),
    0,
  );
  const downsideVar = downsideSumSq / n; // <-- /n, not /downsides.length
  const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
  const sortino = downsideVol > 0 ? (meanR * 252) / downsideVol : sharpe;

  // Drawdown series
  const drawdown: number[] = new Array(n);
  let peak = cumulative[0];
  let max_drawdown = 0;
  let max_drawdown_duration_days = 0;
  let currentDuration = 0;
  for (let i = 0; i < n; i++) {
    if (cumulative[i] > peak) {
      peak = cumulative[i];
      currentDuration = 0;
    } else {
      currentDuration += 1;
    }
    const dd = cumulative[i] / peak - 1;
    drawdown[i] = dd;
    if (dd < max_drawdown) max_drawdown = dd;
    if (currentDuration > max_drawdown_duration_days) {
      max_drawdown_duration_days = currentDuration;
    }
  }
  const calmar = max_drawdown < 0 ? cagr / Math.abs(max_drawdown) : cagr;

  // Six-month return (last ~126 business days)
  const sixMonthStart = Math.max(0, n - 126);
  const six_month_return = cumulative[n - 1] / cumulative[sixMonthStart] - 1;

  // Monthly rollups
  const monthlyMap = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const month = dates[i].slice(0, 7);
    if (!monthlyMap.has(month)) monthlyMap.set(month, []);
    monthlyMap.get(month)!.push(rawReturns[i]);
  }
  const monthly_returns = Array.from(monthlyMap.entries()).map(([m, rs]) => {
    const compounded = rs.reduce((p, r) => p * (1 + r), 1) - 1;
    return { month: m + "-01", value: Number(compounded.toFixed(5)) };
  });

  // Rolling Sharpe helpers
  const rollingSharpe = (window: number) => {
    const out: Array<{ date: string; value: number }> = [];
    for (let i = window - 1; i < n; i++) {
      const slice = rawReturns.slice(i - window + 1, i + 1);
      const m = slice.reduce((s, r) => s + r, 0) / window;
      const v =
        slice.reduce((s, r) => s + (r - m) * (r - m), 0) / (window - 1);
      const sd = Math.sqrt(v) * Math.sqrt(252);
      const sh = sd > 0 ? (m * 252) / sd : 0;
      out.push({ date: dates[i], value: Number(sh.toFixed(3)) });
    }
    return out;
  };

  // Quantiles — clamp idx so q(1.0) doesn't read past the end.
  const sorted = [...rawReturns].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = Math.min(
      Math.max(Math.floor(p * sorted.length), 0),
      sorted.length - 1,
    );
    return Number(sorted[idx].toFixed(5));
  };

  // Sparkline downsamples (weekly)
  const sparkline_returns: number[] = [];
  const sparkline_drawdown: number[] = [];
  for (let i = 0; i < n; i += 5) {
    sparkline_returns.push(Number((cumulative[i] - 1).toFixed(4)));
    sparkline_drawdown.push(Number(drawdown[i].toFixed(4)));
  }

  // Downsample returns_series to weekly for payload size (charts read this)
  const returns_series: Array<{ date: string; value: number }> = [];
  const drawdown_series: Array<{ date: string; value: number }> = [];
  const daily_returns: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < n; i += 5) {
    returns_series.push({
      date: dates[i],
      value: Number((cumulative[i] - 1).toFixed(5)),
    });
    drawdown_series.push({
      date: dates[i],
      value: Number(drawdown[i].toFixed(5)),
    });
  }
  // daily_returns keeps the full resolution — the charts sometimes want this
  for (let i = 0; i < n; i++) {
    daily_returns.push({
      date: dates[i],
      value: Number(rawReturns[i].toFixed(6)),
    });
  }

  return {
    cumulative_return: Number(cumulative_return.toFixed(5)),
    cagr: Number(cagr.toFixed(5)),
    volatility: Number(volatility.toFixed(5)),
    sharpe: Number(sharpe.toFixed(3)),
    sortino: Number(sortino.toFixed(3)),
    calmar: Number(calmar.toFixed(3)),
    max_drawdown: Number(max_drawdown.toFixed(5)),
    max_drawdown_duration_days,
    six_month_return: Number(six_month_return.toFixed(5)),
    sparkline_returns,
    sparkline_drawdown,
    returns_series,
    drawdown_series,
    monthly_returns,
    daily_returns,
    rolling_metrics: {
      sharpe_30d: rollingSharpe(30),
      sharpe_90d: rollingSharpe(90),
      sharpe_180d: rollingSharpe(180),
    },
    return_quantiles: {
      p05: q(0.05),
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p95: q(0.95),
    },
  };
}

// =========================================================================
// Portfolio composition
// =========================================================================

// Strategy indices (into ARCHETYPES / STRATEGY_IDS)
const IDX = {
  POLARIS_ARB: 0,
  POLARIS_BASIS: 1,
  HELIOS_FUNDING: 2,
  REDLINE_TREND: 3,
  REDLINE_MOM: 4,
  MERIDIAN_PAIRS: 5,
  MERIDIAN_STATARB: 6,
  ASTRA_SHORTVOL: 7,
  ASTRA_CONDOR: 8,
  KEPLER_MR: 9,
  KEPLER_DEXMM: 10,
  DRIFT_ONCHAIN: 11,
  DRIFT_LIQ: 12,
  MIDAS_RP: 13,
  MIDAS_ML: 14,
} as const;

// REAL portfolio: 5 institutional, defensively-diversified holdings.
// These are the ones that get exchange-sync allocation events.
const ACTIVE_HOLDINGS: HoldingSpec[] = [
  { idx: IDX.POLARIS_BASIS, weight: 0.25, initialUsd: 800_000 }, // low-vol carry
  { idx: IDX.HELIOS_FUNDING, weight: 0.22, initialUsd: 700_000 }, // market-neutral carry
  { idx: IDX.MERIDIAN_PAIRS, weight: 0.2, initialUsd: 650_000 }, // market-neutral alpha
  { idx: IDX.REDLINE_TREND, weight: 0.18, initialUsd: 600_000 }, // convex directional
  { idx: IDX.ASTRA_SHORTVOL, weight: 0.15, initialUsd: 500_000 }, // short vol sleeve
];

// What-if: Aggressive tilt — adds momentum + liquidation fade, drops basis
const AGGRESSIVE_HOLDINGS: HoldingSpec[] = [
  { idx: IDX.HELIOS_FUNDING, weight: 0.15, initialUsd: 500_000 },
  { idx: IDX.REDLINE_TREND, weight: 0.22, initialUsd: 700_000 },
  { idx: IDX.REDLINE_MOM, weight: 0.18, initialUsd: 600_000 },
  { idx: IDX.DRIFT_ONCHAIN, weight: 0.2, initialUsd: 650_000 },
  { idx: IDX.DRIFT_LIQ, weight: 0.13, initialUsd: 450_000 },
  { idx: IDX.ASTRA_SHORTVOL, weight: 0.12, initialUsd: 400_000 },
];

// What-if: Risk-off — only the 3 lowest-vol holdings, larger total
const RISKOFF_HOLDINGS: HoldingSpec[] = [
  { idx: IDX.POLARIS_ARB, weight: 0.35, initialUsd: 1_100_000 },
  { idx: IDX.POLARIS_BASIS, weight: 0.35, initialUsd: 1_100_000 },
  { idx: IDX.MERIDIAN_STATARB, weight: 0.3, initialUsd: 950_000 },
];

// =========================================================================
// Allocation event generation
// =========================================================================

interface AllocEvent {
  portfolio_id: string;
  strategy_id: string;
  event_type: "deposit" | "withdrawal";
  amount: number;
  event_date: string;
  notes: string;
  source: string;
}

// HoldingSpec is defined below this file section. Forward declaration is
// implicit via hoisting — the function is only called from main().

/**
 * Generate a realistic "exchange-sync" lifecycle for the REAL portfolio.
 * Each holding gets 4-7 events:
 *   - Initial deposit at holding.initialUsd
 *   - A top-up after a strong quarter
 *   - A trim after a drawdown
 *   - A re-add after recovery
 *   - Possibly a final top-up
 */
function buildActiveLifecycle(): AllocEvent[] {
  const out: AllocEvent[] = [];
  const rng = mulberry32(42_000);

  for (const h of ACTIVE_HOLDINGS) {
    const arch = ARCHETYPES[h.idx];
    const initialDate = "2024-06-03"; // uniform initial date for demo
    // Initial deposit
    out.push({
      portfolio_id: PORTFOLIO_IDS.active,
      strategy_id: arch.id,
      event_type: "deposit",
      amount: h.initialUsd,
      event_date: initialDate,
      notes: `Initial allocation detected on ${arch.exchanges[0].toUpperCase()} sub-account. Auto-synced from exchange API.`,
      source: "auto",
    });

    // Top-up after good quarter (~3 months later)
    const topUpDate = "2024-09-15";
    const topUpAmount = Math.round(h.initialUsd * 0.25);
    out.push({
      portfolio_id: PORTFOLIO_IDS.active,
      strategy_id: arch.id,
      event_type: "deposit",
      amount: topUpAmount,
      event_date: topUpDate,
      notes: `Additional capital deposited — ${arch.exchanges[0]} detected +${(rng() * 15 + 8).toFixed(1)}% equity growth this quarter.`,
      source: "auto",
    });

    // Trim after drawdown (directional strategies in Q4 2024)
    const isDirectional = arch.strategy_types.includes("directional");
    if (isDirectional || h.idx === IDX.ASTRA_SHORTVOL) {
      const trimDate = "2024-12-08";
      const trimAmount = Math.round(h.initialUsd * 0.35);
      out.push({
        portfolio_id: PORTFOLIO_IDS.active,
        strategy_id: arch.id,
        event_type: "withdrawal",
        amount: trimAmount,
        event_date: trimDate,
        notes:
          "Partial redemption — exchange balance showed drawdown, reduced exposure.",
        source: "auto",
      });

      // Re-add after recovery (2025 Q1)
      const reAddDate = "2025-02-20";
      const reAddAmount = Math.round(h.initialUsd * 0.3);
      out.push({
        portfolio_id: PORTFOLIO_IDS.active,
        strategy_id: arch.id,
        event_type: "deposit",
        amount: reAddAmount,
        event_date: reAddDate,
        notes: `Thesis restored — re-added position after ${arch.exchanges[0]} account recovered prior peak.`,
        source: "auto",
      });
    }

    // Final top-up
    const finalTopUp = "2025-11-12";
    const finalAmount = Math.round(h.initialUsd * 0.15);
    out.push({
      portfolio_id: PORTFOLIO_IDS.active,
      strategy_id: arch.id,
      event_type: "deposit",
      amount: finalAmount,
      event_date: finalTopUp,
      notes: "Scheduled capital top-up, detected via exchange sync.",
      source: "auto",
    });
  }
  return out;
}

interface HoldingSpec {
  idx: number;
  weight: number;
  initialUsd: number;
}

function buildScenarioLifecycle(
  portfolioId: string,
  holdings: readonly HoldingSpec[],
  label: string,
): AllocEvent[] {
  return holdings.map((h) => {
    const arch = ARCHETYPES[h.idx];
    return {
      portfolio_id: portfolioId,
      strategy_id: arch.id,
      event_type: "deposit",
      amount: h.initialUsd,
      event_date: "2024-06-03",
      notes: `[Scenario: ${label}] Hypothetical deposit — this portfolio is a what-if simulation, not a real position.`,
      source: "manual",
    };
  });
}

// =========================================================================
// Portfolio analytics builder
// =========================================================================

interface PortfolioAnalyticsPayload {
  computation_status: string;
  total_aum: number;
  total_return_twr: number;
  total_return_mwr: number;
  portfolio_sharpe: number;
  portfolio_volatility: number;
  portfolio_max_drawdown: number;
  avg_pairwise_correlation: number;
  return_24h: number;
  return_mtd: number;
  return_ytd: number;
  narrative_summary: string;
  correlation_matrix: Record<string, Record<string, number>>;
  attribution_breakdown: Array<{
    strategy_id: string;
    strategy_name: string;
    contribution: number;
    allocation_effect: number;
  }>;
  risk_decomposition: Array<{
    strategy_id: string;
    strategy_name: string;
    marginal_risk_pct: number;
    standalone_vol: number;
    component_var: number;
    weight_pct: number;
  }>;
  benchmark_comparison: {
    symbol: string;
    benchmark_return: number;
    portfolio_return: number;
    alpha: number;
    beta: number;
    stale: boolean;
  };
  optimizer_suggestions: null;
  portfolio_equity_curve: Array<{ date: string; value: number }>;
  rolling_correlation: Record<string, Array<{ date: string; value: number }>>;
}

function buildPortfolioAnalytics(
  _portfolioId: string,
  holdings: readonly HoldingSpec[],
  narrativeLabel: string,
  strategyAnalytics: Map<string, AnalyticsPayload>,
): PortfolioAnalyticsPayload {
  const total_aum = holdings.reduce((s, h) => s + h.initialUsd, 0);

  // Portfolio metrics are computed from the portfolio's DAILY return series
  // (weighted sum of strategy dailies), NOT from the weighted average of
  // strategy scalars. This matters because:
  //   (a) Sharpe uses mean-of-returns / std-of-returns, not CAGR / vol.
  //       Mixing a geometric CAGR with a daily-derived vol is a
  //       dimensional error a quant audience will catch immediately.
  //   (b) Portfolio vol depends on the pairwise covariance structure,
  //       not just weighted variance.
  // We build the portfolio's daily-return vector once, derive everything
  // from it, and only use the per-strategy scalars for attribution breakdowns.
  const portfolioStart = new Date("2024-06-03T00:00:00Z");
  const portfolioDates = businessDaysBetween(portfolioStart, SEED_END);

  // Per-holding daily returns aligned to the portfolio date axis
  const holdingDaily: number[][] = holdings.map((h) => {
    const ana = strategyAnalytics.get(ARCHETYPES[h.idx].id)!;
    return ana.daily_returns
      .filter((d) => d.date >= "2024-06-03")
      .map((d) => d.value);
  });

  // Portfolio daily returns + cumulative + equity curve (downsampled weekly)
  const portfolioDaily: number[] = new Array(portfolioDates.length).fill(0);
  const portfolio_equity_curve: Array<{ date: string; value: number }> = [];
  let equity = 1;
  for (let i = 0; i < portfolioDates.length; i++) {
    let dayR = 0;
    for (let j = 0; j < holdings.length; j++) {
      const v = holdingDaily[j][i] ?? 0;
      dayR += holdings[j].weight * v;
    }
    portfolioDaily[i] = dayR;
    equity *= 1 + dayR;
    if (i % 5 === 0) {
      portfolio_equity_curve.push({
        date: portfolioDates[i],
        value: Number((equity - 1).toFixed(5)),
      });
    }
  }
  const total_return_twr = Number((equity - 1).toFixed(5));

  // Portfolio scalars derived from the daily return vector — textbook
  // definitions, no fudging.
  const nPort = portfolioDaily.length;
  const meanPort =
    nPort > 0 ? portfolioDaily.reduce((s, r) => s + r, 0) / nPort : 0;
  const varPort =
    nPort > 1
      ? portfolioDaily.reduce((s, r) => s + (r - meanPort) * (r - meanPort), 0) /
        (nPort - 1)
      : 0;
  const portfolio_volatility = Math.sqrt(varPort) * Math.sqrt(252);
  const portfolio_sharpe =
    portfolio_volatility > 0
      ? Number(((meanPort * 252) / portfolio_volatility).toFixed(3))
      : 0;

  // Attribution: contribution = weight * strategy_cagr (standard allocator
  // attribution). `allocation_effect` is reserved for a future
  // Brinson-style decomposition against a benchmark; for now it's nulled
  // out rather than multiplied by a magic 0.85 constant that has no
  // financial meaning and would embarrass the product in front of a quant.
  const attribution_breakdown: PortfolioAnalyticsPayload["attribution_breakdown"] =
    [];
  const risk_decomposition: PortfolioAnalyticsPayload["risk_decomposition"] =
    [];
  for (const h of holdings) {
    const arch = ARCHETYPES[h.idx];
    const ana = strategyAnalytics.get(arch.id)!;
    attribution_breakdown.push({
      strategy_id: arch.id,
      strategy_name: arch.name,
      contribution: Number((h.weight * ana.cagr).toFixed(5)),
      // Reserved for Brinson allocation effect — requires a benchmark
      // weight vector we don't have yet. Zero is the honest placeholder.
      allocation_effect: 0,
    });
    risk_decomposition.push({
      strategy_id: arch.id,
      strategy_name: arch.name,
      marginal_risk_pct: Number((h.weight * 100).toFixed(2)),
      standalone_vol: ana.volatility,
      component_var: Number((h.weight * ana.volatility).toFixed(5)),
      weight_pct: Number((h.weight * 100).toFixed(2)),
    });
  }

  // Average pairwise correlation — used only to seed the displayed
  // correlation matrix with realistic noise, not for the portfolio vol
  // computation (which now comes from real portfolio daily returns).
  const avgCorr = 0.15;

  // Build correlation matrix (hollow diag=1, off=avgCorr + small noise)
  const correlation_matrix: Record<string, Record<string, number>> = {};
  const rng = mulberry32(7000);
  for (const h1 of holdings) {
    const id1 = ARCHETYPES[h1.idx].id;
    correlation_matrix[id1] = {};
    for (const h2 of holdings) {
      const id2 = ARCHETYPES[h2.idx].id;
      if (id1 === id2) {
        correlation_matrix[id1][id2] = 1;
      } else {
        const noise = (rng() - 0.5) * 0.1;
        correlation_matrix[id1][id2] = Number((avgCorr + noise).toFixed(3));
      }
    }
  }

  // Max DD on portfolio (equity curve already computed above)
  let p = portfolio_equity_curve[0]?.value ?? 0;
  let maxDD = 0;
  for (const pt of portfolio_equity_curve) {
    if (pt.value > p) p = pt.value;
    const dd = (1 + pt.value) / (1 + p) - 1;
    if (dd < maxDD) maxDD = dd;
  }

  // Rolling correlation — single pair for narrative simplicity
  const rolling_correlation: Record<
    string,
    Array<{ date: string; value: number }>
  > = {};
  if (holdings.length >= 2) {
    const key = "mean_pairwise";
    const rc: Array<{ date: string; value: number }> = [];
    for (let i = 20; i < portfolioDates.length; i += 5) {
      const base = avgCorr + Math.sin(i / 40) * 0.08;
      rc.push({ date: portfolioDates[i], value: Number(base.toFixed(3)) });
    }
    rolling_correlation[key] = rc;
  }

  const narrative_summary = `${narrativeLabel}: ${holdings.length} active strategies, total AUM $${(total_aum / 1_000_000).toFixed(2)}M, TWR ${(total_return_twr * 100).toFixed(1)}% since inception, Sharpe ${portfolio_sharpe.toFixed(2)}, max DD ${(maxDD * 100).toFixed(1)}%.`;

  return {
    computation_status: "complete",
    total_aum,
    total_return_twr,
    total_return_mwr: total_return_twr, // no-flow approximation
    portfolio_sharpe: Number(portfolio_sharpe.toFixed(3)),
    portfolio_volatility: Number(portfolio_volatility.toFixed(5)),
    portfolio_max_drawdown: Number(maxDD.toFixed(5)),
    avg_pairwise_correlation: avgCorr,
    return_24h: 0.0012,
    return_mtd: 0.018,
    return_ytd: Number((total_return_twr * 0.6).toFixed(5)),
    narrative_summary,
    correlation_matrix,
    attribution_breakdown,
    risk_decomposition,
    benchmark_comparison: {
      symbol: "BTC",
      benchmark_return: 0.62,
      portfolio_return: total_return_twr,
      alpha: Number((total_return_twr - 0.62 * 0.4).toFixed(5)),
      beta: 0.4,
      stale: false,
    },
    optimizer_suggestions: null,
    portfolio_equity_curve,
    rolling_correlation,
  };
}

// =========================================================================
// Supabase insertion
// =========================================================================

async function ensureAuthUser(
  admin: SupabaseClient,
  id: string,
  email: string,
  password: string,
  metadata: Record<string, unknown>,
) {
  // Supabase admin API: create or fetch by id.
  const { data: existing } = await admin.auth.admin.getUserById(id);
  if (existing.user) {
    // Update password + metadata in case they drifted
    await admin.auth.admin.updateUserById(id, {
      password,
      email,
      user_metadata: metadata,
      email_confirm: true,
    });
    return;
  }
  const { error } = await admin.auth.admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error && !error.message.includes("already registered")) {
    throw error;
  }
}

async function wipeLegacySeed(admin: SupabaseClient) {
  console.log("[seed] Wiping legacy /demo seed data...");

  // Delete in FK order
  const legacyPortfolios = LEGACY_PORTFOLIO_IDS;
  const legacyAllocators = LEGACY_ALLOCATOR_IDS;

  await admin
    .from("portfolio_analytics")
    .delete()
    .in("portfolio_id", legacyPortfolios);
  await admin
    .from("allocation_events")
    .delete()
    .in("portfolio_id", legacyPortfolios);
  await admin
    .from("portfolio_strategies")
    .delete()
    .in("portfolio_id", legacyPortfolios);
  await admin.from("portfolios").delete().in("id", legacyPortfolios);

  // Match batches + candidates for legacy allocators
  const { data: legacyBatches } = await admin
    .from("match_batches")
    .select("id")
    .in("allocator_id", legacyAllocators);
  const legacyBatchIds = (legacyBatches ?? []).map((b) => b.id);
  if (legacyBatchIds.length > 0) {
    await admin
      .from("match_candidates")
      .delete()
      .in("batch_id", legacyBatchIds);
    await admin.from("match_batches").delete().in("id", legacyBatchIds);
  }
  await admin
    .from("match_decisions")
    .delete()
    .in("allocator_id", legacyAllocators);
  await admin
    .from("contact_requests")
    .delete()
    .in("allocator_id", legacyAllocators);
  await admin
    .from("allocator_preferences")
    .delete()
    .in("user_id", legacyAllocators);

  // Delete legacy is_example=true strategies + their analytics
  const { data: legacyStrategies } = await admin
    .from("strategies")
    .select("id")
    .eq("is_example", true);
  const legacyStrategyIds = (legacyStrategies ?? []).map((s) => s.id);
  if (legacyStrategyIds.length > 0) {
    await admin
      .from("strategy_analytics")
      .delete()
      .in("strategy_id", legacyStrategyIds);
    await admin
      .from("portfolio_strategies")
      .delete()
      .in("strategy_id", legacyStrategyIds);
    await admin.from("strategies").delete().in("id", legacyStrategyIds);
  }

  // Delete legacy allocator profiles (auth.users will be soft-retained)
  await admin.from("profiles").delete().in("id", legacyAllocators);
  for (const id of legacyAllocators) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  console.log("[seed] Legacy wipe complete.");
}

async function wipeNewSeed(admin: SupabaseClient) {
  console.log("[seed] Wiping prior full-app seed data (idempotent)...");
  const portfolioIds = Object.values(PORTFOLIO_IDS);

  // Wipe the allocator's favorites first. Migration 024 cascades from
  // strategies → user_favorites, but we also wipe strategies below so
  // belt-and-suspenders: deleting favorites explicitly is a noop if the
  // table doesn't exist yet (pre-migration), and a proper cleanup post.
  await admin.from("user_favorites").delete().eq("user_id", ALLOCATOR_ID);

  await admin
    .from("portfolio_analytics")
    .delete()
    .in("portfolio_id", portfolioIds);
  await admin
    .from("allocation_events")
    .delete()
    .in("portfolio_id", portfolioIds);
  await admin
    .from("portfolio_strategies")
    .delete()
    .in("portfolio_id", portfolioIds);
  await admin.from("portfolios").delete().in("id", portfolioIds);

  await admin
    .from("strategy_analytics")
    .delete()
    .in("strategy_id", [...STRATEGY_IDS]);
  await admin
    .from("portfolio_strategies")
    .delete()
    .in("strategy_id", [...STRATEGY_IDS]);
  await admin.from("strategies").delete().in("id", [...STRATEGY_IDS]);

  await admin
    .from("api_keys")
    .delete()
    .in("id", [...API_KEY_IDS]);

  // Match batches for our allocator
  const { data: ourBatches } = await admin
    .from("match_batches")
    .select("id")
    .eq("allocator_id", ALLOCATOR_ID);
  const ourBatchIds = (ourBatches ?? []).map((b) => b.id);
  if (ourBatchIds.length > 0) {
    await admin.from("match_candidates").delete().in("batch_id", ourBatchIds);
    await admin.from("match_batches").delete().in("id", ourBatchIds);
  }

  await admin
    .from("allocator_preferences")
    .delete()
    .eq("user_id", ALLOCATOR_ID);
  await admin.from("profiles").delete().eq("id", ALLOCATOR_ID);
  await admin.from("profiles").delete().in("id", [...MANAGER_IDS]);
}

async function main() {
  if (process.env.SEED_CONFIRM_STAGING !== "true") {
    console.error(
      "[seed] Refusing to run without SEED_CONFIRM_STAGING=true interlock.",
    );
    process.exit(2);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "[seed] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
    process.exit(2);
  }
  if (/\b(prod|production)\b/i.test(url)) {
    console.error(`[seed] Refusing production-flavored URL: ${url}`);
    process.exit(3);
  }

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await wipeLegacySeed(admin);
  await wipeNewSeed(admin);

  // ========= 1. auth.users =========
  console.log("[seed] Creating auth.users for allocator + 8 managers...");
  await ensureAuthUser(admin, ALLOCATOR_ID, ALLOCATOR_EMAIL, ALLOCATOR_PASSWORD, {
    display_name: "Atlas Family Office",
    role: "allocator",
  });

  const MANAGER_DEFS = [
    { name: "Polaris Capital", tier: "institutional" },
    { name: "Helios Quant", tier: "institutional" },
    { name: "Redline Trading", tier: "institutional" },
    { name: "Meridian Systematic", tier: "institutional" },
    { name: "Kepler Alpha", tier: "institutional" },
    { name: "Astra Vol Partners", tier: "institutional" },
    { name: "Drift Research Lab", tier: "exploratory" },
    { name: "Midas Liquid", tier: "institutional" },
  ];
  for (let i = 0; i < MANAGER_IDS.length; i++) {
    const slug = MANAGER_DEFS[i].name.toLowerCase().replace(/\s+/g, "-");
    await ensureAuthUser(
      admin,
      MANAGER_IDS[i],
      `${slug}@quantalyze.test`,
      `DemoManager${i + 1}!2026`,
      { display_name: MANAGER_DEFS[i].name, role: "manager" },
    );
  }

  // ========= 2. profiles =========
  console.log("[seed] Upserting profiles...");
  const allocatorProfile = {
    id: ALLOCATOR_ID,
    display_name: "Atlas Family Office",
    company: "Atlas Family Office",
    description:
      "Single-family office allocating to external crypto-quant managers. Disciplined LP — uses Quantalyze to track positions and test allocation scenarios.",
    email: ALLOCATOR_EMAIL,
    website: "https://atlas-family.example",
    avatar_url: null,
    role: "allocator",
    manager_status: "newbie",
    allocator_status: "verified",
    is_admin: false,
    bio: "Family office, $50-100M book, mix of real allocations and scenario testing.",
    aum_range: "$50M-$100M",
  };
  const { error: alcErr } = await admin.from("profiles").upsert(allocatorProfile);
  if (alcErr) throw alcErr;

  for (let i = 0; i < MANAGER_IDS.length; i++) {
    const m = MANAGER_DEFS[i];
    const slug = m.name.toLowerCase().replace(/\s+/g, "-");
    const { error: mErr } = await admin.from("profiles").upsert({
      id: MANAGER_IDS[i],
      display_name: m.name,
      company: m.name,
      description: `${m.name} — ${m.tier === "institutional" ? "verified institutional manager" : "exploratory-tier quant researcher"}.`,
      email: `${slug}@quantalyze.test`,
      role: "manager",
      manager_status: m.tier === "institutional" ? "verified" : "newbie",
      allocator_status: "newbie",
      is_admin: false,
      years_trading: 4 + i,
      aum_range: m.tier === "institutional" ? "$10M-$50M" : "$1M-$10M",
    });
    if (mErr) throw mErr;
  }

  // ========= 3. allocator_preferences =========
  console.log("[seed] Upserting allocator preferences...");
  const { error: prefErr } = await admin.from("allocator_preferences").upsert({
    user_id: ALLOCATOR_ID,
    mandate_archetype: "institutional_lp",
    target_ticket_size_usd: 1_000_000,
    excluded_exchanges: [],
    max_drawdown_tolerance: 0.15,
    min_track_record_days: 540,
    min_sharpe: 1.0,
    max_aum_concentration: 0.25,
    preferred_strategy_types: ["arbitrage", "market_neutral", "delta_neutral"],
    preferred_markets: ["BTC", "ETH", "crypto_spot"],
    founder_notes:
      "Active Allocation is my real book. Aggressive Tilt and Risk-Off are scenario tests I use to decide invest/divest.",
  });
  if (prefErr) throw new Error(`allocator_preferences: ${prefErr.message}`);

  // ========= 4. api_keys =========
  console.log("[seed] Inserting api_keys for real-portfolio strategies...");
  for (const keyId of API_KEY_IDS) {
    const { error } = await admin.from("api_keys").upsert({
      id: keyId,
      user_id: ALLOCATOR_ID,
      exchange: keyId === API_KEY_IDS[0] ? "binance" : "okx",
      label:
        keyId === API_KEY_IDS[0]
          ? "Atlas Binance Read-Only"
          : "Atlas OKX Read-Only",
      api_key_encrypted: "DEMO_SEED_PLACEHOLDER_ENCRYPTED",
      api_secret_encrypted: "DEMO_SEED_PLACEHOLDER_ENCRYPTED",
      is_active: true,
      kek_version: 1,
      sync_status: "idle",
      last_sync_at: new Date().toISOString(),
      account_balance_usdt: 5_000_000,
    });
    if (error) throw new Error(`api_keys ${keyId}: ${error.message}`);
  }

  // ========= 5. strategies =========
  console.log("[seed] Inserting 15 strategies...");
  // Discovery categories: the sidebar + /discovery/[slug] page filter
  // strategies by category_id. Seed strategies into "crypto-sma" so
  // they show up where the demo allocator browses.
  const { data: cryptoSmaCategory, error: categoryErr } = await admin
    .from("discovery_categories")
    .select("id")
    .eq("slug", "crypto-sma")
    .maybeSingle();
  if (categoryErr) {
    throw new Error(
      `discovery_categories lookup failed: ${categoryErr.message}`,
    );
  }
  if (!cryptoSmaCategory) {
    throw new Error(
      "discovery_categories row for slug='crypto-sma' is missing. Run the category seed before this script.",
    );
  }
  const cryptoSmaCategoryId = cryptoSmaCategory.id as string;

  // Do NOT set strategies.api_key_id here. That column is the manager's
  // verification key (proving the strategy's track record via read-only
  // exchange API access). The demo has no manager-owned api_keys — the
  // api_keys rows are allocator-owned, used for portfolio tracking, not
  // strategy verification. Linking a manager-owned strategy to an
  // allocator-owned key is a cross-tenant violation that migration 028's
  // tenant check trigger blocks. Leave api_key_id NULL for demo strategies;
  // the synthetic analytics in strategy_analytics provide the dashboard
  // data without needing a verification key.
  for (const arch of ARCHETYPES) {
    const { error } = await admin.from("strategies").upsert({
      id: arch.id,
      user_id: MANAGER_IDS[arch.managerIdx],
      category_id: cryptoSmaCategoryId,
      api_key_id: null,
      name: arch.name,
      codename: arch.codename,
      description: arch.description,
      strategy_types: arch.strategy_types,
      subtypes: arch.subtypes,
      markets: arch.markets,
      supported_exchanges: arch.exchanges,
      leverage_range: arch.leverage,
      avg_daily_turnover: arch.avgTurnover,
      aum: arch.aum,
      max_capacity: arch.capacity,
      start_date: arch.startDate,
      status: "published",
      is_example: true,
      benchmark: "BTC",
      disclosure_tier: arch.tier,
    });
    if (error) throw new Error(`strategies upsert failed for ${arch.name}: ${error.message}`);
  }

  // ========= 6. strategy_analytics =========
  console.log("[seed] Computing + inserting strategy_analytics...");
  const strategyAnalyticsMap = new Map<string, AnalyticsPayload>();
  for (const arch of ARCHETYPES) {
    const payload = generateAnalytics(arch);
    strategyAnalyticsMap.set(arch.id, payload);
    // Wipe existing analytics for this strategy first (composite PK is (id),
    // but strategy_id isn't a PK — it's FK + we need the "one row per
    // strategy" semantic via a delete-then-insert).
    await admin
      .from("strategy_analytics")
      .delete()
      .eq("strategy_id", arch.id);
    const { error } = await admin.from("strategy_analytics").insert({
      strategy_id: arch.id,
      computation_status: "complete",
      benchmark: "BTC",
      cumulative_return: payload.cumulative_return,
      cagr: payload.cagr,
      volatility: payload.volatility,
      sharpe: payload.sharpe,
      sortino: payload.sortino,
      calmar: payload.calmar,
      max_drawdown: payload.max_drawdown,
      max_drawdown_duration_days: payload.max_drawdown_duration_days,
      six_month_return: payload.six_month_return,
      sparkline_returns: payload.sparkline_returns,
      sparkline_drawdown: payload.sparkline_drawdown,
      returns_series: payload.returns_series,
      drawdown_series: payload.drawdown_series,
      monthly_returns: payload.monthly_returns,
      daily_returns: payload.daily_returns,
      rolling_metrics: payload.rolling_metrics,
      return_quantiles: payload.return_quantiles,
    });
    if (error) throw new Error(`strategy_analytics insert failed for ${arch.name}: ${error.message}`);
  }

  // ========= 7. portfolios =========
  console.log("[seed] Inserting 3 portfolios...");
  const { error: pfErr } = await admin.from("portfolios").upsert([
    {
      id: PORTFOLIO_IDS.active,
      user_id: ALLOCATOR_ID,
      name: "Active Allocation",
      description:
        "My real book — holdings are auto-synced from connected exchange API keys. Invest/divest events detected via exchange sync.",
      created_at: "2024-06-01T12:00:00Z",
      is_test: false,
    },
    {
      id: PORTFOLIO_IDS.aggressive,
      user_id: ALLOCATOR_ID,
      name: "What-if: Aggressive Tilt",
      description:
        "SCENARIO — not a real position. Simulates what my book would have done with more directional exposure.",
      created_at: "2024-07-15T12:00:00Z",
      is_test: true,
    },
    {
      id: PORTFOLIO_IDS.riskoff,
      user_id: ALLOCATOR_ID,
      name: "What-if: Risk-Off",
      description:
        "SCENARIO — not a real position. Simulates a defensive arbitrage-only allocation.",
      created_at: "2024-07-15T13:00:00Z",
      is_test: true,
    },
  ]);
  if (pfErr) throw new Error(`portfolios: ${pfErr.message}`);

  // ========= 8. portfolio_strategies =========
  console.log("[seed] Inserting portfolio_strategies (holdings)...");
  const makeHolding = (
    portfolioId: string,
    h: HoldingSpec,
    _source: "auto" | "manual",
  ) => ({
    portfolio_id: portfolioId,
    strategy_id: ARCHETYPES[h.idx].id,
    added_at: "2024-06-03T12:00:00Z",
    allocated_amount: h.initialUsd,
    allocated_at: "2024-06-03T12:00:00Z",
    current_weight: h.weight,
    relationship_status: "connected",
    founder_notes: [],
  });

  const holdingsRows: ReturnType<typeof makeHolding>[] = [];
  for (const h of ACTIVE_HOLDINGS)
    holdingsRows.push(makeHolding(PORTFOLIO_IDS.active, h, "auto"));
  for (const h of AGGRESSIVE_HOLDINGS)
    holdingsRows.push(makeHolding(PORTFOLIO_IDS.aggressive, h, "manual"));
  for (const h of RISKOFF_HOLDINGS)
    holdingsRows.push(makeHolding(PORTFOLIO_IDS.riskoff, h, "manual"));
  const { error: psErr } = await admin.from("portfolio_strategies").upsert(holdingsRows);
  if (psErr) throw new Error(`portfolio_strategies: ${psErr.message}`);

  // ========= 9. allocation_events =========
  console.log("[seed] Inserting allocation_events (lifecycle)...");
  const events: AllocEvent[] = [];
  events.push(...buildActiveLifecycle());
  events.push(
    ...buildScenarioLifecycle(
      PORTFOLIO_IDS.aggressive,
      AGGRESSIVE_HOLDINGS,
      "Aggressive Tilt",
    ),
  );
  events.push(
    ...buildScenarioLifecycle(
      PORTFOLIO_IDS.riskoff,
      RISKOFF_HOLDINGS,
      "Risk-Off",
    ),
  );
  // Chunked insert to avoid payload limits
  const chunkSize = 50;
  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    const { error } = await admin.from("allocation_events").insert(chunk);
    if (error) throw error;
  }

  // ========= 10. portfolio_analytics =========
  console.log("[seed] Computing + inserting portfolio_analytics...");
  const activeAnalytics = buildPortfolioAnalytics(
    PORTFOLIO_IDS.active,
    ACTIVE_HOLDINGS,
    "Active Allocation",
    strategyAnalyticsMap,
  );
  const aggressiveAnalytics = buildPortfolioAnalytics(
    PORTFOLIO_IDS.aggressive,
    AGGRESSIVE_HOLDINGS,
    "What-if: Aggressive Tilt",
    strategyAnalyticsMap,
  );
  const riskoffAnalytics = buildPortfolioAnalytics(
    PORTFOLIO_IDS.riskoff,
    RISKOFF_HOLDINGS,
    "What-if: Risk-Off",
    strategyAnalyticsMap,
  );
  // portfolio_analytics is upsert-by-id not by portfolio_id; wipe first
  await admin
    .from("portfolio_analytics")
    .delete()
    .in("portfolio_id", Object.values(PORTFOLIO_IDS));
  const { error: paErr } = await admin.from("portfolio_analytics").insert([
    { portfolio_id: PORTFOLIO_IDS.active, ...activeAnalytics },
    { portfolio_id: PORTFOLIO_IDS.aggressive, ...aggressiveAnalytics },
    { portfolio_id: PORTFOLIO_IDS.riskoff, ...riskoffAnalytics },
  ]);
  if (paErr) throw new Error(`portfolio_analytics: ${paErr.message}`);

  // ========= 11. user_favorites =========
  // Seed four favorites for the demo allocator pointing at strategies NOT
  // in Active Allocation, so the Favorites panel in My Allocation has
  // genuinely interesting "what if I added this to my book?" material to
  // toggle. Picks span different archetypes (arb, momentum, mean
  // reversion, on-chain exploratory) so overlaying each tells a distinct
  // story on the YTD chart.
  console.log("[seed] Seeding user_favorites for the demo allocator...");
  const FAVORITE_IDXS: number[] = [
    IDX.POLARIS_ARB, // cross-exchange arbitrage — lowest-vol diversifier
    IDX.REDLINE_MOM, // momentum / trend — adds upside convexity
    IDX.KEPLER_MR, // mean reversion — orthogonal to the current book
    IDX.DRIFT_ONCHAIN, // on-chain exploratory — higher vol, different beta
  ];
  const activeIdxSet = new Set(ACTIVE_HOLDINGS.map((h) => h.idx));
  for (const idx of FAVORITE_IDXS) {
    if (activeIdxSet.has(idx)) {
      throw new Error(
        `[seed] Favorite idx ${idx} (${ARCHETYPES[idx].name}) is already in ACTIVE_HOLDINGS. Pick a different strategy so the Favorites panel has something meaningful to toggle.`,
      );
    }
  }
  const favoriteRows = FAVORITE_IDXS.map((idx, i) => ({
    user_id: ALLOCATOR_ID,
    strategy_id: ARCHETYPES[idx].id,
    // Stagger created_at so the most recent favorite appears at the top
    // of the panel — mirrors a real user adding them over time.
    created_at: new Date(
      Date.UTC(2026, 3, 1 + i, 12, 0, 0),
    ).toISOString(),
    notes: null,
  }));
  const { error: favErr } = await admin
    .from("user_favorites")
    .upsert(favoriteRows);
  if (favErr) throw new Error(`user_favorites: ${favErr.message}`);

  console.log("[seed] ✅ Full-app demo seed complete.");
  console.log(`  - 1 allocator (${ALLOCATOR_EMAIL} / ${ALLOCATOR_PASSWORD})`);
  console.log(`  - ${MANAGER_IDS.length} managers`);
  console.log(`  - ${ARCHETYPES.length} strategies`);
  console.log(`  - 3 portfolios (1 real + 2 scenarios)`);
  console.log(`  - ${events.length} allocation events`);
  console.log(`  - ${favoriteRows.length} user_favorites`);
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
