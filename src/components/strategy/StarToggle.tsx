"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { parseRetryAfterSeconds } from "@/lib/retry";

interface StarToggleProps {
  strategyId: string;
  name: string;
  starred: boolean;
  onToggle: (strategyId: string, nextStarred: boolean) => void;
  size?: "table" | "card";
}

type FailureReason = "auth" | "rate" | "network" | "server";

type AttemptResult =
  | { ok: true }
  | { ok: false; status: number | null; retryAfterMs?: number };

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  auth: "Sign in again to update watchlist",
  rate: "Try again shortly",
  network: "Couldn't reach the server",
  server: "Couldn't update watchlist — retry?",
};

const HINT_DISMISS_MS = 4000;
const DEFAULT_RETRY_DELAY_MS = 600;
const MAX_RETRY_DELAY_MS = 30_000;

export function StarToggle({
  strategyId,
  name,
  starred,
  onToggle,
  size = "table",
}: StarToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [failureReason, setFailureReason] = useState<FailureReason | null>(null);

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

  async function attempt(action: "add" | "remove"): Promise<AttemptResult> {
    let res: Response;
    try {
      res = await fetch(`/api/watchlist/${strategyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      return { ok: false, status: null };
    }
    if (res.ok) return { ok: true };
    // B20: parse Retry-After through the shared primitive — it never returns
    // 0/NaN/negative (the old `sec >= 0` admitted `Retry-After: 0` → a 0ms hot-
    // retry) and handles the HTTP-date form. `null` → undefined → the caller's
    // DEFAULT_RETRY_DELAY_MS (600ms) fallback. Cap the wait at MAX_RETRY_DELAY_MS.
    const sec = parseRetryAfterSeconds(res.headers);
    const retryAfterMs =
      sec !== null ? Math.min(sec * 1000, MAX_RETRY_DELAY_MS) : undefined;
    return { ok: false, status: res.status, retryAfterMs };
  }

  function reasonFor(status: number | null): FailureReason {
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate";
    if (status === null) return "network";
    return "server";
  }

  function scheduleHintDismiss() {
    if (hintTimeoutRef.current !== null) {
      clearTimeout(hintTimeoutRef.current);
    }
    hintTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setFailureReason(null);
      hintTimeoutRef.current = null;
    }, HINT_DISMISS_MS);
  }

  const handleClick = () => {
    const originalStarred = starred;
    const nextStarred = !originalStarred;
    onToggle(strategyId, nextStarred);
    setFailureReason(null);

    startTransition(async () => {
      const action = nextStarred ? "add" : "remove";

      const recordFailure = (reason: FailureReason, status: number | null) => {
        if (!isMountedRef.current) return;
        onToggle(strategyId, originalStarred);
        setFailureReason(reason);
        scheduleHintDismiss();
        console.error(
          `[StarToggle] watchlist ${action} failed (status=${status ?? "network"}, reason=${reason})`,
        );
      };

      const first = await attempt(action);
      if (first.ok) return;

      // Auth failures do not benefit from a quick retry — surface immediately.
      if (first.status === 401 || first.status === 403) {
        recordFailure("auth", first.status);
        return;
      }

      const delay = first.retryAfterMs ?? DEFAULT_RETRY_DELAY_MS;
      await new Promise((r) => setTimeout(r, delay));
      const second = await attempt(action);
      if (second.ok) return;

      recordFailure(reasonFor(second.status), second.status);
    });
  };

  const ariaLabel = starred
    ? `Remove ${name} from watchlist`
    : `Add ${name} to watchlist`;

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label={ariaLabel}
        aria-pressed={starred}
        className={`${hitClass} rounded transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60`}
      >
        {starred ? <StarFilledIcon /> : <StarOutlineIcon />}
      </button>
      {failureReason && (
        <span
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute left-full top-1/2 ml-1.5 -translate-y-1/2 whitespace-nowrap rounded border border-border bg-card px-1.5 py-0.5 text-fixed-10 text-text-muted shadow-sm"
        >
          {FAILURE_MESSAGES[failureReason]}
        </span>
      )}
    </span>
  );
}

function StarOutlineIcon() {
  return (
    <svg
      data-testid="star-outline"
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
      data-testid="star-filled"
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
