---
phase: 238-nevercomputed-a-strategy-that-never-computed-failed-or-stall
pr: PR-2 (FACT-03)
reviewed: 2026-11-26T11:30:00Z
depth: deep
diff: e510ef6c1..HEAD (non-planning, 23 files)
files_reviewed: 23
files_reviewed_list:
  - TODOS.md
  - src/__tests__/computed-at-reader-census.test.ts
  - src/__tests__/nevercomputed-backfill-sql-exec.test.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/never-computed-date.test.tsx
  - src/components/admin/AdminTabs.test.tsx
  - src/components/admin/AdminTabs.tsx
  - src/components/strategy/FactsheetPreview.test.tsx
  - src/components/strategy/StrategyGrid.test.tsx
  - src/components/strategy/StrategyTable.stale-analytics.test.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/SyncBadge.trade-fetch.test.tsx
  - src/lib/database.types.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/never-computed-stamp.test.ts
  - src/lib/factsheet/never-computed-stamp.ts
  - src/lib/queries.ts
  - src/lib/stored-analytics-result.ts
  - src/lib/types.ts
  - supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql
  - supabase/migrations/down/20261126130000-rollback.sql
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
  necessity: 0
status: issues_found
---

# Phase 238 PR-2 (FACT-03): Code Review Report

**Reviewed:** 2026-11-26
**Depth:** deep (cross-repo reader sweep beyond the census)
**Files Reviewed:** 23
**Status:** issues_found (1 MEDIUM, not user-facing; the rest LOW/INFO)

## Summary

PR-1 findings in `238-REVIEW.md` were read and are not repeated.

**The reader sweep found no reader that crashes or mislabels on a NULL date.** I grepped the whole
repo for `computed_at` / `computedAt` / `analytics_computed_at` / `last_success_computed_at`. That
covered `src/`, `analytics-service/` (bare word), `supabase/schema/baseline.sql` (every function, view
and trigger body, not only `supabase/schema/functions/`), `scripts/`, `e2e/`, `.github/` and
`supabase/tests/`. Every strategy-column reader I found is in the census and carries a working NULL
arm:
- the factsheet stamp (Terms, footer, chip)
- the cache key `?? "0"` and the PDF ETag `?? ""`
- `isSameInstant` failing closed
- `freshnessScore` / `computeFreshness`
- `SyncBadge`, `AdminTabs`, `FactsheetPreview`
- the wizard `typeof` narrowing
- the `finalize-rerun` NaN check
- Python `_non_empty_str`, `isinstance(..., str)` and `_minute(None)`

The other Python `computed_at` sites all read other tables (`match_batches`, `portfolio_analytics`,
`allocator_equity_derived`). No `.order("computed_at")` reads `strategy_analytics`, so NULL placement
in an ORDER BY does not arise. No SQL function compares `sa.computed_at`. The baseline holds 144
function definitions; the census corpus has 142 files, and no function name is missing from it
(overloads account for the gap).

**Checked, and not a finding.** The `FreshnessChip` guard now also matches `""`, and the scenario
payload carries `computedAt: ""`. But `ScenarioFactsheetChart` passes `hideHeader`, so no chip renders
in scenario mode. `formatDay("")` already returned `—` (`src/lib/utils.ts:158-159`), so the scenario
footer and Terms row are unchanged. `_minute(None)` returns `"n/a"` (`mt5_parity_findings.py:177-178`).
`job_worker.py:15985`'s order is on `portfolio_analytics`.

Necessity: the reference file was not read. No necessity findings were assessed (`necessity: 0`).

**The migration predicate and guard are sound.** The predicate is narrower than
`hasStoredAnalyticsResult`, the hold-trigger bypass is contained in one transaction, and the guard
uses the linter-accepted shape. The exec test bites: it covers bypass removal, enable removal, rollback
without the bypass, and the post-migration writes.

**The one MEDIUM is a predictable CI break.** The exec test builds its fixture from
`supabase/schema/baseline.sql`, and the bot re-dump after the PROD apply rewrites that file.

## Warnings

### PR2-WR-01: [MEDIUM, not user-facing: CI/test integrity] The exec test reads the pre-migration column shape from `baseline.sql`, so the post-apply baseline re-dump turns it red

**File:** `src/__tests__/nevercomputed-backfill-sql-exec.test.ts:145-154` (`schemaSql`/`extractTable`). It fails at `:295` (`VACUITY ... carries NOT NULL DEFAULT`), `:336` (`COLUMN SHAPE`) and `:368`/`:381` (the two `FAILS LOUD` arms).

