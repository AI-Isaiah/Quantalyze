---
phase: 214-freshtruth-refresh-work-and-freshness-readings-match-what-ca
plan: 07
subsystem: ci-gates
tags: [mutation-floors, anti-skip-gate, census, ratchet, sql-gates]
requires: ["214-01", "214-02", "214-03", "214-04", "214-05", "214-06"]
provides:
  - "mutation runner ARMS_FLOOR 848 -> 864, counting the 16 arms Phase 214 added (SC-7 census half)"
  - "ci.yml sql-tests derivation rows 18 / 24 / 38 / 14 and ARMS_FLOOR 461 -> 477"
  - "every census test that counts the supabase/tests corpus green, each pin moved by the measured delta with a dated note"
affects: []
tech-stack:
  added: []
  patterns: ["arms-only floor move (Phase 174 shape): numbers and notes only", "neuter, see RED, restore from byte backup, cmp"]
key-files:
  created: []
  modified:
    - scripts/mutation-floors.mjs
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
key-decisions:
  - "ARMS_FLOOR is 864 = the --parse-only annotated-unwaived count; the FULL run did not run (8.7 GB free against about 15 GB), so 864 is stated as an upper bound on biting"
  - "ci-anti-skip-gate.contract.test.ts re-derives from the corpus and is green after the table move, so it was NOT edited"
  - "FILES_FLOOR 82, WAIVED_CEILING 0 and SENTINEL_FLOOR 29 unchanged (no gate file joined, no waiver added)"
metrics:
  duration: "not captured (no start time was recorded at executor start)"
  completed: 2026-11-14
status: complete
actuals:
  tokens: 35800
  tasks: 2
  commits: 2
plan_head_before: a94540d7d5fa5e9a016770eb0949db0279073ebd
plan_head_after: 718f5875549eb538fa1d8ddc8b38185648116665
---

# Phase 214 Plan 07: the floors count the phase's 16 new arms Summary

The mutation runner's `ARMS_FLOOR` moved 848 -> 864 and `sql-tests`' anti-skip table moved 461 -> 477 (rows 18, 24, 38, 14), so a deleted or neutered Phase 214 arm now fails CI. Every number was measured on this tree. No `.sql` file, `VERSION`, `package.json`, `CHANGELOG.md`, `TODOS.md`, STATE.md or ROADMAP.md was touched.

`plan_head_after` is the head at the last task commit; the SUMMARY commit follows it. `commits: 2` is `git rev-list --count plan_head_before..plan_head_after`.

## Measured readings (command -> output)

| Command | Reading |
|---|---|
| `node scripts/verify-plan-anchors.mjs <plan>` | `claims: 11 checked`, `OK`, exit 0 before any edit |
| `df -h "$TMPDIR"` | 8.7 GiB free (8.6 after the subset run) against about 15 GB for a FULL run |
| `node scripts/mutation-runner/run.mjs --parse-only`, exit 0 | `coverage: files 82/109`; `arms: 0/864/0   (executed/annotated/waived)`; `No static defects`; per file `test_enqueue_dedup_record_retract.sql: sections 18`, `test_ledger_refresh_composite_arm.sql: 30`, `test_ledger_refresh_fanout.sql: 44`, `test_ledger_refresh_staleness.sql: 17`, all `waived 0` |
| `node scripts/mutation-runner/run.mjs --subset-from <the four files>`, exit 0 (93 s) | `scope: SUBSET 4/82 annotated files`; `arms: 109/109/0`; `biting: 109`; `lane-invocations: 109` (the two tallies agree); `No defects in the SUBSET`; per-file `18/18/18/0/18`, `30/30/30/0/30`, `44/44/44/0/44`, `17/17/17/0/17` (sections / judged / annotated / waived / biting) |
| twin counts at `d5e4c20d6` vs HEAD (`git show <rev>:<file> | grep -a -c -E '^\s*--\s*RED-UNDER-M:'`) | staleness 11 -> 17 (+6), composite 29 -> 30 (+1), fan-out 37 -> 44 (+7), dedup 16 -> 18 (+2); sum +16 = 848 -> 864 |
| `grep -a -o -m1 'ALL [0-9]* ARMS EXECUTED'` per file | dedup `ALL 18`, composite `ALL 24`, fan-out `ALL 38`, staleness `ALL 14` |

The FULL mutation run did NOT run. The 16 added arms are measured biting by the subset run; the other 78 annotated files are untouched by this phase. 864 is the static annotated-unwaived count, so it is an upper bound on biting; CI `sql-mutation` FULL on the PR head SHA (a floors edit forces FULL) is the authoritative comparison.

## RED before any move

