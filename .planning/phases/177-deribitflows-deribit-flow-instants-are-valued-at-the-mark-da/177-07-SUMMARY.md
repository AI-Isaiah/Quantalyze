---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 07
subsystem: testing
tags: [sql-gate, census, mutation-runner, ratchet, ci, generated-types, gdpr]

requires:
  - phase: 177 plan 02
    provides: supabase/tests/test_api_key_flow_prices.sql (8 sections, 13 annotated arms) and migration 20261101120000
provides:
  - the ci.yml sql-tests sentinel roster row, SENTINEL_FLOOR and ARMS_FLOOR counting the price-store gate
  - FILES_FLOOR and ARMS_FLOOR in scripts/mutation-floors.mjs raised by one full mutation-runner run
  - the moved census pins (drift-check-scripts, lint-sql-gates, gate-family-meta, runner-floors, parser)
  - api_key_flow_prices hand-added to src/lib/database.types.ts
affects: [177 ship, any later phase adding a gate file (floors are merge-conflict magnets)]

actuals:
  tokens: 28800
  tasks: 3
  commits: 3
plan_head_before: 79e8283143da8b684ab96faf2def722957596c14
plan_head_after: 122b1ded7a3f5207d5deadb806c7d9ec05c3d14b
commits: 3

tech-stack:
  added: []
  patterns:
    - "Every census is moved by reading its stale-low failure message first, then the value off the run, never off arithmetic"
    - "One full mutation-runner run in the LAST task, no file edited while it ran, floors copied from its lines"

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/lint-sql-gates.test.ts
    - src/lib/database.types.ts
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts

key-decisions:
  - "The sentinel roster counts the gate as 8 (its sentinel), the mutation runner counts 13 (annotated arms 5a/5b, 7a-7e); both are right in their own census and the SUMMARY of plan 02 forecast the split."
  - "GDPR hook left untouched on purpose: the table has no user column, erasure is by the api_keys cascade (plan 02 arm 6)."
  - "database.types.ts note says service-role only and that a regen against PROD drops the table until the migration applies."

requirements-completed: [SC-3]

coverage:
  - id: D1
    description: "The price-store gate is counted by the sql-tests sentinel census (roster row, SENTINEL_FLOOR, ARMS_FLOOR and its sum)"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts, src/__tests__/drift-check-scripts.test.ts, src/__tests__/lint-sql-gates.test.ts (1014 tests green)"
        status: pass
    human_judgment: false
  - id: D2
    description: "FILES_FLOOR and ARMS_FLOOR equal one full mutation-runner run's annotated-file and biting counts, with the runner and parser pins moved"
    requirement: SC-3
    verification:
      - kind: command
        ref: "node scripts/mutation-runner/run.mjs (exit 0, No defects, scope FULL 82/82, biting 829) and the six census vitest files (1276 tests green)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The table is typed, the privacy hook passes untouched, the replay set names the migration, and no legacy chain file changed"
    requirement: SC-3
    verification:
      - kind: command
        ref: "Task 2 automated verify printed OK (typecheck, gdpr hook, data-dependence census, app-guc, replay set, legacy-files diff)"
        status: pass
    human_judgment: false

duration: about 60 min (estimated; start time not captured, about 25 min of it is the full runner run)
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 07: the census and ratchet moves for the moved-flow price gate Summary

**Plan 02's `test_api_key_flow_prices.sql` is now counted by every census that guards its kind: the sql-tests roster (SENTINEL_FLOOR 25 -> 26, ARMS_FLOOR 386 -> 394), the mutation floors (FILES_FLOOR 81 -> 82, ARMS_FLOOR 816 -> 829, from one full run), and the typed table, with the GDPR hook and the legacy chain files untouched.**

## Performance

- **Duration:** about 60 min (estimated; the start time was not captured). The full mutation-runner run took about 25 min of it.
- **Completed:** 2026-10-28
- **Tasks:** 3 (all auto; the plan carries no tracer, it adds no code path)
- **Files modified:** 8

## Accomplishments

