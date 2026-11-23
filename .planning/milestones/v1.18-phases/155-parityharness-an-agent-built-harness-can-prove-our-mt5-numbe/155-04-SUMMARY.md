---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 04
subsystem: testing
tags: [mt5, parity, sql, vitest, postgres-exec, baseline-ddl, hand-oracles]

requires:
  - phase: 155-parityharness plan 01
    provides: "capture-contract.json (witness_columns, per-file row_shape, columns, day_column, extra_witness) and the synthetic ledger values"
  - phase: 155-parityharness plan 02
    provides: "census-accounts.sql, census-edges.sql, bind.sql and the plan 02 column lists"
  - phase: 155-parityharness plan 03
    provides: "the ten capture-*.sql statements and the scratch-cluster recipe"
provides:
  - "src/__tests__/mt5-parity-capture-sql-exec.test.ts: 66 tests that EXECUTE the census, bind and ten capture statements on a throwaway local PostgreSQL cluster over CREATE TABLE blocks cut verbatim from supabase/schema/baseline.sql, against hand-computed oracles and capture-contract.json"
affects: [155-08, 155-09, 155-10]

actuals:
  tokens: 9930
  tasks: 2
  commits: 2
plan_head_before: 1126fd48e9e4a54f710c345d1652c127209f1aef
plan_head_after: 4b38f5e7922d35d65b6074fde1a5dd9b9399762d

tech-stack:
  added: []
  patterns:
    - "Throwaway socket-only cluster via scripts/pg-lane/run.sh --print-pgbin, short /tmp root, frozen public.now() shadow, local COMMENT ON DATABASE marker; beforeAll throws with no binaries, no skip"
    - "What-if mutations run inside BEGIN ... ROLLBACK so the shared fixture is never changed"
    - "Oracles written from the fixture's own values (daysBetween, plain division, the identity as arithmetic), never from output"

key-files:
  created:
    - src/__tests__/mt5-parity-capture-sql-exec.test.ts
  modified: []

key-decisions:
  - "The census-accounts column list is a pinned copy inside the test, not read from plan 02's PLAN.md: a test must not read .planning/, which the ship filter strips from main"
  - "The json_agg (not jsonb) wrapper is used so the witness column ORDER is observable; nested slice_rows stay jsonb"

requirements-completed: [PARITY-03, PARITY-04]

coverage:
  - id: D1
    description: "census-accounts.sql, census-edges.sql and bind.sql execute on the real baseline DDL and reproduce hand-computed oracles: three-source S with a disagreement, identity ratio 0 (complete) and 5 (missing first deposit, also as a rolled-back what-if), flag_keys, record span from date arithmetic, keys_sharing_login, every Friday edge with ratios and hours, server literal, unrounded raw ratios, and the empty cases (k3, zero MT5 keys)"
    requirement: "PARITY-03, PARITY-04"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql-exec.test.ts#census"
        status: pass
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql-exec.test.ts#bind"
        status: pass
    human_judgment: false
  - id: D2
    description: "all ten capture statements return one ordered row per MT5 ordinal with exactly the contract witness columns, row_count equal to slice_rows, first/last day equal to the day column's min/max, and the contract's row shape (whole_row = the extracted DDL columns); holdings exclude a seeded raw_payload, the BTC native filter is shown both ways, keymap carries no login or encrypted column"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql-exec.test.ts#capture files execute to the contract"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 04: Census and capture SQL executed on the baseline DDL Summary

**One vitest exec test that boots a throwaway PostgreSQL cluster, loads the ten CREATE TABLE blocks cut verbatim from `supabase/schema/baseline.sql`, seeds an invented fixture (three MT5 keys, an okx key between k1 and k2), and runs every committed census, bind and capture statement against hand-computed oracles and `capture-contract.json`; ten independent neuters of the SQL each turn it RED.**

## Accomplishments

- Census: key set and order (k1, k2, k3, then `all`), the okx key absent, the summary row (`keys_examined` 3, every other column NULL), k1 (S agrees from marks, key_inputs and flags; identity 0; record span from `daysBetween`; flags sorted), k2 (S disagrees, flags NULL, identity 5 from `(12070 - (500+570) - (2000-1000)) / 2000`), k3 (mark_count 0, key_inputs_present false, S NULL), the server literal on every per-key row, and the full plan 02 column list in order.
- Edges: every Friday from each key's first mark through yesterday (the calendar is pinned in the test: k1 11-06 and 11-13, k2 10-30, 11-06, 11-13), open-P&L ratios 120/11900, 80/12150, 60/12000, hours 5/60, absent marks NULL, k3 one NULL-friday row, `rows_examined` equal to the per-key row count.
- Zero-key case: with every MT5 key deleted in a rolled-back transaction the census prints the `all` row with `keys_examined` 0, the edges print `rows_examined` 0, and all ten capture files print no row.
- Bind: one row per ordinal with counts and timestamps equal to the seeded values, including the strategy-linked returns row.
- Capture: per-file contract assertions plus targeted ones (analytics length witnesses `[3]` / `[null]` aligned with `slice_rows`, key_inputs, BTC, holdings raw payload, keymap).

