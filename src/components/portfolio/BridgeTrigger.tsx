"use client";

import { useState, useCallback } from "react";
import type { PortfolioInsight } from "@/lib/portfolio-insights";
import { ReplacementPanel } from "./ReplacementPanel";
import { trackUsageEventClient } from "@/lib/analytics/usage-events-client";

interface BridgeTriggerProps {
  insight: PortfolioInsight;
  portfolioId: string;
  children: React.ReactNode;
}

/**
 * Wraps an underperformance insight sentence and appends a "Find Replacement"
 * link. On click, opens the ReplacementPanel slide-out which fetches bridge
 * candidates from `/api/bridge`.
 *
 * This is a client component because it manages panel open/close state.
 * The parent `<InsightStrip>` stays server-renderable — it only renders
 * `<BridgeTrigger>` for insights where `key === "underperformance"` and
 * `strategy_id` is present.
 */
export function BridgeTrigger({
  insight,
  portfolioId,
  children,
}: BridgeTriggerProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    // Sprint 5 Task 5.5 — bridge_click usage funnel event. Fired here
    // (not on panel mount) so we measure intent, not exposure.
    trackUsageEventClient("bridge_click", {
      strategy_id: insight.strategy_id ?? null,
    });
    setOpen(true);
  }, [insight.strategy_id]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <span className="inline">
        {children}
        <button
          type="button"
          onClick={handleOpen}
          className="ml-2 text-sm font-medium underline underline-offset-2 transition-colors duration-150 ease-out hover:text-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          style={{ color: "#1B6B5A" }}
          aria-label={`Find replacement for ${insight.strategy_name ?? "underperforming strategy"}`}
        >
          Find Replacement
        </button>
      </span>
      {open && (
        <ReplacementPanel
          portfolioId={portfolioId}
          strategyId={insight.strategy_id!}
          strategyName={insight.strategy_name ?? "Underperforming strategy"}
          insightSentence={insight.sentence}
          onClose={handleClose}
        />
      )}
    </>
  );
}
