"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { isComputedAnalytics } from "@/lib/closed-sets";
import type { StrategyAnalytics } from "@/lib/types";

/**
 * The DB `strategy_analytics.computation_status` union — the same source-of-truth
 * shape `SyncProgress` re-exports as `ComputationStatus`. Kept local (sourced from
 * `@/lib/types`, not imported from a component) so the hook stays dependency-light
 * and never pulls surface code (`toSyncStatus`, `SyncStatus`, phases, routes).
 */
export type ComputationStatus = StrategyAnalytics["computation_status"];

/**
 * UX-03 / #46 — the ONE parametrized `strategy_analytics` status-poll loop shared
 * by `SyncProgress` and the wizard `SyncPreviewStep`. It removes the duplicated
 * scheduling / read / escalation machinery WITHOUT changing either surface's
 * behavior; the proof is the green-diff method (95-01 characterization + the three
 * frozen wizard tests + the 95-04 sibling all pass byte-untouched), not new asserts.
 *
 * The two surfaces poll DIFFERENTLY (95-RESEARCH), so the loop is parametrized, not
 * lifted-and-shifted:
 *
 * - `schedule: number` → `setInterval` semantics (SyncProgress: 3000). Owns an
 *   attempt counter with an optional outer cap (`maxAttempts`, escalates on
 *   attempt N+1 BEFORE the query) and an optional missing-row grace window
 *   (`missingRowGracePolls`). Reads via `.single()`; a PGRST116 (0 rows) is the
 *   expected "row not yet created" case and a non-PGRST116 error is logged
 *   (NO consecutive-error escalation — the pinned asymmetry vs the wizard).
 *   Phase 167.2 / KCS-22: only a clean absent read, before any row was seen in
 *   this activation, can end the attempt at the grace boundary
 *   (`onError("missing_row")`); a failed read runs to the cap (`onError("cap")`).
 *   Terminal states are just forwarded via `onStatus`; the loop never
 *   self-stops (the parent flips `enabled` off).
 *
 * - `schedule: readonly number[]` → self-scheduling `setTimeout` that walks the
 *   backoff ladder and holds the final step (wizard: POLL_BACKOFF_MS). Reads via
 *   `.maybeSingle()`; a Supabase error-as-value OR a thrown read increments a
 *   consecutive-error counter that escalates via `onError` at `maxConsecutiveErrors`
 *   (reset on any clean read). A CLEAN read that found NO ROW
 *   (`{data:null,error:null}`) is not a status: it consumes `missingRowGracePolls`
 *   exactly like the interval arm's missing row and reports nothing. On a terminal
 *   status (`failed` OR computed) it awaits
 *   `onTerminal`; `"repoll"` continues the ladder (R2-5), `"done"` stops. The heavy
 *   composite/single-key arms + their `heavyFetchErrors` escalation stay OUT of the
 *   hook, inside the caller's `onTerminal` closure.
 *
 * STAYS OUT of the hook (surface-specific): the wizard kickoff/WIZ-05 durability/
 * heavy arms/heavyFetchErrors/gate/sync-progress piggyback; SyncProgress's
 * exchange-name fetch/step-dots/`toSyncStatus` forward filter/elapsed timer.
 */