## Task Commits

1. **Task 1: census and bind on extracted baseline DDL** - `276c607db` (test)
2. **Task 2: every capture statement against the contract** - `4b38f5e79` (test)

## Verification

- `npx vitest run src/__tests__/mt5-parity-capture-sql-exec.test.ts src/__tests__/mt5-parity-capture-sql.test.ts` -> 187 passed (66 exec, 121 static). With `self-referential-oracle.test.ts` added: 193 passed.
- eslint on the new test: clean. `tsc --noEmit`: nothing reported for the new file.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 4 claims.
- PostgreSQL 16 binaries from `scripts/pg-lane/run.sh --print-pgbin`; the cluster is socket-only and removed in afterAll. No PROD contact, no gateway call, no derive or sync.
- No SQL file needed a fix: every statement matched its oracle on first execution (plans 02 and 03 had already sanity-run them on scratch clusters).

## Neuter, RED, restore, GREEN (the exec test can fail)

Each neuter was applied to the real committed SQL file with a byte backup in scratch; restore checked by sha256 equality (every file's hash identical before and after); `git status` showed no change to any SQL file afterwards.

| Neuter | Result |
|---|---|
| census-accounts: identity divisor takes the LAST flow instead of the earliest | RED (2 failed) |
| census-accounts: `s_raw_marks` min -> max | RED (2 failed) |
| census-accounts: `keys_sharing_login` counts the key itself | RED (2 failed) |
| census-edges: ISO day-of-week 5 -> 4 | RED (2 failed) |
| census-edges: ratio denominator `nav_usd + 1` | RED (2 failed) |
| capture-btc: native-unit filter removed | RED (1 failed) |
| capture-holdings: `raw_payload` added to the object | RED (2 failed) |
| capture-keymap: a `venue_account_id` key added | RED (2 failed) |
| capture-returns: the strategy-linked join arm removed | RED (1 failed) |
| bind: strategy-linked returns dropped from `returns_count` | RED (1 failed) |

## Decisions Made

See `key-decisions`. Assumption A9 stands: CI frontend shards carry PostgreSQL server binaries (the marksource exec precedent already runs there); `beforeAll` throws with the script's stderr if that ever stops being true, so a missing binary is a red run, never a silent skip.

## Deviations from Plan

**1. [Rule 2 - Missing critical] Column list pinned in the test instead of read from plan 02's PLAN.md**
- **Found during:** Task 1
- **Issue:** the plan says to read the census-accounts column list "from plan 02's Artifacts this phase produces". That file lives under `.planning/`, which the ship filter strips from main, so a test reading it would pass here and fail in CI on main (the standing "docs-only PR can red main" class).
- **Fix:** the list is a literal array in the test, annotated with its origin; the static gate and the census SQL are the other two places that pin it.
- **Files modified:** src/__tests__/mt5-parity-capture-sql-exec.test.ts

**2. [Rule 2 - Missing critical] Extra oracles and controls beyond the behaviour list**
- **What:** a what-if (rolled back) that drops k1's first deposit and expects identity 5; a positive control for the BTC native filter (the same statement returns the BTC-only window once k1 carries a native-unit mark, with ETH rows on the same days); a zero-key assertion over all ten capture files; a vacuity guard proving the okx key carries marks, a strategy and a returns row so its absence from every output means something; a check that raw ratios keep more than three significant figures.

**3. [Observation, not a change] Summary row's `server` is NULL**
- The plan text says every census row carries the server literal; plan 02's SQL (and its spec: summary row "every other column NULL") leaves it NULL on the `all` row. The test asserts the literal on every per-key row and NULL on the summary row, matching the SQL as shipped.

**Total deviations:** 2 Rule 2 additions, 1 observation. **Impact:** none on any interface or SQL file.

## Issues Encountered

None. No SQL defect was found, so no SQL file changed (the files listed in `files_modified` stay as plans 02 and 03 left them).

## Known Stubs

None.

## Notes for later plans

- Both tasks edit the one test file; the plan's two tasks were written together and then split into two commits (Task 1 content first, Task 2 block added second).
- `bind.sql` witness names still differ from plan 01's free-form fixture names (unchanged; the test pins bind.sql's own names).
- A migration that changes any of the ten tables will break the seed (NOT NULL or CHECK) or the whole_row column assertions here before it can mislead a capture; that is the point of cutting the DDL from the baseline. A re-dump of the baseline moves the DDL this test reads.

## Threat Flags

None. No new endpoint, auth path or schema; the harness connects only to its own socket-only cluster and reads no database URL (T-155-09), and the oracles are hand-computed (T-155-10).

## Self-Check: PASSED

- Created: `src/__tests__/mt5-parity-capture-sql-exec.test.ts` present.
- Commits `276c607db` and `4b38f5e79` are ancestors of HEAD.
- `commits: 2` is measured (`git rev-list --count 1126fd48e9e4a54f710c345d1652c127209f1aef..HEAD`).
