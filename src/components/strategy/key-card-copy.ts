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
 * KCS-SLOW (UI-SPEC § Review-fix amendments, 167.2-REVIEW WR-07). Shown by
 * the in-flight panel once more than 60 s have passed. It names the panel's
 * OWN limit (the poll budget above) and promises no duration for the sync:
 * RESEARCH P2 measured healthy first crawls far longer than 2 minutes. It
 * replaces "Usually takes 15–30 seconds" and "Large accounts can take up to
 * 2 minutes", both estimates the phase's evidence contradicts.
 */
export const SYNC_SLOW_NOTE = `Large accounts can take longer. This panel checks for ${formatBoundDuration(
  POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS,
)}; the sync may still be running after that.`;

// ---------------------------------------------------------------------------
// KCS-03 (UI-SPEC § KCS-03, S2): the client-side bounds on the two awaits ahead
// of the poll, and what the panel says when one expires. An expiry is not a
// failure: the card cannot know the outcome, so it says what it could not
// confirm (the UI-only `unconfirmed` panel state).
// ---------------------------------------------------------------------------

/**
 * How long the link update (`strategies.update({ api_key_id })`) may take.
 * Evidence window (167.2-RESEARCH Q2): one owner-scoped single-row PostgREST
 * write, the same class of request as `TERMINAL_REREAD_BOUND_MS`' list read
 * in ApiKeyManager.tsx, and supabase-js sets no request timeout of its own.
 * On expiry no enqueue is sent for the attempt (KCS03-LINK).
 */
export const LINK_UPDATE_BOUND_MS = 15_000;

/**
 * How long the enqueue (`POST /api/keys/sync` and its body read) may take.
 * Evidence window (167.2-RESEARCH Q2): above the 126 s slow-but-successful
 * enqueue that `ApiKeyManager.poll.test.tsx` pins as honoured; 12x the 15 s
 * upstream `process-key-enqueue` budget, so an expiry means the network or
 * the route is wedged, not slow; and 120 s below the route's
 * `maxDuration = 300`, so a server-side expiry still arrives as a response
 * first. On expiry the card cannot tell whether a job was enqueued
 * (KCS03-ENQUEUE).
 */
export const ENQUEUE_BOUND_MS = 180_000;

/**
 * Why the sync panel stopped without an accepted result.
 * KCS-22 (`no_result`): `poll_cap`, the POLL_MAX_ATTEMPTS budget ran out;
 * `missing_row`, the MISSING_ROW_GRACE_POLLS grace ran out and no analytics
 * row was ever seen.
 * KCS-03 (`unconfirmed`): `link_bound`, the link update did not answer within
 * LINK_UPDATE_BOUND_MS; `enqueue_bound`, the enqueue did not answer within
 * ENQUEUE_BOUND_MS.
 */
export type PanelStopReason = "poll_cap" | "missing_row" | "link_bound" | "enqueue_bound";

/**
 * KCS22-CAP, KCS22-NOROW (UI-SPEC § KCS-22), KCS03-LINK and KCS03-ENQUEUE
 * (UI-SPEC § KCS-03), with the durations computed from the bounds above rather
 * than typed into the sentence. ⛔ Neither KCS03 string says the sync failed:
 * the card does not know that.
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
  link_bound: {
    label: "Sync not started",
    detail: `This sync did not start: linking the key to this strategy did not answer within ${formatBoundDuration(
      LINK_UPDATE_BOUND_MS,
    )}. Reload this page to check which key is linked before you sync again.`,
  },
  enqueue_bound: {
    label: "Sync not confirmed",
    detail: `We could not confirm this sync started: the request did not answer within ${formatBoundDuration(
      ENQUEUE_BOUND_MS,
    )}, so it may still be running. Reload this page to see the latest status before you sync again.`,
  },
} as const satisfies Record<PanelStopReason, { label: string; detail: string }>;

// ---------------------------------------------------------------------------
// KCS-23 (UI-SPEC § KCS-23, S3): a composite strategy's key card offers no
// control that rewrites `strategies.api_key_id`, and says why in one line.
// ---------------------------------------------------------------------------

/**
 * KCS23-COMPOSITE. Rendered directly under the `Exchange API Keys` header when
 * the strategy is a composite. `support@quantalyze.com` is plain text, not a
 * `mailto:` link, following the shipped csv-finalize precedent.
 */
export const COMPOSITE_CARD_NOTE =
  "This composite strategy reads from every key below. Keys are not linked or synced from this card: contact support@quantalyze.com to change which keys it uses or to re-run its computation.";

// ---------------------------------------------------------------------------
// Review-fix round 1 (2026-09-24, 167.2-REVIEW-SFH H-2): the card with no link
// controls says why, and never invites an action it does not offer.
// ---------------------------------------------------------------------------

/**
 * KCS-SHAPE-UNKNOWN. Rendered directly under the header when the edit page
 * could not read the strategy's member count (`keyShape === "unknown"`). The
 * card then offers no Resync, Use & Sync or Add Key (it might be a composite),
 * and without this line the missing controls were a silent dead end.
 */
export const SHAPE_UNKNOWN_CARD_NOTE =
  "We could not confirm how this strategy's keys are set up, so syncing and adding keys are paused on this page. Reload this page to try again.";

/**
 * KCS-EMPTY-NOLINK. The empty state on a card that offers no Add Key (a
 * composite, or an unknown shape): the first sentence of the empty copy only.
 * Its second sentence, "Add a read-only exchange key …", invites an action the
 * card does not offer.
 */
export const EMPTY_NOLINK_COPY = "No API keys connected.";