**Issue:** The template's `strategy_analytics` DDL is cut verbatim from `supabase/schema/baseline.sql`.
The migration header says the bot re-dump PR after the PROD apply owns `baseline.sql` (Phase 164.9.5).
That is the same flow as #1350 "baseline re-dump after the PROD apply of 2636fb1e". After the re-dump,
the CREATE TABLE reads `"computed_at" timestamp with time zone,`, with no `DEFAULT` and no `NOT NULL`.
The template then starts already migrated:
- `columnShape("tmpl")` is `{notnull:false, hasdef:false}`, so the VACUITY arm fails.
- `COLUMN SHAPE`'s pre-apply `toEqual({notnull:true, hasdef:true})` fails.
- Both `FAILS LOUD` arms assert the rolled-back shape is `{true,true}` and fail.
- The rollback arms keep passing, because the rollback itself restores `{true,true}`.

The test has no re-dump handling (no `grep` hit for re-dump or carried). So the bot's re-dump PR, or
main straight after it, goes red on a file nobody touched. Under the house rule, the remedy is a fix,
never a skip.

**How established:** by reading, not by running. The template is `extractTable()` plus a primary key
only, and nothing restores the column's default or NOT NULL.

**Deadline:** the re-dump follows the PROD apply automatically. If this is booked instead of fixed in
this PR, the bot's re-dump PR goes red.

**Fix (minimal):** pin the pre-migration contract in the fixture so it does not depend on the dump's vintage:
```ts
return [
  extractTable(),
  "ALTER TABLE public.strategy_analytics ADD PRIMARY KEY (id);",
  // The PRE-migration column contract, restated so the post-apply baseline re-dump (which drops it) cannot pre-migrate the fixture.
  "ALTER TABLE public.strategy_analytics ALTER COLUMN computed_at SET DEFAULT now(), ALTER COLUMN computed_at SET NOT NULL;",
  ...funcs, ...extractTriggers(),
].join("\n");
```
On today's baseline this is a no-op. Prove it can fail: hand-edit a copy of the baseline's column line
to the post-dump form, then run the test with and without the line. It should be RED without the line
and GREEN with it.

## Info (LOW / INFO, recorded here only per the TODOS rule; not to be fixed)

### PR2-IN-01: [LOW] `isNeverComputedStamp` matches the literal `1970-01-01T00:00:00Z` only, so the rollback's stated rationale is false

**File:** `src/lib/factsheet/never-computed-stamp.ts:15-17`; `supabase/migrations/down/20261126130000-rollback.sql:28-33`

**Issue:** The rollback fills NULLs with `TIMESTAMPTZ 'epoch'` and justifies this by saying FactsheetView
"holds the same literal as its EPOCH_SENTINEL, so the chip renders its 'not computed' state". That is
wrong twice over:
- PostgREST serialises a timestamptz as `1970-01-01T00:00:00+00:00`, which is not equal to the `...Z`
  literal. After a rollback, the Terms row and footer print `Jan 1, 1970`, and the chip computes an
  age of about 20000 days.
- `EPOCH_SENTINEL` no longer exists, because this PR moved it to `NEVER_COMPUTED_STAMP`.

This matters only if the manual rollback is ever run, and the old code had the same exact-match
behaviour.

**Fix (if ever touched):** `return !value || value === NEVER_COMPUTED_STAMP || Date.parse(value) === 0;`, and correct the rollback comment.

### PR2-IN-02: [LOW] "NULL = never computed" is not strictly true: `complete` + NULL is reachable, and two comments say otherwise

**File:** `src/lib/types.ts:307-309`; migration header, `CALLER IMPACT` ("a write to complete ... stamps the date")

**Issue:** Branch (c) of the status bridge writes no date (`baseline.sql`
`sync_strategy_analytics_status`, the `VALUES (p_strategy_id, 'complete', ...)` INSERT and its
`ELSE 'complete'` ON CONFLICT arm). The b-prime refused-derive arm, which returns `computing` to
`complete`, writes none either. Either can therefore leave a `complete` row with a NULL date. RESEARCH
and UI-SPEC N1 knew this, and every reader tolerates it: the `AdminTabs` test even pins it. The two
comments are still inaccurate.

**Fix:** reword them to "NULL = no runner success has stamped this row".

### PR2-IN-03: [LOW] Stale comments and a stale prop type left by the flip

**File:** `src/components/admin/AdminTabs.tsx:384-392`; `src/components/strategy/StrategyHeader.tsx:41`; `src/lib/factsheet/fetch-and-build-payload.ts:982-990`

