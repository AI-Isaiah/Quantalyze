"use client";

import { useEffect, useRef, useState, useTransition } from "react";

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

  const isMountedRef = useRef(true);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (hintTimeoutRef.current !== null) {
        clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = null;
      }
    };
  }, []);

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

      await new Promise((r) => setTimeout(r, 600));
      const okRetry = await attempt(action);
      if (okRetry) return;

      if (!isMountedRef.current) return;
      onToggle(strategyId, !nextStarred);
      setShowRetryHint(true);
      if (hintTimeoutRef.current !== null) {
        clearTimeout(hintTimeoutRef.current);
      }
      hintTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setShowRetryHint(false);
        hintTimeoutRef.current = null;
      }, 4000);
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
