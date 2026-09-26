/**
 * Phase 167.2 / KCS-13, KCS-14 — the LOCKED copy for surfaces S4 to S9: the
 * /strategies key mark and share note, the owner pending factsheet's state and
 * remedy lines, the owner share note, the public pending sentence and the share
 * page's two arms.
 *
 * ⛔ Every string here is copied VERBATIM from 167.2-UI-SPEC.md § Copywriting
 * Contract and pinned character for character by status-surface-copy.test.ts
 * (the 167 D-11 house convention). Change a string only with its UI-SPEC row
 * and its pin, in the same commit. Special characters are named constants, as
 * in AllocatorSyncStatus.tsx: U+2014 em dash (the two share-page bodies) and
 * U+00B7 middle dot (the key-mark captions). Apostrophes are ASCII U+0027.
 * Numbers inside a sentence are rendered from their constants, never typed.
 *
 * TOTALITY: the state-line, remedy, shape-remedy and recipient-note tables are
 * `satisfies Record<…>` over their key unions, and `stateLineKeyOf` switches
 * exhaustively over the ComputeState discriminant, so a state with no row is a
 * compile error rather than a blank line on a page.
 *
 * No client directive: server pages call these functions.
 */

import { EXCHANGE_DISPLAY } from "./closed-sets";
import type { ComputeState, RecipientArm } from "./compute-state";
// Type-only (Phase 167.2.1): erased at build, so this copy module pulls in
// none of the builder's server-side imports.
import type { NotBuildableReason } from "./factsheet/fetch-and-build-payload";
import type { ShareAffordanceMode } from "./share-affordance";
import type { StrategyShape } from "./strategy-shape";
import { STALL_THRESHOLD_MS } from "./sync-progress";

const EM_DASH = "—"; // U+2014 — NOT a hyphen-minus.
const MIDDLE_DOT = "·"; // U+00B7 — NOT a period or a bullet.

const SUPPORT_EMAIL = "support@quantalyze.com";

/** The stall threshold in whole minutes (720 000 ms → 12). */
const STALL_MINUTES = STALL_THRESHOLD_MS / 60_000;

// ── S6 — KCS-09 owner state lines ─────────────────────────────────────────

export type StateLineTone = "muted" | "amber" | "red";

/** One row per owner state line (UI-SPEC § KCS-09). */
type StateLineKey =
  | "queued"
  | "retrying"
  | "running_fetch"
  | "running_member"
  | "running_compute"
  | "running_unknown"
  | "stalled"
  | "failed_permanent"
  | "failed_transient"
  | "failed_orphaned"
  | "failed_unknown"
  | "failed_other"
  | "finished"
  | "never_started"
  | "unreadable";

/** `{n}` and `{m}` are the only slots; filled from the derived memberOf. */
const RUN_MEMBER_TEMPLATE =
  "Fetching trades for this composite strategy: key {n} of {m}.";

