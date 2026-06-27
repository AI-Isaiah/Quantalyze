import type { ReactNode } from "react";

/** Default scroll affordance copy when the caller does not supply one. */
const DEFAULT_HINT =
  "Table scrolls horizontally. Swipe or use arrow keys to see more columns.";

/**
 * Wraps an arbitrary table in a horizontally-scrollable, focusable region whose
 * accessible name announces the scroll affordance to screen-reader users.
 *
 * This adds ONLY the scroll affordance — it does not restyle the wrapped table
 * (no border / row-height changes; tables are already ~44px touch-compliant per
 * DESIGN.md §Spacing). Column reshape is phase 46 / TABLE-01.
 *
 * The affordance is the region's `aria-label` (its accessible name), announced
 * once when a keyboard/SR user focuses the region. It is deliberately NOT a
 * `role="status"` / `aria-live` region (it describes a persistent affordance,
 * not a state change) and NOT a separate `sr-only` node — pairing aria-label
 * with an identical visually-hidden child double-announces the hint (once as the
 * region name, once as in-region content).
 *
 * Accessible-name precedence: an explicit `hint` (full override) wins; otherwise
 * `label` (the table's name) prefixes {@link DEFAULT_HINT}; otherwise the bare
 * default is used. A page that renders more than one ResponsiveTable MUST pass a
 * distinct `label` so the region landmarks have UNIQUE accessible names — axe
 * `landmark-unique`, and, more importantly, so a screen-reader's landmark rotor
 * does not show N indistinguishable "Table scrolls horizontally…" regions (the
 * /allocations holdings tab co-renders Strategies + Holdings + Open positions).
 */
export function ResponsiveTable({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: string;
  label?: string;
}) {
  const accessibleName = hint ?? (label ? `${label}: ${DEFAULT_HINT}` : DEFAULT_HINT);
  return (
    <div className="overflow-x-auto" role="region" aria-label={accessibleName} tabIndex={0}>
      {children}
    </div>
  );
}
