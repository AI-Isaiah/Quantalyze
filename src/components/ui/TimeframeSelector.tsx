"use client";

export const TIMEFRAMES = [
  { key: "1DTD", label: "1D" },
  { key: "1WTD", label: "1W" },
  { key: "1MTD", label: "1M" },
  { key: "1QTD", label: "1Q" },
  { key: "1YTD", label: "YTD" },
  { key: "3YTD", label: "3Y" },
  { key: "ALL", label: "All" },
] as const;

export type TimeframeKey = (typeof TIMEFRAMES)[number]["key"];

export function TimeframeSelector({
  value,
  onChange,
}: {
  value: TimeframeKey;
  onChange: (next: TimeframeKey) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Timeframe"
      className="inline-flex items-center rounded-lg border border-border bg-surface p-0.5 gap-0.5"
    >
      {TIMEFRAMES.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`px-2.5 py-1 text-xs font-medium tabular-nums rounded-md transition-colors ${
              active
                ? "bg-accent text-white"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
