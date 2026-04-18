"use client";

type Value = "high" | "medium" | "low";

interface Props {
  label: string;
  helper: string;
  value: Value | null;
  onChange: (v: Value | null) => void;
  error?: string;
}

const OPTIONS: { value: Value; label: string }[] = [
  { value: "high", label: "High (AUM > $10M)" },
  { value: "medium", label: "Medium ($1M-$10M)" },
  { value: "low", label: "Low (<$1M)" },
];

/**
 * Liquidity preference — 3-segment radiogroup (D-05, UI-SPEC).
 * Clicking the currently-selected option clears the value (pass `null`)
 * so the Reset affordance is baked into the control itself.
 */
export function MandateSegmentedRadio({ label, helper, value, onChange, error }: Props) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-text-muted hover:text-text-primary transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          >
            Reset
          </button>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex rounded-md border border-border bg-surface overflow-hidden divide-x divide-border"
      >
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(active ? null : opt.value)}
              className={`px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/20 ${
                active
                  ? "bg-accent/10 text-accent font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-page"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-text-secondary">{helper}</p>
      {error && <p role="alert" className="text-xs text-negative">{error}</p>}
    </div>
  );
}
