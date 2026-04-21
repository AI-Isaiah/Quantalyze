/**
 * Holding-scope scope_ref parser and builder.
 *
 * Phase 08 — multi-scope notes (D-08, Research Finding #9).
 *
 * Format: `{venue}:{symbol}:{holding_type}` — exactly 3 colon-separated
 * parts where:
 *   - venue is lowercase alphabetic (e.g. "binance", "okx", "bybit")
 *   - symbol is uppercase alphanumeric — CCXT-stripped per Phase 06 D-16
 *     (e.g. "BTC" for spot, "BTCUSDT" for derivative). Symbols never
 *     contain '/' or ':' post-strip.
 *   - holding_type is one of "spot" or "derivative".
 *
 * Malformed refs (wrong part count, wrong case, unknown holding_type,
 * embedded '/') return `null` from `parseHoldingScopeRef`, and the
 * `/api/notes` ownership check rejects them with 403.
 */

export interface HoldingScopeParts {
  /** e.g. "binance" | "okx" | "bybit" | "deribit" | "kraken" | "coinbase" */
  venue: string;
  /** CCXT-stripped symbol: "BTC" (spot) or "BTCUSDT" (derivative). */
  symbol: string;
  /** "spot" or "derivative" — matches allocator_holdings.holding_type values. */
  holding_type: "spot" | "derivative";
}

// Strict regex: lowercase venue, uppercase alphanumeric symbol, {spot,derivative}.
const HOLDING_SCOPE_RE = /^([a-z]+):([A-Z0-9]+):(spot|derivative)$/;

export function buildHoldingScopeRef(parts: HoldingScopeParts): string {
  return `${parts.venue}:${parts.symbol}:${parts.holding_type}`;
}

export function parseHoldingScopeRef(ref: string): HoldingScopeParts | null {
  const match = HOLDING_SCOPE_RE.exec(ref);
  if (!match) return null;
  const [, venue, symbol, holding_type] = match;
  return {
    venue,
    symbol,
    holding_type: holding_type as "spot" | "derivative",
  };
}
