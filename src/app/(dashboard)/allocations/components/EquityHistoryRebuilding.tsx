import Link from "next/link";
import type { EquityHistoryRebuildReason } from "@/lib/queries";
import { dataSourceLabel } from "@/lib/api-key-label";

/**
 * Phase 167.1.2 / D-02 ("Hide it until correct").
 *
 * The Overview's stand-in for the allocator equity curve and the factsheet
 * panels built from it, rendered while `equityHistoryState !== "ready"`.
 * The producer (`derivePhase07Fields`) withholds the curve because it could
 * count one exchange account twice or read a day with no sync as zero; a wrong
 * number the allocator can act on is worse than an honest absence.
 *
 * Static copy only: no number, no date and no id (the one key label below is
 * the owner's own, see IN-04). The body promises nothing
 * about when the history returns; plan 11's reason line names only the daily
 * cadence the sync and the recompute run on. Every sentence must be true for
 * EVERY allocator who sees it (review
 * round 1 WR-03 / SFH-05): a single-key book, a first connect that never saw a
 * chart, and a stale book under the StalenessBanner. So the cause is worded as
 * a property of the history ("could", "when more than one key reads it"), no
 * sentence refers to an "earlier chart", and the holdings sentence says those
 * figures do not use this history rather than calling them current.
 *
 * Phase 167.1.2 plan 11 adds ONE authored line under the body, chosen by the
 * producer's `equityHistoryRebuildReason` (the first failing condition of
 * `equityHistoryReadiness`). No reason, no line. The line names a condition,
 * never an id or a number (T-167.1.2-22a), with one exception (review C2
 * round 2 IN-04): when exactly one key is not syncing, the key_not_syncing
 * line names it by the owner's own label, `{Exchange} — {nickname}`, or the
 * masked id tail (`••••` + last 4) when the key has no nickname. That is the
 * label the Exchanges page key note and the Scenario rows already show the
 * same owner (`dataSourceLabel`), so it discloses nothing new. Review C2
 * round 3 R3-WR-03: a writer verdict with a shared-account cause
 * (`shared_account_no_working_key`, `shared_account_history_truncated`) gets
 * its own line rather than the generic `derivation_rejected` one.
 *
 * Tokens follow DESIGN.md (mono eyebrow at the 0.18em tracking step, DM Sans
 * on the fluid `text-h3` tier, secondary body text) and the layout is
 * left-aligned (the AI-Slop ban on centered-everything layouts).
 *
 * Semantics (review round 1 WR-04 / IN-03): the heading is an `<h2>`, because
 * the only heading above it on the Overview is the page `<h1>` and axe's
 * `heading-order` rule (the best-practice tag `buildAxe` runs) fails an h1 to
 * h3 skip. The H3 in DESIGN.md is a visual size, not a heading level. The
 * section is a labelled region, not `role="status"`: the panel is static and
 * mounted at first render, so a live region announces nothing and would only
 * replace the region landmark.
 */
const HEADING_ID = "overview-equity-rebuilding-heading";

/**
 * Review C3 SFH-C3-01. What each rebuild reason asks of the owner, in three
 * classes. This table is the ONE place a reason is classed: the Overview line
 * below picks its per-reason copy inside the class, and the Scenario's
 * own-book sentence (`ScenarioComposer.tsx`) picks its copy by class alone, so
 * the two surfaces cannot disagree on why the history is withheld.
 *
 * - `needs_action`: nothing rebuilds until the owner fixes a key on the
 *   Exchanges page.
 * - `read_failed`: our read of the history failed; a reload tries again.
 * - `rebuilding`: a wait on a running job, or a hold no owner action heals in
 *   this release. The generic "being rebuilt" copy is true for these.
 */
const REBUILD_REASON_CLASS = {
  duplicate_account: "needs_action",
  key_not_syncing: "needs_action",
  shared_account_no_working_key: "needs_action",
  history_read_failed: "read_failed",
  account_identity_pending: "rebuilding",
  awaiting_derivation: "rebuilding",
  derivation_rejected: "rebuilding",
  shared_account_history_truncated: "rebuilding",
} as const satisfies Record<
  EquityHistoryRebuildReason,
  "needs_action" | "read_failed" | "rebuilding"
>;

export type EquityHistoryRebuildClass =
  (typeof REBUILD_REASON_CLASS)[EquityHistoryRebuildReason];

type NeedsActionReason = {
  [R in EquityHistoryRebuildReason]: (typeof REBUILD_REASON_CLASS)[R] extends "needs_action"
    ? R
    : never;
}[EquityHistoryRebuildReason];

/**
 * The class of a rebuild reason. Fail-closed: null, a missing reason, or a
 * string this build does not know (a stale client, a reason added later)
 * reads as `rebuilding`, the generic wait, never as a failed read or a key to
 * fix. `Object.hasOwn` keeps a prototype key such as "constructor" out.
 */
export function equityHistoryRebuildClass(
  reason: EquityHistoryRebuildReason | null | undefined,
): EquityHistoryRebuildClass {
  if (reason == null || !Object.hasOwn(REBUILD_REASON_CLASS, reason)) {
    return "rebuilding";
  }
  return REBUILD_REASON_CLASS[reason];
}

function isNeedsActionReason(
  reason: EquityHistoryRebuildReason,
): reason is NeedsActionReason {
  return equityHistoryRebuildClass(reason) === "needs_action";
}

