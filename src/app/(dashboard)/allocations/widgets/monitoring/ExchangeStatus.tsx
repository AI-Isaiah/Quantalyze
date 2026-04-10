"use client";

import type { WidgetProps } from "../../lib/types";

interface ApiKeyRow {
  id: string;
  exchange: string;
  label: string;
  is_active: boolean;
  last_sync_at: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never synced";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isRecent(iso: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 3_600_000; // 1 hour
}

export function ExchangeStatus({ data }: WidgetProps) {
  const apiKeys: ApiKeyRow[] = data?.apiKeys ?? [];

  if (apiKeys.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: "#718096" }}>
          No exchange connections
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {apiKeys.map((key) => {
        const healthy = key.is_active && isRecent(key.last_sync_at);
        return (
          <div
            key={key.id}
            className="flex items-center gap-2.5 rounded px-2 py-1.5"
          >
            <span
              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: healthy ? "#16A34A" : "#DC2626" }}
              aria-label={healthy ? "Connected" : "Disconnected"}
            />
            <span
              className="text-sm font-medium flex-1 truncate"
              style={{ color: "#1A1A2E" }}
            >
              {key.exchange}
            </span>
            <span
              className="text-xs whitespace-nowrap"
              style={{ color: "#718096" }}
            >
              {timeAgo(key.last_sync_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
