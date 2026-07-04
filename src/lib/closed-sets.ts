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
// allocator badge map (AllocatorExchangeManager EXCHANGE_TAGS) adds
// kraken/coinbase — providers a user can hold positions on but cannot
// publish a verified strategy from. Do NOT collapse that wider set into this one.
//
// KEY-SAVING BOUNDARY (Phase 68, DRB-02): this is the closed-set allowlist a
// key-save request must clear at the TS layer, in lockstep with the pydantic
// Literals (schemas.py / debug_key_flow.py / adapter.py) and the SQL CHECK
// constraints (api_keys_exchange_check et al.). "deribit" was added here so a
// deribit key clears the allowlist; the FUNDING and USER-FACING UI surfaces are
// DECOUPLED below (FUNDING_EXCHANGES / UI_EXCHANGE_CODES) and stay 3-exchange —
// widening this base MUST NOT auto-widen those (OQ4 gate + Pitfall 2).
export const SUPPORTED_EXCHANGES = ["binance", "okx", "bybit", "deribit"] as const;
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
  deribit: "Deribit",
} as const satisfies Record<SupportedExchange, string>;
export type ExchangeDisplay = (typeof EXCHANGE_DISPLAY)[SupportedExchange];

/**
 * User-facing "offered" exchange codes — the set the public/marketing surfaces
 * and the public VerificationForm dropdown may present. DECOUPLED from
 * SUPPORTED_EXCHANGES on purpose (OQ4 gate): the key-save boundary admits
 * deribit, but a user is not OFFERED deribit until Phase 69 ships the wizard
 * card + the /security#deribit-readonly scope guide. Do NOT derive this from
 * SUPPORTED_EXCHANGES — Phase 69 flips this const consciously.
 */
export const UI_EXCHANGE_CODES = [
  "binance",
  "okx",
  "bybit",
] as const satisfies readonly SupportedExchange[];

/**
 * Funding/reconcile-eligible exchange codes — the TS mirror of the SQL
 * `funding_fees_exchange_check` and `_FUNDING_BUCKET_HOURS` (funding_fetch.py)
 * both staying 3-exchange. DECOUPLED from SUPPORTED_EXCHANGES (Pitfall 2): a
 * saved deribit key must NOT be enrolled into the sync-funding / reconcile
 * crons, or every run would hit `funding_fetch.py raise ValueError`. Phase 70
 * flips this TOGETHER with the SQL CHECK and a native-id/exact-ts dedup axis
 * (BYB-02 — Deribit funding is continuous; a floor bucket would collapse
 * distinct events). Do NOT derive from SUPPORTED_EXCHANGES.
 */
export const FUNDING_EXCHANGES = [
  "binance",
  "okx",
  "bybit",
] as const satisfies readonly SupportedExchange[];

/**
 * Display-case allowlist used by the UI chip groups. DERIVED from
 * UI_EXCHANGE_CODES (the user-facing 3-value set — NOT the widened
 * SUPPORTED_EXCHANGES) through EXCHANGE_DISPLAY so casing cannot drift. This
 * keeps the marketing "{EXCHANGES.length} exchanges supported" count at 3 and
 * every chip surface (MandateForm/StrategyFilters/PreferencesPanel/ApiKeyForm/
 * StrategyForm/MetadataStep) 3-exchange with zero edits to those files (OQ4).
 * `(typeof EXCHANGES)[number]` stays the `ExchangeDisplay` union — the TYPE now
 * admits "Deribit" (ExchangeDisplay widened) while the runtime array is the
 * 3-value UI-offered set. Literal-narrowing consumers (e.g. MandateForm) unaffected.
 */
export const EXCHANGES: readonly ExchangeDisplay[] = UI_EXCHANGE_CODES.map(
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
// M-0548: derive the type from the const so the AllocatorPreferences interface,
// the validator, and the DB CHECK all trace to this single source of truth
// (same `(typeof X)[number]` pattern as SupportedExchange above). Adding a tier
// here widens the interface union automatically instead of drifting from a
// hand-maintained copy. (Lane-2 component copies — MandateTabPanel, MandateForm,
// mandate-gates, MandateSegmentedRadio — remain; a follow-up can point them here.)
export type LiquidityPreference = (typeof LIQUIDITY_PREFERENCES)[number];

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
