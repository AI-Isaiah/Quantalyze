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
 *   expected "row not yet created" case and a non-PGRST116 error is logged and
 *   consumes grace like a missing row (NO consecutive-error escalation — the
 *   pinned asymmetry vs the wizard). Terminal states are just forwarded via
 *   `onStatus`; the loop never self-stops (the parent flips `enabled` off).
 *
 * - `schedule: readonly number[]` → self-scheduling `setTimeout` that walks the
 *   backoff ladder and holds the final step (wizard: POLL_BACKOFF_MS). Reads via
 *   `.maybeSingle()`; a Supabase error-as-value OR a thrown read increments a
 *   consecutive-error counter that escalates via `onError` at `maxConsecutiveErrors`
 *   (reset on any clean read). On a terminal status (`failed` OR computed) it awaits
 *   `onTerminal`; `"repoll"` continues the ladder (R2-5), `"done"` stops. The heavy
 *   composite/single-key arms + their `heavyFetchErrors` escalation stay OUT of the
 *   hook, inside the caller's `onTerminal` closure.
 *
 * STAYS OUT of the hook (surface-specific): the wizard kickoff/WIZ-05 durability/
 * heavy arms/heavyFetchErrors/gate/sync-progress piggyback; SyncProgress's
 * exchange-name fetch/step-dots/`toSyncStatus` forward filter/elapsed timer.
 */
export interface UseStrategySyncPollerOptions {
  /** Gate: SyncProgress `isActive`; wizard `phase === "waiting_for_complete"`. */
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
  /** Interval mode: missing-row grace polls; poll N+1 escalates (SyncProgress: 10). */
  missingRowGracePolls?: number;
  /** Fired on every clean read with the DB status + error (surface forwards/sets). */
  onStatus: (status: ComputationStatus, error: string | null) => void;
  /**
   * Ladder mode only. Called on a terminal status; returns `"repoll"` to continue
   * the ladder or `"done"` to stop. The caller catches its own heavy-fetch faults
   * INSIDE this closure and returns `"repoll"`/`"done"` — the hook treats it as
   * infallible-or-repoll and never learns about `heavyFetchErrors`.
   */
  onTerminal?: (
    status: ComputationStatus,
  ) => Promise<"done" | "repoll"> | "done" | "repoll";
  /** Escalation sink: wizard `failPolling`→SYNC_FAILED; SyncProgress `onStatusChange("error")`. */
  onError: () => void;
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
  // the effect deps. Assigning during render keeps them current before any timer
  // (which only fires after commit) can read them.
  const onStatusRef = useRef(opts.onStatus);
  const onTerminalRef = useRef(opts.onTerminal);
  const onErrorRef = useRef(opts.onError);
  onStatusRef.current = opts.onStatus;
  onTerminalRef.current = opts.onTerminal;
  onErrorRef.current = opts.onError;

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
      let cancelled = false;

      const intervalId = setInterval(async () => {
        // Increment-BEFORE-cap: attempt N+1 escalates without querying.
        attempts += 1;
        if (maxAttempts !== undefined && attempts > maxAttempts) {
          onErrorRef.current();
          return;
        }

        const supabase = createClient();
        const { data, error: pollErr } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computation_error, computed_at")
          .eq("strategy_id", strategyId)
          .single();
        if (cancelled) return;

        // PGRST116 (0 rows via .single()) is the expected "row not yet created"
        // case; log everything else (RLS regression / network / 5xx).
        if (pollErr && pollErr.code !== "PGRST116") {
          console.error(
            `[useStrategySyncPoller] strategy_analytics poll failed [strategy_id=${strategyId}]:`,
            pollErr.message,
            pollErr.code,
          );
        }

        // A missing row (PGRST116 or any error with null data) consumes grace
        // like a missing row — no escalation until the grace boundary.
        if (!data) {
          if (
            missingRowGracePolls !== undefined &&
            attempts > missingRowGracePolls
          ) {
            onErrorRef.current();
          }
          return;
        }

        onStatusRef.current(
          data.computation_status,
          data.computation_error ?? null,
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

        const nextStatus = (statusRow?.computation_status ??
          "pending") as ComputationStatus;
        const nextError = statusRow?.computation_error ?? null;
        onStatusRef.current(nextStatus, nextError);

        // Terminal = a hard-failed run OR a computed success (incl.
        // complete_with_warnings). Non-terminal (pending/computing) → keep polling.
        if (nextStatus === "failed" || isComputedAnalytics(nextStatus)) {
          const result = onTerminalRef.current
            ? await onTerminalRef.current(nextStatus)
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
