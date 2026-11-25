/**
 * Phase 236 FIGUREMATH: the one named constant set of the figure convention (TypeScript side).
 *
 * LEAF MODULE: it imports nothing, so closed-sets.ts, figure-gate.ts and every engine may
 * import it without creating a cycle.
 *
 * F-5 (REQUIREMENTS.md, verbatim): 'Figures: one convention, "365, ddof 1 everywhere". This
 * applies inside the existing annualization rule: risk is annualized by frequency (crypto 365,
 * traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The
 * TypeScript engines move to match Python.'
 *
 * F-6 (REQUIREMENTS.md, verbatim): 'CVaR is historical CVaR, null below a minimum number of
 * observations.'
 *
 * CONTEXT Q2 (founder 2026-11-25, verbatim "Total record only (Recommended)"): CVAR_MIN_OBS = 60,
 * one named constant per language. It nulls CVaR only when the TOTAL record has fewer than 60
 * observations; a zoomed window always shows CVaR.
 *
 * CVAR_MIN_OBS is a SEPARATE constant from MIN_ANNUALIZATION_OBS (figure-gate.ts) even though
 * both are 60 today. Do not alias one to the other: retuning one must never move the other.
 *
 * Twin of analytics-service/services/figure_conventions.py. Each definition is one
 * `export const NAME = <int>;` line, pinned across languages, exactly once, by
 * src/lib/figure-conventions.test.ts and analytics-service/tests/test_figure_conventions.py.
 */

/** Returns/CAGR annualize on the calendar clock: whole days of the span over 365 (not 365.25). */
export const CALENDAR_DAYS_PER_YEAR = 365;

/** Standard deviations are SAMPLE sd (ddof 1) everywhere. */
export const SD_DDOF = 1;

/** Risk annualizes by frequency: crypto trades every calendar day, traditional weekdays only. */
export const PERIODS_PER_YEAR_CRYPTO = 365;
export const PERIODS_PER_YEAR_TRADITIONAL = 252;

/** F-6 / Q2: the TOTAL record needs at least this many observations before CVaR is shown. */
export const CVAR_MIN_OBS = 60;

/**
 * Whole calendar days from the first to the last observed date (CONTEXT Q1: "first to last
 * observed date, whole days"). Floor, which is what Python's `Timedelta.days` does, so the two
 * engines count the same span. ISO day strings parse as UTC midnight, so a DST change cannot
 * move the count. A non-positive or non-finite span is 0.
 */
export function wholeCalendarDays(firstMs: number, lastMs: number): number {
  const ms = lastMs - firstMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}