- **Task 1, sql-tests census.** RED by measurement (`/tmp/deribitflows-07/census-red.log`, `exit=1`, 3 failed of 1014): `expected 'lint-sql-gates: scanned 109 file(s); …' to match /scanned 108 file/`; `expected 26 to be 25` (declared total against the floor); and `the set of files declaring an 'ALL N ARMS EXECUTED' sentinel no longer matches ci.yml's derivation table … expected [ …(26) ] to deeply equal [ …(25) ]` with `+ "test_api_key_flow_prices.sql"` as the one extra file. After the ci.yml edit the drift-check-scripts pin read `expected 1 to be +0` and was moved too. Now, as `grep -n` prints them: `5197:          SENTINEL_FLOOR=26  # files declaring a sentinel` and `5198:          ARMS_FLOOR=394     # 8 + 13 + 8 + 11 + 8 + 8 + 9 + 8 + 3 + 8 + 8 + 6 + 23 + 31 + 8 + 15 + 14 + 7 + 15 + 4 + 103 + 20 + 16 + 10 + 7 + 23`. The roster row (`grep -acE '^          #   test_api_key_flow_prices\.sql +8$'` is 1) sits in the contiguous block in file-name order; the dated note went above the table's closing marker. `node scripts/lint-sql-gates.mjs`: `lint-sql-gates: scanned 109 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` After the edit: 3 files, 1014 tests green.
- **Task 2, type and checks.** `api_key_flow_prices` hand-added in house form (Row, Insert, Update with `created_at` optional, one `api_key_flow_prices_api_key_id_fkey` relationship) before `api_key_nav_marks`, with the dated not-applied-to-PROD note. Verify printed `OK`. Readings: gdpr.log `[check-gdpr-export-coverage] OK - manifest covers all 26 declared user-owned tables (manifest size 41).` (no edit to it or `src/lib/gdpr-export-manifest.ts`); migdep.log `lint-migration-data-dependence: corpus 311 migration(s), 391 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`; guc.log `app-guc: findings 0`; replay.log `baseline-currency: carried=310 replay=1 marker-sha=match defects=0` and `baseline-replay: 1 migration(s) newer than the dump: 20261101120000_api_key_flow_prices.sql`. `git diff --name-only $(git merge-base HEAD origin/main) HEAD -- docs/runbooks scripts/prod-prober` is empty. `npm run typecheck` exit 0.
- **Task 3, mutation floors.** RED by measurement (`floors-red.log`, `exit=1`, 7 failed): `RATCHET STALE: 82 of 109 gate files are now annotated but FILES_FLOOR is still 81. Raise FILES_FLOOR in scripts/mutation-floors.mjs to 82.`; `The corpus declares 829 twin(s) of which 0 are waivers, so a green run bites 829. ARMS_FLOOR is 816.`; the parser's `expected 829 to be 816` (arms), `expected 942 to be 929` (steps) and `expected 109 to be 108` (files). ONE full run, no file edited during it, `mut-full.log`: `exit=0`, `scope: FULL 82/82 annotated files`, `scope-reason: no derivation reason supplied (a direct invocation)`, `lane-concurrency: 4`, `coverage: files 82/109`, `arms: 829/829/0   (executed/annotated/waived)`, `biting: 829`, `lane-invocations: 829 … plus 82 baseline / 82 restore leg(s)` (the two tallies agree), `lane-blocked: 0 file(s)`, `lane-probe: pg_cron AVAILABLE`, `unreachable: 27`, `file test_api_key_flow_prices.sql: sections 8 / judged 13 / annotated 13 / waived 0 / biting 13`, `per-arm lane time: mean 1.7s over 829 arm run(s)`, `✅ No defects. Every annotated arm bit its own arm first.` Floors now: `1323:export const FILES_FLOOR = 82;`, `3335:export const ARMS_FLOOR = 829;`, `3449:export const WAIVED_CEILING = 0;`. After the pin moves: the six census files, 1276 tests green.

## Task Commits

