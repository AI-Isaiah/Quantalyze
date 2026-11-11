/**
 * Phase 199 plan 03 (D-04, CD-05, SC-4) — the ONE registry of degrade warnings.
 *
 * A degrade warning is any user-visible sentence saying that figures on a surface
 * are missing, partial, excluded, held back or stale because of a data, key or
 * computation condition (199-UI-SPEC.md "Degrade-warning copy contract"). Every
 * one names its scope (a key, a day, or both) and one action from the closed
 * vocabulary below. The copy lives HERE and nowhere else: a surface renders an
 * entry through `DegradeLine`, never an inline string.
 *
 * Two tests keep it honest (CLAUDE.md Rule 9, both shown RED first):
 *   - `degrade-warnings.test.tsx` renders a fixture sample for EVERY entry and
 *     fails when a degrade-class sample names neither its fixture key label nor
 *     its fixture day, or lacks its action sentence verbatim.
 *   - `src/__tests__/degrade-warning-scan.test.ts` pins, per scanned file, the
 *     count of warning-styling hits and the set of registry ids the file names,
 *     so a warning added to a scanned surface without an entry fails.
 *
 * ⛔ The action vocabulary is CLOSED. An id added later must quote a UI-SPEC
 * target line or shipped copy verbatim and record that origin beside it.
 *
 * No React and no client directive: server pages and client components both
 * import this file (copy-module convention, as `status-surface-copy.ts`).
 */

import { formatCloseDay, formatUnpricedDays } from "./factsheet/returns-unit";
import type { StrategyShape } from "./strategy-shape";
import type { UntrustedKeySyncStatus } from "./closed-sets";
import type { ComputeState } from "./compute-state";
import {
  KCS10_PUBLIC_SENTENCE,
  ownerStateIsDated,
  ownerStateLine,
  untrustedKeyCaption,
  type OwnerBuildFacts,
} from "./status-surface-copy";

/** The closed class set (UI-SPEC "What counts"). Only `degrade` must name its scope. */
export const DEGRADE_CLASSES = [
  "degrade",
  "read_failure",
  "in_progress",
  "composition",
  "share_status",
  "provenance",
  "empty",
  "recipient",
] as const;
export type DegradeClass = (typeof DEGRADE_CLASSES)[number];

/** What a warning names: a key, a day, both, the whole book history, or (recipient views) nothing owner-specific. */
export const DEGRADE_SCOPES = [
  "key",
  "day",
  "key_day",
  "whole_history",
  "recipient",
  "none",
] as const;
export type DegradeScope = (typeof DEGRADE_SCOPES)[number];

/** The surfaces a warning can live on. Ids carry the matching prefix (`SURFACE_ID_PREFIX`). */
export const DEGRADE_SURFACES = [
  "my-allocation",
  "scenario",
  "strategies-list",
  "factsheet",
] as const;
export type DegradeSurface = (typeof DEGRADE_SURFACES)[number];

/** The id prefix each surface's entries carry: `allocation.staleness`, `scenario.…`. */
export const SURFACE_ID_PREFIX = {
  "my-allocation": "allocation",
  scenario: "scenario",
  "strategies-list": "strategies",
  factsheet: "factsheet",
} as const satisfies Record<DegradeSurface, string>;

/** Where an action sentence links. `none` is a plain sentence (a wait, or a reload). */
export type ActionLink =
  | "exchanges"
  | "contact"
  | "edit"
  | "csv"
  | "deselect"
  | "none";

/**
 * The action vocabulary. Sentences are verbatim from the UI-SPEC's "Action
 * vocabulary" table. `phrase` is the exact substring `DegradeLine` turns into the
 * link (absent for `none`).
 *
 * A-RECONNECT-ANY-OR-WAIT is the one id this plan adds: the UI-SPEC's own
 * StalenessBanner target action ("Reconnect a key on the Exchanges page, or wait
 * for the next sync."), because "Reconnect the key" is false for a book-wide
 * staleness. Origin: 199-UI-SPEC.md, "My allocation" inventory seed, StalenessBanner row.
 */
