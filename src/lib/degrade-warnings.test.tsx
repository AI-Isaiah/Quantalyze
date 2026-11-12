import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { DegradeLine } from "@/components/degrade/DegradeLine";
import { formatCloseDay } from "@/lib/factsheet/returns-unit";
import {
  KCS10_PUBLIC_SENTENCE,
  KEY_STATUS_UNREADABLE_NOTE,
  ownerRemedy,
  ownerStateLine,
  SHARE_CARD_COPY,
  STRATEGIES_LIST_UNREADABLE,
  untrustedKeyCaption,
  type OwnerBuildFacts,
} from "@/lib/status-surface-copy";
import { PLACEHOLDER_KEYS_UNREADABLE } from "@/app/(dashboard)/strategies/comparison-note";
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
import type { ComputeState } from "@/lib/compute-state";
import type { StrategyShape } from "@/lib/strategy-shape";
import {
  ACTION_SENTENCES,
  DEGRADE_CLASSES,
  DEGRADE_SCOPES,
  DEGRADE_SURFACES,
  DEGRADE_WARNINGS,
  SURFACE_ID_PREFIX,
  WHOLE_HISTORY_IDS,
  degradePlainText,
  degradeSegments,
  ownerStateKind,
  ownerRemedyAction,
  viewerRemedyAction,
  type ActionId,
  type DegradeArgs,
  type DegradeEntry,
  type DegradeId,
  type DegradeSegment,
} from "./degrade-warnings";

// ---------------------------------------------------------------------------
// Phase 199 plan 03 (D-04, CD-05, SC-4). The registry test renders a FIXTURE
// SAMPLE for every entry and judges the words a reader would see, not a declared
// flag, so it goes RED when a template loses its key slot, its day or its action
// (CLAUDE.md Rule 9). `judgeEntry` is the one judge: the real registry runs
// through it and expects no problem, and the meta-arms hand it synthetic bad
// entries and expect the specific problem, so the judge itself is shown able to
// fail. Samples are keyed by id; an entry without one is itself a problem.
// ---------------------------------------------------------------------------

const FIXTURE_DAY = "2026-10-03";
const KEY_A = "Fixture — key-A";
const KEY_B = "Fixture — key-B";

/** What a sample passes in, and the fixture names the judge must find in what comes out. */
interface Sample<A = unknown> {
  args: A;
  labels: readonly string[];
  days: readonly string[];
  /**
   * 199-16: an entry whose closing action depends on the viewer's role (CD-11) lists the
   * actions it may end on (`entry.actions`), and the sample says how to build its args for
   * each one, so every action it can print is judged, not only the default.
   */
  argsFor?: (action: ActionId) => unknown;
}

const SAMPLES = {
  "allocation.staleness": {
    args: { day: FIXTURE_DAY },
    labels: [],
    days: [FIXTURE_DAY],
  },
  "allocation.staleness-never": {
    args: { labels: [KEY_A, KEY_B] },
    labels: [KEY_A, KEY_B],
    days: [],
  },
  "allocation.failing-key-sync-failing": {
    args: { labels: [KEY_A], day: FIXTURE_DAY },
    labels: [KEY_A],
    days: [FIXTURE_DAY],
  },
  "allocation.failing-key-read-incomplete": {
    args: { labels: [KEY_A, KEY_B], day: FIXTURE_DAY },
    labels: [KEY_A, KEY_B],
    days: [FIXTURE_DAY],
  },
  "allocation.failing-key-undated": {
    args: { labels: [KEY_A, KEY_B] },
    labels: [KEY_A, KEY_B],
    days: [],
  },
  "allocation.unpriced-dated": {
    args: { groups: [{ day: FIXTURE_DAY, labels: [KEY_A, KEY_B] }] },
    labels: [KEY_A, KEY_B],
    days: [FIXTURE_DAY],
  },
  "allocation.unpriced-whole": {
    args: { labels: [KEY_A], also: false },
    labels: [KEY_A],
    days: [],
  },
  "allocation.unpriced-history": {
    args: { items: [{ label: KEY_A, holeDays: 2 }] },
    labels: [KEY_A],
    days: [],
  },
  "allocation.departed-history": {
    args: undefined,
    labels: [],
    days: [],
  },
  // 199-05 Task 1: the Phase 198 per-key lines. `coverage` is the structured form of
  // "no data for {range}" / "no data since {day}" / "no complete history yet".
  "allocation.key-gap.not-syncing": {
    args: { labels: [KEY_A, KEY_B], coverage: { days: [FIXTURE_DAY] } },
    labels: [KEY_A, KEY_B],
    days: [FIXTURE_DAY],
  },
  "allocation.key-gap.sync-failing": {
    args: { labels: [KEY_A], coverage: { days: [FIXTURE_DAY, "2026-10-04"] } },
    labels: [KEY_A],
    days: [FIXTURE_DAY],
  },
  "allocation.key-gap.read-incomplete": {
    args: { labels: [KEY_A], coverage: { since: FIXTURE_DAY } },
    labels: [KEY_A],
    days: [FIXTURE_DAY],
  },
  "allocation.key-gap.duplicate-account": {
    args: { labels: [KEY_A, KEY_B] },
    labels: [KEY_A, KEY_B],
    days: [],
  },
  "allocation.key-gap.shared-account-failing": {
    args: { labels: [KEY_A, KEY_B], coverage: { days: [FIXTURE_DAY] } },
    labels: [KEY_A, KEY_B],
    days: [FIXTURE_DAY],
  },
  "allocation.key-gap.identity-pending": {
    args: { labels: [KEY_A] },
    labels: [KEY_A],
    days: [],
  },
  "allocation.key-gap.not-syncing-one-key": {
    args: { label: KEY_A },
    labels: [KEY_A],
    days: [],
  },
  // 199-05 Task 2: the book-wide lines name no key and no day, so they are whole_history
  // entries (D-05, CD-14 OQ-2); history-read-failed is a read_failure. None takes args.
  "allocation.book.awaiting-derivation": { args: undefined, labels: [], days: [] },
  "allocation.book.derivation-rejected": { args: undefined, labels: [], days: [] },
  "allocation.book.shared-account-history-truncated": { args: undefined, labels: [], days: [] },
  "allocation.book.unknown-reason": { args: undefined, labels: [], days: [] },
  "allocation.book.identity-pending": { args: undefined, labels: [], days: [] },
  "allocation.book.duplicate-account": { args: undefined, labels: [], days: [] },
  "allocation.book.key-not-syncing": { args: undefined, labels: [], days: [] },
  "allocation.book.keys-not-syncing": { args: undefined, labels: [], days: [] },
  "allocation.book.shared-account-no-working-key": { args: undefined, labels: [], days: [] },
  "allocation.book.history-read-failed": { args: undefined, labels: [], days: [] },
  // 199-05 Task 3: the inventory entries. Five are marker-only (the surface keeps its own
  // JSX, the registry records its class and surface); the alerts line renders from the registry.
  "allocation.first-sync": { args: undefined, labels: [], days: [] },
  "allocation.onboarding": { args: undefined, labels: [], days: [] },
  "allocation.alerts-unverified": { args: undefined, labels: [], days: [] },
  "scenario.provenance": { args: undefined, labels: [], days: [] },
  "scenario.default-change": { args: undefined, labels: [], days: [] },
  "scenario.blend-header": { args: undefined, labels: [], days: [] },
  // 199-15 Task 1: the Scenario's per-source fallback names the keys with no per-key series
  // (scope key); the four marker-only entries are the Scenario's other warnings.
  "scenario.per-source-fallback": { args: { labels: [KEY_A, KEY_B] }, labels: [KEY_A, KEY_B], days: [] },
  "scenario.empty-intersection": { args: undefined, labels: [], days: [] },
  "scenario.auto-excluded": { args: undefined, labels: [], days: [] },
  "scenario.loading-returns": { args: undefined, labels: [], days: [] },
  "scenario.series-syncing": { args: undefined, labels: [], days: [] },
  // 199-15 Task 2: the Holdings table's strategies read failure (a read_failure, no scope).
  "allocation.holdings-strategies-read-failed": { args: undefined, labels: [], days: [] },
  // 199-16 Task 1: the strategies-list Health detail for Analytics failed. The day is the last
  // computation's; the closing action is the viewer's (`actions`), so the sample builds its
  // args per action and the judge renders every one.
  "strategies.analytics-failed": {
    args: { day: FIXTURE_DAY, action: "A-CONTACT-RESOLVE" },
    labels: [],
    days: [FIXTURE_DAY],
    argsFor: (action) => ({ day: FIXTURE_DAY, action, strategyId: "s-1" }),
  },
  "strategies.compute-status-unreadable": { args: undefined, labels: [], days: [] },
  // 199 review WR-02: the same detail with no job on record, so no day (an `empty` entry).
  "strategies.analytics-failed-undated": {
    args: { action: "A-CONTACT-RESOLVE" },
    labels: [],
    days: [],
    argsFor: (action) => ({ action, strategyId: "s-1" }),
  },
  // 199-16 Task 2: Stale names its day and the viewer's action; Stale (no data yet) names
  // neither a key nor a day (UI-SPEC OQ-1: the dateless form), so it is an `empty` entry; the
  // key line names its keys and ends on the shipped helper for the key's status.
  "strategies.stale": {
    args: { day: FIXTURE_DAY, action: "A-EDIT" },
    labels: [],
    days: [FIXTURE_DAY],
    argsFor: (action) => ({ day: FIXTURE_DAY, action, strategyId: "s-1" }),
  },
  "strategies.stale-no-data": {
    args: { action: "A-RESYNC-EDIT" },
    labels: [],
    days: [],
    argsFor: (action) => ({ action, strategyId: "s-1" }),
  },
  "strategies.key-problem": {
    args: { labels: [KEY_A, KEY_B], action: "A-READD-KEY" },
    labels: [KEY_A, KEY_B],
    days: [],
    argsFor: (action) => ({ labels: [KEY_A, KEY_B], action }),
  },
  // 199-16 Task 3: the list's three read failures (shipped wording, pinned below), its share
  // note (share_status) and its two empty states, the last three marker-only.
  "strategies.list-unreadable": { args: undefined, labels: [], days: [] },
  "strategies.key-status-unreadable": { args: undefined, labels: [], days: [] },
  "strategies.placeholder-keys-unreadable": { args: undefined, labels: [], days: [] },
  "strategies.share-note": { args: undefined, labels: [], days: [] },
  "strategies.empty": { args: undefined, labels: [], days: [] },
  "strategies.empty-allocator": { args: undefined, labels: [], days: [] },
  // 199-18 Task 1: the factsheet. The owner view names the excluded member keys (scope key); the
  // recipient and public view names none (class recipient, scope recipient). The two USD-view
  // notes and the updating line are the factsheet's other registered lines.
  "factsheet.degraded-members": {
    args: { labels: ["Key 2 (Bybit)", "Key 3 (OKX)"], strategyId: "s-1" },
    labels: ["Key 2 (Bybit)", "Key 3 (OKX)"],
    days: [],
  },
  "factsheet.degraded-members-recipient": { args: undefined, labels: [], days: [] },
  "factsheet.usd-view-read-failed": { args: undefined, labels: [], days: [] },
  "factsheet.usd-view-no-priced-day": { args: undefined, labels: [], days: [] },
  "factsheet.analytics-updating": { args: undefined, labels: [], days: [] },
  // 199-18 Task 2: the owner pending page's state lines (dated for a failed or stalled
  // computation, undated otherwise: the closing action is the viewer's `ownerRemedy`, so the
  // sample builds its args per action), the public pending sentence and the two share-card arms.
  "factsheet.owner-state-dated": {
    args: { state: { state: "failed", errorKind: "permanent" }, day: FIXTURE_DAY, action: "A-CONTACT-CHECK" },
    labels: [],
    days: [FIXTURE_DAY],
    argsFor: (action) => ({ state: { state: "failed", errorKind: "permanent" }, day: FIXTURE_DAY, action, strategyId: "s-1" }),
  },
  "factsheet.owner-state-undated": {
    args: { state: { state: "failed", errorKind: "permanent" }, action: "A-CONTACT-CHECK" },
    labels: [],
    days: [],
    argsFor: (action) => ({ state: { state: "failed", errorKind: "permanent" }, action, strategyId: "s-1" }),
  },
  "factsheet.owner-state-working": { args: undefined, labels: [], days: [] },
  "factsheet.public-pending": { args: undefined, labels: [], days: [] },
  "factsheet.share-card-in-progress": { args: undefined, labels: [], days: [] },
  "factsheet.share-card-not-available": { args: undefined, labels: [], days: [] },
} satisfies { [I in DegradeId]: Sample<DegradeArgs<I>> };

