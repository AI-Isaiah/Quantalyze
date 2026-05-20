"use client";

import { usePayload, useComparator } from "./factsheet-context";
import { trackFactsheetEvent } from "./factsheet-analytics";

// The "none" state is reachable by clicking the active comparator chip a
// second time — toggle-off semantics. An explicit "None" radio used to live
// here, but it framed "no benchmark" as a peer option rather than the
// natural absence of one, and visually crowded the bar.
const KEYS = ["btc", "spx"] as const;

const LABELS: Record<(typeof KEYS)[number], string> = {
  btc: "BTC",
  spx: "SPX",
};

export function ComparatorPicker() {
  const payload = usePayload();
  const { comparator, setComparator } = useComparator();
  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-label="Comparator"
    >
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
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
              "px-2.5 py-1 pointer-coarse:px-4 pointer-coarse:min-h-[44px] inline-flex items-center text-[10px] font-mono uppercase tracking-wider rounded-sm border transition-colors " +
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
  );
}
