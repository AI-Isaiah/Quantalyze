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

/**
 * Build a collision-resistant unique suffix. `Date.now()` collides at
 * millisecond granularity when parallel beforeAll seeds fire in the same
 * tick; the random part eliminates the burst. Helper exists because the
 * same pattern appears 6× across the email + password generators below
 * (audit-2026-05-07 red-team `parallel-seed-burst`).
 */
function uniqueSuffix(randLen: number): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 2 + randLen)}`;
}

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
  //
  // audit-2026-05-07 red-team `parallel-seed-burst` — append a random
  // suffix so two seedTestAllocator() calls in the same millisecond
  // (e.g. parallel beforeAll seeds across workers) don't collide on
  // the unique email constraint. The password helper already uses
  // Math.random; align the email to the same idiom.
  const email = `e2e-onboarding-${uniqueSuffix(6)}@example.test`;
  const password = `e2e-${uniqueSuffix(8)}`;
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
  // in a future migration. role='allocator' so the Profile > Security
  // tab actually renders (ProfileTabs.tsx:114 gates
  // `activeTab === "security" && isAllocator` where
  // `isAllocator = role === 'allocator' || role === 'both'`). Migration
  // 001 default is `manager`, so the upsert must be explicit.
  //
  // profiles + investor_attestations are independent (different tables,
  // no cross-dependency). Run in parallel so each seeded test setup costs
  // one round-trip instead of two — saves ~80ms per spec × 6 seed-gated
  // specs ≈ 480ms per CI run.
  const [profileRes, attestationRes] = await Promise.all([
    admin
      .from("profiles")
      .upsert(
        {
          id: data.user.id,
          display_name: email,
          role: "allocator",
          // v0.24.5.18 universal approval gate (src/lib/approval.ts):
          // every dashboard route redirects un-verified profiles to
          // /pending-approval. Seeded test users would otherwise hit
          // that gate before any spec assertion runs. Stamp them as
          // verified at seed time so /discovery/* and other dashboard
          // routes render. Both fields are set even though only the
          // role-matching field gates — defense against a future seed
          // call that flips role to 'both' (which requires BOTH sides
          // verified per isProfileApproved's truth table).
          allocator_status: "verified",
          manager_status: "verified",
        },
        { onConflict: "id" },
      ),
    // Stamp an investor_attestations row so the seeded user clears the
    // accredited-investor gate at src/app/(dashboard)/discovery/layout.tsx
    // (and any sibling gate that checks the same table). Without this,
    // every seeded user lands on the gate component instead of the
    // requested page — discovery-axe + discovery-prefs-isolation specs
    // both regressed on this in PR #108 review.
    admin
      .from("investor_attestations")
      .upsert(
        {
          user_id: data.user.id,
          attested_at: new Date().toISOString(),
          version: "e2e-seed",
          ip_address: null,
        },
        { onConflict: "user_id" },
      ),
  ]);
  if (profileRes.error) {
    // Don't crash the seed — the trigger may have already created the row,
    // in which case the upsert with the new display_name is a non-issue.
    // Log loudly so a real RLS/grant problem surfaces in CI.
    console.warn(
      `[seed-test-project] profile upsert warning: ${profileRes.error.message}`,
    );
  }
  if (attestationRes.error) {
    console.warn(
      `[seed-test-project] attestation upsert warning: ${attestationRes.error.message}`,
    );
  }

  return { userId: data.user.id, email, password };
}

export interface SeededStrategy {
  strategyId: string;
  ownerUserId: string;
  categoryId: string | null;
  categorySlug: string | null;
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
 *
 * audit-2026-05-07 SPECIALIST-red-team
 * `e2e/discovery-watchlist.spec.ts:110:red-team:seed-strategy-missing-category` —
 * `getStrategiesByCategory()` (src/lib/queries.ts:196-205) filters via
 * a PostgREST `discovery_categories!inner(slug)` inner-join, so a
 * strategy with `category_id = NULL` NEVER appears on
 * `/discovery/<slug>`. The Phase-2 fix that added this helper to the
 * watchlist spec's `beforeAll` made the strategy invisible on
 * `/discovery/crypto-sma`, which silently re-relocated the happy-path
 * failure from a skip to a 30s star-button timeout, and structurally
 * disabled the RLS-leak detector. Accept an optional `categorySlug`
 * and resolve `category_id` from `discovery_categories.slug` BEFORE
 * the insert so the seeded strategy is actually queryable on the
 * category page.
 */
export async function seedBridgeCandidate(opts?: {
  categorySlug?: string;
}): Promise<SeededStrategy> {
  const admin = getAdmin();

  // Resolve category_id from slug if requested. The discovery_categories
  // rows are seeded by migration 20260405061911_initial_schema.sql:147
  // and `crypto-sma` is the default test category. Pull the id before
  // the strategy insert so the join-bound `getStrategiesByCategory()`
  // path renders the row instead of empty-state.
  let categoryId: string | null = null;
  let categorySlug: string | null = null;
  if (opts?.categorySlug) {
    const { data: cat, error: catErr } = await admin
      .from("discovery_categories")
      .select("id, slug")
      .eq("slug", opts.categorySlug)
      .single();
    if (catErr || !cat) {
      throw new Error(
        `seedBridgeCandidate: discovery_categories slug="${opts.categorySlug}" not found — ${catErr?.message ?? "no row"}`,
      );
    }
    categoryId = cat.id as string;
    categorySlug = cat.slug as string;
  }

  // Create a separate "manager" user that owns the candidate strategy.
  // Phase 11 WR-05: @example.test (see seedTestAllocator note).
  // audit-2026-05-07 red-team `parallel-seed-burst` — append a random
  // suffix to Date.now() so two seedTestAllocator/seedBridgeCandidate
  // calls in the same millisecond don't collide on the unique email
  // constraint (Supabase admin.createUser returns 409). The password
  // already uses Math.random; align the email to the same idiom.
  const ownerEmail = `e2e-bridge-owner-${uniqueSuffix(6)}@example.test`;
  const { data: ownerData, error: ownerError } =
    await admin.auth.admin.createUser({
      email: ownerEmail,
      password: `bridge-${uniqueSuffix(8)}`,
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

  const insertPayload: Record<string, unknown> = {
    user_id: ownerData.user.id,
    name: `E2E Bridge Candidate ${Date.now()}`,
    status: "published",
    benchmark: "BTC",
  };
  if (categoryId) insertPayload.category_id = categoryId;

  const { data, error } = await admin
    .from("strategies")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedBridgeCandidate failed: ${error?.message}`);
  }

  return {
    strategyId: data.id,
    ownerUserId: ownerData.user.id,
    categoryId,
    categorySlug,
  };
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
  const ownerEmail = `e2e-strategy-v2-owner-${uniqueSuffix(6)}@example.test`;
  const { data: ownerData, error: ownerError } =
    await admin.auth.admin.createUser({
      email: ownerEmail,
      password: `seed-${uniqueSuffix(8)}`,
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
          mean_daily_turnover_usd: 50_000,
          mean_monthly_turnover_usd: 1_500_000,
          payoff_ratio: 1.4,
          profit_factor: 1.5,
          winners_count: 30,
          losers_count: 15,
          trade_mix: {
            long: { count: 30, total_notional: 600_000 },
            short: { count: 20, total_notional: 400_000 },
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
      // panel2Equity.btc_overlay reads metrics_json.btc_benchmark_returns,
      // not metrics_json.benchmark_returns — both keys must be populated or
      // the BTC overlay (and its associated checkbox) is suppressed.
      btc_benchmark_returns:
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

/**
 * Phase 48 / CHART-01b — seed a minimal connected BOOK (one active api_key +
 * one holding + a daily equity curve) for an EXISTING allocator so the
 * `/allocations` Overview tab mounts the hand-rolled `<svg aria-label="Equity
 * chart">` (EquityChart) instead of the EmptyState "connect an exchange"
 * branch.
 *
 * WHY this is needed (vs. seedTestAllocator alone): AllocationDashboardV2
 * short-circuits to EmptyState when `holdingsEmpty` (zero allocator_holdings),
 * and the equity series only renders past that gate. The EquityChart svg
 * mounts ONLY on the Overview tab (the composer swapped to ScenarioFactsheetChart
 * in Phase 38-03), so target-size's EquityChart case must seed a real book.
 *
 * SCHEMA (verified against migrations):
 *   - api_keys (initial_schema): user_id, exchange, label, api_key_encrypted
 *     NOT NULL; encryption is an APPLICATION-layer concern, no DB INSERT trigger
 *     rejects placeholder ciphertext — the service-role admin client writes it
 *     directly (the read-only-permission rejection is enforced at the wizard
 *     submission path, not at INSERT). is_active defaults true.
 *   - allocator_holdings (20260420073003): api_key_id NOT NULL → the key above;
 *     an enforce_allocator_holdings_owner_coherence trigger asserts
 *     allocator_id === api_keys.user_id, so both use the SAME allocatorUserId.
 *   - allocator_equity_snapshots (20260420213754): allocator_id + asof +
 *     value_usd NOT NULL; pre_terminus_balance_unknown omitted (NULL = trusted),
 *     source defaults 'exchange_primary'. The dashboard reads these directly
 *     (RLS owner-select on allocator_id = auth.uid()).
 *
 * Deterministic curve (no RNG) so the chart renders meaningful variation
 * without flakiness — same sin()-drift idiom as seedStrategyWithHistory.
 */
export async function seedAllocatorBook(opts: {
  allocatorUserId: string;
  days?: number;
}): Promise<{ apiKeyId: string }> {
  const admin = getAdmin();
  const days = opts.days ?? 120;

  // 1. Active api_key (placeholder ciphertext — no DB-level validation trigger).
  const { data: key, error: kErr } = await admin
    .from("api_keys")
    .insert({
      user_id: opts.allocatorUserId,
      exchange: "binance",
      label: `e2e-equitychart-book-${uniqueSuffix(6)}`,
      api_key_encrypted: "e2e-placeholder-ciphertext",
      is_active: true,
    })
    .select("id")
    .single();
  if (kErr || !key) {
    throw new Error(`seedAllocatorBook (api_key) failed: ${kErr?.message}`);
  }

  // 2. One spot holding so holdingsEmpty === false (clears the EmptyState gate).
  //    allocator_id MUST equal api_keys.user_id (owner-coherence trigger).
  const asofToday = new Date().toISOString().slice(0, 10);
  const { error: hErr } = await admin.from("allocator_holdings").insert({
    allocator_id: opts.allocatorUserId,
    api_key_id: key.id,
    venue: "binance",
    symbol: "BTC",
    asof: asofToday,
    holding_type: "spot",
    side: "long",
    quantity: 1,
    value_usd: 100_000,
    mark_price: 100_000,
  });
  if (hErr) {
    throw new Error(`seedAllocatorBook (holding) failed: ${hErr.message}`);
  }

  // 3. A daily equity curve so EquityChart has a real series to draw.
  const snapshots = Array.from({ length: days }, (_, i) => ({
    allocator_id: opts.allocatorUserId,
    asof: new Date(Date.now() - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value_usd: 100_000 * (1 + Math.sin(i / 30) * 0.08 * (i / Math.max(1, days))),
  }));
  const { error: sErr } = await admin
    .from("allocator_equity_snapshots")
    .upsert(snapshots, { onConflict: "allocator_id,asof" });
  if (sErr) {
    throw new Error(`seedAllocatorBook (equity snapshots) failed: ${sErr.message}`);
  }

  return { apiKeyId: key.id };
}
