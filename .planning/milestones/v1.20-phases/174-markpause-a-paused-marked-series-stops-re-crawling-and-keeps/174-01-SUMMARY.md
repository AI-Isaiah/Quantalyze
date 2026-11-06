---
phase: 174-markpause-a-paused-marked-series-stops-re-crawling-and-keeps
plan: 01
subsystem: database
tags: [postgres, pg-cron, ledger-refresh, sql-gates, mutation-runner]

requires:
  - phase: 164.6
    provides: the single-key fan-out body (20260924120000) this plan re-bases
provides:
  - "single-key ledger fan-out keeps a 7-day attempt cooldown for a strategy whose analytics carry the marks-paused flag, 20 hours for every other stale strategy"
  - "gate arms P1, P2, P3 (matched pair plus re-admission) with machine-executable twins"
affects: [174-02, ledger-refresh runbook, mutation-runner floors]

actuals:
  tokens: 58030
  tasks: 3
  commits: 3
plan_head_before: 2941b367ac3766dde17d4759882d35d7b24b6295
plan_head_after: c77cb116c610cc404a913427175a63a37a5312a4

tech-stack:
  added: []
  patterns:
    - "twin mutations that keep the verify-needle token inside the replacement, so the apply survives and the ARM is the first failure"

key-files:
  created:
    - supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql
  modified:
    - supabase/tests/test_ledger_refresh_fanout.sql
    - scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql
    - analytics-service/tests/test_ledger_refresh_gates.py
    - .github/workflows/ci.yml
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/drift-check-scripts.test.ts
    - docs/runbooks/ledger-refresh-go-live.md

key-decisions:
  - "D-01 (founder, quoted from CONTEXT): re-admit weekly. Only the attempt-cooldown window changes; the staleness view, the composite arm and every other bound are byte-identical."
  - "Twins keep the original token inside their replacement so the apply-time verify (which needles the flag key and the seven-day interval) survives each mutation."

requirements-completed: [SC-1, SC-3]

coverage:
  - id: D1
    description: "A paused marked strategy with a 2-day-old attempt is not enqueued; the identical unpaused strategy is; a paused one with an 8-day-old attempt is"
    requirement: SC-1
    verification:
      - kind: integration
        ref: "supabase/tests/test_ledger_refresh_fanout.sql arms P1, P2, P3 (pg-lane, green; each twin RED on its own arm)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The SQL gate goes RED on today's daily behaviour (P1 RED at the base migration)"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "/tmp/markpause-01/red-at-base.log: TEST FAILED (P1) at 20260924120000"
        status: pass
    human_judgment: false

duration: ~2h20m wall (two ~30 min full mutation runs of that)
completed: 2026-10-27
status: complete
---

# Phase 174 Plan 01: Weekly re-admit of a paused marked series

**The single-key ledger fan-out now gives a strategy whose analytics carry `marks_trailing_since` a 7-day attempt cooldown instead of 20 hours (re-derive weekly, not daily), proven RED at the base migration and with every arm and twin biting in a clean full mutation run (806/806).**

## Performance

- **Tasks:** 3 of 3
- **Task commits:** 3 (`634cf10c2`, `d165b4abc`, `c77cb116c`), measured with `git rev-list --count` from the ledger base `2941b367a`
- **Files:** 1 created, 10 modified

## Accomplishments

- Forward migration `20261030120000_ledger_fanout_marks_paused_weekly.sql` re-creates `enqueue_ledger_refresh_for_strategies` ALONE (no composite body, no `cron.schedule`/`cron.unschedule`, no `PERFORM` of a fan-out). The re-base diff against 20260924120000's single-key body is **16 changed lines** (1 removed, 15 added: the new comment block and the `CASE`), saved at `/tmp/markpause-01/rebase.diff`. The extracted old body also equals the committed snapshot byte for byte. Catalogue-only `$verify$` block (pg_proc/pg_get_functiondef/aclexplode only), carrying every single-key check of the old block plus a new check 12 (flag key and seven-day interval both present).
- Arms P1 (paused, attempt 2 days old: not enqueued), P2 (identical unpaused strategy: enqueued) and P3 (paused, attempt 8 days old: enqueued, so the pause throttles and never excludes) in `test_ledger_refresh_fanout.sql`, with fixture `strategy_analytics.data_quality_flags JSONB` added to pg-lane fixture 03.
- All 29 pre-existing edit-kind twin steps re-pointed to the new migration and recounted on its bytes.

