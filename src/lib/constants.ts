import { EXCHANGES } from "./closed-sets";

export const STRATEGY_NAMES = [
  "Alpha Centauri",
  "Black Swan",
  "Crystal Ball",
  "Dark Matter",
  "Eclipse",
  "Fibonacci Ghost",
  "Golden Ratio",
  "Hyperion",
  "Iron Condor",
  "Jupiter Rising",
  "Kaleidoscope",
  "Lunar Tide",
  "Momentum Sphinx",
  "Nebula",
  "Obsidian",
  "Phoenix Protocol",
  "Quantum Drift",
  "Red Panda",
  "Silent Thunder",
  "Titan Forge",
  "Umbra",
  "Vortex",
  "White Noise",
  "Xenon Pulse",
  "Yellow Brick",
  "Zenith",
  "Arctic Fox",
  "Blue Shift",
  "Cobalt Stream",
  "Delta Force",
  "Emerald Wave",
  "Frost Byte",
  "Gravity Well",
  "Helix",
  "Icarus",
  "Jade Serpent",
] as const;

export const STRATEGY_TYPES = [
  "Long-Only",
  "Short-Only",
  "Long-Short",
  "Market Neutral",
  "Delta Neutral",
  "Arbitrage",
  "Other",
] as const;

export const SUBTYPES = [
  "Trend Following",
  "Momentum",
  "Breakout",
  "Mean Reversion",
  "Statistical Arbitrage",
  "Market Making",
  "Basis Trading",
  "Funding Rate",
] as const;

export const MARKETS = ["Futures", "Spot"] as const;

// B8: EXCHANGES (display case) is derived from the lowercase SUPPORTED_EXCHANGES
// base in the closed-set registry (imported at the top of this file); re-exported
// here so the UI chip-group importers keep the `@/lib/constants` path.
// `(typeof EXCHANGES)[number]` stays the "Binance" | "OKX" | "Bybit" union.
export { EXCHANGES };

/**
 * Normalize an exchange name to its canonical-case form (matches the
 * `EXCHANGES` constant exactly). The wizard pre-seeds
 * `strategies.supported_exchanges` from `api_keys.exchange` (lowercase
 * 'bybit' / 'okx' / 'binance' for check-constraint compliance), so the
 * MetadataStep chip group's case-sensitive `selected.includes(...)`
 * check failed to match an already-selected exchange on resume. The
 * user would click the chip — adding 'Bybit' alongside the existing
 * 'bybit' — and finalize-wizard would persist both, producing the
 * "Supported exchanges: bybit, Bybit" display bug (QA report
 * 2026-05-21 ISSUE-004).
 *
 * Behavior:
 *  - Known exchange (case-insensitive match): canonical form
 *    ('bybit' → 'Bybit', 'OKX' → 'OKX', 'BINANCE' → 'Binance').
 *  - Unknown name: returned unchanged so a future exchange addition
 *    doesn't silently drop entries before the constant is updated.
 *  - Empty / nullish: returned unchanged (caller filters elsewhere).
 */
export function canonicalizeExchange(name: string): string {
  if (!name) return name;
  const lower = name.toLowerCase();
  for (const canonical of EXCHANGES) {
    if (canonical.toLowerCase() === lower) return canonical;
  }
  return name;
}

/**
 * Normalize an array of exchange names, dedupe case-insensitively,
 * preserving order. Use on both the load path (initialDraft from DB)
 * and the save path (finalize-wizard payload) so a wizard resume never
 * persists `['bybit', 'Bybit']`.
 */
