/**
 * Phase 167.1.2 / D-02 ("Hide it until correct").
 *
 * The Overview's stand-in for the allocator equity curve and the factsheet
 * panels built from it, rendered while `equityHistoryState === "rebuilding"`.
 * The producer (`derivePhase07Fields`) withholds the curve because it could
 * count one exchange account twice or read a day with no sync as zero; a wrong
 * number the allocator can act on is worse than an honest absence.
 *
 * Static copy only: no number, no date and no promise of when the history
 * returns. Every sentence must be true for EVERY allocator who sees it (review
 * round 1 WR-03 / SFH-05): a single-key book, a first connect that never saw a
 * chart, and a stale book under the StalenessBanner. So the cause is worded as
 * a property of the history ("could", "when more than one key reads it"), no
 * sentence refers to an "earlier chart", and the holdings sentence says those
 * figures do not use this history rather than calling them current. Tokens follow DESIGN.md (mono eyebrow at the 0.18em tracking step,
 * DM Sans H3, secondary body text) and the layout is left-aligned (the
 * AI-Slop ban on centered-everything layouts).
 */
export function EquityHistoryRebuilding() {
  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="overview-equity-rebuilding"
      className="mt-6 max-w-[1100px] border-t border-border py-8"
    >
      <p className="text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted">
        Equity history
      </p>
      <h3 className="mt-3 text-base font-semibold text-text-primary">
        Your equity history is being rebuilt
      </h3>
      <p className="mt-2 max-w-prose text-sm text-text-secondary">
        The equity chart and the ratios built from it are hidden for now. The
        history behind them could count one exchange account twice when more
        than one key reads it, or read a day with no sync as zero. Holdings and
        AUM on this page do not use that history.
      </p>
    </section>
  );
}
