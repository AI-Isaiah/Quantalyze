"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";

interface WatchlistTabsProps {
  scope: "all" | "watchlist";
  onScopeChange: (scope: "all" | "watchlist") => void;
  count: number;
  /** Stable ID base from parent (e.g. React.useId()) — used to build tab DOM ids and aria-controls. */
  idBase: string;
  /** Element id of the tabpanel this tablist controls. */
  panelId: string;
}

/**
 * WatchlistTabs — the discovery All/My-Watchlist scope switch, consolidated onto
 * the canonical Radix-backed `Tabs` segmented primitive (Phase 50 / UI-03).
 *
 * 50-RESEARCH Pitfall 1 (the single highest-risk port in the phase): the tabpanel
 * this tablist controls is rendered OUTSIDE this component — in StrategyTable.tsx
 * as `<div id={panelId} role="tabpanel" aria-labelledby={`${idBase}-tab-${scope}`}>`.
 * Radix auto-generates its OWN trigger/content ids and wires aria-controls /
 * aria-labelledby between a Tabs.Trigger and a *descendant* Tabs.Content. There is
 * no descendant Tabs.Content here, so we PRESERVE the imperative id contract
 * (RESEARCH Q1 option (a), lowest blast radius — no StrategyTable.tsx edit):
 *   - each trigger carries an EXPLICIT id `${idBase}-tab-all` / `${idBase}-tab-watchlist`
 *     (the primitive spreads props last, so an explicit id wins over Radix's auto id);
 *   - each trigger carries an EXPLICIT aria-controls={panelId} (overriding Radix's
 *     auto aria-controls), so the external panel's aria-labelledby still resolves.
 *
 * Controlled via scope/onScopeChange (Radix value=scope + onValueChange).
 * activationMode defaults to "automatic" — arrow/Home/End move focus AND change
 * scope, matching the prior hand-rolled behavior. Radix supplies roving tabindex
 * (active trigger tabIndex=0, inactive -1) and the WAI-ARIA keyboard nav.
 */
export function WatchlistTabs({ scope, onScopeChange, count, idBase, panelId }: WatchlistTabsProps) {
  return (
    <Tabs
      value={scope}
      onValueChange={(v) => onScopeChange(v as "all" | "watchlist")}
    >
      <TabsList
        variant="segmented"
        aria-label="Strategy list scope"
        // loop={false} preserves the prior hand-rolled no-wrap-around behavior:
        // ArrowLeft on the first (All) tab and ArrowRight on the last (Watchlist)
        // tab are no-ops (Radix's roving-focus default loop=true would wrap). The
        // WatchlistTabs.test.tsx no-op cases pin this byte-faithfully.
        loop={false}
        // Match the prior segmented container chrome verbatim. The primitive's
        // segmented TabsList base ("inline-flex overflow-hidden rounded border
        // border-border") is equivalent to the prior wrapper.
      >
        <TabsTrigger
          value="all"
          variant="segmented"
          id={`${idBase}-tab-all`}
          aria-controls={panelId}
        >
          All
        </TabsTrigger>
        <TabsTrigger
          value="watchlist"
          variant="segmented"
          id={`${idBase}-tab-watchlist`}
          aria-controls={panelId}
          className="inline-flex items-center gap-2 border-l border-border"
        >
          My Watchlist
          {count > 0 && (
            <span
              data-testid="watchlist-count-badge"
              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-micro font-semibold text-white"
            >
              {count}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
