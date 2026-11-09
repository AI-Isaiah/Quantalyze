import type { ReactNode } from "react";
import type { EquityHistoryRebuildReason } from "@/lib/queries";
import { apiKeyLabelById } from "@/lib/api-key-label";
import { formatCloseDay, formatUnpricedDays } from "@/lib/factsheet/returns-unit";
import type { DayRange, KeyDataGap, KeyDataGapCause } from "../lib/key-data-gaps";
import {
  ExchangesPageLink,
  isKnownRebuildReason,
  isNeedsActionReason,
  type NeedsActionReason,
} from "./EquityHistoryRebuilding";

/**
 * Phase 198 plan 09 (D-01, ROUTE-07, SC-2). The Overview's missing-data message:
 * which key, which days, what to do, one line per affected key. It replaces the
 * generic "we are holding back your equity history" panel, which named nothing.
 *
 * Three rules, each pinned by `MissingDataMessage.test.tsx`:
 *
 * - A dead key affects only itself (founder rule). A line names only its own
 *   keys and never says "your keys" or "your book" for one key's fault. The only
 *   "your keys" sentences here are the shipped UNNAMED fallbacks, used when the
 *   producer names no key, and each is about one key or one account.
 * - No date is invented. A line prints the server's ranges, else "since {day}"
 *   when only the first missing day is known, else "no complete history yet".
 * - Every named key is labelled through `apiKeyLabelById(apiKeys)`, the owner's
 *   own key list. A gap id the list does not carry names nothing (T-198-17), so
 *   a foreign or raw key id can never print.
 *
 * Prints no figure and no tone: this file only joins words and dates. The
 * section is a labelled region and not a live region: it is computed on the
 * server from the SSR payload, so it is static at first render.
 */

const HEADING_ID = "overview-missing-data-heading";

export type MissingLine = {
  id: string;
  /** The label the lines sort by, or null for a book-level line (sorted last). */
  sortLabel: string | null;
  content: ReactNode;
};

/**
 * Every book-level sentence, once. Each is worded for the book ("your book's
 * history"), and each is the one home of its sentence: the old panel's
 * `REASON_LINE` table is gone (Phase 198 plan 10, D-01).
 *
 * Review C2 WR-02: every line states only what a running job does. The pending
 * line says each sync checks again, because the stamper can come back with no
 * id. Review C2 SFH-05 / SFH-06: a v2 row the reader refused, or a read that
 * failed, is not a wait on the daily recompute, so neither line names one
 * (a pre-v2 row IS such a wait and reads `awaiting_derivation`). Review C2
 * round 3 R3-WR-03: the writer could not join an older key's history to the
 * newer key's on one account, so the whole book is hidden; no action is named
 * because none heals it in this release (disconnecting the old key drops its
 * history). Active voice (DESIGN.md Voice).
 *
 * Gap 198-UAT-01 (D-10): a book-level line names what the withheld history
 * hides, the equity chart and the ratios built from it, and never names return
 * or risk, because the glance above prints those from the live per-key figures,
 * which this history does not gate (C7, D-06).
 *
 * Keyed by every reason OUTSIDE the `needs_action` class, so moving a reason
 * between classes fails to compile at the call site until its line moves too.
 */
const BOOK_LINE = {
  account_identity_pending:
    "We are confirming which exchange account each key reads. Each daily sync checks it again.",
  awaiting_derivation:
    "Your book's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden.",
  derivation_rejected:
    "The latest rebuild of your book's history did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden.",
  shared_account_history_truncated:
    "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's, so your history is not shown.",
  history_read_failed:
    "We could not load your book's history just now. Reload the page to try again.",
} as const satisfies Record<
  Exclude<EquityHistoryRebuildReason, NeedsActionReason>,
  string
>;

/** A rebuilding book with no known reason: the shipped sentence, never a guessed cause. */
const UNKNOWN_REASON_LINE =
  "The equity chart and the ratios built from it are hidden for now.";

/** The gap cause each needs-action or pending reason is told by. */
const CAUSE_BY_REASON = {
  key_not_syncing: "not_syncing",
  duplicate_account: "duplicate_account",
  shared_account_no_working_key: "shared_account_failing",
  account_identity_pending: "identity_pending",
} as const satisfies Partial<Record<EquityHistoryRebuildReason, KeyDataGapCause>>;

const MAX_EXPANDED_DAYS = 36_600;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/**
 * Every UTC day of the ranges, or null when ANY range is malformed or absurdly
 * long: a range this module cannot read is not guessed at. `formatUnpricedDays`
 * takes a list of days, so the server's `{ from, to }` ranges are expanded first.
 */
