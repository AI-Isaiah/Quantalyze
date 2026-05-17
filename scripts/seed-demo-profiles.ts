/**
 * scripts/seed-demo-profiles.ts
 *
 * Pure-data module: the 8 seed-strategy profiles + the StrategyProfile
 * interface + the seed-strategy UUIDs and the canonical demo
 * allocator/portfolio IDs. NO imports of `@supabase/supabase-js`, NO
 * runtime side effects, NO env reads — safe to import from anywhere
 * (including Playwright spec files at test-load time).
 *
 * Red-team RT-J08 (MED conf 8): the discovery E2E specs need
 * STRATEGY_PROFILES as the single source of truth for the 8 seed
 * strategy names. Importing them from scripts/seed-demo-data.ts
 * pulled the entire seed module into spec-load — including the
 * supabase-js import. A future refactor lifting any env read to
 * module scope (e.g., `const SUPABASE_URL = process.env.NEXT_...`)
 * would execute that read on every spec load, with no guard.
 * Extracting the data-only surface here decouples the dependency
 * graph at the module boundary — specs cannot trigger a seed-script
 * side effect even if a maintainer adds one to seed-demo-data.ts.
 *
 * seed-demo-data.ts re-exports from this file for backwards
 * compatibility; existing imports keep working.
 */

// ---------- Fixed UUIDs (change at your peril — tests depend on them) ----------
//
// These UUIDs MUST match the canonical constants in `src/lib/demo.ts`. The
// demo lane pins them in multiple places — any drift breaks /demo, /api/demo,
// and the seed-integrity test (`src/__tests__/seed-integrity.test.ts`).

export const ALLOCATOR_COLD = "aaaaaaaa-0001-4000-8000-000000000001";
export const ALLOCATOR_ACTIVE = "aaaaaaaa-0001-4000-8000-000000000002";
export const ALLOCATOR_STALLED = "aaaaaaaa-0001-4000-8000-000000000003";

export const MANAGER_INSTITUTIONAL_A = "bbbbbbbb-0001-4000-8000-000000000001";
export const MANAGER_INSTITUTIONAL_B = "bbbbbbbb-0001-4000-8000-000000000002";
export const MANAGER_EXPLORATORY_A = "bbbbbbbb-0001-4000-8000-000000000003";
export const MANAGER_EXPLORATORY_B = "bbbbbbbb-0001-4000-8000-000000000004";

export const STRATEGY_UUIDS = [
  "cccccccc-0001-4000-8000-000000000001",
  "cccccccc-0001-4000-8000-000000000002",
  "cccccccc-0001-4000-8000-000000000003",
  "cccccccc-0001-4000-8000-000000000004",
  "cccccccc-0001-4000-8000-000000000005",
  "cccccccc-0001-4000-8000-000000000006",
  "cccccccc-0001-4000-8000-000000000007",
  "cccccccc-0001-4000-8000-000000000008",
] as const;

// Portfolio IDs — MUST match `src/lib/demo.ts`. The seed script and the public
// /demo lane each hold their own copy so drift shows up immediately in the
// seed-integrity test rather than as a silent empty-portfolio render.
export const ACTIVE_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000001";
export const COLD_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000002";
export const STALLED_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000003";

// ---------- Strategy profiles ----------

export interface StrategyProfile {
  id: string;
  name: string;
  user_id: string;
  disclosure_tier: "institutional" | "exploratory";
  codename?: string | null;
  strategy_types: string[];
  description: string;
  aum: number;
  leverage_range: string;
  annualizedReturn: number;
  annualizedVol: number;
  startDate: string;
}