/**
 * Phase 198 D-10 (gap 198-UAT-01, REVIEWS R-03): a book-level line names the equity
 * chart and the ratios built from it and never the words return or risk, because
 * GlancePanel prints those from live per-key figures this history does not gate. The
 * pattern is whole-word, so "each account's returns" passes.
 */
const D10_FORBIDDEN = /\b(return|risk)\b/i;

/** The whole_history entries whose rendered sample breaks D-10, by id. Empty means D-10 holds. */
function d10Violations(
  entries: readonly JudgedEntry[],
  samples: Record<string, Sample>,
): string[] {
  const wholeHistory = entries.filter((e) => e.scope === "whole_history" && e.text);
  if (wholeHistory.length === 0) return ["no whole_history entry was judged (the guard would be vacuous)"];
  return wholeHistory.flatMap((e) => {
    const rendered = degradePlainText(e.text!(samples[e.id].args as never));
    return D10_FORBIDDEN.test(rendered) ? [`${e.id}: a book-level line names return or risk`] : [];
  });
}

type JudgedEntry = Pick<DegradeEntry, "id" | "class" | "scope" | "action" | "shippedAction" | "actions"> & {
  text?: (args: never) => DegradeSegment[];
};

/** Every problem the registry contract finds in one entry rendered with its sample. Empty means the entry is sound. */
function judgeEntry(entry: JudgedEntry, sample: Sample | undefined): string[] {
  const problems: string[] = [];
  const at = `${entry.id}:`;
  if (!sample) return [`${at} no fixture sample`];
  const rendered = entry.text
    ? degradePlainText(entry.text(sample.args as never))
    : null;

  if (entry.class === "degrade") {
    if (rendered === null) return [`${at} a degrade entry needs text`];
    if (entry.action === null) problems.push(`${at} a degrade entry needs an action id`);
    if (entry.scope === "key" || entry.scope === "key_day") {
      for (const label of sample.labels) {
        if (!rendered.includes(label)) problems.push(`${at} does not name the key ${label}`);
      }
      if (sample.labels.length === 0) problems.push(`${at} scope key but the sample carries no key label`);
    }
    if (entry.scope === "day" || entry.scope === "key_day") {
      for (const day of sample.days) {
        if (!rendered.includes(formatCloseDay(day))) problems.push(`${at} does not name the day ${formatCloseDay(day)}`);
      }
      if (sample.days.length === 0) problems.push(`${at} scope day but the sample carries no day`);
    }
    if (entry.scope === "recipient" || entry.scope === "none") {
      problems.push(`${at} a degrade entry names a key, a day or its whole history, not scope ${entry.scope}`);
    }
  }
  if (entry.action !== null && rendered !== null && !rendered.includes(ACTION_SENTENCES[entry.action].sentence)) {
    problems.push(`${at} lacks its action sentence verbatim`);
  }
  if (entry.actions && entry.text) {
    // 199-16: every action the entry may end on renders verbatim, not only the default.
    if (!sample.argsFor) problems.push(`${at} lists actions but its sample cannot build args per action`);
    else {
      for (const action of entry.actions) {
        const variant = degradePlainText(entry.text(sample.argsFor(action) as never));
        if (!variant.includes(ACTION_SENTENCES[action].sentence)) {
          problems.push(`${at} ending on ${action} lacks its action sentence verbatim`);
        }
      }
    }
  }
  if (entry.class === "read_failure" || entry.class === "recipient") {
    if (entry.action === null && !entry.shippedAction) problems.push(`${at} needs an action`);
    if (entry.action === null && entry.shippedAction && rendered !== null && !rendered.includes(entry.shippedAction)) {
      problems.push(`${at} lacks its shipped action sentence`);
    }
  }
  if (entry.class === "recipient" && rendered !== null) {
    for (const label of [KEY_A, KEY_B, ...sample.labels]) {
      if (rendered.includes(label)) problems.push(`${at} a recipient entry names an owner key (${label})`);
    }
  }
  const allowed = (WHOLE_HISTORY_IDS as readonly string[]).includes(entry.id);
  if (entry.scope === "whole_history") {
    if (!allowed) problems.push(`${at} whole_history is not allowed for this id`);
    if (rendered !== null && !rendered.includes("whole history")) problems.push(`${at} whole_history copy lacks "whole history"`);
  } else if (allowed) {
    problems.push(`${at} is on the whole_history allowlist but its scope is ${entry.scope}`);
  }
  return problems;
}

