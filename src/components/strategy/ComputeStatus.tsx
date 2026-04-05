"use client";

import { cn } from "@/lib/utils";

interface ComputeStatusProps {
  status: "pending" | "computing" | "complete" | "failed";
  error: string | null;
}

const STATUS_CONFIG = {
  pending: { label: "Awaiting data", color: "text-text-muted", bg: "bg-border/50" },
  computing: { label: "Computing analytics...", color: "text-accent", bg: "bg-accent/10" },
  complete: { label: "Analytics up to date", color: "text-positive", bg: "bg-positive/10" },
  failed: { label: "Computation failed", color: "text-negative", bg: "bg-negative/10" },
};

export function ComputeStatus({ status, error }: ComputeStatusProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div className={cn("rounded-lg px-4 py-3", config.bg)}>
      <div className="flex items-center gap-2">
        {status === "computing" && (
          <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
        )}
        <span className={cn("text-sm font-medium", config.color)}>
          {config.label}
        </span>
      </div>
      {status === "failed" && error && (
        <p className="text-xs text-text-muted mt-1">{error}</p>
      )}
    </div>
  );
}
