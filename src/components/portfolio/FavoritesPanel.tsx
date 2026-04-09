"use client";

import { useMemo, useState } from "react";
import { formatPercent, formatNumber } from "@/lib/utils";
import { SaveAsTestModal } from "@/components/portfolio/SaveAsTestModal";
import type { StrategyForBuilder } from "@/lib/scenario";

/**
 * Favorites panel — the watchlist slide-out on the My Allocation page.
 *
 * Lets the allocator toggle favorite strategies on/off to overlay a
 * hypothetical "+ Favorites" curve on the real portfolio chart. The
 * chart overlay math is computed by the parent (it has the real
 * portfolio strategies + weights + inception date); this component
 * owns only the UI state (which favorites are toggled) and the save
 * flow (SaveAsTestModal).
 *
 * The parent passes the full list of favorites as StrategyForBuilder[]
 * shapes (so the toggle state directly drives `computeFavoritesOverlayCurve`
 * in @/lib/scenario). When a toggle flips, `onSelectionChange` fires
 * with the new list of active favorite ids — the parent recomputes the
 * overlay curve and passes it down to PortfolioEquityCurve.
 *
 * Save-as-Test takes the currently-toggled favorites + their strategy
 * ids + the real portfolio's strategy ids and POSTs to
 * /api/test-portfolios. Modal stays closed until the user clicks the
 * primary button; favorites toggles persist after save.
 */

interface FavoritesPanelProps {
  open: boolean;
  onClose: () => void;
  favorites: StrategyForBuilder[];
  /**
   * The current real portfolio's strategy ids. Used to build the default
   * save-as-test name ("Active + Orion + Helios") and to seed the save
   * payload with the union of real + toggled favorites.
   */
  realStrategyIds: string[];
  realPortfolioName: string;
  /**
   * Called whenever the toggle set changes. Parent uses this to
   * recompute the "+ Favorites" overlay on the YTD chart.
   */
  onSelectionChange: (activeFavoriteIds: string[]) => void;
}

export function FavoritesPanel({
  open,
  onClose,
  favorites,
  realStrategyIds,
  realPortfolioName,
  onSelectionChange,
}: FavoritesPanelProps) {
  // Toggle state starts with all OFF (baseline = real portfolio only).
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [saveOpen, setSaveOpen] = useState(false);
  const [toast, setToast] = useState<{ id: string; name: string } | null>(null);

  const activeIds = useMemo(
    () => favorites.filter((f) => active[f.id]).map((f) => f.id),
    [favorites, active],
  );

  function toggle(id: string) {
    setActive((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      const nextActiveIds = favorites
        .filter((f) => next[f.id])
        .map((f) => f.id);
      // Notify the parent outside the updater so it doesn't fire during render.
      queueMicrotask(() => onSelectionChange(nextActiveIds));
      return next;
    });
  }

  const activeFavorites = favorites.filter((f) => active[f.id]);

  const defaultName = useMemo(() => {
    if (activeFavorites.length === 0) return realPortfolioName;
    const shortNames = activeFavorites
      .slice(0, 3)
      .map((f) => f.name.split(" ")[0]);
    const suffix =
      activeFavorites.length > 3 ? ` + ${activeFavorites.length - 3} more` : "";
    return `${realPortfolioName} + ${shortNames.join(" + ")}${suffix}`;
  }, [activeFavorites, realPortfolioName]);

  if (!open) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorites-panel-title"
        className="fixed inset-0 z-40 flex"
      >
        {/* Backdrop — click to close */}
        <div
          className="flex-1 bg-text-primary/30"
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Slide-out panel */}
        <aside className="w-full max-w-md bg-surface border-l border-border flex flex-col">
          <div className="flex items-start justify-between p-5 border-b border-border">
            <div>
              <h2
                id="favorites-panel-title"
                className="font-display text-xl text-text-primary"
              >
                Favorite Strategies
              </h2>
              <p className="text-xs text-text-muted mt-1">
                Toggle to overlay on chart
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close favorites panel"
              className="text-text-muted hover:text-text-primary text-2xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {favorites.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-text-muted">
                  No favorites yet. Star strategies from the Strategies page
                  to see how they would have performed in your book.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {favorites.map((f) => {
                  const isActive = !!active[f.id];
                  return (
                    <li key={f.id}>
                      <label className="flex items-start gap-3 p-4 cursor-pointer hover:bg-bg-secondary transition-colors">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => toggle(f.id)}
                          className="mt-1 h-4 w-4 shrink-0 accent-accent"
                          aria-label={`Toggle ${f.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {f.name}
                          </p>
                          <p className="text-[10px] text-text-muted mt-0.5 truncate">
                            {f.strategy_types.join(" · ")}
                            {f.markets.length > 0
                              ? ` · ${f.markets.slice(0, 2).join(", ")}`
                              : ""}
                          </p>
                          <div className="mt-1 flex gap-3 text-[11px] text-text-muted">
                            <span>
                              Sharpe{" "}
                              <span className="text-text-secondary font-metric tabular-nums">
                                {formatNumber(f.sharpe)}
                              </span>
                            </span>
                            <span>
                              CAGR{" "}
                              <span className="text-text-secondary font-metric tabular-nums">
                                {formatPercent(f.cagr)}
                              </span>
                            </span>
                            <span>
                              MDD{" "}
                              <span className="text-text-secondary font-metric tabular-nums">
                                {formatPercent(f.max_drawdown)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="p-5 border-t border-border">
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              disabled={activeIds.length === 0}
              className="w-full inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save as Test Portfolio
            </button>
            {activeIds.length === 0 && (
              <p className="mt-2 text-[11px] text-text-muted text-center">
                Toggle at least one favorite to save
              </p>
            )}
          </div>
        </aside>
      </div>

      <SaveAsTestModal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        strategyIds={[...realStrategyIds, ...activeIds]}
        defaultName={defaultName}
        onSaved={(id) => {
          setToast({ id, name: defaultName });
          // Auto-dismiss toast after 6s.
          setTimeout(() => setToast(null), 6000);
        }}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-border rounded-md shadow-lg px-4 py-3 flex items-center gap-3"
        >
          <p className="text-sm text-text-primary">
            Saved to Test Portfolios.
          </p>
          <a
            href={`/portfolios/${toast.id}`}
            className="text-sm text-accent font-medium hover:text-accent-hover"
          >
            View
          </a>
        </div>
      )}
    </>
  );
}
