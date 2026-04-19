"use client";

interface Props<T extends string> {
  label: string;
  helper: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
  /** "accent" for prefer-style multi-selects; "negative" for exclusion-style (excluded exchanges). */
  variant: "accent" | "negative";
  onReset?: () => void;
  error?: string;
}

/**
 * Reusable chip multi-select for `preferred_strategy_types` (accent — green,
 * a positive preference), `excluded_exchanges` (negative — red, an exclusion),
 * and `style_exclusions` (negative — red, same semantic category as
 * excluded_exchanges). Exclusion fields use the negative variant so the
 * color reinforces the semantics at a glance.
 * Uses `role="checkbox" aria-checked` for proper a11y (NOT native
 * `<input type="checkbox">` inside a `<label>`).
 */
export function MandateChipGroup<T extends string>({
  label,
  helper,
  options,
  selected,
  onToggle,
  variant,
  onReset,
  error,
}: Props<T>) {
  const activeClass =
    variant === "negative"
      ? "border-negative bg-negative/10 text-negative"
      : "border-accent bg-accent/10 text-accent";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {selected.length > 0 && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-text-muted hover:text-text-primary transition-colors rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              role="checkbox"
              aria-checked={active}
              onClick={() => onToggle(value)}
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 ${
                active
                  ? `${activeClass} font-medium`
                  : "border-border bg-surface text-text-secondary hover:border-border-focus hover:text-text-primary"
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-text-secondary">{helper}</p>
      {error && <p role="alert" className="text-xs text-negative">{error}</p>}
    </div>
  );
}
