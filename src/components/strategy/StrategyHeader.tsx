import { Badge } from "@/components/ui/Badge";
import { SyncBadge } from "./SyncBadge";
import type { Strategy } from "@/lib/types";

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
      </div>
      <div className="flex items-center gap-3">
        {computedAt && (
          <SyncBadge
            computedAt={computedAt}
            exchange={strategy.supported_exchanges?.[0]}
          />
        )}
        {strategy.start_date && (
          <span className="text-xs text-text-muted">
            Live since {strategy.start_date}
          </span>
        )}
      </div>
    </div>
  );
}
