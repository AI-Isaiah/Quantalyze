import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { Strategy } from "@/lib/types";

interface StrategyHeaderProps {
  strategy: Strategy;
  onRequestIntro?: () => void;
}

export function StrategyHeader({ strategy, onRequestIntro }: StrategyHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
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
      {onRequestIntro && (
        <Button onClick={onRequestIntro}>Request Intro</Button>
      )}
    </div>
  );
}
