import { cn } from "@/lib/utils";

interface ReturnsUnitChipProps {
  /**
   * The strategy's returns unit (`payload.returnsUnit`). `null` is the USD
   * family and renders nothing.
   */
  unit: string | null;
  className?: string;
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
export function ReturnsUnitChip({ unit, className }: ReturnsUnitChipProps) {
  if (unit == null) return null;
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