const STATE_LINES = {
  queued: {
    id: "KCS09-QUEUED",
    tone: "muted",
    text: "A computation for this strategy is queued and has not started yet.",
  },
  retrying: {
    id: "KCS09-RETRYING",
    tone: "amber",
    text: "The last attempt hit a temporary problem, and the service is retrying it automatically.",
  },
  running_fetch: {
    id: "KCS09-RUN-FETCH",
    tone: "muted",
    text: "Fetching this strategy's trades from the exchange.",
  },
  running_member: {
    id: "KCS09-RUN-MEMBER",
    tone: "muted",
    text: RUN_MEMBER_TEMPLATE,
  },
  running_compute: {
    id: "KCS09-RUN-COMPUTE",
    tone: "muted",
    text: "Computing this strategy's analytics from its trades.",
  },
  running_unknown: {
    id: "KCS09-RUN-UNKNOWN",
    tone: "muted",
    text: "The analytics service is working on this strategy.",
  },
  stalled: {
    id: "KCS09-STALLED",
    tone: "amber",
    text: `The computation for this composite strategy stopped reporting progress more than ${STALL_MINUTES} minutes ago.`,
  },
  failed_permanent: {
    id: "KCS09-FAIL-PERMANENT",
    tone: "red",
    text: "The last computation stopped on a problem that retrying alone will not resolve.",
  },
  failed_transient: {
    id: "KCS09-FAIL-TRANSIENT",
    tone: "amber",
    text: "The last computation stopped after its automatic retries ran out.",
  },
  failed_orphaned: {
    id: "KCS09-FAIL-ORPHANED",
    tone: "amber",
    text: "The last computation stopped before it finished because the process running it went away.",
  },
  failed_unknown: {
    id: "KCS09-FAIL-UNKNOWN",
    tone: "amber",
    text: "The last computation stopped, and the service could not tell why.",
  },
  failed_other: {
    id: "KCS09-FAIL-OTHER",
    tone: "amber",
    text: "The last computation did not finish.",
  },
  finished: {
    id: "KCS09-FINISHED",
    tone: "amber",
    text: "The last computation finished, but the factsheet could not be built from its results.",
  },
  never_started: {
    id: "KCS09-NEVER",
    tone: "muted",
    text: "No computation is running for this strategy, and none is on record.",
  },
  unreadable: {
    id: "KCS09-UNREADABLE",
    tone: "muted",
    text: "The computation status for this strategy could not be read.",
  },
} as const satisfies Record<
  StateLineKey,
  { id: string; tone: StateLineTone; text: string }
>;

function stateLineKeyOf(state: ComputeState): StateLineKey {
  switch (state.state) {
    case "queued":
      return "queued";
    case "retrying":
      return "retrying";
    case "running":
      if (state.memberOf) return "running_member";
      if (state.phase === "fetch") return "running_fetch";
      if (state.phase === "compute") return "running_compute";
      return "running_unknown";
    case "stalled":
      return "stalled";
    case "failed":
      switch (state.errorKind) {
        case "permanent":
          return "failed_permanent";
        case "transient":
          return "failed_transient";
        case "orphaned":
          return "failed_orphaned";
        case "unknown":
          return "failed_unknown";
        default:
          return "failed_other";
      }
    case "finished":
      return "finished";
    case "never_started":
      return "never_started";
    case "unreadable":
      return "unreadable";
  }
}

/** The owner's state line and its tone (UI-SPEC § KCS-09, § Color). */
export function ownerStateLine(state: ComputeState): {
  id: string;
  text: string;
  tone: StateLineTone;
} {
  const key = stateLineKeyOf(state);
  const line = STATE_LINES[key];
  if (key === "running_member" && state.state === "running" && state.memberOf) {
    const text = RUN_MEMBER_TEMPLATE.replace(
      "{n}",
      String(state.memberOf.n),
    ).replace("{m}", String(state.memberOf.m));
    return { id: line.id, text, tone: line.tone };
  }
  return { id: line.id, text: line.text, tone: line.tone };
}

// ── S6 — KCS-09 fixed remedies and KCS-21 shape remedies ──────────────────

export type OwnerRemedy = {
  id: string;
  before: string;
  link?: { text: string; href: string };
  after: string;
};

const RELOAD_REMEDY = {
  id: "KCS09-RELOAD",
  before: "Reload this page to see the latest status.",
  after: "",
} as const satisfies OwnerRemedy;

const CONTACT_PERMANENT_REMEDY = {
  id: "KCS09-CONTACT-PERMANENT",
  before: `Contact ${SUPPORT_EMAIL} to resolve it.`,
  after: "",
} as const satisfies OwnerRemedy;

const CONTACT_CHECK_REMEDY = {
  id: "KCS09-CONTACT-CHECK",
  before: `Contact ${SUPPORT_EMAIL} to have it checked.`,
  after: "",
} as const satisfies OwnerRemedy;

/**
 * KCS09-UNREADABLE's remedy. Also rendered when a state needs a shape remedy
 * but the shape could not be read (planner decision, 167.2-01): naming a
 * control the screen may not paint is the false-remedy class KCS-21 exists to
 * prevent, so no shape is guessed and no new copy is authored.
 */