## Evidence

**Base RED (Task 1).** At the apply list ending 20260924120000, the gate fails with `TEST FAILED (P1): a strategy whose marks are PAUSED and whose last derive attempt is 2 days old was enqueued (1 new job(s)), expected 0 ...` (`/tmp/markpause-01/red-at-base.log`, exit 3). P2 is not reached in that run; re-run with P1's raise downgraded to a NOTICE in a scratch copy of the gate (`base-p2-probe.log`), P1 reports WOULD-FAIL and the file reaches the end with exit 0, so P2 passes at base. GREEN with the new migration last: `t1-green.log`, exit 0.

**Recount (Task 2)**, `/tmp/markpause-01/recount.txt`, `grep -c -F` on the new file's bytes (the new file holds one body, so needles that matched twice now match once):

| needle (arms) | before occ/nth | after occ/nth |
|---|---|---|
| `INTERVAL '20 hours'` (E, F) | 4 / 1 | 2 / 1 |
| `INTERVAL '20 hours'` (T) | 4 / 2 | 2 / 2 |
| 18 other needles (M1, M2, E x2, C, H x3, N, N2, N3, V1, V2, W, W/deadlock ...) | 2 / 1 | 1 / none |
| needles that already matched once (A, K, L, B, P, D, G1, G2, R, U) | 1 / none | 1 / none |

New twins: P1 `THEN INTERVAL '7 days'` -> `... - INTERVAL '6 days'` (occ 1); P2 the flag test widened with `OR sa.data_quality_flags = '{}'::jsonb` (occ 1); P3 `THEN INTERVAL '7 days'` -> `... + INTERVAL '23 days'` (occ 1).

**Narrowed mutation run** (`t2-mut.log`): `arms: 35/35/0`, `biting: 35`, `lane-invocations: 35`, `sections 35 / judged 35 / annotated 35 / waived 0 / biting 35`; zero `no-red`, `occurrence-mismatch`, `MEASURE_FAIL`. Lines quoted:

```
  arm P1                       exit   3  RED (identity ok)  (1.5s)
  arm P2                       exit   3  RED (identity ok)  (1.4s)
  arm P3                       exit   3  RED (identity ok)  (1.4s)
```

**Drills (neuter from byte backup, see RED, restore, cmp):**
1. Migration `THEN INTERVAL '7 days'` replaced by `THEN INTERVAL '20 hours' /* INTERVAL '7 days' */` (the block comment keeps the verify needle alive): pg-lane gate exits 3 with `TEST FAILED (P1)` (`t2-drill-red.log`).
2. The plain neuter without the comment: the apply itself aborts in check 12 (`... no longer carries the marks-paused attempt window`), so the verify block catches a re-base that drops the window (`t2-drill-verify.log`).
3. Restored with `cp` from `/tmp/markpause-01/mig.bak`; `cmp` exit 0.
4. Floors drill: `ARMS_FLOOR` set to 803 on a byte backup, `mutation-runner-floors.test.ts` went RED with `The corpus declares 806 twin(s) of which 0 are waivers, so a green run bites 806. ARMS_FLOOR is 803.`; restored with `cp`, `cmp` exit 0.
5. Static gate with the pointer left on 20260924120000 and the new migration present (`t3-py-red-pointer-unmoved.log`): 3 failed (`test_3a` escape check, `test_3b`, `test_10c`), 34 passed. After the pointer move, window 6 and the superseded-set entry: 37 passed.