export interface UseStrategySyncPollerOptions {
  /**
   * Gate: SyncProgress `syncStatus === "computing"` (since 167-06 fix round 2;
   * it was `isActive`, which also spanned the pre-enqueue `syncing` state and
   * spent this hook's attempt budget before the job existed); wizard
   * `phase === "waiting_for_complete"`.
   */
  enabled: boolean;
  strategyId: string;
  /**
   * `number` → `setInterval` cadence (SyncProgress: 3000). `readonly number[]` →
   * self-scheduled `setTimeout` ladder walked then held (wizard: POLL_BACKOFF_MS).
   */
  schedule: number | readonly number[];
  /** Ladder mode: consecutive status-read failures before `onError` (wizard: 3). */
  maxConsecutiveErrors?: number;
  /** Interval mode: outer attempt cap; attempt N+1 escalates (SyncProgress: 40). */
  maxAttempts?: number;
  /**
   * Missing-row grace polls; the poll AFTER the boundary escalates via `onError`
   * (SyncProgress: 10). Consumed by BOTH arms: the interval arm counts total
   * attempts, the ladder arm counts CONSECUTIVE absent-row polls (an absent row
   * is not an error, so it gets its own counter). Left undefined → an absent row
   * never escalates; the loop keeps polling silently and reports nothing.
   *
   * Phase 167.2 / KCS-22: the INTERVAL arm escalates at this boundary only on
   * evidence that nothing was recorded — no row seen in this activation, and a
   * clean read (error null, or PGRST116) at the boundary — and passes
   * `"missing_row"`. `SyncProgress` renders that as KCS22-NOROW ("… with nothing
   * recorded yet …"), a claim a failed read cannot support, so an erroring read
   * or an absent read after a row was seen runs to `maxAttempts` instead.
   */
  missingRowGracePolls?: number;
  /**
   * Fired on every clean read with the DB status + error (surface forwards/sets).
   * Phase 167.2 / KCS-02: the INTERVAL arm also passes the row's server-written
   * `computed_at` as a third argument, which `SyncProgress` compares with the
   * value read just before its attempt's enqueue. The LADDER arm (the wizard's)
   * is unchanged and passes two arguments only.
   */
  onStatus: (
    status: ComputationStatus,
    error: string | null,
    computedAt?: string | null,
  ) => void;
  /**
   * Ladder mode only. Called on a terminal status; returns `"repoll"` to continue
   * the ladder or `"done"` to stop. The caller catches its own heavy-fetch faults
   * INSIDE this closure and returns `"repoll"`/`"done"` — the hook treats it as
   * infallible-or-repoll and never learns about `heavyFetchErrors`.
   */
  onTerminal?: (
    status: ComputationStatus,
    error: string | null,
  ) => Promise<"done" | "repoll"> | "done" | "repoll";
  /**
   * Escalation sink: wizard `failPolling`→SYNC_FAILED; SyncProgress
   * `onStatusChange("no_result", …)`. Phase 167.2 / KCS-22: the INTERVAL arm
   * names which give-up fired (`"cap"` or `"missing_row"`); the LADDER arm calls
   * it with no argument, exactly as before. 167.2-REVIEW-SFH M-3: the cap
   * reached with NO clean read in the activation is `"unreadable"`: the panel
   * stopped because it could not read, not because the sync was slow.
   */
  onError: (reason?: "cap" | "missing_row" | "unreadable") => void;
}

