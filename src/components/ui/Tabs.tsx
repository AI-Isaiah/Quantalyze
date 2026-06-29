"use client";

/**
 * Tabs — the canonical Radix-backed tab primitive (Phase 50 / UI-02 / UI-04).
 *
 * This is the ONLY Radix-backed primitive in the toolkit (no native HTML tab
 * widget exists). It is a thin `"use client"` styled wrapper over
 * `@radix-ui/react-tabs` that re-exports Root/List/Content unchanged and wraps
 * Trigger with the DESIGN.md visual contract pre-applied via the Radix
 * `data-[state=active]` styling hook (NOT `aria-selected`, which Radix manages
 * for a11y). Radix supplies the WAI-ARIA Tabs behavior — `role="tab"`/
 * `role="tabpanel"`, roving tabindex, arrow/Home/End keyboard nav, and the
 * `aria-controls`/`aria-labelledby` wiring — so this file only owns styling +
 * the variant/id passthrough the 3 existing consumers (consolidated in Wave 2)
 * need to map onto it 1:1.
 *
 * Two variants (50-UI-SPEC §Tabs):
 *   - "underline"  — AdminTabs / ProfileTabs strip (accent text + 2px accent
 *     bottom-border on the active trigger).
 *   - "segmented"  — WatchlistTabs control (`bg-accent/10 text-accent` active
 *     cell inside an `inline-flex border rounded` container).
 *
 * `activationMode` defaults to Radix's `"automatic"` (selection follows focus) —
 * the locked behavior for all 3 consumers. `value`/`defaultValue`/
 * `onValueChange` pass straight through Root so consumers stay controlled
 * (ProfileTabs `?tab=` derive-each-render) or uncontrolled (AdminTabs).
 *
 * CRITICAL (50-RESEARCH Pitfall 1): an explicit `id` on a Trigger wins over
 * Radix's auto-generated id, so WatchlistTabs can preserve the
 * `idBase`-derived trigger ids that the external StrategyTable `role="tabpanel"`
 * resolves via `aria-labelledby`.
 */

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export type TabsVariant = "underline" | "segmented";

/** Tabs.Root — passes value/defaultValue/onValueChange/activationMode through. */
export const Tabs = TabsPrimitive.Root;

/**
 * TabsList (role="tablist"). The underline variant draws the strip's bottom
 * hairline; the segmented variant is the bordered, rounded, clipped container.
 * Consumers may override per-consumer chrome via `className`.
 */
export function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.List
      className={cn(
        variant === "underline"
          ? "flex gap-1 border-b border-border"
          : "inline-flex overflow-hidden rounded border border-border",
        className,
      )}
      {...props}
    />
  );
}

/**
 * TabsTrigger (role="tab"). Styling keys off `data-[state=active]` (Radix's
 * hook), never `aria-selected`. An explicit `id` passed by a consumer wins over
 * Radix's auto id (spread last). `text-small`/`text-micro` tiers — no bare
 * `text-sm`/`text-xs`.
 */
export function TabsTrigger({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
  variant?: TabsVariant;
}) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "text-small font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        variant === "underline"
          ? cn(
              "-mb-px border-b-2 border-transparent px-4 py-2 text-text-muted",
              "hover:text-text-primary",
              "data-[state=active]:border-accent data-[state=active]:text-accent",
            )
          : cn(
              "h-9 px-3 text-text-secondary",
              "hover:bg-page",
              "data-[state=active]:bg-accent/10 data-[state=active]:text-accent",
            ),
        className,
      )}
      {...props}
    />
  );
}

/** TabsContent (role="tabpanel"). Radix renders only the active panel. */
export const TabsContent = TabsPrimitive.Content;