`npx vitest run` over the six census files, log in `$TMPDIR/214-07-red-before.txt`: 3 files failed, 6 tests failed, 1294 passed.

- `mutation-annotation-parser.test.ts` REAL CORPUS rule 3b: `expected 864 to be 848`
- `mutation-annotation-parser.test.ts` rule 3c needle half: `expected 981 to be 965`
- `mutation-runner-floors.test.ts` marker count: `expected 864 to be 848`
- `mutation-runner-floors.test.ts` ARMS_FLOOR ratchet: `The corpus declares 864 twin(s) of which 0 are waivers, so a green run bites 864. ARMS_FLOOR is 848.`
- `ci-anti-skip-gate.contract.test.ts` F10 floor reach: `expected 477 to be 461`
- `ci-anti-skip-gate.contract.test.ts` derivation: `ci.yml's derivation credits test_enqueue_dedup_record_retract.sql with 16 arms; the file declares 18`

`gate-family-meta`, `drift-check-scripts` and `lint-sql-gates` were green at that point. `gate-family-meta` went red the moment `ARMS_FLOOR` moved (`a threshold site not in KNOWN_THRESHOLD_SITES`), as the plan predicted, and `mutation-runner-floors` went red again on its `GREEN_LOG` fixtures for the same reason (a fixture log of 848 biting arms fails the real 864 floor).

## What was changed

- **`scripts/mutation-floors.mjs`:** `ARMS_FLOOR` 848 -> 864 with a dated `RAISED 848 -> 864 2026-11-14 (Phase 214 FRESHTRUTH plan 07 ...)` paragraph in the Phase 174 shape quoting the lines above, the per-file twin deltas, "FULL run not run" and "no waiver was added". `FILES_FLOOR` (82) and `WAIVED_CEILING` (0) untouched.
- **`mutation-runner-floors.test.ts`:** `totalAnchored` 848 -> 864; the `GREEN_LOG` fixture's `arms:`, `biting:`, `lane-invocations:` and `per-arm lane time ... over N arm run(s)` lines, and the 13 code-line pins derived from them (848 -> 864, 849 -> 865, 847 -> 863); the four per-file rows replaced verbatim from the subset run's lines in sorted position (dedup 16 -> 18, composite 29 -> 30, fan-out 37 -> 44, staleness 11 -> 17), so the rows still sum to the aggregate. 22 code lines changed, each preceded by a `CURRENCY 2026-11-14 (Phase 214 FRESHTRUTH, plan 07)` note. The fixture's `mean 6.0s` seconds figure was NOT re-measured (the subset run is not a full-corpus mean); only the arm count moved.
- **`gate-family-meta.test.ts`:** the `scripts/mutation-floors.mjs :: ARMS_FLOOR=` key 848 -> 864 with a dated measurement entry in front of the lineage.
- **`mutation-annotation-parser.test.ts`:** `armsSeen` 848 -> 864, `stepsSeen` 965 -> 981 and `needles.length` 965 -> 981 (the last two read off the RED run, not derived). `filesTotal` and `filesAnnotated` were not red and did not move.
- **`.github/workflows/ci.yml` (`sql-tests` derivation block only):** four rows set to 18, 24, 38, 14, `ARMS_FLOOR` 461 -> 477 with the sum comment's terms moved, a `Re-measured 2026-11-14 (Phase 214 FRESHTRUTH, plan 07), FOUR moves` note placed above the row block (never between rows). `SENTINEL_FLOOR=29` unchanged.
- **`drift-check-scripts.test.ts`:** case title and pin `ARMS_FLOOR=461` -> `477` with a `RAISED 2026-11-14 (Phase 214 FRESHTRUTH, plan 07), 29/461 -> 29/477` comment: `461 + 2 + 1 + 7 + 6 = 477` is the table's own sum.
- **`ci-anti-skip-gate.contract.test.ts`:** NOT edited. It re-derives from the corpus and is green after the table move.

## Neuter drills

- **N1** (`ARMS_FLOOR` set back to 848; byte backup `$TMPDIR/mutation-floors.mjs.bak`): `mutation-runner-floors.test.ts` went RED, 2 failed / 131 passed. The ratchet case read `The corpus declares 864 twin(s) of which 0 are waivers, so a green run bites 864. ARMS_FLOOR is 848.`, and the "GREEN: a FULL log passes ... ARMS_FLOOR included (D-07)" case failed too. The plan expected the words `RATCHET STALE`; this repo's message names `ARMS_FLOOR is 848` instead, which is the same defect. Restored with `cp`; `cmp` exit 0.
- **N2** (fan-out row set back to 31; byte backup `$TMPDIR/ci.yml.bak`): `ci-anti-skip-gate.contract.test.ts` went RED, 1 failed / 32 passed: `ci.yml's derivation credits test_ledger_refresh_fanout.sql with 31 arms; the file declares 38`. Restored with `cp`; `cmp` exit 0.