function expandDays(ranges: readonly DayRange[] | null): string[] | null {
  if (ranges === null || ranges.length === 0) return null;
  const days: string[] = [];
  for (const { from, to } of ranges) {
    if (!isDay(from) || !isDay(to) || from > to) return null;
    const end = Date.parse(`${to}T00:00:00Z`);
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
      days.push(new Date(t).toISOString().slice(0, 10));
      if (days.length > MAX_EXPANDED_DAYS) return null;
    }
  }
  return days;
}

type Resolved = { gap: KeyDataGap; labels: string[] };

/** The gaps whose every key the owner's list labels. A half-named gap names nothing. */
function resolveGaps(
  gaps: readonly KeyDataGap[],
  apiKeys: ReadonlyArray<{ id: string; exchange: string; label: string }>,
): Resolved[] {
  const labelById = apiKeyLabelById(apiKeys);
  const out: Resolved[] = [];
  for (const gap of gaps) {
    const labels = gap.apiKeyIds.map((id) => labelById.get(id));
    if (labels.length === 0 || labels.some((l) => l === undefined)) continue;
    out.push({ gap, labels: labels as string[] });
  }
  return out;
}

/**
 * The ids a `sync_failing` or `read_incomplete` gap names with a label. The
 * Overview's exit note filters these out, so one fact is said once.
 */
export function namedExitKeyIds(
  gaps: readonly KeyDataGap[],
  apiKeys: ReadonlyArray<{ id: string; exchange: string; label: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const { gap } of resolveGaps(gaps, apiKeys)) {
    if (gap.cause !== "sync_failing" && gap.cause !== "read_incomplete") continue;
    for (const id of gap.apiKeyIds) ids.add(id);
  }
  return ids;
}

/** `A`, `A and B`, `A, B and C`: no serial comma. Each label is its own bold span. */
function Labels({ labels }: { labels: readonly string[] }): ReactNode {
  return labels.map((label, i) => (
    <span key={`${i}:${label}`}>
      {i === 0 ? "" : i === labels.length - 1 ? " and " : ", "}
      <span className="font-semibold text-text-primary">{label}</span>
    </span>
  ));
}

/** `no data for {range}`, `no data since {day}`, or `no complete history yet`. */
function coverage(gap: KeyDataGap, completeWord: "data" | "complete data"): string {
  const days = expandDays(gap.ranges);
  if (days !== null) return `no ${completeWord} for ${formatUnpricedDays(days)}`;
  if (gap.firstMissingDay !== null && isDay(gap.firstMissingDay)) {
    return `no data since ${formatCloseDay(gap.firstMissingDay)}`;
  }
  return "no complete history yet";
}

function GapLine({ gap, labels }: Resolved): ReactNode {
  const names = <Labels labels={labels} />;
  switch (gap.cause) {
    case "not_syncing":
    case "sync_failing":
      return (
        <>
          {names}: {coverage(gap, "data")}. Reconnect the key on the{" "}
          <ExchangesPageLink /> or wait for the next sync.
        </>
      );
    case "read_incomplete":
      return (
        <>
          {names}: {coverage(gap, "complete data")}. Wait for the next sync, or
          reconnect the key on the <ExchangesPageLink /> if this persists.
        </>
      );
    case "duplicate_account":
      return (
        <>
          {names} read the same exchange account. Disconnect one of them on the{" "}
          <ExchangesPageLink /> and the history rebuilds.
        </>
      );
    case "shared_account_failing":
      return (
        <>
          {names}: {coverage(gap, "data")}. Fix or reconnect one of these keys on
          the <ExchangesPageLink />.
        </>
      );
    case "identity_pending":
      return (
        <>
          {names}: we are confirming which exchange account this key reads. Each
          daily sync checks it again.
        </>
      );
    default: {
      const unhandled: never = gap.cause;
      return unhandled;
    }
  }
}

export type NotSyncingKey = { id: string; exchange: string; label: string };

/**
 * Review C2 round 2 IN-04, 170.6.2 D-02. The key_not_syncing line. With exactly
 * one key it reads "One of your keys, {label}, is not syncing, ..."; with two or
 * more, "Some of your keys are not syncing, ..."; and with the keys unknown
 * (null) or unresolvable, "One of your keys is not syncing, ...", which is
 * true for any count of at least one.
 */
