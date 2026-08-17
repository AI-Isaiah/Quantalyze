# Phase 145 — deferred items (out of this plan's scope, in-phase owners named)

Logged by Plan 03 during the A6 pre-drop grep (2026-08-17). None blocks the
DROP; each has a named owner inside this phase.

| # | Item | Found by | Owner |
|---|------|----------|-------|
| 1 | `supabase/schema/functions/finalize_csv_strategy.sql` and `supabase/schema/functions/persist_csv_daily_returns.sql` are `@generated` snapshots (scripts/dump-sql-functions.ts) that now document DROPPED functions. Regenerate with `npm run schema:functions` (needs node_modules — not available in this worktree) so the two stale files disappear and a `finalize_csv_strategy_with_returns.sql` snapshot appears. | Plan 03 A6 grep | Plan 04 or 05 (any node-capable checkout) |
| 2 | `src/lib/database.types.ts:3715` and `:3943` carry generated TS types for BOTH dropped RPCs (contra 145-RESEARCH.md Runtime State Inventory, which said the types file does not carry them). Nothing breaks at compile time (the route casts through unknown), but the stale entries invite a future caller of a dropped function. Regenerate or hand-prune when the fold's caller lands. | Plan 03 A6 grep | Plan 04 (caller wiring) |
| 3 | `src/__tests__/audit-coverage.test.ts:209` — `MUTATING_RPC_NAMES` lists `finalize_csv_strategy`. The regex requires a closing quote right after the name, so `.rpc("finalize_csv_strategy_with_returns")` will NOT match: the fold's route call would sit OUTSIDE the audit-coverage law until the new name is added to the list. Add `finalize_csv_strategy_with_returns` (and drop the old name) in the same commit as the route re-point. | Plan 03 A6 grep | Plan 04 |
| 4 | `analytics-service/tests/test_persist_csv_daily_returns_live.py` (skipIf live-DB, never runs in CI) calls the dropped RPC by name; goes 42883 the moment TEST is migrated. Retire or re-point with the Python csv-finalize deletion. | Plan 03 A6 grep | Plan 04 (D-06 obligation 2) |
