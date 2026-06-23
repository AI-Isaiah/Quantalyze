"use client";

/**
 * Sticky bottom bar for the Scenario tab body.
 *
 * Renders inside the tab content area (NOT viewport — `position: sticky`
 * keeps it bound to the tabpanel; switching tabs hides it via the tabpanel
 * `hidden` attr). 56px tall.
 *
 * Contract:
 *   - Left: live diff count chip — "{N} changes" / "1 change" / "No changes yet"
 *   - Center: compact delta summary — top 3 non-muted deltas joined by " · "
 *     (Geist Mono / font-mono); falls back to "No material change yet."
 *     when every delta is below the noise floor.
 *   - Right: ghost Reset (hover-destructive) + accent Commit (disabled when
 *     diff_count = 0).
 *
 * Pure display primitive — no internal state, no fetch, no localStorage. The
 * composer owns scenario state and passes diff/delta props down; clicking
 * Reset / Commit fires the upstream callback (the composer decides whether
 * to open a confirmation modal vs. the commit drawer).
 */

import type { CSSProperties } from "react";

export interface ScenarioFooterDeltaItem {
  /** KPI display name, e.g. "Sharpe", "Max DD", "TWR". */
  label: string;
  /** Pre-formatted, sign-prefixed value, e.g. "+0.3" or "−4%". */
  value: string;
  /**
   * Direction-aware tier. The composer maps each KPI's raw delta against
   * its improvement direction (up-good vs down-good) and the noise-floor
   * threshold:
   *   - "positive" → improvement (e.g. Sharpe up, MaxDD down)
   *   - "negative" → regression  (e.g. Sharpe down, MaxDD up)
   *   - "muted"    → |Δ| < noise floor (no material change)
   *
   * Footer renders only NON-muted entries in the summary line. When every
   * entry is muted, the footer falls back to "No material change yet."
   */
  tier: "positive" | "negative" | "muted";
}

export interface ScenarioFooterProps {
  diffCount: number;
  deltaSummary: ScenarioFooterDeltaItem[];
  onResetRequested: () => void;
  onCommitRequested: () => void;
  /**
   * NEW-C18-10: when true the Commit button is disabled regardless of diffCount.
   * Used to block commit while a fingerprint mismatch is unresolved — the user
   * has been shown a banner; they must choose Reset or Keep before proceeding.
   */
  commitBlocked?: boolean;
}

const FOOTER_STYLE: CSSProperties = {
  position: "sticky",
  bottom: 0,
  height: 56,
  background: "var(--color-surface, #FFFFFF)",
  borderTop: "1px solid var(--color-border, #E2E8F0)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 16px",
  zIndex: 10,
};

export function ScenarioFooter({
  diffCount,
  deltaSummary,
  onResetRequested,
  onCommitRequested,
  commitBlocked = false,
}: ScenarioFooterProps) {
  const hasDiffs = diffCount > 0;
  const significant = deltaSummary.filter((d) => d.tier !== "muted");

  // Diff-count chip copy — verb-less verb+noun pair.
  const countLabel =
    diffCount === 0
      ? "No changes yet"
      : diffCount === 1
        ? "1 change"
        : `${diffCount} changes`;

  // Delta summary copy:
  //   - zero diffs        → "No changes yet" (chip already says this; the
  //                         summary slot mirrors it so the footer reads as
  //                         a single status line at rest)
  //   - all-muted deltas  → "No material change yet."
  //   - some non-muted    → top 3 joined by " · " in "{value} {label}" form
  //                         e.g. "+0.3 Sharpe · −4% Max DD"
  const summaryText = !hasDiffs
    ? "No changes yet"
    : significant.length === 0
      ? "No material change yet."
      : significant
          .slice(0, 3)
          .map((d) => `${d.value} ${d.label}`)
          .join(" · ");

  return (
    // JOURNEY-03 (a11y) — a labeled region landmark on a <div>, NOT a <footer>:
    // axe aria-allowed-role rejects role="region" on a <footer> (footer's
    // allowed roles don't include region). The region landmark + label are what
    // matter; a sticky bar is not a page contentinfo footer anyway.
    <div
      role="region"
      aria-label="Scenario draft summary and actions"
      style={FOOTER_STYLE}
    >
      <span className="rounded-md px-2 py-1 text-xs font-medium text-text-muted">
        {countLabel}
      </span>
      <span className="font-mono text-[13px] font-medium tabular-nums text-text-secondary">
        {summaryText}
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Reset scenario draft"
          onClick={onResetRequested}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-negative hover:text-negative"
          data-testid="scenario-footer-reset"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onCommitRequested}
          disabled={!hasDiffs || commitBlocked}
          aria-describedby={commitBlocked ? "scenario-fingerprint-mismatch-banner" : undefined}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="scenario-footer-commit"
        >
          Commit scenario
        </button>
      </div>
    </div>
  );
}
