/**
 * Phase 167.2 KEYCARDSYNC: the locked copy for the strategy key card (S1-S3).
 *
 * Every string here is copied VERBATIM from `167.2-UI-SPEC.md` (the house
 * rule from 167 D-11: a locked string is authored once, in the spec, and
 * never paraphrased in code). Tests pin each one character for character with
 * a HAND-TYPED oracle, never by importing this module.
 *
 * Plain constants only: no client directive, so any surface can import it.
 * Later 167.2 plans add their S1-S3 strings here.
 */

/**
 * KCS01-BLOCKED (UI-SPEC § KCS-01, S1). The quotes are ASCII U+0022. The
 * `{keyLabel}` slot takes the attempt's key label, rendered by React as
 * escaped text.
 */
const KCS01_BLOCKED =
  'Wait for the sync of "{keyLabel}" to finish before connecting another key.';

/** KCS01-BLOCKED-NOLABEL (UI-SPEC § KCS-01, S1): the attempt's key has no label. */
const KCS01_BLOCKED_NOLABEL =
  "Wait for the current sync to finish before connecting another key.";

/**
 * Why `Connect Key` is blocked while a tracked sync attempt is live (KCS-01).
 * `label` is the attempt's key label; null, empty or whitespace-only selects
 * KCS01-BLOCKED-NOLABEL.
 *
 * The replacer is a FUNCTION on purpose: a string replacement would expand
 * `$&`, `$'` and similar patterns inside a user-authored label.
 */
export function addKeyBlockedReason(label: string | null | undefined): string {
  if (!label || label.trim() === "") return KCS01_BLOCKED_NOLABEL;
  return KCS01_BLOCKED.replace("{keyLabel}", () => label);
}
