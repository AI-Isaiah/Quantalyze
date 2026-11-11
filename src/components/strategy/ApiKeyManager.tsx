"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDay } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { contactHref } from "@/lib/contact";
import {
  COMPOSITE_CARD_NOTE,
  EMPTY_NOLINK_COPY,
  FINISH_UNVERIFIED_NOTE,
  SHAPE_UNKNOWN_CARD_NOTE,
  ENQUEUE_BOUND_MS,
  LINK_UPDATE_BOUND_MS,
  type PanelStopReason,
} from "./key-card-copy";
import {
  SyncProgress,
  type EvidenceBaseline,
  type SyncStatus,
  type SyncStatusInfo,
} from "./SyncProgress";
import { ConfirmKeyChangeDialog } from "./ConfirmKeyChangeDialog";
import { readChainJobState } from "./chain-job-state";
import { captureToSentry } from "@/lib/sentry-capture";
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
import type { ApiKey } from "@/lib/types";
import { API_KEY_USER_COLUMNS } from "@/lib/constants";
import { apiKeyLabelById, dataSourceLabel } from "@/lib/api-key-label";
import { accountShareNote } from "@/lib/account-share-note";
import { isComputedAnalytics, isUntrustedKeySyncStatus } from "@/lib/closed-sets";
import type { KeyFeed } from "@/lib/key-feeds";

interface ApiKeyManagerProps {
  strategyId: string;
  /**
   * Phase 200 D-04: the strategy's name, which the re-point confirm says out
   * loud ("<name> will read trades from <key> instead of <key>").
   */
  strategyName: string;
  currentKeyId: string | null;
  /**
   * Phase 167.2 / KCS-23: what the edit page could tell about the strategy.
   * "single" means NOT a composite (a single-key or an unlinked strategy, both
   * of which may be linked from this card); "composite" is a strategy with
   * `strategy_keys` members; "unknown" is a member count the page could not
   * read. A card-local tri-state, deliberately not `StrategyShape` from
   * `@/lib/strategy-shape`, whose csv and unlinked arms this card does not
   * need. Defaults to "single", so every existing render is unchanged.
   */
  keyShape?: "single" | "composite" | "unknown";
  /**
   * 167.2-REVIEW CR-02: on a composite, the ids of its `strategy_keys`
   * members, read by the edit page. The card then lists ONLY these keys, so
   * KCS23-COMPOSITE ("reads from every key below") is true of the list as
   * rendered. Ignored for any other shape. Absent on a composite lists no key
   * (fail closed: a key the page did not name a member is never claimed as one).
   */
  compositeMemberKeyIds?: readonly string[];
}

/**
 * 140.3-08 / SEAMUX-04 (C-9) — what the user is told when a sync could not be
 * started and the response carried no reviewed copy of its own.
 *
 * REPLACES a sentence that told the user the analytics service was unavailable
 * and then instructed them to check that one of our own server-side environment
 * variables was configured. That is a DESIGN.md §Voice violation and an
 * information-disclosure smell: it tells a user something they can neither act
 * on nor should know, and it names our infrastructure to anyone who can trip the
 * arm. The deleted string is NOT reproduced here — the acceptance grep for it
 * scans this file, and a comment quoting it would keep the grep red forever
 * while the copy was genuinely gone.
 *
 * DESIGN.md §Voice: declarative, sentence-case, active voice, no exclamation, no
 * adjective where a number exists. There is no number to give here — this
 * component reads no `Retry-After` (that is SEAMUX-06, plan `140.3-09`), so
 * inventing a wait would be the fabrication the rule exists to prevent.
 *
 * "Your key is saved" is a fact at BOTH call sites, not reassurance: the
 * background sync is reached only after the route returned an `api_key_id`
 * (160-02 — the server wrote the row and told us its id; a response without
 * one throws before this copy can be shown), and the explicit sync runs only
 * after `handleLinkKey` resolved without error.
 */
const SYNC_UNAVAILABLE_COPY =
  "We couldn't start the sync. Your key is saved — retry in a moment, and contact support if it keeps failing.";

/**
 * The user-facing message for a non-2xx `/api/keys/sync` response.
 *
 * Shared by BOTH call sites deliberately: a class fixed two different ways is a
 * class a reviewer cannot audit, and "3 of 5 sites" is this programme's
 * signature failure.
 *
 * Two things it does that reading `res.json()` directly does not:
 *
 *  1. **Branches on `content-type` BEFORE the JSON read.** A proxy or gateway
 *     answers an outage with an HTML error page; `res.json()` on that throws a
 *     `SyntaxError` INSIDE the failure path, replacing the real failure with a
 *     parse error.
 *  2. **Reads `human_message` as well as `error`.** These are two different
 *     envelopes from the same route and BOTH are live. The route's own arms emit
 *     `{ error }` (400 / 404 / 429 / the composite-probe 503); every envelope
 *     `postProcessKey` builds emits `{ code, human_message }` — including the
 *     breaker's 503, whose sentence `140.3-04` consolidated onto ONE production
 *     source precisely so it reaches users. Reading `error` alone rendered
 *     "Trade sync failed" over the top of it.
 */
async function syncFailureMessage(res: Response): Promise<EnqueueAnswerError> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body: unknown = await res.json().catch(() => null);
    if (body !== null && typeof body === "object") {
      const fields = body as Record<string, unknown>;
      if (typeof fields.error === "string" && fields.error) {
        return new EnqueueAnswerError(fields.error, "verdict");
      }
      if (typeof fields.human_message === "string" && fields.human_message) {
        return new EnqueueAnswerError(fields.human_message, "verdict");
      }
    }
  }
  return new EnqueueAnswerError(SYNC_UNAVAILABLE_COPY, "transport");
}

/**
 * 167.2-REVIEW-SFH-R2 R2-M1: what a failed enqueue answer IS. `verdict`: the
 * route itself answered with a JSON `error` / `human_message` body, so it is
 * the route's refusal of this sync. `transport`: a non-JSON failure (a
 * platform 504 at the route's `maxDuration`, a proxy's HTML page), which says
 * nothing about whether the upstream enqueue committed. `unrecognized`: a 2xx
 * without enqueue evidence. A thrown `fetch` is not this class, and reads as
 * transport. The message is what the panel shows on a LIVE attempt, exactly
 * as before; the kind decides only whether a LATE answer may replace the
 * `enqueue_bound` panel.
 */
class EnqueueAnswerError extends Error {
  constructor(
    message: string,
    readonly kind: "verdict" | "transport" | "unrecognized",
  ) {
    super(message);
    this.name = "EnqueueAnswerError";
  }
}

/**
 * Did this 2xx actually enqueue a job?
 *
 * `/api/keys/sync` stamps `ok: true` on its three structured success branches
 * ONLY. Its drift fallback returns the unrecognised upstream body through
 * un-stamped, and says why in the route: *"marking an unrecognized shape ok:true
 * would falsely signal success"*. So the one 2xx that means "no job was
 * enqueued" is exactly the one that must not start a poll for it.
 */
function isSyncEnqueued(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    (body as Record<string, unknown>).ok === true
  );
}

/**
 * 167.2-REVIEW-SFH-R2 R2-L2: did this enqueued answer queue a NEW job for this
 * attempt? `/api/keys/sync` answers `ok: true` for a duplicate submission
 * (`code: "WIZARD_DUPLICATE"`) and can carry `queued: false`; neither is a job
 * this attempt started. Only a new job lets the panel's give-up attribute a
 * `failed_final` chain to this attempt (KCS-02: per-attempt evidence). The
 * composite branch carries no `queued` field and did enqueue.
 */
function enqueuedNewJob(body: unknown): boolean {
  const fields = body as Record<string, unknown>;
  return fields.queued !== false && fields.code !== "WIZARD_DUPLICATE";
}

/**
 * Phase 167 / 167-06 fix round (167-CONTEXT D-18): the ONE tracked sync
 * attempt, started by `handleSyncTrades`. `syncingKeyId` is its render-side
 * marker; this record is what decides who may end it.
 *
 * THE DEFECT IT CLOSES. The marker and the terminal handling used to be
 * scoped to nothing, so two things that do not belong to an attempt could end
 * it, and the attempt then ran on in `computing` with no marker, re-opening
 * R1's, R4's and R5's windows for its own key:
 *   - a failed post-add background sync cleared the marker (R6 as first
 *     shipped, 167-REVIEW-06 CR-01);
 *   - a poll read taken BEFORE the attempt's own `/api/keys/sync` answered.
 *     `SyncProgress` polls while `syncing`, so a slow enqueue let the poll
 *     read the strategy's PREVIOUS analytics row, and that row's terminal
 *     status ended the attempt before its job existed.
 *
 * THE RULES. Only the attempt ends itself (`endAttempt`, the one place the
 * marker is cleared). A poll status is ignored until the attempt's enqueue
 * response has resolved, because a read taken before then is about an earlier
 * run. Once a terminal success arrives, later reads are ignored while its
 * re-read settles, and that re-read is bounded (`TERMINAL_REREAD_BOUND_MS`).
 *
 * 167-06 fix round 2 (167-REVIEW-06-R2 CR-01): ignoring a pre-enqueue read was
 * not enough on its own. The poller's attempt budget is local to its effect,
 * and the effect used to span `syncing` and `computing`, so pre-enqueue polls
 * still SPENT that budget and a slow enqueue that succeeded was ended by the
 * timeout one tick later. `SyncProgress` now polls in `computing` only, which
 * this component enters only after `enqueued` is set, so there is no
 * pre-enqueue read and the budget starts at the enqueue. The `enqueued` check
 * below is kept as a second line: it is what makes this component's rule
 * independent of how the panel gates its poll.
 *
 * ENDED-ATTEMPT BRANCHES. The attempt is registered before any await, so
 * anything that checks `attemptRef` sees it as live from the click (until
 * 167.2 KCS-01 that included an untracked post-add sync's catch; the post-add
 * sync is now itself the tracked attempt). A
 * continuation of an attempt that has already ended (its terminal arrived, then
 * its own post-enqueue re-read threw, possibly after a NEWER attempt started)
 * may not write the panel or the marker: `endAttempt` answers false for it.
 */
