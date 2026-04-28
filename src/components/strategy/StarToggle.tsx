"use client";

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Watchlist star toggle.
 *
 * Polymorphic icon-button (size="table" → 44×44 hit area; size="card" →
 * 32×32). Optimistic UI: onToggle fires synchronously on click so the
 * leading-column / card-corner icon flips immediately. The actual PUT
 * to /api/watchlist/[strategyId] is fired inside useTransition; if it
 * fails, we retry once after 600ms (per UI-SPEC State Matrix), and on
 * the second failure revert the visual flip (back to !nextStarred —
 * the value before this click) and surface an inline retry hint.
 *
 * Rapid-double-click safety has two layers:
 *   1) The button is `disabled` while `isPending` is true — React
 *      blocks subsequent click events for the duration of the transition.
 *   2) Server-side idempotency in PUT /api/watchlist/[strategyId]
 *      (ON CONFLICT DO NOTHING for add, DELETE for remove) makes any
 *      duplicate that does slip through a no-op.
 *
 * Pattern source: useTransition optimistic mirror per RESEARCH.md
 * Pattern 5 + Open Q #2 in TODOS.md (codebase-consistent with
 * AllocatorExchangeManager.tsx; React 19 useOptimistic not yet adopted
 * in-tree).
 *
 * Icons are inline SVG to match the project convention — no
 * lucide-react / @heroicons / react-icons dependency.
 */

import { useState, useTransition } from "react";

interface StarToggleProps {
  strategyId: string;
  name: string;
  starred: boolean;
  onToggle: (strategyId: string, nextStarred: boolean) => void;
  size?: "table" | "card";
}

export function StarToggle({
  strategyId,
  name,
  starred,
  onToggle,
  size = "table",
}: StarToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [showRetryHint, setShowRetryHint] = useState(false);

  // 44×44 in dense table rows; 32×32 on card top-right corner per
  // UI-SPEC Spacing Scale "touch-target floor".
  const hitClass =
    size === "table"
      ? "min-w-11 min-h-11 inline-flex items-center justify-center"
      : "w-8 h-8 inline-flex items-center justify-center";

  async function attempt(action: "add" | "remove"): Promise<boolean> {
    try {
      const res = await fetch(`/api/watchlist/${strategyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  const handleClick = () => {
    const nextStarred = !starred;
    // Optimistic flip — visible BEFORE the network round-trip.
    onToggle(strategyId, nextStarred);
    setShowRetryHint(false);

    startTransition(async () => {
      const action = nextStarred ? "add" : "remove";
      const ok = await attempt(action);
      if (ok) return;

      // Single retry after 600ms (UI-SPEC State Matrix "Server error
      // retry-1").
      await new Promise((r) => setTimeout(r, 600));
      const okRetry = await attempt(action);
      if (okRetry) return;

      // Both attempts failed — revert the optimistic flip and surface
      // the 4-second retry hint. We revert to !nextStarred (the
      // pre-click value at the moment this handler ran) rather than
      // re-reading `starred` from the props closure; that keeps the
      // revert intent stable even if the parent has re-rendered with a
      // new `starred` value during the transition.
      onToggle(strategyId, !nextStarred);
      setShowRetryHint(true);
      setTimeout(() => setShowRetryHint(false), 4000);
    });
  };

  const ariaLabel = starred
    ? `Remove ${name} from watchlist`
    : `Add ${name} to watchlist`;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label={ariaLabel}
      aria-pressed={starred}
      className={`${hitClass} rounded transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60`}
    >
      {starred ? <StarFilledIcon /> : <StarOutlineIcon />}
      {showRetryHint && (
        <span className="sr-only">
          Couldn&apos;t update watchlist. Retry?
        </span>
      )}
    </button>
  );
}

function StarOutlineIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="text-text-muted"
    >
      <path
        d="M8 1.5l2 4.2 4.5.4-3.4 3 1 4.4L8 11.3 3.9 13.5l1-4.4-3.4-3 4.5-.4L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarFilledIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 1.5l2 4.2 4.5.4-3.4 3 1 4.4L8 11.3 3.9 13.5l1-4.4-3.4-3 4.5-.4L8 1.5z"
        fill="var(--color-accent)"
        stroke="var(--color-accent)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
