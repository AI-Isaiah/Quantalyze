"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

export type SyncStatus =
  | "idle"
  | "syncing"
  | "computing"
  | "complete"
  | "complete_with_warnings"
  | "error";

interface SyncProgressProps {
  strategyId: string;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  syncError: string | null;
  syncWarnings?: string | null;
  onRetry: () => void;
  onStatusChange?: (status: SyncStatus) => void;
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
};

export function SyncProgress({
  strategyId,
  syncStatus,
  lastSyncAt,
  syncError,
  syncWarnings,
  onRetry,
  onStatusChange,
}: SyncProgressProps) {
  const [showWarnings, setShowWarnings] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [exchangeName, setExchangeName] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = syncStatus === "syncing" || syncStatus === "computing";

  // Fetch exchange name from the strategy's linked API key
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    async function fetchExchange() {
      const supabase = createClient();
      const { data: strategy } = await supabase
        .from("strategies")
        .select("api_key_id")
        .eq("id", strategyId)
        .single();
      if (cancelled || !strategy?.api_key_id) return;
      const { data: apiKey } = await supabase
        .from("api_keys")
        .select("exchange")
        .eq("id", strategy.api_key_id)
        .single();
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

  const pollStatus = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("strategy_analytics")
      .select("computation_status, computation_error, computed_at")
      .eq("strategy_id", strategyId)
      .single();

    if (!data) return;

    if (data.computation_status === "complete") {
      onStatusChange?.("complete");
    } else if (data.computation_status === "failed") {
      onStatusChange?.("error");
    } else if (data.computation_status === "computing") {
      onStatusChange?.("computing");
    }
  }, [strategyId, onStatusChange]);

  useEffect(() => {
    if (isActive) {
      intervalRef.current = setInterval(pollStatus, 3000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, pollStatus]);

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
  const activeLabel = isActive ? getActiveLabel() : config.label;

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

      {/* Last synced timestamp */}
      {syncStatus === "complete" && lastSyncAt && (
        <p className="text-xs text-text-muted mt-1 ml-6">
          Last synced {formatRelativeTime(lastSyncAt)}
        </p>
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
