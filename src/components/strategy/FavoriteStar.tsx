"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Star button that adds / removes a strategy from the user's favorites
 * watchlist. Drives what shows up in the Favorites panel on the My
 * Allocation page.
 *
 * Optimistic UI: the star state flips instantly on click, the fetch runs
 * in the background, and the router refreshes so any visible Favorites
 * panel re-fetches and stays in sync. If the fetch fails, the state
 * flips back and an inline error is surfaced via aria-live so screen
 * readers hear it too.
 *
 * Rendered on the strategy detail page and (eventually) on strategy
 * cards in discovery. Empty string / unknown strategy IDs are refused
 * at the API level via RLS + FK constraints, not here.
 */

interface FavoriteStarProps {
  strategyId: string;
  /** Current state from the server — the page's RSC layer provides this. */
  initialFavorited: boolean;
  /** Optional additional className for layout tweaks by the parent. */
  className?: string;
}

export function FavoriteStar({
  strategyId,
  initialFavorited,
  className = "",
}: FavoriteStarProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function toggle() {
    const next = !favorited;
    setFavorited(next); // optimistic flip
    setError(null);
    try {
      const res = await fetch("/api/favorites", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Favorite toggle failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setFavorited(!next); // revert
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={favorited}
        aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
          favorited
            ? "text-accent hover:bg-accent/10"
            : "text-text-muted hover:text-accent hover:bg-bg-secondary"
        } disabled:opacity-60`}
      >
        <svg
          viewBox="0 0 16 16"
          fill={favorited ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path d="M8 1l1.8 4.2 4.7.4-3.6 3 1.1 4.6L8 10.8 3.9 13.2l1.1-4.6-3.6-3 4.7-.4L8 1z" />
        </svg>
      </button>
      {error && (
        <span role="alert" aria-live="polite" className="text-xs text-negative">
          {error}
        </span>
      )}
    </span>
  );
}
