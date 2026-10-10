import { cn } from "@/lib/utils";
import { unitTag } from "@/lib/factsheet/returns-unit";

interface ReturnsUnitChipProps {
  /**
   * The strategy's returns unit (`payload.returnsUnit`). `null` is the USD
   * family and renders nothing.
   */
  unit: string | null;
  className?: string;
  /**
   * `"masthead"` (default) is the long `Returns in BTC` chip beside the strategy
   * name. `"compact"` (Phase 164.6.6.2.1 D-05, UI-SPEC D) is the table-row chip:
   * visible `in BTC`, with `Returns ` carried for screen readers only.
   */
  variant?: "masthead" | "compact";
}

/**
 * Phase 164.6.6.2 plan 05 (D-09, UI-SPEC "The unit chip") — says, beside the
 * strategy name, that this strategy's returns are measured in a native unit.
 *
 * Neutral grey, never amber: a denomination is a steady fact, not a warning
 * (D-08). Pure render, no hooks, so the factsheet masthead, the tear sheet and
 * the composer row can all use it. `null` returns `null` (zero nodes), so a USD
 * surface is byte-identical to the build before this chip existed.
 *
 * The DOM text is `Returns in BTC`; CSS uppercases it, tests match the DOM.
 */
export function ReturnsUnitChip({ unit, className, variant = "masthead" }: ReturnsUnitChipProps) {
  if (unit == null) return null;
  if (variant === "compact") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide whitespace-nowrap text-text-secondary bg-track",
          className,
        )}
        data-returns-unit={unit}
        title={`Returns on this row are in ${unit}, not USD.`}
      >
        <span className="sr-only">Returns </span>
        {unitTag(unit)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm bg-track px-2 py-0.5 text-micro font-mono uppercase tracking-[0.14em] text-text-secondary whitespace-nowrap",
        className,
      )}
      data-returns-unit={unit}
      title={`This account is denominated in ${unit}. Its returns, drawdowns and balances are measured in ${unit}, not USD.`}
    >
      {`Returns in ${unit}`}
    </span>
  );
}
