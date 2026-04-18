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
 * Reusable chip multi-select for `preferred_strategy_types` (accent),
 * `excluded_exchanges` (negative — red), and `style_exclusions` (accent).
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
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
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
              className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? activeClass
                  : "border-border bg-surface text-text-secondary hover:border-border-focus"
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
