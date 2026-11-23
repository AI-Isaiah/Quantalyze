---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 03
subsystem: testing
tags: [mt5, parity, sql, capture, vitest, read-only-gate, completeness-witness]

requires:
  - phase: 155-parityharness plan 01
    provides: "capture-contract.json (slice, day_column, row_shape, columns, extra_witness per file) and render_per_ordinal"
  - phase: 155-parityharness plan 02
    provides: "the static read-only gate (violations, EXPECTED_FILES), the README table test, the key CTE and ordinal rule"
provides:
  - "docs/runbooks/mt5-parity/capture-*.sql: ten SELECT-only statements, one per slice of capture-contract.json, each one row per MT5 key ordinal with key_ordinal, slice_rows, row_count, first_day, last_day (plus returns_series_len and daily_returns_len for analytics)"
  - "gate extended to all 14 SQL files: pinned file set, superset write rules, secret-column rule, label readable only in capture-keymap.sql, capture set equals the contract keys, witness aliases, render-ordinal wrapper stays read-only"
  - "README: ten capture rows, Capture files, Run order, Truncated result, Labels sections"
affects: [155-04, 155-08, 155-09, 155-10]

actuals:
  tokens: 4200
  tasks: 3
  commits: 4
plan_head_before: b1a159bb01b3d6bcb2b522bd208bb3440a6bfc09
plan_head_after: 36e8ea81a63ed1fa09404506f046e9c7fe107e00

tech-stack:
  added: []
  patterns:
    - "LEFT JOIN from the MT5 key CTE, GROUP BY key_ordinal, jsonb_agg ... FILTER (WHERE pk IS NOT NULL) coalesced to '[]': a key with no rows still prints an explicit empty slice"
    - "Length witnesses as jsonb arrays aligned with slice_rows (JSON null where the stored column is not an array)"
    - "The per-ordinal run-time wrapper is itself put through violations() in a test"

key-files:
  created:
    - docs/runbooks/mt5-parity/capture-keymap.sql
    - docs/runbooks/mt5-parity/capture-strategy.sql
    - docs/runbooks/mt5-parity/capture-analytics.sql
    - docs/runbooks/mt5-parity/capture-series.sql
    - docs/runbooks/mt5-parity/capture-marks.sql
    - docs/runbooks/mt5-parity/capture-key-inputs.sql
    - docs/runbooks/mt5-parity/capture-returns.sql
    - docs/runbooks/mt5-parity/capture-holdings.sql
    - docs/runbooks/mt5-parity/capture-equity-curve.sql
    - docs/runbooks/mt5-parity/capture-btc.sql
  modified:
    - docs/runbooks/mt5-parity/README.md
    - src/__tests__/mt5-parity-capture-sql.test.ts

key-decisions:
  - "The capture key CTE carries only id, user_id (and, in the keymap file only, label, account_currency, created_at); it omits plan 02's keys_sharing_login comparison, so no capture file names the MT5 login column at all (the gate forbids it everywhere outside that comparison)"
  - "The label rule of the gate became 'only capture-keymap.sql may name label, and it must': the per-file assertion equals (name === keymap), so the keymap file cannot silently lose the label either"
  - "A secret-column rule (credential suffix, nonce, key-material prefixes, raw_payload) was added over ALL 14 files, not just the capture files"

requirements-completed: [PARITY-03]