export function canonicalizeExchangeList(names: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const canonical = canonicalizeExchange(name);
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

/**
 * The allowlist of `api_keys` columns that can be projected from a user-scoped
 * Supabase client after migration 027 (SEC-005).
 *
 * Migration 027 runs `REVOKE SELECT ON api_keys FROM anon, authenticated` and
 * grants back only these columns. Any query projecting encrypted columns
 * (`API_KEY_ENCRYPTED_COLUMNS` below) from a user-scoped client will silently
 * return NULL for those columns, because PostgREST returns NULL for columns
 * the caller lacks SELECT on.
 *
 * The service-role client in analytics-service/ retains full access and can
 * read the encrypted columns to perform decryption server-side.
 *
 * Rule: never use `.select("*")` on `api_keys` from a user-scoped client.
 * Always project `API_KEY_USER_COLUMNS`. If a new column needs to be exposed
 * to the client, add it to `API_KEY_USER_COLUMNS_ARR` AND ship a new migration
 * extending the GRANT.
 */
export const API_KEY_USER_COLUMNS_ARR = [
  "id",
  "user_id",
  "exchange",
  "label",
  "is_active",
  "sync_status",
  "last_sync_at",
  "account_balance_usdt",
  "created_at",
  // Phase 06 (migration 066) — GRANT SELECT (sync_error) ON api_keys TO
  // authenticated. Exposes the worker-sanitized error message to the
  // owning allocator so the exchange-status pill can render a helper
  // line under "Sync failed" (Landmine 2 resolved). Service-role keeps
  // full-table SELECT via existing grants; admin reads via the
  // admin-select RLS path.
  "sync_error",
  // Phase 06 (migration 068 / ISSUE-006) — GRANT SELECT (last_429_at)
  // ON api_keys TO authenticated. Stamped by the Python worker on ccxt
  // 429s; required so AllocatorExchangeManager can compute the
  // retry-in-Ns countdown for the `rate_limited` pill. Without this
  // projection the countdown renders "retry in 0s" regardless of the
  // real server-side cooldown.
  "last_429_at",
  // Migration 075 — GRANT SELECT (disconnected_at) ON api_keys TO
  // authenticated. NULL = connected; timestamp = soft-disconnected.
  // AllocatorExchangeManager uses it to split keys into active vs
  // disconnected sections and render the Reconnect affordance.
  "disconnected_at",
] as const;

/** PostgREST projection string derived from the allowlist tuple. */
export const API_KEY_USER_COLUMNS = API_KEY_USER_COLUMNS_ARR.join(", ") as
  "id, user_id, exchange, label, is_active, sync_status, last_sync_at, account_balance_usdt, created_at, sync_error, last_429_at, disconnected_at";

/** Single api_keys column name as a narrow string literal union type. */
export type ApiKeyUserColumn = (typeof API_KEY_USER_COLUMNS_ARR)[number];

/**
 * The encrypted columns that migration 027 revokes SELECT on for
 * anon/authenticated. Kept here as a single source of truth so tests
 * and audits can reference the same list the migration uses.
 *
 * NOTE: SQL migrations cannot import TS, so the same list also appears
 * verbatim in `supabase/migrations/20260410225608_api_keys_column_revoke.sql` and
 * `supabase/migrations/20260410225610_sec005_follow_ups.sql`. Keep them in sync.
 */
export const API_KEY_ENCRYPTED_COLUMNS = [
  "api_key_encrypted",
  "api_secret_encrypted",
  "passphrase_encrypted",
  "dek_encrypted",
  "nonce",
] as const;

export type ApiKeyEncryptedColumn = (typeof API_KEY_ENCRYPTED_COLUMNS)[number];

export const CHART_COLORS = {
  strategy: "#0D9488",
  benchmark: "#94A3B8",
  positive: "#059669",
  negative: "#DC2626",
  accent2: "#6366F1",
  grid: "#F1F5F9",
  axis: "#E2E8F0",
  text: "#64748B",
} as const;

// `group` splits the Discovery sidebar into two sub-sections — Digital
// Assets and TradFi — so allocators can scan crypto and traditional-
// finance strategy surfaces separately. Order within each group follows
// the array; groups render in the order they first appear.
export const DISCOVERY_CATEGORIES = [
  { slug: "crypto-sma", name: "Crypto SMA", group: "Digital Assets", description: "Separately Managed Accounts for crypto quantitative strategies. Verified performance from exchange APIs." },
  { slug: "cfd", name: "CFD", group: "Digital Assets", description: "Contract-for-difference strategies across major crypto pairs." },
  { slug: "emerging-crypto", name: "Emerging Crypto", group: "Digital Assets", description: "Early-stage strategies on newer tokens and protocols." },
  { slug: "crypto-decks", name: "Crypto Decks", group: "Digital Assets", description: "Curated bundles of crypto strategies for diversified allocation." },
  { slug: "tradfi-decks", name: "TradFi Decks", group: "TradFi", description: "Traditional finance strategy bundles bridging TradFi and crypto." },
] as const;
