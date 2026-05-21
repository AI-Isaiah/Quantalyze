/**
 * Audit-2026-05-07 — NUMERIC precision guardrails for the generated
 * `Database` type in `src/lib/database.types.ts`.
 *
 * Supabase's `gen types typescript` infers `number` for every Postgres
 * `NUMERIC` column. JavaScript `number` is IEEE-754 double-precision
 * (~15.95 decimal digits), which is fine for ratios in [-1e15, 1e15] but
 * silently lossy for high-precision financial values:
 *
 *   - Funding-fee accruals (positions.funding_pnl) that compound across
 *     thousands of 8-hour periods accumulate >15 significant digits.
 *   - Large notional positions (positions.size_base * price) in low-unit
 *     assets like SHIB or PEPE produce values > 9e15 where every integer
 *     beyond 2^53 has gaps.
 *   - Round-trip read → JS arithmetic → write loses the trailing digits
 *     that the audit reconstruction job needs to reproduce a PnL exactly.
 *
 * This module is the documented escape hatch:
 *
 *   1. `KNOWN_NUMERIC_COLUMNS` — canonical (table, column) list of the
 *      NUMERIC columns this codebase reads/writes. Updated alongside any
 *      migration that adds a new NUMERIC column.
 *   2. `parseNumericString` / `serializeNumeric` — string round-trip
 *      helpers that preserve full Postgres precision. PostgREST accepts
 *      strings for NUMERIC inputs and (via the `Accept` header on the
 *      select call) can be coaxed to return strings too — the helpers
 *      here only handle the in-memory side; the wire-format coercion
 *      stays the caller's responsibility per call site.
 *   3. `NumericString` branded type — opaque wrapper that prevents
 *      accidental concatenation/arithmetic with plain strings.
 *
 * Why this is NOT auto-applied to every database.types.ts column:
 *
 * Bulk-replacing every `NUMERIC → number` with `NumericString` in the
 * generated types would create hundreds of call-site breaks (most
 * NUMERIC reads are in low-stakes UI display paths where IEEE-754
 * precision is acceptable). The audit fix is to make the lossy
 * assumption EXPLICIT — code that needs full precision opts in via this
 * module, and the canonical list lets a follow-up grep audit identify
 * any unmigrated high-precision call sites.
 */

import type { Database } from "@/lib/database.types";

/**
 * Canonical catalog of (table, column) pairs that the source schema
 * declares as NUMERIC and that the codebase reads/writes on paths where
 * precision loss would be observable (accounting, audit reconstruction,
 * exact comparisons).
 *
 * MUST be kept in sync with the migrations folder. The companion test
 * (`numeric-precision.test.ts`) asserts every entry still resolves to a
 * key on the generated `Database['public']['Tables'][T]['Row']` type —
 * a future migration that renames or drops one of these columns will
 * fail the regression at PR time instead of at runtime.
 *
 * Format: array of "<table>.<column>" strings (keeps the test contract
 * simple — no need for a nested type). NOTE: this is the AT-MINIMUM list
 * of columns that have been triaged. New NUMERIC columns from future
 * migrations should be added here when the precision contract matters.
 */
export const KNOWN_NUMERIC_COLUMNS = [
  "positions.funding_pnl",
  "positions.realized_pnl",
  "positions.unrealized_pnl",
  "positions.roi",
  "positions.entry_price_avg",
  "positions.exit_price_avg",
  "positions.fee_total",
  "positions.size_base",
  "positions.size_peak",
] as const;

export type KnownNumericColumn = (typeof KNOWN_NUMERIC_COLUMNS)[number];

/**
 * Branded string type that flags a value as "preserves NUMERIC
 * precision". Constructed only through `serializeNumeric` or
 * `markAsNumericString`.
 *
 * The brand is a phantom property — at runtime a NumericString IS a
 * plain string. The brand only blocks the compile-time mistake of
 * passing an arbitrary string where a precision-preserving one is
 * required, and vice versa.
 */
export type NumericString = string & { readonly __numericBrand: unique symbol };

/**
 * Convert a JS number, bigint, or already-validated string into a
 * NumericString. Validates the input is a finite, parseable numeric
 * representation — throws on NaN, Infinity, or junk strings.
 *
 * Caller-supplied numbers preserve only IEEE-754 precision (this is the
 * lossy side); to preserve full precision the source must be a string
 * from a precision-preserving channel (e.g., a PostgREST select with
 * `Accept: application/vnd.pgrst.object+json;numericstrings=true`).
 */
export function serializeNumeric(value: number | bigint | string): NumericString {
  if (typeof value === "bigint") {
    return value.toString() as NumericString;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`serializeNumeric: non-finite value ${String(value)}`);
    }
    return value.toString() as NumericString;
  }
  // String input — validate it parses as a NUMERIC. Postgres accepts
  // scientific notation, leading sign, and decimal point; we mirror that
  // here with a tolerant regex rather than re-parsing as Number (which
  // would defeat the precision-preservation goal).
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    throw new Error(`serializeNumeric: not a valid numeric string: ${value}`);
  }
  return value as NumericString;
}

/**
 * Parse a NumericString back to a JS number — explicit acknowledgement
 * that the caller is OPTING IN to IEEE-754 precision loss for display
 * or downstream arithmetic. Throw on un-parseable inputs.
 *
 * For paths that need full precision through to a downstream system,
 * keep the NumericString opaque and forward it as-is.
 */
export function parseNumericString(value: NumericString): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`parseNumericString: not a finite number: ${value}`);
  }
  return n;
}

/**
 * Internal helper for the contract test below. Resolves a
 * "table.column" key against the generated `Database` type to prove
 * the column still exists. Compile-time check only — there's no
 * runtime call site for this function.
 */
export type ResolveColumn<T extends string> = T extends `${infer Table}.${infer Column}`
  ? Table extends keyof Database["public"]["Tables"]
    ? Column extends keyof Database["public"]["Tables"][Table]["Row"]
      ? Database["public"]["Tables"][Table]["Row"][Column]
      : never
    : never
  : never;
