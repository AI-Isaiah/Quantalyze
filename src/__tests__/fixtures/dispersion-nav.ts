/**
 * Compounding-NAV constant-yield fixture: the TypeScript twin of the Python
 * fixture in `analytics-service/tests/test_metrics.py` (`_q166r2_nav_constant_yield`,
 * `_q166r2_apy`, `_Q166R2_CONSTANT_YIELDS`; after Phase 166.1 plan 01 lands they
 * live in `analytics-service/tests/dispersion_fixtures.py`). Same ids, same
 * yields, same construction.
 *
 * Returns are taken the way the platform takes them: `E_t / E_{t-1} - 1` over an
 * exactly compounding NAV. The rounding residue of each return is about 1e-16
 * ABSOLUTE, whatever the yield (Phase 166 round 2, CR-01), so the sd of the
 * series is about 1.3e-16 instead of 0: residue, not dispersion. With
 * `cents = true` the NAV is rounded to cents first, which is REAL quantisation
 * dispersion (about 4.8e-7 at a 10 000 start and 1% APY), the control on the
 * other side of the floor.
 */

/** Daily returns of a NAV compounding at `dailyYield`, `n` returns long. */
export function navConstantYield(
  dailyYield: number,
  n = 366,
  start = 10_000,
  cents = false,
): number[] {
  const nav = navLevelsConstantYield(dailyYield, n, start, cents);
  const out: number[] = [];
  for (let t = 1; t < nav.length; t++) out.push(nav[t] / nav[t - 1] - 1);
  return out;
}

/** The NAV levels behind `navConstantYield` (n + 1 levels), for level-based sites. */
export function navLevelsConstantYield(
  dailyYield: number,
  n = 366,
  start = 10_000,
  cents = false,
): number[] {
  const nav: number[] = [];
  for (let t = 0; t <= n; t++) {
    const level = start * (1 + dailyYield) ** t;
    nav.push(cents ? Math.round(level * 100) / 100 : level);
  }
  return nav;
}

/** The daily yield that compounds to `apy` over 365 days. */
export function apyToDaily(apy: number): number {
  return (1 + apy) ** (1 / 365) - 1;
}

/** id -> daily yield. Same ids and values as the Python `_Q166R2_CONSTANT_YIELDS`. */
export const CONSTANT_YIELDS: Readonly<Record<string, number>> = {
  "daily_1e-5": 1e-5,
  "daily_1e-4": 1e-4,
  "daily_1e-3": 1e-3,
  "apy_0.01pct": apyToDaily(0.0001),
  "apy_0.1pct": apyToDaily(0.001),
  "apy_1pct": apyToDaily(0.01),
  "apy_3pct": apyToDaily(0.03),
  "apy_5pct": apyToDaily(0.05),
  "apy_10pct": apyToDaily(0.1),
  "apy_50pct": apyToDaily(0.5),
  "apy_100pct": apyToDaily(1.0),
};
