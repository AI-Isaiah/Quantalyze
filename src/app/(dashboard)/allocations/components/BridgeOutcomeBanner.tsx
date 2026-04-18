"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export type BridgeOutcomeBannerProps = {
  strategyId: string;
  onAllocatedClick: () => void;
  onRejectedClick: () => void;
  /** Called after server POST succeeds — parent hides the strip */
  onDismiss: () => void;
};

/**
 * Row-integrated strip: prompt + [Allocated] + [Rejected] + [×] dismiss.
 *
 * Renders ONLY when strategy.eligible_for_outcome === true AND
 * strategy.existing_outcome === null (gated in PositionsTable).
 *
 * D-08: buttons open forms in-place (no modal).
 * D-05/D-07: dismiss POSTs to /api/bridge/outcome/dismiss with a 24h TTL.
 * DESIGN.md tokens: bg-page, border-border, text-text-secondary, font-sans.
 *
 */
export function BridgeOutcomeBanner({
  strategyId,
  onAllocatedClick,
  onRejectedClick,
  onDismiss,
}: BridgeOutcomeBannerProps) {
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    try {
      const res = await fetch("/api/bridge/outcome/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`dismiss failed ${res.status}`);
      onDismiss();
    } catch (err) {
      // Log error but don't block UI — on next load the banner may reappear
      // if the server-side dismissal wasn't persisted (TTL will handle it).
      console.error("[BridgeOutcomeBanner] dismiss error:", err);
      // Still call onDismiss optimistically so the strip disappears immediately
      onDismiss();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Record outcome for Bridge-introduced strategy"
      data-testid="bridge-outcome-banner"
      className="flex items-center gap-3 border-t border-border bg-page px-4 py-3 text-sm font-sans"
    >
      <span className="flex-1 text-text-secondary">
        Did you act on this Bridge suggestion?
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={onAllocatedClick}
        >
          Allocated
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onRejectedClick}
        >
          Rejected
        </Button>
      </div>
      <button
        type="button"
        aria-label="Dismiss for today"
        disabled={dismissing}
        onClick={handleDismiss}
        className="flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:text-text-secondary disabled:pointer-events-none disabled:opacity-50"
      >
        &times;
      </button>
    </div>
  );
}
