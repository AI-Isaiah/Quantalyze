/**
 * Phase 164.8.2 / W3 — the unchecked narrow, in ONE place, on purpose.
 *
 * ⛔ THIS IS THE TRAP, NOT A UTILITY. Nothing that ASSERTS anything may call it.
 * It exists solely so a calibration can MEASURE the degeneracy it replaced: a
 * `String.indexOf`/`lastIndexOf`/`search` result handed straight to
 * `slice`/`substring`/`substr`. A miss returns -1, -1 does not throw, and the
 * narrowing counts from the END — so `slice(-1)` is the LAST CHARACTER and
 * `slice(0, -1)` is nearly the WHOLE string, and every assertion over the result
 * passes vacuously. The gates themselves must use the per-file `anchorIndex`
 * idiom, which THROWS and names the missing anchor.
 *
 * ⭐ WHY A HELPER AND NOT AN EXEMPTION LIST. The lint rule in
 * `src/__tests__/test-restore-workflow-wiring.test.ts` scans every
 * `src/__tests__/*.test.ts` and `*.test.tsx`, and the calibrations that measure
 * this trap write the offending expression DELIBERATELY. A `file:line`
 * allowlist rots on the next reformat (this branch carries a dated record of
 * exactly that), and fragment assembly — `"sl" + "ice"` — would make the
 * demonstrations unreadable, and the demonstrations ARE the evidence. Routing
 * them through one named function moves every such write OUT of the scanned
 * directory, so the rule needs no exemption at all.
 * ⚠️ MEASURED 2026-09-10: this file was itself briefly hand-added to that
 * scan, which forced a file+function tolerance and a brace-matching span
 * helper onto the gate. Both are gone. This file is NOT scanned — do not
 * re-add it, and do not re-introduce a tolerance to make that possible.
 *
 * ⚠️ Every branch below writes the offending expression LITERALLY. That is
 * deliberate: a reader comparing a calibration to the old code needs the old
 * code in front of them.
 */

/**
 * The shape of the old, unchecked expression being reproduced. Each variant is
 * one of the six forms that were actually written in this repo before W1/WR-07.
 */
export type DegenerateBounds =
  /** `subject.slice(subject.search(re))` */
  | { readonly fromMatch: RegExp }
  /** `subject.slice(subject.lastIndexOf(a) + plus)` */
  | { readonly fromLast: string; readonly plus?: number }
  /** `subject.slice(subject.indexOf(a))`, or `…, subject.indexOf(b))` */
  | { readonly from: string; readonly upTo?: string }
  /** `subject.slice(at, subject.indexOf(b, upToFrom))` */
  | { readonly at: number; readonly upTo: string; readonly upToFrom?: number }
  /** `subject.slice(0, subject.indexOf(b))` */
  | { readonly upTo: string };

/**
 * Reproduce the pre-fix, unchecked narrow and return whatever it degenerates to.
 * Never throws on a missing anchor — not throwing IS the defect under measurement.
 */
export function degenerateNarrow(
  subject: string,
  bounds: DegenerateBounds,
): string {
  if ("fromMatch" in bounds) {
    return subject.slice(subject.search(bounds.fromMatch));
  }
  if ("fromLast" in bounds) {
    return subject.slice(
      subject.lastIndexOf(bounds.fromLast) + (bounds.plus ?? 0),
    );
  }
  if ("from" in bounds) {
    if (bounds.upTo === undefined)
      return subject.slice(subject.indexOf(bounds.from));
    return subject.slice(
      subject.indexOf(bounds.from),
      subject.indexOf(bounds.upTo),
    );
  }
  if ("at" in bounds) {
    return subject.slice(
      bounds.at,
      subject.indexOf(bounds.upTo, bounds.upToFrom),
    );
  }
  return subject.slice(0, subject.indexOf(bounds.upTo));
}
