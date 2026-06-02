import { z } from "zod";

// ============================================================================
// B8 — Closed-Set Discipline registry
//
// Single source of truth for the project's closed string sets and magnitude
// caps. B1 brands VALUES (money units); this module brands SETS and CAPS.
// A closed set declared here once cannot be silently re-widened at a consuming
// layer (a `field`/`side`/`role`/`exchange` typo, a drifted cap copy), and
// there is exactly one place to read each magnitude bound.
//
// Composite-key shapes live in the sibling module keys.ts.
// Python mirror to land separately as B8b: analytics-service/services/closed_sets.py
// (TRADE_SIDES, STABLECOINS, perp_quote).
//
// This module imports ONLY zod. Do not import from constants.ts / utils.ts /
// preferences.ts here — those modules re-export FROM this one, so importing
// back would create a cycle.
// ============================================================================

// --- Exchange allowlist (value-space A: user-verifiable exchanges) ----------
// LOWERCASE is the canonical wire/DB/Python form: every SQL CHECK constraint
// (api_keys.exchange, position_snapshots, the strategies.source exchange
// subset) and every Python `Literal` stores lowercase. Display labels are
// DERIVED below — never hand-maintained.
//
// NOTE: this set is deliberately NARROWER than the ccxt PROVIDER set. The
// worker (analytics-service/services/exchange.py EXCHANGE_CLASSES) adds deribit,
// and the allocator badge map (AllocatorExchangeManager EXCHANGE_TAGS) adds
// deribit/kraken/coinbase — providers a user can hold positions on but cannot
// publish a verified strategy from. Do NOT collapse that wider set into this one.
export const SUPPORTED_EXCHANGES = ["binance", "okx", "bybit"] as const;
export type SupportedExchange = (typeof SUPPORTED_EXCHANGES)[number];
export const exchangeEnum = z.enum(SUPPORTED_EXCHANGES);

/**
 * Lowercase code → display label. The `satisfies Record<SupportedExchange,…>`
 * makes a missing label a COMPILE error, so a new exchange code physically
 * cannot ship without a display label.
 */
export const EXCHANGE_DISPLAY = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
} as const satisfies Record<SupportedExchange, string>;
export type ExchangeDisplay = (typeof EXCHANGE_DISPLAY)[SupportedExchange];

/**
 * Display-case allowlist used by the UI chip groups. DERIVED from
 * SUPPORTED_EXCHANGES (the single base) so the two casings cannot drift.
 * `(typeof EXCHANGES)[number]` is the `ExchangeDisplay` union, preserving the
 * literal-narrowing that existing consumers (e.g. MandateForm) rely on.
 */
export const EXCHANGES: readonly ExchangeDisplay[] = SUPPORTED_EXCHANGES.map(
  (code) => EXCHANGE_DISPLAY[code],
);

/** Case-insensitive membership against the user exchange allowlist. */
export function isSupportedExchange(value: string): boolean {
  return (SUPPORTED_EXCHANGES as readonly string[]).includes(value.toLowerCase());
}

// --- Self-editable preference fields ---------------------------------------
// Canonical definition lives here; re-exported from @/lib/preferences so the
// existing importers (useMandateAutoSave, preferences.test, route comments)
// keep their import path unchanged.

/** Fields a regular allocator can write to about themselves. */
export const SELF_EDITABLE_PREFERENCE_FIELDS = [
  "mandate_archetype",
  "target_ticket_size_usd",
  "excluded_exchanges",
  // Phase 2 promotions (D-03, D-06, D-07)
  "max_weight",
  "preferred_strategy_types",
  "correlation_ceiling",
  "max_drawdown_tolerance",
  "liquidity_preference",
  "style_exclusions",
] as const;

/** Fields only the admin (founder) can write to about another user. */
export const ADMIN_ONLY_PREFERENCE_FIELDS = [
  "min_track_record_days",
  "min_sharpe",
  "max_aum_concentration",
  "preferred_markets",
  "founder_notes",
] as const;

// --- Liquidity preference enum ---------------------------------------------
export const LIQUIDITY_PREFERENCES = ["high", "medium", "low"] as const;

