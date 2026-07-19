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
export const SUPPORTED_EXCHANGES = ["binance", "okx", "bybit", "deribit", "sfox"] as const;
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
  sfox: "sFOX",
} as const satisfies Record<SupportedExchange, string>;
export type ExchangeDisplay = (typeof EXCHANGE_DISPLAY)[SupportedExchange];

/**
 * Feature flag for the public sFOX offer (Phase 122 / SFOX-08). Strict equality
 * against the EXACT string "true" — fail-closed: "1" / "TRUE" / "on" / "" all
 * read as OFF. Next.js inlines the full static `process.env.NEXT_PUBLIC_SFOX_ENABLED`
 * member expression into the client bundle at build time, so this MUST stay a
 * single static member access (never dynamic `process.env[...]` indexing) or the
 * build-time inlining breaks and the flag reads undefined in the browser.
 *
 * DEFAULT OFF. Unlike deribit (which worked on the existing egress the moment
 * its card shipped), a sfox CONNECT needs the founder's ops FIRST: the static
 * egress deployed + whitelisted (121-03), a validated live flow (SFOX-06), and
 * active-account crawl is phase-123-gated. So the card / picker / chip offer is
 * built READY but hidden until the founder sets NEXT_PUBLIC_SFOX_ENABLED=true in
 * Vercel. The sfox provenance badge + the 3-letter SFOX tag ship UNCONDITIONALLY
 * elsewhere (122-01) — a founder-connected sfox key must render correctly before
 * this offer flag flips.
 */
export const SFOX_UI_ENABLED = process.env.NEXT_PUBLIC_SFOX_ENABLED === "true";

/**
 * User-facing "offered" exchange codes — the set the public/marketing surfaces
 * and the public VerificationForm dropdown may present. DECOUPLED from
 * SUPPORTED_EXCHANGES on purpose (OQ4 gate): the key-save boundary admitted
 * deribit in Phase 68, and Phase 69 consciously flipped this const to OFFER
 * deribit once the wizard card + the /security#deribit-readonly scope guide
 * shipped. Still NOT derived from SUPPORTED_EXCHANGES — this is a deliberate,
 * per-phase widening (FUNDING_EXCHANGES stays 3-value until Phase 70).
 *
 * Phase 122 / SFOX-08: sfox is appended ONLY when SFOX_UI_ENABLED is on (the
 * founder-gated flag above). Both the base 4-tuple and the widened 5-tuple carry
 * `as const satisfies readonly SupportedExchange[]`, so the compile-time
 * closed-set guarantee holds on each literal; the exported value is typed
 * `readonly SupportedExchange[]` and selects between them at module load. Flag
 * OFF (default) → BYTE-IDENTICAL to today's 4-tuple; every EXCHANGES-derived chip
 * surface (OQ4) and the two wizard pickers auto-widen only when the flag flips.
 */
const UI_EXCHANGE_CODES_BASE = [
  "binance",
  "okx",
  "bybit",
  "deribit",
] as const satisfies readonly SupportedExchange[];

const UI_EXCHANGE_CODES_WITH_SFOX = [
  "binance",
  "okx",
  "bybit",
  "deribit",
  "sfox",
] as const satisfies readonly SupportedExchange[];

export const UI_EXCHANGE_CODES: readonly SupportedExchange[] = SFOX_UI_ENABLED
  ? UI_EXCHANGE_CODES_WITH_SFOX
  : UI_EXCHANGE_CODES_BASE;

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
 * UI_EXCHANGE_CODES (the user-facing OFFERED set — NOT the widened
 * SUPPORTED_EXCHANGES) through EXCHANGE_DISPLAY so casing cannot drift. The
 * marketing "{EXCHANGES.length} exchanges supported" count follows the
 * UI-offered set — 4 as of the Phase-69 deribit flip — and every chip surface
 * (MandateForm/StrategyFilters/PreferencesPanel/ApiKeyForm/StrategyForm/
 * MetadataStep) auto-widens with zero edits to those files (OQ4).
 * `(typeof EXCHANGES)[number]` is the `ExchangeDisplay` union; both the type
 * and the runtime array now include "Deribit". Literal-narrowing consumers
 * (e.g. MandateForm) unaffected.
 */
export const EXCHANGES: readonly ExchangeDisplay[] = UI_EXCHANGE_CODES.map(
  (code) => EXCHANGE_DISPLAY[code],
);

/** Case-insensitive membership against the user exchange allowlist. */
export function isSupportedExchange(value: string): boolean {
  return (SUPPORTED_EXCHANGES as readonly string[]).includes(value.toLowerCase());
}

// --- Asset-class annualization (#597) --------------------------------------
// Annualization is asset-class-driven: crypto trades 7 days/week (√365),
// equities/FX trade weekdays only (√252). The signal is `strategies.asset_class`
// ('crypto' | 'traditional'). Every surface that annualizes Sharpe / Sortino /
// volatility / tracking-error must derive its `periodsPerYear` from the
// strategy's asset class instead of a hardcoded 252. This is the ONE TS place
// that maps the class → periods, mirroring the Python path (√365 crypto /
// √252 traditional).

