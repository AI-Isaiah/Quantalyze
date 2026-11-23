---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 02
subsystem: supabase
tags: [sql, view, ledger-refresh, staleness, composite, mutation-gate]
requires: []
provides:
  - "public.ledger_refresh_staleness reads a closed composite as is_closed TRUE, is_stale FALSE (SC-3)"
  - "appended columns is_closed (never NULL) and closed_through"
  - "manual rollback of the view change, proven RED on the lane"
affects: [214-07]
tech-stack:
  added: []
  patterns: ["forward CREATE OR REPLACE VIEW with options and ACL restated and asserted from the catalogue", "RED-UNDER-M twin per arm", "DROP plus CREATE rollback"]
key-files:
  created:
    - supabase/migrations/20261114151700_ledger_staleness_closed_composites.sql
    - supabase/migrations/down/20261114151700-rollback.sql
  modified:
    - supabase/tests/test_ledger_refresh_staleness.sql
    - supabase/tests/test_ledger_refresh_composite_arm.sql
    - analytics-service/tests/test_ledger_refresh_gates.py
    - docs/runbooks/ledger-refresh-go-live.md
key-decisions:
  - "Closed excuses only series_behind: the verdict's age disjunct and the series_behind CASE branch each gain AND NOT cl.is_closed, nothing else moves"
  - "The closed conjunction is written once, in an inner aggregate; is_closed coalesces it and closed_through reads the raw result, so no condition exists twice"
  - "The apply-time check is catalogue-only and does not read back anything a twin mutates"
metrics:
  duration: "about 1 hour 40 minutes"
  completed: 2026-11-14
status: complete
actuals:
  tokens: 23000
  tasks: 3
  commits: 3
plan_head_before: 88efeb790e5d1fadb54f750d452ac7d15e29a8cc
plan_head_after: d3ec0614109f9004968c07a3b961b665f9ba26a6
---

# Phase 214 Plan 02: closed composites read closed, not stale Summary

A composite whose every `strategy_keys` member has a `window_end`, whose latest end is on or before today and whose series reached the day before that end now reads `is_stale = FALSE`, `stale_reason` NULL, `is_closed = TRUE`, `closed_through = max(window_end) - 1` in `public.ledger_refresh_staleness`; only `series_behind` is excused.

## What was built

- `20261114151700_ledger_staleness_closed_composites.sql`: forward `CREATE OR REPLACE VIEW` carrying the original body byte-identical (diffed against the original) plus exactly these changes: a second lateral `cl` (inner aggregate `closed_raw` and `max_window_end`, outer `COALESCE(c.closed_raw, FALSE)` as `is_closed` and `closed_through`), `AND NOT cl.is_closed` on the last `is_stale` disjunct and on the `series_behind` branch, and `is_closed` / `closed_through` appended after the END marker. `security_invoker = true`, the REVOKE and the GRANT are restated, comments restated or added, and a catalogue-only `DO` block asserts reloptions, the PUBLIC / anon / authenticated grant set (via `aclexplode`, PUBLIC as oid 0, NULL `relacl` expanded through `acldefault`), `has_table_privilege` for anon, authenticated and service_role, both new columns, both venue arrays read back from `pg_get_viewdef`, and the excuse text. No row is read.
- `down/20261114151700-rollback.sql`: `DROP VIEW` then `CREATE VIEW` of the original 11-column body (a replace cannot drop columns), options and ACL restated and asserted, header in the Phase 211 shape (undoes, keeps, costs, ledger row left in place).
- `test_ledger_refresh_staleness.sql`: arms I to N (closed reads closed; open window; series short; future end; failed status; never NULL) each with a prose `RED-UNDER:` and a `RED-UNDER-M` twin, seven view-text twins re-pointed, arm count 8 to 14 in all three mentions.
- `test_ledger_refresh_composite_arm.sql`: arm CL (a closed composite is not enqueued), its twin, the new migration last in `RED-UNDER-SETUP`, count 23 to 24 in all three mentions.
- `test_ledger_refresh_gates.py`: `_STALENESS_VIEW_MIGRATION_NAME` moved with a dated paragraph, `_STALENESS_VIEW_SUPERSEDED_MIGRATION_NAMES` added and spread into `_PHASE_MIGRATION_NAMES`, window 7 (`20261114151700` to `20261114151701`) appended to `_PHASE_MIGRATION_WINDOWS`. Gate 3a needed the superseded set only through `_PHASE_MIGRATION_NAMES`; no other wiring.
- `ledger-refresh-go-live.md`: a dated `is_closed` paragraph under the migration table and one sentence at the P4 expected-census bullet.

## Evidence

SC-7 drill for arm I (Task 1), apply list without the new migration, quoted from the run:

```
psql:supabase/tests/test_ledger_refresh_staleness.sql:557: ERROR:  42703: column "is_closed" does not exist
```
(exit 3). With the full list: `ALL 9 ARMS EXECUTED (A-I) and passed` and the apply NOTICE `ledger_refresh_staleness re-defined with is_closed and closed_through; ACL and security_invoker verified`. After arms J-N: `ALL 14 ARMS EXECUTED (A-N) and passed`. Composite gate on the lane: `ALL 24 ARMS EXECUTED (A, ... W, CL) and passed`.

