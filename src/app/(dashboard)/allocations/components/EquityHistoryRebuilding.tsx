/**
 * Phase 167.1.2 / D-02 ("Hide it until correct").
 *
 * The Overview's stand-in for the allocator equity curve and the factsheet
 * panels built from it, rendered while `equityHistoryState !== "ready"`.
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
 * figures do not use this history rather than calling them current.
 *
 * Tokens follow DESIGN.md (mono eyebrow at the 0.18em tracking step, DM Sans
 * on the fluid `text-h3` tier, secondary body text) and the layout is
 * left-aligned (the AI-Slop ban on centered-everything layouts).
 *
 * Semantics (review round 1 WR-04 / IN-03): the heading is an `<h2>`, because
 * the only heading above it on the Overview is the page `<h1>` and axe's
 * `heading-order` rule (the best-practice tag `buildAxe` runs) fails an h1 to
 * h3 skip. The H3 in DESIGN.md is a visual size, not a heading level. The
 * section is a labelled region, not `role="status"`: the panel is static and
 * mounted at first render, so a live region announces nothing and would only
 * replace the region landmark.
 */
const HEADING_ID = "overview-equity-rebuilding-heading";

export function EquityHistoryRebuilding() {
  return (
    <section
      aria-labelledby={HEADING_ID}
      data-testid="overview-equity-rebuilding"
      className="mt-6 max-w-[1100px] border-t border-border py-8"
    >
      <p className="text-fixed-10 font-mono uppercase tracking-[0.18em] text-text-muted">
        Equity history
      </p>
      <h2
        id={HEADING_ID}
        className="mt-3 text-h3 font-semibold text-text-primary"
      >
        Your equity history is being rebuilt
      </h2>
      <p className="mt-2 max-w-prose text-sm text-text-secondary">
        The equity chart and the ratios built from it are hidden for now. The
        history behind them could count one exchange account twice when more
        than one key reads it, or read a day with no sync as zero. Holdings and
        AUM on this page do not use that history.
      </p>
    </section>
  );
}
