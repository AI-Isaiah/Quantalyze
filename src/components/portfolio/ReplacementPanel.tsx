"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { BridgeCandidate } from "@/lib/types";
import { ReplacementCard } from "./ReplacementCard";
import { RouteResponseError } from "@/lib/route-response-error";

/**
 * The one sentence shown when the failure did NOT come from a route response —
 * a rejected fetch, or a 2xx whose `candidates` field is not an array.
 * DESIGN.md §Voice: declarative, sentence-case, active voice. It names the
 * actual affordance: this panel has no retry button, and its only refetch
 * trigger is a fresh mount, so re-opening it IS the retry.
 */
const CANDIDATES_UNAVAILABLE_COPY =
  "We could not load replacement candidates. Close this panel and open it again to retry.";

interface ReplacementPanelProps {
  portfolioId: string;
  strategyId: string;
  strategyName: string;
  insightSentence: string;
  onClose: () => void;
}

/**
 * Slide-out panel from the right edge (DESIGN.md modal pattern). Fetches
 * bridge candidates from `/api/bridge` and renders them as ReplacementCards.
 *
 * Close triggers: backdrop click, Escape key, explicit close button.
 */
export function ReplacementPanel({
  portfolioId,
  strategyId,
  strategyName,
  insightSentence,
  onClose,
}: ReplacementPanelProps) {
  const [candidates, setCandidates] = useState<BridgeCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch bridge candidates on mount. AbortController ensures the in-flight
  // request is cancelled when the panel closes, preventing stale state updates
  // and wasted rate-limiter slots on rapid open/close cycles.
  useEffect(() => {
    const controller = new AbortController();

    async function fetchCandidates() {
      try {
        const res = await fetch("/api/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolio_id: portfolioId,
            underperformer_strategy_id: strategyId,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Bridge request failed" }));
          // The route's `error` field is reviewed copy — on a breaker trip it
          // IS the single-source sentence from src/lib/seam-copy.ts. Marking it
          // route-authored is what lets the catch below refuse to render
          // everything else without deleting the breaker surface.
          throw new RouteResponseError(body.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        // 140.3-07 / B-28 — `data.candidates ?? []` turned a MALFORMED body
        // into an empty-but-successful panel: the user read "No replacement
        // candidates found that would improve this portfolio" as a claim about
        // their portfolio when it was really a claim about our parse. Same
        // shape as the untrusted-network-read guard at
        // `allocations/widgets/outcomes/OutcomesWidget.tsx` (`!Array.isArray(
        // data?.original)`), copied rather than re-invented. Note `?? []` also
        // admitted a non-array truthy value straight into `.map()`.
        if (!Array.isArray(data?.candidates)) {
          console.error("[bridge.fetch] malformed candidates payload", {
            portfolioId,
            strategyId,
            received: typeof data?.candidates,
          });
          if (!controller.signal.aborted) setError(CANDIDATES_UNAVAILABLE_COPY);
          return;
        }
        if (!controller.signal.aborted) {
          setCandidates(data.candidates);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          // Loud-fail (M-0905): the inline error UI alone gives operators zero
          // log signal, so a bridge-scoring regression manifests as silent
          // in-app error toasts. Emit a tagged breadcrumb with the request
          // context so failure rate is observable/aggregatable.
          console.error("[bridge.fetch] candidate load failed", {
            portfolioId,
            strategyId,
            err,
          });
          // 140.3-07 / B-27 member 3 — only a message built from the route
          // RESPONSE is rendered. A rejected fetch arrives as a TypeError whose
          // message can embed an internal host; res.json() on a proxy's HTML
          // error page arrives as a SyntaxError. Neither is copy. The caught
          // value still reaches the console breadcrumb logged just above.
          setError(
            err instanceof RouteResponseError
              ? err.message
              : CANDIDATES_UNAVAILABLE_COPY,
          );
        }
      }
    }

    fetchCandidates();
    return () => { controller.abort(); };
  }, [portfolioId, strategyId]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus trap: focus the panel on mount
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Backdrop click handler
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const isLoading = candidates === null && error === null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Replacement candidates for ${strategyName}`}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-md flex-col bg-surface shadow-elevated"
        style={{
          animation: "slideInRight 250ms ease-out",
        }}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary truncate">
              Replace {strategyName}
            </h2>
            <p className="mt-1 text-caption text-text-muted leading-relaxed">
              {insightSentence}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 rounded-md p-1 text-text-muted transition-colors hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="space-y-3" aria-label="Loading candidates">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg border border-border bg-surface px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="h-4 w-32 animate-pulse rounded bg-border" />
                    <div className="h-4 w-16 animate-pulse rounded bg-border" />
                  </div>
                  <div className="mb-3 flex gap-4">
                    <div className="h-3 w-20 animate-pulse rounded bg-border" />
                    <div className="h-3 w-20 animate-pulse rounded bg-border" />
                    <div className="h-3 w-20 animate-pulse rounded bg-border" />
                  </div>
                  <div className="h-6 w-24 animate-pulse rounded bg-border" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/5 px-4 py-3">
              <p className="text-small text-negative">{error}</p>
            </div>
          )}

          {candidates !== null && candidates.length === 0 && (
            <p className="text-small text-text-secondary">
              No replacement candidates found that would improve this portfolio.
            </p>
          )}

          {candidates !== null && candidates.length > 0 && (
            <div className="space-y-3">
              {candidates.map((c) => (
                <ReplacementCard
                  key={c.strategy_id}
                  candidate={c}
                  replacementFor={strategyId}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Keyframe for slide-in animation — injected via style tag to avoid
          needing a global CSS addition. DESIGN.md: 250ms ease-out for panel open. */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