coverage:
  - id: D1
    description: "Ten capture statements return the contract witness shape per MT5 key ordinal, with an explicit empty slice for a key with no data; executed on a throwaway PostgreSQL 16 cluster over the baseline DDL"
    requirement: "PARITY-03"
    verification:
      - kind: other
        ref: "throwaway PostgreSQL 16 cluster: two mt5 keys (one with data, one empty) plus a non-mt5 key; every file returns k1 and k2 rows, k2 prints slice_rows [] and row_count 0, analytics lengths [2] and [null] aligned, holdings and keymap rows carry exactly the contract columns, btc returns 10 closes (window 7 days before first return day to last) for the native-unit key and 0 for the other"
        status: pass
    human_judgment: false
  - id: D2
    description: "All 14 SQL files pass the superset write rules; the capture-*.sql set equals the contract keys; every contract witness column is aliased; no capture file selects credential, key-material, login or raw-payload columns; only the keymap file names the label; the render-ordinal wrapper stays read-only"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql.test.ts#capture files follow capture-contract.json"
        status: pass
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql.test.ts#mt5-parity file %s selects no secret column"
        status: pass
    human_judgment: false
  - id: D3
    description: "README names exactly the 14 SQL files and gives the orchestrator the run order, the render-ordinal truncation recovery and the labels step"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql.test.ts#README backticked .sql names equal the directory listing"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-13
status: complete
---

# Phase 155 Plan 03: Read-only capture SQL for our side Summary

**Ten SELECT-only capture statements, one per slice of capture-contract.json, each returning one row per MT5 key ordinal with row_count, first/last day and length witnesses so a truncated MCP result fails loud in seal_capture, behind a gate extended to all 14 SQL files and pinned to the contract.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-13
- **Tasks:** 3 (Task 3 tdd)
- **Files:** 10 created, 2 modified

## Accomplishments

- `capture-keymap.sql` through `capture-btc.sql` share one shape: LEFT JOIN from the MT5 key CTE (ordinal by `created_at, id`, disconnected keys included), `jsonb_agg(row ORDER BY stable key) FILTER (WHERE pk IS NOT NULL)` coalesced to `'[]'`, `count(pk)`, text min/max of the contract's day column (NULL when the contract's is null), then extra witnesses; ordered numerically by ordinal so `k10` follows `k9`.
- `capture-analytics.sql` adds `returns_series_len` and `daily_returns_len` as arrays aligned with `slice_rows` (JSON null for a stored column that is not an array), which is what `seal_capture` compares. `capture-btc.sql` emits closes only for a key with a non-null `native_unit` mark, from 7 days before the key's earliest return day to its latest.
- The gate now pins 14 files, ties the capture set to `capture-contract.json`, checks each witness alias, runs the render-ordinal wrapper through `violations()`, and refuses credential, key-material, login and raw-payload column names in every file.

## Task Commits

1. **Task 1: keymap, strategy, analytics, series, marks** - `a2d4a48ac` (feat)
2. **Task 2: key_inputs, returns, holdings, equity curve, BTC** - `7b488c8f7` (feat)
3. **Task 3 RED: gate pins 14 files and the contract** - `ef2fdc893` (test)
4. **Task 3 GREEN: README run order, truncation recovery, labels** - `36e8ea81a` (docs)

## Verification

- `npx vitest run src/__tests__/mt5-parity-capture-sql.test.ts` -> 121 passed (34 before this plan).
- `node scripts/verify-plan-anchors.mjs` on the plan -> OK, 4 claims.
- eslint on the test file clean; tsc reports nothing for it.
- Execution sanity run (not the permanent exec test, which is plan 04): throwaway local PostgreSQL 16 cluster (scratch data directory, loopback-free unix socket, stopped and deleted afterwards), the nine needed table blocks extracted from `supabase/schema/baseline.sql`, invented all-zero-pattern ids. All ten files ran; results as in coverage D1. The holdings row keys equal the contract's 17 columns with no raw payload; the keymap row keys equal its 8.
- No PROD contact, no gateway call, no derive or sync.

## Neuter, RED, restore, GREEN (the gates can fail)

Each neuter applied to the real committed file with a byte backup in scratch; restore checked by sha256 equality; GREEN 121 passed after each.

