"use client";

/**
 * Phase 09.1 Plan 09 / D-14 + D-15 + D-16.
 *
 * Hero Bridge widget — the allocator's portfolio-level entry point to acting
 * on Bridge recommendations. Three variants (full / card / subtle) selected
 * by the Tweaks panel; default is "full" per D-15.
 *
 * Scope (Plan 09 stated, S3 accepted):
 *   - Portfolio-level surface: lists ALL flagged holdings and opens the
 *     BridgeDrawer for cross-holdings browse → confirm.
 *   - DOES NOT mount or duplicate the per-row inline `BridgeOutcomeBanner` —
 *     that lives in Plan 08's HoldingsTable per D-14. There is no double
 *     mount risk here because:
 *       1. This widget renders a SUMMARY ("N holdings need review") + Review
 *          CTA, never a per-holding banner instance.
 *       2. The drawer (BridgeDrawer) owns the per-holding browse list, but
 *          again as ranked candidates, not as `BridgeOutcomeBanner`.
 *
 * "No active breaches" fix (CONTEXT §specifics, app.jsx:131 designer bug):
 *   The designer source's `onRestore={() => setBannerDismissed(false)}` toggle
 *   is wrong for production — it tries to re-show a dismissed banner. Real
 *   state is `flaggedHoldings.length > 0`. When zero, the stub's "Show last
 *   recommendation" button routes to the historic outcomes view
 *   (/allocations?tab=outcomes), NOT a dismissal toggle.
 */

import { useState } from "react";
import { BridgeDrawer } from "./BridgeDrawer";
import type { FlaggedHolding } from "../lib/holding-outcome-adapter";

export type BridgeWidgetVariant = "full" | "card" | "subtle";

export interface BridgeWidgetProps {
  flaggedHoldings: FlaggedHolding[];
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  /** Driven by the Tweaks panel (Plan 11); default "full" per D-15. */
  variant?: BridgeWidgetVariant;
}

export function BridgeWidget({
  flaggedHoldings,
  matchDecisionsByHoldingRef,
  variant = "full",
}: BridgeWidgetProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hasBreaches = flaggedHoldings.length > 0;

  if (!hasBreaches) {
    // FIX per CONTEXT §specifics — app.jsx:131 designer bug. The "Show last
    // recommendation" button routes to historic outcomes (Outcomes tab),
    // NOT a setBannerDismissed(false) toggle.
    return (
      <div
        role="region"
        aria-label="Bridge status"
        className="rounded-lg border border-border bg-surface p-6"
      >
        <div className="text-xs uppercase tracking-wide text-text-muted">
          Bridge
        </div>
        <div className="mt-2 text-lg font-medium text-text-primary">
          No active breaches
        </div>
        <div className="mt-1 text-sm text-text-secondary">
          Your allocations are within mandate. Review past recommendations for
          context.
        </div>
        <a
          href="/allocations?tab=outcomes"
          className="mt-4 inline-block text-sm text-accent hover:underline"
        >
          Show last recommendation →
        </a>
      </div>
    );
  }

  const count = flaggedHoldings.length;
  const plural = count === 1 ? "" : "s";

  if (variant === "subtle") {
    return (
      <>
        <div
          role="region"
          aria-label="Bridge recommendations"
          className="rounded-md border border-border bg-surface p-3 text-sm text-text-primary"
        >
          Bridge flagged {count} holding{plural} —
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="ml-2 text-accent hover:underline"
          >
            Review →
          </button>
        </div>
        <BridgeDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          flaggedHoldings={flaggedHoldings}
          matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
        />
      </>
    );
  }

  if (variant === "card") {
    return (
      <>
        <div
          role="region"
          aria-label="Bridge recommendations"
          className="rounded-lg border p-4"
          style={{ borderColor: "#FED7AA", background: "#FFF7ED" }}
        >
          <div
            className="text-xs uppercase"
            style={{ color: "#D97706", letterSpacing: "0.08em" }}
          >
            Bridge
          </div>
          <div className="mt-1 text-base font-medium text-text-primary">
            {count} holding{plural} flagged
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Review candidates →
          </button>
        </div>
        <BridgeDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          flaggedHoldings={flaggedHoldings}
          matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
        />
      </>
    );
  }

  // "full" (hero) variant — default per D-15.
  return (
    <>
      <div
        role="region"
        aria-label="Bridge recommendations"
        className="rounded-lg border p-6"
        style={{
          borderColor: "#FED7AA",
          background: "linear-gradient(135deg, #FFF7ED 0%, #FFFAF3 100%)",
        }}
      >
        <div
          className="text-xs uppercase"
          style={{ color: "#D97706", letterSpacing: "0.08em" }}
        >
          Bridge flagged
        </div>
        <div
          className="mt-1 text-xl font-semibold text-text-primary"
          style={{
            fontFamily: "var(--font-serif, Fraunces, Georgia, serif)",
          }}
        >
          {count} holding{plural} need{count === 1 ? "s" : ""} review
        </div>
        <ul className="mt-3 grid gap-1 text-sm text-text-secondary">
          {flaggedHoldings.slice(0, 3).map((h) => (
            <li key={`${h.venue}:${h.symbol}:${h.holding_type}`}>
              • {h.symbol} ({h.venue}) — composite{" "}
              <span
                style={{ fontFamily: "var(--font-mono, 'Geist Mono', monospace)" }}
              >
                {h.top_candidate_composite}
              </span>
            </li>
          ))}
          {count > 3 && (
            <li className="text-text-muted">…and {count - 3} more</li>
          )}
        </ul>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="mt-4 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90"
        >
          Review candidates →
        </button>
      </div>
      <BridgeDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        flaggedHoldings={flaggedHoldings}
        matchDecisionsByHoldingRef={matchDecisionsByHoldingRef}
      />
    </>
  );
}