export const ACTION_SENTENCES = {
  "A-RECONNECT": {
    sentence: "Reconnect the key on the Exchanges page.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-RECONNECT-OR-WAIT": {
    sentence: "Reconnect the key on the Exchanges page or wait for the next sync.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-RECONNECT-ANY-OR-WAIT": {
    sentence: "Reconnect a key on the Exchanges page, or wait for the next sync.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-WAIT-SYNC": {
    sentence:
      "Wait for the next sync, or reconnect the key on the Exchanges page if this persists.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-WAIT-RECOMPUTE": {
    sentence: "They appear after the next daily recompute.",
    link: "none",
  },
  "A-WAIT-CLOSE": {
    sentence: "It is priced once that day's BTC close is stored.",
    link: "none",
  },
  "A-DISCONNECT-DUP": {
    sentence: "Disconnect one of them on the Exchanges page and the history rebuilds.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-EDIT": {
    sentence: "Check its key on the edit page.",
    link: "edit",
    phrase: "edit page",
  },
  "A-CSV": {
    sentence: "Upload a newer CSV to extend the record.",
    link: "csv",
    phrase: "Upload a newer CSV",
  },
  "A-CONTACT-CHECK": {
    sentence: "Use the contact form to have it checked.",
    link: "contact",
    phrase: "contact form",
  },
  "A-CONTACT-RESOLVE": {
    sentence: "Use the contact form to have it resolved.",
    link: "contact",
    phrase: "contact form",
  },
  "A-RELOAD": {
    sentence: "Reload this page to try again.",
    link: "none",
  },
  "A-DESELECT": {
    sentence: "Deselect it to restore a common coverage window.",
    link: "deselect",
    phrase: "Deselect it",
  },
  // Shipped-origin ids (199-05). Each quotes a sentence Phase 198's MissingDataMessage
  // already printed, word for word, because 198 D-01 carries that copy forward and a
  // near-match from the table above would change it. Origin: MissingDataMessage.tsx at
  // 199-05's base (`GapLine` identity_pending / shared_account_failing, `NotSyncingLine`).
  "A-WAIT-IDENTITY": {
    sentence: "Each daily sync checks it again.",
    link: "none",
  },
  "A-CHECK-IT": {
    sentence: "Check it on the Exchanges page.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-FIX-ONE-OF-THESE": {
    sentence: "Fix or reconnect one of these keys on the Exchanges page.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  // `NotSyncingLine` (several keys) and `NeedsActionLine` (shared account, no working key).
  "A-CHECK-THEM": {
    sentence: "Check them on the Exchanges page.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  "A-FIX-ONE-OF-THEM": {
    sentence: "Fix or reconnect one of them on the Exchanges page.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  // 199-15 (D-04): the one named wait this plan records. Origin: 199-UI-SPEC.md,
  // "My allocation" inventory, Scenario per-source fallback row: "Per-source toggles
  // appear after their next sync." (the row calls it "the named wait").
  "A-WAIT-NEXT-SYNC": {
    sentence: "Per-source toggles appear after their next sync.",
    link: "none",
  },
  // 199-16 (D-03, CD-11): the strategies list's Health detail ends on the viewer's own
  // remedy. A manager (and `both`) keeps `ownerRemedy`, so its sentences are quoted here
  // word for word, each with the one link its text carries (the `phrase`). Origin:
  // status-surface-copy.ts `RELOAD_REMEDY` (KCS09-RELOAD) and `shapeRemedy` (KCS21-SINGLE,
  // -UNLINKED, -COMPOSITE, -CSV). The three `KCS09` contact and read-again remedies are
  // already A-CONTACT-RESOLVE, A-CONTACT-CHECK and A-RELOAD. `degrade-warnings.test.tsx`
  // sweeps `ownerRemedy` over every state, shape and build fact and fails when a remedy's
  // words stop matching the id `ownerRemedyAction` maps it to.
  "A-OWNER-RELOAD": {
    sentence: "Reload this page to see the latest status.",
    link: "none",
  },
  "A-RESYNC-EDIT": {
    sentence:
      "Start a new computation with Resync on this strategy's edit page. Use the contact form if it does not complete.",
    link: "edit",
    phrase: "edit page",
  },
  "A-LINK-KEY-EDIT": {
    sentence:
      "Link a key with Change key… on this strategy's edit page (add one on your Profile API keys tab first if you have none) to start a new computation. Use the contact form if it does not complete.",
    link: "edit",
    phrase: "edit page",
  },
  "A-COMPOSITE-CONTACT": {
    sentence:
      "A composite strategy has no self-serve re-run. Use the contact form to start a new computation.",
    link: "contact",
    phrase: "contact form",
  },
  "A-CSV-FIXED": {
    sentence:
      "A CSV strategy's data is fixed at upload. To publish a corrected series, upload a new CSV strategy, or use the contact form.",
    link: "csv",
    phrase: "upload a new CSV strategy",
  },
  // 199-16 (CD-11): the allocator-only viewer's path for an API or composite strategy, since
  // the edit route is manager-guarded. Origin: 199-UI-SPEC.md, "Row note, the Health detail",
  // Stale (no data yet) row: "Check its key on the Exchanges page."
  "A-EXCHANGES-KEY": {
    sentence: "Check its key on the Exchanges page.",
    link: "exchanges",
    phrase: "Exchanges page",
  },
  // 199-16 Task 2: the helper AllocatorSyncStatus prints under a strategy key's pill, which
  // is the Key problem line's action (199-UI-SPEC "Row note", Key problem row: "its shipped
  // helper"). Origin: AllocatorSyncStatus.tsx `REVOKED_HELPER` and `CREDENTIAL_FAILED_HELPER`,
  // word for word (U+2014 em dash); `degrade-warnings.test.tsx` renders the real pill and
  // fails when either stops being what it prints.
  "A-READD-KEY": {
    sentence: "Re-add a read-only key from your exchange.",
    link: "none",
  },
  "A-UPDATE-CREDENTIALS": {
    sentence: "Update this account's credentials \u2014 they may have changed.",
    link: "none",
  },
  // 199-18 (D-04, UI-SPEC OQ-3): the recipient and public views' one action. A recipient or a
  // visitor cannot reconnect a key or open the owner's contact form with the owner's strategy, so
  // the only true action is to ask whoever sent them the link. Origins: 199-UI-SPEC.md,
  // "Factsheet" inventory, Degraded members row ("Check with the person who shared this link."),
  // and `SHARE_CARD_COPY.not_available.body`'s closing sentence (KCS11-B), word for word. Neither
  // links anywhere.
  "A-ASK-SHARER": {
    sentence: "Check with the person who shared this link.",
    link: "none",
  },
  "A-ASK-SHARER-RETRY": {
    sentence: "Check with the person who shared this link before trying again.",
    link: "none",
  },
} as const satisfies Record<
  string,
  { sentence: string; link: ActionLink; phrase?: string }
>;
export type ActionId = keyof typeof ACTION_SENTENCES;

/**
 * The vocabulary id for each `ownerRemedy` remedy (its `id`). A remedy `ownerRemedy` adds
 * and this table lacks falls back to the contact form, which is true of every state and
 * opens for every role; the sweep in `degrade-warnings.test.tsx` fails first.
 */
const OWNER_REMEDY_ACTION = new Map<string, AnalyticsFailedAction>([
  ["KCS09-RELOAD", "A-OWNER-RELOAD"],
  ["KCS09-CONTACT-PERMANENT", "A-CONTACT-RESOLVE"],
  ["KCS09-CONTACT-CHECK", "A-CONTACT-CHECK"],
  ["KCS09-UNREADABLE", "A-RELOAD"],
  ["KCS21-SINGLE", "A-RESYNC-EDIT"],
  ["KCS21-UNLINKED", "A-LINK-KEY-EDIT"],
  ["KCS21-COMPOSITE", "A-COMPOSITE-CONTACT"],
  ["KCS21-CSV", "A-CSV-FIXED"],
]);

/** The action a manager's `ownerRemedy` result is, as a vocabulary id. */
export function ownerRemedyAction(remedy: { id: string }): AnalyticsFailedAction {
  return OWNER_REMEDY_ACTION.get(remedy.id) ?? "A-CONTACT-CHECK";
}

/**
 * The action a row's detail ends on for THIS viewer (CD-11). A manager (and `both`) keeps
 * `ownerRemedy`. An allocator-only viewer keeps it too, except for the shape remedies
 * (`KCS21-*`), which link the manager-guarded edit page or CSV wizard: for them an API or
 * composite strategy points at the Exchanges page, and anything else (a CSV strategy,
 * whose upload route is manager-guarded, or a strategy with no key) at the contact form,
 * which opens for every role.
 */
export function viewerRemedyAction(input: {
  remedy: { id: string };
  /** The viewer is a manager or `both` (the roles that can open the edit page). */
  managerSurface: boolean;
  shape: StrategyShape | "unknown";
}): AnalyticsFailedAction {
  const owner = ownerRemedyAction(input.remedy);
  if (input.managerSurface || !input.remedy.id.startsWith("KCS21-")) return owner;
  return input.shape === "single" || input.shape === "composite"
    ? "A-EXCHANGES-KEY"
    : "A-CONTACT-CHECK";
}

/**
 * The only ids allowed `whole_history` scope (D-05, CD-09, CD-14 OQ-2: a count-pinned
 * allowlist). Each one's text contains `whole history`. Raising this list needs a
 * recorded reason: 199-05 raised it from 1 to 10 for the Phase 198 book-level lines,
 * whose payloads carry neither a key id nor a day range. Every `allocation.book.*`
 * entry here is such a line; `allocation.book.history-read-failed` is not (it is a
 * read_failure with scope none).
 */
export const WHOLE_HISTORY_IDS = [
  "allocation.departed-history",
  "allocation.book.awaiting-derivation",
  "allocation.book.derivation-rejected",
  "allocation.book.shared-account-history-truncated",
  "allocation.book.unknown-reason",
  "allocation.book.identity-pending",
  "allocation.book.duplicate-account",
  "allocation.book.key-not-syncing",
  "allocation.book.keys-not-syncing",
  "allocation.book.shared-account-no-working-key",
] as const;

/**
 * What an entry's `text(args)` returns: plain strings, a key label (rendered
 * semibold by `DegradeLine`), and the action sentence with its link.
 */
export type DegradeSegment =
  | string
  | { label: string }
  | { action: ActionId; strategyId?: string };

/** The registry's entry shape (the contract 199-05, 199-15, 199-16, 199-18 build on). */
export interface DegradeEntry {
  /** Dotted, surface prefix first (`allocation.staleness`). */
  id: string;
  surface: DegradeSurface;
  class: DegradeClass;
  scope: DegradeScope;
  /** A vocabulary id; `null` for classes that need none. */
  action: ActionId | null;
  /**
   * 199-16: an entry whose closing action depends on the viewer's role (CD-11) lists every
   * action its `text` may end on; `action` is the default. The registry test renders the
   * sample once per listed action and fails when one does not say its sentence verbatim.
   */
  actions?: readonly ActionId[];
  /**
   * `read_failure` and `recipient` entries may name a shipped sentence as their
   * action when no vocabulary id fits (UI-SPEC OQ-3).
   */
  shippedAction?: string;
  /** Pure: key labels and ISO days in, segments out. No clock. */
  text?: (args: never) => DegradeSegment[];
}

/** Key labels as segments: `A`, `A and B`, `A, B and C` (no serial comma), each its own `{ label }`. */
export function labelSegments(labels: readonly string[]): DegradeSegment[] {
  const out: DegradeSegment[] = [];
  labels.forEach((label, i) => {
    if (i > 0) out.push(i === labels.length - 1 ? " and " : ", ");
    out.push({ label });
  });
  return out;
}

/**
 * What a per-key gap line says about WHEN: the missing days (the caller expands the
 * server's ranges and validates them), only the first missing day, or nothing known.
 * The words "no data for", "no data since" and "no complete history yet" live here.
 */
export type GapCoverage = { days: readonly string[] } | { since: string } | null;

/** `no data for {range}`, `no data since {day}`, or `no complete history yet` (Phase 198 D-01 wording). */
function coverageText(coverage: GapCoverage, word: "data" | "complete data"): string {
  if (coverage === null) return "no complete history yet";
  if ("days" in coverage) return `no ${word} for ${formatUnpricedDays(coverage.days)}`;
  return `no data since ${formatCloseDay(coverage.since)}`;
}

/** The D-10 sentence that carries a book-wide scope; the unnamed fallbacks lead with it. */
const HISTORY_HIDDEN =
  "The equity chart and the ratios built from it are hidden for your whole history. ";

/**
 * Every action the Analytics failed detail may end on: a manager's `ownerRemedy` (every id
 * `ownerRemedyAction` can return) and the allocator-only viewer's two (CD-11).
 */
export const ANALYTICS_FAILED_ACTIONS = [
  "A-CONTACT-RESOLVE",
  "A-OWNER-RELOAD",
  "A-RELOAD",
  "A-CONTACT-CHECK",
  "A-RESYNC-EDIT",
  "A-LINK-KEY-EDIT",
  "A-COMPOSITE-CONTACT",
  "A-CSV-FIXED",
  "A-EXCHANGES-KEY",
] as const satisfies readonly ActionId[];
export type AnalyticsFailedAction = (typeof ANALYTICS_FAILED_ACTIONS)[number];

/** The four ways the Stale detail ends: a CSV upload, the edit page, the Exchanges page (CD-11), the contact form. */
export const STALE_ACTIONS = [
  "A-EDIT",
  "A-CSV",
  "A-EXCHANGES-KEY",
  "A-CONTACT-CHECK",
] as const satisfies readonly ActionId[];
export type StaleAction = (typeof STALE_ACTIONS)[number];

/** The helper each untrusted key status prints beside its pill (the key line's action). */
export const KEY_PROBLEM_ACTION = {
  revoked: "A-READD-KEY",
  sign_in_failed: "A-UPDATE-CREDENTIALS",
} as const satisfies Record<UntrustedKeySyncStatus, ActionId>;
export type KeyProblemAction = (typeof KEY_PROBLEM_ACTION)[UntrustedKeySyncStatus];

export const DEGRADE_WARNINGS = [
  {
    id: "allocation.staleness",
    surface: "my-allocation",
    class: "degrade",
    scope: "day",
    action: "A-RECONNECT-ANY-OR-WAIT",
    /** `day` is an ISO `YYYY-MM-DD`: the newest sync across the owner's keys (UTC). Never a relative age. */
    text: (a: { day: string }): DegradeSegment[] => [
      `Analytics may be stale: no exchange key has synced since ${formatCloseDay(a.day)}. `,
      { action: "A-RECONNECT-ANY-OR-WAIT" },
    ],
  },
  {
    id: "allocation.staleness-never",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-RECONNECT-ANY-OR-WAIT",
    /** No key has ever synced, so there is no day: the line names the keys. `labels` are the owner's key labels, sorted by the caller. */
    text: (a: { labels: readonly string[] }): DegradeSegment[] =>
      a.labels.length === 0
        ? [
            "Analytics may be stale: no exchange key has completed a sync yet. ",
            { action: "A-RECONNECT-ANY-OR-WAIT" },
          ]
        : [
            "Analytics may be stale: ",
            ...labelSegments(a.labels),
            ` ${a.labels.length === 1 ? "has" : "have"} not completed a sync yet. `,
            { action: "A-RECONNECT-ANY-OR-WAIT" },
          ],
  },
  // Phase 186 plan 08 (D-03, D-05, D-07, SC-4) sentences, kept word for word, each
  // with the one action its clause kind calls for (199-UI-SPEC FailingKeyExitNote).
  // `labels` are the keys sharing the clause (sorted by the caller); a dead key's
  // clause names only that key, never "your keys" or "your book" (founder rule).
  {
    id: "allocation.failing-key-sync-failing",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-RECONNECT",
    text: (a: { labels: readonly string[]; day: string }): DegradeSegment[] => {
      const its = a.labels.length > 1 ? "their" : "its";
      return [
        "The total counts ",
        ...labelSegments(a.labels),
        ` through ${formatCloseDay(a.day)}: ${its} exchange key is failing to sync, so ${its} capital is no longer counted after that day. `,
        { action: "A-RECONNECT" },
      ];
    },
  },
  {
    id: "allocation.failing-key-read-incomplete",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-WAIT-SYNC",
    text: (a: { labels: readonly string[]; day: string }): DegradeSegment[] => {
      const its = a.labels.length > 1 ? "their" : "its";
      return [
        "The total counts ",
        ...labelSegments(a.labels),
        ` through ${formatCloseDay(a.day)}: the latest read of ${its} exchange history came back incomplete, so the total holds ${its} last complete day. `,
        { action: "A-WAIT-SYNC" },
      ];
    },
  },
  {
    id: "allocation.failing-key-undated",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-RECONNECT-OR-WAIT",
    text: (a: { labels: readonly string[] }): DegradeSegment[] => [
      "The total leaves out ",
      ...labelSegments(a.labels),
      `: ${a.labels.length > 1 ? "their" : "its"} exchange key has not returned a complete history yet. `,
      { action: "A-RECONNECT-OR-WAIT" },
    ],
  },
  // Phase 164.6.6.2.1 plan 17 (D-09, D-20, D-21) sentences, kept word for word. The
  // writer records three different facts, so there are three entries and each
  // claims only its own (R2-WR-02): dated (the total leaves the account out for a
  // day), whole (the total leaves it out entirely, right now) and history (only the
  // equity history skips it, on a count of days).
  {
    id: "allocation.unpriced-dated",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-WAIT-CLOSE",
    /** `groups`: one per day, in the order the caller states them; `day` is an ISO day. */
    text: (a: {
      groups: ReadonlyArray<{ day: string; labels: readonly string[] }>;
    }): DegradeSegment[] => {
      const accounts = a.groups.reduce((n, g) => n + g.labels.length, 0);
      const out: DegradeSegment[] = ["The total leaves out "];
      a.groups.forEach((g, i) => {
        if (i > 0) out.push("; ");
        out.push(...labelSegments(g.labels), ` for ${formatCloseDay(g.day)}`);
      });
      out.push(
        `: no BTC close is stored for ${a.groups.length > 1 ? "those days" : "that day"} yet, so ${accounts > 1 ? "they" : "it"} cannot be priced in USD. `,
        { action: "A-WAIT-CLOSE" },
      );
      return out;
    },
  },
  {
    id: "allocation.unpriced-whole",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-CONTACT-CHECK",
    /** The writer could not date the account (an unreadable row). `also` follows a dated sentence. */
    text: (a: { labels: readonly string[]; also: boolean }): DegradeSegment[] => [
      `The total ${a.also ? "also leaves" : "leaves"} out `,
      ...labelSegments(a.labels),
      ` entirely: ${a.labels.length > 1 ? "they" : "it"} cannot be priced in USD right now. `,
      { action: "A-CONTACT-CHECK" },
    ],
  },
  {
    id: "allocation.unpriced-history",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-WAIT-CLOSE",
    /** Interior gaps only: the account IS in the current total, so this is about the curve, never the total. */
    text: (a: {
      items: ReadonlyArray<{ label: string; holeDays: number }>;
    }): DegradeSegment[] => {
      const out: DegradeSegment[] = ["The equity history leaves out "];
      a.items.forEach((item, i) => {
        if (i > 0) out.push(i === a.items.length - 1 ? " and " : ", ");
        out.push({ label: item.label }, ` on ${item.holeDays} ${item.holeDays === 1 ? "day" : "days"}`);
      });
      const many = a.items.length > 1 || a.items.some((item) => item.holeDays > 1);
      out.push(
        `: no BTC close is stored for ${many ? "those days" : "that day"}, so ${a.items.length > 1 ? "they" : "it"} could not be priced in USD. `,
        { action: "A-WAIT-CLOSE" },
      );
      return out;
    },
  },
  // Review C4 SFH-C4-04 sentence, with the scope phrase and the action added (CD-09,
  // D-05). The payload carries no key id (`departedHistoryUnavailable` is a bare
  // flag), so the entry names no key and is a count-pinned whole_history entry.
  // Naming the departed key needs an analytics-service change, booked by plan 199-18.
  {
    id: "allocation.departed-history",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-CONTACT-CHECK",
    text: (): DegradeSegment[] => [
      "Across your whole history, this curve leaves out at least one disconnected account, because the balance its history is measured from is not available. ",
      { action: "A-CONTACT-CHECK" },
    ],
  },
  // Phase 198 plan 09 (D-01) per-key lines, kept word for word (199-05 Task 1). The
  // scope is the keys and, where the server gave one, the days: the two sentences'
  // `{labels}: {coverage}.` shape. A line whose coverage is unknown names the key only.
  {
    id: "allocation.key-gap.not-syncing",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-RECONNECT-OR-WAIT",
    text: (a: { labels: readonly string[]; coverage: GapCoverage }): DegradeSegment[] => [
      ...labelSegments(a.labels),
      `: ${coverageText(a.coverage, "data")}. `,
      { action: "A-RECONNECT-OR-WAIT" },
    ],
  },
  {
    id: "allocation.key-gap.sync-failing",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-RECONNECT-OR-WAIT",
    text: (a: { labels: readonly string[]; coverage: GapCoverage }): DegradeSegment[] => [
      ...labelSegments(a.labels),
      `: ${coverageText(a.coverage, "data")}. `,
      { action: "A-RECONNECT-OR-WAIT" },
    ],
  },
  {
    id: "allocation.key-gap.read-incomplete",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-WAIT-SYNC",
    text: (a: { labels: readonly string[]; coverage: GapCoverage }): DegradeSegment[] => [
      ...labelSegments(a.labels),
      `: ${coverageText(a.coverage, "complete data")}. `,
      { action: "A-WAIT-SYNC" },
    ],
  },
  {
    id: "allocation.key-gap.duplicate-account",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-DISCONNECT-DUP",
    text: (a: { labels: readonly string[] }): DegradeSegment[] => [
      ...labelSegments(a.labels),
      " read the same exchange account. ",
      { action: "A-DISCONNECT-DUP" },
    ],
  },
  {
    id: "allocation.key-gap.shared-account-failing",
    surface: "my-allocation",
    class: "degrade",
    scope: "key_day",
    action: "A-FIX-ONE-OF-THESE",
    text: (a: { labels: readonly string[]; coverage: GapCoverage }): DegradeSegment[] => [
      ...labelSegments(a.labels),
      `: ${coverageText(a.coverage, "data")}. `,
      { action: "A-FIX-ONE-OF-THESE" },
    ],
  },
  {
    id: "allocation.key-gap.identity-pending",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-WAIT-IDENTITY",
    text: (a: { labels: readonly string[] }): DegradeSegment[] => [
      ...labelSegments(a.labels),
      ": we are confirming which exchange account this key reads. ",
      { action: "A-WAIT-IDENTITY" },
    ],
  },
  // 170.6.2 D-02: a rebuilding book whose reason is key_not_syncing and whose payload
  // names exactly one resolvable key. The label stays plain text, as shipped.
  {
    id: "allocation.key-gap.not-syncing-one-key",
    surface: "my-allocation",
    class: "degrade",
    scope: "key",
    action: "A-CHECK-IT",
    text: (a: { label: string }): DegradeSegment[] => [
      `One of your keys, ${a.label}, is not syncing, so we cannot confirm which exchange account it reads. `,
      { action: "A-CHECK-IT" },
    ],
  },
  // Phase 198 plan 09/10 book-level lines (199-05 Task 2, D-05, CD-14 OQ-2). A book-wide
  // reason has no key cause and no day range in its payload, so each is a whole_history
  // entry: it keeps its shipped Phase 198 D-10 wording word for word, adds the scope
  // phrase `for your whole history` and ends on one action. Phase 198 D-10 (REVIEWS R-03):
  // a book-level line names the equity chart and the ratios built from it and NEVER the
  // words return or risk, because GlancePanel prints those from live per-key figures this
  // history does not gate. `degrade-warnings.test.tsx` and `MissingDataMessage.test.tsx`
  // both fail on a whole-word match. Each target sentence is one unbroken literal.
  {
    id: "allocation.book.awaiting-derivation",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-WAIT-RECOMPUTE",
    text: (): DegradeSegment[] => [
      "Your allocation's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden for your whole history. ",
      { action: "A-WAIT-RECOMPUTE" },
    ],
  },
  {
    id: "allocation.book.derivation-rejected",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-CONTACT-CHECK",
    text: (): DegradeSegment[] => [
      "The latest rebuild of your allocation's history did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden for your whole history. ",
      { action: "A-CONTACT-CHECK" },
    ],
  },
  // R3-WR-03: the writer could not join an older key's history to the newer key's on one
  // account. The shipped sentence ends "your history is not shown", which cannot take the
  // phrase, so the scope rides on its siblings' D-10 sentence. A-CONTACT-CHECK asks for a
  // check and does not claim to heal the history (no action here heals it).
  {
    id: "allocation.book.shared-account-history-truncated",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-CONTACT-CHECK",
    text: (): DegradeSegment[] => [
      "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's, so your history is not shown. The equity chart and the ratios built from it are hidden for your whole history. ",
      { action: "A-CONTACT-CHECK" },
    ],
  },
  // A rebuilding book with no known reason: the shipped sentence, never a guessed cause.
  {
    id: "allocation.book.unknown-reason",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-CONTACT-CHECK",
    text: (): DegradeSegment[] => [
      "The equity chart and the ratios built from it are hidden for your whole history for now. ",
      { action: "A-CONTACT-CHECK" },
    ],
  },
  // The unnamed fallbacks (no gap line names the key). Each keeps every shipped word and
  // gains the D-10 scope sentence IN FRONT: the shipped action sentences point back with
  // "it" and "them", so a sentence between cause and action would make them read as the
  // chart. Executor-chosen placement, recorded in the 199-05 SUMMARY.
  {
    id: "allocation.book.identity-pending",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-WAIT-IDENTITY",
    text: (): DegradeSegment[] => [
      `${HISTORY_HIDDEN}We are confirming which exchange account each key reads. `,
      { action: "A-WAIT-IDENTITY" },
    ],
  },
  {
    id: "allocation.book.duplicate-account",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-DISCONNECT-DUP",
    text: (): DegradeSegment[] => [
      `${HISTORY_HIDDEN}Two of your keys read the same exchange account. `,
      { action: "A-DISCONNECT-DUP" },
    ],
  },
  {
    id: "allocation.book.key-not-syncing",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-CHECK-IT",
    text: (): DegradeSegment[] => [
      `${HISTORY_HIDDEN}One of your keys is not syncing, so we cannot confirm which exchange account it reads. `,
      { action: "A-CHECK-IT" },
    ],
  },
  {
    id: "allocation.book.keys-not-syncing",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-CHECK-THEM",
    text: (): DegradeSegment[] => [
      `${HISTORY_HIDDEN}Some of your keys are not syncing, so we cannot confirm which exchange accounts they read. `,
      { action: "A-CHECK-THEM" },
    ],
  },
  // R3-WR-03: the payload does not say which account, so the line names none (T-167.1.2-22a).
  {
    id: "allocation.book.shared-account-no-working-key",
    surface: "my-allocation",
    class: "degrade",
    scope: "whole_history",
    action: "A-FIX-ONE-OF-THEM",
    text: (): DegradeSegment[] => [
      `${HISTORY_HIDDEN}The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. `,
      { action: "A-FIX-ONE-OF-THEM" },
    ],
  },
  // Review C2 SFH-06: a read that failed is not a wait on the daily recompute. The shipped
  // sentence keeps its own action ("the page", not A-RELOAD's "this page"), so the entry
  // carries it as `shippedAction` (UI-SPEC OQ-3) rather than a near-match vocabulary id.
  {
    id: "allocation.book.history-read-failed",
    surface: "my-allocation",
    class: "read_failure",
    scope: "none",
    action: null,
    shippedAction: "Reload the page to try again.",
    text: (): DegradeSegment[] => [
      "We could not load your allocation's history just now. Reload the page to try again.",
    ],
  },
  // Phase 199 plan 05 Task 3: the inventory of every other warning under the allocations
  // tree. Five are MARKER-ONLY: the surface keeps its shipped JSX and carries
  // `data-degrade-id`, and the registry records the warning's class and surface so the
  // scan can account for it (no scope, no action: none of them is a degrade).
  {
    id: "allocation.first-sync",
    surface: "my-allocation",
    class: "in_progress",
    scope: "none",
    action: null,
  },
  {
    id: "allocation.onboarding",
    surface: "my-allocation",
    class: "empty",
    scope: "none",
    action: null,
  },
  {
    id: "scenario.provenance",
    surface: "scenario",
    class: "provenance",
    scope: "none",
    action: null,
  },
  {
    id: "scenario.default-change",
    surface: "scenario",
    class: "composition",
    scope: "none",
    action: null,
  },
  {
    id: "scenario.blend-header",
    surface: "scenario",
    class: "composition",
    scope: "none",
    action: null,
  },
  // Phase 199 plan 15: the Scenario's other warnings, each MARKER-ONLY (the surface keeps
  // its shipped JSX and carries `data-degrade-id`). Two are compositions the owner caused by
  // their own selection (the copy already names the strategy and the fix), two are work in
  // progress (UI-SPEC "What counts": composition and in_progress name no scope).
  {
    id: "scenario.empty-intersection",
    surface: "scenario",
    class: "composition",
    scope: "none",
    action: null,
  },
  {
    id: "scenario.auto-excluded",
    surface: "scenario",
    class: "composition",
    scope: "none",
    action: null,
  },
  {
    id: "scenario.loading-returns",
    surface: "scenario",
    class: "in_progress",
    scope: "none",
    action: null,
  },
  {
    id: "scenario.series-syncing",
    surface: "scenario",
    class: "in_progress",
    scope: "none",
    action: null,
  },
  // The Scenario's per-source fallback (UI-SPEC target, scope key, the action is the named
  // wait): shown when the allocator has eligible keys and none has a per-key series yet. A
  // key with no per-key series is named by its label; when no label resolves the line
  // reads about the connected keys, as `allocation.staleness-never` does.
  {
    id: "scenario.per-source-fallback",
    surface: "scenario",
    class: "degrade",
    scope: "key",
    action: "A-WAIT-NEXT-SYNC",
    text: (a: { labels: readonly string[] }): DegradeSegment[] =>
      a.labels.length === 0
        ? [
            "Your connected keys have no per-key return series yet, so this projection blends your whole allocation. ",
            { action: "A-WAIT-NEXT-SYNC" },
          ]
        : [
            ...labelSegments(a.labels),
            ` ${a.labels.length === 1 ? "has" : "have"} no per-key return series yet, so this projection blends your whole allocation. `,
            { action: "A-WAIT-NEXT-SYNC" },
          ],
  },
  // Phase 199 plan 15: HoldingsTable's strategies read failure. A read_failure, so it names
  // no scope; it keeps its shipped sentence word for word, including its own action
  // ("Refresh to retry."), which no vocabulary id matches (UI-SPEC OQ-3), so the entry
  // carries it as `shippedAction`, as `allocation.book.history-read-failed` does.
  {
    id: "allocation.holdings-strategies-read-failed",
    surface: "my-allocation",
    class: "read_failure",
    scope: "none",
    action: null,
    shippedAction: "Refresh to retry.",
    text: (): DegradeSegment[] => [
      "Strategies temporarily unavailable — some of your strategies may not appear, and allocation actions may be hidden. Refresh to retry.",
    ],
  },
  // AlertBanner's alerts-check failure. A read_failure, so it names no scope; it gains the
  // A-RELOAD action ("Reload this page to try again."), which is true: the check re-runs
  // on mount.
  {
    id: "allocation.alerts-unverified",
    surface: "my-allocation",
    class: "read_failure",
    scope: "none",
    action: "A-RELOAD",
    text: (): DegradeSegment[] => [
      "Couldn't verify critical alerts. ",
      { action: "A-RELOAD" },
    ],
  },
  // Phase 199 plan 16 Task 1 (D-03): the strategies list's row-note Health detail for
  // Analytics failed. `day` is the last computation's day (`claimed_at`, else `created_at`, of
  // the factsheet job the page already reads), an ISO `YYYY-MM-DD`. The closing action is the
  // viewer's: a manager and `both` keep `ownerRemedy` (its words, by `ownerRemedyAction`);
  // an allocator-only viewer is never sent to the manager-guarded edit page or CSV wizard
  // (CD-11).
  {
    id: "strategies.analytics-failed",
    surface: "strategies-list",
    class: "degrade",
    scope: "day",
    action: "A-CONTACT-RESOLVE",
    actions: ANALYTICS_FAILED_ACTIONS,
    text: (a: {
      day: string;
      action: AnalyticsFailedAction;
      strategyId?: string;
    }): DegradeSegment[] => [
      `The last computation, on ${formatCloseDay(a.day)}, did not produce figures. `,
      { action: a.action, strategyId: a.strategyId },
    ],
  },
  // The same detail when the compute-jobs read SUCCEEDED and returned no factsheet job (done
  // jobs are purged after about 30 days, or the failure was recorded without a job): there is
  // no day to name, so it is an `empty` entry like `strategies.stale-no-data`, never a
  // degrade, and never the read-failure line (the read worked; a reload cannot add a job).
  {
    id: "strategies.analytics-failed-undated",
    surface: "strategies-list",
    class: "empty",
    scope: "none",
    action: "A-CONTACT-RESOLVE",
    actions: ANALYTICS_FAILED_ACTIONS,
    text: (a: { action: AnalyticsFailedAction; strategyId?: string }): DegradeSegment[] => [
      "The last computation did not produce figures. ",
      { action: a.action, strategyId: a.strategyId },
    ],
  },
  // Stale: the series end is the day (`strategyHealthOf`'s `staleSince`). The action is the
  // viewer's: a CSV strategy's upload for a manager, the edit page for a manager's API or
  // composite strategy, the Exchanges page for an allocator-only viewer's, and the contact
  // form for an allocator-only viewer's CSV strategy (the upload route is manager-guarded).
  {
    id: "strategies.stale",
    surface: "strategies-list",
    class: "degrade",
    scope: "day",
    action: "A-EDIT",
    actions: STALE_ACTIONS,
    text: (a: { day: string; action: StaleAction; strategyId?: string }): DegradeSegment[] => [
      `No new data since ${formatCloseDay(a.day)}. `,
      { action: a.action, strategyId: a.strategyId },
    ],
  },
  // Stale (no data yet): the dateless form (UI-SPEC OQ-1). No key and no day exist to name,
  // so this is an `empty` entry, never a degrade: the judge's key-or-day rule stays whole.
  {
    id: "strategies.stale-no-data",
    surface: "strategies-list",
    class: "empty",
    scope: "none",
    action: "A-RESYNC-EDIT",
    // The row's REAL compute state picks the remedy (199 review SFH-03), so the detail may end
    // on any action the Analytics failed detail can: a failed or stalled job is not the
    // never-started row.
    actions: ANALYTICS_FAILED_ACTIONS,
    text: (a: { action: AnalyticsFailedAction; strategyId?: string }): DegradeSegment[] => [
      "No figures yet, and no computation is running. ",
      { action: a.action, strategyId: a.strategyId },
    ],
  },
  // The untrusted-key line (199-12): the shipped caption naming the keys, then the helper the
  // key's pill prints. The page keeps the pill's own JSX (UI-SPEC: "Pill and helper unchanged")
  // and carries this id on the line; the page test pins the on-screen caption and helper to
  // these words, so the registry cannot drift from what renders.
  {
    id: "strategies.key-problem",
    surface: "strategies-list",
    class: "degrade",
    scope: "key",
    action: "A-READD-KEY",
    actions: Object.values(KEY_PROBLEM_ACTION),
    text: (a: { labels: readonly string[]; action: KeyProblemAction }): DegradeSegment[] => [
      `${untrustedKeyCaption(a.labels)} `,
      { action: a.action },
    ],
  },
  // The shipped KCS09-UNREADABLE sentence: the computation status could not be read (the compute-jobs read
  // failed), which is a fact about this read and not about the data. A read that worked and
  // found no job is `strategies.analytics-failed-undated`.
  {
    id: "strategies.compute-status-unreadable",
    surface: "strategies-list",
    class: "read_failure",
    scope: "none",
    action: "A-RELOAD",
    text: (): DegradeSegment[] => [
      "We could not read this strategy's computation status. ",
      { action: "A-RELOAD" },
    ],
  },
  // Phase 199 plan 16 Task 3: the rest of the strategies list. The three read failures keep
  // their shipped wording word for word (the registry test pins each equal to its constant:
  // STRATEGIES_LIST_UNREADABLE, KEY_STATUS_UNREADABLE_NOTE, PLACEHOLDER_KEYS_UNREADABLE). The
  // first and last end on A-RELOAD, whose words are the shipped "Reload this page to try
  // again."; the key-status line's own action ("Open a strategy to see its keys.") matches no
  // vocabulary id, so it is carried as `shippedAction` (UI-SPEC OQ-3).
  {
    id: "strategies.list-unreadable",
    surface: "strategies-list",
    class: "read_failure",
    scope: "none",
    action: "A-RELOAD",
    text: (): DegradeSegment[] => ["We could not load your strategies. ", { action: "A-RELOAD" }],
  },
  {
    id: "strategies.key-status-unreadable",
    surface: "strategies-list",
    class: "read_failure",
    scope: "none",
    action: null,
    shippedAction: "Open a strategy to see its keys.",
    text: (): DegradeSegment[] => [
      "We could not check key status right now. Open a strategy to see its keys.",
    ],
  },
  {
    id: "strategies.placeholder-keys-unreadable",
    surface: "strategies-list",
    class: "read_failure",
    scope: "none",
    action: "A-RELOAD",
    text: (): DegradeSegment[] => [
      "We could not load your exchange keys, so keys without a strategy may be missing here. ",
      { action: "A-RELOAD" },
    ],
  },
  // MARKER-ONLY (the surface keeps its shipped JSX and carries `data-degrade-id`): the share
  // note describes what a link's recipient sees, not data missing here (UI-SPEC "What
  // counts"); the two empty states are honest empty accounts, not degrades.
  {
    id: "strategies.share-note",
    surface: "strategies-list",
    class: "share_status",
    scope: "none",
    action: null,
  },
  {
    id: "strategies.empty",
    surface: "strategies-list",
    class: "empty",
    scope: "none",
    action: null,
  },
  {
    id: "strategies.empty-allocator",
    surface: "strategies-list",
    class: "empty",
    scope: "none",
    action: null,
  },
  // Phase 199 plan 18 Task 1 (D-04, ROUTE-11): the factsheet, rebased after Phase 196.
  // HARD-05's degraded members: composite members EXCLUDED from the stitch. The OWNER view keeps
  // the shipped sentence and its member names (`Key {seq} ({venue})`, built by the caller, in the
  // order the payload gives them, comma-joined as shipped) and gains the contact form: no code
  // path proves a user action restores an excluded member (UI-SPEC OQ-4), so it is a check, not a
  // reconnect. The labels are plain text, as shipped, not `{ label }` segments: the shipped line
  // is one mono sentence and the existing pins match it as one string.
  {
    id: "factsheet.degraded-members",
    surface: "factsheet",
    class: "degrade",
    scope: "key",
    action: "A-CONTACT-CHECK",
    text: (a: { labels: readonly string[]; strategyId?: string }): DegradeSegment[] => [
      `\u26A0 ${a.labels.join(", ")} could not be included \u2014 ${a.labels.length > 1 ? "their" : "its"} data is excluded from this track record. `,
      { action: "A-CONTACT-CHECK", strategyId: a.strategyId },
    ],
  },
  // The RECIPIENT and PUBLIC view of the same fact (T-199-22): it names no member, no venue and
  // not even how many (the payload is the shared id-keyed cache's, and a key's seq and venue
  // identify the owner's account). One honest sentence, then the only action a reader has.
  {
    id: "factsheet.degraded-members-recipient",
    surface: "factsheet",
    class: "recipient",
    scope: "recipient",
    action: "A-ASK-SHARER",
    text: (): DegradeSegment[] => [
      "\u26A0 Part of this track record could not be included \u2014 some of its data is excluded. ",
      { action: "A-ASK-SHARER" },
    ],
  },
  // MARKER-ONLY (the view keeps its shipped JSX and `data-degrade-id` is added). The USD view's
  // two unavailable notes: a failed BTC-close read keeps its shipped wait as `shippedAction`
  // (OQ-3: no vocabulary id fits "It is retried within the hour."), and no stored close at all is
  // a steady fact about the record, an empty state, not a degrade.
  {
    id: "factsheet.usd-view-read-failed",
    surface: "factsheet",
    class: "read_failure",
    scope: "none",
    action: null,
    shippedAction: "It is retried within the hour.",
  },
  {
    id: "factsheet.usd-view-no-priced-day",
    surface: "factsheet",
    class: "empty",
    scope: "none",
    action: null,
  },
  // `ANALYTICS_UPDATING_LINE` (Phase 190 D-06): work is running over a stored result. Unchanged.
  {
    id: "factsheet.analytics-updating",
    surface: "factsheet",
    class: "in_progress",
    scope: "none",
    action: null,
  },
  // Phase 199 plan 18 Task 2 (D-04, SC-4): the owner pending page's state line, read with its
  // remedy as one unit. The line's text is `ownerStateLine`'s (the copy module owns the words);
  // these entries add what the registry judges: a failed or stalled computation names the day it
  // was last attempted and ends on the viewer's remedy (the `ownerRemedy` sentence the page's
  // second paragraph prints, by `ownerRemedyAction`), and a line with no day to name is a read
  // failure. The page keeps its two paragraphs (the remedy keeps its links) and carries the
  // matching id on the section; the page test pins the printed words to these.
  {
    id: "factsheet.owner-state-dated",
    surface: "factsheet",
    class: "degrade",
    scope: "day",
    action: "A-CONTACT-CHECK",
    actions: ANALYTICS_FAILED_ACTIONS,
    text: (a: {
      state: ComputeState;
      day: string;
      action: AnalyticsFailedAction;
      strategyId?: string;
    }): DegradeSegment[] => [
      `${ownerStateLine(a.state, undefined, a.day).text} `,
      { action: a.action, strategyId: a.strategyId },
    ],
  },
  // The same lines when the day is unknown (the compute-jobs read gave no job, or a stamp that
  // does not parse), and the lines that describe the build or the read rather than a computation
  // day (finished, never started, unreadable): the shipped sentence and its remedy, no day.
  {
    id: "factsheet.owner-state-undated",
    surface: "factsheet",
    class: "read_failure",
    scope: "none",
    action: "A-CONTACT-CHECK",
    actions: ANALYTICS_FAILED_ACTIONS,
    text: (a: {
      state: ComputeState;
      build?: OwnerBuildFacts;
      action: AnalyticsFailedAction;
      strategyId?: string;
    }): DegradeSegment[] => [
      `${ownerStateLine(a.state, a.build).text} `,
      { action: a.action, strategyId: a.strategyId },
    ],
  },
  // MARKER-ONLY: queued, retrying and running lines. Work is running; nothing is missing yet.
  {
    id: "factsheet.owner-state-working",
    surface: "factsheet",
    class: "in_progress",
    scope: "none",
    action: null,
  },
  // KCS10-PUBLIC (the public pending sentence, factsheet page and tearsheet): shipped wording
  // kept word for word, then the one action a visitor has (UI-SPEC "Factsheet" row 3: "add one
  // where missing"). It names no key and no state.
  {
    id: "factsheet.public-pending",
    surface: "factsheet",
    class: "recipient",
    scope: "recipient",
    action: "A-ASK-SHARER-RETRY",
    text: (): DegradeSegment[] => [
      `${KCS10_PUBLIC_SENTENCE} `,
      { action: "A-ASK-SHARER-RETRY" },
    ],
  },
  // MARKER-ONLY (the share page keeps its shipped card; `data-degrade-id` sits on a wrapper
  // around it). `SHARE_CARD_COPY`'s two arms. The not-available body already ends on the
  // vocabulary sentence; the in-progress body names its wait ("This page shows the factsheet once
  // it is ready."), carried as `shippedAction` (OQ-3). A test pins each to the card's own body.
  {
    id: "factsheet.share-card-in-progress",
    surface: "factsheet",
    class: "recipient",
    scope: "recipient",
    action: null,
    shippedAction: "This page shows the factsheet once it is ready.",
  },
  {
    id: "factsheet.share-card-not-available",
    surface: "factsheet",
    class: "recipient",
    scope: "recipient",
    action: "A-ASK-SHARER-RETRY",
  },
] as const satisfies readonly DegradeEntry[];

/**
 * 199-18: which kind of owner-state line the page prints for `state`, and so which entry
 * matches it. Queued, retrying and running lines are `working` (in progress); a failed or stalled
 * line with a usable `day` is `dated`; every other line (finished, never started, unreadable, or a
 * failed line whose day could not be read) is `undated`. The page maps the kind to its entry id
 * with a literal table, so the scan sees the ids where they render.
 */
export type OwnerStateKind = "working" | "dated" | "undated";

export function ownerStateKind(
  state: ComputeState,
  day: string | null | undefined,
): OwnerStateKind {
  if (state.state === "queued" || state.state === "retrying" || state.state === "running") {
    return "working";
  }
  return ownerStateIsDated(state, day) ? "dated" : "undated";
}

type Entry = (typeof DEGRADE_WARNINGS)[number];
export type DegradeId = Entry["id"];
export type DegradeArgs<I extends DegradeId> = Extract<Entry, { id: I }> extends {
  text: (a: infer A) => unknown;
}
  ? A
  : undefined;

/** The segments of one registered entry. A typed lookup: `args` must match that id's text. */
export function degradeSegments<I extends DegradeId>(
  id: I,
  args: DegradeArgs<I>,
): DegradeSegment[] {
  const entry = DEGRADE_WARNINGS.find((e) => e.id === id) as
    | { text?: (a: never) => DegradeSegment[] }
    | undefined;
  if (!entry?.text) throw new Error(`degrade warning ${id} has no text`);
  return entry.text(args as never);
}

/** The words a reader sees: labels as text, an action as its sentence. */
export function degradePlainText(segments: readonly DegradeSegment[]): string {
  return segments
    .map((s) =>
      typeof s === "string"
        ? s
        : "label" in s
          ? s.label
          : ACTION_SENTENCES[s.action].sentence,
    )
    .join("");
}
