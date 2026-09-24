"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ApiKeyForm } from "./ApiKeyForm";
import {
  addKeyBlockedReason,
  ENQUEUE_BOUND_MS,
  type PanelStopReason,
} from "./key-card-copy";
import {
  SyncProgress,
  type EvidenceBaseline,
  type SyncStatus,
  type SyncStatusInfo,
} from "./SyncProgress";
import { UpdateMt5SecretDialog } from "./UpdateMt5SecretDialog";
import { AllocatorSyncStatus } from "@/components/exchanges/AllocatorSyncStatus";
import type { ApiKey } from "@/lib/types";
import { API_KEY_USER_COLUMNS } from "@/lib/constants";
import { isComputedAnalytics, isUntrustedKeySyncStatus } from "@/lib/closed-sets";

interface ApiKeyManagerProps {
  strategyId: string;
  currentKeyId: string | null;
  defaultExchange?: string;
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
async function syncFailureMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body: unknown = await res.json().catch(() => null);
    if (body !== null && typeof body === "object") {
      const fields = body as Record<string, unknown>;
      if (typeof fields.error === "string" && fields.error) return fields.error;
      if (typeof fields.human_message === "string" && fields.human_message) {
        return fields.human_message;
      }
    }
  }
  return SYNC_UNAVAILABLE_COPY;
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


// 167-06 security delta (UF-1): authored copy for a delete whose outcome we
// could not confirm. A raw PostgREST message never reaches the page.
const DELETE_FAILED_COPY =
  "Failed to delete key. Try again, and contact support if it keeps failing.";