/**
 * Review C2 WR-02: every line states only what a running job does. The
 * pending line used to say the account is confirmed "on the next daily sync".
 * The stamper runs after every successful poll, but it can come back with no
 * id, and it never runs for a key that is failing to sync. So the pending line
 * says each sync checks again, and a failing key gets its own line, which
 * names the one place the owner can fix it.
 *
 * Review C3 SFH-C3-01: keyed by every reason OUTSIDE the `needs_action` class,
 * so moving a reason between classes fails to compile here until its line
 * moves too.
 */
const REASON_LINE: Record<
  Exclude<EquityHistoryRebuildReason, NeedsActionReason>,
  string
> = {
  account_identity_pending:
    "We are confirming which exchange account each key reads. Each daily sync checks it again.",
  awaiting_derivation:
    "Your history is recomputed from each account's returns and cash flows once a day.",
  // Review C2 SFH-05 / SFH-06: a v2 row the reader refused, or a read that
  // failed, is not a wait on the daily recompute, so neither line names one.
  // (Review C2 round 2 R2-CR-03: a pre-v2 row IS such a wait and reads
  // awaiting_derivation.)
  derivation_rejected:
    "The latest rebuild of your history did not pass its checks, so it is not shown.",
  // Review C2 round 3 R3-WR-03: the writer could not join an older key's
  // history to the newer key's on one account, so the whole book is hidden.
  // No action is named because none heals it in this release: disconnecting
  // the old key drops its history.
  shared_account_history_truncated:
    "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's yet, so your history is not shown.",
  // Review C2 round 2 IN-05: active voice (DESIGN.md Voice).
  history_read_failed:
    "We could not load your history just now. Reload the page to try again.",
};

type NotSyncingKey = { id: string; exchange: string; label: string };

/**
 * Review C2 round 2 IN-04. The key_not_syncing line. It names the key when
 * there is exactly one, uses a plural line for two or more, and falls back to
 * an unnamed line that is true for any count when the keys are unknown (null).
 */
function NotSyncingLine({ keys }: { keys: readonly NotSyncingKey[] | null }) {
  if (keys !== null && keys.length === 1) {
    const { exchange, nickname, maskedTail } = dataSourceLabel(keys[0]);
    const name = `${exchange} — ${nickname ?? maskedTail}`;
    return (
      <>
        Your key {name} is not syncing, so we cannot confirm which exchange
        account it reads. Check it on the <ExchangesPageLink />.
      </>
    );
  }
  if (keys !== null && keys.length > 1) {
    return (
      <>
        Some of your keys are not syncing, so we cannot confirm which exchange
        accounts they read. Check them on the <ExchangesPageLink />.
      </>
    );
  }
  return (
    <>
      A key is not syncing, so we cannot confirm which exchange account it
      reads. Check it on the <ExchangesPageLink />.
    </>
  );
}

/**
 * The line for a `needs_action` reason: each names the one place the owner
 * can fix it. The switch is exhaustive over the class, so a reason added to
 * `needs_action` without a line fails to compile.
 */
function NeedsActionLine({
  reason,
  notSyncingKeys,
}: {
  reason: NeedsActionReason;
  notSyncingKeys: readonly NotSyncingKey[] | null;
}) {
  switch (reason) {
    case "duplicate_account":
      return (
        <>
          Two of your keys read the same exchange account. Disconnect one of
          them on the <ExchangesPageLink /> and the history rebuilds.
        </>
      );
    case "key_not_syncing":
      return <NotSyncingLine keys={notSyncingKeys} />;
    case "shared_account_no_working_key":
      // Review C2 round 3 R3-WR-03: the payload does not say which account,
      // so the line names none (T-167.1.2-22a) and points at the one place
      // the owner can fix a key.
      return (
        <>
          The keys that read one of your exchange accounts are all failing to
          sync, so that account&apos;s history stops. Fix or reconnect one of
          them on the <ExchangesPageLink />.
        </>
      );
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
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

export function EquityHistoryRebuilding({
  reason = null,
  notSyncingKeys = null,
}: {
  reason?: EquityHistoryRebuildReason | null;
  /** Review C2 round 2 IN-04: the keys a key_not_syncing reason is about, or null when unknown. */
  notSyncingKeys?: readonly NotSyncingKey[] | null;
}) {
  return (
    <section
      aria-labelledby={HEADING_ID}
      data-testid="overview-equity-rebuilding"
      className="mt-6 max-w-[1100px] border-t border-border py-8"
    >
      <p className="text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted">
        Equity history
      </p>
      <h2
        id={HEADING_ID}
        className="mt-3 text-h3 font-semibold text-text-primary"
      >
        Your equity history is being rebuilt
      </h2>
      <p className="mt-2 max-w-prose text-sm text-text-secondary">
        The equity chart and the ratios built from it are hidden for now. The
        history behind them could count one exchange account twice when more
        than one key reads it, or read a day with no sync as zero. Holdings and
        AUM on this page do not use that history.
      </p>
      {reason && isNeedsActionReason(reason) ? (
        <p className="mt-2 max-w-prose text-sm text-text-secondary">
          <NeedsActionLine reason={reason} notSyncingKeys={notSyncingKeys} />
        </p>
      ) : reason ? (
        <p className="mt-2 max-w-prose text-sm text-text-secondary">
          {REASON_LINE[reason]}
        </p>
      ) : null}
    </section>
  );
}
