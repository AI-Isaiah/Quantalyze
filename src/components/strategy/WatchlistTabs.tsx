"use client";

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — All / My Watchlist segmented control.
 *
 * Two-tab WAI-ARIA tablist that lives inside the StrategyFilters row,
 * left of the search input per UI-SPEC Layout Contract. Right tab carries
 * a count badge sourced from `watchedSet.size`; badge is hidden when zero
 * to avoid visual noise on a fresh allocator.
 *
 * Visual template: existing view-mode toggle at StrategyFilters.tsx:369
 * (1px border, 4px radius, accent fill on active). Badge style mirrors the
 * existing All-Filters chip at StrategyFilters.tsx:319 (now promoted to
 * text-[11px] font-semibold per UI-SPEC Typography "Micro-label exception").
 *
 * Keyboard: ArrowLeft/ArrowRight move focus between tabs (WAI-ARIA tablist
 * pattern). Tab itself enters/exits the group via aria-controls pointing
 * at "strategy-list" — the table/grid wrapper inside StrategyTable.
 */

import { useRef } from "react";

interface WatchlistTabsProps {
  scope: "all" | "watchlist";
  onScopeChange: (scope: "all" | "watchlist") => void;
  count: number;
}

export function WatchlistTabs({ scope, onScopeChange, count }: WatchlistTabsProps) {
  const allRef = useRef<HTMLButtonElement>(null);
  const watchRef = useRef<HTMLButtonElement>(null);

  // Automatic-activation tablist pattern (WAI-ARIA APG): ArrowLeft/ArrowRight
  // BOTH move focus AND change scope. Edge cases:
  //   - ArrowLeft from "All" is a no-op (no swap, no scope change)
  //   - ArrowRight from "watchlist" is a no-op (no wrap-around)
  const handleKey = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    target: "all" | "watchlist",
  ) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;

    // No-op edge cases
    if (target === "all" && e.key === "ArrowLeft") return;
    if (target === "watchlist" && e.key === "ArrowRight") return;

    e.preventDefault();
    const next: "all" | "watchlist" = target === "all" ? "watchlist" : "all";
    (next === "all" ? allRef : watchRef).current?.focus();
    onScopeChange(next);
  };

  return (
    <div
      role="tablist"
      aria-label="Strategy list scope"
      className="inline-flex border border-border rounded overflow-hidden"
    >
      <button
        ref={allRef}
        type="button"
        role="tab"
        aria-selected={scope === "all"}
        aria-controls="strategy-list"
        tabIndex={scope === "all" ? 0 : -1}
        onClick={() => onScopeChange("all")}
        onKeyDown={(e) => handleKey(e, "all")}
        className={`px-3 h-9 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          scope === "all"
            ? "bg-accent/10 text-accent"
            : "bg-surface text-text-secondary hover:bg-page"
        }`}
      >
        All
      </button>
      <button
        ref={watchRef}
        type="button"
        role="tab"
        aria-selected={scope === "watchlist"}
        aria-controls="strategy-list"
        tabIndex={scope === "watchlist" ? 0 : -1}
        onClick={() => onScopeChange("watchlist")}
        onKeyDown={(e) => handleKey(e, "watchlist")}
        className={`px-3 h-9 text-sm transition-colors inline-flex items-center gap-2 border-l border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          scope === "watchlist"
            ? "bg-accent/10 text-accent"
            : "bg-surface text-text-secondary hover:bg-page"
        }`}
      >
        My Watchlist
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[11px] font-semibold">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
