/**
 * B1 (audit-2026-05-07) — Money-Unit Brand canonical entry point.
 *
 * Adds validating smart constructors for the unit brands the audit
 * surfaced as load-bearing on public surfaces, plus one new brand the
 * existing `./types` module doesn't already carry.
 *
 * Relationship to `./types`:
 *  - `Usd`, `Ratio`, `Fraction`, `Improvement` brands are RE-EXPORTED
 *    from `./types`. There is exactly one definition per brand; this
 *    module gives it a canonical import path (`@/lib/units`) without
 *    creating a parallel definition that would silently fail to
 *    typecheck against types.ts's `Usd`.
 *  - `asUsd / asRatio / asFraction` in `./types` are vocabulary-marker
 *    casts (no runtime check). The `safe*` constructors below are the
 *    validating equivalents that reject NaN, Infinity, and
 *    implausibly-out-of-range values at the producer boundary. Use the
 *    raw `as*` when you already have a value you trust; use `safe*`
 *    when you're crossing a payload / wire / DB boundary and want the
 *    out-of-range case observable.
 *
 * What this module owns:
 *  - `DecimalReturn` brand + `safeDecimalReturn` (NEW-C20-10): a
 *    decimal-form cumulative or per-period return (0.18 = +18%). The
 *    factsheet's percent formatter multiplies by 100; an unbranded
 *    number passed in could silently render USD as nonsense percent.
 *  - `safeUsd`, `safeRatio`, `safeFraction` validating constructors.
 *    Each returns `Brand | null` for out-of-range, NaN, or non-finite
 *    inputs and emits a single boundary warn so producer-side drift
 *    surfaces in logs.
 *
 * What this module re-exports (single source of truth lives at the
 * producer; this module just makes the import path canonical):
 *  - `Usd`, `Ratio`, `Fraction` brands (from `./types`)
 *  - raw-cast vocabulary markers `asUsd / asRatio / asFraction` (from
 *    `./types`)
 *  - `Improvement` brand + `asImprovement` (types.ts NEW-C21-02)
 *  - `signedExposureUsd`, `signedExposureBase` (types.ts NEW-C21-01)
 *  - `DELTA_UNITS` (simulatorSchema.ts NEW-C11-06)
 *
 * Not re-exported (deliberately):
 *  - `WealthPoint`, `toWealth`, `VisibleAligned` from EquityChart.tsx
 *    (NEW-C04-03 / NEW-C04-04). That module is React-heavy; re-exporting
 *    from a server-importable unit module would pull the chart tree into
 *    RSC bundles.
 *  - `holdingEquityContribution` from queries.ts (NEW-C03-01). queries.ts
 *    is `server-only` (Next.js server-component-only), so re-exporting
 *    from a utility module would forbid client-side imports of `units`.
 *    Consumers needing the helper import it from `@/lib/queries` directly
 *    in server-only code paths.
 */

import type { Usd, Ratio, Fraction } from "./types";

// ---------------------------------------------------------------------------
// DecimalReturn — new brand + validating constructor (NEW-C20-10)
// ---------------------------------------------------------------------------

/**
 * Cumulative or per-period return in DECIMAL form: 0.18 = +18%.
 *
 * The factsheet's `pct(v)` formatter multiplies by 100 — a value > ~10
 * means the producer almost certainly already pre-multiplied (legacy
 * "percent" convention) or shipped a USD amount by mistake; both render
 * as nonsense percentages on the public surface. The dedicated brand
 * keeps return values type-distinguishable from `Usd` / `Ratio` /
 * `Fraction` so a mis-wiring fails at the brand-aware formatter call
 * site instead of rendering as the wrong unit.
 */
export type DecimalReturn = number & { readonly __unit: "DecimalReturn" };

// ---------------------------------------------------------------------------
// Implausibility thresholds — single source of truth for the boundary warns
// ---------------------------------------------------------------------------

const USD_IMPLAUSIBLE_NEGATIVE = -1e15; // ~"no real portfolio loses this much"
const DECIMAL_RETURN_IMPLAUSIBLE_MAG = 10; // 1000% return — almost always a unit-mix
const RATIO_IMPLAUSIBLE_MAG = 100; // Sharpe of 100 — divide-by-near-zero upstream

