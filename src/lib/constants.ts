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

export const EXCHANGES = ["Binance", "OKX", "Bybit"] as const;

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
] as const;

/** PostgREST projection string derived from the allowlist tuple. */
export const API_KEY_USER_COLUMNS = API_KEY_USER_COLUMNS_ARR.join(", ") as
  "id, user_id, exchange, label, is_active, sync_status, last_sync_at, account_balance_usdt, created_at";

/** Single api_keys column name as a narrow string literal union type. */
export type ApiKeyUserColumn = (typeof API_KEY_USER_COLUMNS_ARR)[number];

/**
 * The encrypted columns that migration 027 revokes SELECT on for
 * anon/authenticated. Kept here as a single source of truth so tests
 * and audits can reference the same list the migration uses.
 *
 * NOTE: SQL migrations cannot import TS, so the same list also appears
 * verbatim in `supabase/migrations/027_api_keys_column_revoke.sql` and
 * `supabase/migrations/029_sec005_follow_ups.sql`. Keep them in sync.
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

export const DISCOVERY_CATEGORIES = [
  { slug: "crypto-sma", name: "Crypto SMA", description: "Separately Managed Accounts for crypto quantitative strategies. Verified performance from exchange APIs." },
  { slug: "cfd", name: "CFD", description: "Contract-for-difference strategies across major crypto pairs." },
  { slug: "emerging-crypto", name: "Emerging Crypto", description: "Early-stage strategies on newer tokens and protocols." },
  { slug: "crypto-decks", name: "Crypto Decks", description: "Curated bundles of crypto strategies for diversified allocation." },
  { slug: "tradfi-decks", name: "TradFi Decks", description: "Traditional finance strategy bundles bridging TradFi and crypto." },
] as const;