const RETRY_READ_REMEDY = {
  id: "KCS09-UNREADABLE",
  before: "Reload this page to try again.",
  after: "",
} as const satisfies OwnerRemedy;

/** Which remedy each state line takes (UI-SPEC § KCS-09, last column). */
type RemedyRule =
  | "reload"
  | "shape"
  | "contact_permanent"
  | "contact_check"
  | "retry_read";

const REMEDY_RULES = {
  queued: "reload",
  retrying: "reload",
  running_fetch: "reload",
  running_member: "reload",
  running_compute: "reload",
  running_unknown: "reload",
  stalled: "shape",
  failed_permanent: "contact_permanent",
  failed_transient: "shape",
  failed_orphaned: "shape",
  failed_unknown: "shape",
  failed_other: "shape",
  finished: "contact_check",
  never_started: "shape",
  unreadable: "retry_read",
} as const satisfies Record<StateLineKey, RemedyRule>;

function shapeRemedy(shape: StrategyShape, strategyId: string): OwnerRemedy {
  const editHref = `/strategies/${encodeURIComponent(strategyId)}/edit`;
  const remedies = {
    single: {
      id: "KCS21-SINGLE",
      before: "Start a new computation with Resync on this strategy's ",
      link: { text: "edit page", href: editHref },
      after: `. Contact ${SUPPORT_EMAIL} if it does not complete.`,
    },
    unlinked: {
      id: "KCS21-UNLINKED",
      before: "Link a key with Use & Sync on this strategy's ",
      link: { text: "edit page", href: editHref },
      after: ` to start a new computation. Contact ${SUPPORT_EMAIL} if it does not complete.`,
    },
    composite: {
      id: "KCS21-COMPOSITE",
      before: `A composite strategy has no self-serve re-run. Contact ${SUPPORT_EMAIL} to start a new computation.`,
      after: "",
    },
    csv: {
      id: "KCS21-CSV",
      before:
        "A CSV strategy's data is fixed at upload. To publish a corrected series, ",
      link: {
        text: "upload a new CSV strategy",
        href: "/strategies/new/wizard?source=csv",
      },
      after: `, or contact ${SUPPORT_EMAIL}.`,
    },
  } satisfies Record<StrategyShape, OwnerRemedy>;
  return remedies[shape];
}

/**
 * The owner's one remedy line for a state (UI-SPEC § KCS-09 and § KCS-21).
 * Rendered text = before + link.text + after; `link` is an inline anchor.
 */
export function ownerRemedy(
  state: ComputeState,
  shape: StrategyShape | "unknown",
  strategyId: string,
): OwnerRemedy {
  switch (REMEDY_RULES[stateLineKeyOf(state)]) {
    case "reload":
      return { ...RELOAD_REMEDY };
    case "contact_permanent":
      return { ...CONTACT_PERMANENT_REMEDY };
    case "contact_check":
      return { ...CONTACT_CHECK_REMEDY };
    case "retry_read":
      return { ...RETRY_READ_REMEDY };
    case "shape":
      return shape === "unknown"
        ? { ...RETRY_READ_REMEDY }
        : shapeRemedy(shape, strategyId);
  }
}

// ── S5 / S7 — KCS-12 share notes ──────────────────────────────────────────

const MINT_TOKEN_NOTES = {
  in_progress:
    "Right now, a private link to this strategy shows that its factsheet is being prepared. The numbers appear there once a computation succeeds.",
  not_available:
    "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.",
  unreadable:
    "Right now, a private link to this strategy shows a placeholder page instead of the numbers. They appear there once a computation succeeds.",
} as const satisfies Record<RecipientArm, string>;

const PUBLIC_URL_NOTE =
  "Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.";

