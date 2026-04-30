/**
 * Phase 11 / Plan 11-07 / D-15 — Deterministic seed for the
 * onboarding-funnel E2E.
 *
 * Uses the test Supabase project's service-role JWT to create a fresh
 * allocator and a placeholder Bridge candidate strategy. Each spec run
 * gets its own user (timestamped email) so the suite is rerun-safe.
 *
 * Required env (asserted at call time, not module load — module load
 * MUST stay side-effect-free so that the smoke spec which never imports
 * this file isn't accidentally affected):
 *   - TEST_SUPABASE_URL
 *   - TEST_SUPABASE_SERVICE_ROLE_KEY
 *
 * SAFETY NOTE — production isolation:
 *   The TEST_SUPABASE_* env vars MUST point at a dedicated test Supabase
 *   project, NOT production. If a developer accidentally sets them to
 *   production values, this module will mutate production data. The
 *   Plan 11-07 Task 3 BLOCKING checkpoint is the blast-radius gate —
 *   the user affirmatively confirms the test project is separate before
 *   the ci.yml gate ships. Defense-in-depth: the seeded user's email
 *   uses the deterministic prefix `e2e-onboarding-${Date.now()}@…` so
 *   any production sighting is immediately identifiable.
 *
 *   Phase 11 review fix WR-05: getAdmin() also refuses outright when the
 *   TEST_SUPABASE_URL matches a known production pattern (the prod
 *   project ref or the project name). The Plan 11-07 Task 3 BLOCKING
 *   checkpoint is still authoritative — this is just belt-and-braces.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertNotProductionSupabaseUrl,
  assertSupabaseServiceRoleKey,
} from "../../src/lib/test-safety";

function getAdmin(): SupabaseClient {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "[seed-test-project] TEST_SUPABASE_URL or TEST_SUPABASE_SERVICE_ROLE_KEY missing — " +
        "spec must skip when secrets absent (D-16 / BLOCK-3 vars.E2E_TEST_DB_CONFIGURED).",
    );
  }
  // WR-05 defense-in-depth: prod-URL + service-role-key probes before
  // any mutation, so misconfiguration fails loudly at the boundary.
  assertNotProductionSupabaseUrl(url, "seed-test-project");
  assertSupabaseServiceRoleKey(key, "seed-test-project");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface SeededAllocator {
  userId: string;
  email: string;
  password: string;
}

/**
 * Create a fresh test allocator user via the service-role admin API.
 * Email is timestamped to avoid collisions across reruns.
 */
export async function seedTestAllocator(): Promise<SeededAllocator> {
  const admin = getAdmin();
  // Phase 11 WR-05: @example.test (RFC 6761 reserved TLD, guaranteed
  // unrouted) instead of @example.com (an IANA-reserved real domain that
  // could trigger noise in any real-time email-verification check
  // upstream). Same convention as audit-log/export/route.test.ts.
  const email = `e2e-onboarding-${Date.now()}@example.test`;
  const password = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`seedTestAllocator failed: ${error?.message ?? "no user"}`);
  }

  // Ensure the profile row exists. The signup trigger normally handles
  // this, but tests should not race the trigger — make the dependency
  // explicit so the spec is rerun-safe even if the trigger is dropped
  // in a future migration.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      { id: data.user.id, display_name: email },
      { onConflict: "id" },
    );
  if (profileError) {
    // Don't crash the seed — the trigger may have already created the row,
    // in which case the upsert with the new display_name is a non-issue.
    // Log loudly so a real RLS/grant problem surfaces in CI.
    console.warn(
      `[seed-test-project] profile upsert warning: ${profileError.message}`,
    );
  }

  return { userId: data.user.id, email, password };
}

export interface SeededStrategy {
  strategyId: string;
  ownerUserId: string;
}

