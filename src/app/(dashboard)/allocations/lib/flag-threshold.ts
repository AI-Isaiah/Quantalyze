/**
 * Phase 09 / D-06 + finding f5. Composite-score threshold for flagging holdings.
 * Scale: 0..100 (match_engine.py:787 final_score).
 * D-06's "composite >= 0.50" on the normalized [0,1] scale corresponds to score >= 50.
 * Parity with the Python-side constant at analytics-service/routers/match.py is
 * asserted in holding-outcome-adapter.test.ts (finding f5 constant-parity test).
 */
export const FLAG_COMPOSITE_THRESHOLD = 50 as const;