export function useStrategySyncPoller(opts: UseStrategySyncPollerOptions): void {
  const {
    enabled,
    strategyId,
    schedule,
    maxConsecutiveErrors,
    maxAttempts,
    missingRowGracePolls,
  } = opts;

  // Latest-callback refs: the poll effect must NOT re-run when a caller passes a
  // fresh inline `onStatus`/`onTerminal`/`onError` every render (both surfaces
  // re-render on a 1s elapsed timer). Re-running would reset the effect-local
  // counters (breaking the SyncProgress cap and the wizard escalation pins), so
  // the callbacks live in refs read from inside the timer callbacks instead of in
  // the effect deps. This sync effect runs on every commit — before any poll
  // timer (≥ the first schedule delay away) can fire — so the refs are always
  // current; it is declared BEFORE the poll effect so it flushes first.
  const onStatusRef = useRef(opts.onStatus);
  const onTerminalRef = useRef(opts.onTerminal);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => {
    onStatusRef.current = opts.onStatus;
    onTerminalRef.current = opts.onTerminal;
    onErrorRef.current = opts.onError;
  });

  // A `readonly number[]` schedule (module constant) has a stable identity, so it
  // is safe in the deps; a primitive `number` is stable by value.
  const isLadder = Array.isArray(schedule);

  useEffect(() => {
    if (!enabled) return;

    // -------------------------------------------------------------------------
    // INTERVAL MODE (SyncProgress): setInterval cadence, attempt cap + missing-
    // row grace, NO consecutive-error escalation. Counter resets whenever the
    // effect (re)starts on an `enabled` re-activation (effect-local `attempts`).
    // -------------------------------------------------------------------------
    if (!isLadder) {
      const intervalMs = schedule as number;
      let attempts = 0;
      // KCS-22: has any read in THIS activation returned a row (whatever its
      // status)? Effect-local like `attempts`, so a re-activation resets both.
      let sawRow = false;
      let cancelled = false;
      // 167.2-REVIEW-SFH M-2: reads are ORDERED. A read is issued every tick
      // whether or not the previous one has answered, so a slow read issued
      // before the worker wrote `computing` could land AFTER a faster, later
      // read that saw it, and deliver the PREVIOUS run's terminal row to a
      // caller whose evidence (a) is sticky (`SyncProgress`). Each read takes
      // the next number, and a response older than the newest one applied is
      // dropped, the `keysReadSeqRef` pattern `ApiKeyManager.loadKeys` uses.
      // Effect-local like `attempts`, so a re-activation resets it. INTERVAL
      // ARM ONLY: the ladder arm awaits each read before scheduling the next,
      // so it cannot reorder, and it stays byte-unchanged (LADDER-TWO-ARGS).
      let issuedSeq = 0;
      let appliedSeq = 0;
      // 167.2-REVIEW-SFH M-3: has any applied read in THIS activation been
      // clean (error null, or PGRST116 = 0 rows)? A cap reached without one is
      // reported as "unreadable", not "cap".
      let sawCleanRead = false;

      const intervalId = setInterval(async () => {
        // Increment-BEFORE-cap: attempt N+1 escalates without querying.
        attempts += 1;
        if (maxAttempts !== undefined && attempts > maxAttempts) {
          onErrorRef.current(sawCleanRead ? "cap" : "unreadable");
          return;
        }

        const seq = ++issuedSeq;
        const supabase = createClient();
        const { data, error: pollErr } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computation_error, computed_at")
          .eq("strategy_id", strategyId)
          .single();
        if (cancelled) return;
        // M-2: a response overtaken by a newer applied one is dropped whole.
        if (seq < appliedSeq) return;
        appliedSeq = seq;
        if (!pollErr || pollErr.code === "PGRST116") sawCleanRead = true;

        // PGRST116 (0 rows via .single()) is the expected "row not yet created"
        // case; log everything else (RLS regression / network / 5xx).
        if (pollErr && pollErr.code !== "PGRST116") {
          console.error(
            `[useStrategySyncPoller] strategy_analytics poll failed [strategy_id=${strategyId}]:`,
            pollErr.message,
            pollErr.code,
          );
        }

        // A read with no row reports no status. Phase 167.2 / KCS-22: past the
        // grace boundary it ends the attempt as "missing_row" ONLY on evidence
        // that nothing was recorded: this activation has seen no row, and this
        // read was clean (error null, or PGRST116 = 0 rows). The caller says
        // "nothing recorded yet" for that reason, and a failed read is not
        // evidence of absence, nor is an absent read after a row was seen, so
        // either one keeps polling and runs to the cap instead (UI-SPEC § State
        // matrix, the offline row). Lineage: any null-data read, erroring or
        // not, consumed grace and escalated here with no reason.
        if (!data) {
          const cleanRead = !pollErr || pollErr.code === "PGRST116";
          if (
            missingRowGracePolls !== undefined &&
            attempts > missingRowGracePolls &&
            !sawRow &&
            cleanRead
          ) {
            onErrorRef.current("missing_row");
          }
          return;
        }

        sawRow = true;

        onStatusRef.current(
          data.computation_status,
          data.computation_error ?? null,
          data.computed_at ?? null,
        );
      }, intervalMs);

      return () => {
        cancelled = true;
        clearInterval(intervalId);
      };
    }

    // -------------------------------------------------------------------------
    // LADDER MODE (wizard): self-scheduling setTimeout walking POLL_BACKOFF_MS
    // then holding the last step; consecutive-error escalation; async onTerminal
    // repoll. `stopped` hard-stops the loop the instant the effect tears down.
    // -------------------------------------------------------------------------
    const ladder = schedule as readonly number[];
    let stopped = false;
    let timerId: number | undefined;
    let tick = 0;
    let consecutiveErrors = 0;
    // TWIN-3 / C-3: an absent row and a failed read are DIFFERENT FACTS, so they
    // get different counters. `consecutiveErrors` counts reads that did not
    // answer; this counts reads that answered "there is no row". Effect-local,
    // like `consecutiveErrors`/`tick`, so a re-activation restarts the grace.
    let consecutiveAbsentRows = 0;
    let warnedAbsentRow = false;

    const scheduleNext = () => {
      if (stopped) return;
      const delay = ladder[Math.min(tick, ladder.length - 1)];
      tick += 1;
      timerId = window.setTimeout(poll, delay);
    };

    const escalate = () => {
      onErrorRef.current();
    };

    async function poll() {
      if (stopped) return;
      try {
        const supabase = createClient();
        const { data: statusRow, error: statusError } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computation_error")
          .eq("strategy_id", strategyId)
          .maybeSingle();

        if (stopped) return;

        // A Supabase error-as-value (RLS denial, transient 503) is NOT a genuine
        // `pending` row — treat it as a poll failure and let the counter escalate.
        if (statusError) {
          console.error(
            "[useStrategySyncPoller] poll status error:",
            statusError,
          );
          consecutiveErrors += 1;
          if (
            maxConsecutiveErrors !== undefined &&
            consecutiveErrors >= maxConsecutiveErrors
          ) {
            escalate();
            return;
          }
          scheduleNext();
          return;
        }

        consecutiveErrors = 0;

        // STALE-01a / TWIN-3 — ABSENCE IS NOT A VALUE. `{data:null,error:null}`
        // is PostgREST's answer for zero rows via `.maybeSingle()`: the read
        // SUCCEEDED and found nothing (no analytics row yet, or the session's RLS
        // read matched nothing). Neither fact is "the computation is queued", so
        // no status is reported at all — this arm used to coerce it to "pending",
        // a value no writer ever wrote, which the loop then read back as
        // non-terminal and re-scheduled forever (PROD 2026-08-04: the job chain
        // was terminal at 11:39:35 while the wizard still claimed work in
        // flight). The interval arm has always done it this way (:151-159); this
        // is that same answer, in the arm that lacked it.
        if (!statusRow) {
          consecutiveAbsentRows += 1;
          if (!warnedAbsentRow) {
            // Rule 12 (fail loud): a clean-null read logged NOTHING before, so
            // the fabrication was unobservable in a browser console. Warn once
            // per run — the loop may repeat this for many polls.
            warnedAbsentRow = true;
            console.warn(
              `[useStrategySyncPoller] strategy_analytics read found NO ROW [strategy_id=${strategyId}] — ` +
                `either no strategy_analytics row exists yet, or the session's RLS read matched nothing. ` +
                `Reporting no status (an absent row is not a computation state).`,
            );
          }
          if (
            missingRowGracePolls !== undefined &&
            consecutiveAbsentRows > missingRowGracePolls
          ) {
            escalate();
            return;
          }
          scheduleNext();
          return;
        }

        consecutiveAbsentRows = 0;

        const nextStatus = statusRow.computation_status as ComputationStatus;
        const nextError = statusRow.computation_error ?? null;
        onStatusRef.current(nextStatus, nextError);

        // Terminal = a hard-failed run OR a computed success (incl.
        // complete_with_warnings). Non-terminal (pending/computing) → keep polling.
        if (nextStatus === "failed" || isComputedAnalytics(nextStatus)) {
          const result = onTerminalRef.current
            ? await onTerminalRef.current(nextStatus, nextError)
            : "done";
          if (stopped) return;
          if (result === "repoll") {
            scheduleNext();
            return;
          }
          // "done" (or an unmount-guarded undefined) → stop the loop.
          stopped = true;
          return;
        }

        scheduleNext();
      } catch (err) {
        // A thrown status read (network blip, aborted fetch, transient 503) is
        // tolerated once; repeated throws must not spin forever.
        if (stopped) return;
        console.error("[useStrategySyncPoller] poll error:", err);
        consecutiveErrors += 1;
        if (
          maxConsecutiveErrors !== undefined &&
          consecutiveErrors >= maxConsecutiveErrors
        ) {
          escalate();
          return;
        }
        scheduleNext();
      }
    }

    // First poll after one base interval, matching the replaced setInterval's
    // first-tick latency (setInterval also waits one period before firing).
    timerId = window.setTimeout(poll, ladder[0]);

    return () => {
      stopped = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [
    enabled,
    strategyId,
    schedule,
    isLadder,
    maxConsecutiveErrors,
    maxAttempts,
    missingRowGracePolls,
  ]);
}