/**
 * Insert a placeholder published strategy that the Scenario tab can
 * pick up as a Bridge candidate.
 *
 * The strategies table requires `user_id` (FK to profiles), `name`,
 * and a `status` from the enum {'draft','pending_review','published',
 * 'archived'} (migration 001:47-67). All other columns have safe
 * defaults. We seed a separate "bridge owner" allocator so the candidate
 * strategy is owned by a different profile from the funnel-test allocator
 * — closer to real-world conditions where the recommendation comes from
 * an external manager.
 */
export async function seedBridgeCandidate(): Promise<SeededStrategy> {
  const admin = getAdmin();

  // Create a separate "manager" user that owns the candidate strategy.
  // Phase 11 WR-05: @example.test (see seedTestAllocator note).
  const ownerEmail = `e2e-bridge-owner-${Date.now()}@example.test`;
  const { data: ownerData, error: ownerError } =
    await admin.auth.admin.createUser({
      email: ownerEmail,
      password: `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      email_confirm: true,
    });
  if (ownerError || !ownerData.user) {
    throw new Error(
      `seedBridgeCandidate (owner) failed: ${ownerError?.message ?? "no user"}`,
    );
  }

  await admin
    .from("profiles")
    .upsert(
      { id: ownerData.user.id, display_name: ownerEmail },
      { onConflict: "id" },
    );

  const { data, error } = await admin
    .from("strategies")
    .insert({
      user_id: ownerData.user.id,
      name: `E2E Bridge Candidate ${Date.now()}`,
      status: "published",
      benchmark: "BTC",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedBridgeCandidate failed: ${error?.message}`);
  }

  return { strategyId: data.id, ownerUserId: ownerData.user.id };
}

/**
 * Phase 14b — seeds a published strategy with N days of synthetic returns
 * for the partial-data, axe, keyboard, and chart-parity Playwright specs.
 *
 * Inserts:
 *  - one owner profile (re-using the seedBridgeCandidate idiom — owner is
 *    a separate user so the strategy is "external" w.r.t. any test
 *    allocator)
 *  - one row in `strategies` with status='published'
 *  - one row in `strategy_analytics` with `computation_status='complete'`,
 *    a deterministic `returns_series` of length `days`, plus minimal
 *    scalars + JSONB blobs to drive eager panels 1-3 (and panels 4-7
 *    where the eager analytics blob is sufficient).
 *
 * Heavy series (sibling-table contract per migration 087 — daily_returns_grid,
 * exposure_series, turnover_series, rolling_*_series, log_returns_series)
 * are NOT seeded here. Lazy panels 4-7 fall through to their empty-payload
 * sub-banners gracefully — that's the partial-data path the spec asserts.
 *
 * Returns the strategy id. Cleanup is the caller's responsibility (mirrors
 * seedBridgeCandidate's leave-it-around behaviour; a dedicated cron / manual
 * reset is the existing convention).
 *
 * Phase 14b-07 — replaces the placeholder helper that lived at the bottom
 * of e2e/strategy-v2-partial-data.spec.ts.
 */
