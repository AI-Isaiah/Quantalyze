---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 02
subsystem: database
tags: [postgres, plpgsql, bridge-outcomes, sql-gate, mutation-runner, migration]

requires:
  - phase: 176-legacyretire
    provides: "CONTEXT decisions D-03, D-05, D-06 (founder 2026-10-31)"
provides:
  - "public.derived_account_return_over(uuid, date, integer): compounded flow-neutral account return over (anchor, anchor + N], NULL on any gap or malformed payload"
  - "public.compute_bridge_outcome_deltas() re-based: holding branch reads the account's derived returns, window conjunct on allocated_at; strategy and voluntary_add branches byte-identical"
  - "public.reset_holding_bridge_outcomes_to_derived_basis(): owner-only D-06 reset, called once by the migration"
  - "supabase/tests/test_bridge_outcome_deltas_derived.sql: 11 arms, 19 biting twins"
  - "down/20261102120000-rollback.sql and TODOS 176-BRIDGE-CHECK-WINDOW-ABORT"
affects: [176-07, 176-PR3-drop, bridge-outcomes, OutcomesWidget copy]

actuals:
  tokens: 67700
  tasks: 3
  commits: 3
plan_head_before: e00141c4fc12f761131d40960509bda86cc03093
plan_head_after: 7e567516bef41a1aae012d4d5f18d45300a8cf50

tech-stack:
  added: []
  patterns:
    - "catalogue-only $verify$ block that asserts names and privileges, never a formula line (twins mutate formula lines)"
    - "seed an out-of-window row by dropping bridge_outcomes_allocated_at_check, inserting, re-adding it NOT VALID"
    - "JSON date text matched as text against the days the window names, never cast"

key-files:
  created:
    - supabase/migrations/20261102120000_bridge_outcome_holding_branch_derived.sql
    - supabase/migrations/down/20261102120000-rollback.sql
    - supabase/tests/test_bridge_outcome_deltas_derived.sql
    - supabase/schema/functions/derived_account_return_over.sql
    - supabase/schema/functions/reset_holding_bridge_outcomes_to_derived_basis.sql
  modified:
    - supabase/schema/functions/compute_bridge_outcome_deltas.sql
    - scripts/mutation-floors.mjs
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
    - .github/workflows/ci.yml
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/__tests__/drift-check-scripts.test.ts
    - TODOS.md

key-decisions:
  - "Outcome = exp(sum(ln(1 + r))) - 1 over returns[].r for days anchor+1 .. anchor+N, matched by date TEXT; NULL when any day is missing or repeated (D-05)"
  - "Compounded log-sum above 1000 returns NULL: numeric exp() raises 22003 past about 49000, so an absurd r in one row would abort the batch for every allocator"
  - "Reset population = holding_candidates minus its delta guard, plus the allocated_at window; it is a function so a gate can assert on it (D-06)"
  - "Helper is SECURITY INVOKER with EXECUTE revoked from PUBLIC/anon/authenticated; the reset is owner only (service_role revoked too)"

patterns-established:
  - "Mutation twin that proves flow-neutrality: a consistent-curve fixture (B1) stays green under a curve-ratio mutant, only a deposit day (B2) separates them"

requirements-completed: [SC-1]

duration: 40min
completed: 2026-10-31
status: complete
---

# Phase 176 Plan 02: Bridge outcomes move onto the account's derived returns

**The holding branch of the daily bridge batch now measures +30/+90/+180 on the account's compounded flow-neutral derived returns (NULL on any missing day), every stored holding outcome is reset once for recompute, and a latent 23514 abort on aged rows is closed for that branch and booked for the other two.**

## Performance

- **Duration:** about 40 min
- **Started:** 2026-10-31T17:27:44
- **Completed:** 2026-10-31T18:07:54 (last task commit; SUMMARY follows)
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 16 (5 created, 11 modified outside the SUMMARY)