function judgeRegistry(
  entries: readonly JudgedEntry[],
  samples: Record<string, Sample>,
): string[] {
  return entries.flatMap((e) => judgeEntry(e, samples[e.id]));
}

describe("degrade registry: the contract holds for every real entry", () => {
  it("no entry has a problem, and every entry has a sample", () => {
    expect(judgeRegistry(DEGRADE_WARNINGS, SAMPLES as Record<string, Sample>)).toEqual([]);
  });

  it("closed sets and id shape: class, scope and surface are members, the id leads with its surface prefix", () => {
    const ids = new Set<string>();
    for (const e of DEGRADE_WARNINGS as readonly DegradeEntry[]) {
      expect(DEGRADE_CLASSES).toContain(e.class);
      expect(DEGRADE_SCOPES).toContain(e.scope);
      expect(DEGRADE_SURFACES).toContain(e.surface);
      expect(e.id.startsWith(`${SURFACE_ID_PREFIX[e.surface]}.`), e.id).toBe(true);
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
    }
  });

  it("WHOLE_HISTORY_IDS is count-pinned at 10 and only ids on it carry whole_history scope", () => {
    // 199-05 raises this pin from 1 to 10, with a recorded reason: the Phase 198
    // book-level lines have no key cause and no day range in their payload (D-05, CD-14
    // OQ-2). They are awaiting_derivation, derivation_rejected,
    // shared_account_history_truncated, the unknown-reason line and the five unnamed
    // fallbacks (identity pending, duplicate account, key not syncing for one and for
    // several keys, shared account with no working key). Raising it again needs its own reason.
    expect([...WHOLE_HISTORY_IDS].sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(WHOLE_HISTORY_IDS).toHaveLength(10);
    const wholeScoped = (DEGRADE_WARNINGS as readonly DegradeEntry[])
      .filter((e) => e.scope === "whole_history")
      .map((e) => e.id);
    for (const id of wholeScoped) expect(WHOLE_HISTORY_IDS as readonly string[]).toContain(id);
    // And the converse: every allowlisted id exists as an entry with that scope.
    expect(wholeScoped.sort()).toEqual([...WHOLE_HISTORY_IDS].sort());
  });

  it("D-10: no whole_history book-level sample names return or risk", () => {
    expect(d10Violations(DEGRADE_WARNINGS, SAMPLES as Record<string, Sample>)).toEqual([]);
  });

  it("every sample has an entry and every entry has a sample, so a registered line cannot go unjudged", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(DEGRADE_WARNINGS.map((e) => e.id).sort());
  });

  it("the action vocabulary is the UI-SPEC's twelve ids, 199-03's one, the five shipped-origin ids 199-05 records, the one named wait 199-15 records, the eight 199-16 records and the two 199-18 records", () => {
    expect(Object.keys(ACTION_SENTENCES).sort()).toEqual(
      [
        "A-RECONNECT",
        "A-RECONNECT-OR-WAIT",
        "A-RECONNECT-ANY-OR-WAIT",
        "A-WAIT-SYNC",
        "A-WAIT-RECOMPUTE",
        "A-WAIT-CLOSE",
        "A-DISCONNECT-DUP",
        "A-EDIT",
        "A-CSV",
        "A-CONTACT-CHECK",
        "A-CONTACT-RESOLVE",
        "A-RELOAD",
        "A-DESELECT",
        // 199-05, shipped-origin (Phase 198 MissingDataMessage copy, kept word for word).
        "A-WAIT-IDENTITY",
        "A-CHECK-IT",
        "A-FIX-ONE-OF-THESE",
        "A-CHECK-THEM",
        "A-FIX-ONE-OF-THEM",
        // 199-15, UI-SPEC target (Scenario per-source fallback row): the named wait.
        "A-WAIT-NEXT-SYNC",
        // 199-16, shipped-origin (status-surface-copy.ts `ownerRemedy` sentences, word for
        // word) and one UI-SPEC target line ("Check its key on the Exchanges page.").
        "A-OWNER-RELOAD",
        "A-RESYNC-EDIT",
        "A-LINK-KEY-EDIT",
        "A-COMPOSITE-CONTACT",
        "A-CSV-FIXED",
        "A-EXCHANGES-KEY",
        // 199-16 Task 2, shipped-origin: the helper sentences AllocatorSyncStatus prints under
        // a strategy key's pill (REVOKED_HELPER, CREDENTIAL_FAILED_HELPER), word for word.
        "A-READD-KEY",
        "A-UPDATE-CREDENTIALS",
        // 199-18, UI-SPEC target (Factsheet, Degraded members row) and the shipped KCS11-B
        // closing sentence, word for word: the recipient and public views' one action.
        "A-ASK-SHARER",
        "A-ASK-SHARER-RETRY",
      ].sort(),
    );
  });
});

describe("the Phase 198 per-key lines read word for word what shipped (199-05 Task 1)", () => {
  const text = <I extends DegradeId>(id: I, args: DegradeArgs<I>) =>
    degradePlainText(degradeSegments(id, args));

  it("not-syncing and sync-failing: the key, the range, then the one action", () => {
    expect(text("allocation.key-gap.not-syncing", { labels: [KEY_A, KEY_B], coverage: { days: [FIXTURE_DAY, "2026-10-04"] } })).toBe(
      `${KEY_A} and ${KEY_B}: no data for Oct\u00a03,\u00a02026 – Oct\u00a04,\u00a02026. Reconnect the key on the Exchanges page or wait for the next sync.`,
    );
    expect(text("allocation.key-gap.sync-failing", { labels: [KEY_A], coverage: { since: FIXTURE_DAY } })).toBe(
      `${KEY_A}: no data since Oct\u00a03,\u00a02026. Reconnect the key on the Exchanges page or wait for the next sync.`,
    );
    expect(text("allocation.key-gap.not-syncing", { labels: [KEY_A], coverage: null })).toBe(
      `${KEY_A}: no complete history yet. Reconnect the key on the Exchanges page or wait for the next sync.`,
    );
  });

  it("read-incomplete says 'no complete data' and puts the wait before the reconnect", () => {
    expect(text("allocation.key-gap.read-incomplete", { labels: [KEY_A], coverage: { days: [FIXTURE_DAY] } })).toBe(
      `${KEY_A}: no complete data for Oct\u00a03,\u00a02026. Wait for the next sync, or reconnect the key on the Exchanges page if this persists.`,
    );
  });

  it("duplicate-account, shared-account-failing and identity-pending keep their shipped sentences", () => {
    expect(text("allocation.key-gap.duplicate-account", { labels: [KEY_A, KEY_B] })).toBe(
      `${KEY_A} and ${KEY_B} read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.`,
    );
    expect(text("allocation.key-gap.shared-account-failing", { labels: [KEY_A, KEY_B], coverage: null })).toBe(
      `${KEY_A} and ${KEY_B}: no complete history yet. Fix or reconnect one of these keys on the Exchanges page.`,
    );
    expect(text("allocation.key-gap.identity-pending", { labels: [KEY_A] })).toBe(
      `${KEY_A}: we are confirming which exchange account this key reads. Each daily sync checks it again.`,
    );
  });

  it("the one-named-key not-syncing line keeps its shipped sentence and its key scope", () => {
    expect(text("allocation.key-gap.not-syncing-one-key", { label: KEY_A })).toBe(
      `One of your keys, ${KEY_A}, is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.`,
    );
  });
});