interface SyncAttempt {
  keyId: string;
  /** The attempt's own `/api/keys/sync` returned enqueue evidence. */
  enqueued: boolean;
  /** A terminal success arrived and its re-read has not resolved yet. */
  settling: boolean;
}

/**
 * 167-06 fix round 2 (SFH2-MED-1 / 167-REVIEW-06-R2 IN-01): how long a terminal
 * success waits for its re-read. While it waits, the panel spins and the marker
 * holds, and supabase-js sets no request timeout of its own, so an unbounded
 * wait could hold both for as long as the network stack keeps the request open.
 * On the bound the attempt ends exactly as after a FAILED re-read: the success
 * is withheld (idle) and the load error is shown, because an unverified list
 * cannot vouch for the subject key. 15 s is five poll intervals, and well past
 * a normal list read.
 */
const TERMINAL_REREAD_BOUND_MS = 15_000;

/**
 * Phase 167.2 / KCS-02 (RESEARCH P4, Q2): how long the pre-enqueue baseline
 * read of `strategy_analytics.computed_at` may take. It is the same class of
 * request as the terminal re-read above (one owner-scoped PostgREST read, and
 * supabase-js sets no timeout of its own), so it takes the same bound. On
 * expiry or error the attempt continues with an `"unknown"` baseline: the panel
 * then admits a terminal only after it has read `computing` itself (evidence
 * (a)), and never on a changed `computed_at` (evidence (b)).
 */
const BASELINE_READ_BOUND_MS = 15_000;

/**
 * Phase 167.2 / KCS-04: what one key-list read tells the terminal arm. `ok` is
 * whether the list now on screen came from a clean read; `subjectStatus` is the
 * `sync_status` of the sync panel's subject key (`lastAttemptedKeyId`) in the
 * rows that were APPLIED, or null when the subject is not among them. A read
 * dropped as out of date (WR-04) answers with the applied read's outcome.
 */
interface KeysReadOutcome {
  ok: boolean;
  subjectStatus: string | null;
  /**
   * 167.2-REVIEW-SFH L-2: whether the subject key is among the applied rows at
   * all. A subject missing from them (deleted in another tab) used to read as
   * `subjectStatus: null`, i.e. "not untrusted", and the panel showed "Up to
   * date" for a key the list no longer held.
   */
  subjectPresent: boolean;
}


// Phase 200 D-01 (ROUTE-09): what the key cards say about the strategies each
// key feeds. A read that failed is never "Feeds no strategy.": a manager
// deciding whether to delete or re-point a key is never told it is unused when
// the app simply could not look.
const FEEDS_NONE_COPY = "Feeds no strategy.";
const FEEDS_UNCHECKED_COPY = "Could not check which strategies this key feeds.";

// Phase 200 D-07 (ROUTE-09): the edit page shows this strategy's one key, so
// the empty states say what is true of THIS strategy. A current key the list
// cannot hold (read through RLS) is never reported as "no key linked".
const NO_KEY_LINKED_COPY = "No key is linked to this strategy yet.";
const KEY_NOT_LISTED_COPY = "This strategy's key is not in your account's key list.";
// The one place keys are added, deleted and updated (D-06), reachable from the
// edit page for every role that can hold a key (plan 07 opens the tab).
const PROFILE_KEYS_HREF = "/profile?tab=exchanges";

type FeedsState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ok"; feeds: Record<string, KeyFeed[]> };

/** A `KeyFeed` as the browser accepts it; anything else makes the read fail. */
function parseKeyFeed(value: unknown): KeyFeed | null {
  if (value === null || typeof value !== "object") return null;
  const f = value as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : v === null ? null : undefined);
  const strategy_id = text(f.strategy_id);
  const name = text(f.name);
  const status = text(f.status);
  if (strategy_id === undefined || name === undefined || status === undefined) return null;
  if (f.kind !== "single" && f.kind !== "composite") return null;
  return { strategy_id, name, status, kind: f.kind };
}

/**
 * One read of `GET /api/keys/feeds`, which answers every key the caller owns
 * in one call (a per-key read would spend the route's 5-per-60-s limiter on a
 * list of more than five keys). Bounded like the card's other reads
 * (`BASELINE_READ_BOUND_MS`); the abort also stops a body that never finishes.
 * Never throws: a non-2xx answer, a body that is not `{ feeds: { <id>: [...] } }`,
 * a rejected fetch and the bound all answer "failed". Logs the reason only, no
 * key id and no strategy id.
 */
