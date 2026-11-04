/**
 * Phase 188 (TINYBASE) plan 06, D-02 and D-03: the near-empty-account day, shared with TypeScript.
 *
 * A day measured against a near-empty account (a base under 5% of the highest level over the
 * previous 30 calendar days) does not read as the strategy's performance: the analytics service
 * leaves it out of the returns and names it (D-02). The worker stores the named days as an
 * ascending list of `YYYY-MM-DD` strings, in the key's `key_inputs` payload and in the strategy's
 * `data_quality_flags` (`job_worker.py`, `run_derive_broker_dailies_job`; carried by
 * `analytics_runner.py`). This module is the one TypeScript home of the stored key, of the
 * threshold the rule applies, and of the strict read of the stored list, so the factsheet note
 * (plan 07) and the dashboard note (plan 08) look the list up under the same literal the worker
 * writes and print the same threshold the rule uses.
 *
 * Client-safe on purpose (no `server-only`): the factsheet note renders in a client view and the
 * dashboard reads the list in a server component.
 */
import { parseMarksStart } from "@/lib/nav-marks-start";

/**
 * The key the Python analytics writer sets for the tiny-base day list. Pinned against
 * `job_worker.py` (the key-mode and strategy writes) and `analytics_runner.py` (its day-list
 * transport and its `DataQualityFlags` declaration) by
 * `src/__tests__/tiny-base-literal-pin.test.ts`, so the writer and this reader cannot drift
 * apart unnoticed.
 */
export const TINY_BASE_DAYS_FLAG = "tiny_base_days";

/**
 * D-03 (founder 2026-11-03, "Under 5% of the 30-day peak"): a day is a near-empty-account day
 * when its base is under this percent of the window's peak. Python home: `TINY_BASE_FRACTION`
 * (0.05) in `analytics-service/services/tiny_base.py`. Pinned by the literal-pin test.
 */
export const TINY_BASE_PERCENT = 5;

/**
 * D-03: the window length in calendar days (the days t-30 through t-1). Python home:
 * `TINY_BASE_WINDOW_DAYS` in `analytics-service/services/tiny_base.py`. Pinned by the
 * literal-pin test.
 */
export const TINY_BASE_WINDOW_DAYS = 30;

/**
 * Strict read of the stored day list (188 D-02, D-06, SC-5).
 *
 * The JSONB crosses from the worker into a typed value here, so it is untrusted. The result is the
 * list of days the factsheet note and the dashboard note NAME (D-06: the note names the
 * near-empty days) and count with its `length`; plans 07 and 08 read it only through here.
 *
 * - Anything but an array gives `[]`.
 * - An array holding ANY element that is not a real `YYYY-MM-DD` calendar day (checked by
 *   `parseMarksStart`, the repo's one strict calendar rule) gives `[]`: the note is a disclosure,
 *   and a missing one is recoverable where a false one (a named day that is not real, or a count
 *   that is wrong) is not. So one bad element voids the list rather than being skipped.
 * - Otherwise the DISTINCT days in ascending order, as a new array (the input is never mutated and
 *   never aliased).
 *
 * It reads days only and never an amount: the worker stores no amount under this key.
 */
export function readTinyBaseDays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<string>();
  for (const element of value) {
    const day = parseMarksStart(element);
    if (day === null) return [];
    days.add(day);
  }
  // ISO calendar days compare chronologically as strings.
  return [...days].sort();
}
