/**
 * Phase 199 plan 14 (D-03) - the verified check glyph a strategy row draws beside
 * its name when its data comes through an exchange API key.
 *
 * Moved unchanged out of `StrategyTable.tsx` so the strategies legend renders the
 * REAL glyph instead of a re-typed copy of its path. No client directive: the
 * table (a client module) and the legend (a server component) both render it.
 */
export function VerifiedCheck() {
  return (
    <span title="Verified via exchange API" className="text-accent">
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm3.78 5.22a.75.75 0 00-1.06 0L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25a.75.75 0 000-1.06z" />
      </svg>
    </span>
  );
}
