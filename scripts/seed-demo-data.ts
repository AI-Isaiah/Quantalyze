/**
 * scripts/seed-demo-data.ts
 *
 * Deterministic, idempotent demo-data seeder. Used by:
 *   1. The founder to hydrate staging before a demo
 *   2. CI to rebuild the test database before Playwright runs
 *
 * Deterministic: fixed UUIDs + mulberry32 PRNG seeded from a constant so
 * repeated runs produce byte-identical analytics. No live exchange calls.
 *
 * Idempotent: every insert/upsert is onConflict-safe. Strategies with
 * `is_example=true` are the "demo set" — we never touch non-example rows.
 *
 * Usage (from repo root):
 *   SEED_CONFIRM_STAGING=true \
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/seed-demo-data.ts
 *
 * Prerequisites:
 *   - Migrations 010, 011, 012, 014 must be applied to the target Supabase instance
 *   - Service role key is REQUIRED (writes RLS-protected tables + creates auth.users)
 *   - SEED_CONFIRM_STAGING=true is REQUIRED as a safety interlock
 *   - The target URL must not look production-flavored (hard-rejected)
 */

import { createClient } from "@supabase/supabase-js";

// ---------- Fixed UUIDs (change at your peril — tests depend on them) ----------

const ALLOCATOR_COLD = "aaaaaaaa-0001-4000-8000-000000000001";
const ALLOCATOR_ACTIVE = "aaaaaaaa-0001-4000-8000-000000000002";
const ALLOCATOR_STALLED = "aaaaaaaa-0001-4000-8000-000000000003";

const MANAGER_INSTITUTIONAL_A = "bbbbbbbb-0001-4000-8000-000000000001";
const MANAGER_INSTITUTIONAL_B = "bbbbbbbb-0001-4000-8000-000000000002";
const MANAGER_EXPLORATORY_A = "bbbbbbbb-0001-4000-8000-000000000003";
const MANAGER_EXPLORATORY_B = "bbbbbbbb-0001-4000-8000-000000000004";

const STRATEGY_UUIDS = [
  "cccccccc-0001-4000-8000-000000000001",
  "cccccccc-0001-4000-8000-000000000002",
  "cccccccc-0001-4000-8000-000000000003",
  "cccccccc-0001-4000-8000-000000000004",
  "cccccccc-0001-4000-8000-000000000005",
  "cccccccc-0001-4000-8000-000000000006",
  "cccccccc-0001-4000-8000-000000000007",
  "cccccccc-0001-4000-8000-000000000008",
] as const;

const ACTIVE_PORTFOLIO_ID = "dddddddd-0001-4000-8000-000000000001";

// ---------- Deterministic PRNG (mulberry32) ----------

