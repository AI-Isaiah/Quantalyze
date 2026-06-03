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

import { useMemo, useState } from "react";
import Link from "next/link";
import { BridgeDrawer } from "./BridgeDrawer";
import type { FlaggedHolding } from "../lib/holding-outcome-adapter";
import type { OutcomeRow } from "@/lib/queries";

export type BridgeWidgetVariant = "full" | "card" | "subtle";

export interface BridgeWidgetProps {
  /**
   * H-1210 (F1 loud-fail) — discriminate "we couldn't load the breach data"
   * from "genuinely zero breaches". An array (incl. `[]`) is a KNOWN result:
   * `[]` → the real "All clear" empty state. `null` is the UNKNOWN signal —
   * the upstream dashboard payload failed to resolve flaggedHoldings (network
   * blip / query threw). For a SAFETY-RELEVANT widget we must NEVER collapse
   * "unknown" into the reassuring "All clear" UI; `null` renders a distinct
   * "Bridge status unavailable" state with a retry affordance. Callers that
   * coalesce a failed payload field MUST pass `null`, not `[]`.
   */
  flaggedHoldings: FlaggedHolding[] | null;
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  /** Driven by the Tweaks panel (Plan 11); default "full" per D-15. */
  variant?: BridgeWidgetVariant;
  /**
   * PR2 (HANDOFF G4) — outcomes feed for the rich "All clear" empty state.
   * The dashboard payload provides `outcomes` sorted DESC by created_at,
   * capped at 200 most-recent. The empty-state card reads outcomes[0] for
   * the "Last reviewed" line and outcomes.length for the trailing-window
   * count. When omitted (e.g. older callers, isolated tests), the empty
   * state degrades to the "no reviews recorded yet" copy.
   */
  outcomes?: ReadonlyArray<OutcomeRow>;
  /**
   * H-1210 (F1 loud-fail) — optional retry handler for the "Bridge status
   * unavailable" error state (rendered when `flaggedHoldings` is `null`).
   * When provided, the error card shows a Retry button that invokes it so
   * the caller can re-fetch. When omitted the error state still renders
   * (just without the button) — the load failure is never silently hidden.
   */
  onRetry?: () => void;
}

/**
 * PR2 helper — render a created_at ISO timestamp as a short relative phrase
 * ("today", "yesterday", "3 days ago", "2 weeks ago", "Mar 15, 2026"). The
 * prototype's empty-state target reads "Last reviewed 3 days ago", so the
 * rendering must collapse to that compact, conversational form. Falls back
 * to the original ISO string if the input is unparseable so the card never
 * renders "NaN days ago".
 */
