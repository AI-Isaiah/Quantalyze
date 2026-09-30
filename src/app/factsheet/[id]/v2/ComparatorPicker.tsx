"use client";

import { usePayload, useComparator } from "./factsheet-context";
import { trackFactsheetEvent } from "./factsheet-analytics";
import { isoToMonthDay } from "./MetricsColumn";

// The "none" state is reachable by clicking the active comparator chip a
// second time — toggle-off semantics. An explicit "None" radio used to live
// here, but it framed "no benchmark" as a peer option rather than the
// natural absence of one, and visually crowded the bar.
const KEYS = ["btc", "spx"] as const;

const LABELS: Record<(typeof KEYS)[number], string> = {
  btc: "BTC",
  spx: "SPX",
};

/**
 * Phase 169.5 (SC3, 169 D-09 / D-21 / D-52) — the active comparator's coverage in
 * words. A block whose `through` (its last real close on or before the strategy's
 * last date) is earlier than that date is dated, so an em-dash window or a chart
 * line that stops short reads as missing prices, not a flat market. `through: null`
 * is the unavailable form (a failed BTC read) and says so. An ABSENT `through` (a
 * hand-built block, D-21) and full coverage render nothing. The comparison is the
 * ISO-string one `buildComparatorBlock` uses for its `pastThrough` windows.
 */
function coverageCaption(
  label: string,
  through: string | null | undefined,
  lastDate: string | undefined,
): string | null {
  if (through === undefined) return null;
  if (through === null) return `${label} prices unavailable`;
  if (lastDate !== undefined && through < lastDate) {
    return `${label} prices through ${isoToMonthDay(through)}`;
  }
  return null;
}

export function ComparatorPicker() {
  const payload = usePayload();
  const { comparator, setComparator } = useComparator();
  const caption =
    comparator === "none"
      ? null
      : coverageCaption(
          LABELS[comparator],
          payload.comparators[comparator].through,
          payload.dates[payload.dates.length - 1],
        );
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label="Comparator"
      >
        <span className="text-micro font-mono uppercase tracking-wider text-text-muted">
          Compare to
        </span>
        {KEYS.map(key => {
          const active = key === comparator;
          const block = payload.comparators[key];
          // Toggle-off: clicking the active chip clears the comparator. This
          // is a "selected/not-selected" toggle (aria-pressed), not a radio:
          // the empty selection IS a valid state, not a missing one.
          const next = active ? "none" : key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                if (next !== comparator) {
                  trackFactsheetEvent("factsheet_v2_comparator_swap", { from: comparator, to: next });
                }
                setComparator(next);
              }}
              className={
                // pointer-coarse: 44px tap target on touch devices (WCAG 2.5.5).
                "px-2.5 py-1 pointer-coarse:px-4 pointer-coarse:min-h-[44px] inline-flex items-center text-micro font-mono uppercase tracking-wider rounded-sm border transition-colors " +
                (active
                  ? "bg-accent text-white border-accent"
                  : "bg-surface-subtle text-text-2 border-border hover:bg-surface")
              }
              title={active ? `Clear ${block.name}` : block.name}
            >
              {LABELS[key]}
            </button>
          );
        })}
      </div>
      {caption !== null && (
        <p className="text-micro font-mono uppercase tracking-wider text-text-muted">
          {caption}
        </p>
      )}
    </div>
  );
}