1. **Task 1:** `de9478e63` (chore) - sql-tests sentinel census: roster row, SENTINEL_FLOOR, ARMS_FLOOR, drift-check-scripts and lint-sql-gates pins
2. **Task 2:** `4883198bb` (chore) - the hand-added table type
3. **Task 3:** `122b1ded7` (chore) - mutation floors raised by one full run; gate-family-meta, runner-floors and parser pins moved

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## Grep-them-all record (`git grep -ln test_allocator_trade_reads`, the previous newest gate)

| File | Disposition |
|---|---|
| `.github/workflows/ci.yml` | moved in Task 1 (roster row, floors, note) |
| `scripts/mutation-floors.mjs` | moved in Task 3 (FILES_FLOOR, ARMS_FLOOR, dated notes) |
| `src/__tests__/drift-check-scripts.test.ts` | moved in Task 1 |
| `src/__tests__/lint-sql-gates.test.ts` | moved in Task 1 |
| `src/__tests__/gate-family-meta.test.ts` | moved in Task 3 (the two floor keys; it did not fail in the RED run because it compares its keys to the live floors, which were still equal then) |
| `src/__tests__/mutation-annotation-parser.test.ts` | moved in Task 3 (armsSeen, stepsSeen, needles, filesTotal x2, filesAnnotated, annotatedFiles list) |
| `src/__tests__/mutation-runner-floors.test.ts` | moved in Task 3 (GREEN_LOG, SUBSET_LOG and every derived literal, plus the new per-file row) |
| `scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql` | NOT edited: line 17 is lineage prose recording a 2026-10-27 measurement about that gate, which stays true |

`analytics-service/tests/test_flow_price_store.py` names `test_api_key_flow_prices.sql` in a docstring only (plan 03's file); nothing to move. The new table adds no SQL function, so no function snapshot, NAME_SET_RATCHET row or COMPARED_FLOOR moved.

## Decisions Made

- Row value 8 in the sentinel roster, 13 in the runner census: the sentinel counts sections, the runner counts annotated twins (arms 5 and 7 carry sub-identities). Per-file line shows both (`sections 8 / judged 13 / annotated 13`).
- GDPR export untouched (Open Question 7: not exported); no user column on the table, erasure by cascade.
- Merge note for the orchestrator stands: at ship time re-derive the roster, SENTINEL_FLOOR, ARMS_FLOOR and both mutation floors on the merged tree with one full runner run, never by adding moves.

## Deviations from Plan

None - plan executed exactly as written. Two small notes, neither a deviation:

- The plan's Task 3 listed gate-family-meta among the pins to move; it was green in the RED run (it compares its keys to the live floors) and had to move only together with the floors, which it did.
- The scratch directory stayed `/tmp/deribitflows-07` as the plan's verify commands require, although the environment offers a session scratchpad.

## Neuter-and-see-RED evidence

Each census was measured RED before its edit (census-red.log and floors-red.log, both `exit=1`, messages quoted above) and GREEN after. The gate's own arms were already proven by plan 02's 13 twins, and this run's full mutation pass re-confirmed all 13 (`biting 13` for the file).

## Known Stubs

None.

## Threat Flags

None. T-177-27 is mitigated (roster row, SENTINEL_FLOOR, ARMS_FLOOR, FILES_FLOOR and the runner pins all count the gate, each by measurement). T-177-28: the GDPR hook exits 0 with no edit. T-177-29: the type's note says service-role only. T-177-SC: `npm ci` only; `git status --porcelain package.json package-lock.json` was empty.

## Handback for the orchestrator

- Measured at this branch HEAD without merging main. Other phases move the same floors on `main`; re-measure on the merged tree at ship time (one full runner run, about 25 min, run it in the background).
- `.planning/` files other than this SUMMARY, STATE.md and ROADMAP.md were not touched. No docs/runbooks or scripts/prod-prober file changed on the branch.
- No Supabase CLI, `--linked`, `db push`, TEST, PROD or Railway access was used.

## Self-Check: PASSED

The eight modified files exist; commits `de9478e63`, `4883198bb` and `122b1ded7` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD was 3 before this SUMMARY.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
