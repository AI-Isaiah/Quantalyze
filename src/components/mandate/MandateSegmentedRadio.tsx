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
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(active ? null : opt.value)}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-text-secondary hover:border-border-focus"
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
