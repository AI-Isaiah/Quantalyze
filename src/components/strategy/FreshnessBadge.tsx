import { cn } from "@/lib/utils";
import {
  computeFreshness,
  freshnessLabel,
  freshnessTooltip,
  FRESHNESS_COLORS,
  type Freshness,
} from "@/lib/freshness";

interface FreshnessBadgeProps {
  /** ISO timestamp, Date, or null. Null is treated as stale. */
  computedAt: Date | string | number | null | undefined;
  /** Optional prefix label, e.g. "Analytics" or "Portfolio data". */
  label?: string;
  /** Compact mode renders a dot + short word ("Fresh"), otherwise a pill badge. */
  variant?: "pill" | "dot";
  className?: string;
}

/**
 * Shared freshness badge used on strategy detail, factsheet, tear sheet, and
 * portfolio dashboard. Sources its thresholds from `lib/freshness.ts` so every
 * surface agrees on what "stale" means.
 */
export function FreshnessBadge({
  computedAt,
  label,
  variant = "pill",
  className,
}: FreshnessBadgeProps) {
  const freshness: Freshness = computeFreshness(computedAt);
  const colors = FRESHNESS_COLORS[freshness];
  const title = freshnessTooltip(freshness);

  if (variant === "dot") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] text-text-muted",
          className,
        )}
        title={title}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors.dot)} />
        {label ? (
          <span className="font-medium text-text-secondary">{label}:</span>
        ) : null}
        <span>{freshnessLabel(freshness)}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        colors.badge,
        className,
      )}
      title={title}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors.dot)} />
      {label ? <span>{label}:</span> : null}
      <span>{freshnessLabel(freshness)}</span>
    </span>
  );
}
