/**
 * Holding-scope scope_ref parser and builder.
 *
 * Phase 08 — multi-scope notes (D-08, Research Finding #9).
 *
 * Format: `{venue}:{symbol}:{holding_type}` — exactly 3 colon-separated
 * parts where:
 *   - venue is lowercase alphabetic (e.g. "binance", "okx", "bybit")
 *   - symbol is uppercase alphanumeric, plus '-'/'_' — CCXT-stripped per
 *     Phase 06 D-16 for spot/linear (e.g. "BTC", "BTCUSDT") and the raw
 *     Deribit instrument_name for Deribit derivatives (Phase 71 —
 *     "BTC-PERPETUAL", "BTC_USDC-PERPETUAL", "BTC-27DEC24-100000-C").
 *     Symbols never contain '/' or ':' post-strip.
 *   - holding_type is one of "spot" or "derivative".
 *
 * Malformed refs (wrong part count, wrong case, unknown holding_type,
 * embedded '/') return `null` from `parseHoldingScopeRef`, and the
 * `/api/notes` ownership check rejects them with 403.
 */

export interface HoldingScopeParts {
  /** e.g. "binance" | "okx" | "bybit" | "deribit" | "kraken" | "coinbase" */
  venue: string;
  /** CCXT-stripped symbol ("BTC", "BTCUSDT") or a Deribit instrument_name
   * ("BTC-PERPETUAL", "BTC_USDC-PERPETUAL") — uppercase alnum plus '-'/'_'. */
  symbol: string;
  /** "spot" or "derivative" — matches allocator_holdings.holding_type values. */
  holding_type: "spot" | "derivative";
}

// Strict regex: lowercase venue, uppercase-alnum symbol (plus '-'/'_' for
// Deribit instrument names, Phase 71), {spot,derivative}. Still rejects
// lowercase symbols, '/' or ':' in the symbol, and wrong part counts.
const HOLDING_SCOPE_RE = /^([a-z]+):([A-Z0-9_-]+):(spot|derivative)$/;

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