## Accomplishments

- `derived_account_return_over` and the re-based `compute_bridge_outcome_deltas` (only holding CTEs changed: 43 changed lines in `/tmp/legacyretire-02/rebase.diff`, all inside the holding comment, `holding_candidates` (one conjunct plus a 4-line comment) and `holding_computed`). Nothing in the batch reads `allocator_equity_snapshots` or `extract_symbol_value_at` any more (the verify block asserts it from the catalogue).
- D-06 reset function and its single call; catalogue-only verify (data-dependence lint `0 NEW`).
- New gate with 11 arms and 19 twins, all biting; full mutation run `arms: 848/848/0`.
- Censuses moved by measured counts only; rollback file; TODOS entry for the other two branches.

## Task Commits

1. **Task 1 (tracer): holding outcome measured on compounded derived returns** - `f3a6ffa9f` (feat)
2. **Task 2: D-06 reset, CHECK-window guard, edge arms with twins** - `967e423c7` (feat)
3. **Task 3: snapshots, censuses, rollback, TODOS** - `7e567516b` (test)

Tracer feedback gate (auto mode): the Task 1 `<verify>` was re-run end to end after the commit and printed OK, so the expansion went ahead.

## Evidence

- **Definers of the batch** (`grep -al 'FUNCTION public.compute_bridge_outcome_deltas'`): 20260418074935, 20260419061003, 20260421154030, 20260426131718 (newest, re-based on), plus 20260515205431 which only REVOKEs. Newest on `origin/main`: 20261101120000, so the migration name 20261102120000 is free and unchanged.
- **B1 RED on the base body** (`/tmp/legacyretire-02/red-at-base.log`, the generated snapshot of the 20260426131718 body applied in place of the new migration): `TEST FAILED (B1): a fresh holding outcome kept a NULL delta (30d <NULL>, 90d <NULL>, 180d <NULL>) ...`. GREEN with the migration: `ALL 1 ARMS EXECUTED (B1)` (t1-green.log); final gate `ALL 11 ARMS EXECUTED (B1,B2,B3,B4,B5,B6,G1,R1,R2,R3,C1)` (t2-green.log).
- **Base body raises 23514** (`/tmp/legacyretire-02/g1-at-base.log`): `batch answered 23514|new row for relation "bridge_outcomes" violates check constraint "bridge_outcomes_allocated_at_check"`.
- **G1 drill** (`t2-drill.log`): window conjunct deleted by hand from the migration on a byte backup, gate run on the pg-lane: `TEST FAILED (G1): the batch raised 23514|...`; backup restored with `cp`, `cmp` exit 0.
- **Narrowed mutation run** (`t2-mut.log`): every twin `RED (identity ok)`: B1, B2, B3, B4a, B4b, B5a, B5b, B5c, B5d, B6a, B6b, G1, R1, R2, R3, C1, C1b, C1c, C1d; `arms: 19/19/0`, `biting: 19`, `file ... sections 11 / judged 19 / annotated 19 / waived 0 / biting 19`, `No defects in the narrowed scope`; no `no-red`, `occurrence-mismatch` or MEASURE_FAIL.
- **ONE full mutation run, no file edited during it** (`t3-full.log`, exit 0): `scope: FULL 83/83 annotated files`, `lane-concurrency: 4`, `coverage: files 83/110`, `arms: 848/848/0`, `biting: 848`, `lane-invocations: 848 ... plus 83 baseline / 83 restore leg(s)`, `lane-blocked: 0`, `lane-probe: pg_cron AVAILABLE`, `per-arm lane time: mean 2.6s over 848 arm run(s)`, `No defects. Every annotated arm bit its own arm first.` `FILES_FLOOR` 82 -> 83, `ARMS_FLOOR` 829 -> 848, `WAIVED_CEILING` stays 0.
- **Other checks:** `node scripts/lint-sql-gates.mjs --self-test` OK (7 rules); corpus `scanned 110 file(s); 0 finding(s)`; `lint-app-guc` 0 findings; `lint-migration-data-dependence` self-test OK and `0 NEW`; `npx tsc --noEmit` clean; `npm run schema:functions:check` current (134 functions); rollback applied on the lane after the migration and its own post-condition passed. Vitest: `mutation-runner-floors`, `mutation-annotation-parser`, `ci-anti-skip-gate.contract`, `gate-family-meta`, `lint-sql-gates`, `drift-check-scripts` 6 files, 1277 tests passed; 18 further wiring and lint tests (baseline wiring, critical-regressions, local-stack wiring, sql-mutation scope, planning hygiene, and others) 933 passed, 16 skipped (pre-existing skips in files I did not touch; I skipped nothing).
- **Census moves:** ci.yml sql-tests `SENTINEL_FLOOR` 26 -> 27, `ARMS_FLOOR` 394 -> 405 (+11, the file's own sentinel); `COMPARED_FLOOR` 134 -> 136; vitest censuses `filesTotal` 110, `filesAnnotated` 83, `armsSeen` 848, `stepsSeen`/needles 966, scanned 110.

## `schema:functions` and baseline-content-drift lines (clear at the post-apply re-dump)

`npm run schema:functions:check` before the ratchet rows:

```
snapshot-only: derived_account_return_over
snapshot-only: reset_holding_bridge_outcomes_to_derived_basis
```

Handled as the script instructs: two dated `snapshot-only` rows in `NAME_SET_RATCHET` (clearing condition: the re-dump taken after 20261102120000 applies to PROD). After that: `SQL function snapshot is current (134 functions)` and `DRIFT-05 gate (a): baseline 132 name(s) vs migration-replay 134 name(s) - agree, with 2 ratcheted disagreement(s) carried`.

`node scripts/baseline-content-drift-check.mjs` stays at 3 findings by design until the re-dump (no allowlist row added; that list may only shrink): `DRIFT compute_bridge_outcome_deltas/0` (the committed dump still has the per-symbol body), `SNAPSHOT_MISSING derived_account_return_over/3`, `SNAPSHOT_MISSING reset_holding_bridge_outcomes_to_derived_basis/0`; `functions compared 136 - MATCH 130, DRIFT 4, SNAPSHOT_MISSING 2`.

## CHANGELOG inputs

- **Meaning change (D-03):** a holding bridge outcome is now a number about the ACCOUNT (compounded flow-neutral returns of its derived equity over the window), no longer about the symbol the decision named. Deposits and withdrawals no longer count. A window the derived curve does not fully cover is NULL (D-05).
- **One-time reset (D-06):** at the PROD apply the migration sets `needs_recompute = TRUE` and NULLs the three deltas and `deltas_computed_at` on every holding outcome whose `allocated_at` is inside the last 365 days. The old per-symbol values are not kept.
- **Transient Pending:** every reset holding outcome shows as Pending in the UI until the next 03:00Z run of `compute_bridge_outcome_deltas` recomputes it; rows whose window the derived curve cannot cover stay NULL.
- **Fixed:** the holding branch of the daily batch can no longer abort on a holding outcome aged past the 365-day `allocated_at` CHECK (it raised 23514 and aborted the batch for every allocator). The same latent abort in the strategy and voluntary_add branches is booked, not fixed.
- **Tests / floors:** new gate with 19 biting twins; `FILES_FLOOR` 83, `ARMS_FLOOR` 848; sql-tests sentinel 27 files / 405 arms.
- **Not read:** the PROD count of rows the reset touches (research form R3) belongs to the orchestrator; this plan read no PROD, TEST or Railway.

## Decisions Made

See key-decisions. The plan's helper skeleton was replaced as directed (text date matching, jsonb_typeof guards). The reset was written as `UPDATE ... FROM match_decisions` with an `EXISTS` over `parse_holding_ref` plus the `original_strategy_id IS NULL` test (the same population as `holding_candidates`).

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 - Blocking] Two scripts outside the plan's file list edited**
- **Found during:** Task 3 (`npm run schema:functions:check` exit non-zero after regenerating).
- **Issue:** the two new functions are `snapshot-only` against the committed PROD dump, so the verify command could not exit 0, and `COMPARED_FLOOR` read 134 against 136 compared. The plan's text says to handle the name-set rows "exactly as the script's own message instructs".
- **Fix:** two dated `NAME_SET_RATCHET` rows in `scripts/dump-sql-functions.ts` and `COMPARED_FLOOR` 134 -> 136 with a dated MOVED paragraph in `scripts/baseline-content-drift-check.mjs`, mirroring bc913db76 (NAVMTM).
- **Committed in:** `7e567516b`.

