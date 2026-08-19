# Phase 146.2 — deferred items (out-of-scope discoveries)

## 1. `seam-citations.invariant.test.ts` (SEAMPROSE-01) is RED on this branch — NOT caused by plan 07

**Found during:** 146.2-07 adjacent-suite sweep (2026-08-19), running the suites that
reference `CsvSubmitStep` / `csv-finalize`.

**Symptom:** `src/lib/seam-citations.invariant.test.ts > [SEAMPROSE-01] no bare file:line
citation on the seam surface > src/app/api/strategies/csv-finalize/route.ts carries no bare
file:line citation` fails with four offenders:

| route.ts line | bare citation | introduced by |
|---|---|---|
| 114 | `20260819151000_csv_finalize_fold_guard1_null_safe.sql:369` | 146.2-06 (R7 date fence) |
| 263 | `20260819151000_csv_finalize_fold_guard1_null_safe.sql:369` | 146.2-06 (R7 date fence) |
| 967 | `src/lib/queries.ts:126-127` | 146.2-01 (`CLOCK_SAFETY_KPI_COLUMNS`) |
| 1360 | `src/lib/queries.ts:126-127` | 146.2-01 (`CLOCK_SAFETY_KPI_COLUMNS`) |

**Pre-existing, proved:** all four lines are present in `git show
5cfb5ab6:src/app/api/strategies/csv-finalize/route.ts` — i.e. at plan 06's own HEAD, before
plan 07's first commit. Plan 07's whole diff (`git diff 5cfb5ab6..HEAD --stat`) is three
files, none of them `route.ts` or the invariant.

**Not fixed here, deliberately:** `route.ts` is owned by plans 01 and 06 and is explicitly
off-limits to plan 07 (SCOPE BOUNDARY + the plan-07 dispatch fence). Editing another plan's
file to green a gate it broke is exactly the cross-plan write this phase's sequencing exists
to prevent.

**What the fix is** (the invariant states its own protocol): convert each bare `file.ext:NN`
to a SYMBOL-ANCHORED reference — e.g. "GUARD 9 in
`20260819151000_csv_finalize_fold_guard1_null_safe.sql`" and "`PERCENTILE_ANALYTICS_COLUMNS`
in `queries.ts`". Both targets have in-repo symbols to anchor to, so no allowlist row is
warranted.

**Owner:** whoever next holds `route.ts` in this phase (plan 08, or a phase-level fix round).
⚠️ This is a CI gate, not a lint: it must be green before the branch merges.
