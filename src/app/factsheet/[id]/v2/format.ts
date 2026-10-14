/**
 * Single-source formatters for every numeric on the factsheet view. Keeps
 * decimal counts and sign conventions consistent — Sharpe is always 2dp,
 * percentages always 1dp (or 2dp for tail-risk where precision matters),
 * counts integer with thousand separators.
 *
 * Allocators expect a uniform table; mixing formats across panels reads
 * sloppy. Prefer these over per-component inline formatting.
 *
 * NEW-C20-10 (B1, audit-2026-05-07): the unit contract on each helper is
 * documented in its JSDoc. The unbranded `number | null` input is kept for
 * backward compatibility — every existing call site stays the same — but
 * new code should construct the appropriate brand via the smart
 * constructors in `@/lib/units` (`asUsd`, `asDecimalReturn`,
 * `asRatioMetric`) and consume the brand-aware aliases at the bottom
 * (`formatUsd`, `formatDecimalReturn`, `formatRatio`). Passing the wrong
 * brand to a brand-aware alias is a compile error; passing the wrong
 * `number` to a legacy helper still works, but the units module's smart
 * constructors emit a boundary warn for implausibly out-of-range inputs
 * so the most likely unit-mix bugs surface in logs.
 *
 * Phase 170.6 DISPLAYPOLISH (D-02, D-05): the sign rule does NOT live here. Every signed
 * or rounded figure below is a call into `@/lib/factsheet/display-sign`
 * (`formatFixedSigned`), which prints a value that rounds to zero unsigned (`0.0%`,
 * `0.00`, `0.0pp`, never `-0.0%` or `+0.0%`). Only the unsigned USD helpers
 * (`usdCompact`, `formatUsd`) keep their own `toFixed`: an amount carries no sign rule.
 */
import type { Usd, DecimalReturn, Ratio } from "@/lib/units";
import { formatFixedSigned } from "@/lib/factsheet/display-sign";

const PCT_DEFAULT_DP = 1;
const RATIO_DP = 2;

/**
 * Percentage with sign prefix. dp=1 by default, dp=2 for tail-risk metrics.
 *
 * @deprecated Prefer `formatDecimalReturn` (`@/lib/units` smart constructor
 * `asDecimalReturn`) for new code. The unbranded `number | null` here
 * cannot stop a USD or ratio value from being rendered as `× 100` —
 * exactly the NEW-C20-10 risk on the public factsheet. Existing call
 * sites are kept compiling; new code paths should adopt the brand.
 */
export function pctSigned(v: number | null | undefined, dp = PCT_DEFAULT_DP): string {
  return formatFixedSigned(v, { dp, scale: 100, suffix: "%", plus: true });
}

/**
 * Unsigned percentage (e.g., for max DD which is conventionally written
 * negative without explicit + sign).
 *
 * @deprecated Prefer `formatDecimalReturn(v, { signed: false })` with a
 * `DecimalReturn`-branded value.
 */
export function pct(v: number | null | undefined, dp = PCT_DEFAULT_DP): string {
  return formatFixedSigned(v, { dp, scale: 100, suffix: "%" });
}

/**
 * Ratio (Sharpe, Sortino, Calmar, Omega) — always 2 decimal places.
 *
 * @deprecated Prefer `formatRatio` with an `asRatioMetric`-branded value.
 */
export function ratio(v: number | null | undefined, dp = RATIO_DP): string {
  return formatFixedSigned(v, { dp });
}

/** Signed scalar (Skew etc.) — 2dp with sign prefix. */
export function signed(v: number | null | undefined, dp = RATIO_DP): string {
  return formatFixedSigned(v, { dp, plus: true });
}

/** Integer with thousand separators. */
export function intl(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString();
}

/**
 * USD in compact form (B / M / K).
 *
 * @deprecated Prefer `formatUsd` with an `asUsd`-branded value.
 */
export function usdCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** Percentage-points delta (a − b) — for "vs benchmark" delta cells. */
export function ppDelta(a: number | null | undefined, b: number | null | undefined, dp = 1): string {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "—";
  return formatFixedSigned(a - b, { dp, scale: 100, suffix: "pp", plus: true });
}

// ---------------------------------------------------------------------------
// NEW-C20-10 (B1, audit-2026-05-07) — brand-aware formatter aliases.
//
// These accept ONLY the matching brand type from `@/lib/units`. A USD value
// branded as `Usd` cannot be passed to `formatDecimalReturn` without a
// compile error — closing the public-facing surface-mix risk that the audit
// flagged. The aliases delegate to the legacy helpers above so the output
// format is identical; only the type-side gate is new.
// ---------------------------------------------------------------------------

/**
 * Format a branded USD amount in compact form (B / M / K).
 *
 * Accepts only `Usd` (constructed via `safeUsd` at producer boundaries,
 * or the raw vocabulary-marker `asUsd` for already-trusted values). To
 * preserve interop with legacy call sites, the parameter type also
 * allows `null`.
 */
export function formatUsd(v: Usd | null, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(dp)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Format a branded decimal-return value as a percentage with optional sign
 * prefix. Accepts only `DecimalReturn` (constructed via `safeDecimalReturn`).
 */
export function formatDecimalReturn(
  v: DecimalReturn | null,
  options: { signed?: boolean; dp?: number } = {},
): string {
  const { signed: withSign = true, dp = PCT_DEFAULT_DP } = options;
  return formatFixedSigned(v, { dp, scale: 100, suffix: "%", plus: withSign });
}

/**
 * Format a branded ratio metric (Sharpe, Sortino, Calmar). Accepts only
 * `Ratio` (constructed via `safeRatio` or the raw `asRatio`
 * vocabulary-marker for trusted values).
 */
export function formatRatio(
  v: Ratio | null,
  dp: number = RATIO_DP,
): string {
  return formatFixedSigned(v, { dp });
}
