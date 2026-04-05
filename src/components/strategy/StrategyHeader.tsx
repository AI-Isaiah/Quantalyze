import { Badge } from "@/components/ui/Badge";
import type { Strategy } from "@/lib/types";

export function StrategyHeader({ strategy }: { strategy: Strategy }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-[32px] font-bold tracking-tight text-text-primary">
          {strategy.name}
        </h1>
        <Badge label={strategy.status.toUpperCase()} type="status" />
      </div>
      {strategy.start_date && (
        <p className="text-sm text-text-muted">
          Live since {strategy.start_date}
        </p>
      )}
    </div>
  );
}
