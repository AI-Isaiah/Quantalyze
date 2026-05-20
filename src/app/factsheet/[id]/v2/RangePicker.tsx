"use client";

import { useFactsheet } from "./factsheet-context";

const OPTIONS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 91 },
  { label: "6M", days: 182 },
  { label: "YTD", days: -1 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "MAX", days: 0 },
] as const;

/**
 * Range-snap buttons sharing the FactsheetContext xRange. The mockup's
 * equivalent uses ISO date math; here the date list is index-aligned so
 * we walk it from the right to find the threshold.
 */
export function RangePicker() {
  const { payload, xRange, setXRange, resetXRange } = useFactsheet();
  const dates = payload.dates;
  const lastIdx = dates.length - 1;
  if (lastIdx < 1) return null;
  const lastDate = dates[lastIdx];
  const lastYear = lastDate.slice(0, 4);

  const targetStartForDays = (days: number): number => {
    if (days <= 0) return 0;
    const last = new Date(lastDate);
    const cutoff = new Date(last);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    for (let i = lastIdx; i >= 0; i--) {
      if (dates[i] <= cutoffIso) return i;
    }
    return 0;
  };

  const targetStartForYtd = (): number => {
    const cutoff = `${lastYear}-01-01`;
    for (let i = lastIdx; i >= 0; i--) {
      if (dates[i] < cutoff) return Math.min(lastIdx, i + 1);
    }
    return 0;
  };

  // Precompute the resolved start indices once. Multiple options can collapse
  // to start=0 for short-history strategies (e.g., 3Y == MAX when the strategy
  // has only 2 years of data). Highlighting "active" then ambiguates between
  // them; prefer the LATEST matching option in OPTIONS order so MAX wins when
  // it would render the same view as 3Y.
  const resolved = OPTIONS.map(opt =>
    opt.days === 0 ? 0 : opt.days === -1 ? targetStartForYtd() : targetStartForDays(opt.days),
  );
  const isFullRange = xRange[0] === 0 && xRange[1] === lastIdx;
  const activeIdx = (() => {
    if (isFullRange) return resolved.length - 1; // always MAX when fully open
    for (let i = 0; i < resolved.length; i++) {
      if (xRange[0] === resolved[i] && xRange[1] === lastIdx) return i;
    }
    return -1;
  })();

  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Time range">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted mr-1">Range</span>
      {OPTIONS.map((opt, i) => {
        const start = resolved[i];
        const active = i === activeIdx;
        const onClick = () => {
          if (opt.days === 0) resetXRange();
          else setXRange([start, lastIdx]);
        };
        return (
          <button
            key={opt.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            className={
              "px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm border " +
              (active
                ? "bg-accent text-white border-accent"
                : "bg-surface-subtle text-text-2 border-border hover:bg-surface")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