function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian sample via Box–Muller, using the supplied PRNG. */
function gaussian(rng: () => number, mean: number, stdDev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- Strategy profiles ----------

interface StrategyProfile {
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

const STRATEGY_PROFILES: StrategyProfile[] = [
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

// ---------- Analytics generation ----------

interface GeneratedAnalytics {
  cumulative_return: number;
  cagr: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  max_drawdown: number;
  six_month_return: number;
  sparkline_returns: number[];
}

function generateAnalytics(profile: StrategyProfile, seed: number): GeneratedAnalytics {
  const rng = mulberry32(seed);

  // 365 daily log returns with the profile's mean + vol
  const dailyMean = profile.annualizedReturn / 365;
  const dailyVol = profile.annualizedVol / Math.sqrt(365);

  const days = 365;
  const returns: number[] = [];
  let cumulative = 1;
  let peak = 1;
  let maxDd = 0;
  const cumulativeSeries: number[] = [1];

  for (let i = 0; i < days; i++) {
    const r = gaussian(rng, dailyMean, dailyVol);
    returns.push(r);
    cumulative *= 1 + r;
    cumulativeSeries.push(cumulative);
    if (cumulative > peak) peak = cumulative;
    const dd = (cumulative - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  const cagr = Math.pow(cumulative, 365 / days) - 1;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const annualVol = stdDev * Math.sqrt(365);
  const sharpe = annualVol > 0 ? (cagr - 0.04) / annualVol : 0;

  // Sortino: use only downside returns
  const downside = returns.filter((r) => r < 0);
  const downsideStd =
    downside.length > 0
      ? Math.sqrt(
          downside.reduce((acc, r) => acc + r * r, 0) / downside.length,
        ) * Math.sqrt(365)
      : annualVol;
  const sortino = downsideStd > 0 ? (cagr - 0.04) / downsideStd : 0;

  const calmar = Math.abs(maxDd) > 1e-6 ? cagr / Math.abs(maxDd) : 0;

  const sixMonthIdx = Math.max(0, cumulativeSeries.length - 183);
  const sixMonthReturn =
    cumulativeSeries[cumulativeSeries.length - 1] /
      cumulativeSeries[sixMonthIdx] -
    1;

  return {
    cumulative_return: cumulative - 1,
    cagr,
    volatility: annualVol,
    sharpe,
    sortino,
    calmar,
    max_drawdown: maxDd,
    six_month_return: sixMonthReturn,
    sparkline_returns: cumulativeSeries.map((v) => v - 1),
  };
}

// ---------- Main ----------

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  // Hard guard against running against production. The script wipes
  // is_example=true strategies and creates 7 confirmed auth users — an
  // accidental run against a prod URL is catastrophic. Require an explicit
  // opt-in env var AND reject any URL that looks production-flavored.
  if (/\b(prod|production)\b/i.test(url)) {
    throw new Error(
      `[seed] Refusing to run against production-flavored URL: ${url}`,
    );
  }
  if (process.env.SEED_CONFIRM_STAGING !== "true") {
    throw new Error(
      "[seed] Refusing to run without SEED_CONFIRM_STAGING=true. " +
        `Target URL: ${url}. Set SEED_CONFIRM_STAGING=true to confirm this is a staging instance.`,
    );
  }

  const supabase = createClient(url, serviceKey);

  console.log("[seed] Wiping existing demo portfolio for ALLOCATOR_ACTIVE ...");
  // The strategy wipe below cascades into portfolio_strategies (FK), but the
  // portfolio shell itself is not owned by any strategy, so it survives.
  // Delete the shell first so re-runs don't accumulate stale demo portfolios.
  // Idempotent — no-op if portfolio does not yet exist.
  const { error: portWipeErr } = await supabase
    .from("portfolios")
    .delete()
    .eq("id", ACTIVE_PORTFOLIO_ID);
  if (portWipeErr) throw portWipeErr;

  console.log("[seed] Wiping existing is_example=true rows ...");
  // Delete analytics first (FK cascade would also work, but being explicit
  // keeps the logs readable). strategy_analytics has a UNIQUE FK so we
  // cascade via strategies anyway.
  const { error: wipeErr } = await supabase
    .from("strategies")
    .delete()
    .eq("is_example", true);
  if (wipeErr) throw wipeErr;

  console.log("[seed] Ensuring auth.users for demo UUIDs ...");
  // profiles.id has a FK to auth.users(id). We must create auth users with
  // the hard-coded UUIDs before upserting profiles. Uses the admin API,
  // which allows specifying id + email. Idempotent: only swallows the
  // specific "already exists" conflicts Supabase returns (status 422 with
  // a known code). Anything else is a real error and must surface.
  const authUsers = [
    { id: ALLOCATOR_COLD, email: "demo-cold@example.com" },
    { id: ALLOCATOR_ACTIVE, email: "demo-active@example.com" },
    { id: ALLOCATOR_STALLED, email: "demo-stalled@example.com" },
    { id: MANAGER_INSTITUTIONAL_A, email: "alice@example-stellar.com" },
    { id: MANAGER_INSTITUTIONAL_B, email: "marcus@example-aurora.com" },
    { id: MANAGER_EXPLORATORY_A, email: "helios@example-demo.com" },
    { id: MANAGER_EXPLORATORY_B, email: "pulsar@example-demo.com" },
  ];
  const KNOWN_CONFLICT_CODES = /^(email_exists|user_already_exists|phone_exists)$/;
  for (const u of authUsers) {
    const { error } = await supabase.auth.admin.createUser({
      id: u.id,
      email: u.email,
      email_confirm: true,
    });
    if (!error) continue;
    const status = (error as { status?: number }).status;
    const code = (error as { code?: string }).code ?? "";
    if (status === 422 && KNOWN_CONFLICT_CODES.test(code)) continue;
    throw error;
  }

  console.log("[seed] Upserting profiles (3 allocators + 4 managers) ...");
  const profileRows = [
    {
      id: ALLOCATOR_COLD,
      display_name: "Cold Start Capital",
      company: "Cold Start Capital",
      email: "demo-cold@example.com",
      role: "allocator",
      allocator_status: "verified",
    },
    {
      id: ALLOCATOR_ACTIVE,
      display_name: "Active Allocator LP",
      company: "Active Allocator LP",
      email: "demo-active@example.com",
      role: "allocator",
      allocator_status: "verified",
    },
    {
      id: ALLOCATOR_STALLED,
      display_name: "Stalled Diligence Fund",
      company: "Stalled Diligence Fund",
      email: "demo-stalled@example.com",
      role: "allocator",
      allocator_status: "verified",
    },
    {
      id: MANAGER_INSTITUTIONAL_A,
      display_name: "Dr. Alice Chen",
      company: "Stellar Quant Research",
      email: "alice@example-stellar.com",
      role: "manager",
      manager_status: "verified",
      bio: "PhD in statistical physics from Princeton. 12 years trading equities and derivatives at Citadel and Two Sigma. Runs market-neutral crypto strategies since 2022.",
      years_trading: 12,
      aum_range: "$10M–$50M",
      linkedin: "https://www.linkedin.com/in/alice-chen-demo",
    },
    {
      id: MANAGER_INSTITUTIONAL_B,
      display_name: "Marcus Okafor",
      company: "Aurora Systematic",
      email: "marcus@example-aurora.com",
      role: "manager",
      manager_status: "verified",
      bio: "Former Jump Trading options desk. Builds systematic vol-carry and basis-trade strategies across CEX and DEX venues.",
      years_trading: 9,
      aum_range: "$25M–$100M",
      linkedin: "https://www.linkedin.com/in/marcus-okafor-demo",
    },
    {
      id: MANAGER_EXPLORATORY_A,
      display_name: "Helios Research",
      company: null,
      email: "helios@example-demo.com",
      role: "manager",
      manager_status: "pending",
    },
    {
      id: MANAGER_EXPLORATORY_B,
      display_name: "Pulsar Labs",
      company: null,
      email: "pulsar@example-demo.com",
      role: "manager",
      manager_status: "pending",
    },
  ];

  for (const row of profileRows) {
    const { error } = await supabase.from("profiles").upsert(row, {
      onConflict: "id",
    });
    if (error) throw error;
  }

  console.log("[seed] Upserting allocator preferences ...");
  const preferenceRows = [
    {
      user_id: ALLOCATOR_COLD,
      mandate_archetype: "Market Neutral",
      target_ticket_size_usd: 5_000_000,
      excluded_exchanges: [],
      min_sharpe: 1.0,
      min_track_record_days: 180,
    },
    {
      user_id: ALLOCATOR_ACTIVE,
      mandate_archetype: "L/S Equity Stat Arb",
      target_ticket_size_usd: 10_000_000,
      excluded_exchanges: [],
      min_sharpe: 1.3,
      min_track_record_days: 365,
    },
    {
      user_id: ALLOCATOR_STALLED,
      mandate_archetype: "Crypto SMA",
      target_ticket_size_usd: 2_500_000,
      excluded_exchanges: [],
      min_sharpe: 0.8,
      min_track_record_days: 180,
    },
  ];
  for (const row of preferenceRows) {
    const { error } = await supabase.from("allocator_preferences").upsert(row, {
      onConflict: "user_id",
    });
    if (error) throw error;
  }

  console.log("[seed] Inserting 8 example strategies + analytics ...");
  for (let i = 0; i < STRATEGY_PROFILES.length; i++) {
    const profile = STRATEGY_PROFILES[i];
    const { error: sErr } = await supabase.from("strategies").insert({
      id: profile.id,
      user_id: profile.user_id,
      name: profile.name,
      description: profile.description,
      strategy_types: profile.strategy_types,
      markets: ["crypto"],
      supported_exchanges: ["binance", "okx"],
      leverage_range: profile.leverage_range,
      aum: profile.aum,
      start_date: profile.startDate,
      status: "published",
      is_example: true,
      benchmark: "BTC",
      disclosure_tier: profile.disclosure_tier,
      codename: profile.codename ?? null,
    });
    if (sErr) throw sErr;

    const analytics = generateAnalytics(profile, 1000 + i);
    const { error: aErr } = await supabase.from("strategy_analytics").insert({
      strategy_id: profile.id,
      computation_status: "complete",
      benchmark: "BTC",
      cumulative_return: analytics.cumulative_return,
      cagr: analytics.cagr,
      volatility: analytics.volatility,
      sharpe: analytics.sharpe,
      sortino: analytics.sortino,
      calmar: analytics.calmar,
      max_drawdown: analytics.max_drawdown,
      six_month_return: analytics.six_month_return,
      sparkline_returns: analytics.sparkline_returns,
    });
    if (aErr) throw aErr;
  }

  console.log("[seed] Creating portfolio for Active Allocator...");
  // Idempotent: upsert the portfolio, then upsert the 3 strategy memberships in
  // a single bulk call. Links 3 institutional strategies (Stellar, Nebula,
  // Aurora) so the match engine's personalized path has data to score against.
  // Without this, the Active Allocator demo falls back to mode='screening'.
  const { error: portErr } = await supabase
    .from("portfolios")
    .upsert(
      {
        id: ACTIVE_PORTFOLIO_ID,
        user_id: ALLOCATOR_ACTIVE,
        name: "Active Allocator Portfolio",
        description: "Seeded demo portfolio linking 3 institutional strategies.",
      },
      { onConflict: "id" },
    );
  if (portErr) throw portErr;

  // Target allocation sums to 1.0; allocated_amount sums to $10M (= portfolio_aum).
  const portfolioMemberships = [
    { strategy_id: STRATEGY_UUIDS[0], current_weight: 0.40, allocated_amount: 4_000_000 },
    { strategy_id: STRATEGY_UUIDS[1], current_weight: 0.35, allocated_amount: 3_500_000 },
    { strategy_id: STRATEGY_UUIDS[2], current_weight: 0.25, allocated_amount: 2_500_000 },
  ];
  const { error: psErr } = await supabase.from("portfolio_strategies").upsert(
    portfolioMemberships.map((ps) => ({ portfolio_id: ACTIVE_PORTFOLIO_ID, ...ps })),
    { onConflict: "portfolio_id,strategy_id" },
  );
  if (psErr) throw psErr;

  console.log("[seed] Inserting 1 historical match_decision + contact_request ...");
  const { data: existingCR } = await supabase
    .from("contact_requests")
    .select("id")
    .eq("allocator_id", ALLOCATOR_ACTIVE)
    .eq("strategy_id", STRATEGY_UUIDS[0])
    .maybeSingle();

  let contactRequestId: string | undefined;
  if (!existingCR) {
    const { data: insertedCR, error: crErr } = await supabase
      .from("contact_requests")
      .insert({
        allocator_id: ALLOCATOR_ACTIVE,
        strategy_id: STRATEGY_UUIDS[0],
        status: "pending",
        message: "Historical demo intro (seeded).",
      })
      .select("id")
      .single();
    if (crErr) throw crErr;
    contactRequestId = insertedCR.id as string;
  } else {
    contactRequestId = existingCR.id as string;
  }

  const { data: existingDecision } = await supabase
    .from("match_decisions")
    .select("id")
    .eq("allocator_id", ALLOCATOR_ACTIVE)
    .eq("strategy_id", STRATEGY_UUIDS[0])
    .eq("decision", "sent_as_intro")
    .maybeSingle();

  if (!existingDecision) {
    const { error: dErr } = await supabase.from("match_decisions").insert({
      allocator_id: ALLOCATOR_ACTIVE,
      strategy_id: STRATEGY_UUIDS[0],
      decision: "sent_as_intro",
      founder_note: "Historical demo intro (seeded).",
      contact_request_id: contactRequestId,
      decided_by: ALLOCATOR_ACTIVE, // Self-reference for seed data — swapped for real founder id in prod
    });
    if (dErr) throw dErr;
  }

  console.log("[seed] Done. Seeded:");
  console.log("  - 3 allocator profiles (1 cold, 1 active, 1 stalled)");
  console.log(`  - ${STRATEGY_PROFILES.length} example strategies`);
  console.log(
    `  - ${STRATEGY_PROFILES.filter((s) => s.disclosure_tier === "institutional").length} institutional + ${STRATEGY_PROFILES.filter((s) => s.disclosure_tier === "exploratory").length} exploratory`,
  );
  console.log("  - 1 historical match_decision + contact_request");
  console.log(`  - 1 portfolio for Active Allocator with 3 institutional strategy memberships`);
  console.log("");
  console.log(
    "Next: hit POST /api/admin/match/recompute for each allocator to populate match_batches.",
  );
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
