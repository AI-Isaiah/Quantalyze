import { cn } from "@/lib/utils";

interface SyncBadgeProps {
  computedAt: string | null;
  exchange?: string | null;
  className?: string;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function freshnessColor(date: Date): string {
  const hours = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  if (hours < 24) return "bg-positive";
  if (hours < 48) return "bg-yellow-400";
  return "bg-negative";
}

const EXCHANGE_LABELS: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
};

export function SyncBadge({ computedAt, exchange, className }: SyncBadgeProps) {
  if (!computedAt) return null;

  const date = new Date(computedAt);
  const dotColor = freshnessColor(date);
  const exchangeLabel = exchange
    ? EXCHANGE_LABELS[exchange.toLowerCase()] ?? exchange
    : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] text-text-muted",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
      {exchangeLabel && (
        <span className="font-medium text-text-secondary">{exchangeLabel}</span>
      )}
      <span>Synced {timeAgo(date)}</span>
    </span>
  );
}
