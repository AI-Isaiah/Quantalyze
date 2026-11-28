import { cn } from "@/lib/utils";
import {
  parseUnitSwitch,
  composeUnitSwitchSentence,
  unitSwitchChipText,
  unitSwitchChipTitle,
} from "@/lib/factsheet/unit-segments";

interface UnitSwitchChipProps {
  /** The list row's three enumerated `unit_switch_*` scalars (`shapeRowAnalytics`). */
  coin: string | null | undefined;
  lastUsdDay: string | null | undefined;
  firstCoinDay: string | null | undefined;
  className?: string;
}

/**
 * Phase 256 plan 08 (D-05, UI-SPEC D) - says, in the strategy list's type-badge row, that this
 * strategy's record is USD up to a day and a coin from the next, so a USD figure beside a BTC-part
 * record is never read as plain USD.
 *
 * Classes are byte-equal to the compact `ReturnsUnitChip` (neutral `bg-track`, secondary text, no
 * accent, no amber: a switch is a fact, not a warning). Visible text is `USD, then BTC`; the full
 * sentence is in an `sr-only` span and in `title`. Pure render, no hooks. The three scalars go
 * through `parseUnitSwitch`, so a missing or malformed one renders NOTHING (zero nodes): a USD row's
 * DOM is unchanged and a sentence with a guessed day never exists.
 */
export function UnitSwitchChip({ coin, lastUsdDay, firstCoinDay, className }: UnitSwitchChipProps) {
  const sw = parseUnitSwitch({
    coin,
    last_usd_day: lastUsdDay,
    first_coin_return_day: firstCoinDay,
  });
  if (sw === null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide whitespace-nowrap text-text-secondary bg-track",
        className,
      )}
      data-unit-switch={sw.toUnit}
      title={unitSwitchChipTitle(sw)}
    >
      <span className="sr-only">{`${composeUnitSwitchSentence(sw)}. `}</span>
      <span aria-hidden="true">{unitSwitchChipText(sw)}</span>
    </span>
  );
}
