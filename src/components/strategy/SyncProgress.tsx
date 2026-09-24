"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStrategySyncPoller } from "@/hooks/useStrategySyncPoller";
import { isFactsheetJobInFlight } from "@/lib/compute-state";
import { Button } from "@/components/ui/Button";
import type { StrategyAnalytics } from "@/lib/types";
import {
  MISSING_ROW_GRACE_POLLS,
  PANEL_STOP_COPY,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  type PanelStopReason,
} from "./key-card-copy";

/**
 * audit-2026-05-07 C-0142 — `ComputationStatus` is the source-of-truth DB
 * shape pulled from `StrategyAnalytics.computation_status`. Importing it
 * (instead of hand-rolling the string union) means adding a new DB status
 * MUST be handled by every consumer that maps `ComputationStatus → SyncStatus`,
 * because the exhaustive switch in `toSyncStatus()` ends in `assertNever`.
 */
export type ComputationStatus = StrategyAnalytics["computation_status"];

// The poll budget (POLL_INTERVAL_MS, POLL_MAX_ATTEMPTS, MISSING_ROW_GRACE_POLLS)
// and the copy that states it live in key-card-copy.ts (Phase 167.2 / KCS-22),
// so the "stopped checking after N" sentences are computed from the bounds the
// poll actually uses.

export type SyncStatus =
  | "idle"
  | "syncing"
  | "computing"
  | "complete"
  | "complete_with_warnings"
  | "error"
  // Phase 167.2 / KCS-22: UI-only. The panel stopped checking (its poll cap or
  // its missing-row grace ran out) with no accepted result. Not a failure: it
  // renders no "Sync failed" and no Retry (a re-POST while a job may be live
  // can insert a second job). `toSyncStatus` never returns it.
  | "no_result";

/**
 * Phase 167.2 / KCS-22: what the panel knows about a status it forwards.
 * `stopReason` names which give-up ended a `no_result`; `computationError` is
 * an evidenced failed row's server-written `computation_error`.
 */
export type SyncStatusInfo = {
  stopReason?: PanelStopReason;
  computationError?: string | null;
};

/**
 * Compile-time exhaustiveness guard. If a new `ComputationStatus` variant is
 * added at the source (`src/lib/types.ts`) without updating the switch in
 * `toSyncStatus`, the `never` mismatch produces a type error here.
 */
function assertNever(value: never): never {
  throw new Error(
    `assertNever: unexpected ComputationStatus variant: ${String(value)}`,
  );
}

/**
 * Discriminated converter from DB `computation_status` to UI `SyncStatus`.
 *
 * Phase 19.1: `complete_with_warnings` is a first-class DB status written
 * by `run_strategy_analytics` when consumer-specific flags fire (e.g. the
 * used_heuristic_capital path). `run_csv_strategy_analytics` writes plain
 * `complete`. Callers that want to upgrade an exchange-backed `complete`
 * to `complete_with_warnings` based on a non-DB signal (warnings payload
 * non-empty in the wizard) can still do so; the converter now also
 * accepts the DB-native variant and routes it to the same UI state.
 */
export function toSyncStatus(db: ComputationStatus): SyncStatus {
  switch (db) {
    case "pending":
      return "idle";
    case "computing":
      return "computing";
    case "complete":
      return "complete";
    case "complete_with_warnings":
      return "complete_with_warnings";
    case "failed":
      return "error";
    default:
      return assertNever(db);
  }
}

/**
 * Phase 167.2 / KCS-02: the strategy's `strategy_analytics.computed_at` as the
 * caller read it immediately before this attempt's enqueue. `null` is a real
 * answer (no analytics row yet); `"unknown"` means the read failed or did not
 * answer in time, so only a `computing` read can admit a terminal.
 */
export type EvidenceBaseline = { computedAt: string | null } | "unknown";

/**
 * Phase 167.2 / KCS-18 (RESEARCH P1): does the job queue agree that no
 * factsheet-chain job is still in flight for this strategy? Reads the existing
 * owner-scoped `/api/strategies/[id]/sync-progress` projection once.
 *
 * Fails closed on the claim: `true` only for a real read (HTTP ok, a JSON
 * object, not `degraded`, `jobStatus` null or a string) whose `jobStatus` is not
 * in flight per `isFactsheetJobInFlight`. Every other outcome (a limiter 429, a
 * 5xx, a body that does not parse, a rejected fetch, the route's DEGRADED body)
 * is `false`, and an unreadable answer is reported through `onUnreadable`. It
 * never throws. `jobStatus` null means no factsheet-chain job is visible and
 * `failed_final` is a finished chain; both let the success through.
 */