export const STRATEGY_PROFILES: StrategyProfile[] = [
  {
    id: STRATEGY_UUIDS[0],
    name: "Stellar Neutral Alpha",
    user_id: MANAGER_INSTITUTIONAL_A,
    disclosure_tier: "institutional",
    strategy_types: ["market_neutral"],
    description:
      "Market-neutral stat-arb across the top 20 liquid spot pairs. Executes on Binance + OKX.",
    aum: 12_500_000,
    leverage_range: "1.5x–2.5x",
    annualizedReturn: 0.18,
    annualizedVol: 0.11,
    startDate: "2023-02-01",
  },
  {
    id: STRATEGY_UUIDS[1],
    name: "Nebula Momentum",
    user_id: MANAGER_INSTITUTIONAL_A,
    disclosure_tier: "institutional",
    strategy_types: ["directional"],
    description:
      "Cross-sectional momentum on top 30 altcoins, rebalanced daily. Long-only.",
    aum: 6_000_000,
    leverage_range: "1x",
    annualizedReturn: 0.28,
    annualizedVol: 0.32,
    startDate: "2023-05-15",
  },
  {
    id: STRATEGY_UUIDS[2],
    name: "Aurora Basis Trade",
    user_id: MANAGER_INSTITUTIONAL_B,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    description: "Funding-rate arbitrage between perpetual futures and spot across BTC/ETH/SOL.",
    aum: 25_000_000,
    leverage_range: "2x–3x",
    annualizedReturn: 0.14,
    annualizedVol: 0.07,
    startDate: "2022-11-10",
  },
  {
    id: STRATEGY_UUIDS[3],
    name: "Vega Volatility Harvester",
    user_id: MANAGER_INSTITUTIONAL_B,
    disclosure_tier: "institutional",
    strategy_types: ["delta_neutral"],
    description:
      "Short-vol carry on BTC weekly options, delta-hedged on Deribit. 4:1 risk/reward.",
    aum: 8_000_000,
    leverage_range: "1.5x",
    annualizedReturn: 0.22,
    annualizedVol: 0.15,
    startDate: "2023-08-01",
  },
  {
    id: STRATEGY_UUIDS[4],
    name: "Helios L/S Stat Arb",
    user_id: MANAGER_EXPLORATORY_A,
    disclosure_tier: "exploratory",
    codename: "Strategy H-42",
    strategy_types: ["market_neutral"],
    description: "Long/short pair-trading with ML-driven signal generation.",
    aum: 2_500_000,
    leverage_range: "1x–1.5x",
    annualizedReturn: 0.16,
    annualizedVol: 0.14,
    startDate: "2024-01-10",
  },
  {
    id: STRATEGY_UUIDS[5],
    name: "Orion Grid Bot",
    user_id: MANAGER_EXPLORATORY_A,
    disclosure_tier: "exploratory",
    codename: "Strategy O-17",
    strategy_types: ["market_making"],
    description: "Classic grid bot on ETH/USDT with adaptive spreads.",
    aum: 1_200_000,
    leverage_range: "1x",
    annualizedReturn: 0.11,
    annualizedVol: 0.08,
    startDate: "2024-03-01",
  },
  {
    id: STRATEGY_UUIDS[6],
    name: "Pulsar Trend Follow",
    user_id: MANAGER_EXPLORATORY_B,
    disclosure_tier: "exploratory",
    codename: "Strategy P-88",
    strategy_types: ["directional"],
    description: "Long-only trend-following on weekly BTC and ETH closes.",
    aum: 3_500_000,
    leverage_range: "1x",
    annualizedReturn: 0.24,
    annualizedVol: 0.35,
    startDate: "2023-07-15",
  },
  {
    id: STRATEGY_UUIDS[7],
    name: "Quasar Mean Reversion",
    user_id: MANAGER_EXPLORATORY_B,
    disclosure_tier: "exploratory",
    codename: "Strategy Q-03",
    strategy_types: ["market_neutral"],
    description: "Short-horizon mean reversion on the top 10 perp pairs by volume.",
    aum: 4_000_000,
    leverage_range: "1.5x",
    annualizedReturn: 0.19,
    annualizedVol: 0.17,
    startDate: "2023-10-01",
  },
];
