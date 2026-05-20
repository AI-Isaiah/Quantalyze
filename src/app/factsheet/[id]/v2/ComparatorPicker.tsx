"use client";

import { usePayload, useComparator } from "./factsheet-context";
import { trackFactsheetEvent } from "./factsheet-analytics";

const KEYS = ["btc", "spx", "none"] as const;

const LABELS: Record<(typeof KEYS)[number], string> = {
  btc: "BTC",
  spx: "SPX",
  none: "None",
};

export function ComparatorPicker() {
  const payload = usePayload();
  const { comparator, setComparator } = useComparator();
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label="Comparator">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
        Compare to
      </span>
      {KEYS.map(key => {
        const active = key === comparator;
        const block = payload.comparators[key];
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (key !== comparator) {
                trackFactsheetEvent("factsheet_v2_comparator_swap", { from: comparator, to: key });
              }
              setComparator(key);
            }}
            className={
              // pointer-coarse: 44px tap target on touch devices (WCAG 2.5.5).
              "px-2.5 py-1 pointer-coarse:px-4 pointer-coarse:min-h-[44px] inline-flex items-center text-[10px] font-mono uppercase tracking-wider rounded-sm border transition-colors " +
              (active
                ? "bg-accent text-white border-accent"
                : "bg-surface-subtle text-text-2 border-border hover:bg-surface")
            }
            title={block.name}
          >
            {LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
