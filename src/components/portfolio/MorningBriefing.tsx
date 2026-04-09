import { cn } from "@/lib/utils";

/**
 * `<MorningBriefing>` — auto-generated narrative summary from
 * `analytics.narrative_summary`. Shared between /demo (small dek style) and
 * /portfolios/[id] (full card with header).
 *
 * Hard cap of `maxChars` characters with a "Read more" expand toggle would
 * require client state. v1 is a CSS line-clamp at 3 lines (DM Sans, 14px).
 * If the persisted narrative is longer, the line-clamp truncates visually
 * but the full text remains in the DOM for screen readers.
 */

export interface MorningBriefingProps {
  narrative: string | null | undefined;
  /** When `dek`, render as a small text dek without a header (used on /demo). */
  variant?: "card" | "dek";
  /** Pass-through className for layout. */
  className?: string;
}

const CARD_CLASS =
  "rounded-xl border border-border bg-surface p-6 shadow-card";

const DEK_CLASS = "max-w-3xl";

export function MorningBriefing({
  narrative,
  variant = "card",
  className,
}: MorningBriefingProps) {
  if (!narrative) return null;

  if (variant === "dek") {
    return (
      <p
        className={cn(
          "text-sm sm:text-base text-text-secondary leading-relaxed line-clamp-3",
          DEK_CLASS,
          className,
        )}
      >
        {narrative}
      </p>
    );
  }

  return (
    <section
      aria-labelledby="morning-briefing-title"
      className={cn(CARD_CLASS, className)}
    >
      <h2
        id="morning-briefing-title"
        className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2"
      >
        Morning Briefing
      </h2>
      <p className="text-sm text-text-secondary leading-relaxed">{narrative}</p>
    </section>
  );
}