/**
 * Is this exchange a crypto venue? Today EVERY supported exchange
 * (binance / okx / bybit / deribit) is crypto, so membership in the
 * allowlist IS the crypto signal. Case-insensitive. When a non-crypto
 * (equities/FX) venue is ever added to SUPPORTED_EXCHANGES this must be
 * narrowed to an explicit crypto subset — until then, allowlist membership
 * is the honest single source of truth.
 */
export function isCryptoExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  return (SUPPORTED_EXCHANGES as readonly string[]).includes(
    exchange.toLowerCase(),
  );
}

/**
 * Trading periods per year for annualization, keyed off a strategy's
 * `asset_class`. 'crypto' → 365 (7-day markets), everything else → 252
 * (weekday markets — the conservative default that matches the pre-#597
 * hardcode, so any unknown/null value stays byte-identical to today).
 */
export function annualizationPeriods(
  assetClass: string | null | undefined,
): number {
  return assetClass === "crypto" ? 365 : 252;
}

/**
 * Trading periods per year for a BLENDED (multi-strategy) return series, keyed
 * off the constituent legs' `asset_class`. √365 if ANY constituent leg is
 * crypto, else √252. Rationale (locked #597 blend rule): the blended daily
 * return series is calendar-daily the moment a crypto leg is present, so it has
 * ~365 obs/year; a pure-tradfi blend stays √252. An empty or all-unknown blend
 * keeps the 252 pre-#597 default byte-identical.
 *
 * The blend sibling of `annualizationPeriods` — the ONE place that maps a set of
 * legs → periods, so every wave-2/3 blend KPI call site derives its basis from
 * here rather than hand-rolling a second rule. Exact-match 'crypto' only (no
 * case/alias widening): the DB stores lowercase 'crypto' | 'traditional'.
 *
 * Structural param type (`{ asset_class?: string | null }`) — this module
 * imports ONLY zod (module-header rule); importing StrategyForBuilder would risk
 * a scenario→closed-sets cycle. Any object carrying `asset_class` satisfies it.
 */
export function blendPeriodsPerYear(
  legs: ReadonlyArray<{ asset_class?: string | null }>,
): number {
  return legs.some((l) => l.asset_class === "crypto") ? 365 : 252;
}

/**
 * Calendar-year span between two epoch-ms timestamps on the 365.25-day civil
 * clock. #597 / TWR-05: risk metrics ride the FREQUENCY clock
 * (`annualizationPeriods`, 365/252); CAGR rides the CALENDAR clock (elapsed
 * days / 365.25) and is asset-class-invariant. Mirrors compute.ts
 * (`days / 365.25`) and metrics.py. Returns 0 (never negative) when the span is
 * non-positive or non-finite, so callers can gate on `years > 0`.
 */
export function calendarYears(firstDateMs: number, lastDateMs: number): number {
  const ms = lastDateMs - firstDateMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (365.25 * 86_400_000);
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
// SURFACING CAVEAT (red-team 2026-06-02; RESOLVED 2026-07-07): the CHECK widening
// prevented the latent 23514 that would reject the worker's whole metrics upsert
// on the warnings path, but did NOT by itself make 'complete_with_warnings'
// surface end-to-end — the queue-path RPC sync_strategy_analytics_status
// laundered it back to 'complete', and several consumer gates exact-matched
// 'complete'. Migration 20260707120000 fixed the RPC (branches (a) AND (c)
// preserve the value), and the read-gates now share isComputedAnalytics() below
// (wizard SyncPreviewStep, admin/strategy-review re-check, queries.ts
// getStrategyV2Panels; the factsheet PDF routes + strategy v1 page already
// admitted both). The value now persists and surfaces end-to-end.
export const STRATEGY_ANALYTICS_COMPUTATION_STATUSES = [
  "pending",
  "computing",
  "complete",
  "complete_with_warnings",
  "failed",
] as const;
export type StrategyAnalyticsComputationStatus =
  (typeof STRATEGY_ANALYTICS_COMPUTATION_STATUSES)[number];

// The shared terminal-success gate. `complete_with_warnings` is a terminal
// SUCCESS (a run whose factsheet is valid but had a DQ guard fire — the runner
// wrote it alongside data_quality_flags); it must be treated as computed
// EVERYWHERE `complete` is, or a warned strategy dead-ends (onboarding poll
// hangs, admin approval 409s, metric panels blank). Before migration
// 20260707120000 the queue-path RPC laundered the value to `complete` so no
// consumer ever saw it; now that it persists, every read-gate MUST use this
// predicate instead of an exact-match on `'complete'`. See the SURFACING CAVEAT
// above. NOT a portfolio_analytics status (different table, no warnings value).
export function isComputedAnalytics(
  status: string | null | undefined,
): boolean {
  return status === "complete" || status === "complete_with_warnings";
}

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
