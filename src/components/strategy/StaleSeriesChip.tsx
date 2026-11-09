import { formatIsoDay } from "@/lib/utils";
import type { ListSeriesVerdict } from "@/lib/freshness";

// Phase 149 Delta 4 — the 147 chip BASE, copied VERBATIM from
// CoverageStateChip.tsx:58 (tokens, not the component: importing an
// allocations-scoped component into the shared discovery table would drag a
// second chip vocabulary onto /discovery). `rounded-sm` (4px) is DELIBERATE
// against the adjacent status Badge's `rounded-md` (6px): the two chip
// families encode different semantics (publication status vs data state) and
// both radii are established DESIGN.md ladder members. Do NOT harmonize.
//
// Phase 197 plan 03 — moved here unchanged from StrategyTable.tsx because the
// grid needs the same chip and StrategyGrid.tsx cannot import from
// StrategyTable.tsx (StrategyTable imports StrategyGrid: an import cycle).
export const DATA_STATE_CHIP =
  "inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide";

/**
 * Phase 197 / CLAR-02 (D-03, UI-SPEC U-03, U-08) - the amber chip on a row whose newest
 * return day is older than its threshold, or unreadable.
 *
 * AMBER, NOT RED AND NOT MUTED (U-03): a stale record is recoverable (the next successful sync
 * clears it) and must be seen. Red would call it a permanent failure, muted would hide it. The
 * pairing is the one the owner "Syncing" chip uses.
 *
 * The copy interpolates `thresholdDays` (read from `listSeriesVerdict`, never restated here), so
 * moving a threshold moves its sentence. A current verdict renders nothing.
 */
export function StaleSeriesChip({
  verdict,
  seriesEnd,
  ageDays,
  thresholdDays,
}: {
  verdict: ListSeriesVerdict;
  seriesEnd: string | null | undefined;
  ageDays: number | null;
  thresholdDays: number;
}) {
  if (verdict === "current") return null;
  const tone = `${DATA_STATE_CHIP} whitespace-nowrap text-warning bg-warning-bg border border-warning-border`;
  if (verdict === "unknown") {
    return (
      <span
        title="The newest return day could not be read, so this strategy is listed after current ones."
        className={tone}
      >
        Data date unknown
      </span>
    );
  }
  return (
    <span
      title={`The newest return day is ${ageDays} days old. Strategies with data older than ${thresholdDays} days are listed after current ones.`}
      className={tone}
    >
      {`Data from ${formatIsoDay(seriesEnd)}`}
    </span>
  );
}

/**
 * The rank cell's reason for an em dash on a displayed row that is not current, used as both its
 * `title` and its sr-only text (a screen reader gets the same sentence a hover does). A current
 * row has no reason: it has an ordinal.
 */
export function notRankedReason(
  verdict: ListSeriesVerdict,
  thresholdDays: number,
): string | null {
  if (verdict === "stale") {
    return `Not ranked: the data is more than ${thresholdDays} days old.`;
  }
  if (verdict === "unknown") {
    return "Not ranked: the data date could not be read.";
  }
  return null;
}