describe("allocation.staleness: the StalenessBanner copy names its day and its action (SC-4)", () => {
  it("the day sample reads the approved sentence and prints no relative age", () => {
    const text = degradePlainText(degradeSegments("allocation.staleness", { day: FIXTURE_DAY }));
    expect(text).toBe(
      "Analytics may be stale: no exchange key has synced since Oct\u00a03,\u00a02026. Reconnect a key on the Exchanges page, or wait for the next sync.",
    );
    expect(text).not.toMatch(/\bago\b|\{relative age\}/);
  });

  it("the never-synced sample names every key and keeps the same action", () => {
    const text = degradePlainText(
      degradeSegments("allocation.staleness-never", { labels: [KEY_A, KEY_B] }),
    );
    expect(text).toContain(KEY_A);
    expect(text).toContain(KEY_B);
    expect(text).toContain("have not completed a sync yet");
    expect(text).toContain(ACTION_SENTENCES["A-RECONNECT-ANY-OR-WAIT"].sentence);
  });
});

describe("degrade judge: it fails on a warning that names neither a day nor a key, or no action (meta-arms)", () => {
  const goodText = (a: { label: string; day: string }): DegradeSegment[] => [
    "Held back for ",
    { label: a.label },
    " since ",
    formatCloseDay(a.day),
    ". ",
    { action: "A-RECONNECT" },
  ];
  const base: JudgedEntry = {
    id: "allocation.synthetic",
    class: "degrade",
    scope: "key_day",
    action: "A-RECONNECT",
    text: goodText,
  };
  const sample: Sample<{ label: string; day: string }> = {
    args: { label: KEY_A, day: FIXTURE_DAY },
    labels: [KEY_A],
    days: [FIXTURE_DAY],
  };

  it("the synthetic good entry is sound (so the arms below fail for their own reason)", () => {
    expect(judgeEntry(base, sample as Sample)).toEqual([]);
  });

  it("an entry with no sample fails", () => {
    expect(judgeRegistry([base], {})).toEqual([`${base.id}: no fixture sample`]);
  });

  it("a degrade sample without its key fails", () => {
    const noKey = { ...base, text: (a: { label: string; day: string }): DegradeSegment[] => ["Held back since ", formatCloseDay(a.day), ". ", { action: "A-RECONNECT" }] };
    expect(judgeEntry(noKey, sample as Sample).join("|")).toContain("does not name the key");
  });

  it("a degrade sample without its day fails", () => {
    const noDay = { ...base, text: (a: { label: string; day: string }): DegradeSegment[] => ["Held back for ", { label: a.label }, ". ", { action: "A-RECONNECT" }] };
    expect(judgeEntry(noDay, sample as Sample).join("|")).toContain("does not name the day");
  });

  it("a degrade sample that names neither key nor day fails on both", () => {
    const neither = { ...base, text: (): DegradeSegment[] => ["Some figures are held back. ", { action: "A-RECONNECT" }] };
    const problems = judgeEntry(neither, sample as Sample).join("|");
    expect(problems).toContain("does not name the key");
    expect(problems).toContain("does not name the day");
  });

  it("a degrade sample that lacks its action sentence verbatim fails", () => {
    const noAction = { ...base, text: (a: { label: string; day: string }): DegradeSegment[] => ["Held back for ", { label: a.label }, " since ", formatCloseDay(a.day), "."] };
    expect(judgeEntry(noAction, sample as Sample)).toEqual([`${base.id}: lacks its action sentence verbatim`]);
  });

  it("a degrade entry with no action id fails", () => {
    expect(judgeEntry({ ...base, action: null }, sample as Sample).join("|")).toContain("needs an action id");
  });

  it("a whole_history id outside WHOLE_HISTORY_IDS fails, and so does one without the phrase", () => {
    const wholeText = (): DegradeSegment[] => ["Across your whole history, figures are held back. ", { action: "A-CONTACT-CHECK" }];
    const outside: JudgedEntry = { id: "allocation.synthetic-whole", class: "degrade", scope: "whole_history", action: "A-CONTACT-CHECK", text: wholeText };
    expect(judgeEntry(outside, { args: {}, labels: [], days: [] }).join("|")).toContain("whole_history is not allowed");
    const noPhrase: JudgedEntry = { id: WHOLE_HISTORY_IDS[0], class: "degrade", scope: "whole_history", action: "A-CONTACT-CHECK", text: (): DegradeSegment[] => ["Figures are held back. ", { action: "A-CONTACT-CHECK" }] };
    expect(judgeEntry(noPhrase, { args: {}, labels: [], days: [] }).join("|")).toContain('lacks "whole history"');
  });

  it("a read_failure or recipient entry with no action fails; a recipient entry naming a key fails", () => {
    const rf: JudgedEntry = { id: "allocation.synthetic-rf", class: "read_failure", scope: "none", action: null, text: (): DegradeSegment[] => ["We could not read this."] };
    expect(judgeEntry(rf, { args: {}, labels: [], days: [] }).join("|")).toContain("needs an action");
    const rcp: JudgedEntry = { id: "allocation.synthetic-rcp", class: "recipient", scope: "recipient", action: null, shippedAction: "Check with the person who shared this link.", text: (): DegradeSegment[] => [`Held back for ${KEY_A}. Check with the person who shared this link.`] };
    expect(judgeEntry(rcp, { args: {}, labels: [], days: [] }).join("|")).toContain("names an owner key");
  });
});