**2. [Rule 1 - Bug in the plan] R2's twin cannot target the `original_strategy_id` test**
- **Issue:** `match_decisions` CHECKs make `original_strategy_id` and `original_holding_ref` mutually exclusive for bridge_recommended, and voluntary_* kinds require `original_strategy_id` NULL, so no schema-legal row differs by that conjunct alone; a twin removing it could never bite.
- **Fix:** the conjunct stays in the reset (population equality with `holding_candidates`); R2's twin removes the `parse_holding_ref` EXISTS test instead, which resets the voluntary_add row. R2 asserts all four matched rows (strategy-sourced, voluntary_add, rejected, legacy).
- **Committed in:** `967e423c7`.

**3. [Rule 2 - Missing critical functionality] Compounded log-sum guard**
- **Issue:** PostgreSQL `exp(numeric)` raises 22003 once its argument passes about 49000; one row with an absurd `r` (a float up to 1e308 is legal JSON) would abort the batch for everyone, which T-176-05 forbids.
- **Fix:** the helper returns NULL when `sum(ln(1 + r)) >= 1000`. Arm B5d covers it, with its own twin.

**4. More sub-identities than the plan listed.** The plan listed one twin per arm; arms with several independent defects carry sub-identities (B4a/b, B5a-d, B6a/b, C1/C1b-C1d), so the gate has 19 twins for 11 sentinel arms. Floors moved by the measured 19 and 11.

