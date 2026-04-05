import { Badge } from "@/components/ui/Badge";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

function StaleIndicator({ computedAt }: { computedAt: string }) {
  const hours = (Date.now() - new Date(computedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return null;

  const isRed = hours >= 48;
  const label = isRed
    ? `Data stale (${Math.floor(hours / 24)}d ago)`
    : `Last synced ${Math.floor(hours)}h ago`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
        isRed
          ? "bg-negative/10 text-negative"
          : "bg-badge-market-neutral/10 text-badge-market-neutral"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isRed ? "bg-negative" : "bg-badge-market-neutral"}`} />
      {label}
    </span>
  );
}

export function StrategyHeader({
  strategy,
  computedAt,
}: {
  strategy: Strategy;
  computedAt?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-[32px] font-bold tracking-tight text-text-primary">
          {strategy.name}
        </h1>
        <Badge label={strategy.status} type="status" />
        {computedAt && <StaleIndicator computedAt={computedAt} />}
      </div>
      {strategy.start_date && (
        <p className="text-sm text-text-muted">
          Live since {strategy.start_date}
        </p>
      )}
    </div>
  );
}
