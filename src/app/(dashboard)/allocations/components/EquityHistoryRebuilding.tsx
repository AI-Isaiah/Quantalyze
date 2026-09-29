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
 * same owner (`dataSourceLabel`), so it discloses nothing new.
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
 * Review C2 WR-02: every line states only what a running job does. The
 * pending line used to say the account is confirmed "on the next daily sync".
 * The stamper runs after every successful poll, but it can come back with no
 * id, and it never runs for a key that is failing to sync. So the pending line
 * says each sync checks again, and a failing key gets its own line, which
 * names the one place the owner can fix it.
 */
const REASON_LINE: Record<
  Exclude<EquityHistoryRebuildReason, "duplicate_account" | "key_not_syncing">,
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

function ExchangesPageLink() {
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
      {reason === "duplicate_account" ? (
        <p className="mt-2 max-w-prose text-sm text-text-secondary">
          Two of your keys read the same exchange account. Disconnect one of
          them on the <ExchangesPageLink /> and the history rebuilds.
        </p>
      ) : reason === "key_not_syncing" ? (
        <p className="mt-2 max-w-prose text-sm text-text-secondary">
          <NotSyncingLine keys={notSyncingKeys} />
        </p>
      ) : reason ? (
        <p className="mt-2 max-w-prose text-sm text-text-secondary">
          {REASON_LINE[reason]}
        </p>
      ) : null}
    </section>
  );
}