function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const elapsedMs = now.getTime() - ts;
  const days = Math.floor(elapsedMs / 86_400_000);
  if (days < 0) return "today"; // future timestamps clamp to "today"
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "a week ago";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  // Older than a year — fall back to absolute date for clarity.
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BridgeWidget({
  flaggedHoldings,
  matchDecisionsByHoldingRef,
  variant = "full",
  outcomes = [],
  onRetry,
}: BridgeWidgetProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // L-0070 — memoize the empty-state's relative-date phrase on the most-recent
  // outcome's created_at. `formatRelativeDate` does a `Date.parse` + a locale
  // `toLocaleDateString` and defaults `now` to a fresh `new Date()`; calling it
  // inline on every render re-ran all of that on each 30s dashboard payload
  // refresh. Keyed on the timestamp string, it now recomputes only when the
  // latest outcome actually changes (~once/day). Hook sits above the early
  // returns so it runs unconditionally.
  const lastOutcomeCreatedAt = outcomes[0]?.created_at;
  const lastReviewedLabel = useMemo(
    () => (lastOutcomeCreatedAt ? formatRelativeDate(lastOutcomeCreatedAt) : null),
    [lastOutcomeCreatedAt],
  );

  // H-1210 (F1 loud-fail) — `null` is the UNKNOWN signal: the upstream
  // dashboard payload failed to resolve flaggedHoldings. Render a distinct
  // error state instead of the reassuring "All clear" empty state, and log
  // the swallowed failure so it stays observable. An allocator must never
  // decide not to rebalance because a *failed* Bridge load looked "All clear".
  if (flaggedHoldings === null) {
    console.error(
      "[BridgeWidget] flaggedHoldings unavailable — rendering error state (load failed upstream)",
    );
    return (
      <div
        role="region"
        aria-label="Bridge status unavailable"
        data-testid="bridge-error-state"
        className="rounded-lg border px-4 py-3"
        style={{
          borderColor: "var(--color-bridge-border-100)",
          background: "var(--color-bridge-bg-50)",
        }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="text-[10px] font-mono uppercase tracking-[0.14em]"
            style={{ color: "var(--color-warning)" }}
          >
            Bridge
          </span>
          <span
            className="text-base font-semibold text-text-primary"
            style={{ fontFamily: "var(--font-serif, Fraunces, Georgia, serif)" }}
          >
            Status unavailable
          </span>
          <span className="text-sm text-text-secondary">
            Couldn&rsquo;t load your Bridge status.
          </span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              data-testid="bridge-error-retry"
              className="ml-auto text-sm font-medium text-accent hover:underline"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const hasBreaches = flaggedHoldings.length > 0;

  if (!hasBreaches) {
    // PR2 (HANDOFF G4) — rich empty-state replacement. Uses the prototype's
    // cream gradient + orange Bridge pill so the empty state reads as part
    // of the same visual family as the active-breach state instead of a
    // plain white card. Surfaces the most recent recorded outcome when one
    // exists, with a relative-date phrase ("Last reviewed 3 days ago") and
    // the count of reviews on file. The CTA always routes to the Outcomes
    // tab (NOT a dismissal toggle — see CONTEXT §specifics, app.jsx:131
    // designer bug). When `outcomes` is empty, the card collapses to the
    // "Bridge will alert..." copy without crashing.
    const hasOutcomes = outcomes.length > 0;
    const lastOutcome = hasOutcomes ? outcomes[0] : null;
    const outcomeCount = outcomes.length;
    const reviewsLabel =
      outcomeCount === 1
        ? "1 review on file"
        : `${outcomeCount} reviews on file`;

    // Compact single-row layout when there are no recommendations — the
    // expanded empty-state card has no actionable signal to surface.
    return (
      <div
        role="region"
        aria-label="Bridge status"
        data-testid="bridge-empty-state"
        className="rounded-lg border px-4 py-3"
        style={{
          borderColor: "var(--color-bridge-border-100)",
          background:
            "linear-gradient(135deg, var(--color-bridge-bg-100) 0%, var(--color-bridge-bg-50) 100%)",
        }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="text-[10px] font-mono uppercase tracking-[0.14em]"
            style={{ color: "var(--color-warning)" }}
          >
            Bridge
          </span>
          <span
            className="text-base font-semibold text-text-primary"
            style={{ fontFamily: "var(--font-serif, Fraunces, Georgia, serif)" }}
          >
            All clear
          </span>
          <span className="text-sm text-text-secondary">
            Within mandate.
          </span>
          {hasOutcomes && lastOutcome ? (
            <span className="text-xs text-text-muted">
              <span aria-hidden className="mr-2">·</span>
              Last reviewed{" "}
              <span
                className="text-text-secondary"
                data-testid="bridge-empty-last-reviewed"
              >
                {lastReviewedLabel}
              </span>
              <span aria-hidden className="mx-2">·</span>
              <span data-testid="bridge-empty-review-count">{reviewsLabel}</span>
            </span>
          ) : (
            <span className="text-xs text-text-muted">
              <span aria-hidden className="mr-2">·</span>
              No reviews recorded yet.
            </span>
          )}
          {/* F9 H-0087/H-1211/M-0067 — next/Link, not a raw <a>. A raw anchor to
              the same-route `/allocations?tab=outcomes` triggered a full-document
              reload that wiped in-flight Bridge drawer state, the TweaksProvider
              panel state, scroll position, and any ScenarioComposer draft. The
              sibling InsightStrip already uses <Link>; this matches the SPA-native
              tab navigation idiom (AllocationsTabs changeTab + router.replace). */}
          <Link
            href="/allocations?tab=outcomes"
            className="ml-auto text-sm font-medium text-accent hover:underline"
          >
            {hasOutcomes ? "View outcomes" : "Show last recommendation"} →
          </Link>
        </div>
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
          style={{
            borderColor: "var(--color-bridge-border-100)",
            background: "var(--color-bridge-bg-100)",
          }}
        >
          <div
            className="text-xs uppercase"
            style={{ color: "var(--color-warning)", letterSpacing: "0.08em" }}
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
          borderColor: "var(--color-bridge-border-100)",
          background:
            "linear-gradient(135deg, var(--color-bridge-bg-100) 0%, var(--color-bridge-bg-50) 100%)",
        }}
      >
        <div
          className="text-xs uppercase"
          style={{ color: "var(--color-warning)", letterSpacing: "0.08em" }}
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
