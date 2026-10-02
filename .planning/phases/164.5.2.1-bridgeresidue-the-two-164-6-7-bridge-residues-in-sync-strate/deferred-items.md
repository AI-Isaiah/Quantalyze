# Phase 164.5.2.1 — deferred / pre-merge items

## [164.5.2.1-02-KEPT-ROW-COMPUTED-AT] PRE-MERGE DECISION (found by plan 02, 2026-10-03)

**Status:** open. This needs a decision before the phase PR merges. The migration auto-applies to TEST
and then PROD with no reviewer gate, so deferring it means shipping it.

**What.** Branch (a) of `sync_strategy_analytics_status` still writes `computed_at = now()`
unconditionally, along with `computation_error = NULL` and both provenance markers set to NULL. D-05
adds two keep arms, one in the status CASE and one in the stamp CASE. It does not add a `computed_at`
hold. So a plain `complete` row kept over a marked in-scope refresh retry stays `complete`, but its
`computed_at` moves forward on every retry, even though nothing was recomputed.

**Why it matters, and why it may not.**
- The defect is INHERITED, not introduced. The branch-(a) `complete_with_warnings` keep arm already
  behaves this way for every warned row today. D-05 extends the same behaviour to plain `complete`.
  Today 0 plain `complete` rows sit in the live ledger cohort (TODOS dated reading), so the extension
  is latent.
- The staleness verdict is NOT affected. `ledger_refresh_staleness` keys on
  `max(date)` over `returns_series`. Its own header (20260825120000) documents that every bridge
  transition re-stamps `computed_at` and rejects that column as a signal (the "Phase 106 janitor bug").
- The user-facing reading IS affected. The comments in
  `supabase/tests/test_sync_status_marked_refresh_protected.sql` arm I3 name the factsheet
  FreshnessChip and the portfolio PDF vintage as readers of `computed_at`. A kept row therefore shows
  a fresh vintage while its refresh keeps failing transiently.
- This was derived from the body (the assignment is unconditional), not measured on the lane.

**Options.**
1. **Accept**, dated, as the inherited property the staleness view already documents.
2. **Narrow fix in this phase:** a `computed_at` CASE in branch (a) that keeps the old value when
   the status keep arm fires. Before any edit, check the carried anchors for a
   `computed_at\s*=\s*now\(\)` count. It costs one new arm plus its twin: the sentinel moves
   13 -> 14, `ARMS_FLOOR` 253 -> 254, and the drift pin follows.
3. **Class-wide fix:** option 2, plus the same hold on the `complete_with_warnings` keep arm and its
   own guard. This changes live PROD behaviour for the warned cohort.

Not booked as a phase and not written to `TODOS.md`. Plan 05 owns the TODOS closeout, and the
orchestrator or founder owns this decision.
