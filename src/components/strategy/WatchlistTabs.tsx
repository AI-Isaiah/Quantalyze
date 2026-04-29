"use client";

import { useRef } from "react";

interface WatchlistTabsProps {
  scope: "all" | "watchlist";
  onScopeChange: (scope: "all" | "watchlist") => void;
  count: number;
  /** Stable ID base from parent (e.g. React.useId()) — used to build tab DOM ids and aria-controls. */
  idBase: string;
  /** Element id of the tabpanel this tablist controls. */
  panelId: string;
}

export function WatchlistTabs({ scope, onScopeChange, count, idBase, panelId }: WatchlistTabsProps) {
  const allRef = useRef<HTMLButtonElement>(null);
  const watchRef = useRef<HTMLButtonElement>(null);

  const handleKey = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    target: "all" | "watchlist",
  ) => {
    if (e.key === "Home") {
      e.preventDefault();
      allRef.current?.focus();
      onScopeChange("all");
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      watchRef.current?.focus();
      onScopeChange("watchlist");
      return;
    }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
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
        id={`${idBase}-tab-all`}
        type="button"
        role="tab"
        aria-selected={scope === "all"}
        aria-controls={panelId}
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
        id={`${idBase}-tab-watchlist`}
        type="button"
        role="tab"
        aria-selected={scope === "watchlist"}
        aria-controls={panelId}
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
