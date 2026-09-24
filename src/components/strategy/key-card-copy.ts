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

// ---------------------------------------------------------------------------
// KCS-22 (UI-SPEC § KCS-22, S2): the sync panel's poll budget, and what the
// panel says when it runs out. The bounds live here, beside the copy that
// states them, so a sentence can never name a duration the poll does not use.
// ---------------------------------------------------------------------------

/** The sync panel's poll cadence (one `strategy_analytics` read per tick). */
export const POLL_INTERVAL_MS = 3_000;

// I2: module-level constants so they are not re-created on every render and
// are not captured in useCallback closures as reactive values.
// After ~120 s (40 polls × 3 s) the panel stops checking (KCS22-CAP).
// Lineage: this constant moved here from SyncProgress.tsx in Phase 167.2
// (KCS-22); the poll cap used to end the attempt as "error".
export const POLL_MAX_ATTEMPTS = 40;

// After a few initial polls with no analytics row, the panel stops checking so
// the user is not left on "Computing…" forever (KCS22-NOROW).
// RED-TEAM-M2: raised from 3 (9 s) to 10 (30 s) to accommodate Railway
// cold-start latency (15–30 s typical). The 120 s outer cap (POLL_MAX_ATTEMPTS)
// is unchanged; this only widens the missing-row grace window.
// Lineage: moved here from SyncProgress.tsx in Phase 167.2 (KCS-22).
export const MISSING_ROW_GRACE_POLLS = 10;

/**
 * A bound in milliseconds as prose: "N seconds" below one minute, "N minutes"
 * otherwise. Throws on a value that is not a whole number of that unit, so a
 * future bound can never render as a fraction or a rounded lie.
 */
export function formatBoundDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`formatBoundDuration: not a positive duration: ${ms}`);
  }
  if (ms < 60_000) {
    const seconds = ms / 1_000;
    if (!Number.isInteger(seconds)) {
      throw new Error(`formatBoundDuration: ${ms} ms is not a whole number of seconds`);
    }
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }
  const minutes = ms / 60_000;
  if (!Number.isInteger(minutes)) {
    throw new Error(`formatBoundDuration: ${ms} ms is not a whole number of minutes`);
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * Why the sync panel stopped checking without an accepted result (KCS-22).
 * `poll_cap`: the POLL_MAX_ATTEMPTS budget ran out. `missing_row`: the
 * MISSING_ROW_GRACE_POLLS grace ran out and no analytics row was ever seen.
 */
export type PanelStopReason = "poll_cap" | "missing_row";

/**
 * KCS22-CAP and KCS22-NOROW (UI-SPEC § KCS-22), with the durations computed
 * from the bounds above rather than typed into the sentence.
 */
export const PANEL_STOP_COPY = {
  poll_cap: {
    label: "No result yet",
    detail: `This panel stopped checking after ${formatBoundDuration(
      POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS,
    )}. The sync may still be running: reload this page later to see its result.`,
  },
  missing_row: {
    label: "No result yet",
    detail: `This panel stopped checking after ${formatBoundDuration(
      MISSING_ROW_GRACE_POLLS * POLL_INTERVAL_MS,
    )} with nothing recorded yet. The sync may still be running: reload this page later to see its result.`,
  },
} as const satisfies Record<PanelStopReason, { label: string; detail: string }>;
