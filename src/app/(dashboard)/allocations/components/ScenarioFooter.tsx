"use client";

/**
 * Sticky bottom bar for the Scenario tab body.
 *
 * Renders inside the tab content area (NOT viewport — `position: sticky`
 * keeps it bound to the tabpanel; switching tabs hides it via the tabpanel
 * `hidden` attr). At least 56px tall; the box grows when the status line wraps.
 *
 * Phase 170 (2026-09-27, N-FOOT): the offset is classes, not an inline style.
 * Below `md` it sticks at `bottom-16` so it clears MobileNav; at `md` and up
 * it sits at the scroll-port bottom.
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
  /**
   * 111-05 (red-team HIGH fix): count of COMMITTABLE diffs — the diffs the
   * commit path (`handleCommit`) will actually emit (voluntary_add rows from
   * added strategies). The Commit button's enabled-state gates on THIS, not on
   * `diffCount`.
   *
   * Why they diverge: a draft can be dirty (`diffCount > 0`) with ZERO
   * committable changes — e.g. an exclusion-only draft (a per-key data source
   * toggled off, no strategy added). Exclusions are real draft changes for the
   * save / dirty-indicator / mode-switch-park (CF-05), so they MUST still count
   * toward `diffCount`. But `handleCommit` produces no diff for them, so
   * enabling Commit on `diffCount` advertised a change the commit path
   * dead-ends on (F-01 "Nothing to commit" error). Gating Commit on
   * `committableCount` makes the button honest: it is enabled iff clicking it
   * would produce a non-empty diff set.
   *
   * Optional for display-only footers; defaults to `diffCount` (legacy
   * behavior) when omitted. The composer always passes it explicitly.
   */
  committableCount?: number;
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

export function ScenarioFooter({
  diffCount,
  committableCount,
  deltaSummary,
  onResetRequested,
  onCommitRequested,
  commitBlocked = false,
}: ScenarioFooterProps) {
  // `hasDiffs` drives the DISPLAY (dirty chip + summary line) — exclusions count
  // here (CF-05). It does NOT gate Commit; see `canCommit` below.
  const hasDiffs = diffCount > 0;
  // Commit is enabled iff there is at least one COMMITTABLE diff (and no
  // unresolved fingerprint mismatch). Falls back to `diffCount` for
  // display-only footers that don't distinguish the two counts.
  const committable = committableCount ?? diffCount;
  const canCommit = committable > 0 && !commitBlocked;
  const significant = deltaSummary.filter((d) => d.tier !== "muted");

  // Diff-count chip copy — verb-less verb+noun pair.
  const countLabel =
    diffCount === 0
      ? "No changes yet"
      : diffCount === 1
        ? "1 change"
        : `${diffCount} changes`;

  // Delta summary copy, rendered only when hasDiffs (Phase 170, 2026-09-27,
  // N-FOOT item (h)). At zero diffs the chip alone says "No changes yet".
  // Mirroring that phrase into this slot was the (h) defect: the empty state
  // printed twice. With diffs:
  //   - all-muted deltas  → "No material change yet."
  //   - some non-muted    → top 3 in "{value} {label}" form, each its own
  //                         nowrap span, joined by " · " so wrapping happens
  //                         between items, never inside one
  //                         e.g. "+0.3 Sharpe · −4% Max DD"
  const summaryItems = significant.slice(0, 3).map((d) => `${d.value} ${d.label}`);
  const mutedOnly = significant.length === 0;

  return (
    // JOURNEY-03 (a11y) — a labeled region landmark on a <div>, NOT a <footer>:
    // axe aria-allowed-role rejects role="region" on a <footer> (footer's
    // allowed roles don't include region). The region landmark + label are what
    // matter; a sticky bar is not a page contentinfo footer anyway.
    <div
      role="region"
      aria-label="Scenario draft summary and actions"
      className="sticky bottom-16 md:bottom-0 z-10 min-h-[56px] flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 bg-surface border-t border-border"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-md px-2 py-1 text-xs font-medium text-text-muted">
          {countLabel}
        </span>
        {hasDiffs && (
          <span className="font-mono text-fixed-13 font-medium tabular-nums text-text-secondary">
            {mutedOnly
              ? "No material change yet."
              : summaryItems.map((item, i) => (
                  <span key={item}>
                    {i > 0 ? " · " : null}
                    <span className="whitespace-nowrap">{item}</span>
                  </span>
                ))}
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <button
          type="button"
          aria-label="Reset scenario draft"
          onClick={onResetRequested}
          className="min-h-[44px] rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-negative hover:text-negative"
          data-testid="scenario-footer-reset"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onCommitRequested}
          disabled={!canCommit}
          aria-describedby={commitBlocked ? "scenario-fingerprint-mismatch-banner" : undefined}
          className="min-h-[44px] rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="scenario-footer-commit"
        >
          Commit scenario
        </button>
      </div>
    </div>
  );
}
