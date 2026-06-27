import type { ReactNode } from "react";

/** Default scroll affordance copy when the caller does not supply one. */
const DEFAULT_HINT =
  "Table scrolls horizontally. Swipe or use arrow keys to see more columns.";

/**
 * Wraps an arbitrary table in a horizontally-scrollable, focusable region and
 * announces the scroll affordance to screen-reader users via an `sr-only` hint.
 *
 * This adds ONLY the scroll affordance — it does not restyle the wrapped table
 * (no border / row-height changes; tables are already ~44px touch-compliant per
 * DESIGN.md §Spacing). Column reshape is phase 46 / TABLE-01.
 *
 * The hint is a static visually-hidden string (NOT a `role="status"` /
 * `aria-live` region — it describes a persistent affordance, not a state
 * change). When `hint` is provided it overrides both the aria-label and the
 * sr-only text; otherwise {@link DEFAULT_HINT} is used.
 */
export function ResponsiveTable({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  const label = hint ?? DEFAULT_HINT;
  return (
    <div className="overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
