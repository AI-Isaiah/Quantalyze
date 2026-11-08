import Link from "next/link";
import type { EquityHistoryRebuildReason } from "@/lib/queries";

/**
 * The rebuild-reason class table. The Scenario's own-book sentence
 * (`ScenarioComposer.tsx`) and the Overview's missing-data message
 * (`MissingDataMessage.tsx`) both read a reason through it, so the two surfaces
 * cannot class one reason differently.
 *
 * Phase 198 (D-01) replaced the generic equity-history panel that used to live
 * here with `MissingDataMessage`: the panel component, its class headings, its
 * generic body and its per-reason line table are gone, and every sentence the
 * message prints now lives in `MissingDataMessage.tsx`. The file keeps its name
 * because `ScenarioComposer.tsx` imports it.
 */

/**
 * Review C3 SFH-C3-01. What each rebuild reason asks of the owner, in four
 * classes. This table is the ONE place a reason is classed: the Overview message
 * picks its per-reason copy inside the class, and the Scenario's
 * own-book sentence (`ScenarioComposer.tsx`) picks its copy by class alone, so
 * the two surfaces cannot disagree on why the history is withheld.
 *
 * - `needs_action`: nothing rebuilds until the owner fixes a key on the
 *   Exchanges page.
 * - `read_failed`: our read of the history failed; a reload tries again.
 * - `rebuilding`: a wait on a daily run. The reason's own line in `MissingDataMessage` names
 *   that run ("Each daily sync checks it again", "recomputed ... once a
 *   day"), so the Scenario's "being rebuilt" is true for these.
 * - `held_back` (review C3 round 2 WR-02 / SFH-C3R2-03): the history is not
 *   shown and the reason's line names no run that retries it
 *   (`derivation_rejected`: "did not pass its checks, so it is not shown";
 *   `shared_account_history_truncated`: "we cannot join its history ... to the
 *   new key's, so your history is not shown"). Nothing here is a wait (C2 SFH-05 /
 *   SFH-06 and R3-WR-03, see the lines' own comments in `MissingDataMessage`), so the Scenario says
 *   the history is held back, never that it is being rebuilt.
 *
 * The Overview message follows the same class (170.6.2 D-04, kept by Phase 198
 * D-01): only a `rebuilding` reason promises a recompute, and a `held_back`
 * reason says the history is not shown, as the Scenario does.
 */
export const REBUILD_REASON_CLASS = {
  duplicate_account: "needs_action",
  key_not_syncing: "needs_action",
  shared_account_no_working_key: "needs_action",
  history_read_failed: "read_failed",
  account_identity_pending: "rebuilding",
  awaiting_derivation: "rebuilding",
  derivation_rejected: "held_back",
  shared_account_history_truncated: "held_back",
} as const satisfies Record<
  EquityHistoryRebuildReason,
  "needs_action" | "read_failed" | "rebuilding" | "held_back"
>;

export type EquityHistoryRebuildClass =
  (typeof REBUILD_REASON_CLASS)[EquityHistoryRebuildReason];

export type NeedsActionReason = {
  [R in EquityHistoryRebuildReason]: (typeof REBUILD_REASON_CLASS)[R] extends "needs_action"
    ? R
    : never;
}[EquityHistoryRebuildReason];

/**
 * The one guard both surfaces read a reason through. A reason this build does
 * not know (a stale client, a reason added later) or a prototype key such as
 * "constructor" is not a reason: `Object.hasOwn` keeps both out.
 */
export function isKnownRebuildReason(
  reason: EquityHistoryRebuildReason | null | undefined,
): reason is EquityHistoryRebuildReason {
  return reason != null && Object.hasOwn(REBUILD_REASON_CLASS, reason);
}

/**
 * The class of a rebuild reason. Fail-closed: null, a missing reason, or one
 * `isKnownRebuildReason` refuses reads as `rebuilding`, the generic wait,
 * never as a failed read, a key to fix or a hold.
 */
export function equityHistoryRebuildClass(
  reason: EquityHistoryRebuildReason | null | undefined,
): EquityHistoryRebuildClass {
  if (!isKnownRebuildReason(reason)) {
    return "rebuilding";
  }
  return REBUILD_REASON_CLASS[reason];
}

export function isNeedsActionReason(
  reason: EquityHistoryRebuildReason,
): reason is NeedsActionReason {
  return equityHistoryRebuildClass(reason) === "needs_action";
}

/** Exported for the Scenario's own-book sentence (review C3 SFH-C3-01), so both surfaces link the same page. */
export function ExchangesPageLink() {
  return (
    <Link
      href="/profile?tab=exchanges"
      className="text-accent underline underline-offset-4"
    >
      Exchanges page
    </Link>
  );
}