describe("the book-wide lines name their whole-history scope and one action, in the shipped D-10 words (199-05 Task 2, OQ-2)", () => {
  const text = (id: DegradeId) => degradePlainText(degradeSegments(id, undefined as never));

  it.each([
    [
      "allocation.book.awaiting-derivation",
      "Your allocation's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden for your whole history. They appear after the next daily recompute.",
    ],
    [
      "allocation.book.derivation-rejected",
      "The latest rebuild of your allocation's history did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden for your whole history. Use the contact form to have it checked.",
    ],
    [
      "allocation.book.shared-account-history-truncated",
      "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's, so your history is not shown. The equity chart and the ratios built from it are hidden for your whole history. Use the contact form to have it checked.",
    ],
    [
      "allocation.book.unknown-reason",
      "The equity chart and the ratios built from it are hidden for your whole history for now. Use the contact form to have it checked.",
    ],
  ] as const)("%s", (id, sentence) => {
    expect(text(id)).toBe(sentence);
  });

  it.each([
    [
      "allocation.book.identity-pending",
      "We are confirming which exchange account each key reads. Each daily sync checks it again.",
    ],
    [
      "allocation.book.duplicate-account",
      "Two of your keys read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.",
    ],
    [
      "allocation.book.key-not-syncing",
      "One of your keys is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.",
    ],
    [
      "allocation.book.keys-not-syncing",
      "Some of your keys are not syncing, so we cannot confirm which exchange accounts they read. Check them on the Exchanges page.",
    ],
    [
      "allocation.book.shared-account-no-working-key",
      "The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page.",
    ],
  ] as const)("%s keeps every shipped word after the scope sentence", (id, shipped) => {
    expect(text(id)).toBe(
      `The equity chart and the ratios built from it are hidden for your whole history. ${shipped}`,
    );
  });

  it("history-read-failed is a read_failure with its shipped sentence, and its shipped action rather than A-RELOAD", () => {
    const entry = DEGRADE_WARNINGS.find((e) => e.id === "allocation.book.history-read-failed") as DegradeEntry;
    expect(entry.class).toBe("read_failure");
    expect(entry.action).toBeNull();
    expect(entry.shippedAction).toBe("Reload the page to try again.");
    expect(text("allocation.book.history-read-failed")).toBe(
      "We could not load your allocation's history just now. Reload the page to try again.",
    );
  });

  it("the D-10 guard fails on a whole_history line that names risk or return, and passes on 'returns'", () => {
    const base: JudgedEntry = {
      id: "allocation.book.awaiting-derivation",
      class: "degrade",
      scope: "whole_history",
      action: "A-WAIT-RECOMPUTE",
      text: (): DegradeSegment[] => ["Built from each account's returns, hidden for your whole history. ", { action: "A-WAIT-RECOMPUTE" }],
    };
    const sample = { "allocation.book.awaiting-derivation": { args: undefined, labels: [], days: [] } } as Record<string, Sample>;
    expect(d10Violations([base], sample)).toEqual([]);
    const risky: JudgedEntry = { ...base, text: (): DegradeSegment[] => ["Book risk is hidden for your whole history. ", { action: "A-WAIT-RECOMPUTE" }] };
    expect(d10Violations([risky], sample)).toEqual([`${base.id}: a book-level line names return or risk`]);
    const ret: JudgedEntry = { ...base, text: (): DegradeSegment[] => ["Book return is hidden for your whole history. ", { action: "A-WAIT-RECOMPUTE" }] };
    expect(d10Violations([ret], sample)).toHaveLength(1);
    expect(d10Violations([], sample)[0]).toContain("vacuous");
  });
});

describe("the inventory entries (199-05 Task 3): class, surface and the alerts line's reload action", () => {
  const entry = (id: string) => DEGRADE_WARNINGS.find((e) => e.id === id) as DegradeEntry;

  it.each([
    ["allocation.first-sync", "in_progress", "my-allocation"],
    ["allocation.onboarding", "empty", "my-allocation"],
    ["scenario.provenance", "provenance", "scenario"],
    ["scenario.default-change", "composition", "scenario"],
    ["scenario.blend-header", "composition", "scenario"],
    // 199-15 Task 1: the Scenario's other warnings, each keeps its shipped JSX and carries the marker.
    ["scenario.empty-intersection", "composition", "scenario"],
    ["scenario.auto-excluded", "composition", "scenario"],
    ["scenario.loading-returns", "in_progress", "scenario"],
    ["scenario.series-syncing", "in_progress", "scenario"],
  ] as const)("%s is a marker-only %s entry on %s with scope none and no action", (id, cls, surface) => {
    const e = entry(id);
    expect(e.class).toBe(cls);
    expect(e.surface).toBe(surface);
    expect(e.scope).toBe("none");
    expect(e.action).toBeNull();
    expect(e.text).toBeUndefined();
  });

  it("allocation.alerts-unverified is a read_failure that ends on A-RELOAD, apostrophe as shipped", () => {
    const e = entry("allocation.alerts-unverified");
    expect(e.class).toBe("read_failure");
    expect(e.action).toBe("A-RELOAD");
    expect(degradePlainText(degradeSegments("allocation.alerts-unverified", undefined))).toBe(
      "Couldn't verify critical alerts. Reload this page to try again.",
    );
  });
});

describe("allocation.holdings-strategies-read-failed: the Holdings read failure keeps its shipped sentence and action (199-15 Task 2)", () => {
  it("is a read_failure on My allocation that carries its shipped action rather than a near-match vocabulary id", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "allocation.holdings-strategies-read-failed") as DegradeEntry;
    expect(e.class).toBe("read_failure");
    expect(e.surface).toBe("my-allocation");
    expect(e.scope).toBe("none");
    expect(e.action).toBeNull();
    expect(e.shippedAction).toBe("Refresh to retry.");
    expect(degradePlainText(degradeSegments("allocation.holdings-strategies-read-failed", undefined))).toBe(
      "Strategies temporarily unavailable — some of your strategies may not appear, and allocation actions may be hidden. Refresh to retry.",
    );
  });
});

