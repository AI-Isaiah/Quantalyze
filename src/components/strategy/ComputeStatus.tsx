"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ComputeStatusProps {
  status: "pending" | "computing" | "complete" | "failed";
  error: string | null;
}

const STATUS_CONFIG = {
  pending: { label: "Awaiting data", color: "text-text-muted", bg: "bg-border/50" },
  computing: { label: "Computing analytics...", color: "text-accent", bg: "bg-accent/10" },
  complete: { label: "Done! Analytics ready.", color: "text-positive", bg: "bg-positive/10" },
  failed: { label: "Computation failed", color: "text-negative", bg: "bg-negative/10" },
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function ComputeStatus({ status, error }: ComputeStatusProps) {
  const config = STATUS_CONFIG[status];
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isComputing = status === "computing";

  useEffect(() => {
    // Defer reset to next tick to avoid sync setState-in-effect lint warning
    const resetId = setTimeout(() => setElapsedSeconds(0), 0);

    if (isComputing) {
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
  }, [isComputing]);

  return (
    <div className={cn("rounded-lg px-4 py-3", config.bg)}>
      <div className="flex items-center gap-2">
        {isComputing && (
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
        )}
        <span className={cn("text-sm font-medium", config.color)}>
          {config.label}
        </span>
        {isComputing && (
          <span className="text-xs text-text-muted ml-auto tabular-nums">
            {formatElapsed(elapsedSeconds)}
          </span>
        )}
      </div>
      {isComputing && (
        <div className="mt-1.5 ml-4 space-y-0.5">
          <p className="text-xs text-text-muted">
            Usually takes 15–30 seconds
          </p>
          {elapsedSeconds > 60 && (
            <p className="text-xs text-amber-500">
              This is taking longer than usual. Large accounts can take up to 2 minutes.
            </p>
          )}
        </div>
      )}
      {status === "failed" && error && (
        <p className="text-xs text-text-muted mt-1">{error}</p>
      )}
    </div>
  );
}