### Not done / limits (Rule 12)

- **The gate ran only on the pg-lane stand-in schema.** Docker is down here, so the local-stack lane (real `baseline.sql`, which `sql-tests` uses) was not run. Seeds were checked against the baseline DDL and triggers by reading (match_decisions CHECKs and visibility trigger, bridge_outcomes CHECKs and sync trigger, strategies and strategy_analytics NOT NULLs); the same INSERT shapes are used by existing gates. If that lane disagrees, the fix is in the seed helpers, not the migration.
- Docker-free equivalents only: no TEST, PROD, Railway, `--linked` or `db push` was touched.

**Total deviations:** 4 adjusted (1 Rule 3, 1 plan correction, 1 Rule 2, 1 count note). **Impact:** no scope creep; all are correctness or census requirements.

## Issues Encountered

None blocking. The first full gate run on the pg-lane was green; every claim of "bites" rests on the runner's twins and the hand drill above, not on that green.

## Known Stubs

None.

## Threat Flags

None. The register's T-176-04 to T-176-08 are mitigated and covered: C1/C1b-C1d (privileges, direct call refused 42501), B5a-d and G1/R3 (batch cannot be aborted), R2 (reset population), catalogue-only verify plus `0 NEW` lint, REVOKE/GRANT with full signatures. T-176-08's migration-reviewer and rls-policy-auditor passes are plan 07's.

## Self-Check: PASSED

Files found: the migration, rollback, gate, three function snapshots. Commits found on HEAD: f3a6ffa9f, 967e423c7, 7e567516b. `git status --porcelain` was empty after the last task commit.
