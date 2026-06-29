import type { ReactNode, Ref } from "react";

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
  className,
  scrollRef,
}: {
  children: ReactNode;
  hint?: string;
  label?: string;
  /**
   * Extra classes merged onto the scroll region. Phase 50 / STATE-03 uses this
   * to make the region the `@container` containment context for the
   * StrategyTable priority-collapse, so the single scroll box is also the
   * query container (no second wrapper, no double scroll).
   */
  className?: string;
  /**
   * Optional ref to the underlying scroll `<div>`. STATE-03's visible scroll
   * cue measures `scrollWidth > clientWidth` on this exact box (the one that
   * actually scrolls), so the cue and the region aria-label describe the SAME
   * affordance. Additive — existing callers ignore it.
   */
  scrollRef?: Ref<HTMLDivElement>;
}) {
  const accessibleName = hint ?? (label ? `${label}: ${DEFAULT_HINT}` : DEFAULT_HINT);
  return (
    <div
      ref={scrollRef}
      className={["overflow-x-auto", className].filter(Boolean).join(" ")}
      role="region"
      aria-label={accessibleName}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
