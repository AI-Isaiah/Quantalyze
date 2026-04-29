"use client";

interface SegmentedOption {
  id: string;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps {
  options: SegmentedOption[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

/**
 * Panel 2 segmented control.
 *
 * Button-group with disabled-state support. Disabled buttons render
 * `aria-disabled="true"` (NOT the native `disabled` attribute — keeps them
 * focusable for screen-reader announcement of the "coming-soon" tooltip)
 * and short-circuit click handlers via `e.preventDefault()`.
 *
 * Active button: 1px accent border + accent-color label
 * (bg-card border border-accent text-accent).
 * Inactive button: muted border + secondary text.
 *
 * Type contract honored: only the 2-weight subset (regular / semibold) and
 * the 12px size class. Forbidden weights and sizes are absent by design.
 */
export function SegmentedControl({
  options,
  activeId,
  onChange,
  ariaLabel,
}: SegmentedControlProps) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-2">
      {options.map((opt) => {
        if (opt.disabled) {
          return (
            <button
              key={opt.id}
              type="button"
              aria-disabled="true"
              title="Coming soon"
              onClick={(e) => e.preventDefault()}
              className="cursor-not-allowed rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-normal text-text-muted opacity-60"
            >
              {opt.label}
            </button>
          );
        }
        const isActive = opt.id === activeId;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.id)}
            className={
              isActive
                ? "rounded-md border border-accent bg-surface px-3 py-1.5 text-xs font-semibold text-accent"
                : "rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-normal text-text-secondary"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