export function ApiKeyManager({ strategyId, currentKeyId, defaultExchange }: ApiKeyManagerProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Phase 164.5.3 / MT5CREDS Plan 05 — the id of the MT5 key whose password
  // is being corrected. Distinct from Reconnect: this key's credential is
  // WRONG and needs re-validation, not merely "try the stored one again".
  const [updatingKeyId, setUpdatingKeyId] = useState<string | null>(null);
  // The live tracked attempt, or null. See `SyncAttempt`. A ref, not state: it
  // is read inside async continuations that must see the CURRENT attempt, not
  // the one their render closed over, and it never drives a render itself
  // (`syncingKeyId` does).
  const attemptRef = useRef<SyncAttempt | null>(null);
  // Phase 167.2 / KCS-02: the tracked attempt's pre-enqueue `computed_at`
  // (see `readEvidenceBaseline`), and a per-attempt sequence that keys the
  // panel. The panel stays mounted from `error` into a Retry, so without the
  // key its "has read computing" evidence would carry into the next attempt.
  const [evidenceBaseline, setEvidenceBaseline] = useState<EvidenceBaseline>("unknown");
  const [attemptSeq, setAttemptSeq] = useState(0);
  // Phase 167.2 / KCS-22: which give-up ended the attempt as `no_result` (the
  // reason the panel forwarded), so the panel says how long it waited. Reset
  // at every attempt's registration.
  const [panelStopReason, setPanelStopReason] = useState<PanelStopReason | null>(null);
  // Phase 167.2 / KCS-01 (RESEARCH P7, the reverse overlap): true while an
  // Add Key is in flight, from before its validate request until it hands off
  // to its own tracked attempt. A ref, not `loading`: `loading` is async
  // state, so a handler running before the re-render would read it stale
  // (the NEW-C37-02 lesson). While it is set, `handleSyncTrades` registers
  // nothing, so no attempt can start that the add would then collide with.
  const addInFlightRef = useRef(false);
  // 167-06 fix round 2 (167-REVIEW-06-R2 WR-04): the key-list reads are
  // ORDERED. Each `loadKeys` call takes the next number; a response older than
  // the newest one already applied is dropped. Without it, an attempt's own
  // post-enqueue read could resolve AFTER the terminal arm's re-read and
  // install the snapshot from before the job ran, lifting R2's withhold beside
  // a key whose sign-in had failed on the server.
  const keysReadSeqRef = useRef(0);
  const appliedKeysReadRef = useRef<{ seq: number; ok: boolean }>({ seq: 0, ok: true });
  const router = useRouter();

  // Resolves true when the list was re-read cleanly, false when the read
  // failed (and `loadError` is set). The terminal-success arm needs the answer:
  // it shows a success only after a re-read that could have withheld it. A read
  // dropped as out of date (WR-04) answers with the outcome of the newer read
  // that was applied instead, since that is what the list now shows.
  const loadKeys = useCallback(async (opts?: { lastSyncedKeyId?: string }): Promise<boolean> => {
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
    if (seq < appliedKeysReadRef.current.seq) return appliedKeysReadRef.current.ok;
    appliedKeysReadRef.current = { seq, ok: !keysErr };
    if (keysErr) {
      console.error("[ApiKeyManager] api_keys fetch failed:", keysErr.message);
      // H-0395: a non-empty error (network/RLS/session) is NOT "no keys".
      // Surface a distinct, retryable error state and keep whatever keys we
      // had — never let the failure collapse into the empty "no keys" UI.
      setLoadError(keysErr.message);
      return false;
    }
    // Reached only on a clean response: clear any prior load error so a
    // successful retry restores the normal list / genuine-empty state.
    setLoadError(null);
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
    return true;
  }, [currentKeyId]);

  useEffect(() => {
    loadKeys();
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
      let reread = false;
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
      } finally {
        clearTimeout(boundTimer);
        endAttempt(attempt);
        setSyncStatus(reread ? status : "idle");
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
   */
  const panelSubjectUntrusted = isUntrustedKeySyncStatus(
    keys.find((k) => k.id === lastAttemptedKeyId)?.sync_status,
  );
  const withholdPanelSuccess =
    isComputedAnalytics(syncStatus) && panelSubjectUntrusted;

  /**
   * Phase 167 / 167-06, R3 and R5 (167-CONTEXT D-18): retire a panel success
   * that R2 is withholding, so it is never re-shown.
   *
   * WHY. R2's withhold reads the subject key's CURRENT status, so it lapses the
   * moment that status stops being untrusted, and the panel would re-mount with
   * the terminal success of an attempt that the fix never touched:
   *   - R3, `Update password`: `rotate-secret`'s validated write sets the key's
   *     status to `idle`, and the run shown was made under the REPLACED password;
   *   - R5, `Delete`: the subject row leaves `keys`, and a missing row reads as
   *     "not untrusted";
   *   - R5, `Add Key`: the subject moves to the new key, which R2 then judges.
   *
   * WHY THE UPDATER IS FUNCTIONAL. It reads the state committed when it runs,
   * not this closure's copy: the dialog calls `onUpdated` only after awaiting
   * `rotate-secret`, and the panel's poll can move `syncStatus` during that
   * await. It maps a terminal success to `idle` and returns every other value
   * unchanged. ⛔ `syncing` and `computing` stay as they are, so an in-flight
   * panel keeps polling and still clears `syncingKeyId` (T-167-06-04). `error`
   * stays too: it makes no success claim, and it is the attempt's own message.
   * On `Update password` its Retry is also useful, with the new password. On
   * `Delete` it is not: the panel's Retry still targets `lastAttemptedKeyId`,
   * now a deleted id, and surfaces a raw link failure. That is pre-existing,
   * unchanged by 167-06, and recorded as 167-REVIEW-06 IN-02; retiring an
   * `error` on Delete would be a behaviour change, so it is not made here.
   *
   * WHY IT IS GUARDED BY THE WITHHOLD. Unguarded, rotating any MT5 password,
   * deleting any key or adding one would retire a TRUTHFUL success about a
   * healthy key. The guard is `panelSubjectUntrusted` from the render the user
   * clicked in. For `Delete` that render still holds the row; re-deriving it
   * from the list with the row filtered out would answer false and re-show the
   * success.
   *
   * The one window this cannot reach, a rotation that lands while the rotated
   * key's OWN sync is in flight, is closed by R4: that key's `Update password`
   * (and, by R5, its `Delete`) is disabled for exactly that window.
   *
   * ⛔ This is the only EVENT-HANDLER path that maps a terminal success to
   * `idle`; the terminal arm of `handleSyncStatusChange` also lands on `idle`
   * when its bounded re-read fails or times out. It runs from event handlers
   * only; it is not an effect.
   */
  function retireWithheldSuccess() {
    if (!panelSubjectUntrusted) return;
    setSyncStatus((prev) => (isComputedAnalytics(prev) ? "idle" : prev));
  }

  async function handleAddKey(data: {
    exchange: string;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  }) {
    // NEW-C37-02: guard at the top of handleAddKey so two rapid Enter
    // presses (which fire before setLoading(true) re-renders) cannot race
    // to POST /api/keys/validate-and-encrypt and create duplicate api_keys
    // rows. The Connect button is already disabled via `loading`, but Enter
    // inside an <Input> submits the form regardless and setLoading is async.
    // Phase 167.2 / KCS-01: nor while a tracked attempt is live. The post-add
    // sync runs AS the tracked attempt, and the card holds one attempt at a
    // time, so an add during a live attempt could only collide with it. This
    // is defence in depth behind the disabled Connect Key. `addInFlightRef` is
    // checked too because, unlike `loading`, it is never read stale.
    if (loading || addInFlightRef.current || attemptRef.current !== null) return;
    addInFlightRef.current = true;
    setLoading(true);
    setError(null);

    // F6 (phase-119 fold-in): canonicalize the exchange to lowercase before it
    // leaves this component. The DB CHECK admits lowercase venue codes only, so
    // a mixed-case value ("sFOX") used to pass validation (burning a live probe)
    // and then 23514 on the INSERT. Credential fields are untouched (their
    // .trim() chokepoint lives server-side per the v1.11 dogfood fix).
    //
    // 160-02 / RANK-03: the INSERT this canonicalization used to also feed is
    // GONE — the route writes the row now, and it re-normalizes independently
    // at its own chokepoint (route.ts, `exchangeNormalized`). This stays because
    // it is what the request body carries, and a component that sends a
    // canonical venue is one less place a stray casing can originate.
    const exchange = data.exchange.trim().toLowerCase();

    try {
      // Validate + encrypt atomically (prevents TOCTOU race on key permissions)
      const res = await fetch("/api/keys/validate-and-encrypt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          api_key: data.apiKey,
          api_secret: data.apiSecret,
          passphrase: data.passphrase || null,
          // 160-02 / RANK-03 — the persist discriminator. With it, the route
          // writes the api_keys row ITSELF, stamping `exchange` AND
          // `attested_venue` from the venue its own validateKey call
          // authenticated against, and returns `{ api_key_id }` with NO
          // ciphertext. It is REQUIRED: a body without `persist: true` is
          // refused with 409 `STALE_CLIENT`, so no arm of this route returns key
          // material to a browser. The label goes in the body now because the
          // server composes the row.
          persist: true,
          label: data.label,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Validation failed" }));
        throw new Error(err.error || "Key validation failed");
      }

      // Step 3: consume the id of the row the SERVER wrote. This component no
      // longer inserts into api_keys — a browser-composed INSERT could claim
      // any venue, and the venue is what decides the annualization factor
      // (√365 crypto vs √252 traditional) downstream. Plan 160-05 revokes the
      // client's INSERT grant outright once this has soaked on PROD.
      const { api_key_id: newKeyId } = await res.json();

      if (typeof newKeyId !== "string") {
        // Rule 12 / fail loud. A 2xx carrying no id means the server did not
        // persist. Continuing would report the key as added while it is
        // unlinked and will never sync — precisely the false-success that
        // NEW-C37-03 and B-06 below exist to prevent.
        throw new Error("Your key was verified but not saved. Please try again.");
      }

      // Phase 167 / 167-06, R5 (167-CONTEXT D-18), kept by 167.2 KCS-05: the
      // panel's subject is about to move to the new key (the tracked attempt
      // below sets `lastAttemptedKeyId`), and R2 would then judge the new,
      // healthy key instead. A success R2 was withholding beside the old key's
      // failed sign-in would re-appear, so it is retired here. A failed
      // validation throws before this point and leaves the subject where it was.
      // ⚠️ This guard reads the subject's trust status AS OF THE SUBMIT CLICK:
      // the closure is that render's. A re-read landing during the validate
      // await above can make it stale. Only a success line is affected, because
      // the updater is functional and returns every in-flight value unchanged.
      // That is a residual, named beside the cross-tab one in D-18 (a change
      // made in another tab reaches this tab only through a re-read), and
      // neither is fixed here.
      retireWithheldSuccess();

      setShowForm(false);

      // Phase 167.2 / KCS-01: the sync after an add RUNS AS the card's one
      // tracked attempt. `handleSyncTrades` registers the attempt before its
      // first await, links the new key (NEW-C37-03: a failed link throws before
      // any sync request is sent), sends the enqueue, applies
      // `isSyncEnqueued`, enters `computing` and ends itself through
      // `endAttempt`. So the post-add sync takes the in-flight marker, is
      // polled, has the new key as its subject and Retry target, and reports
      // its own failure on the panel with the route's own message.
      //
      // Still NOT awaited: "don't block the UI" is a real requirement and the
      // add flow continues below regardless.
      //
      // LINEAGE of the untracked chain this call replaces, kept so the reasons
      // are not lost with the code:
      //  - 140.3-08 / SEAMUX-05 (B-06): it was `fetch(…).catch(…)`, which saw
      //    only transport rejections, so a 401/403/500 or a breaker 503 was
      //    invisible. It then observed the HTTP outcome and the enqueue
      //    evidence, one shape at both call sites.
      //  - FINDING-10: its catch kept an operator log. The tracked attempt's
      //    failure now reaches the panel itself.
      //  - 167-06 R6, as corrected in the 167-06 fix round (167-REVIEW-06
      //    CR-01): it was never registered in the one sync slot, so it could
      //    fail while ANOTHER key's attempt was live, and its failure then
      //    reached the console only. That was the named residual (1) of D-18.
      //  - 167-06 fix round 2 (167-REVIEW-06-R2 WR-01): the subject moved with
      //    the failure so the panel's Retry targeted the new key.
      // KCS-01 closes that residual: this sync IS the tracked attempt, and the
      // overlap that made it untracked cannot start (Add Key is blocked while
      // an attempt is live; no second attempt starts during an add).
      // The add hands off to its own attempt here, so the reverse-overlap
      // guard is lifted immediately before the call it would otherwise block.
      addInFlightRef.current = false;
      void handleSyncTrades(newKeyId);
      await loadKeys();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      addInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleLinkKey(keyId: string) {
    const supabase = createClient();
    // C1/FINDING-4: destructure and throw on error so handleSyncTrades
    // cannot proceed to /api/keys/sync against the wrong api_key_id when
    // the link update is denied (RLS violation, stale session, wrong
    // strategyId). Pre-fix: the {error} return was silently discarded —
    // the same pre-fix scenario that NEW-C37-03 fixed for handleAddKey.
    const { error: linkError } = await supabase
      .from("strategies")
      .update({ api_key_id: keyId })
      .eq("id", strategyId);
    if (linkError) {
      throw new Error(`Failed to link key to strategy: ${linkError.message}`);
    }
    router.refresh();
  }

  async function handleDeleteKey(keyId: string) {
    const supabase = createClient();
    // 167-06 fix round: `.select("id")` returns the rows the DELETE removed.
    // Without it, a delete that RLS filtered down to zero rows answers with no
    // error, the row was dropped locally, R5 retired a withheld success, and
    // the key came back on the next load. This is the remedy the `revoked`
    // helper points at, so a delete that removed nothing must say so.
    const { data: deletedRows, error: deleteError } = await supabase
      .from("api_keys")
      .delete()
      .eq("id", keyId)
      .select("id");
    setConfirmDelete(null);
    if (deleteError) {
      // 167-06 security delta (UF-1): the raw PostgREST message goes to the
      // console only; the page gets authored copy.
      console.error("[ApiKeyManager] api_keys delete failed:", deleteError.message);
      setError(DELETE_FAILED_COPY);
      return;
    }
    if (deletedRows?.length !== 1) {
      // 167-06 fix round 2 (167-REVIEW-06-R2 WR-05): zero removed rows means
      // either the delete was refused (RLS) or the row was ALREADY gone (deleted
      // in another tab). Reporting both as a refusal left a card for a key that
      // no longer exists, and every later Delete said so again until a reload.
      // So ask: a row that is still there is a refusal; a row that is gone is
      // the outcome the user asked for, and takes the success path below.
      const removed = deletedRows?.length ?? 0;
      const { data: remaining, error: lookupError } = await supabase
        .from("api_keys")
        .select("id")
        .eq("id", keyId);
      if (lookupError) {
        console.error(
          `[ApiKeyManager] api_keys delete removed ${removed} rows, expected 1, and the follow-up lookup failed:`,
          lookupError.message,
        );
        setError(DELETE_FAILED_COPY);
        return;
      }
      if (!remaining || remaining.length > 0) {
        console.error(
          `[ApiKeyManager] api_keys delete removed ${removed} rows, expected 1; the key is still present`,
        );
        setError(
          "Failed to delete key: the key is still connected. Try again, and contact support if it keeps failing.",
        );
        return;
      }
    }
    // Phase 167 / 167-06, R5 (167-CONTEXT D-18): once the row leaves `keys`,
    // R2 reads the missing subject row as "not untrusted", so a success it was
    // withholding beside that key's failed sign-in would re-appear. Retire it
    // here, AFTER the error return (a failed delete leaves the row, so the
    // withhold still holds) and BEFORE the row is filtered out. The guard is
    // the pre-delete derivation from the render the user clicked in, which
    // still holds the row. The user cannot move the list during the delete
    // await (the confirm is modal), but an async re-read from another key's
    // attempt, or the zero-row lookup below, can; the worst case is retiring
    // a truthful success line, never showing a false one. ⛔ Do not re-derive it
    // from the filtered list: that answers false and re-shows the success.
    retireWithheldSuccess();
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
    router.refresh();
  }

  /**
   * Phase 167.2 / KCS-02: read the strategy's `computed_at` immediately before
   * the enqueue, so the panel can tell this attempt's terminal from the previous
   * run's (see `EvidenceBaseline`). An absent row answers `{ computedAt: null }`,
   * a real value. An error, a throw, or `BASELINE_READ_BOUND_MS` expiring answers
   * `"unknown"` and logs; it never fails the attempt.
   */
  async function readEvidenceBaseline(): Promise<EvidenceBaseline> {
    let boundTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const bound = new Promise<"timed_out">((resolve) => {
        boundTimer = setTimeout(() => resolve("timed_out"), BASELINE_READ_BOUND_MS);
      });
      const supabase = createClient();
      const outcome = await Promise.race([
        supabase
          .from("strategy_analytics")
          .select("computed_at")
          .eq("strategy_id", strategyId)
          .maybeSingle(),
        bound,
      ]);
      if (outcome === "timed_out") {
        console.error(
          `[ApiKeyManager] the evidence baseline read did not answer within ${BASELINE_READ_BOUND_MS} ms; continuing with an unknown baseline [strategy_id=${strategyId}]`,
        );
        return "unknown";
      }
      if (outcome.error) {
        console.error(
          `[ApiKeyManager] the evidence baseline read failed; continuing with an unknown baseline [strategy_id=${strategyId}]:`,
          outcome.error.message,
        );
        return "unknown";
      }
      return { computedAt: outcome.data?.computed_at ?? null };
    } catch (err) {
      console.error(
        `[ApiKeyManager] the evidence baseline read threw; continuing with an unknown baseline [strategy_id=${strategyId}]:`,
        err,
      );
      return "unknown";
    } finally {
      clearTimeout(boundTimer);
    }
  }

  async function handleSyncTrades(keyId: string) {
    // Phase 167.2 / KCS-01: the card never starts a second sync while one is
    // live, nor while an Add Key is in flight (RESEARCH P7: the add would then
    // collide with it). Every Resync / Use & Sync is disabled in both windows;
    // this is the handler guard behind those disables, and the one that covers
    // the panel's Retry and the post-add call, which no card button gates.
    if (addInFlightRef.current || attemptRef.current !== null) return;
    // The attempt is registered BEFORE any await, so `handleSyncStatusChange`
    // and anything else that checks `attemptRef` see it as live from the first
    // click.
    const attempt: SyncAttempt = { keyId, enqueued: false, settling: false };
    attemptRef.current = attempt;
    // KCS-02: a fresh panel and no baseline until this attempt has read one.
    setAttemptSeq((seq) => seq + 1);
    setEvidenceBaseline("unknown");
    setPanelStopReason(null);
    setSyncingKeyId(keyId);
    setLastAttemptedKeyId(keyId);
    setSyncStatus("syncing");
    setSyncError(null);
    setError(null);

    try {
      // Link key to strategy first
      await handleLinkKey(keyId);

      // KCS-02 (RESEARCH P3): the baseline is read AFTER the link update and
      // immediately before the enqueue, which keeps the window in which a
      // recurring job could move `computed_at` unnoticed as narrow as it can be.
      const baseline = await readEvidenceBaseline();
      if (attemptRef.current !== attempt) return;
      setEvidenceBaseline(baseline);

      // The enqueue exchange: the request, its failure message, its body and
      // the enqueue evidence, as one unit so ONE bound covers all of it.
      const enqueueExchange = async (): Promise<"enqueued"> => {
        const res = await fetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        });

        if (!res.ok) {
          throw new Error(await syncFailureMessage(res));
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
          throw new Error(SYNC_UNAVAILABLE_COPY);
        }
        return "enqueued";
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
      let enqueueOutcome: "enqueued" | "timed_out";
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
        if (endAttempt(attempt)) {
          setSyncStatus("unconfirmed");
          setPanelStopReason("enqueue_bound");
          setSyncError(null);
        }
        await enqueued;
        console.warn(
          `[ApiKeyManager] the enqueue answered after its ${ENQUEUE_BOUND_MS} ms bound; the attempt had already ended, so nothing is written [key_id=${keyId}]`,
        );
      }

      // A job IS enqueued -- analytics may still be computing.
      // SyncProgress will poll strategy_analytics to track completion. From
      // here on its reads may end this attempt (see `SyncAttempt`).
      // KCS-03 (RESEARCH P5): but only the live attempt may act on the answer.
      // A late answer (after its bound expired, or after the attempt otherwise
      // ended) starts no poll and moves no state.
      if (attemptRef.current !== attempt) return;
      attempt.enqueued = true;
      setSyncStatus("computing");
      // NEW-C37-04: pass the key being synced so lastSyncAt reads from
      // the correct row.
      await loadKeys({ lastSyncedKeyId: keyId });
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
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Add Key
          </Button>
        )}
      </div>

      {showForm && (
        <ApiKeyForm
          onSubmit={handleAddKey}
          onCancel={() => { setShowForm(false); setError(null); }}
          loading={loading}
          error={error}
          defaultExchange={defaultExchange}
          // Phase 167.2 / KCS-01: Connect Key is blocked for the whole of a
          // live attempt, and says which key's sync it is waiting for.
          submitBlockedReason={
            syncingKeyId
              ? addKeyBlockedReason(keys.find((k) => k.id === syncingKeyId)?.label)
              : null
          }
        />
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

      {keys.length === 0 && !loadError && !showForm && (
        <Card>
          <p className="text-sm text-text-muted text-center py-4">
            No API keys connected. Add a read-only exchange key to import your trading data.
          </p>
        </Card>
      )}

      {keys.map((key) => (
        <Card key={key.id} data-testid={`api-key-card-${key.id}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                data-testid={`api-key-avatar-${key.exchange}`}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar/10 text-xs font-bold text-text-primary"
              >
                {exchangeIcon[key.exchange] ?? "?"}
              </span>
              <div>
                <p className="text-sm font-medium text-text-primary">{key.label}</p>
                <p className="text-xs text-text-muted">
                  {key.exchange.charAt(0).toUpperCase() + key.exchange.slice(1)}
                  {key.last_sync_at && ` · Last synced ${new Date(key.last_sync_at).toLocaleDateString()}`}
                </p>
                {key.exchange === "mt5" && (
                  <p className="text-xs text-text-muted font-metric mt-0.5">
                    MT5 account {key.venue_account_id ?? "—"}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {key.id === currentKeyId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSyncTrades(key.id)}
                  // KCS-01 / RESEARCH P7: also while an Add Key is in flight.
                  disabled={!!syncingKeyId || loading}
                >
                  {syncingKeyId === key.id ? "Syncing\u2026" : "Resync"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleSyncTrades(key.id)}
                  // KCS-01 / RESEARCH P7: also while an Add Key is in flight.
                  disabled={!!syncingKeyId || loading}
                >
                  {syncingKeyId === key.id ? "Syncing\u2026" : "Use & Sync"}
                </Button>
              )}
              {key.exchange === "mt5" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setUpdatingKeyId(key.id)}
                  // Phase 167 / 167-06, R4 (167-CONTEXT D-18): a key's password
                  // is never replaced while THAT key's own sync is in flight.
                  // Otherwise the rotation's validated write sets the status to
                  // idle, R2 no longer withholds, and the attempt's later
                  // success, made under the REPLACED password, is shown. The
                  // reverse order is already impossible: `Modal` opens this
                  // dialog with `showModal()`, which makes the rest of the
                  // document inert, so no sync can start while it is open, and
                  // `rotate-secret` is awaited before the dialog closes.
                  // KEY-SCOPED, not `!!syncingKeyId`: a rotation occupies none
                  // of the one sync slot and changes only the rotated key's
                  // status, so another key's withhold is untouched, and a
                  // global disable would block the remedy the pill asks for for
                  // the whole of an unrelated sync. No status conjunct: a
                  // status can flip mid-attempt on a re-read, the in-flight
                  // marker cannot (only its own attempt clears it; until the
                  // 167-06 fix round a stale pre-enqueue poll read or a failed
                  // post-add sync could, see `SyncAttempt`). Lineage: plan revision 1 said closing this
                  // window needed a record tying the withhold to the attempt's
                  // credential. That was wrong: the window exists only if the
                  // attempt and the rotation overlap, and existing state
                  // prevents the overlap, so nothing has to be recorded.
                  disabled={syncingKeyId === key.id}
                >
                  Update password
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(key.id)}
                // Phase 167 / 167-06, R5 (167-CONTEXT D-18): a key is never
                // deleted during its own sync. Deleting it mid-attempt removes
                // the panel's subject while the retirement must leave
                // `computing` alone, so the attempt's later success would land
                // with no row left to withhold it. The reverse order is closed
                // as R4's is: the confirm renders through `Modal`, opens with
                // `showModal()`, and `handleDeleteKey` awaits the delete before
                // it closes the confirm. Key-scoped for R4's reason: deleting
                // key K changes only K's row.
                disabled={syncingKeyId === key.id}
              >
                Delete
              </Button>
            </div>
          </div>
          {/*
            Phase 167 CREDTRUST / 167-06 (gap 1): the MANAGER-role surface for
            the persisted credential state. RESEARCH Open Question 2 is closed
            by this plan's scoping decision (recorded as 167-CONTEXT D-18): a
            manager owns the stalled factsheet, `profiles.role` defaults to
            `manager`, and the only other render of this state sits on the
            allocator-only `/profile` Exchanges tab. This card is on the
            strategy's own edit page, beside the controls the helper names
            (`Update password`, and `Delete` / `Add Key` for a re-add).
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
                syncStatus={syncingKeyId === key.id ? "syncing" : key.sync_status}
                syncError={key.sync_error}
                lastSyncAt={key.last_sync_at}
                exchange={key.exchange}
              />
            </div>
          )}
        </Card>
      ))}

      {/* Sync progress indicator. R2 (167-06, D-18): withheld ONLY on a
          terminal success whose subject key is untrusted on the server; see
          `withholdPanelSuccess`. Never withheld in flight, never on error. */}
      {syncStatus !== "idle" && !withholdPanelSuccess && (
        <SyncProgress
          key={attemptSeq}
          strategyId={strategyId}
          evidenceBaseline={evidenceBaseline}
          syncStatus={syncStatus}
          stopReason={panelStopReason}
          lastSyncAt={lastSyncAt}
          syncError={syncError}
          onRetry={() => lastAttemptedKeyId && handleSyncTrades(lastAttemptedKeyId)}
          onStatusChange={handleSyncStatusChange}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete API Key"
      >
        <p className="text-sm text-text-secondary mb-4">
          This will permanently remove this API key. Trade data already imported will not be affected.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => confirmDelete && handleDeleteKey(confirmDelete)}>Delete</Button>
        </div>
      </Modal>

      <UpdateMt5SecretDialog
        open={!!updatingKeyId}
        apiKeyId={updatingKeyId ?? ""}
        onClose={() => setUpdatingKeyId(null)}
        // Phase 167 / 167-06, R3 (D-18): retire a success R2 is withholding
        // FIRST, then re-read. The re-read returns the rotated key as idle,
        // which lifts the withhold; without the retirement the panel would
        // re-show a success from the attempt made under the replaced password.
        onUpdated={() => {
          retireWithheldSuccess();
          loadKeys();
        }}
      />

      {/* Hidden only when it would repeat the error panel's own message (a
          failed sync writes the same text to both). 167-06 fix round: it used
          to be hidden whenever the panel showed ANY error, so a failed Delete
          on a key whose last sync had failed, the `revoked` helper's remedy
          path, was reported nowhere. */}
      {error && !showForm && !(syncStatus === "error" && error === syncError) && (
        <p className="text-sm text-negative">{error}</p>
      )}
    </div>
  );
}