describe("scenario.per-source-fallback names the keys with no per-key series and ends on the named wait (199-15 Task 1)", () => {
  const text = (labels: readonly string[]) =>
    degradePlainText(degradeSegments("scenario.per-source-fallback", { labels }));

  it("is a degrade entry with scope key and the UI-SPEC's named wait as its action", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "scenario.per-source-fallback") as DegradeEntry;
    expect(e.class).toBe("degrade");
    expect(e.scope).toBe("key");
    expect(e.surface).toBe("scenario");
    expect(e.action).toBe("A-WAIT-NEXT-SYNC");
    expect(ACTION_SENTENCES["A-WAIT-NEXT-SYNC"].link).toBe("none");
  });

  it("several keys: the UI-SPEC target sentence, key labels first", () => {
    expect(text([KEY_A, KEY_B])).toBe(
      `${KEY_A} and ${KEY_B} have no per-key return series yet, so this projection blends your whole allocation. Per-source toggles appear after their next sync.`,
    );
  });

  it("one key reads 'has'; no resolvable label reads about the connected keys and still ends on the wait", () => {
    expect(text([KEY_A])).toBe(
      `${KEY_A} has no per-key return series yet, so this projection blends your whole allocation. Per-source toggles appear after their next sync.`,
    );
    expect(text([])).toBe(
      "Your connected keys have no per-key return series yet, so this projection blends your whole allocation. Per-source toggles appear after their next sync.",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 199 plan 16 Task 1 (D-03, CD-05, CD-11): the strategies-list Health detail.
// ---------------------------------------------------------------------------

const COMPUTE_STATES: readonly ComputeState[] = [
  { state: "queued" },
  { state: "retrying" },
  { state: "running", phase: "fetch" },
  { state: "running", phase: "compute" },
  { state: "running", phase: "unknown" },
  { state: "running", phase: "fetch", memberOf: { n: 1, m: 2 } },
  { state: "stalled" },
  { state: "failed", errorKind: "permanent" },
  { state: "failed", errorKind: "transient" },
  { state: "failed", errorKind: "orphaned" },
  { state: "failed", errorKind: "unknown" },
  { state: "failed", errorKind: null },
  { state: "finished" },
  { state: "never_started" },
  { state: "unreadable" },
];
const BUILD_FACTS: ReadonlyArray<OwnerBuildFacts | undefined> = [
  undefined,
  { buildUnreadable: true },
  { buildUnreadable: false, analyticsFailed: true },
];
const SHAPES: ReadonlyArray<StrategyShape | "unknown"> = ["single", "unlinked", "composite", "csv", "unknown"];

describe("strategies.analytics-failed: the last computation's day and the viewer's one action (199-16 Task 1)", () => {
  it("is a degrade entry scoped to a day, and its text reads the UI-SPEC sentence with the day by formatCloseDay", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "strategies.analytics-failed") as DegradeEntry;
    expect(e.class).toBe("degrade");
    expect(e.scope).toBe("day");
    expect(e.surface).toBe("strategies-list");
    expect(
      degradePlainText(
        degradeSegments("strategies.analytics-failed", { day: FIXTURE_DAY, action: "A-CONTACT-RESOLVE" }),
      ),
    ).toBe(
      "The last computation, on Oct\u00a03,\u00a02026, did not produce figures. Use the contact form to have it resolved.",
    );
  });

  it("lists every action it may end on, and every one is a vocabulary id the judge renders verbatim", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "strategies.analytics-failed") as DegradeEntry;
    expect(e.actions?.length ?? 0).toBeGreaterThan(1);
    for (const action of e.actions ?? []) expect(Object.keys(ACTION_SENTENCES)).toContain(action);
    expect(e.actions).toContain(e.action);
  });

  it("CD-11: a manager keeps ownerRemedy, so every remedy it can return maps to a vocabulary action that says the same words and links the same place", () => {
    let seen = 0;
    for (const state of COMPUTE_STATES) {
      for (const shape of SHAPES) {
        for (const build of BUILD_FACTS) {
          const remedy = ownerRemedy(state, shape, "s-1", build);
          const id = ownerRemedyAction(remedy);
          const action = ACTION_SENTENCES[id];
          const words = `${remedy.before}${remedy.link?.text ?? ""}${remedy.after}`;
          expect(action.sentence, `${remedy.id} -> ${id}`).toBe(words);
          // A remedy with a link keeps a link of the same text; one without keeps none that it names.
          if (remedy.link) {
            expect("phrase" in action ? action.phrase : null, `${remedy.id} link text`).toBe(remedy.link.text);
          }
          seen += 1;
        }
      }
    }
    // Not vacuous: the sweep really covered the states, shapes and build facts.
    expect(seen).toBe(COMPUTE_STATES.length * SHAPES.length * 3);
  });

  it("CD-11: an allocator-only viewer is never handed a remedy that links the manager-guarded edit page or CSV wizard, for any state and shape", () => {
    const managerRoutes = /\/strategies\/(?:[^/]+\/edit|new)/;
    for (const state of COMPUTE_STATES) {
      for (const shape of SHAPES) {
        const remedy = ownerRemedy(state, shape, "s-1", { buildUnreadable: false, analyticsFailed: true });
        const action = viewerRemedyAction({ remedy, managerSurface: false, shape });
        const a = ACTION_SENTENCES[action];
        // The kinds that open a manager-only route are the edit link and the CSV wizard.
        expect(["edit", "csv"], `${state.state}/${shape} -> ${action}`).not.toContain(a.link);
        // The manager's own answer for the same remedy is untouched.
        expect(viewerRemedyAction({ remedy, managerSurface: true, shape })).toBe(ownerRemedyAction(remedy));
      }
    }
    expect(managerRoutes.test("/strategies/s-1/edit")).toBe(true);
    // The shape remedies are replaced by shape: Exchanges for a key-fed shape, the contact form otherwise.
    const single = ownerRemedy({ state: "failed", errorKind: "transient" }, "single", "s-1");
    expect(viewerRemedyAction({ remedy: single, managerSurface: false, shape: "single" })).toBe("A-EXCHANGES-KEY");
    const composite = ownerRemedy({ state: "failed", errorKind: "transient" }, "composite", "s-1");
    expect(viewerRemedyAction({ remedy: composite, managerSurface: false, shape: "composite" })).toBe("A-EXCHANGES-KEY");
    const csv = ownerRemedy({ state: "failed", errorKind: "transient" }, "csv", "s-1");
    expect(viewerRemedyAction({ remedy: csv, managerSurface: false, shape: "csv" })).toBe("A-CONTACT-CHECK");
    const unlinked = ownerRemedy({ state: "failed", errorKind: "transient" }, "unlinked", "s-1");
    expect(viewerRemedyAction({ remedy: unlinked, managerSurface: false, shape: "unlinked" })).toBe("A-CONTACT-CHECK");
    // A remedy that links no manager route is kept (the contact form, a reload).
    const permanent = ownerRemedy({ state: "failed", errorKind: "permanent" }, "single", "s-1");
    expect(viewerRemedyAction({ remedy: permanent, managerSurface: false, shape: "single" })).toBe("A-CONTACT-RESOLVE");
  });

  it("the judge fails an entry that lists an action its text drops (meta-arm)", () => {
    const base: JudgedEntry = {
      id: "strategies.analytics-failed",
      class: "degrade",
      scope: "day",
      action: "A-CONTACT-RESOLVE",
      actions: ["A-CONTACT-RESOLVE", "A-EXCHANGES-KEY"],
      text: (a: { day: string; action: ActionId }): DegradeSegment[] => [
        `The last computation, on ${formatCloseDay(a.day)}, did not produce figures. `,
        { action: "A-CONTACT-RESOLVE" },
      ],
    };
    const sample: Sample = {
      args: { day: FIXTURE_DAY },
      labels: [],
      days: [FIXTURE_DAY],
      argsFor: (action) => ({ day: FIXTURE_DAY, action }),
    };
    expect(judgeEntry(base, sample).join("|")).toContain("ending on A-EXCHANGES-KEY lacks its action sentence verbatim");
    // And an entry that lists actions with a sample that cannot vary them is a problem.
    expect(judgeEntry(base, { ...sample, argsFor: undefined }).join("|")).toContain("cannot build args per action");
  });
});

describe("strategies.analytics-failed-undated: a failed row whose successful jobs read found no job (199 review WR-02)", () => {
  it("is an empty entry (no day, no key), names no day, and is not the read-failure line", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "strategies.analytics-failed-undated") as DegradeEntry;
    expect([e.surface, e.class, e.scope]).toEqual(["strategies-list", "empty", "none"]);
    const text = degradePlainText(
      degradeSegments("strategies.analytics-failed-undated", { action: "A-CONTACT-RESOLVE" }),
    );
    expect(text).toBe(
      "The last computation did not produce figures. Use the contact form to have it resolved.",
    );
    expect(text).not.toContain("could not read");
  });

  it("lists the same actions as the dated line, so a manager's ownerRemedy and an allocator's substitute both render", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "strategies.analytics-failed-undated") as DegradeEntry;
    const dated = DEGRADE_WARNINGS.find((x) => x.id === "strategies.analytics-failed") as DegradeEntry;
    expect(e.actions).toEqual(dated.actions);
  });
});

describe("strategies.compute-status-unreadable: the shipped KCS09-UNREADABLE sentence as a read failure (199-16 Task 1)", () => {
  it("is a read_failure that reads the shipped sentence and ends on A-RELOAD, which is the shipped remedy's words", () => {
    const e = DEGRADE_WARNINGS.find((x) => x.id === "strategies.compute-status-unreadable") as DegradeEntry;
    expect(e.class).toBe("read_failure");
    expect(e.scope).toBe("none");
    expect(e.action).toBe("A-RELOAD");
    const unreadable = ownerRemedy({ state: "unreadable" }, "single", "s-1");
    expect(degradePlainText(degradeSegments("strategies.compute-status-unreadable", undefined))).toBe(
      `We could not read this strategy's computation status. ${unreadable.before}`,
    );
  });
});

