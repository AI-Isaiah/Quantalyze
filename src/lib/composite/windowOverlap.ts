/**
 * The ONE shared window-overlap convention — TypeScript side.
 *
 * This is the second implementation of a single truth table. The canonical
 * spec + test corpus lives in:
 *   analytics-service/tests/fixtures/window_overlap_convention.json
 * and the Python mirror is:
 *   analytics-service/services/stitch_composite.py  (`windows_overlap`)
 *
 * Both implementations MUST agree on every fixture case. The binding is
 * enforced by the cross-package drift-guard
 * tests/lib/composite/window-overlap-convention-parity.test.ts — if this
 * predicate and the fixture diverge in either direction, CI reddens (the v1.5
 * lesson: same inputs / different derivations = silent divergence).
 *
 * Convention: member windows are half-open date intervals `[window_start,
 * window_end)` — a day equal to `window_end` is EXCLUDED. `window_end === null`
 * means unbounded (open-ended). Two windows OVERLAP iff
 *   a.start < (b.end ?? +inf)  AND  b.start < (a.end ?? +inf)
 * Adjacent windows sharing only the handoff boundary (`a.end === b.start`) do
 * NOT overlap (strict `<`).
 *
 * Dates are ISO `'YYYY-MM-DD'` UTC calendar days. Lexicographic string
 * comparison equals chronological comparison for this format, so we compare raw
 * strings — NO Date parsing, NO timezone surface. The sentinel `"9999-12-31"`
 * stands in for `+infinity` when `window_end` is null (a date far beyond any
 * real track record and lexicographically maximal among 'YYYY-…' dates).
 *
 * This module is PURE: it imports nothing beyond types and carries NO fixture
 * data at runtime (the 10 fixture cases are test vectors, not runtime data).
 */

export interface WindowBounds {
  /** ISO 'YYYY-MM-DD' UTC calendar day (inclusive start). */
  window_start: string;
  /** ISO 'YYYY-MM-DD' exclusive end, or `null` for open-ended/unbounded. */
  window_end: string | null;
}

/** Sentinel standing in for +infinity when a window is open-ended. */
const OPEN_ENDED = "9999-12-31";

/**
 * Half-open `[start, end)` overlap predicate. Symmetric by construction.
 * See the module docstring + window_overlap_convention.json for the spec.
 */
export function windowsOverlap(a: WindowBounds, b: WindowBounds): boolean {
  const aEnd = a.window_end ?? OPEN_ENDED;
  const bEnd = b.window_end ?? OPEN_ENDED;
  return a.window_start < bEnd && b.window_start < aEnd;
}
