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
import "./node-websocket-polyfill"; // must precede any createClient() (Node 20 WebSocket shim)
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
 *    where the eager analytics blob is sufficient); optionally
 *    `daily_returns` when `withDailyReturns: true` (Phase 60).
 *
 * Heavy series (sibling-table contract per migration 087 — daily_returns_grid,
 * exposure_series, turnover_series, rolling_*_series, log_returns_series)
 * are NOT seeded here. (`daily_returns` — the analytics COLUMN, distinct from
 * the `daily_returns_grid` sibling table — IS seedable via the opt-in above.)
 * Lazy panels 4-7 fall through to their empty-payload
 * sub-banners gracefully — that's the partial-data path the spec asserts.
 *
 * Returns the strategy id. Cleanup is the caller's responsibility (mirrors
 * seedBridgeCandidate's leave-it-around behaviour; a dedicated cron / manual
 * reset is the existing convention).
 *
 * Phase 14b-07 — replaces the placeholder helper that lived at the bottom
 * of e2e/strategy-v2-partial-data.spec.ts.
 */
/**
 * Phase 60 — best-effort garbage collection for a spec's OWN leave-around
 * fixtures. The shared test project accumulates seeded strategies (5,153
 * published rows as of 2026-07-02) because "cleanup is the caller's
 * responsibility" and no caller cleans; the browse route caps its catalog at
 * 200 rows ordered by raw name, so a spec that must FIND its own fixture must
 * both (a) name it to sort inside the cap and (b) stop its own prefix niche
 * from silting up. Deletes strategies whose raw `name` starts with `prefix`
 * (strategy_analytics cascades via FK). Best-effort: a failure logs and
 * returns — stale rows degrade nothing when the caller uses unique names.
 */
export async function cleanupStrategiesByNamePrefix(
  prefix: string,
): Promise<void> {
  const admin = getAdmin();
  const { error } = await admin
    .from("strategies")
    .delete()
    .like("name", `${prefix}%`);
  if (error) {
    console.warn(
      `[seed] cleanupStrategiesByNamePrefix("${prefix}") failed (non-fatal): ${error.message}`,
    );
  }
}