describe("strategies.stale, strategies.stale-no-data, strategies.key-problem (199-16 Task 2, D-03, CD-11)", () => {
  const entry = (id: string) => DEGRADE_WARNINGS.find((e) => e.id === id) as DegradeEntry;

  it("Stale: a degrade entry scoped to a day that reads 'No new data since {day}.' then the viewer's action", () => {
    const e = entry("strategies.stale");
    expect(e.class).toBe("degrade");
    expect(e.scope).toBe("day");
    expect(e.surface).toBe("strategies-list");
    expect(degradePlainText(degradeSegments("strategies.stale", { day: FIXTURE_DAY, action: "A-CSV" }))).toBe(
      "No new data since Oct\u00a03,\u00a02026. Upload a newer CSV to extend the record.",
    );
    // The four ways it can end: a CSV upload, the edit page, the Exchanges page (CD-11), the contact form.
    expect([...(e.actions ?? [])].sort()).toEqual(["A-CONTACT-CHECK", "A-CSV", "A-EDIT", "A-EXCHANGES-KEY"]);
  });

  it("Stale (no data yet): names neither a key nor a day, so it is an empty entry and not a degrade; it reads the UI-SPEC sentence", () => {
    const e = entry("strategies.stale-no-data");
    expect(e.class).toBe("empty");
    expect(e.scope).toBe("none");
    expect(
      degradePlainText(degradeSegments("strategies.stale-no-data", { action: "A-EXCHANGES-KEY" })),
    ).toBe("No figures yet, and no computation is running. Check its key on the Exchanges page.");
  });

  it("Stale (no data yet): every action a viewer can be handed for ANY real compute state is one it lists (199 review SFH-03)", () => {
    const e = entry("strategies.stale-no-data");
    for (const state of COMPUTE_STATES) {
      for (const shape of SHAPES) {
        const remedy = ownerRemedy(state, shape, "s-1");
        for (const managerSurface of [true, false]) {
          expect(e.actions, `${state.state}/${shape} manager=${managerSurface}`).toContain(
            viewerRemedyAction({ remedy, managerSurface, shape }),
          );
        }
      }
    }
  });

  it("Key problem: a degrade entry scoped to the keys; its words are the shipped caption then the shipped helper", () => {
    const e = entry("strategies.key-problem");
    expect(e.class).toBe("degrade");
    expect(e.scope).toBe("key");
    expect(degradePlainText(degradeSegments("strategies.key-problem", { labels: [KEY_A], action: "A-READD-KEY" }))).toBe(
      `${untrustedKeyCaption([KEY_A])} Re-add a read-only key from your exchange.`,
    );
    expect(
      degradePlainText(degradeSegments("strategies.key-problem", { labels: [KEY_A, KEY_B], action: "A-UPDATE-CREDENTIALS" })),
    ).toBe(`${untrustedKeyCaption([KEY_A, KEY_B])} Update this account's credentials \u2014 they may have changed.`);
  });

  it.each([
    ["revoked", "A-READD-KEY"],
    ["sign_in_failed", "A-UPDATE-CREDENTIALS"],
  ] as const)(
    "Key problem: the %s helper sentence IS what the real pill prints under itself (the registry cannot drift from AllocatorSyncStatus)",
    (syncStatus, action) => {
      const { container } = render(
        <AllocatorSyncStatus
          subject="strategy-key"
          syncStatus={syncStatus}
          syncError={null}
          lastSyncAt={null}
          exchange="binance"
        />,
      );
      expect(container.querySelector('[data-testid="allocator-sync-helper"]')?.textContent).toBe(
        ACTION_SENTENCES[action].sentence,
      );
    },
  );
});

describe("the strategies list's read failures keep their shipped wording, and its share note and empty states are marker-only (199-16 Task 3, D-04)", () => {
  const entry = (id: string) => DEGRADE_WARNINGS.find((e) => e.id === id) as DegradeEntry;
  const words = (id: DegradeId) => degradePlainText(degradeSegments(id, undefined as never));

  it("the list-unreadable and placeholder-key lines are read_failures that end on A-RELOAD and read the shipped constants word for word", () => {
    for (const id of ["strategies.list-unreadable", "strategies.placeholder-keys-unreadable"] as const) {
      const e = entry(id);
      expect(e.class, id).toBe("read_failure");
      expect(e.scope, id).toBe("none");
      expect(e.action, id).toBe("A-RELOAD");
    }
    expect(words("strategies.list-unreadable")).toBe(STRATEGIES_LIST_UNREADABLE);
    expect(words("strategies.placeholder-keys-unreadable")).toBe(PLACEHOLDER_KEYS_UNREADABLE);
  });

  it("the key-status line is a read_failure that keeps the shipped sentence AND its shipped action ('Open a strategy to see its keys.', OQ-3), not a near-match id", () => {
    const e = entry("strategies.key-status-unreadable");
    expect(e.class).toBe("read_failure");
    expect(e.scope).toBe("none");
    expect(e.action).toBeNull();
    expect(e.shippedAction).toBe("Open a strategy to see its keys.");
    expect(words("strategies.key-status-unreadable")).toBe(KEY_STATUS_UNREADABLE_NOTE);
  });

  it.each([
    ["strategies.share-note", "share_status"],
    ["strategies.empty", "empty"],
    ["strategies.empty-allocator", "empty"],
  ] as const)("%s is a marker-only %s entry on the strategies list with scope none and no action", (id, cls) => {
    const e = entry(id);
    expect(e.class).toBe(cls);
    expect(e.surface).toBe("strategies-list");
    expect(e.scope).toBe("none");
    expect(e.action).toBeNull();
    expect(e.text).toBeUndefined();
  });
});

