---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 06
subsystem: testing
tags: [mutation-runner, ratchet, census, ci, sql-gate, types]
status: complete

requires:
  - phase: 171-readceiling
    provides: plan 03's gate test_allocator_trade_reads.sql (8 arms) and the two tables
provides:
  - hand-added frontend types for allocator_trade_reads and allocator_trade_read_windows
  - FILES_FLOOR and ARMS_FLOOR raised by one full lane run, registered in gate-family-meta
  - runner, parser, sentinel-roster and linter censuses that count the new gate
affects: [171-11 local-stack use, 171-12 deploy order record]

actuals:
  tokens: 40000
  tasks: 3
  commits: 3
plan_head_before: bb6d7f41fb86f3e88c1339a26878e15c19e59762
plan_head_after: 03e6bb179

tech-stack:
  added: []
  patterns:
    - "census edits are moved by one measured run and quote the failing expectation (stale-low observed first)"

key-files:
  created: []
  modified:
    - src/lib/database.types.ts
    - scripts/mutation-floors.mjs
    - src/__tests__/gate-family-meta.test.ts
    - src/__tests__/mutation-runner-floors.test.ts
    - src/__tests__/mutation-annotation-parser.test.ts
    - .github/workflows/ci.yml
    - src/__tests__/drift-check-scripts.test.ts
    - src/__tests__/lint-sql-gates.test.ts

key-decisions:
  - "GDPR hook left unchanged on purpose: no USER_EXPORT_TABLES entry and no SANITIZE_PARITY_ALLOWLIST key"
  - "ci-anti-skip-gate.contract.test.ts needed no edit: it re-derives the roster and floors from the corpus and pins no number"

requirements-completed: [SC-1]

duration: ~1h
completed: 2026-10-27
---

# Phase 171 Plan 06: census and ratchet pins for the trade-read store gate Summary

**The new SQL gate (8 arms) is now counted by every mutation ratchet, the sql-tests sentinel roster and the gate linter, each moved by a measured run, and the two tables are typed for the frontend; the GDPR hook is deliberately untouched.**

## Commits (branch `wt/171-p06`, base `bb6d7f41f`)

| Task | Commit | Subject |
|---|---|---|
| 1 | 70d9aa56b | chore(171-06): hand-add the trade-read store table types |
| 2 | 5ff4ba968 | chore(171-06): mutation floors and runner pins count the trade-read store gate |
| 3 | 03e6bb179 | chore(171-06): sql-tests sentinel census counts the trade-read store gate |

## Task 1: types and the GDPR decision

- `src/lib/database.types.ts`: `allocator_trade_read_windows` and `allocator_trade_reads` added under `public.Tables` in alphabetical place (before the NAV-marks block), Row / Insert / Update / Relationships, only the `api_keys` foreign key listed (windows `isOneToOne: false`, state `isOneToOne: true` since `api_key_id` is its primary key), with a dated note that the migration has not applied to PROD and a regen drops the types. Baseline `grep -ac 'allocator_trade_read' src/lib/database.types.ts` was 0, after: 6.
- `npx tsc --noEmit -p .` exit 0.
- `npx tsx scripts/check-gdpr-export-coverage.ts` exit 0: `OK - manifest covers all 26 declared user-owned tables (manifest size 41).` It names neither table (0 hits).
- **Decision: no `USER_EXPORT_TABLES` entry and no `SANITIZE_PARITY_ALLOWLIST` key** (`scripts/check-gdpr-export-coverage.ts` and `src/lib/gdpr-export-manifest.ts` have no diff against the plan base). Reasons: neither table carries a user column, so the hook does not count them; an allowlist key without a manifest entry is reported STALE by the hook; both tables are a transient, service-role-only processing cache with a 7-day expiry, erased with their key and with the account (plan 03 arms 3 and 4). RESEARCH's census row for that file is therefore not followed. Recorded for the security review and the founder (T-171-20, accepted).

## Task 2: the mutation ratchet, one full lane run

`node scripts/mutation-runner/run.mjs`, no file edited during it, exit 0 (pg-lane, throwaway cluster; the local Supabase stack was not used):

```
scope: FULL 81/81 annotated files
lane-concurrency: 4
coverage: files 81/108
arms: 811/811/0   (executed/annotated/waived)
biting: 811
lane-invocations: 811 ... plus 81 baseline / 81 restore leg(s)
lane-blocked: 0 file(s) ...   lane-probe: pg_cron AVAILABLE
per-arm lane time: mean 5.0s over 811 arm run(s)
file test_allocator_trade_reads.sql: sections 8 / judged 8 / annotated 8 / waived 0 / biting 8
No defects. Every annotated arm bit its own arm first.
```

Stale-low observed first (`census-a0` run before the floors moved): `RATCHET STALE: 81 of 108 gate files are now annotated but FILES_FLOOR is still 80.` and `The corpus declares 811 twin(s) of which 0 are waivers, so a green run bites 811. ARMS_FLOOR is 803.`

