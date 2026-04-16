"use client";

import { useCallback, useState } from "react";
import { PortfolioImpactPanel } from "@/components/portfolio/PortfolioImpactPanel";
import { Tooltip } from "@/components/ui/Tooltip";

interface SimulateImpactButtonProps {
  candidateStrategyId: string;
  candidateName: string;
  /**
   * The user's single real portfolio id. When null, the button renders
   * as disabled (no portfolio to simulate against) and the tooltip
   * explains why.
   */
  portfolioId: string | null;
}

/**
 * Sprint 6 Task 6.4 — "Simulate Impact" row-action button for the
 * `/discovery/[slug]` StrategyTable.
 *
 * Clicking opens `PortfolioImpactPanel` which calls `/api/simulator` and
 * renders the delta chips plus equity-curve overlay.
 *
 * Accessibility:
 *   - `aria-expanded` reflects panel open state
 *   - `aria-controls` ties the button to the dialog
 *   - Tooltip describes what the button does before click
 *   - When no portfolio exists, the button is disabled and the tooltip
 *     explains the prerequisite
 */
export function SimulateImpactButton({
  candidateStrategyId,
  candidateName,
  portfolioId,
}: SimulateImpactButtonProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    if (!portfolioId) return;
    setOpen(true);
  }, [portfolioId]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const disabled = !portfolioId;
  const tooltip = disabled
    ? "Create a portfolio first to see the impact of adding this strategy."
    : "See portfolio impact on Sharpe, MaxDD, correlation.";
  const panelId = `portfolio-impact-panel-${candidateStrategyId}`;

  return (
    <>
      <Tooltip content={tooltip}>
        <button
          type="button"
          onClick={handleOpen}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`Simulate impact of adding ${candidateName} to your portfolio`}
          className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            borderColor: "#1B6B5A",
            color: "#1B6B5A",
            fontFamily: "var(--font-body)",
          }}
          // DESIGN.md DM Sans body + muted teal accent; the inline style
          // pins the accent colour since the shared `.border-accent` token
          // already matches but we want explicit visual parity with the
          // "Find Replacement" link (BridgeTrigger) which hard-codes
          // #1B6B5A.
        >
          Simulate Impact
        </button>
      </Tooltip>
      {open && portfolioId && (
        <div id={panelId}>
          <PortfolioImpactPanel
            portfolioId={portfolioId}
            candidateStrategyId={candidateStrategyId}
            candidateName={candidateName}
            onClose={handleClose}
          />
        </div>
      )}
    </>
  );
}