**Issue:** Three leftovers:
- The `computeRecency` doc still says a bridge insert "takes the column default `computed_at = now()`".
- `StrategyHeader`'s prop is still typed `computedAt?: string`. It has no caller.
- The builder's `console.warn("... analytics.computed_at missing, freshness chip will show epoch")`
  now fires on every build of a never-computed row, which is a legitimate state. Its text is also
  wrong: the chip shows "Computed · not yet", not the epoch.

### PR2-IN-04: [INFO] The SQL gate corpus naming `computed_at` was not run against the migrated schema

**File:** `supabase/tests/test_strategy_analytics_computed_at_success_only.sql`, `test_sync_status_computed_at_runner_only.sql`, `test_sync_status_analytics_scope.sql` and others

**Issue:** 238-09 recorded the local-stack lane as NOT RUN, because there was no Docker. A read-through
suggests the gates tolerate the change: the `computed_at` arms seed explicit dates, and F1-EDGE reads
`atthasdef` and expects NULL when no default exists. But CI `sql-tests` (Decision F replay) is the only
execution, so treat its first run on the PR as the real gate.

### PR2-IN-05: [INFO] The census arm pin is file-level presence

**File:** `src/__tests__/computed-at-reader-census.test.ts` (`arm` check)

**Issue:** An `arm` passes if its literal appears anywhere in the stripped file. So if one read is
swapped for an unsafe read and the token count stays the same, nothing fails. This is a known and
stated limit. `tsc` covers it for TypeScript, but nothing covers it for the Python dict reads
(`job_worker.py`, `mt5_parity_capture.py`). Acceptable as is.

## Checks run

- `npx vitest run src/__tests__/computed-at-reader-census.test.ts src/lib/factsheet/never-computed-stamp.test.ts "src/app/factsheet/[id]/v2/never-computed-date.test.tsx" --maxWorkers=2`: 3 files, 22 tests passed.
- Not run, by the load limit and not for lack of binaries (238-09 ran it green): the exec test, typecheck, the full suite, the SQL corpus (no Docker), pytest and mypy. PR-2 touches no Python file.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure-hunter findings, round 1 (appended by the review-loop orchestrator)

Each finding was checked against the code before it was dispositioned.

### PR2-SFH-01: [MEDIUM, user-facing and CI] Seeders relied on the dropped `DEFAULT now()`
These `complete` inserts with full figures set no `computed_at`, so after the migration they store NULL:
- `e2e/helpers/seed-test-project.ts` (three `strategy_analytics` inserts)
- `scripts/seed-demo-data.ts` (upsert)
- `scripts/seed-full-app-demo.ts` (insert)

Consequences:
- `e2e/freshness-chip-width.spec.ts` test b asserts "Computed · fresh" on a `seedStrategyWithHistory` row. The e2e-seeded lane replays the migration, so that test would read "not yet" and fail.
- Re-seeded demo strategies would show no compute date although they hold figures.

Verified: none of the five inserts names `computed_at`. **Disposition: FIX (round 1).** Set `computed_at` to now in each insert.

### PR2-SFH-02: [MEDIUM, user-facing after a rollback] `isNeverComputedStamp` is an exact-string compare, and the rollback header's claims are false
- The rollback fills NULLs with `TIMESTAMPTZ 'epoch'`. PostgREST serializes that as `1970-01-01T00:00:00+00:00`, which does not match `...Z`. After a rollback the chip, the Terms cell and the footer would print Jan 1, 1970.
- The header also cites the deleted `EPOCH_SENTINEL`.
- It also says `freshnessScore` reads the epoch as 0. `health-score.ts` returns 0 only for null or empty input.

This is the same defect as PR2-IN-01, which the code reviewer graded LOW. The orchestrator raised it to MEDIUM because the rollback's stated safety rests on it. **Disposition: FIX (round 1).** Match any value that parses to instant 0, add a `+00:00` test case, and correct the rollback header text.

### PR2-SFH-03 [LOW] Stale and noisy `console.warn` in `fetch-and-build-payload.ts`. Same as PR2-IN-03. Recorded, not fixed.
### PR2-SFH-04 [LOW/INFO] `complete` with a NULL date is reachable through the bridge's INSERT arm. Same as PR2-IN-02. Recorded, not fixed.
### PR2-SFH-05 [LOW] Two encodings for "no date" (`""` and `null`). `StrategyHeader` prop type. Recorded, not fixed.
### PR2-SFH-06 [LOW] The backfill can restamp `computing_started_at` on a computing row whose stamp is NULL. Documented in the migration; PROD has 0 such rows. Recorded, not fixed.
### PR2-SFH-INFO: the SQL census corpus omits post-baseline migration bodies, and the census does not cover `scripts/` or `e2e/` writers. That gap is the root of SFH-01. Recorded.

