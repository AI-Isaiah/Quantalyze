import { computeHealthScore, healthScoreColor, healthScoreBg } from "@/lib/health-score";
import { cn } from "@/lib/utils";
import type { StrategyAnalytics } from "@/lib/types";

interface HealthScoreProps {
  analytics: StrategyAnalytics;
  startDate: string | null;
  className?: string;
}

export function HealthScore({ analytics, startDate, className }: HealthScoreProps) {
  const score = computeHealthScore(analytics, startDate);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        healthScoreBg(score),
        healthScoreColor(score),
        className,
      )}
      title={`Health score: ${score}/100`}
    >
      {score}
    </span>
  );
}