**Static gate / censuses (Task 3).** Pytest `37 passed`, no failed/error/skipped. mypy (CI's line verbatim, from `analytics-service/`): `Success: no issues found in 123 source files`. Census vitest set: 4 files, 295 passed. A wider set of 29 files that mention the corpus or migrations: 1956 passed, 1 failed before the `drift-check-scripts.test.ts` pin below was moved; that test then passed. `lint-sql-gates`: 0 findings; `lint-app-guc`: 0 findings.

**Clean full mutation run** (`full-run3.log`, tree clean, exit 0): `scope: FULL 80/80 annotated files`, `coverage: files 80/107`, `arms: 806/806/0`, `biting: 806`, `lane-invocations: 806 ... plus 80 baseline / 80 restore leg(s)`, `lane-blocked: 0`, `test_ledger_refresh_composite_arm.sql: sections 29 / ... biting 29` (unchanged), `test_ledger_refresh_fanout.sql: sections 35 / judged 35 / annotated 35 / waived 0 / biting 35`, `No defects. Every annotated arm bit its own arm first.`

## Census before/after

| file | before | after |
|---|---|---|
| `test_ledger_refresh_fanout.sql` arms / sentinel | 26 | 29 (`ALL 29 ARMS EXECUTED`, roster adds P1, P2, P3) |
| `test_ledger_refresh_fanout.sql` twin sections | 32 | 35 |
| `.github/workflows/ci.yml` sentinel table row | 26 | 29 |
| `.github/workflows/ci.yml` `ARMS_FLOOR` (sentinel step) and its sum | 373 | 376 (SENTINEL_FLOOR stays 24) |
| `scripts/mutation-floors.mjs` `ARMS_FLOOR` | 803 | 806 (FILES_FLOOR stays 80, WAIVED_CEILING stays 0) |
| `mutation-runner-floors.test.ts` | 803 aggregate, fan-out row 32 | 806, row 35 (18 code lines moved +3) |
| `mutation-annotation-parser.test.ts` | armsSeen 803, stepsSeen/needles 916 | 806, 919 |
| `gate-family-meta.test.ts` | threshold key `ARMS_FLOOR=803` | `ARMS_FLOOR=806` |
| `ci-anti-skip-gate.contract.test.ts` | unchanged text; re-derives the table | green at 29 / 376 |
| `drift-check-scripts.test.ts` (OPS-08-F9 pin) | `ARMS_FLOOR=373` | `ARMS_FLOOR=376` |
| `test_ledger_refresh_gates.py` | `_FANOUT_MIGRATION_NAME` 20260924120000, 5 windows | 174 migration, 20260924120000 joins `_FANOUT_SUPERSEDED_MIGRATION_NAMES`, `_COMPOSITE_MIGRATION_NAME` unchanged, window 6 added |

Window 6 measurement, run on the final bytes of the new file: `grep -ac 'cron\.schedule'` -> 0; `grep -ac 'cron\.unschedule'` -> 0; `grep -acE 'PERFORM public\.enqueue_ledger_(refresh_for_strategies|composite_refresh)'` -> 0.

Composite gate, staleness view and composite body unchanged: `git diff 2941b367a -- supabase/tests/test_ledger_refresh_composite_arm.sql supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` is empty.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's twin spec] Twins (a) and (c) cannot rewrite the 7-day literal to another literal**
- **Found during:** Task 1 design
- **Issue:** the plan's twin (a) turns `INTERVAL '7 days'` into `INTERVAL '20 hours'` and the same plan's verify block raises unless the live definition contains `INTERVAL '7 days'`. Under that twin the apply aborts and the gate never runs, so the arm would not be the first failure (GRAMMAR rule 2, the disjointness trap the 164.6 migration header documents).
- **Fix:** the twins keep the original token inside the replacement: P1 rewrites `THEN INTERVAL '7 days'` to `THEN INTERVAL '7 days' - INTERVAL '6 days'` (window of one day), P3 to `... + INTERVAL '23 days'` (window of 30 days), P2 widens the flag test with `OR sa.data_quality_flags = '{}'::jsonb` instead of editing the ELSE branch (an ELSE rewrite would have reddened arm F first, since F depends on the 20-hour branch and runs earlier). The verify block's two needles are assembled by concatenation. All three twins bite their own arm.
- **Files modified:** `supabase/tests/test_ledger_refresh_fanout.sql`, the migration
- **Commit:** `634cf10c2`, `d165b4abc`

**2. [Rule 3 - Blocking] Migration header named things the static gate's extractors and gate 10c read**
- **Found during:** Task 3 (the static gate went 9 red after the pointer move)
- **Issue:** the header mentioned the `$fanout$` tag pair in prose, which the gate's body extractor matched first, and the composite function's identifier, which gate 10c allows only in files that define it.
- **Fix:** reworded to descriptions. 37 pass afterwards.
- **Commit:** `c77cb116c`

**3. [Rule 2 - Missing critical] Added a `prod-body-ack` pragma**
- **Found during:** Task 1
- **Issue:** the 164.6 and 164.5.1.1 migrations carry one because VAC-04 compares the regenerated snapshot with PROD's live body on a function-changing PR. The plan did not mention it.
- **Fix:** `-- prod-body-ack: 864283ec...b909`, measured as the `live` column of `sql-body-normalize.mjs --diff-bodies` with the committed snapshot on both sides, with the "earned only if VAC-04 reports the same hash for PROD" caveat in the header. Inert when the bodies match.

**4. [Rule 3 - Blocking] One more census pin than the plan listed**
- **Found during:** wide vitest run over 29 files
- **Issue:** `src/__tests__/drift-check-scripts.test.ts` (OPS-08-F9) greps `ci.yml` for the literal `ARMS_FLOOR=373`; it went red after the table moved.
- **Fix:** moved to 376 with a dated RAISED comment. Also not in the plan's file list: the `ARMS_FLOOR=` sum expression inside `ci.yml` itself.
- **Commit:** `c77cb116c`

**5. [Rule 1 - Bug in my first draft] P2 coupled to the tick's return value**
- P2 first asserted `v_ret = 1`, which is 2 at the base migration (P1 is also admitted), so P2 would have failed for P1's reason. P2 now asserts only its own strategy's new job count.

### Process notes (not code deviations)

- The first full mutation run died with `ENOSPC` (the machine's data volume was at 100% with 0.4 to 0.9 GiB free for the whole session, caused by something outside this worktree). The second completed all 806 arms but reported `dirty-checkout` because I edited a test file while it ran (the runner's own guard). The third, on a clean tree committed beforehand, exited 0. Only the third is quoted as the reading.
- Commit 1 and 2 leave the fan-out sentinel roster at its old value between them only for P1/P2 (the roster and 26 to 29 move landed in commit 2 with P3).
- I did not use the shared local-stack lane (`scripts/local-stack/run.sh`); this plan's SQL runs only on the private pg-lane. Nothing to stop.

## Open item for the orchestrator (not done, by plan rule)

`supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` is `@generated` from the migrations (`npm run schema:functions`) and still names source migration 20260924120000. The plan forbids hand edits and says the post-apply re-dump regenerates it, but the 164.6 and 164.5.1.1 migrations list regenerating that snapshot as a REQUIRED same-commit step, because `npm run schema:functions:check` and VAC-04 read it. I did not run the generator. Expect `schema:functions:check` red on the ship PR until it is regenerated (and then the `prod-body-ack` above is what VAC-04 needs).

## Known Stubs

None.

## Threat Flags

None. The migration adds no endpoint, grant, auth path or schema object; the REVOKE is re-issued and the verify block's grantee-set check (owner only) is carried forward (T-174-04). T-174-01: byte-for-byte re-base with saved diff and the full 35-arm corpus re-run against it. T-174-02: arm P3 plus twin. T-174-03: catalogue-only verify, no row read.

## Self-Check: PASSED

- Migration, gate, fixture, static gate, census files and runbook exist and are committed (`git status --porcelain` empty before this file).
- Commits `634cf10c2`, `d165b4abc`, `c77cb116c` are ancestors of HEAD.
- Plan verify lines for Tasks 1 to 3 print OK.