export async function seedStrategyWithHistory(opts: {
  days: number;
  name?: string;
}): Promise<string> {
  const admin = getAdmin();

  // Owner profile — separate from any test allocator, mirrors seedBridgeCandidate.
  const ownerEmail = `e2e-strategy-v2-owner-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const { data: ownerData, error: ownerError } =
    await admin.auth.admin.createUser({
      email: ownerEmail,
      password: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      email_confirm: true,
    });
  if (ownerError || !ownerData.user) {
    throw new Error(
      `seedStrategyWithHistory (owner) failed: ${ownerError?.message ?? "no user"}`,
    );
  }
  await admin
    .from("profiles")
    .upsert(
      { id: ownerData.user.id, display_name: ownerEmail },
      { onConflict: "id" },
    );

  const name = opts.name ?? `Phase 14b ${opts.days}d fixture`;
  const startDate = new Date(Date.now() - opts.days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // 1. Insert strategies row. NOTE — there is no `slug` column on the
  // production strategies schema (verified via migration 001:47-67). Other
  // text-array columns default to '{}' and DECIMAL fields are nullable, so
  // we keep the payload minimal and let server defaults fill the rest.
  const { data: strategy, error: sErr } = await admin
    .from("strategies")
    .insert({
      user_id: ownerData.user.id,
      name,
      status: "published",
      benchmark: "BTC",
      start_date: startDate,
      supported_exchanges: ["binance"],
      strategy_types: ["spot"],
      subtypes: [],
      markets: ["BTC"],
    })
    .select("id")
    .single();
  if (sErr || !strategy) {
    throw new Error(`seedStrategyWithHistory failed: ${sErr?.message}`);
  }

  // 2. Synthesize a deterministic returns_series of `days` length.
  // Small drift via sin() so the curve isn't flat — drives the equity chart
  // through enough variation to render meaningfully without random noise.
  const series = Array.from({ length: opts.days }, (_, i) => ({
    date: new Date(Date.now() - (opts.days - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value: 1 + Math.sin(i / 30) * 0.05 * (i / Math.max(1, opts.days)),
  }));

  // 3. Build a minimal monthly_returns grid (used by Panel 4 + Yearly view)
  //    only when we have enough data.
  function buildMonthlyReturns(
    s: { date: string; value: number }[],
  ): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    for (const p of s) {
      const yr = p.date.slice(0, 4);
      const mo = months[parseInt(p.date.slice(5, 7), 10) - 1];
      if (!out[yr]) out[yr] = {};
      // Last value of the month wins. Test fixture, not production accuracy.
      out[yr][mo] = (p.value - 1) / Math.max(1, s.indexOf(p));
    }
    return out;
  }

  // 4. Insert strategy_analytics row.
  const tradeMetrics =
    opts.days >= 30
      ? {
          total_positions: 50,
          open_positions: 5,
          closed_positions: 45,
          win_rate: 0.6,
          avg_roi: 0.05,
          avg_duration_days: 3,
          long_count: 30,
          short_count: 20,
          best_trade_roi: 0.15,
          worst_trade_roi: -0.08,
          expectancy: 0.02,
          risk_reward_ratio: 1.5,
          weighted_risk_reward_ratio: 1.4,
          sqn: 1.6,
          profit_factor_long: 1.7,
          profit_factor_short: 1.3,
          gross_volume_usd: 1_000_000,
          mean_trade_size_usd: 20_000,
          daily_turnover_usd: 50_000,
          monthly_turnover_usd: 1_500_000,
          payoff_ratio: 1.4,
          profit_factor: 1.5,
          winners_count: 30,
          losers_count: 15,
          trade_mix: {
            long: {
              count: 30,
              total_notional: 600_000,
              avg_holding_period_hours: 72,
            },
            short: {
              count: 20,
              total_notional: 400_000,
              avg_holding_period_hours: 48,
            },
          },
        }
      : null;

  const rollingMetrics =
    opts.days >= 90
      ? {
          sharpe_90d: series.slice(-90).map((p, i) => ({
            date: p.date,
            value: 1.0 + i * 0.001,
          })),
        }
      : null;

  const { error: aErr } = await admin.from("strategy_analytics").insert({
    strategy_id: strategy.id,
    computation_status: "complete",
    benchmark: "BTC",
    returns_series: series,
    cumulative_return: series[series.length - 1].value - 1,
    cagr: 0.12,
    sharpe: 1.4,
    sortino: 1.8,
    max_drawdown: -0.08,
    volatility: 0.18,
    rolling_metrics: rollingMetrics,
    monthly_returns: opts.days >= 30 ? buildMonthlyReturns(series) : null,
    return_quantiles: null,
    trade_metrics: tradeMetrics,
    metrics_json: {
      benchmark_returns:
        opts.days >= 30
          ? series.map((p) => ({ date: p.date, value: p.value * 0.95 }))
          : null,
      alpha: 0.03,
      beta: 0.85,
      information_ratio: 0.7,
      treynor_ratio: 0.04,
    },
  });
  if (aErr) {
    throw new Error(`seedStrategyWithHistory analytics failed: ${aErr.message}`);
  }

  return strategy.id;
}
