"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import {
  checkStrategyGate,
  type StrategyGateResult,
} from "@/lib/strategyGate";
import {
  formatKeyError,
  gateFailureToWizardError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";

/**
 * SyncPreviewStep kicks off /api/keys/sync, polls strategy_analytics
 * for completion, runs `checkStrategyGate`, and renders a draft-variant
 * FactsheetPreview on success or the scripted wizardErrors copy on
 * failure. Only reads strategy_analytics — writes happen server-side.
 */

const POLL_INTERVAL_MS = 3000;
const SLOW_HINT_MS = 15_000;
const WARN_THRESHOLD_MS = 60_000;
const RETRY_THRESHOLD_MS = 180_000;

export interface SyncPreviewSnapshot {
  tradeCount: number;
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
  // useRef initializer must be a non-impure value for React Compiler's
  // purity rule. Real start time is set in the mount effect.
  const startedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    startedAtRef.current = Date.now();
    (async () => {
      try {
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
    const id = window.setInterval(async () => {
      try {
        // Lightweight status poll: only read the two status columns
        // while we wait for completion so each tick is cheap. The
        // heavy analytics columns (sparkline, metrics) only load once
        // on the terminal state.
        const { data: statusRow } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computation_error")
          .eq("strategy_id", strategyId)
          .maybeSingle();

        const nextStatus = statusRow?.computation_status ?? "pending";
        const nextError = statusRow?.computation_error ?? null;
        setComputationStatus((prev) => (prev === nextStatus ? prev : nextStatus));
        setComputationError((prev) => (prev === nextError ? prev : nextError));

        if (nextStatus !== "complete" && nextStatus !== "failed") {
          return;
        }

        // Terminal state reached. Fetch the heavy analytics row, trade
        // count + span, sample symbols for market detection, and the
        // exchange name in one Promise.all so the user moves to the
        // factsheet preview as fast as possible.
        const [
          { data: analytics },
          { count: tradeCount },
          { data: earliest },
          { data: latest },
          { data: sample },
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
            .limit(50),
          apiKeyId
            ? supabase
                .from("api_keys")
                .select("exchange")
                .eq("id", apiKeyId)
                .maybeSingle()
            : Promise.resolve({ data: null as { exchange?: string } | null }),
        ]);

        const marketsSet = new Set<string>();
        for (const trade of sample ?? []) {
          const symbol = (trade as { symbol?: string }).symbol ?? "";
          const base = symbol.split(/[-/]/)[0]?.toUpperCase();
          if (base) marketsSet.add(base);
        }

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
        });

        if (!gate.passed) {
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
          earliestTradeAt: earliest?.[0]?.timestamp ?? null,
          latestTradeAt: latest?.[0]?.timestamp ?? null,
          detectedMarkets: Array.from(marketsSet).slice(0, 6),
          exchange: keyRow?.exchange ?? null,
          metrics,
          sparkline: Array.isArray(analytics?.sparkline_returns)
            ? (analytics.sparkline_returns as number[])
            : null,
          computedAt: analytics?.computed_at ?? null,
        };

        setSnapshot(nextSnapshot);
        setPhase("passed");
      } catch (err) {
        console.error("[wizard:SyncPreviewStep] poll error:", err);
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [phase, strategyId, apiKeyId, wizardSessionId]);

  const handleUseThisKey = useCallback(() => {
    if (snapshot) onComplete(snapshot);
  }, [snapshot, onComplete]);

  const errorCopy = errorCode
    ? formatKeyError(errorCode, {
        trades: gateResult?.detail?.trades as number | undefined,
        days: gateResult?.detail?.days as number | undefined,
        computationError: computationError,
      })
    : null;

  // --- Rendering --------------------------------------------------------

  if (phase === "gate_failed" && errorCopy) {
    return (
      <section aria-labelledby="wizard-sync-heading">
        <h2
          id="wizard-sync-heading"
          className="font-sans text-2xl font-semibold text-text-primary"
        >
          We could not verify this strategy
        </h2>
        <div
          role="alert"
          className="mt-4 rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
          data-testid="wizard-sync-error"
          data-error-code={errorCode ?? undefined}
        >
          <p className="text-sm font-semibold text-negative">{errorCopy.title}</p>
          <p className="mt-1 text-xs text-text-secondary">{errorCopy.cause}</p>
          {errorCopy.fix.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-text-secondary">
              {errorCopy.fix.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[11px]">
            <Link
              href={errorCopy.docsHref}
              className="text-accent underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener"
            >
              Read the full guide →
            </Link>
          </p>
        </div>
        <div className="mt-6 flex gap-3">
          <Button onClick={onTryAnotherKey} data-testid="wizard-try-another-key">
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
          className="font-sans text-2xl font-semibold text-text-primary"
        >
          Your verified factsheet is ready
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          {snapshot.tradeCount} trade{snapshot.tradeCount === 1 ? "" : "s"} detected
          across{" "}
          {snapshot.detectedMarkets.length > 0
            ? snapshot.detectedMarkets.join(", ")
            : "your account"}
          . Review the preview and continue to add metadata.
        </p>

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
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        Computing your verified factsheet
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        We are fetching your trade history from the exchange and computing risk
        metrics. Usually takes 15–30 seconds.
      </p>

      <div className="mt-6 rounded-md border border-border bg-page px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <p className="text-sm font-medium text-text-primary">
            {computationStatus === "failed"
              ? "Sync reported a failure"
              : phase === "kicking_off"
                ? "Contacting exchange..."
                : computationStatus === "computing"
                  ? "Computing analytics..."
                  : "Fetching trades..."}
          </p>
          <span className="ml-auto font-metric text-xs tabular-nums text-text-muted">
            {elapsedSeconds}s
          </span>
        </div>

        {showSlowHint && !showWarn && (
          <p className="mt-2 text-xs text-text-muted">
            First sync of the day can take up to 45 seconds while the analytics
            service wakes up.
          </p>
        )}

        {showWarn && !showRetry && (
          <p className="mt-2 text-xs text-amber-600">
            This is taking longer than usual. Large accounts with multi-year
            history can take up to 3 minutes. Your draft is saved.
          </p>
        )}

        {showRetry && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-negative">
              Sync is taking much longer than expected. You can leave this page
              and come back — the draft is saved.
            </p>
          </div>
        )}

        {showWarn && (
          <button
            type="button"
            onClick={() => setExpandLog((v) => !v)}
            className="mt-2 text-[11px] text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
            data-testid="wizard-sync-expand-log"
          >
            {expandLog ? "Hide details" : "Show me what is happening"}
          </button>
        )}

        {expandLog && (
          <pre className="mt-2 overflow-x-auto rounded border border-border bg-white px-3 py-2 text-[10px] text-text-muted">
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