async function jobQueueSaysChainSettled(
  strategyId: string,
  onUnreadable: (reason: string) => void,
): Promise<boolean> {
  let body: unknown;
  try {
    const res = await fetch(
      `/api/strategies/${encodeURIComponent(strategyId)}/sync-progress`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      onUnreadable(`HTTP ${res.status}`);
      return false;
    }
    body = await res.json();
  } catch (err) {
    onUnreadable(err instanceof Error ? err.message : String(err));
    return false;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    onUnreadable("the body is not the projection");
    return false;
  }
  const read = body as { jobStatus?: unknown; degraded?: unknown };
  if (read.degraded === true) {
    onUnreadable("degraded read");
    return false;
  }
  if (read.jobStatus !== null && typeof read.jobStatus !== "string") {
    onUnreadable("the body carries no jobStatus");
    return false;
  }
  return !isFactsheetJobInFlight(read.jobStatus);
}

interface SyncProgressProps {
  strategyId: string;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  syncError: string | null;
  syncWarnings?: string | null;
  onRetry: () => void;
  onStatusChange?: (status: SyncStatus, info?: SyncStatusInfo) => void;
  /**
   * KCS-22: which give-up a `no_result` status came from (the caller stores the
   * reason the panel forwarded). Absent or null reads as `poll_cap`.
   */
  stopReason?: PanelStopReason | null;
  /**
   * KCS-02: the pre-enqueue baseline for this attempt (see `EvidenceBaseline`).
   * Defaults to `"unknown"`. The caller mounts one panel per attempt (a React
   * `key`), so the computing evidence below never carries into the next one.
   */
  evidenceBaseline?: EvidenceBaseline;
}

const STATUS_CONFIG: Record<
  SyncStatus,
  { icon: React.ReactNode; color: string; bgColor: string; label: string }
> = {
  idle: {
    icon: <IdleIcon />,
    color: "text-text-muted",
    bgColor: "bg-page",
    label: "Ready to sync",
  },
  syncing: {
    icon: <SpinnerIcon />,
    color: "text-accent",
    bgColor: "bg-accent/10",
    label: "Syncing trades...",
  },
  computing: {
    icon: <SpinnerIcon />,
    color: "text-accent",
    bgColor: "bg-accent/10",
    label: "Computing analytics...",
  },
  complete: {
    icon: <CheckIcon />,
    color: "text-positive",
    bgColor: "bg-positive/10",
    label: "Up to date",
  },
  complete_with_warnings: {
    icon: <WarningIcon />,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    label: "Synced with warnings",
  },
  error: {
    icon: <ErrorIcon />,
    color: "text-negative",
    bgColor: "bg-negative/10",
    label: "Sync failed",
  },
  // KCS-22 (UI-SPEC § Color): muted like `idle`, because nothing is known to be
  // wrong. It does NOT copy `complete_with_warnings`' amber-500 pair (not a
  // DESIGN.md token, fails AA). The label shown is PANEL_STOP_COPY's.
  no_result: {
    icon: <IdleIcon />,
    color: "text-text-secondary",
    bgColor: "bg-page",
    label: PANEL_STOP_COPY.poll_cap.label,
  },
};