Rollback proof (SC-7, whole view change): staleness gate on the lane with the setup list plus the rollback file. The rollback applied and printed `Rollback 20261114151700: ledger_refresh_staleness restored to the 11-column view; ACL and security_invoker verified`; the gate then stopped with `ERROR:  42703: column "is_closed" does not exist` (exit 3) and printed no `TEST FAILED` line, so arms 0-H passed first.

Find-count table (`find` text occurrences over the raw new file, declared / measured, counted with `split(find).length - 1` because several finds hold newlines):

| arm | file | declared | measured |
|---|---|---|---|
| A, F | new | 1 | 1 |
| B, C, D | new | 1 | 1 |
| E1, E2 (view edit), G | new | 1 | 1 |
| E2 (parser edit), E3 | original | 1 | 1 |
| I, J, K, L, M, N | new | 1 | 1 |
| CL, D/precondition, E1/precondition (composite gate) | new | 1 | 1 |

Subset mutation run, staleness gate (per-file line): `file test_ledger_refresh_staleness.sql: sections 17 / judged 17 / annotated 17 / waived 0 / biting 17`, `arms: 17/17/0`, `No defects in the SUBSET`. Composite gate: `file test_ledger_refresh_composite_arm.sql: sections 30 / judged 30 / annotated 30 / waived 0 / biting 30`, `arms: 30/30/0`, `No defects in the SUBSET`. Every arm printed `RED (identity ok)`.

Other checks: `pytest tests/test_ledger_refresh_gates.py tests/test_sql_gate_scoped_updates.py` 41 passed; `lint-sql-gates` 0 findings; `lint-migration-data-dependence` 0 NEW; `lint-app-guc` 0 findings. `grep -a -c 'RED-UNDER-M:.*20260825120000_ledger_refresh_staleness_view.sql'` on the staleness gate is 2 (E2 parser edit, E3). The new file holds 0 hits for either fan-out name, the schedule verb and the unschedule verb. `UPDATE strategy_analytics` counts are unchanged (staleness 2, composite 0); all new fixtures seed by INSERT.

TDD note: arms J-N and CL were green on first run because Task 1 shipped the whole closed conjunction. Their RED evidence is each twin biting its own arm in the subset runs above, plus the omitted-migration and rollback drills. No conjunct was held back to manufacture a RED.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The composite gate's two view twins would have gone no-red**
- **Found during:** Task 3 reading.
- **Issue:** `D/precondition` and `E1/precondition` edit the original view file. With the new migration last in that gate's setup list, its `CREATE OR REPLACE VIEW` overwrites those edits, so both twins would report `no-red`. The plan said not to touch the composite gate's twins but did not foresee this.
- **Fix:** Re-pointed both to the new migration (finds re-counted: 1 each) and rewrote the header paragraph that said exactly two edit steps still name the original file. The composite fan-out body and its twins are untouched.
- **Files modified:** `supabase/tests/test_ledger_refresh_composite_arm.sql`
- **Commit:** d3ec06141

**2. [Rule 3 - Blocking] Three arm-count mentions, not two, in the composite gate**
- **Found during:** Task 3. Lines for the header, the twin prose of arm M2 and the executed notice all carry `ALL 23 ARMS EXECUTED`; all three moved to 24 (the staleness gate likewise: 14 in three places).

### Plan notes

- The plan's wording for twin M asks for a find that is distinct from twin B's; the chosen find is the opening parenthesis plus the `sa.strategy_id IS NULL` line, count 1, and B's find is a different string with count 1. No twin needed the fallback find.
- Arm N's check runs over every row of the view, as planned. This holds because `sql-tests` runs on a lane private to its runner (CLAUDE.md); it is not a shared-TEST assertion.
- `npm ci` was skipped on the orchestrator's note (node_modules present). mypy was not run on the gates file: CI's mypy target is `services/ routers/ models/`, not `tests/`.
- Census tests (`mutation-runner-floors`, `gate-family-meta`, `mutation-annotation-parser`, `drift-check-scripts`, `ci-anti-skip-gate.contract`) are expected RED until plan 07; not run, not edited. After Task 1's commit twins A-G still pointed at the original file until Task 2, as predicted.
- Process: the first pin-guard run came from the harness default cwd (the main checkout) and printed FATAL root-mismatch; nothing was written. Re-run from the pinned worktree it passed, and every later Bash call and commit ran `cd` into the pinned root first. The harness shell is zsh, so lane runs went through a bash helper script outside the repo.

## Known Stubs

None.

## Threat Flags

None. The only new surface is two read-out columns on a view that stays service_role-only with `security_invoker = true` (T-214-04, accepted in the plan).

## Open for the orchestrator

- SC-6 before merge: migration-reviewer and rls-policy-auditor on the new migration.
- SC-4 after merge: PROD read through the MCP, marker query first, expecting the two closed composites at `is_stale = false`, `is_closed = true`.
- Plan 07 owns the census moves (arm totals: staleness gate 8 to 14, composite gate 23 to 24; mutation floors by symbol).

## Self-Check: PASSED

Files found: the new migration, the rollback, both gate files, the gates python file and the runbook. Commits found as ancestors of HEAD: a57dd9641, 196cc6ea7, d3ec06141.
