import { cn, formatAbsoluteDate } from "@/lib/utils";
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
  /**
   * Opt-in, pill arm only: after the freshness word, a `·` and the day the
   * timestamp falls on ("Batch: Fresh · Oct 6"). Set by the recommendations
   * batch chip so it names WHICH batch it is. An absent or unparseable
   * timestamp shows no date at all, never "Invalid Date". Every other caller
   * leaves it off and renders as before.
   */
  showDate?: boolean;
  className?: string;
}

/** The instant `computedAt` names, read the way `computeFreshness` reads it. */
function toTimestamp(
  computedAt: Date | string | number | null | undefined,
): number {
  if (computedAt == null) return NaN;
  if (computedAt instanceof Date) return computedAt.getTime();
  if (typeof computedAt === "number") return computedAt;
  return Date.parse(computedAt);
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
  showDate = false,
  className,
}: FreshnessBadgeProps) {
  const freshness: Freshness = computeFreshness(computedAt);
  const colors = FRESHNESS_COLORS[freshness];
  const title = freshnessTooltip(freshness);
  const ts = toTimestamp(computedAt);
  // formatAbsoluteDate prints the literal "Invalid Date" for a bad input, so
  // the finite check has to come first.
  const date =
    showDate && Number.isFinite(ts)
      ? formatAbsoluteDate(new Date(ts).toISOString())
      : null;

  if (variant === "dot") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-fixed-11 text-text-muted",
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
        "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-0.5 text-fixed-11 font-medium",
        colors.badge,
        className,
      )}
      title={title}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors.dot)} />
      {label ? <span>{label}:</span> : null}
      <span>{freshnessLabel(freshness)}</span>
      {date ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-metric">{date}</span>
        </>
      ) : null}
    </span>
  );
}