export async function seedStrategyWithHistory(opts: {
  days: number;
  name?: string;
  /**
   * Anchor (end) of the synthesized date window, in epoch ms. Defaults to
   * `Date.now()` — byte-identical for every existing caller. Pass a FIXED
   * timestamp when the rendered output is screenshot-compared (svg-chart-parity
   * goldens): time-relative dates make the year-bucketed panels (daily-return
   * heatmap, end-of-year bars) and the benchmark-correlation window slide every
   * day, so the goldens would drift. Pin it INSIDE the bundled benchmark fixture
   * coverage (src/lib/factsheet/data/*-daily.json, ~2023-04-26 → 2026-05-12) so
   * the Pearson ρ panels stay finite — outside it, alignReturns forward-fills a
   * constant close → zero variance → NaN ρ → the correlation panels render null.
   */
  anchorMs?: number;
  /**
   * Phase 60 — optional pseudonym written to `strategies.codename`. The seed
   * leaves `disclosure_tier` at its DB default ('exploratory'), and every
   * exploratory surface (browse drawer, match queue) masks the raw `name`
   * behind `displayStrategyName` — codename if present, else a synthetic
   * `Strategy #<id-prefix>` (T12 pseudonymity). A spec that must FIND its own
   * fixture by text (drawer search matches wire name + codename only) needs a
   * codename; searching the raw seeded name can never match.
   */
  codename?: string;
  /**
   * Phase 60 (VERIFY-01) — also write `strategy_analytics.daily_returns`.
   * The scenario composer lazy-fetches GET /api/strategies/[id]/returns,
   * which serves EXACTLY this column; without it every seeded strategy has an
   * empty series → no coverage span → `windowBounds` is null → the whole
   * Phase-58 coverage surface (window control, BlendHeader, CoverageTimeline)
   * deterministically never mounts. OPT-IN so the svg-chart-parity /
   * strategy-v2 golden fixtures (which share this helper) stay byte-identical.
   */
  withDailyReturns?: boolean;
}): Promise<string> {
  const admin = getAdmin();
  // Date anchor — see `anchorMs` doc above. Default keeps the historical
  // time-relative behaviour for the non-screenshot callers.
  const anchorMs = opts.anchorMs ?? Date.now();

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
  const startDate = new Date(anchorMs - opts.days * 86_400_000)
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
      ...(opts.codename ? { codename: opts.codename } : {}),
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
    date: new Date(anchorMs - (opts.days - i) * 86_400_000)
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

  // Phase 60 — deterministic small daily returns on the same date axis as
  // `returns_series` (sin-based, finite, no RNG). Shape matches DailyPoint
  // ({date, value}) as normalizeDailyReturns expects on the returns route.
  const dailyReturns = opts.withDailyReturns
    ? series.map((p, i) => ({
        date: p.date,
        value: Math.sin(i / 15) * 0.01,
      }))
    : null;

  const { error: aErr } = await admin.from("strategy_analytics").insert({
    strategy_id: strategy.id,
    computation_status: "complete",
    benchmark: "BTC",
    returns_series: series,
    ...(dailyReturns ? { daily_returns: dailyReturns } : {}),
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

// ---------------------------------------------------------------------------
// Phase 91 / Plan 91-02 (QA-02, QA-03, CONTEXT D2) — the ONE composite fixture.
// ---------------------------------------------------------------------------

/**
 * The seven guaranteed by-basis headline serverKeys (BASIS_KPI_MAP in
 * src/lib/factsheet/basis-metrics.ts:18-26). `hasBasisHeadline`
 * (basis-metrics.ts:88-94) requires EVERY one of these structurally present AND
 * a FINITE `cumulative_return`; if any is missing the factsheet headline gate at
 * composite-read-path.ts:87 refuses to render (returns null → placeholder). The
 * cash object below therefore carries all seven, all finite.
 */
const ZAVARA_CUM_RETURN = 0.6266; // Phase-86 headline (the render spec asserts this)
const ZAVARA_MAX_DRAWDOWN = -0.0413; // Phase-86 maxDD (the render spec asserts this)

// Cash-settlement basis (the mainline). All seven BASIS_KPI_MAP serverKeys,
// finite — satisfies composite-read-path.ts:87.
const CASH_BASIS_SCALARS: Record<string, number> = {
  cumulative_return: ZAVARA_CUM_RETURN,
  volatility: 0.113,
  max_drawdown: ZAVARA_MAX_DRAWDOWN,
  cagr: 0.412,
  sharpe: 2.08,
  sortino: 2.96,
  calmar: 9.97,
};

// Mark-to-market basis (mtm:"available"). Deliberately DIFFERENT values so
// 91-04 can prove the basis toggle actually swaps the displayed scalars.
const MTM_BASIS_SCALARS: Record<string, number> = {
  cumulative_return: 0.6189,
  volatility: 0.129,
  max_drawdown: -0.0472,
  cagr: 0.4051,
  sharpe: 1.94,
  sortino: 2.77,
  calmar: 8.58,
};

// The clean 3-key sequential-handoff windows (keyWindowsSchema.test.ts:145-153):
// adjacent half-open boundaries (prev.window_end === next.window_start), the
// LAST window open-ended (window_end null).
const COMPOSITE_WINDOWS: { seq: number; start: string; end: string | null }[] = [
  { seq: 1, start: "2025-01-01", end: "2025-01-11" },
  { seq: 2, start: "2025-01-11", end: "2025-01-21" },
  { seq: 3, start: "2025-01-21", end: null },
];
// One HONEST interior gap span — these two days are ABSENT from the sparse
// series (never zero-filled), matching gap_spans in the coverage mask.
const COMPOSITE_GAP_DAYS = new Set(["2025-01-06", "2025-01-07"]);
// Exclusive upper bound for the last (open-ended) window's synthesized coverage.
const COMPOSITE_SERIES_END_EXCLUSIVE = "2025-01-31"; // last covered day 2025-01-30

/** Enumerate [startInclusive, endExclusive) as YYYY-MM-DD strings (UTC). */
function eachUtcDay(startInclusive: string, endExclusive: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startInclusive}T00:00:00Z`);
  const end = new Date(`${endExclusive}T00:00:00Z`);
  while (cur < end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Seed ONE Zavara-shaped composite strategy that satisfies BOTH composite read
 * paths from a single source of truth (CONTEXT D2, PATTERNS "Composite fixture
 * shape"):
 *
 *   1. The factsheet read path `src/lib/factsheet/composite-read-path.ts`
 *      (`readCompositeFactsheet`): reads the SPARSE `csv_daily_returns` series
 *      (gap days absent, never zero-filled), then the F1/H-1 headline gate at
 *      composite-read-path.ts:87 REFUSES to render unless the persisted
 *      `metrics_json_by_basis.cash_settlement` carries every BASIS_KPI_MAP
 *      serverKey with a finite `cumulative_return` (basis-metrics.ts:88-94).
 *      The cash object here supplies all seven with the 0.6266 / −0.0413
 *      Phase-86 headline the 91-04 render spec asserts.
 *   2. The wizard `SyncPreviewStep` poller
 *      (`SyncPreviewStep.composite.render.test.tsx`): reads the member rows
 *      (`strategy_keys` + joined `api_keys`), the coverage mask
 *      (`data_quality_flags`), the stitched series, and the analytics row
 *      (`computation_status` / `computation_error`). The `variant:"failed"`
 *      knob stamps the failed gate the #338 e2e asserts.
 *
 * This is the ONE fixture the Wave-2 specs consume (onboarding 91-03, the #338
 * failed-member 91-03 Task 2, the Zavara factsheet-render 91-04) — do NOT fork a
 * second composite seeder.
 *
 * Prod-safety: EVERY mutation routes through the single `getAdmin()` client
 * (:48-64), whose `assertNotProductionSupabaseUrl` + service-role assertions
 * fire before any write — this helper can only ever touch the TEST project. No
 * second `createClient()`. The only ciphertext-shaped literal is the existing
 * gitleaks-safe `"e2e-placeholder-ciphertext"` idiom; no real credential.
 *
 * @param opts.name    strategy name (default `e2e-composite-<suffix>`; keep the
 *                      `e2e-composite-` prefix so `cleanupStrategiesByNamePrefix`
 *                      collects it).
 * @param opts.variant `"published"` (default) → status `published`, terminal
 *                      `complete`. `"failed"` → the pre-publish `draft` status
 *                      the composite add-key route inserts (wizard_composite
 *                      migration:118) + `computation_status:"failed"` naming the
 *                      offending member (the #338 fixture; NOT published).
 * @param opts.mtm     `"available"` (default) → a complete `mark_to_market`
 *                      basis object. `"gated"` → OMIT `mark_to_market` and stamp
 *                      `data_quality_flags.mtm_gated_reason`
 *                      (`unsmoothed_options_book`, a closed-set reason key from
 *                      factsheet/types.ts:497).
 */
export async function seedCompositeStrategy(opts?: {
  name?: string;
  variant?: "published" | "failed";
  mtm?: "available" | "gated";
  ownerUserId?: string;
}): Promise<{
  strategyId: string;
  ownerUserId: string;
  memberApiKeyIds: string[];
}> {
  const admin = getAdmin();
  const variant = opts?.variant ?? "published";
  const mtm = opts?.mtm ?? "available";

  // 1. Owner user + profile — mirrors seedStrategyWithHistory:377-395.
  //    When `ownerUserId` is supplied (e.g. the logged-in allocator, whose
  //    profile seedTestAllocator already upserted) reuse it and SKIP both the
  //    createUser and the profiles upsert — the composite must be owned by that
  //    user so the RLS-bound wizard reads (strategy_keys / csv_daily_returns,
  //    owner-only, no published exemption) resolve. When absent, self-create a
  //    fresh owner (the render-spec caller relies on this).
  let ownerUserId: string;
  if (opts?.ownerUserId) {
    ownerUserId = opts.ownerUserId;
  } else {
    const ownerEmail = `e2e-composite-owner-${uniqueSuffix(6)}@example.test`;
    const { data: ownerData, error: ownerError } =
      await admin.auth.admin.createUser({
        email: ownerEmail,
        password: `composite-${uniqueSuffix(8)}`,
        email_confirm: true,
      });
    if (ownerError || !ownerData.user) {
      throw new Error(
        `[seed] seedCompositeStrategy (owner) failed: ${ownerError?.message ?? "no user"}`,
      );
    }
    ownerUserId = ownerData.user.id;
    const { error: pErr } = await admin
      .from("profiles")
      .upsert({ id: ownerUserId, display_name: ownerEmail }, { onConflict: "id" });
    if (pErr)
      throw new Error(
        `[seed] seedCompositeStrategy (profile) failed: ${pErr.message}`,
      );
  }

  // 2. strategies row. A composite carries api_key_id = NULL (the single-key
  //    link is never set — add-key/route.ts DIVERGENCE (1)). `published` for the
  //    default variant; the `failed` variant stays at the SAME pre-publish
  //    `draft` status the composite add-key RPC inserts
  //    (20260710180000_wizard_composite.sql:118) so the #338 assertion "NOT
  //    published" holds. `returns_denominator_config` left SQL NULL (geometric
  //    mainline; the render spec asserts the persisted headline, config-
  //    independent — PATTERNS §1).
  const name = opts?.name ?? `e2e-composite-${uniqueSuffix(6)}`;
  const { data: strategy, error: sErr } = await admin
    .from("strategies")
    .insert({
      user_id: ownerUserId,
      name,
      status: variant === "failed" ? "draft" : "published",
      benchmark: "BTC",
      supported_exchanges: ["deribit"],
      strategy_types: ["spot"],
      subtypes: [],
      markets: ["BTC"],
      // The `failed` variant seeds `status='draft'` data that the #338 walk polls
      // (via the stub) as its failed-gate target — it is NOT an in-progress
      // onboarding the walking user should resume. Give it `source='legacy'` (a
      // valid CHECK value: legacy/wizard/admin_import) so it stays OUT of the
      // wizard's draft-resume query — `.eq("source","wizard").eq("status","draft")`
      // in strategies/new/wizard/page.tsx:85-86 — which would otherwise hydrate
      // WizardClient's initialDraft and suppress the fresh connect step (the
      // `multi-add-key` ghost affordance), timing out the walk. The published
      // default never matches the `status='draft'` filter, so it keeps 'wizard'.
      source: variant === "failed" ? "legacy" : "wizard",
    })
    .select("id")
    .single();
  if (sErr || !strategy) {
    throw new Error(`[seed] seedCompositeStrategy (strategy) failed: ${sErr?.message}`);
  }
  const strategyId = strategy.id as string;

  // 3. THREE api_keys rows — mirrors seedAllocatorBook:600-610 exactly. The ONLY
  //    ciphertext-shaped literal is the placeholder idiom (no real credential).
  const memberApiKeyIds: string[] = [];
  const memberLabels: string[] = [];
  for (const w of COMPOSITE_WINDOWS) {
    const label = `e2e-composite-key-${w.seq}-${uniqueSuffix(6)}`;
    const { data: key, error: kErr } = await admin
      .from("api_keys")
      .insert({
        user_id: ownerUserId,
        exchange: "deribit",
        label,
        api_key_encrypted: "e2e-placeholder-ciphertext",
        is_active: true,
      })
      .select("id")
      .single();
    if (kErr || !key) {
      throw new Error(`[seed] seedCompositeStrategy (api_key seq ${w.seq}) failed: ${kErr?.message}`);
    }
    memberApiKeyIds.push(key.id as string);
    memberLabels.push(label);
  }

  // 4. THREE strategy_keys member rows — clean sequential-handoff windows
  //    (keyWindowsSchema.test.ts:145-153): adjacent half-open boundaries, last
  //    open-ended. `owner_id` is NOT NULL (strategy_keys migration:34).
  const memberRows = COMPOSITE_WINDOWS.map((w, i) => ({
    strategy_id: strategyId,
    api_key_id: memberApiKeyIds[i],
    owner_id: ownerUserId,
    window_start: w.start,
    window_end: w.end,
    seq: w.seq,
  }));
  const { error: mErr } = await admin.from("strategy_keys").insert(memberRows);
  if (mErr) {
    throw new Error(`[seed] seedCompositeStrategy (strategy_keys) failed: ${mErr.message}`);
  }

  // 5. The SPARSE honest series (csv_daily_returns): one row per covered day,
  //    gap days ABSENT (never zero-filled), spanning the three windows. Kept
  //    small (~28 rows), NOT Zavara-length — the headline the specs assert is
  //    the PERSISTED analytics row, not a recompute.
  const coveredDays = eachUtcDay(
    COMPOSITE_WINDOWS[0].start,
    COMPOSITE_SERIES_END_EXCLUSIVE,
  ).filter((d) => !COMPOSITE_GAP_DAYS.has(d));
  const csvRows = coveredDays.map((date, i) => ({
    strategy_id: strategyId,
    date,
    daily_return: Math.sin(i / 6) * 0.01, // deterministic, finite, no RNG
  }));
  const { error: cErr } = await admin
    .from("csv_daily_returns")
    .insert(csvRows);
  if (cErr) {
    throw new Error(`[seed] seedCompositeStrategy (csv_daily_returns) failed: ${cErr.message}`);
  }

  // 6. data_quality_flags coverage mask (DEFAULT_DQ shape, render test :116-125):
  //    per_key derived from the SAME covered days so it stays consistent with the
  //    sparse series; one real gap span + matching gap_day_count; overlap [].
  const perKey = COMPOSITE_WINDOWS.map((w) => {
    const inWindow = coveredDays.filter(
      (d) => d >= w.start && (w.end === null || d < w.end),
    );
    return {
      seq: w.seq,
      first_day: inWindow[0],
      last_day: inWindow[inWindow.length - 1],
      n_days: inWindow.length,
    };
  });
  const dataQualityFlags: Record<string, unknown> = {
    composite: true,
    per_key: perKey,
    gap_spans: [{ start: "2025-01-06", end: "2025-01-07" }],
    gap_day_count: 2,
    overlap_days: [],
  };
  if (mtm === "gated") {
    // Closed-set reason key (factsheet/types.ts:497) → the F2/M-1 MTM gate
    // renders the disabled-copy instead of an MTM basis.
    dataQualityFlags.mtm_gated_reason = "unsmoothed_options_book";
  }

  // 7. metrics_json_by_basis — a jsonb OBJECT (never JSON null; Phase-85 CHECK).
  //    cash_settlement carries every BASIS_KPI_MAP serverKey (finite) so
  //    hasBasisHeadline passes and composite-read-path.ts:87 renders. mtm
  //    "available" → also a complete mark_to_market object; "gated" → omitted.
  const metricsJsonByBasis: Record<string, Record<string, number>> = {
    cash_settlement: { ...CASH_BASIS_SCALARS },
  };
  if (mtm === "available") {
    metricsJsonByBasis.mark_to_market = { ...MTM_BASIS_SCALARS };
  }

  // 8. strategy_analytics row — mirrors defaultAnalyticsRow (render test
  //    :127-143) column-for-column. `failed` variant additionally stamps
  //    computation_status:"failed" + a computation_error NAMING the offending
  //    member (render test :423-427 shape) and the strategy stays NOT published.
  const analyticsRow: Record<string, unknown> = {
    strategy_id: strategyId,
    computation_status: variant === "failed" ? "failed" : "complete",
    cagr: CASH_BASIS_SCALARS.cagr,
    sharpe: CASH_BASIS_SCALARS.sharpe,
    sortino: CASH_BASIS_SCALARS.sortino,
    max_drawdown: ZAVARA_MAX_DRAWDOWN,
    volatility: CASH_BASIS_SCALARS.volatility,
    cumulative_return: ZAVARA_CUM_RETURN,
    sparkline_returns: [0.01, -0.02, 0.03, 0.01, -0.005, 0.015],
    metrics_json_by_basis: metricsJsonByBasis,
    data_quality_flags: dataQualityFlags,
    computed_at: "2026-07-01T00:00:00.000Z",
  };
  if (variant === "failed") {
    // Name the seq-2 member (mirrors the worker's scrubbed stamp shape) so the
    // wizard failed gate can echo the offending key label (#338).
    analyticsRow.computation_error = `${memberLabels[1]} (deribit) failed to reconstruct: upstream geo-blocked`;
  }
  const { error: aErr } = await admin
    .from("strategy_analytics")
    .insert(analyticsRow);
  if (aErr) {
    throw new Error(`[seed] seedCompositeStrategy (strategy_analytics) failed: ${aErr.message}`);
  }

  return { strategyId, ownerUserId, memberApiKeyIds };
}