## Orchestrator dispositions, round 1
- PR2-WR-01 MEDIUM: verified. The fixture DDL is extracted from `baseline.sql`, which the post-apply re-dump rewrites. **FIX.**
- PR2-SFH-01 MEDIUM: **FIX.**
- PR2-SFH-02 / PR2-IN-01 MEDIUM: **FIX.**
- Every other finding is LOW or INFO and is recorded only.

## Round 2 re-review

**Reviewed:** 2026-11-26, by gsd-code-reviewer
**Scope:** `git diff 0c86cc3d9..HEAD -- . ':!.planning'` (three fix commits: e2676ef13, dbfea0bb2, 1b7cc6503; 9 files), plus a sweep for any other `isNeverComputedStamp` caller and any `strategy_analytics` seeder that still omits `computed_at`.
**Verdict:** all three round-1 MEDIUMs are RESOLVED. The fixes add no new MEDIUM+. Two LOW/INFO items are recorded below and are not to be fixed.

### Round-1 findings

- **PR2-WR-01: RESOLVED, and the fix is proven to bite.** `src/__tests__/nevercomputed-backfill-sql-exec.test.ts:153-160` now restates `SET DEFAULT now(), SET NOT NULL` after `extractTable()`. Proof from a throwaway scratch copy (deleted afterwards; no tracked file was edited):
  - I made a baseline copy in which `strategy_analytics.computed_at` (`supabase/schema/baseline.sql:14751`) has the post-re-dump form `"computed_at" timestamp with time zone,`.
  - I pointed the test's `REPO` at that copy. **With** the new line: 17/17 green. **Without** it: exactly the 4 arms round 1 predicted go red (`VACUITY`, `COLUMN SHAPE`, both `FAILS LOUD`), and the other 13 stay green.
  - On today's baseline the line is a no-op (the test is green in-tree).
- **PR2-SFH-01: RESOLVED.** All five named inserts now stamp `computed_at: new Date().toISOString()`:
  - `e2e/helpers/seed-test-project.ts:775,1644,1842`
  - `scripts/seed-demo-data.ts:986`
  - `scripts/seed-full-app-demo.ts:1664`

  The fix commit also stamps two live-DB test seeders that the finding did not name: `src/__tests__/verified-cohort-rank-rls.test.ts:384` and `src/lib/anon-strategies-live-probe.test.ts:213`. `seedCompositeStrategy` (`e2e/helpers/seed-test-project.ts:1345`) already carried a fixed date. `e2e/freshness-chip-width.spec.ts` test b reads a `seedStrategyWithHistory` row, so it is covered.
- **PR2-SFH-02 / PR2-IN-01: RESOLVED for the code.** `src/lib/factsheet/never-computed-stamp.ts:20` now adds `Date.parse(value) === 0`.
  - **Callers:** there are exactly three: the `FactsheetView.tsx:1848` chip, the `FactsheetView.tsx:3456` footer stamp and `MandatePanels.tsx:95` Terms. `fetch-and-build-payload.ts:993` only produces the constant.
  - **Effect of the new arm:** it changes behaviour only for strings that parse to instant 0. No real compute date can be one. A non-date string gives `NaN`, so it stays `false`, as before.
  - **Rollback header:** the `freshnessScore` sentence is now correct (`src/lib/health-score.ts:27-32` returns 25 for an epoch date). The deleted `EPOCH_SENTINEL` is no longer cited. The residue is R2-IN-01 below.

### Seeder sweep (complete rows with figures that omit `computed_at`)

- **Other writers checked:** every `from("strategy_analytics").insert|upsert` in `e2e/`, `scripts/` and `src/**/*.test.ts` was read.
  - The `upsert`s in `scenario-commit-*`, `bridge-outcome*`, `match-decisions-xor-rls` and `bridge-outcomes-voluntary-schema` set no `computation_status` and seed only `returns_series`. They are not complete-with-figures rows, and none of them reads `computed_at`.
  - `src/__tests__/factsheet-buildable-live-db.test.ts:96,104,120` seeds `complete` rows with no date. That test asserts buildability and owner-seen status only, and never a date, so it is not a finding.
- **Not swept here:**
  - `supabase/seed*` does not exist in this repo.
  - The `supabase/tests` SQL corpus stays under PR2-IN-04 (CI `sql-tests` is the first execution).
  - Python runner writers are out of scope for this round. Round 1 verified them.