function NotSyncingLine({ keys }: { keys: readonly NotSyncingKey[] | null }) {
  if (keys !== null && keys.length === 1) {
    // Phase 198 plan 09: the one key-label rule, not a hand-built label.
    const name = apiKeyLabelById([keys[0]]).get(keys[0].id);
    return (
      <>
        One of your keys, {name}, is not syncing, so we cannot confirm which
        exchange account it reads. Check it on the <ExchangesPageLink />.
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
      One of your keys is not syncing, so we cannot confirm which exchange
      account it reads. Check it on the <ExchangesPageLink />.
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

/**
 * The lines the message prints, key lines sorted by label and book-level lines
 * last. A gap line is printed whenever the owner's list labels its keys. The
 * reason's shipped fallback is added only while the history is rebuilding and
 * only when not every gap of the reason's own cause printed a named line, so a
 * rebuilding book always gets at least one line and no affected key is dropped.
 */
export function missingDataLines({
  gaps,
  apiKeys,
  rebuilding,
  reason,
  notSyncingKeys,
}: {
  gaps: readonly KeyDataGap[];
  apiKeys: ReadonlyArray<{ id: string; exchange: string; label: string }>;
  rebuilding: boolean;
  reason: EquityHistoryRebuildReason | null | undefined;
  notSyncingKeys: readonly NotSyncingKey[] | null;
}): MissingLine[] {
  const keyLines: MissingLine[] = [];
  const resolvedGaps = resolveGaps(gaps, apiKeys);
  // A cause's fallback is suppressed only when EVERY gap of that cause printed
  // a named line. A gap the owner's list cannot label names nothing, so the
  // fallback must still say that key is affected (review SFH-4).
  const causesPrinted = new Set<KeyDataGapCause>();
  for (const { gap } of resolvedGaps) {
    const all = gaps.filter((g) => g.cause === gap.cause).length;
    const named = resolvedGaps.filter((r) => r.gap.cause === gap.cause).length;
    if (named === all) causesPrinted.add(gap.cause);
  }
  // A not-syncing key whose history reaches yesterday has no gap, so the gap
  // count cannot see it. The reason attributes its keys: the fallback stays
  // unless every one of them is in a printed line (review R3-01). With the
  // keys unknown (null) there is nothing to compare, so the gaps decide.
  if (causesPrinted.has("not_syncing") && notSyncingKeys !== null) {
    const printed = new Set(
      resolvedGaps
        .filter((r) => r.gap.cause === "not_syncing")
        .flatMap((r) => r.gap.apiKeyIds),
    );
    if (!notSyncingKeys.every((k) => printed.has(k.id))) {
      causesPrinted.delete("not_syncing");
    }
  }
  for (const resolved of resolvedGaps) {
    keyLines.push({
      id: `gap:${resolved.gap.cause}:${resolved.gap.apiKeyIds.join(",")}`,
      sortLabel: resolved.labels.join(" and "),
      content: <GapLine {...resolved} />,
    });
  }
  keyLines.sort(
    (a, b) =>
      (a.sortLabel as string).localeCompare(b.sortLabel as string) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const bookLines: MissingLine[] = [];
  if (rebuilding) {
    if (!isKnownRebuildReason(reason)) {
      if (keyLines.length === 0) {
        bookLines.push({ id: "book:unknown", sortLabel: null, content: UNKNOWN_REASON_LINE });
      }
    } else if (isNeedsActionReason(reason)) {
      if (!causesPrinted.has(CAUSE_BY_REASON[reason])) {
        bookLines.push({
          id: `book:${reason}`,
          sortLabel: null,
          content: <NeedsActionLine reason={reason} notSyncingKeys={notSyncingKeys} />,
        });
      }
    } else if (reason === "account_identity_pending") {
      if (!causesPrinted.has(CAUSE_BY_REASON[reason])) {
        bookLines.push({ id: `book:${reason}`, sortLabel: null, content: BOOK_LINE[reason] });
      }
    } else {
      bookLines.push({ id: `book:${reason}`, sortLabel: null, content: BOOK_LINE[reason] });
    }
  }
  return [...keyLines, ...bookLines];
}

export function MissingDataMessage({ lines }: { lines: readonly MissingLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section
      aria-labelledby={HEADING_ID}
      data-testid="overview-missing-data"
      className="mt-4 max-w-[1100px]"
    >
      <p
        id={HEADING_ID}
        className="text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted"
      >
        What is missing
      </p>
      {lines.map((line) => (
        <p
          key={line.id}
          className="mt-2 max-w-prose text-sm text-text-secondary [overflow-wrap:anywhere]"
        >
          {line.content}
        </p>
      ))}
    </section>
  );
}