/**
 * What a recipient of this strategy's link sees right now (KCS12-MINT-A,
 * KCS12-MINT-B, KCS12-UNREADABLE for a private link; KCS12-PUBLIC for a
 * published strategy's public URL, whatever the arm).
 *
 * Phase 167.2.1 (D-02) adds four rows to this family for a row that is
 * computed but whose factsheet cannot build: KCS12-UNBUILDABLE-SHORT,
 * KCS12-UNBUILDABLE-COMPOSITE, KCS12-PUBLIC-UNBUILDABLE-SHORT and
 * KCS12-PUBLIC-UNBUILDABLE-COMPOSITE. They are chosen by
 * `recipientShareNoteFor`; this function never returns them.
 */
export function recipientShareNote(
  mode: ShareAffordanceMode,
  arm: RecipientArm,
): string {
  return mode === "public-url" ? PUBLIC_URL_NOTE : MINT_TOKEN_NOTES[arm];
}

/**
 * Phase 167.2.1 (D-02) — why a computed row's factsheet cannot build, in the
 * two kinds the copy distinguishes: a single-key series too short to build
 * (`too_short`), or stored results we cannot build from (`cannot_build`): a
 * composite, or since 167.2.1-REVIEW-SFH M-3 a single-key series whose stored
 * entries are malformed.
 */
export type UnbuildableNoteKind = "too_short" | "cannot_build";

/**
 * The note kind for a probe reason, or null when the reason is not a
 * build-time refusal of a computed row (`read_error`, `not_visible` and
 * `not_computed` are decided by the caller, D-05).
 *
 * 167.2.1-REVIEW-SFH L-1: every reason is listed and the switch ends in a
 * `never` check, so a new `NotBuildableReason` is a compile error here instead
 * of silently answering "no kind" (which renders uncomputed copy for a
 * computed row).
 */
export function unbuildableNoteKindOf(
  reason: NotBuildableReason,
): UnbuildableNoteKind | null {
  switch (reason) {
    case "too_few_points":
      return "too_short";
    case "composite_unbuildable":
    case "malformed_series":
      return "cannot_build";
    case "read_error":
    case "not_visible":
    case "not_computed":
      return null;
    default: {
      const unhandled: never = reason;
      throw new Error(`unbuildableNoteKindOf: unhandled reason ${String(unhandled)}`);
    }
  }
}

// The "2" is MIN_FACTSHEET_SERIES_POINTS; status-surface-copy.test.ts pins the
// sentences to that constant, so the copy cannot drift from the gate. "yet" is
// dropped on purpose: waiting does not change this row (D-02).
//
// 167.2.1-REVIEW CR-01: the reason is stated from what the probe measured, the
// STORED RESULTS, and never from "the last computation". The owner page prints
// this note under a state line derived from compute JOBS, and those can read
// "none is on record" (done jobs are purged after 30 days) or "stopped on a
// problem" while the analytics row still reads complete. A sentence about the
// stored results is true beside every one of those lines.
// 167.2.1-REVIEW IN-02: active voice, and the address is SUPPORT_EMAIL.
const MINT_UNBUILDABLE_NOTES = {
  too_short:
    "Right now, a private link to this strategy shows that its factsheet is not available. Its stored results hold fewer than 2 days of returns, and a factsheet needs at least 2.",
  cannot_build: `Right now, a private link to this strategy shows that its factsheet is not available. We cannot build a factsheet from its stored results. Contact ${SUPPORT_EMAIL} to have them checked.`,
} as const satisfies Record<UnbuildableNoteKind, string>;

const PUBLIC_UNBUILDABLE_NOTES = {
  too_short:
    "Right now, this strategy's factsheet link shows that the factsheet is not available. Its stored results hold fewer than 2 days of returns, and a factsheet needs at least 2.",
  cannot_build: `Right now, this strategy's factsheet link shows that the factsheet is not available. We cannot build a factsheet from its stored results. Contact ${SUPPORT_EMAIL} to have them checked.`,
} as const satisfies Record<UnbuildableNoteKind, string>;