| Pin | Old | New | File |
|---|---|---|---|
| `FILES_FLOOR` | 80 | 81 | scripts/mutation-floors.mjs (+ registry key in gate-family-meta.test.ts, same commit) |
| `ARMS_FLOOR` | 803 | 811 | scripts/mutation-floors.mjs (+ registry key in gate-family-meta.test.ts, same commit) |
| `WAIVED_CEILING` | 0 | 0 | unchanged |
| runner-floors: `totalAnchored`, GREEN_LOG `scope`/`coverage`/`arms`/`biting`/`lane-invocations`/`lane-concurrency`/mean line, per-file row added, SUBSET_LOG `2/80`, and every assertion that copies them (27 sites) | 803/804/802, 80/80, 80/107, 1.7s, 2/80, 3/80, 81 rows vs 80 | 811/812/810, 81/81, 81/108, 5.0s, 2/81, 3/81, 82 rows vs 81 | mutation-runner-floors.test.ts, each with a `CURRENCY 2026-10-27 (Phase 171 READCEILING, plan 06)` comment above the moved lines |
| parser: `armsSeen`, `stepsSeen`, needles length, `filesTotal` (x2), `filesAnnotated`, `annotatedFiles` length, by-name list | 803, 916, 916, 107, 80, 80 | 811, 924, 924, 108, 81, 81, plus `test_allocator_trade_reads.sql` in the list | mutation-annotation-parser.test.ts |

Failing expectations quoted in the comments were read from the runs, e.g. `expected 811 to be 803`, `expected 924 to be 916`, `expected 108 to be 107`. After the edits: runner-floors, parser and gate-family-meta tests, 262 passed.

## Task 3: sentinel roster, scanned-file pin

- `ci.yml` sql-tests step: roster row `test_allocator_trade_reads.sql  8` added as the first row of the contiguous table (file-name order, same indent); `SENTINEL_FLOOR` 24 -> 25 and `ARMS_FLOOR` 373 -> 381 (`8 + 13 + 11 + ...`); a dated "Re-measured 2026-10-27" paragraph added ABOVE the table. Measured before the edit (byte backup of the edited file, original restored from HEAD, test run, edited file put back and `cmp` clean): `expected [ ...(25) ] to deeply equal [ ...(24) ]` and `expected 25 to be 24`.
- `drift-check-scripts.test.ts`: `SENTINEL_FLOOR=24` -> `25` and `ARMS_FLOOR=373` -> `381` grep pins, dated RAISED note.
- `ci-anti-skip-gate.contract.test.ts`: no edit, it pins no number (re-derives roster and floors from the corpus; green).
- Linter: `node scripts/lint-sql-gates.mjs --self-test` -> `lint-sql-gates self-test OK: 7 rules, red+green each.`; corpus `lint-sql-gates: scanned 108 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`; `lint-sql-gates.test.ts` pin 107 -> 108 with CURRENCY comment (it read `expected 'lint-sql-gates: scanned 108 file(s); ...' to match /scanned 107 file/` first).
- All six census test files together: 1275 passed.

### Grep-them-all (`git grep -ln 'test_api_key_nav_marks'` at the end)

| File | Names the new gate / tables? | Why |
|---|---|---|
| .github/workflows/ci.yml | yes | roster row, floors, paragraph |
| scripts/mutation-floors.mjs | yes | RAISED entries |
| src/__tests__/gate-family-meta.test.ts | yes | registry keys |
| src/__tests__/mutation-runner-floors.test.ts | yes | pins and CURRENCY comments |
| src/__tests__/mutation-annotation-parser.test.ts | yes | pins and by-name list |
| src/__tests__/drift-check-scripts.test.ts | yes | sentinel floors |
| src/__tests__/lint-sql-gates.test.ts | yes | scanned count |
| scripts/check-gdpr-export-coverage.ts | no, on purpose | prose reference in an allowlist comment for the NAV table; GDPR decision of Task 1 |
| analytics-service/tests/test_nav_marks_writer.py | no, on purpose | docstring about the NAV writer's fake; no census |

No SQL function was added by plan 03, so no function snapshot, `NAME_SET_RATCHET` row or `COMPARED_FLOOR` move was due. The pg-lane fixture `41-fixture-api-keys-user-id-fk.sql` is not enumerated by count anywhere (plan 03 searched; nothing moved).

## Deviations from Plan

None in scope. Two notes:
- Scratch lives in the session scratchpad (`.../scratchpad/readceiling-06`) instead of `/tmp/readceiling-06`, per the environment's scratchpad rule; the verify commands were run with that path substituted.
- The plan's `FILES_FLOOR` text expected the new gate's row to read `8 / 8 / 8 / 0 / 8`; measured exactly that.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema change; types, CI comment table and test pins only.

## Notes for the orchestrator

- Local-stack state: never started by this plan (the mutation runner uses its own throwaway pg-lane cluster); `docker ps` shows 0 containers, no `.stack-env`, no leftover runner process. Plan 11 may use it.
- Merge risk: `mutation-runner-floors.test.ts` and `mutation-annotation-parser.test.ts` pins are numeric and every later gate file added in the phase moves them again; re-measure on the merged tree if another plan adds a gate file or arm.
- `sql-mutation-nightly-parity.test.ts` (not in the plan's list) was run as a cross-check: 11 passed; no `sql-mutation` step in ci.yml was edited.

## Self-Check: PASSED

- Commits 70d9aa56b, 5ff4ba968, 03e6bb179 exist on `wt/171-p06`.
- Edited files present and committed; `git status` clean except this SUMMARY before its commit.
- Task verify equivalents re-run: roster row count 1, types blocks present, floors 81 / 811, `WAIVED_CEILING` 0.