| Neuter | Result |
|---|---|
| capture-marks.sql: `m.label` added to a sort | RED (1 failed): only the keymap file may name the label |
| capture-returns.sql: a `nonce` output column added | RED (1 failed): secret-column rule |
| capture-btc.sql: a `nextval(...)` call added | RED (2 failed): function denylist, plus the per-ordinal wrapper test |
| capture-series.sql: `row_count` alias renamed | RED (1 failed): witness alias missing |
| capture-keymap.sql: every `label` renamed | RED (1 failed): keymap must carry the label |
| capture-btc.sql moved away | RED: no tests found for the pinned file (pin and directory disagree), restore -> GREEN |
| in-test: a write word placed inside the wrapped statement | still reported (permanent test) |

## TDD record (Task 3)

- **RED (`ef2fdc893`):** 1 failed, 120 passed. The one failure is the real assertion "README backticked .sql names equal the directory listing" (README did not yet name the ten capture files). The capture files already existed, so the capture-specific assertions passed at RED; the neuter table above proves each can fail.
- **GREEN (`36e8ea81a`):** 121 passed.

## Decisions Made

See `key-decisions`. Assumption A11 from the plan stands: no file is split speculatively; truncation is handled by witnesses plus the render-ordinal fallback.

## Deviations from Plan

**1. [Rule 2 - Missing critical] Gate label rule changed from "no file names label" to "only the keymap file names it"**
- **Found during:** Task 3
- **Issue:** plan 02's per-file rule banned `label` in every SQL file, which would fail `capture-keymap.sql`, the one file the plan requires to read it.
- **Fix:** the assertion is `name === capture-keymap.sql`, in both directions.
- **Files modified:** src/__tests__/mt5-parity-capture-sql.test.ts

**2. [Rule 2 - Missing critical] Secret-column rule added over all 14 files**
- **What:** `_encrypted`, `nonce`, `dek_`, `kek_`, `raw_payload` may appear in no file. The plan's acceptance criterion greps only the keymap file and the holdings file by hand; this makes the prohibition (T-155-08) a permanent test.

**3. [Rule 1 - Bug] Plan 02's `ORDER BY key_ordinal` pitfall repeated here**
- **What:** capture files order by `length(key_ordinal), key_ordinal`, as plan 02's census does, so `k10` sorts after `k9`. Not a deviation from an instruction (the plan says "ORDER BY key_ordinal"), a refinement of it; the seal does not depend on order.

**Total deviations:** 3 (1 Rule 1 refinement, 2 Rule 2). **Impact:** none on the contract; output columns and names are exactly the plan's.

## Issues Encountered

None.

## Known Stubs

None.

## Notes for later plans

- Plan 04 owns the permanent execution test. The throwaway-cluster shape used here (nine baseline table blocks, `pgcrypto`, unix socket in a short path since the scratchpad path exceeds the 103-byte socket limit) is enough to run all ten files; remember `gen_random_uuid` is unquoted-callable after the sed of the quoted form.
- `bind.sql` witness column names (`analytics_max_computed_at`, ...) still differ from plan 01's fixture names, as plan 02 noted; unchanged here. Plan 03's files do not touch bind.
- README's Truncated result section names `scripts.mt5_parity_records render-ordinal` as built in plan 08; that script does not exist yet.
- `capture-key-inputs.sql` and `capture-equity-curve.sql` read the same table with different kinds; `capture-equity-curve.sql` repeats the allocator's one row for every key of that allocator, which is a harmless duplicate the loader keys per ordinal.

## Threat Flags

None. No new endpoint, auth path or schema; read-only SQL guarded by the T-155-07 and T-155-08 mitigations above.

## Self-Check: PASSED

- Created: all ten `capture-*.sql` files present (`[ -f ]` checked via the vitest directory pin and `wc`).
- Commits `a2d4a48ac`, `7b488c8f7`, `ef2fdc893`, `36e8ea81a` are ancestors of HEAD.
- `commits: 4` is measured (`git rev-list --count b1a159bb01b3d6bcb2b522bd208bb3440a6bfc09..HEAD`).