## Phase gate on this tree (Node 22)

- `npm test`: exit 0. `Test Files  1236 passed | 20 skipped (1256)`, `Tests  26197 passed | 306 skipped (26503)`. No test other than the six above needed a move, so there is no exception-rule file.
- `npm run typecheck`: exit 0.
- `npm run lint`: 0 errors, 4 warnings, all `no-unused-vars` in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts` x2).
- `npm run schema:functions:check`: `SQL function snapshot is current (133 functions)`.
- The four-file verify command (`ci-anti-skip-gate.contract`, `drift-check-scripts`, `mutation-annotation-parser`, `lint-sql-gates`): 4 files, 1146 tests passed. The three-file Task 1 command: 3 files, 262 tests passed.
- `tests/test_sql_gate_scoped_updates.py tests/test_ledger_refresh_gates.py tests/test_mt5_series_end_is_last_ledger_day.py`: `46 passed`, 0 skipped.
- The full `grep -la -E 'supabase/(tests|migrations)' analytics-service/tests/*.py | grep -v '/_'` set (30 files) plus `test_mt5_series_end_is_last_ledger_day.py`, run from `analytics-service/`: `1218 passed, 42 skipped`. Both named files passed with no skip. The 42 skips are all live-database tests that need credentials this host does not carry, in six files: `test_compute_jobs_fencing.py` (`test Supabase project not configured (local dev)`, plus 3 permanent P1-TODO skips), `test_compute_job_metadata_merge_live.py` (`LANE_DB_URL unset`, `local-stack lane not configured`), `test_resend_correlation_rls.py`, `test_persist_csv_daily_returns_live.py`, `test_sync_trades_preserves_fills.py` (all `TEST_SUPABASE_DB_URL unset` or `SUPABASE_URL or SUPABASE_SERVICE_KEY unset`) and `test_upsert_strategy_analytics_series_batch_privilege.py` (`needs HAS_LIVE_DB`). The other 24 files passed with no skip. (Note: under zsh the file list must be word-split with `$(cat ... | tr '\n' ' ')`; an unsplit `$FILES` runs as one bad path and reports `no tests ran`.)
- mypy was not run: this plan changes no analytics-service code.
- Expected-red classes (`baseline-content-drift`, VAC-08) are not part of `npm test`; not run, noted only.

## Plan 05's spec

`e2e/freshness-chip-width.spec.ts` is deliberately not in `ci.yml`'s `e2e-seeded` list and was not touched. No repo test went red because of it: the full `npm test` is green, so there is no failing two-place-rule or e2e-list contract to report.

## Deviations from Plan

None - plan executed as written. Two notes on wording, not scope:

- The plan's N1 text expected `RATCHET STALE`; the live message reads `ARMS_FLOOR is 848` (see N1 above).
- The plan's expectations (848 + 16 = 864; rows 18, 24, 38, 14; 461 + 16 = 477) matched the measured numbers exactly, so no difference with `origin/main` needed recording. The measured numbers were read off the tools, not copied from the plan.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. Only integers, test pins and comments moved. T-214-23 is mitigated (both ratchets proved to bite by N1 and N2). T-214-24 is mitigated: the FULL run is recorded as not-run with the 8.7 GB reading, and `ARMS_FLOOR` is stated as an upper bound.

## Open items for the orchestrator

- CI `sql-mutation` FULL on the PR head SHA is the first real biting count against 864; if it reports fewer than 864, the floor must come down to the measured count, never the other way.
- SC-4 and SC-6 remain orchestrator-owned (post-merge PROD read; pre-merge migration-reviewer and rls-policy-auditor). SC-5 still awaits a founder decision (plan 05 partial).

## Self-Check: PASSED

- `4e9c67c94` and `718f58755` are ancestors of HEAD.
- Files exist: `scripts/mutation-floors.mjs`, the five `src/__tests__/` files and `.github/workflows/ci.yml` (all modified, read back through green tests).
- Acceptance greps: `ARMS_FLOOR = 848` count 0; `FILES_FLOOR = 82` count 1; `WAIVED_CEILING = 0` count 1; `Phase 214 FRESHTRUTH plan 07` in `mutation-floors.mjs` 1; fan-out row `31` count 0; `SENTINEL_FLOOR=29` count 1; `Phase 214 FRESHTRUTH, plan 07` in `ci.yml` 1.