/**
 * Phase 167.2.1 (D-02) — the selection rule. With no unbuildable kind this is
 * `recipientShareNote(mode, arm)`. For an unbuildable row, a public URL takes
 * its PUBLIC-UNBUILDABLE line whatever the arm (167.2 IN-04: no RPC); a
 * private link takes its UNBUILDABLE line only on arm `not_available`, which is
 * exactly when the share page shows its "not available" card. Arm
 * `in_progress` keeps KCS12-MINT-A (a recompute is running and the recipient
 * sees "being prepared"), and `unreadable` keeps KCS12-UNREADABLE.
 */
export function recipientShareNoteFor(
  mode: ShareAffordanceMode,
  arm: RecipientArm,
  kind: UnbuildableNoteKind | null,
): string {
  if (kind === null) return recipientShareNote(mode, arm);
  if (mode === "public-url") return PUBLIC_UNBUILDABLE_NOTES[kind];
  if (arm === "not_available") return MINT_UNBUILDABLE_NOTES[kind];
  return recipientShareNote(mode, arm);
}

// ── S9 — KCS-11 share page arms ───────────────────────────────────────────

/**
 * The share page's two arms. An unreadable state takes `not_available`
 * (fail closed on the promise). Neither body names a cause, a state, an
 * owner action or a number of minutes.
 */
export const SHARE_CARD_COPY = {
  in_progress: {
    heading: "This factsheet isn't ready yet",
    body: `The link works ${EM_DASH} the strategy's performance data is being prepared. Try again later.`,
  },
  not_available: {
    heading: "This factsheet isn't available yet",
    body: `The link works ${EM_DASH} the strategy's performance data is not available yet. Check with the person who shared this link before trying again.`,
  },
} as const satisfies Record<
  Exclude<RecipientArm, "unreadable">,
  { heading: string; body: string }
>;

// ── S8 — KCS-10 public pending sentence ───────────────────────────────────

/** True in every state, no timing, no internal state (KCS10-PUBLIC). */
export const KCS10_PUBLIC_SENTENCE =
  "The detailed factsheet for this strategy is not available yet.";

// ── Review-fix round 1 (2026-09-24) — /strategies read failures ───────────

/**
 * KCS-LIST-UNREADABLE (UI-SPEC § Review-fix amendments, 167.2-REVIEW-SFH H-1).
 * The /strategies list read failed. Never "No strategies yet": an owner with
 * live strategies must not be told they have none.
 */
export const STRATEGIES_LIST_UNREADABLE =
  "Your strategies could not be loaded. Reload this page to try again.";

/**
 * KCS-KEYSTATUS-UNREADABLE (UI-SPEC § Review-fix amendments,
 * 167.2-REVIEW-SFH H-3). The key-status or member read failed, so an absent
 * key pill no longer means "healthy"; this one page-level line says so.
 */
export const KEY_STATUS_UNREADABLE_NOTE =
  "Key status could not be checked right now. Open a strategy to see its keys.";

// ── S4 — KCS-06 key-mark caption ──────────────────────────────────────────

function exchangeDisplayName(code: string): string {
  return Object.hasOwn(EXCHANGE_DISPLAY, code)
    ? EXCHANGE_DISPLAY[code as keyof typeof EXCHANGE_DISPLAY]
    : code;
}

/**
 * The left caption beside a key-level pill on a /strategies row: KCS06-ONE
 * (`Exchange key · {Exchange}`) for one key, KCS06-MANY
 * (`Exchange keys · {Exchange1}, {Exchange2}`) for two or more. Distinct
 * display names from EXCHANGE_DISPLAY in first-seen order; a code with no
 * display name renders as stored.
 */
export function untrustedKeyCaption(
  exchangeCodes: readonly string[],
  keyCount: number,
): string {
  const names: string[] = [];
  for (const code of exchangeCodes) {
    const name = exchangeDisplayName(code);
    if (!names.includes(name)) names.push(name);
  }
  const noun = keyCount >= 2 ? "Exchange keys" : "Exchange key";
  return `${noun} ${MIDDLE_DOT} ${names.join(", ")}`;
}