async function readKeyFeeds(): Promise<FeedsState> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), BASELINE_READ_BOUND_MS);
  let failure: string;
  try {
    const res = await fetch("/api/keys/feeds", { cache: "no-store", signal: abort.signal });
    if (!res.ok) {
      failure = `the feeds read answered HTTP ${res.status}`;
    } else {
      const body = (await res.json()) as unknown;
      const raw =
        body !== null && typeof body === "object"
          ? (body as { feeds?: unknown }).feeds
          : undefined;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        failure = "the feeds answer carried no feeds map";
      } else {
        const feeds: Record<string, KeyFeed[]> = {};
        let malformed = false;
        for (const [keyId, list] of Object.entries(raw as Record<string, unknown>)) {
          const parsed = Array.isArray(list) ? list.map(parseKeyFeed) : null;
          if (parsed === null || parsed.includes(null)) {
            malformed = true;
            break;
          }
          feeds[keyId] = parsed as KeyFeed[];
        }
        if (!malformed) return { status: "ok", feeds };
        failure = "the feeds answer carried a malformed entry";
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  console.error("[ApiKeyManager] the key feeds read failed; the cards say they could not check:", failure);
  return { status: "failed" };
}

/**
 * The feeds line under a key card: the strategies the key feeds, each a link to
 * its edit page, or `Feeds no strategy.`, or the could-not-check line. Renders
 * nothing while the read is open. A key id missing from an OK map is "could not
 * check", never "feeds nothing": the route answers every owned key, so a miss
 * means the answer is not about this key. A strategy with no id (a composite
 * row the route redacted) is named without a link.
 */
function KeyFeedsLine({
  keyId,
  state,
  onRetry,
  testIdPrefix = "api-key-feeds",
}: {
  keyId: string;
  state: FeedsState;
  onRetry: () => void;
  testIdPrefix?: string;
}) {
  if (state.status === "loading") return null;
  const feeds = state.status === "ok" ? state.feeds[keyId] : undefined;
  if (!feeds) {
    // SFH-3 (round 1): the route allows 5 reads per 60 s, so a burst of key
    // changes can fail the read. One Retry re-runs it; without it the line
    // stayed "could not check" until the page was reloaded.
    return (
      <div className="flex flex-wrap items-center gap-x-2">
        <p data-testid={`${testIdPrefix}-${keyId}`} className="mt-0.5 text-xs text-warning">
          {FEEDS_UNCHECKED_COPY}
        </p>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (feeds.length === 0) {
    return (
      <p data-testid={`${testIdPrefix}-${keyId}`} className="mt-0.5 text-xs text-text-muted">
        {FEEDS_NONE_COPY}
      </p>
    );
  }
  return (
    <p data-testid={`${testIdPrefix}-${keyId}`} className="mt-0.5 text-xs text-text-muted">
      Feeds:{" "}
      {feeds.map((feed, i) => (
        <span key={`${feed.kind}-${feed.strategy_id ?? "unreadable"}-${i}`}>
          {i > 0 && ", "}
          {feed.strategy_id === null ? (
            "a strategy we could not read"
          ) : (
            <Link
              href={`/strategies/${feed.strategy_id}/edit`}
              className="text-accent underline underline-offset-4"
            >
              {feed.name ?? "Unnamed strategy"}
            </Link>
          )}
        </span>
      ))}
    </p>
  );
}

export function ApiKeyManager({
  strategyId,
  strategyName,
  currentKeyId,
  keyShape = "single",
  compositeMemberKeyIds,
}: ApiKeyManagerProps) {
  /**
   * Phase 167.2 / KCS-23: may this card offer a control that writes
   * `strategies.api_key_id` (Resync, Change key…)? Only when the page
   * knows the strategy is NOT a composite. `handleLinkKey` writes that column
   * unconditionally, so on a composite `Change key…` would silently turn it into
   * a single-key strategy. An "unknown" shape fails closed on these controls,
   * since it might be a composite, but each key's pill and the Profile link
   * stay, because the /strategies "Sign-in failed" pill links here for its
   * remedy (Phase 200 D-07: add, delete and update password moved to the
   * Profile API keys tab). The link handlers also return early when this is
   * false (defence in depth behind the missing buttons).
   */
  const linkControlsAllowed = keyShape === "single";
  const [keys, setKeys] = useState<ApiKey[]>([]);
  // D-03 (164.6.6.3.1): `keys` starts as `[]`, so without this flag the empty
  // sentence paints for the whole first read over a user who has keys. Set by
  // every arm that SETTLES a read (clean, failed, thrown), never by the
  // superseded early return, and never reset: a re-read keeps the list it has.
  const [firstReadSettled, setFirstReadSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // H-0395: distinct load-failure state. Without it, a failed api_keys SELECT
  // (RLS regression after a GRANT migration, expired session, network error)
  // left `keys` at [] and the render showed the misleading "No API keys
  // connected" empty state — a user with keys would think they vanished and
  // could re-add a duplicate. We now discriminate failure from genuine-empty
  // and surface a retryable error banner instead of the all-clear empty state.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncingKeyId, setSyncingKeyId] = useState<string | null>(null);
  // `lastAttemptedKeyId` survives the catch block that clears
  // `syncingKeyId` so the SyncProgress retry button has a stable
  // target. Without it, the retry closure would see null and no-op
  // (pre-existing bug found in Task 1.2 Phase 3 eng review).
  const [lastAttemptedKeyId, setLastAttemptedKeyId] = useState<string | null>(null);
  // Phase 167.2 / KCS-04: the same subject, mirrored into a ref wherever the
  // state is set. `loadKeys` is a useCallback keyed on `currentKeyId` only, so
  // it reads the subject here rather than from the render it closed over.
  const lastAttemptedKeyIdRef = useRef<string | null>(null);
  // Phase 200 R2-01: the key the manager confirmed (or saw) as the strategy's
  // current key when the last attempt began, replayed by the panel's Retry. The
  // write is conditioned on THIS, never on the live `currentKeyId` prop, which
  // changes under a mounted card on any `router.refresh()`. A ref, read at
  // click time like `attemptRef`; it drives no render.
  const lastAttemptExpectedKeyIdRef = useRef<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Phase 200 D-03 (ROUTE-09): the key a `Change key…` pick asked to re-point
  // the strategy to, held until the manager confirms. Nothing is written while
  // it is only pending.
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  // Phase 200 D-07: whether the `Change key…` picker is open. A pick only sets
  // `pendingKeyId` (and closes this); the write is `confirmPendingKey`'s.
  const [pickerOpen, setPickerOpen] = useState(false);
  // The live tracked attempt, or null. See `SyncAttempt`. A ref, not state: it
  // is read inside async continuations that must see the CURRENT attempt, not
  // the one their render closed over, and it never drives a render itself
  // (`syncingKeyId` does).
  const attemptRef = useRef<SyncAttempt | null>(null);
  // 167.2-REVIEW-SFH M-1: the attempt whose `enqueue_bound` panel is on screen,
  // or null. Its late enqueue answer may update THAT panel (a late 2xx says
  // the sync started; a late rejection shows the route's own failure), and
  // only while nothing newer began: every registration clears it.
  const unconfirmedAttemptRef = useRef<SyncAttempt | null>(null);
  // Phase 167.2 / KCS-02: the tracked attempt's pre-enqueue `computed_at`
  // (see `readEvidenceBaseline`), and a per-attempt sequence that keys the
  // panel. The panel stays mounted from `error` into a Retry, so without the
  // key its "has read computing" evidence would carry into the next attempt.
  const [evidenceBaseline, setEvidenceBaseline] = useState<EvidenceBaseline>("unknown");
  const [attemptSeq, setAttemptSeq] = useState(0);
  // 167.2-REVIEW-SFH-R2 R2-L2: whether the live attempt's enqueue queued a NEW
  // job (see `enqueuedNewJob`). Reset at every registration.
  const [attemptEnqueuedNewJob, setAttemptEnqueuedNewJob] = useState(false);
  // Phase 167.2 / KCS-22: which give-up ended the attempt as `no_result` (the
  // reason the panel forwarded), so the panel says how long it waited. Reset
  // at every attempt's registration.
  const [panelStopReason, setPanelStopReason] = useState<PanelStopReason | null>(null);
  // 167-06 fix round 2 (167-REVIEW-06-R2 WR-04): the key-list reads are
  // ORDERED. Each `loadKeys` call takes the next number; a response older than
  // the newest one already applied is dropped. Without it, an attempt's own
  // post-enqueue read could resolve AFTER the terminal arm's re-read and
  // install the snapshot from before the job ran, lifting R2's withhold beside
  // a key whose sign-in had failed on the server.
  const keysReadSeqRef = useRef(0);
  // KCS-04: the applied read also records its subject status, so a dropped
  // read answers with what the list on screen actually shows.
  const appliedKeysReadRef = useRef<{ seq: number } & KeysReadOutcome>({
    seq: 0,
    ok: true,
    subjectStatus: null,
    subjectPresent: false,
  });
  // 167.2-REVIEW-SFH L-1: a terminal SUCCESS was withheld because the list
  // could not be re-read (not because its key is untrusted). The panel lands
  // on idle and unmounts, so without this nothing said a sync had just
  // finished once a later read cleared the load-error banner. Cleared only by
  // the next attempt's registration, never by a list read.
  const [finishUnverified, setFinishUnverified] = useState(false);
  const router = useRouter();
  // Phase 200 D-01: which strategies each key feeds, from ONE read of
  // `GET /api/keys/feeds`. Read once on mount and again only after a completed
  // key change (a link, an add, a delete), never from `loadKeys` and never on
  // the sync poll, so the route's 5-per-60-s limiter is never spent by
  // polling. ORDERED like `loadKeys`: an answer older than the newest read, or
  // one that lands after an unmount, is dropped.
  const [feedsState, setFeedsState] = useState<FeedsState>({ status: "loading" });
  const feedsSeqRef = useRef(0);
  const loadFeeds = useCallback(async () => {
    const seq = ++feedsSeqRef.current;
    const next = await readKeyFeeds();
    if (seq === feedsSeqRef.current) setFeedsState(next);
  }, []);
  // After a key change the old map may be wrong (a re-point, a new key with no
  // entry yet, a deleted key), so the lines go quiet until the new answer lands.
  const refreshFeeds = useCallback(() => {
    setFeedsState({ status: "loading" });
    void loadFeeds();
  }, [loadFeeds]);
  useEffect(() => {
    void loadFeeds();
    return () => {
      feedsSeqRef.current += 1;
    };
  }, [loadFeeds]);
  // Phase 164.6.6.3.5 (AD-05): where every "contact form" pointer on this card
  // goes, with this strategy's id attached. Same tab (UI-SPEC pointer rule for
  // these surfaces).
  const supportContactHref = contactHref({ topic: "support", strategy: strategyId });

  // 167.2-REVIEW IN-02: an unmount mid-attempt drops the live attempt, so every
  // liveness guard (`attemptRef.current !== attempt`) stops its continuations:
  // no baseline read, no enqueue follow-up, no list read and no
  // `router.refresh()` of whatever route the owner navigated to.
  useEffect(
    () => () => {
      attemptRef.current = null;
      unconfirmedAttemptRef.current = null;
    },
    [],
  );

  /**
   * 167.2-REVIEW IN-01: retire a shown terminal success, as a STABLE callback
   * that reads nothing from its render (only the stable `setSyncStatus`), so
   * `loadKeys` can depend on it honestly. (Phase 200 plan 08: the event-handler
   * wrapper that used to call it from Add Key, Delete and Update password went
   * with those controls; `loadKeys` is its one caller.)
   */
  const retireSuccessIf = useCallback((subjectUntrusted: boolean) => {
    if (!subjectUntrusted) return;
    setSyncStatus((prev) => (isComputedAnalytics(prev) ? "idle" : prev));
  }, []);

  // Resolves `{ ok, subjectStatus }` (see `KeysReadOutcome`): `ok` is false
  // when the read failed (and `loadError` is set), and `subjectStatus` is the
  // panel subject's status in the rows this read APPLIED. The terminal-success
  // arm needs both: it shows a success only after a clean re-read whose rows
  // show the subject trusted (KCS-04). A read dropped as out of date (WR-04)
  // answers with the outcome of the newer read that was applied instead, since
  // that is what the list now shows.
  //
  // Phase 167.2 / KCS-04: every applied read also retires a shown success
  // whose subject it finds untrusted (`retireSuccessIf`), so a success
  // never outlives the moment the list shows its key untrusted.
  const loadKeys = useCallback(async (opts?: { lastSyncedKeyId?: string }): Promise<KeysReadOutcome> => {
    const seq = ++keysReadSeqRef.current;
    const supabase = createClient();
    // Project only the allowlist — never `.select("*")` on api_keys from a
    // user-scoped client. Migration 027 (SEC-005) revokes SELECT on the
    // encrypted columns; `.select("*")` would silently return NULL for them.
    // FINDING-3: destructure error from api_keys SELECT and log on failure.
    // Pre-fix: {error} was discarded; on RLS regression/session expiry/network
    // error the key list silently stayed stale with no log entry and no user
    // feedback. The if(data) guard below still correctly short-circuits on
    // failure — this adds the missing observability.
    const { data, error: keysErr } = await supabase
      .from("api_keys")
      .select(API_KEY_USER_COLUMNS)
      .order("created_at", { ascending: false });
    if (seq < appliedKeysReadRef.current.seq) {
      const { ok, subjectStatus, subjectPresent } = appliedKeysReadRef.current;
      return { ok, subjectStatus, subjectPresent };
    }
    // 167.2-REVIEW-SFH L-2: `data: null` with no error is not a clean read
    // either (it used to be recorded as `ok: true`), so it takes the error arm.
    if (keysErr || !data) {
      // The rows on screen are unchanged, so is their subject status.
      const { subjectStatus: prevStatus, subjectPresent: prevPresent } =
        appliedKeysReadRef.current;
      appliedKeysReadRef.current = {
        seq,
        ok: false,
        subjectStatus: prevStatus,
        subjectPresent: prevPresent,
      };
      const message = keysErr?.message ?? "the key list read returned no rows and no error";
      console.error("[ApiKeyManager] api_keys fetch failed:", message);
      // H-0395: a non-empty error (network/RLS/session) is NOT "no keys".
      // Surface a distinct, retryable error state and keep whatever keys we
      // had — never let the failure collapse into the empty "no keys" UI.
      setLoadError(message);
      // D-03: a failed read is a settled read; the error card owns the screen.
      setFirstReadSettled(true);
      return { ok: false, subjectStatus: prevStatus, subjectPresent: prevPresent };
    }
    const subjectRow = data.find((k) => k.id === lastAttemptedKeyIdRef.current);
    const subjectStatus = subjectRow?.sync_status ?? null;
    const subjectPresent = subjectRow !== undefined;
    appliedKeysReadRef.current = { seq, ok: true, subjectStatus, subjectPresent };
    // Reached only on a clean response: clear any prior load error so a
    // successful retry restores the normal list / genuine-empty state.
    setLoadError(null);
    // D-03: a clean read, empty or not, settles the first read.
    setFirstReadSettled(true);
    if (data) {
      setKeys(data);
      // NEW-C37-04: derive lastSyncAt from the key that was actually synced
      // (opts.lastSyncedKeyId) rather than always from currentKeyId. When the
      // user clicks "Use & Sync" on a not-yet-current key, currentKeyId (a
      // prop) does not change until router.refresh() completes; reading from
      // it here would show the previously-linked key's timestamp immediately
      // after a successful sync of a different key.
      const targetKeyId = opts?.lastSyncedKeyId ?? currentKeyId;
      const targetKey = data.find((k) => k.id === targetKeyId);
      if (targetKey?.last_sync_at) setLastSyncAt(targetKey.last_sync_at);
    }
    // KCS-04: the new call site of the one retirement helper. It judges by
    // THESE rows, never by a render's copy, and its updater leaves every
    // in-flight value (syncing, computing) and every non-success alone.
    // IN-01: through the stable core, an honest dependency (no lint disable).
    retireSuccessIf(isUntrustedKeySyncStatus(subjectStatus));
    return { ok: true, subjectStatus, subjectPresent };
  }, [currentKeyId, retireSuccessIf]);

  useEffect(() => {
    // D-03: a THROWN first read (the client threw before any response) used to
    // be a dropped promise: no error state and no settled flag, so the card
    // fell through to "No API keys connected." (H-0395: a failure is never "no
    // keys"). It settles into the same retryable load-error card instead.
    // `loadKeys` itself is not wrapped, so the terminal re-read keeps its own
    // catch and capture. Logs the error object only, no key id or label.
    loadKeys().catch((err: unknown) => {
      console.error("[ApiKeyManager] api_keys first read threw:", err);
      setLoadError(err instanceof Error ? err.message : "The key list read failed.");
      setFirstReadSettled(true);
    });
  }, [loadKeys]);

  /**
   * End `attempt` if, and only if, it is still the live tracked attempt. This
   * is the ONLY place the in-flight marker is cleared, so nothing that does not
   * own an attempt can end it (see `SyncAttempt`). Returns whether it ended it.
   */
  const endAttempt = useCallback((attempt: SyncAttempt): boolean => {
    if (attemptRef.current !== attempt) return false;
    attemptRef.current = null;
    setSyncingKeyId(null);
    return true;
  }, []);

  const handleSyncStatusChange = useCallback(async (status: SyncStatus, info?: SyncStatusInfo) => {
    // Only the live attempt's poll may move the panel, and only after its own
    // enqueue response resolved: a read taken before then is the strategy's
    // PREVIOUS analytics row, and its terminal status would end this attempt
    // before its job exists (see `SyncAttempt`). Reads that land while a
    // terminal success's re-read is settling are ignored too, so one terminal
    // is handled once.
    const attempt = attemptRef.current;
    if (!attempt || !attempt.enqueued || attempt.settling) return;

    // complete_with_warnings is a terminal SUCCESS (SyncProgress maps the
    // DB-native value to this UI state; mig 20260707120000 now persists it
    // instead of laundering to 'complete'). Treat it exactly like 'complete',
    // else syncingKeyId is never cleared and every key's Resync/Use button
    // stays disabled ("Syncing…") forever while the panel says "Synced with
    // warnings" — a permanent dead-lock only a reload recovers.
    if (status === "complete" || status === "complete_with_warnings") {
      // 167-06 fix round (SFH LOW-1): the success is SHOWN only after the
      // re-read that R2 judges it by. Setting it first showed "Up to date" for
      // the length of a re-read that could then withhold it (the card's pill
      // and live region only update when that re-read lands). Until it resolves the panel stays
      // in `computing` and the marker stays set, so R4's and R5's disables hold
      // across the gap. A failed re-read keeps the success withheld (the panel
      // goes idle) and surfaces the load error instead: an unverified list
      // cannot vouch for the subject key.
      attempt.settling = true;
      let reread: KeysReadOutcome | null = null;
      let boundTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        // 167-06 fix round 2 (SFH2-MED-1): the re-read is raced against
        // `TERMINAL_REREAD_BOUND_MS`, so a request that never settles cannot
        // hold `settling`, the spinner and the marker indefinitely.
        const bound = new Promise<"timed_out">((resolve) => {
          boundTimer = setTimeout(() => resolve("timed_out"), TERMINAL_REREAD_BOUND_MS);
        });
        // NEW-C37-04: pass the key that was actually synced so loadKeys can
        // derive lastSyncAt from the correct row, not from currentKeyId.
        const outcome = await Promise.race([
          loadKeys({ lastSyncedKeyId: attempt.keyId }),
          bound,
        ]);
        if (outcome === "timed_out") {
          console.error(
            `[ApiKeyManager] the terminal re-read did not answer within ${TERMINAL_REREAD_BOUND_MS} ms; the success is withheld:`,
            { keyId: attempt.keyId },
          );
          setLoadError("The key list re-read did not answer in time.");
          // 167.2-REVIEW-SFH M-6: an owner-scoped read hanging for 15 s is an
          // operational signal; tags only (no key id, no strategy id).
          captureToSentry(new Error("the terminal key-list re-read did not answer within its bound"), {
            level: "warning",
            tags: { component: "ApiKeyManager", stage: "terminal-reread-bound" },
          });
        } else {
          reread = outcome;
        }
      } catch (err) {
        // 167-06 fix round 2 (SFH2-LOW-1 / IN-04): `SyncProgress` drops this
        // handler's promise, so a throw here was an unhandled rejection and the
        // attempt ended with neither a success nor an error on screen. Treat it
        // as a failed re-read: the success stays withheld, the load error shows.
        console.error(
          `[ApiKeyManager] the terminal re-read threw; the success is withheld [key_id=${attempt.keyId}]:`,
          err,
        );
        setLoadError(err instanceof Error ? err.message : "The key list re-read failed.");
        // 167.2-REVIEW-SFH M-6: captured, not only logged.
        captureToSentry(err, {
          tags: { component: "ApiKeyManager", stage: "terminal-reread" },
        });
      } finally {
        clearTimeout(boundTimer);
        endAttempt(attempt);
        // Phase 167.2 / KCS-04: the moment of withholding is the moment of
        // retirement. A success is set only when the re-read resolved cleanly
        // AND its applied rows show the subject key trusted. Beside an
        // untrusted subject the panel lands on idle, as after a failed re-read,
        // so no later re-read (the load-error Retry, a refresh, another tab's
        // fix or delete) can lift a render-time withhold and re-show it.
        // 167.2-REVIEW-SFH L-2: and only while the subject is still among the
        // applied rows; a subject deleted elsewhere shows no success.
        const subjectTrusted =
          reread !== null &&
          reread.subjectPresent &&
          !isUntrustedKeySyncStatus(reread.subjectStatus);
        setSyncStatus(reread?.ok && subjectTrusted ? status : "idle");
        // 167.2-REVIEW-SFH L-1: withheld because the LIST is unverified (a
        // failed, thrown or timed-out re-read), not because of the key: say
        // that the sync finished, in a note the later reads do not clear.
        if (reread === null || !reread.ok) setFinishUnverified(true);
        router.refresh();
      }
    } else if (status === "no_result") {
      // Phase 167.2 / KCS-22: the panel stopped checking (its poll cap or its
      // missing-row grace ran out) with no accepted result. That ends the
      // attempt, so Resync, Update password and Delete are usable again, but it
      // is not a failure: no "Sync failed", no Retry, no error detail.
      endAttempt(attempt);
      setSyncStatus("no_result");
      setPanelStopReason(info?.stopReason ?? null);
      setSyncError(null);
    } else if (status === "error") {
      endAttempt(attempt);
      setSyncStatus("error");
      // Phase 167.2 / KCS-22 (lineage: FINDING-8). This arm used to fill a
      // default timeout sentence whenever syncError was null, because the
      // poller's give-up arrived here as "error". A give-up is now `no_result`
      // (the arm above), so the only thing that reaches this arm from the panel
      // is an evidenced failed row, and it carries its own reason: the row's
      // server-scrubbed `computation_error`, the field the wizard's
      // SyncPreviewStep already renders. With no reason the panel shows "Sync
      // failed" with no detail line; a timeout claim with no timeout behind it
      // was a false line. An enqueue failure's message (set by
      // `handleSyncTrades`' catch) is never overwritten.
      setSyncError((prev) => prev ?? info?.computationError ?? null);
    } else {
      setSyncStatus(status);
    }
  }, [router, loadKeys, endAttempt]);

  /**
   * Phase 167 / 167-06, R2 (167-CONTEXT D-18): is the sync panel's SUBJECT key
   * untrusted on the server? The subject is `lastAttemptedKeyId`, the key the
   * panel's attempt belongs to. A subject row missing from `keys` answers false.
   *
   * WHY THE PANEL'S SUCCESS IS WITHHELD BESIDE IT. `SyncProgress` is a LOCAL
   * state machine, fed from component state and never from
   * `api_keys.sync_status`. `run_sync_trades_job`'s MT5 branch makes the
   * daily-PnL fetch an explicit no-op and its balance read is best-effort, so a
   * resync of an MT5 key whose password is wrong can still finish as a terminal
   * success and render "Up to date". That line is a claim about an analytics
   * run, NOT evidence that the credential works; the server-read sign-in
   * failure is the only evidence about the credential, and a success line
   * beside it is the false confidence this phase exists to remove.
   *
   * WHAT IS WITHHELD, AND ONLY THAT. The terminal-success render (the shared
   * `isComputedAnalytics` predicate, never an exact match on one success
   * value). The ERROR render is kept: it agrees with the pill and carries that
   * attempt's own message. ⛔ The panel is NEVER withheld in flight (syncing or
   * computing): its poll is what drives `handleSyncStatusChange`, and
   * unmounting it mid-flight would strand `syncingKeyId`, leaving every Resync
   * disabled until a reload. Pure derivations in render, no effect and no state
   * that mirrors other state. 167-UI-SPEC S1 / S1b: the retry-in-flight cell
   * (no credential claim under a spinner) and the optimistic cell (a claim
   * renders only from a status read back from the server).
   *
   * Phase 167.2 / KCS-04 (KCS-05 names the replacement): R2's "withheld" is now
   * "RETIRED". The terminal arm of `handleSyncStatusChange` lands on idle when
   * its re-read's applied rows show the subject untrusted, and every applied
   * list read retires a shown success whose subject it finds untrusted. This
   * render-time derivation stays as a BACKSTOP only: it should never find a
   * success to hide, and it is no longer what keeps a success off screen,
   * because a withhold lapsed the moment a later re-read (another tab's fix or
   * delete, the load-error Retry) stopped reading the key as untrusted.
   */
  /**
   * 167.2-REVIEW CR-02, Phase 200 D-07: the keys this card LISTS. On a composite,
   * only its members (see `compositeMemberKeyIds`); every other shape lists
   * only the strategy's own current key, so the edit page is this strategy's
   * key panel and not the account's key list (that is the Profile API keys
   * tab). `keys` stays the full list: the `Change key…` picker, the confirm's
   * labels and the share-note holder look-up read it, and none of them is a
   * claim about what this strategy reads from.
   */
  const listedKeys =
    keyShape === "composite"
      ? keys.filter((k) => compositeMemberKeyIds?.includes(k.id) ?? false)
      : keys.filter((k) => k.id === currentKeyId);
  // Phase 167.1.2 plan 04 — accountShareNote's holder look-up, over every key
  // this read returned (see the render).
  const keysById = new Map(keys.map((k) => [k.id, k]));
  // Phase 200 D-04: the shared key label ("<Exchange> — <label>", a masked id
  // tail when the label is empty) the re-point confirm names both keys with.
  const keyLabels = apiKeyLabelById(keys);
  const pendingKeyLabel = pendingKeyId === null ? undefined : keyLabels.get(pendingKeyId);
  // Phase 200 D-07: the account keys the strategy could be re-pointed to. The
  // one `Change key…` control exists only for a single-key shape (KCS-23) and
  // only when there is another key to pick.
  const changeKeyCandidates = linkControlsAllowed
    ? keys.filter((k) => k.id !== currentKeyId)
    : [];
  const showChangeKey = firstReadSettled && changeKeyCandidates.length > 0;
  const changeKeyBlocked = !!syncingKeyId;

  const panelSubjectUntrusted = isUntrustedKeySyncStatus(
    keys.find((k) => k.id === lastAttemptedKeyId)?.sync_status,
  );
  const withholdPanelSuccess =
    isComputedAnalytics(syncStatus) && panelSubjectUntrusted;

  async function handleLinkKey(keyId: string, expectedCurrent: string | null) {
    // KCS-23: the one write of `strategies.api_key_id` on this card. Never on a
    // composite, nor on a strategy the page could not classify. It throws
    // rather than returning, so a caller cannot go on to sync as if the key
    // were linked.
    if (!linkControlsAllowed) {
      throw new Error("This strategy's keys are not linked from this card.");
    }
    const supabase = createClient();
    // C1/FINDING-4: destructure and throw on error so handleSyncTrades
    // cannot proceed to /api/keys/sync against the wrong api_key_id when
    // the link update is denied (RLS violation, stale session, wrong
    // strategyId). Pre-fix: the {error} return was silently discarded —
    // the same pre-fix scenario that NEW-C37-03 fixed for handleAddKey.
    //
    // Phase 200 CR-01 (round 1): a Resync (`keyId` is the key the page shows as
    // current) writes NOTHING. It used to write `api_key_id = keyId` with no
    // condition, so on a page opened before another tab or the wizard changed
    // the key it silently re-pointed the strategy back with no confirm. The
    // read-back in `handleSyncTrades` now refuses a stale Resync as
    // `link_unverified`. The confirmed re-point is conditional on the key the
    // dialog NAMED as current, so a write can never land over a key the
    // manager did not see: zero matched rows is a loud error, never a success.
    //
    // Phase 200 R2-01: `expectedCurrent` is the key the ATTEMPT was started or
    // confirmed against, carried with it and replayed by the panel's Retry. It
    // is never the live `currentKeyId` prop: that moves under a mounted card on
    // any `router.refresh()`, so a Retry read it at click time and wrote a key
    // no dialog had named over a key the manager never saw.
    if (keyId === expectedCurrent) return;
    const guarded = supabase.from("strategies").update({ api_key_id: keyId }).eq("id", strategyId);
    const { data: linkedRows, error: linkError } = await (
      expectedCurrent === null ? guarded.is("api_key_id", null) : guarded.eq("api_key_id", expectedCurrent)
    ).select("id");
    if (linkError) {
      throw new Error(`Failed to link key to strategy: ${linkError.message}`);
    }
    if (linkedRows?.length !== 1) {
      throw new Error(
        "This strategy's key changed since the page loaded, so nothing was changed. Reload the page and try again.",
      );
    }
    // Phase 200 D-01: a re-point changes what two keys feed. Linking the key
    // the strategy already uses (a Resync) changes nothing, so it spends no read.
    if (keyId !== expectedCurrent) refreshFeeds();
    // 167.2-REVIEW WR-04 (lineage): `router.refresh()` used to run here,
    // unconditionally, so a link update answering after its bound (the
    // request is deliberately not aborted) refreshed whatever page was current.
    // The live-attempt path in `handleSyncTrades` refreshes instead.
  }

  /**
   * Phase 167.2 / KCS-02: read the strategy's `computed_at` immediately before
   * the enqueue, so the panel can tell this attempt's terminal from the previous
   * run's (see `EvidenceBaseline`). Phase 166.3.1 / D-05 panel: it reads
   * `computation_status` and `computation_error_job_id` in the same row read,
   * because D-05 holds `computed_at` on a failure and the panel's evidence (c)
   * compares those two. An absent row answers three NULLs, a real value. An
   * error, a throw, or `BASELINE_READ_BOUND_MS` expiring answers `"unknown"` and
   * logs; it never fails the attempt.
   */
  async function readEvidenceBaseline(): Promise<EvidenceBaseline> {
    // 167.2-REVIEW-SFH M-3 / M-6: an unknown baseline silently disables
    // evidence (b) and (c) for the whole attempt (a fast failure can then only
    // end at the cap), so each of the three arms below is captured at warning
    // level, tags only.
    const captureUnknown = (why: string) =>
      captureToSentry(new Error(`the evidence baseline read ${why}; the baseline is unknown`), {
        level: "warning",
        tags: { component: "ApiKeyManager", stage: "evidence-baseline" },
      });
    let boundTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const bound = new Promise<"timed_out">((resolve) => {
        boundTimer = setTimeout(() => resolve("timed_out"), BASELINE_READ_BOUND_MS);
      });
      const supabase = createClient();
      const outcome = await Promise.race([
        supabase
          .from("strategy_analytics")
          .select("computed_at, computation_status, computation_error_job_id")
          .eq("strategy_id", strategyId)
          .maybeSingle(),
        bound,
      ]);
      if (outcome === "timed_out") {
        console.error(
          `[ApiKeyManager] the evidence baseline read did not answer within ${BASELINE_READ_BOUND_MS} ms; continuing with an unknown baseline [strategy_id=${strategyId}]`,
        );
        captureUnknown("did not answer within its bound");
        return "unknown";
      }
      if (outcome.error) {
        console.error(
          `[ApiKeyManager] the evidence baseline read failed; continuing with an unknown baseline [strategy_id=${strategyId}]:`,
          outcome.error.message,
        );
        captureUnknown("failed");
        return "unknown";
      }
      return {
        computedAt: outcome.data?.computed_at ?? null,
        computationStatus: outcome.data?.computation_status ?? null,
        errorJobId: outcome.data?.computation_error_job_id ?? null,
      };
    } catch (err) {
      console.error(
        `[ApiKeyManager] the evidence baseline read threw; continuing with an unknown baseline [strategy_id=${strategyId}]:`,
        err,
      );
      captureUnknown("threw");
      return "unknown";
    } finally {
      clearTimeout(boundTimer);
    }
  }

  /**
   * 167.2-REVIEW WR-04: read the strategy's `api_key_id` back from the server,
   * after the link update and immediately before the enqueue. Bounded like the
   * baseline read (one owner-scoped PostgREST read, no timeout of its own).
   * Answers the linked id (null when none), or `"unreadable"` on an error, a
   * throw or the bound, and logs those. Never throws.
   */
  async function readLinkedKeyId(): Promise<string | null | "unreadable"> {
    let boundTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const bound = new Promise<"timed_out">((resolve) => {
        boundTimer = setTimeout(() => resolve("timed_out"), BASELINE_READ_BOUND_MS);
      });
      const supabase = createClient();
      const outcome = await Promise.race([
        supabase.from("strategies").select("api_key_id").eq("id", strategyId).maybeSingle(),
        bound,
      ]);
      if (outcome === "timed_out") {
        console.error(
          `[ApiKeyManager] the link read-back did not answer within ${BASELINE_READ_BOUND_MS} ms; no sync is sent [strategy_id=${strategyId}]`,
        );
        return "unreadable";
      }
      if (outcome.error) {
        console.error(
          `[ApiKeyManager] the link read-back failed; no sync is sent [strategy_id=${strategyId}]:`,
          outcome.error.message,
        );
        return "unreadable";
      }
      return outcome.data?.api_key_id ?? null;
    } catch (err) {
      console.error(
        `[ApiKeyManager] the link read-back threw; no sync is sent [strategy_id=${strategyId}]:`,
        err,
      );
      return "unreadable";
    } finally {
      clearTimeout(boundTimer);
    }
  }

  async function handleSyncTrades(keyId: string, expectedCurrent: string | null) {
    // Phase 167.2 / KCS-01: the card never starts a second sync while one is
    // live. Resync and a confirmed `Change key…` are disabled in that window;
    // this is the handler guard behind those disables, and the one that covers
    // the panel's Retry, which no card button gates.
    if (attemptRef.current !== null) return;
    // KCS-23: every sync from this card first re-links the strategy to `keyId`
    // (`handleLinkKey`), so none starts on a composite or an unknown shape. This
    // also covers the panel's Retry.
    if (!linkControlsAllowed) return;
    // The attempt is registered BEFORE any await, so `handleSyncStatusChange`
    // and anything else that checks `attemptRef` see it as live from the first
    // click.
    const attempt: SyncAttempt = { keyId, enqueued: false, settling: false };
    attemptRef.current = attempt;
    unconfirmedAttemptRef.current = null;
    // KCS-02: a fresh panel and no baseline until this attempt has read one.
    setAttemptSeq((seq) => seq + 1);
    setEvidenceBaseline("unknown");
    setAttemptEnqueuedNewJob(false);
    setPanelStopReason(null);
    setFinishUnverified(false);
    setSyncingKeyId(keyId);
    setLastAttemptedKeyId(keyId);
    lastAttemptedKeyIdRef.current = keyId;
    lastAttemptExpectedKeyIdRef.current = expectedCurrent;
    setSyncStatus("syncing");
    setSyncError(null);
    setError(null);

    try {
      // 167.2-REVIEW CR-01 / WR-06 — THE PRE-ATTEMPT JOB-STATE GATE. Orchestrator
      // decision (autonomous review-fix round): before any attempt links a key
      // or enqueues (Resync, Use & Sync, the post-add sync, the panel's Retry),
      // read whether a factsheet-chain job is in flight, and refuse while one
      // is or while the read cannot answer (fail closed).
      //   - CR-01: `no_result` and `unconfirmed` end an attempt whose job may
      //     still be running. The enqueue dedupes on (strategy, kind) and hands
      //     back the EXISTING job, and all of the panel's evidence is scoped to
      //     the STRATEGY, never the key. So `Use & Sync` on another key was
      //     served by the previous key's job, and the panel said "Up to date"
      //     under the new key: one key's result shown as another's.
      //   - WR-06: KCS-22 removed Retry on `no_result` because a re-POST during
      //     `failed_retry` inserts a second job (F-3), and Resync on the same
      //     key is that same re-POST.
      // The gate runs BEFORE the link, so a refused attempt writes nothing. It
      // ends the attempt as the amber `unconfirmed` panel with its own reason:
      // the sync "did not start", which is exactly what the card knows.
      const gate = await readChainJobState(strategyId);
      if (attemptRef.current !== attempt) return;
      if (gate.kind !== "settled") {
        if (gate.kind === "unreadable") {
          console.warn(
            `[ApiKeyManager] the job-state read was unreadable; the sync is refused [strategy_id=${strategyId}]:`,
            gate.reason,
          );
          captureToSentry(new Error(`pre-attempt job-state read unreadable: ${gate.reason}`), {
            level: "warning",
            tags: { component: "ApiKeyManager", stage: "pre-attempt-job-state" },
          });
        }
        if (endAttempt(attempt)) {
          setSyncStatus("unconfirmed");
          // 167.2-REVIEW-R2 IN-04: a deterministic DEGRADED answer gets copy
          // that names support instead of promising "in a moment".
          setPanelStopReason(
            gate.kind === "in_flight"
              ? "chain_in_flight"
              : gate.persistent
                ? "chain_unreadable_persistent"
                : "chain_unreadable",
          );
          setSyncError(null);
        }
        return;
      }

      // Link key to strategy first.
      // Phase 167.2 / KCS-03: raced against `LINK_UPDATE_BOUND_MS`, the same
      // shape as the enqueue race below. supabase-js sets no request timeout,
      // so a link update that never answered held the marker and the spinner
      // with no end. On expiry the attempt ends as `unconfirmed` / `link_bound`
      // ("Sync not started") and RETURNS before the baseline read and the
      // enqueue, so no enqueue is ever sent for this attempt. That is the only
      // reason the card may say the sync did not start (UI-SPEC § KCS-03). The
      // late answer is still awaited so it is logged (a late rejection reaches
      // the catch, which logs it because the attempt already ended); it never
      // resumes the attempt.
      const linked = handleLinkKey(keyId, expectedCurrent).then(() => "linked" as const);
      let linkTimer: ReturnType<typeof setTimeout> | undefined;
      let linkOutcome: "linked" | "timed_out";
      try {
        const bound = new Promise<"timed_out">((resolve) => {
          linkTimer = setTimeout(() => resolve("timed_out"), LINK_UPDATE_BOUND_MS);
        });
        linkOutcome = await Promise.race([linked, bound]);
      } finally {
        clearTimeout(linkTimer);
      }
      if (linkOutcome === "timed_out") {
        console.error(
          `[ApiKeyManager] the link update did not answer within ${LINK_UPDATE_BOUND_MS} ms; no sync is sent [key_id=${keyId}]`,
        );
        // 167.2-REVIEW-SFH M-6: tags only (the key id stays in the console).
        captureToSentry(new Error("the link update did not answer within its bound"), {
          level: "warning",
          tags: { component: "ApiKeyManager", stage: "link-bound" },
        });
        if (endAttempt(attempt)) {
          setSyncStatus("unconfirmed");
          setPanelStopReason("link_bound");
          setSyncError(null);
        }
        // 167.2-REVIEW-SFH M-1: a late link answer, either way, is logged AND
        // captured (a 15 s link update is a wedged request). It changes no
        // panel: "This sync did not start … reload to check which key is
        // linked" stays true whichever way the link landed, and no sync is
        // sent for it.
        try {
          await linked;
          console.warn(
            `[ApiKeyManager] the link update answered after its ${LINK_UPDATE_BOUND_MS} ms bound; the attempt had already ended, so no sync is sent [key_id=${keyId}]`,
          );
        } catch (lateErr) {
          console.warn("[ApiKeyManager] sync failed after its attempt ended:", lateErr);
        }
        captureToSentry(new Error("the link update answered after its bound"), {
          level: "warning",
          tags: { component: "ApiKeyManager", stage: "late-link-answer" },
        });
        return;
      }

      // The link landed for the live attempt: refresh the page's server data
      // now (moved here from `handleLinkKey` by WR-04, so a late link from an
      // attempt that already ended can never refresh the page).
      if (attemptRef.current === attempt) {
        router.refresh();
        // R2-01: the link landed, so the strategy's key IS `keyId` now. A Retry
        // of this attempt is a Resync of it (no write; the read-back verifies
        // it still holds), not a replay of the write over the old expectation.
        lastAttemptExpectedKeyIdRef.current = keyId;
      }

      // 167.2-REVIEW WR-04 — READ THE LINK BACK BEFORE THE ENQUEUE. The link
      // request is not aborted on its bound (by design: aborting cannot stop a
      // server-side write), so an OLDER attempt's stalled link can land after
      // this attempt's link and re-link the strategy to the older key; this
      // attempt's job would then sync a key that is not the panel's subject.
      // So the server's `strategies.api_key_id` is read back here: anything but
      // this attempt's key, or a read that cannot answer, refuses the attempt
      // as `unconfirmed` / `link_unverified`, and nothing is enqueued.
      // Residual: a stalled link landing between this read and the handler's
      // own read of the column is not closed; the pre-attempt gate narrows it
      // (no new attempt starts while the previous attempt's job is in flight).
      const linkedNow = await readLinkedKeyId();
      if (attemptRef.current !== attempt) return;
      if (linkedNow !== keyId) {
        if (linkedNow !== "unreadable") {
          console.error(
            `[ApiKeyManager] the strategy is not linked to this attempt's key when read back; no sync is sent [strategy_id=${strategyId}]`,
          );
        }
        captureToSentry(new Error("link read-back did not confirm this attempt's key"), {
          level: "warning",
          tags: {
            component: "ApiKeyManager",
            stage: linkedNow === "unreadable" ? "link-verify-unreadable" : "link-verify-mismatch",
          },
        });
        if (endAttempt(attempt)) {
          setSyncStatus("unconfirmed");
          setPanelStopReason("link_unverified");
          setSyncError(null);
        }
        return;
      }

      // KCS-02 (RESEARCH P3): the baseline is read AFTER the link update and
      // immediately before the enqueue, which keeps the window in which a
      // recurring job could move `computed_at` unnoticed as narrow as it can be.
      const baseline = await readEvidenceBaseline();
      if (attemptRef.current !== attempt) return;
      setEvidenceBaseline(baseline);

      // The enqueue exchange: the request, its failure message, its body and
      // the enqueue evidence, as one unit so ONE bound covers all of it.
      const enqueueExchange = async (): Promise<{ newJob: boolean }> => {
        const res = await fetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        });

        if (!res.ok) {
          throw await syncFailureMessage(res);
        }

        // 140.3-08 / SEAMUX-05 (B-15) — a 2xx is not evidence that a job was
        // enqueued, and this line used to assume it was. `/api/keys/sync`
        // answers an unrecognised upstream shape with a deliberately UN-stamped
        // passthrough, so the one response meaning "nothing was enqueued" was
        // the one that started a 15-minute poll for it, ending in a timeout
        // that blamed the computation.
        //
        // The fix is NOT entering the state. A wall-clock backstop would only
        // time the symptom out — the poll would still run, and the user would
        // still be told their analytics were computing when nothing was.
        const body: unknown = await res.json().catch(() => null);
        if (!isSyncEnqueued(body)) {
          throw new EnqueueAnswerError(SYNC_UNAVAILABLE_COPY, "unrecognized");
        }
        return { newJob: enqueuedNewJob(body) };
      };

      // Phase 167.2 / KCS-03 (RESEARCH Q2, P5): the exchange is raced against
      // `ENQUEUE_BOUND_MS`, the same shape as the `TERMINAL_REREAD_BOUND_MS`
      // race. Before it, an enqueue that never answered spun the panel and held
      // the marker until the route's own `maxDuration`. On expiry the card
      // cannot know whether a job was enqueued, so the attempt ends as the
      // UI-only `unconfirmed` state (KCS03-ENQUEUE), never as `error`: that
      // would render "Sync failed", a claim the card cannot make.
      // The request is NOT aborted: aborting cannot stop a server-side enqueue,
      // and it would turn a late 202 into a rejection. Instead the handler keeps
      // waiting for the late answer, so its outcome is logged (a late rejection
      // reaches the catch below, which logs it because the attempt already
      // ended), and the liveness guard after this block drops it, so a late 202
      // starts no poll and writes nothing.
      const enqueued = enqueueExchange();
      let enqueueTimer: ReturnType<typeof setTimeout> | undefined;
      let enqueueOutcome: { newJob: boolean } | "timed_out";
      try {
        const bound = new Promise<"timed_out">((resolve) => {
          enqueueTimer = setTimeout(() => resolve("timed_out"), ENQUEUE_BOUND_MS);
        });
        enqueueOutcome = await Promise.race([enqueued, bound]);
      } finally {
        clearTimeout(enqueueTimer);
      }
      if (enqueueOutcome === "timed_out") {
        console.error(
          `[ApiKeyManager] the enqueue did not answer within ${ENQUEUE_BOUND_MS} ms; the sync is unconfirmed [key_id=${keyId}]`,
        );
        // 167.2-REVIEW-SFH M-6: a wedged /api/keys/sync; tags only.
        captureToSentry(new Error("the enqueue did not answer within its bound"), {
          level: "warning",
          tags: { component: "ApiKeyManager", stage: "enqueue-bound" },
        });
        if (endAttempt(attempt)) {
          setSyncStatus("unconfirmed");
          setPanelStopReason("enqueue_bound");
          setSyncError(null);
          unconfirmedAttemptRef.current = attempt;
        }
        // 167.2-REVIEW-SFH M-1 — THE LATE ANSWER IS EVIDENCE. It used to be
        // dropped to a console.warn, so the panel kept promising "it may still
        // be running" about a sync the server had since refused, or kept
        // saying "not confirmed" about one it had accepted. A late answer
        // never resumes the ended attempt (no poll, no marker: KCS-03 / P5),
        // but while THIS attempt's `enqueue_bound` panel is still the one on
        // screen and no attempt is live, it updates that panel: a late 2xx
        // with enqueue evidence says the sync started (KCS-LATE-STARTED); a
        // late rejection shows the route's own failure. Either way it is
        // captured at warning level: a 180 s enqueue is a wedged route.
        //
        // 167.2-REVIEW-SFH-R2 R2-M1: only a ROUTE VERDICT (a JSON error body the
        // route itself produced) replaces the panel with "Sync failed". A late
        // answer lands between this bound and the route's `maxDuration`, where
        // the likeliest failures are the platform's non-JSON 504 and a rejected
        // fetch; the upstream enqueue may already have committed behind either,
        // so the honest `enqueue_bound` panel ("it may still be running") stays.
        // The capture's `kind` tag tells a verdict from a transport failure.
        const stillShown = () =>
          attemptRef.current === null && unconfirmedAttemptRef.current === attempt;
        let lateKind: "started" | "verdict" | "transport" | "unrecognized";
        try {
          await enqueued;
          lateKind = "started";
          console.warn(
            `[ApiKeyManager] the enqueue answered after its ${ENQUEUE_BOUND_MS} ms bound; the attempt had already ended, so no poll starts [key_id=${keyId}]`,
          );
          if (stillShown()) setPanelStopReason("enqueue_late_started");
        } catch (lateErr) {
          lateKind = lateErr instanceof EnqueueAnswerError ? lateErr.kind : "transport";
          console.warn("[ApiKeyManager] sync failed after its attempt ended:", lateErr);
          if (lateKind === "verdict" && stillShown()) {
            unconfirmedAttemptRef.current = null;
            setSyncStatus("error");
            setSyncError((lateErr as Error).message);
          }
        }
        captureToSentry(new Error("the enqueue answered after its bound"), {
          level: "warning",
          tags: { component: "ApiKeyManager", stage: "late-enqueue-answer", kind: lateKind },
        });
        return;
      }

      // A job IS enqueued -- analytics may still be computing.
      // SyncProgress will poll strategy_analytics to track completion. From
      // here on its reads may end this attempt (see `SyncAttempt`).
      // KCS-03 (RESEARCH P5): but only the live attempt may act on the answer.
      // A late answer (after its bound expired, or after the attempt otherwise
      // ended) starts no poll and moves no state.
      if (attemptRef.current !== attempt) return;
      attempt.enqueued = true;
      setAttemptEnqueuedNewJob(enqueueOutcome.newJob);
      setSyncStatus("computing");
      // NEW-C37-04: pass the key being synced so lastSyncAt reads from
      // the correct row.
      // 167.2-REVIEW-SFH L-4: in its own try. It used to share the enqueue's
      // try, so a throw here (a network-layer failure; supabase-js returns
      // errors rather than throwing) ended a live, ENQUEUED attempt as "Sync
      // failed" and stopped its poll. The job exists; only the list refresh
      // failed, so it is logged and the attempt keeps running.
      try {
        await loadKeys({ lastSyncedKeyId: keyId });
      } catch (refreshErr) {
        console.error(
          "[ApiKeyManager] the post-enqueue key-list re-read threw; the attempt keeps running:",
          refreshErr,
        );
      }
      router.refresh();
    } catch (err) {
      // Only a live attempt reports its own failure. If this one was already
      // ended (its terminal arrived, then the post-enqueue re-read threw), the
      // panel and the marker are no longer its to write.
      if (!endAttempt(attempt)) {
        console.warn("[ApiKeyManager] sync failed after its attempt ended:", err);
        return;
      }
      const message = err instanceof Error ? err.message : "Sync failed";
      setSyncStatus("error");
      setSyncError(message);
      setError(message);
      // Note: lastAttemptedKeyId is intentionally NOT cleared so the
      // retry button below has a target.
    }
  }

  const exchangeIcon: Record<string, string> = {
    binance: "B",
    okx: "O",
    bybit: "By",
    // UX-01 (#30): keep labels in lockstep with the canonical EXCHANGE_TAGS map
    // in AllocatorExchangeManager.tsx — DRB per DESIGN.md 3-letter, no-emoji tag
    // convention. (The two maps can still drift; a shared-constant consolidation
    // is out of scope per locked decision D5.)
    deribit: "DRB",
    // SFOX-09: ships UNCONDITIONALLY (a founder-connected sfox key exists before
    // the public offer flag flips) so the key card renders the mono tag, never
    // the "?" fallback. Mono, no emoji per DESIGN.md.
    sfox: "SFOX",
    // 138-03 (MT5UI-02): same SFOX-09 provenance precedent — a founder-connected
    // mt5 key exists before the go-live offer flag (NEXT_PUBLIC_MT5_ENABLED)
    // flips, so its key card must render the real mono tag, never the "?"
    // fallback. Provenance surface (the user's OWN key), not an offer surface.
    // "MT5" — 3 chars, no emoji per DESIGN.md.
    mt5: "MT5",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Exchange API Keys</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showChangeKey && (
            <Button
              size="sm"
              variant="secondary"
              className="whitespace-nowrap"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
              disabled={changeKeyBlocked}
            >
              Change key…
            </Button>
          )}
        </div>
      </div>

      {/* Phase 200 D-07 / D-01: every other account key, each with what it
          feeds. A pick opens plan 06's confirm and writes nothing; only that
          dialog's Change key button writes (D-03). */}
      {showChangeKey && pickerOpen && (
        <Card data-testid="change-key-picker">
          <p className="text-sm font-medium text-text-primary">Pick the key this strategy should use</p>
          <ul className="mt-3 space-y-3">
            {changeKeyCandidates.map((key) => (
              <li key={key.id}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="whitespace-normal text-left"
                  data-testid={`change-key-option-${key.id}`}
                  disabled={changeKeyBlocked}
                  onClick={() => {
                    setPickerOpen(false);
                    setPendingKeyId(key.id);
                  }}
                >
                  {keyLabels.get(key.id) ?? key.label}
                </Button>
                <KeyFeedsLine keyId={key.id} state={feedsState} onRetry={refreshFeeds} testIdPrefix="change-key-feeds" />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* KCS-23 (UI-SPEC S3): the one line that explains the missing link
          controls, directly under the header. 167.2-REVIEW-SFH H-2: an
          "unknown" shape gets its own line too (KCS-SHAPE-UNKNOWN). It used to
          get none, so a transient member-count failure removed every sync
          control with nothing to say why: failing closed on the write is
          right, failing closed SILENTLY was the defect. */}
      {keyShape === "composite" && (
        <p className="text-xs text-text-muted">
          <ContactPointerText text={COMPOSITE_CARD_NOTE} href={supportContactHref} />
        </p>
      )}
      {keyShape === "unknown" && (
        <p className="text-xs text-text-muted">
          <ContactPointerText text={SHAPE_UNKNOWN_CARD_NOTE} href={supportContactHref} />
        </p>
      )}

      {/* H-0395: distinct load-failure state. Shown instead of the
          "No API keys connected" empty state when the api_keys SELECT
          failed, so a load error is never disguised as "you have no keys".
          167-06 fix round (SFH LOW-2): shown whether or not the Add Key form
          is open. A re-read that follows a remedy (`Update password`'s
          `onUpdated`, a terminal success) can fail while the form is open, and
          hiding the banner then left a key reading "Sign-in failed" right after
          its fix with nothing saying the list was stale. */}
      {loadError && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-negative">
              Couldn&apos;t load your API keys. Your existing keys are safe — this is a
              connection problem, not a deletion.
            </p>
            <Button size="sm" variant="secondary" onClick={() => loadKeys()}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {/* D-03 (164.6.6.3.1): the one honest line while the FIRST read is in
          flight. Same box as the empty state so the swap moves no layout. No
          spinner or skeleton (DESIGN.md Motion), and muted, never red or amber:
          waiting is not a fault. */}
      {!firstReadSettled && (
        <Card>
          <p role="status" aria-live="polite" className="text-sm text-text-muted text-center py-4">
            Loading keys…
          </p>
        </Card>
      )}

      {firstReadSettled && listedKeys.length === 0 && !loadError && (
        <Card>
          <p className="text-sm text-text-muted text-center py-4">
            {/* H-2: a card that offers no link control never invites one
                (KCS-EMPTY-NOLINK). A composite or unknown shape might hold keys
                this card cannot name, so only a single-key shape says "none". */}
            {keyShape === "composite" || (!linkControlsAllowed && currentKeyId === null)
              ? EMPTY_NOLINK_COPY
              : currentKeyId === null
                ? NO_KEY_LINKED_COPY
                : KEY_NOT_LISTED_COPY}
          </p>
        </Card>
      )}

      {listedKeys.map((key) => (
        <Card key={key.id} data-testid={`api-key-card-${key.id}`}>
          {/* D-10 (164.6.6.3.1): the row wraps; the left block may shrink
              (min-w-0) from a 14rem basis, NOT flex-1: a zero basis never
              lets the action row wrap and splits the nickname one word per
              line at 360 to 560 px (measured, RESEARCH Item 8). The actions
              never shrink and wrap as a whole row, each button on one line. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
              <span
                data-testid={`api-key-avatar-${key.exchange}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar/10 text-xs font-bold text-text-primary"
              >
                {exchangeIcon[key.exchange] ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{key.label}</p>
                <p className="text-xs text-text-muted">
                  {/* D-10 (164.6.6.3.1): the one shared label ("MT5", "OKX"), the
                      allocator card's source; an id outside the map renders
                      verbatim. The title-case it replaces read "Mt5" / "Okx". */}
                  {dataSourceLabel(key).exchange}
                  {key.last_sync_at && ` · Key checked ${formatDay(key.last_sync_at)}`}
                </p>
                {key.exchange === "mt5" && (
                  <p className="text-xs text-text-muted font-metric mt-0.5">
                    MT5 account {key.venue_account_id ?? "—"}
                  </p>
                )}
                {/* Phase 167.1.2 plan 04 (D-01, D-11) and Phase 183 D-02: the
                    same counted-once sentence the allocator card shows, from
                    the same source and in the same muted tone. The holder is
                    looked up in every key this read returned, not only the
                    listed ones, so a composite's filtered list still names
                    it. */}
                {(() => {
                  const shareNote = accountShareNote(key, keysById);
                  return shareNote ? (
                    <p role="note" className="text-xs text-text-muted mt-0.5">
                      {shareNote}
                    </p>
                  ) : null;
                })()}
                {/* Phase 200 D-01 (ROUTE-09): the strategies this key feeds.
                    No role: it is not a live region and not a note. */}
                <KeyFeedsLine keyId={key.id} state={feedsState} onRetry={refreshFeeds} />
              </div>
            </div>
            <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
              {/* KCS-23: no Resync on a composite or an unknown shape, and no
                  Change key… either (header); both write `strategies.api_key_id`.
                  Phase 200 D-03: a non-current key has no per-card button, the
                  header's Change key… picker is the only way to re-point. */}
              {linkControlsAllowed && key.id === currentKeyId && (
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  variant="ghost"
                  onClick={() => handleSyncTrades(key.id, key.id)}
                  disabled={!!syncingKeyId}
                >
                  {syncingKeyId === key.id ? "Syncing\u2026" : "Resync"}
                </Button>
              )}
            </div>
          </div>
          {/*
            Phase 167 CREDTRUST / 167-06 (gap 1): the MANAGER-role surface for
            the persisted credential state. RESEARCH Open Question 2 is closed
            by this plan's scoping decision (recorded as 167-CONTEXT D-18): a
            manager owns the stalled factsheet, `profiles.role` defaults to
            `manager`, and the only other render of this state sits on the
            allocator-only `/profile` Exchanges tab. This card is on the
            strategy's own edit page. The remedies its helper names (update the
            credentials, re-add a key) live on the Profile API keys tab, which
            the panel links to under the cards (Phase 200 D-07).
            - REUSES the locked `AllocatorSyncStatus`: no copy and no colour is
              authored here (D-05, D-11 arm B, 167-UI-SPEC S1).
            - No factsheet path is touched (D-04).
            - Only the UNTRUSTED partition mounts. Every trusted-or-neutral
              status, `error` and `rate_limited` included, stays unrendered on
              this card: the gap is the credential state, and a full pill here
              would need the rate-limit cooldown inputs this component does not
              load.
            - It reads the server's stored status only and never infers a cause
              from staleness (D-02, D-03).
            The wrapper carries no role and no aria-*: the component's helper is
            the card's one live region (167-UI-SPEC § Accessibility).
            R1 (D-18): the MOUNT reads the server value only, so a healthy key
            never mounts a pill, not even in flight. While THIS key's sync is in
            flight the DISPLAYED status is overridden to `syncing`: the neutral
            Syncing… pill with a silent helper, 167-UI-SPEC S1's
            retry-in-flight cell, so no credential claim sits under a spinner.
            The block stays mounted across the transition, so its one live
            region is stable and the state that returns after THIS key's own
            attempt is announced politely.
            ⚠️ The FIRST appearance is different (167-REVIEW-06 IN-01). When a
            key BECOMES untrusted during the page's lifetime (a terminal
            success's re-read, the mid-flight re-read, the load-error Retry),
            the block mounts with its sentence already inside the live region,
            and screen readers generally do not announce text that is present
            when a region is inserted. The state is still visible and still in
            the reading order; only the announcement may not fire. Announcing
            it would need an empty region mounted on every card, which the
            "a healthy card renders nothing new" rule forbids, so it needs a
            UI-SPEC decision, not a code change here. No second live region.
          */}
          {isUntrustedKeySyncStatus(key.sync_status) && (
            <div className="mt-2">
              <AllocatorSyncStatus
                subject="strategy-key"
                syncStatus={syncingKeyId === key.id ? "syncing" : key.sync_status}
                syncError={key.sync_error}
                lastSyncAt={key.last_sync_at}
                exchange={key.exchange}
              />
            </div>
          )}
        </Card>
      ))}

      {/* Phase 200 D-07 / D-06: adding, deleting and updating keys live in one
          place, the Profile API keys tab. Always shown, for every shape, since
          it is the remedy the "Sign-in failed" pill on /strategies sends a
          manager here for. */}
      <p className="text-xs text-text-muted">
        Keys are added, deleted and updated on your Profile.{" "}
        <Link href={PROFILE_KEYS_HREF} className="text-accent underline underline-offset-4">
          Add or remove keys
        </Link>
      </p>

      {/* Sync progress indicator. R2 (167-06, D-18): withheld ONLY on a
          terminal success whose subject key is untrusted on the server; see
          `withholdPanelSuccess`. Never withheld in flight, never on error. */}
      {syncStatus !== "idle" && !withholdPanelSuccess && (
        <SyncProgress
          key={attemptSeq}
          strategyId={strategyId}
          evidenceBaseline={evidenceBaseline}
          attemptEnqueuedNewJob={attemptEnqueuedNewJob}
          syncStatus={syncStatus}
          stopReason={panelStopReason}
          lastSyncAt={lastSyncAt}
          syncError={syncError}
          onRetry={() =>
            lastAttemptedKeyId &&
            handleSyncTrades(lastAttemptedKeyId, lastAttemptExpectedKeyIdRef.current)
          }
          onStatusChange={handleSyncStatusChange}
        />
      )}

      {/* 167.2-REVIEW-SFH L-1 (UI-SPEC KCS-FINISH-UNVERIFIED): a terminal
          success withheld for an unverified list leaves this muted note,
          which a later list read does not clear. */}
      {finishUnverified && syncStatus === "idle" && (
        <p data-testid="sync-finish-unverified" className="text-xs text-text-muted">
          {FINISH_UNVERIFIED_NOTE}
        </p>
      )}

      {/* Phase 200 D-03 / D-04: mounted only while a re-point is pending, so
          its sentence is never in the page otherwise. A key the list no longer
          holds cannot be named, so it opens nothing and writes nothing. */}
      {pendingKeyLabel !== undefined && pendingKeyId !== null && (
        <ConfirmKeyChangeDialog
          open
          strategyName={strategyName}
          currentLabel={
            currentKeyId === null ? null : (keyLabels.get(currentKeyId) ?? "its current key")
          }
          nextLabel={pendingKeyLabel}
          onConfirm={() => {
            const id = pendingKeyId;
            setPendingKeyId(null);
            // The dialog named `currentKeyId` as of this render; the write is
            // conditioned on exactly that key (R2-01).
            void handleSyncTrades(id, currentKeyId);
          }}
          onCancel={() => setPendingKeyId(null)}
        />
      )}

      {/* Hidden only when it would repeat the error panel's own message (a
          failed sync writes the same text to both). 167-06 fix round: it used
          to be hidden whenever the panel showed ANY error, so a failed Delete
          on a key whose last sync had failed, the `revoked` helper's remedy
          path, was reported nowhere. */}
      {error && !(syncStatus === "error" && error === syncError) && (
        <p className="text-sm text-negative">{error}</p>
      )}
    </div>
  );
}