export function SyncProgress({
  strategyId,
  syncStatus,
  lastSyncAt,
  syncError,
  syncWarnings,
  onRetry,
  onStatusChange,
  evidenceBaseline = "unknown",
  stopReason = null,
}: SyncProgressProps) {
  const [showWarnings, setShowWarnings] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [exchangeName, setExchangeName] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // KCS-02 evidence (a): this panel has itself read `computing` during this
  // attempt. Per attempt because the caller keys the panel per attempt.
  const sawComputingRef = useRef(false);
  // KCS-18: one job-state read at a time; a token per stretch of `computing`
  // (null once the panel leaves it or unmounts), so a read that lands late
  // forwards nothing; and one console.warn per attempt for unreadable answers
  // (the caller keys the panel per attempt, so these reset with it).
  const jobCheckInFlightRef = useRef(false);
  const computingTokenRef = useRef<object | null>(null);
  const warnedUnreadableRef = useRef(false);

  useEffect(() => {
    const token = syncStatus === "computing" ? {} : null;
    computingTokenRef.current = token;
    return () => {
      computingTokenRef.current = null;
    };
  }, [syncStatus]);

  const isActive = syncStatus === "syncing" || syncStatus === "computing";

  // Fetch exchange name from the strategy's linked API key
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    async function fetchExchange() {
      const supabase = createClient();
      // NEW-C37-05: destructure error from both queries and log/report on
      // failure. Pre-fix: both {error} returns were discarded, so an RLS
      // regression or network error produced a silently-wrong UI label
      // ("Fetching trades...") with zero telemetry.
      const { data: strategy, error: strategyErr } = await supabase
        .from("strategies")
        .select("api_key_id")
        .eq("id", strategyId)
        .single();
      if (strategyErr) {
        console.error(
          `[SyncProgress] strategies lookup failed [strategy_id=${strategyId}]:`,
          strategyErr.message,
        );
      }
      if (cancelled || !strategy?.api_key_id) return;
      const { data: apiKey, error: apiKeyErr } = await supabase
        .from("api_keys")
        .select("exchange")
        .eq("id", strategy.api_key_id)
        .single();
      if (apiKeyErr) {
        console.error(
          `[SyncProgress] api_keys lookup failed [strategy_id=${strategyId}, api_key_id=${strategy.api_key_id}]:`,
          apiKeyErr.message,
        );
      }
      if (!cancelled && apiKey?.exchange) {
        setExchangeName(apiKey.exchange.charAt(0).toUpperCase() + apiKey.exchange.slice(1));
      }
    }
    fetchExchange();
    return () => { cancelled = true; };
  }, [isActive, strategyId]);

  // Elapsed time counter
  useEffect(() => {
    // Defer reset to next tick to avoid sync setState-in-effect lint warning
    const resetId = setTimeout(() => setElapsedSeconds(0), 0);

    if (isActive) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      clearTimeout(resetId);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]);

  // UX-03 (#46): the 3s-cadence / 120s-cap / 30s-missing-row-grace poll loop now
  // lives in the shared `useStrategySyncPoller` hook (schedule:number →
  // setInterval semantics). The attempt counter, the increment-before-cap check,
  // the PGRST116-aware missing-row grace, the non-PGRST116 console.error, and the
  // counter reset on re-activation are all transplanted verbatim; the pins in
  // SyncProgress.poll.test.tsx prove zero behavior change. Everything below stays
  // SURFACE policy: the toSyncStatus forward filter (idle-drop) and the "error"
  // escalation sink are passed as callbacks — the hook never imports toSyncStatus.
  //
  // Phase 167 / 167-06 fix round 2 (167-REVIEW-06-R2 CR-01): the poll runs in
  // `computing` ONLY, not across `syncing` as well. `syncing` is the caller's
  // state for "our own sync request has not answered yet" (`ApiKeyManager`, this
  // component's one caller, moves to `computing` only once that request returned
  // enqueue evidence), so a read taken in `syncing` is about the strategy's
  // PREVIOUS run. Worse, the attempt counter and the missing-row grace are local
  // to the poll effect, and `isActive` spans both states, so the effect did not
  // restart at the enqueue: a slow enqueue spent the whole budget before its job
  // existed, and the first tick after it escalated to the timeout copy having
  // read the new job zero times. Gating on `computing` starts the budget at the
  // enqueue. The exchange-name fetch and the elapsed timer still span both.
  // The hook is unchanged, so the wizard (which calls it directly) is unaffected.
  useStrategySyncPoller({
    enabled: syncStatus === "computing",
    strategyId,
    schedule: POLL_INTERVAL_MS,
    maxAttempts: POLL_MAX_ATTEMPTS,
    missingRowGracePolls: MISSING_ROW_GRACE_POLLS,
    onStatus: (db, _error, computedAt) => {
      // audit-2026-05-07 C-0142: route DB status → UI status via the
      // discriminated converter. We only forward states that map cleanly to a
      // UI-visible transition (computing / complete / error); "idle" (from DB
      // "pending") is not propagated mid-sync because the caller already primed
      // us with "syncing" / "computing".
      const next = toSyncStatus(db);
      if (next === "computing") {
        sawComputingRef.current = true;
        onStatusChange?.(next);
        return;
      }
      if (
        next === "complete" ||
        next === "complete_with_warnings" ||
        next === "error"
      ) {
        // Phase 167.2 / KCS-02 — THE PER-ATTEMPT EVIDENCE GATE. Nothing writes
        // `strategy_analytics` when a job is enqueued or claimed, so for the
        // whole first hop the poll reads the PREVIOUS run's row, and its terminal
        // status used to end this attempt with the wrong run's result (a stale
        // "Up to date", or a false "Sync failed"). A terminal is forwarded only
        // with evidence that it is this attempt's:
        //   (a) this panel has read `computing` during this attempt, or
        //   (b) the row's `computed_at` differs from the value the caller read
        //       immediately before the enqueue (`evidenceBaseline`).
        // Both are server-written values; no client clock is read or compared.
        // (b) also closes the measured fast-fail case (RESEARCH Q1): a job that
        // fails before any handler writes `computing` still moves `computed_at`
        // through the bridge. Without evidence the read is dropped and the poll
        // continues; the attempt budget and the missing-row grace still apply.
        const changed =
          evidenceBaseline !== "unknown" &&
          (computedAt ?? null) !== evidenceBaseline.computedAt;
        if (!sawComputingRef.current && !changed) return;
        // An evidenced failure is forwarded as it stands: it needs no job-state
        // read (KCS-18 covers successes only).
        if (next === "error") {
          onStatusChange?.(next);
          return;
        }
        // Phase 167.2 / KCS-18 — THE JOB-STATE CHECK (RESEARCH P1). The SQL
        // status bridge keeps a `complete_with_warnings` row at that status while
        // the chain's jobs run, and still moves `computed_at` on every hop, so
        // evidence (b) above also accepts a warned row re-stamped MID-CHAIN. The
        // analytics row cannot tell that from the finished run; the job queue is
        // the authority on whether the chain is done. So a success is forwarded
        // only after one read of the sync-progress projection finds no
        // factsheet-chain job in flight. Any other answer drops this read and the
        // poll continues; the next evidenced tick asks again. One read at a time
        // (at the 3 s cadence that is at most 20 a minute against the route's
        // limiter of 60), and a read that lands after the panel left `computing`
        // or unmounted forwards nothing. It compares no client clock.
        if (jobCheckInFlightRef.current) return;
        jobCheckInFlightRef.current = true;
        const token = computingTokenRef.current;
        void jobQueueSaysChainSettled(strategyId, (reason) => {
          if (warnedUnreadableRef.current) return;
          warnedUnreadableRef.current = true;
          console.warn(
            `[SyncProgress] the job-state read was unreadable; the success is held and the poll continues [strategy_id=${strategyId}]:`,
            reason,
          );
        }).then((settled) => {
          jobCheckInFlightRef.current = false;
          if (settled && token !== null && computingTokenRef.current === token) {
            onStatusChange?.(next);
          }
        });
      }
    },
    // Phase 167.2 / KCS-22: a give-up is the panel running out of patience, not
    // evidence of a failure, so it ends the attempt as `no_result` (muted, no
    // Retry). The poller names which boundary fired: "missing_row" (no row seen
    // and a clean read at the grace boundary) selects KCS22-NOROW; anything
    // else, including no reason, is the poll cap. Lineage: this forwarded
    // "error", which the caller rendered as "Sync failed" with a timeout
    // sentence no timeout stood behind.
    onError: (reason) =>
      onStatusChange?.("no_result", {
        stopReason: reason === "missing_row" ? "missing_row" : "poll_cap",
      }),
  });

  // Step-based label for active states
  function getActiveLabel(): string {
    if (syncStatus === "syncing") {
      return exchangeName
        ? `Fetching trades from ${exchangeName}...`
        : "Fetching trades...";
    }
    return "Computing analytics...";
  }

  const config = STATUS_CONFIG[syncStatus];
  const stopCopy =
    syncStatus === "no_result" ? PANEL_STOP_COPY[stopReason ?? "poll_cap"] : null;
  const activeLabel = isActive
    ? getActiveLabel()
    : stopCopy
      ? stopCopy.label
      : config.label;

  // Step tracking: syncing = step 1-2, computing = step 3
  const currentStep = syncStatus === "syncing" ? 1 : syncStatus === "computing" ? 3 : 0;

  return (
    <div className={`rounded-lg px-3 py-2.5 ${config.bgColor}`}>
      {/* Status row */}
      <div className="flex items-center gap-2">
        <span className={`shrink-0 ${config.color}`}>{config.icon}</span>
        <span className={`text-sm font-medium ${config.color}`}>
          {activeLabel}
        </span>
        {isActive && (
          <span className="text-xs text-text-muted ml-auto tabular-nums">
            {formatElapsed(elapsedSeconds)}
          </span>
        )}
      </div>

      {/* Step indicators for active states */}
      {isActive && (
        <div className="mt-2 ml-6 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <StepDot active={currentStep === 1} complete={currentStep > 1} />
            <span className={`text-xs ${currentStep >= 1 ? "text-text-secondary" : "text-text-muted"}`}>
              Fetching trades{exchangeName ? ` from ${exchangeName}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <StepDot active={false} complete={currentStep > 2} />
            <span className={`text-xs ${currentStep >= 2 ? "text-text-secondary" : "text-text-muted"}`}>
              Processing trades
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <StepDot active={currentStep === 3} complete={false} />
            <span className={`text-xs ${currentStep >= 3 ? "text-text-secondary" : "text-text-muted"}`}>
              Computing analytics
            </span>
          </div>

          {/* Hint text */}
          <p className="text-xs text-text-muted mt-1">
            Usually takes 15–30 seconds
          </p>

          {/* Slow sync warning */}
          {elapsedSeconds > 60 && (
            <p className="text-xs text-amber-500 mt-0.5">
              This is taking longer than usual. Large accounts can take up to 2 minutes.
            </p>
          )}
        </div>
      )}

      {/* Last synced timestamp — shown for BOTH terminal successes (a warned
          sync is still a completed sync; mig 20260707120000 now persists it). */}
      {(syncStatus === "complete" || syncStatus === "complete_with_warnings") &&
        lastSyncAt && (
          <p className="text-xs text-text-muted mt-1 ml-6">
            Last synced {formatRelativeTime(lastSyncAt)}
          </p>
        )}

      {/* KCS-22: the panel stopped checking. Muted detail, no Retry. */}
      {stopCopy && (
        <p className="text-xs text-text-secondary mt-1 ml-6">{stopCopy.detail}</p>
      )}

      {/* Warnings detail */}
      {syncStatus === "complete_with_warnings" && syncWarnings && (
        <div className="mt-1 ml-6">
          <button
            onClick={() => setShowWarnings(!showWarnings)}
            className="text-xs text-amber-500 underline underline-offset-2 hover:text-amber-400"
          >
            {showWarnings ? "Hide details" : "Show details"}
          </button>
          {showWarnings && (
            <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">
              {syncWarnings}
            </p>
          )}
        </div>
      )}

      {/* Error detail + retry */}
      {syncStatus === "error" && (
        <div className="mt-1.5 ml-6">
          {syncError && (
            <p className="text-xs text-text-secondary mb-2">{syncError}</p>
          )}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

function StepDot({ active, complete }: { active: boolean; complete: boolean }) {
  if (complete) {
    return (
      <span className="flex h-2 w-2 rounded-full bg-accent" />
    );
  }
  if (active) {
    return (
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
      </span>
    );
  }
  return <span className="flex h-2 w-2 rounded-full bg-border" />;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

// --- Icons ---

function IdleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
      <path d="M14 8a6 6 0 00-6-6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.982 1.566a1.13 1.13 0 00-1.964 0L.165 13.233c-.457.778.091 1.767.982 1.767h13.706c.891 0 1.44-.99.982-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 01-1.1 0L7.1 5.995A.905.905 0 018 5zm.002 6.5a.75.75 0 100 1.5.75.75 0 000-1.5z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0a8 8 0 110 16A8 8 0 018 0zM5.354 4.646a.5.5 0 10-.708.708L7.293 8l-2.647 2.646a.5.5 0 00.708.708L8 8.707l2.646 2.647a.5.5 0 00.708-.708L8.707 8l2.647-2.646a.5.5 0 00-.708-.708L8 7.293 5.354 4.646z" />
    </svg>
  );
}