// --- strategy_analytics.computation_status closed set ----------------------
// SoT for the strategy_analytics.computation_status column. The analytics
// worker writes 'complete_with_warnings' when a computation SUCCEEDS but used a
// consumer-specific fallback (used_heuristic_capital / balance_error —
// analytics_runner.py:1765); the frontend read-gates (B3) admit it; and the DB
// CHECK permits exactly this set (supabase/migrations/
// 20260602120000_strategy_analytics_computation_status_add_complete_with_warnings.sql).
// 'stale' is deliberately ABSENT — it was never a valid status (the #399 cron
// bug). Pinned against the DB CHECK by check-zod-db-check-parity.test.ts.
//
// DISTINCT from portfolio_analytics.computation_status (a DIFFERENT table whose
// 4-value CHECK has no 'complete_with_warnings' — see portfolio-analytics-
// adapter.ts COMPUTATION_STATUSES). Do not conflate the two.
//
// SURFACING CAVEAT (red-team 2026-06-02): the CHECK widening prevents the latent
// 23514 that would reject the worker's whole metrics upsert on the warnings path
// (its proven value). It does NOT by itself make 'complete_with_warnings' surface
// end-to-end: on the compute-jobs QUEUE path the 038 RPC
// sync_strategy_analytics_status clobbers it back to 'complete' when all jobs
// finish, and two consumer gates still exact-match 'complete' (queries.ts:667
// getStrategyV2Panels; admin/strategy-review/route.ts:148). Completing that
// surfacing (RPC-preserve + a shared isComputedAnalytics() gate) is a tracked
// B3-completion follow-up, OUT of B9's boundary-parity scope.
export const STRATEGY_ANALYTICS_COMPUTATION_STATUSES = [
  "pending",
  "computing",
  "complete",
  "complete_with_warnings",
  "failed",
] as const;
export type StrategyAnalyticsComputationStatus =
  (typeof STRATEGY_ANALYTICS_COMPUTATION_STATUSES)[number];

// --- Signup roles (SECURITY BOUNDARY) --------------------------------------
// SECURITY BOUNDARY (NEW-C15-05): the AUTHORITATIVE allowlist for the role a
// new user receives is the SQL trigger handle_new_user
// (supabase/migrations/20260520222848_lock_profile_role_at_signup.sql:84-89),
// which reads attacker-controlled `raw_user_meta_data->>'role'`, accepts
// EXACTLY these three values, and fail-CLOSES to 'manager' for anything else.
// The profiles.role column CHECK (initial_schema.sql:12) and this TS set
// mirror it. DO NOT widen this set to add an internal/elevated value such as
// 'admin' — that is a privilege class governed by user_app_roles (a SEPARATE
// closed set in src/lib/auth), never by signup metadata. Regression guard:
// supabase/tests/test_handle_new_user_role_allowlist.sql.
export const SIGNUP_ROLES = ["manager", "allocator", "both"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

// --- Magnitude / length caps -----------------------------------------------
// One declaration per cap. Replaces the hand-copied "mirrors preferences.ts:NNN"
// constants previously duplicated across partner-import / csv-finalize /
// finalize-wizard / CsvUploadStep / preferences.
export const MAGNITUDE_CAPS = {
  /** strategy_name + display chip names. */
  MAX_NAME_CHARS: 80,
  /** mandate_archetype free text. */
  MAX_MANDATE_CHARS: 500,
  /** strategy description free text. */
  MAX_DESCRIPTION_CHARS: 5000,
  /** founder_notes (admin-only). */
  MAX_FOUNDER_NOTES_CHARS: 10_000,
  /** target_ticket_size_usd upper bound. */
  MAX_TICKET_SIZE_USD: 1_000_000_000,
  /** AUM / capacity dollar upper bound — DISTINCT from the ticket cap (1e12 vs 1e9). */
  MAX_DOLLAR_VALUE_USD: 1_000_000_000_000,
  /** excluded_exchanges array length. */
  MAX_EXCLUDED_EXCHANGES_COUNT: 100,
  /** excluded_exchanges per-element length (defense; the allowlist is the real gate). */
  MAX_EXCLUDED_EXCHANGE_LENGTH: 100,
} as const;
