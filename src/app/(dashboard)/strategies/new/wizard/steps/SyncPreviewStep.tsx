"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import { KeyPermissionBadge } from "@/components/connect/KeyPermissionBadge";
import {
  checkStrategyGate,
  isLedgerBackedExchange,
  type StrategyGateResult,
} from "@/lib/strategyGate";
import {
  gateFailureToWizardError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";

/**
 * SyncPreviewStep kicks off /api/keys/sync, polls strategy_analytics
 * for completion, runs `checkStrategyGate`, and renders a draft-variant
 * FactsheetPreview on success or the scripted wizardErrors copy on
 * failure. Only reads strategy_analytics — writes happen server-side.
 */

/**
 * How recent does a `complete` strategy_analytics row need to be for
 * the wizard to skip the /api/keys/sync kickoff on resume? The
 * analytics-service worker is already incremental (it uses
 * `api_keys.last_fetched_trade_timestamp` as the `since_ms` cursor —
 * see analytics-service/services/job_worker.py:_dispatch_sync_trades),
 * so a re-sync only fetches the delta. But the round-trip still costs
 * 30-60s of "Fetching trades..." UI latency for the user. Skipping the
 * kickoff when the row is fresh gets them straight to the factsheet.
 *
 * 5 minutes balances "don't show stale numbers on a long session
 * resume" against "don't re-fire a sync on every viewport remount."
 * QA report 2026-05-21 ISSUE-005.
 */
const SYNC_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Pure helper: derive the detected-markets set from a sample of trade
 * symbols. The Bybit + OKX ingest writes daily portfolio-level
 * aggregates under the synthetic symbol "PORTFOLIO"
 * (see analytics-service/services/exchange.py); those rows must NOT
 * surface as a "market" in the factsheet preview hint or the metadata
 * step. Pulled out of the polling callback so a regression test can pin
 * the filter without mocking the entire Supabase client.
 */
export function deriveDetectedMarkets(
  symbols: ReadonlyArray<string | null | undefined>,
  limit = 6,
): string[] {
  const set = new Set<string>();
  for (const raw of symbols) {
    const symbol = raw ?? "";
    if (symbol === "PORTFOLIO") continue;
    const base = symbol.split(/[-/]/)[0]?.toUpperCase();
    if (base) set.add(base);
  }
  return Array.from(set).slice(0, limit);
}

/**
 * Read the correlation_id from the <meta name="x-correlation-id"> tag the
 * root layout renders server-side (Plan 16-02 / OBSERV-09). Falls back to
 * a fresh UUID v4 when the meta tag is absent (e.g., during the parallel
 * wave window when 16-02 has not yet merged into this branch).
 */
function readCorrelationId(): string {
  if (typeof document !== "undefined") {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="x-correlation-id"]',
    );
    const value = meta?.getAttribute("content");
    if (value && value.length > 0) return value;
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SLOW_HINT_MS = 15_000;
const WARN_THRESHOLD_MS = 60_000;
const RETRY_THRESHOLD_MS = 180_000;

/**
 * Status-poll backoff schedule. Each entry is the delay BEFORE the next
 * poll; the loop walks the ladder and then holds at the final step.
 * Capping at 10s keeps DB load and background-tab timer churn down on
 * slow first-of-day syncs (~45s) and the 3-minute worst case, while the
 * first few ticks stay snappy so a fast sync still feels instant. The
 * elapsed-time UI thresholds are wall-clock, not poll-count, so backing
 * off the poll cadence does not shift the SLOW/WARN/RETRY copy.
 */
const POLL_BACKOFF_MS = [3000, 3000, 5000, 5000, 10_000] as const;

/**
 * How many CONSECUTIVE poll failures (Supabase `error`, a thrown
 * exception, or a network blip) before we stop spinning and surface a
 * recoverable SYNC_FAILED envelope. Without this the wizard hangs on
 * "Fetching trades..." forever when the read keeps failing (e.g. an RLS
 * regression denies the row, or a transient 503). One transient blip is
 * tolerated; three in a row is a real fault the user needs an exit from.
 */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

export interface SyncPreviewSnapshot {
  tradeCount: number;
  /**
   * `csv_daily_returns` row count. Non-zero for ledger-backed exchanges
   * (Deribit) and CSV uploads, whose returns never populate `trades` (P72).
   */
  csvRowCount: number;
  earliestTradeAt: string | null;
  latestTradeAt: string | null;
  detectedMarkets: string[];
  exchange: string | null;
  metrics: FactsheetPreviewMetric[];
  sparkline: number[] | null;
  computedAt: string | null;
}

export interface SyncPreviewStepProps {
  strategyId: string;
  apiKeyId: string | null;
  wizardSessionId: string;
  onComplete: (snapshot: SyncPreviewSnapshot) => void;
  onTryAnotherKey: () => void;
}

type Phase =
  | "kicking_off"
  | "waiting_for_complete"
  | "gate_failed"
  | "passed";

function formatMetric(value: number | null, suffix = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (suffix === "%") return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function formatCagr(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function SyncPreviewStep({
  strategyId,
  apiKeyId,
  wizardSessionId,
  onComplete,
  onTryAnotherKey,
}: SyncPreviewStepProps) {
  const [phase, setPhase] = useState<Phase>("kicking_off");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  const [gateResult, setGateResult] = useState<StrategyGateResult | null>(null);
  const [snapshot, setSnapshot] = useState<SyncPreviewSnapshot | null>(null);
  const [expandLog, setExpandLog] = useState(false);
  const [computationStatus, setComputationStatus] = useState<string | null>(null);
  const [computationError, setComputationError] = useState<string | null>(null);
  // Phase 16 Plan 06: correlation_id for the envelope. See readCorrelationId().
  const [correlationId] = useState<string>(() => readCorrelationId());
  // useRef initializer must be a non-impure value for React Compiler's
  // purity rule. Real start time is set in the mount effect.
  const startedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    startedAtRef.current = Date.now();
    (async () => {
      try {
        // QA report 2026-05-21 ISSUE-005 — skip the /api/keys/sync
        // round-trip on resume when the analytics row is both COMPLETE
        // and fresh (within SYNC_FRESHNESS_WINDOW_MS). The worker is
        // already incremental via api_keys.last_fetched_trade_timestamp,
        // so a re-sync only fetches the delta — but the user still
        // sees ~30-60s of "Fetching trades..." while the round-trip
        // unwinds. Skipping when fresh gets them straight to the
        // factsheet polling tick, which then materializes the snapshot
        // on the first poll. Stale rows still kick off as before so
        // a long-paused session doesn't show outdated metrics.
        const supabase = createClient();
        const { data: existing } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computed_at")
          .eq("strategy_id", strategyId)
          .maybeSingle();
        const computedAtMs = existing?.computed_at
          ? Date.parse(existing.computed_at)
          : null;
        const isFresh =
          isComputedAnalytics(existing?.computation_status) &&
          computedAtMs !== null &&
          Number.isFinite(computedAtMs) &&
          Date.now() - computedAtMs < SYNC_FRESHNESS_WINDOW_MS;
        if (isFresh) {
          if (mountedRef.current) setPhase("waiting_for_complete");
          return;
        }
        const res = await fetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        });
        if (!res.ok && mountedRef.current) {
          setErrorCode("SYNC_FAILED");
          setPhase("gate_failed");
          return;
        }
        if (mountedRef.current) setPhase("waiting_for_complete");
      } catch (err) {
        console.error("[wizard:SyncPreviewStep] kickoff threw:", err);
        if (mountedRef.current) {
          setErrorCode("KEY_NETWORK_TIMEOUT");
          setPhase("gate_failed");
        }
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, [strategyId]);

  useEffect(() => {
    if (phase !== "waiting_for_complete" && phase !== "kicking_off") return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "waiting_for_complete") return;
    const supabase = createClient();

    // `stopped` is checked at the top of every tick AND before every
    // self-reschedule so the loop hard-stops the instant the effect
    // tears down (phase change / strategyId change / unmount). The old
    // setInterval relied on the effect re-running to clear the timer,
    // which left the previous interval's closure firing 1-2 extra polls
    // against a stale `phase` after a setPhase() (H-0195). A
    // self-scheduling setTimeout with a local guard cannot fire again
    // once cleared.
    let stopped = false;
    let timerId: number | undefined;
    let tick = 0;
    // Count of CONSECUTIVE status-read failures (Supabase `error` or a
    // transport throw before the terminal fetch); reset to 0 on any clean
    // status read.
    let consecutiveErrors = 0;
    // Count of CONSECUTIVE terminal/heavy-fetch failures. Tracked separately
    // from `consecutiveErrors` because the narrow status read can keep
    // succeeding (resetting `consecutiveErrors`) while the heavy Promise.all
    // persistently REJECTS — e.g. a network blip, an aborted fetch, or a
    // transport-level error on a trades/api_keys query. (A Supabase error
    // returned AS A VALUE — `{ data, error }` with a non-null `error` — is NOT
    // caught here: the destructured results ignore `.error`, so e.g. an RLS
    // denial on `trades` drops `tradeCount` to 0 via `?? 0` and the gate fails
    // with INSUFFICIENT_TRADES — a terminal, loop-stopping outcome, not a
    // heavyFetchErrors escalation.) With a shared counter a persistent throw
    // oscillates 0→1→0 and never escalates, so the wizard spins forever
    // (H-0197, narrowed to heavy-fetch-only faults). A dedicated counter never
    // needs a reset: every non-throwing heavy outcome (passed / gate-fail)
    // sets `stopped = true` and terminates the loop, so the only path that
    // reschedules is a throw.
    let heavyFetchErrors = 0;

    const scheduleNext = () => {
      if (stopped) return;
      const delay =
        POLL_BACKOFF_MS[Math.min(tick, POLL_BACKOFF_MS.length - 1)];
      tick += 1;
      timerId = window.setTimeout(poll, delay);
    };

    /**
     * Stop polling and surface a recoverable SYNC_FAILED envelope. Used
     * when the status read keeps failing (H-0197 / H-0198) so the user
     * gets an exit affordance instead of an indefinite spinner. Fires
     * the same `wizard_error` funnel event as the gate-failure path so
     * the drop-off is recorded in PostHog.
     */
    const failPolling = () => {
      if (stopped || !mountedRef.current) return;
      stopped = true;
      setErrorCode("SYNC_FAILED");
      setPhase("gate_failed");
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "sync_preview",
        code: "SYNC_FAILED",
      });
    };

    const poll = async () => {
      if (stopped) return;
      try {
        // Lightweight status poll: only read the two status columns
        // while we wait for completion so each tick is cheap. The
        // heavy analytics columns (sparkline, metrics) only load once
        // on the terminal state.
        const { data: statusRow, error: statusError } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computation_error")
          .eq("strategy_id", strategyId)
          .maybeSingle();

        if (stopped) return;

        // A Supabase `error` (RLS denial, transient 503) is NOT the same
        // as a genuine `pending` row. Without this branch an RLS
        // regression returns { data: null, error } and `nextStatus`
        // silently collapses to "pending" via the ?? default — the
        // wizard then spins forever on a permissions misconfig nobody
        // can see (H-0198). Treat it as a poll failure and let the
        // consecutive-error counter escalate.
        if (statusError) {
          console.error(
            "[wizard:SyncPreviewStep] poll status error:",
            statusError,
          );
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            failPolling();
            return;
          }
          scheduleNext();
          return;
        }

        consecutiveErrors = 0;

        const nextStatus = statusRow?.computation_status ?? "pending";
        const nextError = statusRow?.computation_error ?? null;
        setComputationStatus((prev) => (prev === nextStatus ? prev : nextStatus));
        setComputationError((prev) => (prev === nextError ? prev : nextError));

        // Hard-failure terminal state. Bail BEFORE the heavy Promise.all
        // (H-0195): on `failed` the analytics row is errored, so the 5
        // trades/api_keys queries are pure waste, and the gate would only
        // ever map this to GATE_ANALYTICS_FAILED anyway. Route straight
        // to the scripted analytics-failed envelope, carrying
        // computation_error for the detail line, and stop polling.
        if (nextStatus === "failed") {
          stopped = true;
          if (!mountedRef.current) return;
          setErrorCode("GATE_ANALYTICS_FAILED");
          setPhase("gate_failed");
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "sync_preview",
            code: "GATE_ANALYTICS_FAILED",
          });
          return;
        }

        // Terminal SUCCESS includes complete_with_warnings — else a warned
        // first compute (e.g. a Deribit onboarding tripping a DQ guard) polls
        // forever, since the runner now persists that status instead of it
        // being laundered to 'complete' (mig 20260707120000).
        if (!isComputedAnalytics(nextStatus)) {
          scheduleNext();
          return;
        }

        // Terminal state reached. Fetch the heavy analytics row, trade
        // count + span, sample symbols for market detection, and the
        // exchange name in one Promise.all so the user moves to the
        // factsheet preview as fast as possible.
        //
        // Wrapped in its own try/catch (separate from the status-read catch
        // below) so a persistently-throwing heavy fetch escalates via
        // `heavyFetchErrors` instead of being masked by the line-above
        // `consecutiveErrors = 0` reset. One transient heavy fault is still
        // tolerated; the threshold matches the status-read path.
        try {
          const [
            { data: analytics },
            { count: tradeCount },
            { data: earliest },
            { data: latest },
            { data: sample },
            { count: csvRowCount },
            keyRowResult,
          ] = await Promise.all([
            supabase
              .from("strategy_analytics")
              .select(
                "cagr, sharpe, sortino, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at",
              )
              .eq("strategy_id", strategyId)
              .maybeSingle(),
            supabase
              .from("trades")
              .select("id", { count: "exact", head: true })
              .eq("strategy_id", strategyId),
            supabase
              .from("trades")
              .select("timestamp")
              .eq("strategy_id", strategyId)
              .order("timestamp", { ascending: true })
              .limit(1),
            supabase
              .from("trades")
              .select("timestamp")
              .eq("strategy_id", strategyId)
              .order("timestamp", { ascending: false })
              .limit(1),
            supabase
              .from("trades")
              .select("symbol")
              .eq("strategy_id", strategyId)
              // Bybit + OKX ingest writes daily portfolio aggregates under
              // the synthetic symbol "PORTFOLIO". Bybit accounts can have
              // hundreds of these clustered at the start of the table; an
              // unordered limit(50) sample then comes back as 50× PORTFOLIO
              // and the client-side filter leaves the detected-markets
              // hint empty. Excluding the sentinel at the query layer keeps
              // the sample biased toward real trading pairs.
              .neq("symbol", "PORTFOLIO")
              .limit(50),
            // P72 — daily-return row count. Ledger-backed exchanges (Deribit)
            // derive returns into `csv_daily_returns` and NEVER write `trades`,
            // so a keyed Deribit strategy has tradeCount 0. The gate needs the
            // csv row count to take its daily-returns branch instead of
            // false-failing INSUFFICIENT_TRADES.
            supabase
              .from("csv_daily_returns")
              .select("strategy_id", { count: "exact", head: true })
              .eq("strategy_id", strategyId),
            apiKeyId
              ? supabase
                  .from("api_keys")
                  .select("exchange")
                  .eq("id", apiKeyId)
                  .maybeSingle()
              : Promise.resolve({ data: null as { exchange?: string } | null }),
          ]);

          const detectedMarkets = deriveDetectedMarkets(
            (sample ?? []).map((t) => (t as { symbol?: string }).symbol),
          );

          const keyRow = keyRowResult.data;

          if (!mountedRef.current) return;

          const gate = checkStrategyGate({
            apiKeyId,
            tradeCount: tradeCount ?? 0,
            earliestTradeAt: earliest?.[0]?.timestamp
              ? new Date(earliest[0].timestamp)
              : null,
            latestTradeAt: latest?.[0]?.timestamp
              ? new Date(latest[0].timestamp)
              : null,
            computationStatus: nextStatus,
            computationError: nextError,
            csvRowCount: csvRowCount ?? 0,
            // P72 — only a ledger-backed (Deribit) keyed strategy may pass on a
            // daily-returns series; a keyed perp with 0 fills must stay on the
            // trade branch (its funding series has no completeness gate).
            isLedgerBacked: isLedgerBackedExchange(keyRow?.exchange),
          });

          if (!gate.passed) {
            stopped = true;
            setGateResult(gate);
            const wizardCode = gate.code ? gateFailureToWizardError(gate.code) : "UNKNOWN";
            setErrorCode(wizardCode);
            setPhase("gate_failed");
            trackForQuantsEventClient("wizard_error", {
              wizard_session_id: wizardSessionId,
              step: "sync_preview",
              code: wizardCode,
              trade_count: tradeCount ?? 0,
            });
            return;
          }

          const metrics: FactsheetPreviewMetric[] = [
            { label: "CAGR", value: formatCagr(analytics?.cagr ?? null) },
            { label: "Sharpe", value: formatMetric(analytics?.sharpe ?? null) },
            { label: "Sortino", value: formatMetric(analytics?.sortino ?? null) },
            {
              label: "Max DD",
              value: analytics?.max_drawdown != null ? formatCagr(analytics.max_drawdown) : "—",
            },
            {
              label: "Volatility",
              value: analytics?.volatility != null ? formatMetric(analytics.volatility, "%") : "—",
            },
            {
              label: "Cumulative",
              value: analytics?.cumulative_return != null ? formatCagr(analytics.cumulative_return) : "—",
            },
          ];

          const nextSnapshot: SyncPreviewSnapshot = {
            tradeCount: tradeCount ?? 0,
            csvRowCount: csvRowCount ?? 0,
            earliestTradeAt: earliest?.[0]?.timestamp ?? null,
            latestTradeAt: latest?.[0]?.timestamp ?? null,
            detectedMarkets,
            exchange: keyRow?.exchange ?? null,
            metrics,
            sparkline: Array.isArray(analytics?.sparkline_returns)
              ? (analytics.sparkline_returns as number[])
              : null,
            computedAt: analytics?.computed_at ?? null,
          };

          stopped = true;
          setSnapshot(nextSnapshot);
          setPhase("passed");
        } catch (heavyErr) {
          // The terminal fetch / gate evaluation threw (network blip, an
          // aborted fetch, or a transport-level rejection). One transient
          // fault is tolerated, but a persistent heavy-fetch fault
          // must escalate — the narrow status read keeps succeeding above,
          // so `consecutiveErrors` would never reach the threshold (H-0197,
          // heavy-fetch-narrowed). Count consecutive heavy failures and
          // surface the recoverable SYNC_FAILED envelope past the threshold.
          if (stopped) return;
          console.error(
            "[wizard:SyncPreviewStep] terminal fetch error:",
            heavyErr,
          );
          heavyFetchErrors += 1;
          if (heavyFetchErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            failPolling();
            return;
          }
          scheduleNext();
        }
      } catch (err) {
        // A thrown status read (network blip, aborted fetch, transient 503)
        // is tolerated once, but repeated throws must not leave the wizard
        // spinning forever (H-0197). Count consecutive failures and
        // escalate to a recoverable SYNC_FAILED envelope past the
        // threshold; otherwise back off and retry.
        if (stopped) return;
        console.error("[wizard:SyncPreviewStep] poll error:", err);
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          failPolling();
          return;
        }
        scheduleNext();
      }
    };

    // Schedule the first poll after one base interval, exactly matching
    // the replaced setInterval's first-tick latency (setInterval also
    // waits one period before its first callback) so resume/timing
    // behaviour is unchanged.
    timerId = window.setTimeout(poll, POLL_BACKOFF_MS[0]);

    return () => {
      stopped = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [phase, strategyId, apiKeyId, wizardSessionId]);

  const handleUseThisKey = useCallback(() => {
    if (snapshot) onComplete(snapshot);
  }, [snapshot, onComplete]);

  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, correlationId, {
        trades: gateResult?.detail?.trades as number | undefined,
        days: gateResult?.detail?.days as number | undefined,
        computationError: computationError,
      })
    : null;

  // --- Rendering --------------------------------------------------------

  if (phase === "gate_failed" && errorEnvelope) {
    return (
      <section aria-labelledby="wizard-sync-heading">
        <h2
          id="wizard-sync-heading"
          className="font-sans text-h3 font-semibold text-text-primary"
        >
          We could not verify this strategy
        </h2>
        <div className="mt-4">
          <WizardErrorEnvelope envelope={errorEnvelope} />
        </div>
        <div className="mt-6 flex gap-3">
          <Button
            type="button"
            onClick={onTryAnotherKey}
            data-testid="wizard-try-another-key"
          >
            Try another key
          </Button>
        </div>
      </section>
    );
  }

  if (phase === "passed" && snapshot) {
    return (
      <section aria-labelledby="wizard-sync-heading">
        <h2
          id="wizard-sync-heading"
          className="font-sans text-h3 font-semibold text-text-primary"
        >
          Your verified factsheet is ready
        </h2>
        <p className="mt-2 text-body text-text-secondary">
          {snapshot.tradeCount > 0 ? (
            <>
              {snapshot.tradeCount} trade{snapshot.tradeCount === 1 ? "" : "s"}{" "}
              detected across{" "}
              {snapshot.detectedMarkets.length > 0
                ? snapshot.detectedMarkets.join(", ")
                : "your account"}
              . Review the preview and continue to add metadata.
            </>
          ) : (
            // Ledger-backed / CSV strategies have no trades — their history is a
            // daily-return series (P72). Show the series length instead of a
            // "0 trades detected" line.
            <>
              {snapshot.csvRowCount} day{snapshot.csvRowCount === 1 ? "" : "s"} of
              returns detected. Review the preview and continue to add metadata.
            </>
          )}
        </p>

        {/*
          Sprint 5 Task 5.8: informational scope badge. The route-level gate
          in /api/keys/validate-and-encrypt (line 26) already blocked any key
          with trade/withdraw before we got here, so by definition this should
          render Read ✓ / Trade ✗ / Withdraw ✗. The badge surfaces it for
          allocator confidence and confirms scopes haven't drifted.
        */}
        {apiKeyId && (
          <div className="mt-6">
            <KeyPermissionBadge apiKeyId={apiKeyId} />
          </div>
        )}

        <div className="mt-6">
          <FactsheetPreview
            strategyName={"Your draft strategy"}
            subtitle={
              snapshot.detectedMarkets.length > 0
                ? `Detected: ${snapshot.detectedMarkets.join(", ")}`
                : undefined
            }
            metrics={snapshot.metrics}
            sparklineReturns={snapshot.sparkline}
            computedAt={snapshot.computedAt}
            verificationState="draft"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleUseThisKey} data-testid="wizard-use-this-key">
            Use this key and continue
          </Button>
          <Button
            variant="ghost"
            onClick={onTryAnotherKey}
            data-testid="wizard-try-another-key"
          >
            Try another key
          </Button>
        </div>
      </section>
    );
  }

  // Default: kicking_off / waiting_for_complete (spinner + elapsed)
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const showSlowHint = elapsedMs >= SLOW_HINT_MS;
  const showWarn = elapsedMs >= WARN_THRESHOLD_MS;
  const showRetry = elapsedMs >= RETRY_THRESHOLD_MS;

  return (
    <section aria-labelledby="wizard-sync-heading">
      <h2
        id="wizard-sync-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Computing your verified factsheet
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        We are fetching your trade history from the exchange and computing risk
        metrics. Usually takes 15–30 seconds.
      </p>

      <div className="mt-6 rounded-md border border-border bg-page px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <p className="text-body font-medium text-text-primary">
            {computationStatus === "failed"
              ? "Sync reported a failure"
              : phase === "kicking_off"
                ? "Contacting exchange..."
                : computationStatus === "computing"
                  ? "Computing analytics..."
                  : "Fetching trades..."}
          </p>
          <span className="ml-auto font-metric text-caption tabular-nums text-text-muted">
            {elapsedSeconds}s
          </span>
        </div>

        {showSlowHint && !showWarn && (
          <p className="mt-2 text-caption text-text-muted">
            First sync of the day can take up to 45 seconds while the analytics
            service wakes up.
          </p>
        )}

        {showWarn && !showRetry && (
          <p className="mt-2 text-caption text-amber-600">
            This is taking longer than usual. Large accounts with multi-year
            history can take up to 3 minutes. Your draft is saved.
          </p>
        )}

        {showRetry && (
          <div className="mt-2 space-y-2">
            <p className="text-caption text-negative">
              Sync is taking much longer than expected. You can leave this page
              and come back — the draft is saved.
            </p>
          </div>
        )}

        {showWarn && (
          <button
            type="button"
            onClick={() => setExpandLog((v) => !v)}
            className="mt-2 text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
            data-testid="wizard-sync-expand-log"
          >
            {expandLog ? "Hide details" : "Show me what is happening"}
          </button>
        )}

        {expandLog && (
          <pre className="mt-2 overflow-x-auto rounded border border-border bg-white px-3 py-2 text-micro text-text-muted">
            strategy_id={strategyId}
            {"\n"}
            status={computationStatus ?? "unknown"}
            {"\n"}
            elapsed={elapsedSeconds}s{"\n"}
            {computationError ? `error=${computationError}\n` : ""}
          </pre>
        )}
      </div>
    </section>
  );
}
