"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { PortfolioAlert } from "@/lib/types";

interface AlertsListProps {
  alerts: PortfolioAlert[];
}

const severityStyles: Record<PortfolioAlert["severity"], string> = {
  high: "bg-negative/10 text-negative",
  medium: "bg-badge-market-neutral/10 text-badge-market-neutral",
  low: "bg-accent/10 text-accent",
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AlertsList({ alerts }: AlertsListProps) {
  const router = useRouter();
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDismiss(alertId: string) {
    setDismissingId(alertId);
    setError(null);

    const res = await fetch("/api/portfolio-alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_id: alertId }),
    });

    if (!res.ok) {
      setError("Failed to dismiss alert.");
      setDismissingId(null);
      return;
    }

    setDismissingId(null);
    router.refresh();
  }

  if (alerts.length === 0) {
    return (
      <Card className="text-center py-8">
        <p className="text-sm text-text-muted">No active alerts</p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-negative">{error}</p>}
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <span
            className={cn(
              "inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium",
              severityStyles[alert.severity] ?? severityStyles.low,
            )}
          >
            {alert.severity}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-secondary">{alert.message}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {formatTimestamp(alert.triggered_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleDismiss(alert.id)}
            disabled={dismissingId === alert.id}
            className="text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50 disabled:pointer-events-none"
          >
            {dismissingId === alert.id ? "Dismissing..." : "Dismiss"}
          </button>
        </div>
      ))}
    </div>
  );
}