function warnBoundary(label: string, v: number, hint: string): void {
  if (typeof console !== "undefined") {
    console.warn(`[units.${label}] ${hint}`, { received: v });
  }
}

/**
 * Validating constructor for `Usd`. Returns `null` for null/undefined,
 * non-finite, or implausibly-large-negative inputs (the "unit-mix"
 * signature — a negative billion-trillion is almost always a return
 * delta passed where USD was expected).
 *
 * Distinct from the raw `asUsd` in `./types` which is a vocabulary-only
 * cast with no runtime check. Use `safeUsd` at producer boundaries
 * (Supabase row → payload, RPC response → response schema). Use
 * `asUsd` when you have a value you already trust (a constant, a
 * value just returned from `safeUsd`).
 */
export function safeUsd(raw: number | null | undefined): Usd | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < USD_IMPLAUSIBLE_NEGATIVE) {
    warnBoundary(
      "safeUsd",
      raw,
      "implausibly large negative USD value — likely a unit-mix bug",
    );
    return null;
  }
  return raw as Usd;
}

/**
 * Validating constructor for `DecimalReturn` (0.18 = +18%).
 * Returns null for null/undefined/non-finite or implausibly large
 * magnitudes (>1000%) that indicate the producer pre-multiplied or
 * shipped a USD amount by mistake.
 */
export function safeDecimalReturn(
  raw: number | null | undefined,
): DecimalReturn | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw)) return null;
  if (Math.abs(raw) > DECIMAL_RETURN_IMPLAUSIBLE_MAG) {
    warnBoundary(
      "safeDecimalReturn",
      raw,
      "|value| > 10 (1000%) — almost always a percent-vs-fraction unit-mix bug",
    );
    return null;
  }
  return raw as DecimalReturn;
}

/**
 * Validating constructor for `Ratio` (Sharpe, Sortino, Calmar). Returns
 * null for null/undefined/non-finite or implausibly-large magnitudes
 * (|v|>100) that indicate a zero-variance window upstream.
 */
export function safeRatio(raw: number | null | undefined): Ratio | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw)) return null;
  if (Math.abs(raw) > RATIO_IMPLAUSIBLE_MAG) {
    warnBoundary(
      "safeRatio",
      raw,
      "|value| > 100 — almost always a zero-variance window or unit-mix bug",
    );
    return null;
  }
  return raw as Ratio;
}

/**
 * Validating constructor for `Fraction`. Returns null for null,
 * undefined, non-finite, or values outside `[0, 1]`. A boundary warn
 * fires for out-of-range so producer-side drift (percent vs fraction
 * confusion: shipping `50` instead of `0.5`) surfaces in logs.
 *
 * NOT a downstream-replacement for the raw `current_weight: number |
 * null` payload field — call sites that aggregate weight (HHI,
 * tracking error, alpha/beta) read `current_weight ?? 0`, which would
 * silently treat `null` as "0% allocated" and silently exclude the
 * bad-weight row from analytics. Use `safeFraction` at the chip /
 * display boundary where rendering `—` is the right "not computable"
 * cue; do NOT use it at the payload boundary until the aggregator
 * sweep lands (deferred follow-up, see CHANGELOG).
 */
export function safeFraction(raw: number | null | undefined): Fraction | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < 0 || raw > 1) {
    warnBoundary(
      "safeFraction",
      raw,
      "out-of-range fraction rejected; expected [0,1]",
    );
    return null;
  }
  return raw as Fraction;
}

// ---------------------------------------------------------------------------
// Re-exports from types.ts (producer-owned)
// ---------------------------------------------------------------------------

export type { Usd, Ratio, Fraction, Improvement } from "./types";
export {
  asUsd,
  asRatio,
  asFraction,
  asImprovement,
  signedExposureUsd,
  signedExposureBase,
} from "./types";

// ---------------------------------------------------------------------------
// Re-exports from simulatorSchema.ts (producer-owned)
// ---------------------------------------------------------------------------

export { DELTA_UNITS } from "./api/simulatorSchema";
