---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
plan: 01
subsystem: database
tags: [postgres, rpc, security-definer, mutation-gate, discovery, strategy_keys]
requires: []
provides:
  - get_published_trade_venues reads only open strategy_keys windows (D-01)
  - 12-arm SQL gate with TV-closed-window and TV-window-end-today
affects: [discovery, syncbadge]
key-files:
  created:
    - supabase/migrations/20261114120000_get_published_trade_venues_open_windows.sql
    - supabase/migrations/down/20261114120000-rollback.sql
  modified:
    - supabase/schema/functions/get_published_trade_venues.sql
    - supabase/tests/test_get_published_trade_venues.sql
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/components/strategy/SyncBadge.venue.test.tsx
    - src/lib/queries.trade-venues.test.ts
decisions:
  - "D-01..D-09 implemented as planned; TV-window-end-today needs a layered second step because the runner replaces only the first occurrence"
metrics:
  completed: 2026-11-14
status: complete
actuals:
  tokens: 90000
  tasks: 3
  commits: 2
plan_head_before: 06afba4e72f72c0e79ccd1f18dca0f49a7efbbfc
plan_head_after: 42abf5794295b8eaf23288f8a1110b6513838ec3
commits: 2
---

# Phase 210 Plan 01: open-window venue read Summary

`get_published_trade_venues(uuid[])` now ignores a `strategy_keys` member whose window has closed (end on or before today), so a key rotation no longer raises a false `Listed as X; trades come from Y, X.` cue on Discovery; the SQL gate proves it with two new arms that go RED when the predicate is loosened.

## Commits

- `6aff1a2f5` feat(210-01): migration, rollback, regenerated snapshot, re-pointed gate with two new arms, ARMS_FLOOR 830 to 832 and every census pin (Tasks 1 and 2, one commit per D-09).
- `42abf5794` test(210-01): SyncBadge rotation contract pair and the all-windows-closed reader case (Task 3).

## Verbatim readings

- `--parse-only` (exit 0): `test_get_published_trade_venues.sql: 12 prose / 12 twin(s) / 0 waiver(s)`, `coverage: files 81/108`, `arms: 0/832/0   (executed/annotated/waived)`, `No static defects`.
- SUBSET run of the one gate file (exit 0): `arms: 12/12/0`, `biting: 12`, `lane-invocations: 12`, per-file `sections 12 / judged 12 / annotated 12 / waived 0 / biting 12`, `lane-probe: pg_cron AVAILABLE`, `ARMS_FLOOR (static upper bound): 832 annotated-unwaived >= floor 830`.
- VAC-04 ack hash used (normalized sha256 of the committed snapshot before the change): `1dd7db89ef0e3df11e878f2ab68bfb79c8e91dc31ad6ec0cac06965ab90e2d48`. If CI's VAC-04 prints a different live hash, that printed line replaces it.
- `baseline-content-drift`: `MATCH 130, DRIFT 4, findings 1`: the one new finding is `DRIFT get_published_trade_venues/1` (baseline.sql still holds the old body). Expected until the post-apply baseline re-dump; no allowlist row added.
- Other gates: `lint-sql-gates` 0 findings; `lint-migration-data-dependence` 0 NEW; `lint-app-guc` findings 0; `check-baseline-currency --replay-set` `replay=1 defects=0`; `schema:functions:check` current.
- Vitest: gate-family-meta, mutation-annotation-parser, mutation-runner-floors (133 tests), the seven migration-scanning files (238 passed, 16 skipped), SyncBadge.venue and queries.trade-venues (58 passed).
- The FULL local mutation run was NOT run (about 1.8 GB free on the data volume against roughly 15 GB needed). CI `sql-mutation` runs FULL on the PR because the floors file is edited. `npm test` (full suite) was also NOT run in this executor (context budget); the targeted census files above were.
- Neuter proof (Task 3): `.some(` to `.every(` in SyncBadge.tsx turned the new badge test RED (2 failed); restored from a byte backup, shasum equal, GREEN again.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan] TV-window-end-today needs a layered second step; TV-closed-window prose corrected**
- **Found during:** Task 1 Step 6 (SUBSET run printed `wrong-first-failure` / NO-IDENTITY for TV-window-end-today).
- **Issue:** the plan assumed a single `occurrences:2` edit rewrites both the body predicate and the self-verify literal. The runner counts occurrences but replaces only the FIRST. With `>=` the body no longer contains `sk.window_end > current_date`, so the migration's own self-verify aborted the apply (confirmed by teeing the lane output). TV-closed-window works as planned only because `... > current_date - 3650` still contains the shorter literal.
- **Fix:** TV-window-end-today now has two edit steps (body, then the remaining self-verify literal), LAYERED like TV-shape; prose of both arms corrected. Census therefore moved by +8 steps (951), not the plan's +7 (950); vitest confirmed 951.
- **Files modified:** supabase/tests/test_get_published_trade_venues.sql, src/__tests__/mutation-annotation-parser.test.ts
- **Commit:** 6aff1a2f5

**2. [Rule 3 - Blocking] `npm ci` run once** because `node_modules` was absent in this worktree.

**3. TV-unpublished-composite replace text:** the plan's "same text without the status line" would leave an `AND` with no `WHERE`; the replace keeps `WHERE s.id = ANY(p_strategy_ids)` followed by the window line (arm bites, identity ok).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, grant or table surface: signature, result table, SECURITY DEFINER, pinned search_path and grants are unchanged and re-asserted by the self-verify.

## Review reminder

Pre-merge (phase review step, not this executor): migration-reviewer and rls-policy-auditor must be clean on the new migration; PROD auto-applies after `apply-test`.

## Self-Check: PASSED

Files and both commits verified present (`6aff1a2f5`, `42abf5794`).