describe("the factsheet's degraded-members line: the owner view names its keys and a recipient never does (199-18 Task 1, D-04, T-199-22)", () => {
  const entry = (id: string) => DEGRADE_WARNINGS.find((e) => e.id === id) as DegradeEntry;
  const text = <I extends DegradeId>(id: I, args: DegradeArgs<I>) => degradePlainText(degradeSegments(id, args));

  it("the owner entry is a key-scoped degrade ending on A-CONTACT-CHECK, in the shipped words with the action appended", () => {
    const e = entry("factsheet.degraded-members");
    expect([e.surface, e.class, e.scope, e.action]).toEqual(["factsheet", "degrade", "key", "A-CONTACT-CHECK"]);
    expect(text("factsheet.degraded-members", { labels: ["Key 2 (Bybit)"] })).toBe(
      "\u26A0 Key 2 (Bybit) could not be included \u2014 its data is excluded from this track record. Use the contact form to have it checked.",
    );
    expect(text("factsheet.degraded-members", { labels: ["Key 1 (OKX)", "Key 3 (sFOX)"] })).toBe(
      "\u26A0 Key 1 (OKX), Key 3 (sFOX) could not be included \u2014 their data is excluded from this track record. Use the contact form to have it checked.",
    );
  });

  it("the recipient entry is class recipient with scope recipient, names no key, and ends on the ask-the-sharer action", () => {
    const e = entry("factsheet.degraded-members-recipient");
    expect([e.surface, e.class, e.scope, e.action]).toEqual(["factsheet", "recipient", "recipient", "A-ASK-SHARER"]);
    const words = text("factsheet.degraded-members-recipient", undefined);
    expect(words).toBe(
      "\u26A0 Part of this track record could not be included \u2014 some of its data is excluded. Check with the person who shared this link.",
    );
    expect(words).not.toMatch(/\bKey \d|\(|venue/i);
  });

  it("the privacy arm: a recipient entry whose sample contains the fixture key label fails the judge", () => {
    const leaky: JudgedEntry = {
      id: "factsheet.synthetic-recipient",
      class: "recipient",
      scope: "recipient",
      action: "A-ASK-SHARER",
      text: (): DegradeSegment[] => [`\u26A0 ${KEY_A} could not be included. `, { action: "A-ASK-SHARER" }],
    };
    expect(judgeEntry(leaky, { args: undefined, labels: [], days: [] }).join("|")).toContain(`names an owner key (${KEY_A})`);
  });

  it("the two USD-view notes are marker-only: a read failure that keeps its shipped wait, and the steady no-priced-day fact", () => {
    const failed = entry("factsheet.usd-view-read-failed");
    expect([failed.class, failed.scope, failed.action, failed.shippedAction, failed.text]).toEqual([
      "read_failure",
      "none",
      null,
      "It is retried within the hour.",
      undefined,
    ]);
    const none = entry("factsheet.usd-view-no-priced-day");
    expect([none.class, none.scope, none.action, none.text]).toEqual(["empty", "none", null, undefined]);
  });

  it("the updating line stays class in_progress, marker-only (Phase 190 D-06)", () => {
    const e = entry("factsheet.analytics-updating");
    expect([e.surface, e.class, e.scope, e.action, e.text]).toEqual(["factsheet", "in_progress", "none", null, undefined]);
  });
});

describe("the factsheet's owner state lines, the public pending sentence and the share card (199-18 Task 2, D-04, SC-4)", () => {
  const entry = (id: string) => DEGRADE_WARNINGS.find((e) => e.id === id) as DegradeEntry;
  const sentence = (id: ActionId) => ACTION_SENTENCES[id].sentence;
  const DATED_STATES: ComputeState[] = [
    { state: "stalled" },
    { state: "failed", errorKind: "permanent" },
    { state: "failed", errorKind: "transient" },
    { state: "failed", errorKind: "orphaned" },
    { state: "failed", errorKind: "unknown" },
    { state: "failed", errorKind: null },
  ];
  const UNDATED_STATES: ComputeState[] = [
    { state: "finished" },
    { state: "never_started" },
    { state: "unreadable" },
  ];
  const WORKING_STATES: ComputeState[] = [
    { state: "queued" },
    { state: "retrying" },
    { state: "running", phase: "fetch" },
    { state: "running", phase: "compute" },
    { state: "running", phase: "unknown" },
    { state: "running", phase: "fetch", memberOf: { n: 1, m: 3 } },
  ];

  it("the dated entry is a day-scoped degrade whose every failed and stalled sentence opens with the day and ends on the viewer's action", () => {
    const e = entry("factsheet.owner-state-dated");
    expect([e.surface, e.class, e.scope, e.action]).toEqual(["factsheet", "degrade", "day", "A-CONTACT-CHECK"]);
    for (const state of DATED_STATES) {
      const words = degradePlainText(
        degradeSegments("factsheet.owner-state-dated", { state, day: FIXTURE_DAY, action: "A-CONTACT-RESOLVE" }),
      );
      expect(words, JSON.stringify(state)).toMatch(/^The last computation, on Oct\u00a03,\u00a02026, /);
      expect(words.endsWith(` ${sentence("A-CONTACT-RESOLVE")}`), JSON.stringify(state)).toBe(true);
    }
  });

  it("the dated entry lists every action ownerRemedy can end on, so the judge renders each one", () => {
    expect(entry("factsheet.owner-state-dated").actions).toEqual(entry("strategies.analytics-failed").actions);
  });

  it("the undated entry is a read_failure that prints the shipped sentence unchanged, for the failed and stalled lines whose day could not be read and for the finished, never-started and unreadable lines", () => {
    const e = entry("factsheet.owner-state-undated");
    expect([e.surface, e.class, e.scope, e.action]).toEqual(["factsheet", "read_failure", "none", "A-CONTACT-CHECK"]);
    for (const state of [...DATED_STATES, ...UNDATED_STATES]) {
      const words = degradePlainText(
        degradeSegments("factsheet.owner-state-undated", { state, action: "A-RELOAD" }),
      );
      expect(words, JSON.stringify(state)).toBe(`${ownerStateLine(state).text} ${sentence("A-RELOAD")}`);
      expect(words, JSON.stringify(state)).not.toContain(", on ");
    }
  });

  it("ownerStateKind picks the kind of line printed: working, dated, or undated", () => {
    for (const state of WORKING_STATES) {
      expect(ownerStateKind(state, FIXTURE_DAY), JSON.stringify(state)).toBe("working");
      expect(ownerStateKind(state, null), JSON.stringify(state)).toBe("working");
    }
    for (const state of DATED_STATES) {
      expect(ownerStateKind(state, FIXTURE_DAY), JSON.stringify(state)).toBe("dated");
      expect(ownerStateKind(state, null), JSON.stringify(state)).toBe("undated");
      expect(ownerStateKind(state, "garbage"), JSON.stringify(state)).toBe("undated");
    }
    for (const state of UNDATED_STATES) {
      expect(ownerStateKind(state, FIXTURE_DAY), JSON.stringify(state)).toBe("undated");
    }
  });

  it("the working entry is marker-only and class in_progress (queued, retrying and running lines)", () => {
    const e = entry("factsheet.owner-state-working");
    expect([e.surface, e.class, e.scope, e.action, e.text]).toEqual(["factsheet", "in_progress", "none", null, undefined]);
  });

  it("the public pending entry is class recipient: the shipped KCS10 sentence unchanged, then the ask-the-sharer action", () => {
    const e = entry("factsheet.public-pending");
    expect([e.surface, e.class, e.scope, e.action]).toEqual(["factsheet", "recipient", "recipient", "A-ASK-SHARER-RETRY"]);
    expect(degradePlainText(degradeSegments("factsheet.public-pending", undefined))).toBe(
      `${KCS10_PUBLIC_SENTENCE} Check with the person who shared this link before trying again.`,
    );
  });

  it("the share-card entries are marker-only recipient entries whose action is a sentence the card's own body already prints", () => {
    const inProgress = entry("factsheet.share-card-in-progress");
    expect([inProgress.surface, inProgress.class, inProgress.scope, inProgress.action, inProgress.text]).toEqual([
      "factsheet",
      "recipient",
      "recipient",
      null,
      undefined,
    ]);
    expect(inProgress.shippedAction).toBe("This page shows the factsheet once it is ready.");
    expect(SHARE_CARD_COPY.in_progress.body).toContain(inProgress.shippedAction!);

    const notAvailable = entry("factsheet.share-card-not-available");
    expect([notAvailable.surface, notAvailable.class, notAvailable.scope, notAvailable.action, notAvailable.text]).toEqual([
      "factsheet",
      "recipient",
      "recipient",
      "A-ASK-SHARER-RETRY",
      undefined,
    ]);
    expect(SHARE_CARD_COPY.not_available.body).toContain(sentence("A-ASK-SHARER-RETRY"));
  });
});

describe("DegradeLine renders registry segments with their marker, labels and action links", () => {
  it("writes data-degrade-id, a semibold label and the exchanges link", () => {
    const { container } = render(
      <DegradeLine
        id="allocation.staleness"
        segments={["Held back for ", { label: KEY_A }, ". ", { action: "A-RECONNECT" }]}
      />,
    );
    const root = container.querySelector('[data-degrade-id="allocation.staleness"]');
    expect(root).not.toBeNull();
    expect(root!.textContent).toBe(`Held back for ${KEY_A}. Reconnect the key on the Exchanges page.`);
    const label = Array.from(root!.querySelectorAll("span")).find((s) => s.textContent === KEY_A);
    expect(label?.className).toContain("font-semibold");
    const link = root!.querySelector("a");
    expect(link?.textContent).toBe("Exchanges page");
    expect(link?.getAttribute("href")).toBe("/profile?tab=exchanges");
  });

  it("links the contact phrase to the contact form, and renders a label as text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <DegradeLine
        id="allocation.staleness"
        segments={[{ label: hostile }, " ", { action: "A-CONTACT-CHECK" }]}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(hostile);
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("contact form");
    expect(link?.getAttribute("href")).toContain("topic=support");
  });

  it("an edit action with no strategy id is plain text, not a dead link; with one it links the edit page", () => {
    const plain = render(
      <DegradeLine id="allocation.staleness" segments={[{ action: "A-EDIT" }]} />,
    );
    expect(plain.container.textContent).toBe("Check its key on the edit page.");
    expect(plain.container.querySelector("a")).toBeNull();
    const linked = render(
      <DegradeLine id="allocation.staleness" segments={[{ action: "A-EDIT", strategyId: "s 1" }]} />,
    );
    expect(linked.container.querySelector("a")?.getAttribute("href")).toBe("/strategies/s%201/edit");
  });
});