### New findings (LOW/INFO, recorded only, not to be fixed)

#### PR2-R2-IN-01: [LOW] The rollback header contradicts itself, and it understates the visible cost

**File:** `supabase/migrations/down/20261126130000-rollback.sql:33-45,54-56`

**Issue:** The header gives two pieces of advice that do not fit together:
- The epoch rationale now says the renderers recognise `+00:00` through `isNeverComputedStamp`, which is PR-2 code.
- Line 54 says "ROLL THE CODE BACK FIRST".

The pre-PR code compared against the exact `...Z` literal (`e510ef6c1:src/app/factsheet/[id]/v2/FactsheetView.tsx:1852`). So in the order the header recommends, the chip prints `Jan 1, 1970 (~20000d)`, which is the round-1 defect again. "The one visible cost: SyncBadge" also leaves out two readers:
- `src/components/strategy/FactsheetPreview.tsx:76-77` would print `Data from exchange API · Jan 1, 1970`.
- `AdminTabs` would print a very large recency for a `complete` epoch row.

**Why LOW:** this is a manual, off-auto-apply path. The error goes toward "very old" and never toward "current", which is the safety the header actually claims.

**Fix (if ever touched):** say that the not-computed chip needs the PR-2 readers still deployed, and list FactsheetPreview and AdminTabs next to SyncBadge.

#### PR2-R2-IN-02: [INFO] The VACUITY arm now pins the fixture, not the dump

**File:** `src/__tests__/nevercomputed-backfill-sql-exec.test.ts:302`

**Issue:** The pre-apply `{notnull:true, hasdef:true}` assertion is now satisfied by the fixture's own `ALTER`, so it no longer says anything about `baseline.sql`'s column. This is intended, and it is what makes the gate dump-vintage-proof. If the `ALTER` line is removed, the arm still fails once the dump is post-migration.

### Checks run (round 2)

- `npx vitest run src/lib/factsheet/never-computed-stamp.test.ts "src/app/factsheet/[id]/v2/never-computed-date.test.tsx" src/__tests__/nevercomputed-backfill-sql-exec.test.ts src/__tests__/computed-at-reader-census.test.ts --maxWorkers=2`: 4 files, 40 tests passed.
- The WR-01 red/green proof against a post-re-dump baseline copy (scratch, `--maxWorkers=1`): 17/17 with the line, 4 failed and 13 passed without it.
- **Not run (load limit):** typecheck, the full suite, e2e (it needs the stack), the SQL corpus (no Docker), pytest and mypy. No Python file changed in the fix commits.

_Round 2 reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_

## Silent-failure-hunter, round 2 (appended by the review-loop orchestrator)
No MEDIUM or higher finding. PR2-SFH-01, PR2-SFH-02 and PR2-WR-01 are confirmed closed. Recorded only:
- PR2-SFH-R2-01 [LOW]: `src/__tests__/factsheet-buildable-live-db.test.ts` still seeds `complete` rows with no `computed_at`. That test never reads a date, which the code reviewer confirmed. Not fixed.
- PR2-SFH-R2-02 [INFO]: after a manual rollback, the epoch fill makes `freshnessScore` return 25 where a NULL date gave 0. The rollback header now documents this. Not fixed.

## Final verdict (orchestrator)
- Two rounds ran. Round 1 found 3 MEDIUMs. Fixes:
  - `e2676ef13` for PR2-SFH-01
  - `dbfea0bb2` for PR2-SFH-02 / IN-01
  - `1b7cc6503` for PR2-WR-01
- Round 2 found no MEDIUM or higher in either reviewer. **No open MEDIUM or higher finding.**
- Nothing was routed to `TODOS.md`. Every survivor is LOW or INFO and is recorded only here:
  - IN-02 through IN-05
  - SFH-03 through SFH-06
  - R2-IN-01 and R2-IN-02
  - SFH-R2-01 and SFH-R2-02
- PR2-R2-IN-01 is graded LOW. The rollback header's "roll the code back first" order would show the epoch date on surfaces that only pre-PR code serves. The rollback is manual and off the auto-apply path, and a wrong epoch date makes a row read as very old, never as current. The next time the rollback header is edited, take the chance to correct it.
- The only change under `supabase/migrations/` was to the header comment of `down/20261126130000-rollback.sql`; no SQL statement changed. migration-reviewer and rls-policy-auditor were not run again, and the verdict in 238-MIGRATION-REVIEW.md still stands.
