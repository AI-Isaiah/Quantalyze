---
phase: 155-parityharness-an-agent-built-harness-can-prove-our-mt5-numbe
plan: 02
subsystem: testing
tags: [mt5, parity, sql, census, vitest, read-only-gate, gitignore]

requires:
  - phase: 155-parityharness plan 01
    provides: "capture-contract.json (the witness-column and slice contract the SQL plans build to); the sealed-capture format the bind witnesses feed"
provides:
  - "docs/runbooks/mt5-parity/{marker,bind,census-accounts,census-edges}.sql and README.md: the PARITY-04 pre-flight census as versioned read-only SQL the orchestrator runs through the Supabase MCP"
  - "src/__tests__/mt5-parity-capture-sql.test.ts: static read-only gate (superset write words, function denylist), RED proof on byte-backup neuters, .gitignore pin, redaction scan; EXPECTED_FILES is the const plan 03 extends"
  - "/.mt5-parity/ in .gitignore: the capture directory cannot be committed"
affects: [155-03, 155-04, 155-05, 155-10]

actuals:
  tokens: 6800
  tasks: 2
  commits: 2
plan_head_before: e42f7cdd130827cb7f3051e42c0a2ba5d8b2d6d7
plan_head_after: 858412d0b755ddccd7df582fe9b83944f3b060dd

tech-stack:
  added: []
  patterns:
    - "One statement per runbook file, WITH/SELECT, one trailing ';', no '--', no uuid literal, schema-qualified, UTC today as (now() AT TIME ZONE 'UTC')::date"
    - "Summary row 'all' UNION ALL'd last so an empty census prints keys_examined = 0 / rows_examined, never a silent empty result"
    - "Gate rules in ONE function (violations) that the RED-proof tests call, so the proof exercises the code the gate runs"
    - "The MT5 login is compared inside a correlated subquery (keys_sharing_login) and is never a CTE or output column"

key-files:
  created:
    - docs/runbooks/mt5-parity/marker.sql
    - docs/runbooks/mt5-parity/bind.sql
    - docs/runbooks/mt5-parity/census-accounts.sql
    - docs/runbooks/mt5-parity/census-edges.sql
    - docs/runbooks/mt5-parity/README.md
    - src/__tests__/mt5-parity-capture-sql.test.ts
  modified:
    - .gitignore

key-decisions:
  - "census-inception and census-flags are folded into census-accounts (identity_* and flag_keys columns): same grain, two fewer orchestrator calls (plan objective, recorded choice)"
  - "census-accounts and bind order by a numeric ordinal (length then text in the union, row_number in bind) so k10 sorts after k9; the plan's ORDER BY key_ordinal would sort it after k1"
  - "A key with marks but no Friday in range (S is recent) gets the same NULL-friday row as a key with no marks, so no key silently disappears from census-edges"
  - "first/last return date read the returns_series array, else a daily_returns array; an object-shaped daily_returns (legacy) yields NULL dates rather than a guessed range"
  - "Extra tests beyond the plan: no label or login in any file's output, server literal exactly once, summary rows present, Friday enumeration present"

patterns-established:
  - "Sanity-execute census SQL on a throwaway local PostgreSQL 16 cluster built from the extracted baseline DDL before committing (plan 04 owns the permanent exec test)"

requirements-completed: [PARITY-03, PARITY-04]

coverage:
  - id: D1
    description: "The PARITY-04 census exists as read-only SQL: census-accounts per key ordinal (S from three sources and agreement, mark count, record length, computed_at, flag keys, key_inputs presence, inception identity, server literal, 'all' row) and census-edges (every Friday since the first mark with mark presence and open-P&L ratio)"
    requirement: "PARITY-04"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql.test.ts#census-accounts.sql carries the PARITY-04 fields"
        status: pass
      - kind: other
        ref: "throwaway PostgreSQL 16 cluster on the baseline DDL, 2 mt5 keys: identity_ratio 0 on 150 - 30 - 120, native mark ratio 0.5, 6 edge rows, zero-key run prints the 'all' row"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every .sql file in the directory is one WITH/SELECT statement with one trailing ';', no '--', no uuid, no write or DDL keyword from the superset list, no denylisted function; the gate is shown RED on neutered byte copies and GREEN after the byte restore"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql.test.ts#the read-only gate can fail (neuter, RED, byte restore, GREEN)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/.mt5-parity/ is a literal .gitignore line, git check-ignore agrees, and no tracked file lives under it"
    requirement: "PARITY-03"
    verification:
      - kind: unit
        ref: "src/__tests__/mt5-parity-capture-sql.test.ts#the capture directory is untracked"
        status: pass
    human_judgment: false
  - id: D4
    description: "README names exactly the .sql files in the directory and states the orchestrator-only run order, what may be written down and why the server is a literal"
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

# Phase 155 Plan 02: Read-only PROD census SQL and its static gate Summary

**Four read-only SQL statements (marker, bind witnesses, per-key account census with three-source S and inception identity, every-Friday edge census) behind a vitest gate that is a superset of the marksource guard and is shown RED on three independent neuters, plus a pinned `/.mt5-parity/` gitignore line.**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-11-13T20:10Z
- **Tasks:** 2
- **Files:** 6 created, 1 modified

## Accomplishments

- `census-accounts.sql` returns one row per MT5 key ordinal (disconnected keys included, so ordinals stay stable) plus a final `all` row with `keys_examined`, with the 32 columns the plan lists in its order. `S` is read from raw marks, the `key_inputs` payload and the strategy's data-quality flags, and `s_agree` is true only when all three are non-null and equal. The inception identity is `(realized_terminal_usd - sum composed_day_pnl - sum composed_flows) / |earliest flow|`, NULL when the key_inputs row, the terminal or any flow is absent.
- `census-edges.sql` enumerates every Friday mark day from each key's first mark through yesterday UTC via `generate_series` plus ISO day-of-week 5 (no hard-coded 2026-10-30 / 2026-11-13), with presence, open-P&L ratio (native when the mark carries a unit), `marked_at` and hours after UTC midnight.
- `bind.sql` carries the before/after freshness witnesses per key ordinal; `api_key_id` is capture-directory only.
- The gate adds INTO, MERGE, DO, REVOKE, VACUUM, REFRESH, COMMENT, LOCK, PREPARE, EXECUTE and SET to the precedent's ten write words, plus a function denylist (nextval, setval, advisory locks, pg_notify, set_config, dblink, pg_sleep, lo_*).

## Task Commits

1. **Task 1: census SQL set and README** - `44f936b70` (feat)
2. **Task 2: static gate, RED proof, .gitignore line and pin** - `858412d0b` (test)

## Verification

- `npx vitest run src/__tests__/mt5-parity-capture-sql.test.ts` -> 34 passed (after `npm ci`, 1000 packages from the existing lockfile, nothing added).
- `grep -cx '/.mt5-parity/' .gitignore` -> 1; `git check-ignore -q .mt5-parity/probe.json` -> exit 0.
- `cmp docs/runbooks/mt5-parity/marker.sql docs/runbooks/marksource-okx-census/marker.sql` -> equal.
- `node scripts/verify-plan-anchors.mjs` on the plan -> OK, 8 claims.
- `self-referential-oracle.test.ts` -> 6 passed; eslint on the new test -> clean; tsc reports nothing for the new file.
- Census SQL executed on a throwaway local PostgreSQL 16 cluster (loopback port, data directory in scratch, stopped and deleted afterwards) with the eight table blocks extracted from `supabase/schema/baseline.sql` and invented rows (all-zero-pattern ids): all three queries run; identity ratio 0 on a hand-built 150 - 30 - 120; native mark ratio 1/2 = 0.5; 6 edge rows incl. the NULL-friday row for a key without marks; with zero MT5 keys the census prints `all` with `keys_examined = 0` and the edges `all` row with `rows_examined = 0`. This is a sanity run, not the permanent exec test (plan 04).
- No PROD contact, no gateway call, no derive or sync.

## Neuter, RED, restore, GREEN (data-integrity gate able to fail)

| Neuter | Result |
|---|---|
| in-test: ` INTO scratch` before the final `;` of a copy of census-accounts.sql (byte backup + sha256 in a temp dir) | `violations` reports INTO; byte restore has the original sha256 and reports nothing |
| in-test: leading `DO $$ BEGIN END $$; ` | reported by DO, by `semicolons:2` and by the start rule: three independent rules |
| in-test: `nextval('x')` injected | reported as `fn:nextval` with no write keyword involved |
| on the real committed file: ` INTO scratch` appended to census-edges.sql (backup in scratch) | RED: "carries no write keyword" failed for census-edges.sql (1 failed, 33 passed); restore sha256 781e7c2f8b1f97e9 equal before and after; GREEN 34 passed; `git status` clean |

## Decisions Made

See `key-decisions`. Assumptions from the plan stand: ISO calendar dates may appear in tracked records (RESEARCH proposed day counts; this plan keeps dates, flagged), and PARITY-03's edge-probe category stays an unclassified assumption with no invented truth.

## Deviations from Plan

**1. [Rule 1 - Bug] Numeric ordering instead of `ORDER BY key_ordinal`**
- **Found during:** Task 1
- **Issue:** `key_ordinal` is text (`k1`..), so a plain sort puts `k10` before `k2` once an account count passes nine.
- **Fix:** bind orders by the `row_number()` ordinal; the two union queries order by `(key_ordinal = 'all'), length(key_ordinal), key_ordinal` (a UNION result cannot be ordered by an expression, so the union sits in a subquery, which still outputs exactly the plan's columns).
- **Files modified:** bind.sql, census-accounts.sql, census-edges.sql

**2. [Rule 2 - Missing critical] A key with marks but no Friday in range kept visible**
- **Found during:** Task 1
- **Issue:** the plan gives a NULL-friday row only to a key with no marks; a key whose first mark is recent (no Friday yet) would produce no row and vanish from the census.
- **Fix:** the NULL-friday row is emitted for every key that produced no Friday row.

**3. [Rule 2 - Missing critical] Extra gate tests for the plan's prohibitions**
- **What:** no `label` word and no login output column in any SQL file, `venue_account_id` only inside the `keys_sharing_login` comparison, the server literal exactly once, the `all` summary rows, Friday enumeration. The plan's prohibition register says these are verified by test; the behaviour list did not spell them out.

**Total deviations:** 3 (1 Rule 1, 2 Rule 2). **Impact:** none on the plan's interfaces; the output columns and their order are as listed.

## Issues Encountered

None. The first scratch-cluster fixtures hit NOT NULL / CHECK constraints of the real DDL (bigint id without the sequence, `api_key_nav_marks_native_basis_chk`); the fixtures were corrected, the SQL was not affected.

## Known Stubs

None. The `server` column is deliberately the literal `unmeasured (155.1 reading owns it)` (founder decision "Shared server: measure it"): the server travels inside the encrypted credential, so a SELECT cannot read it. This is a recorded measurement boundary, not a placeholder.

## Notes for later plans

- Plan 03 extends `EXPECTED_FILES` in the gate test with the `capture-*.sql` files and the README table together; the gate's rules then bind them automatically.
- Plan 04 owns the permanent exec test: it should assert the census output columns (including that no login or label column exists) against the extracted DDL, and it can reuse the throwaway-cluster shape used for the sanity run here (frozen `public.now()` shadow reaches the `(now() AT TIME ZONE 'UTC')::date` expression).
- `bind.sql` columns are `analytics_max_computed_at`, `marks_max_created_at`, `key_inputs_computed_at`, `returns_max_updated_at`, `equity_curve_computed_at`, `holdings_max_updated_at`, which differ from plan 01's free-form fixture witness names (`analytics_computed_at` ...). Plan 01's summary says bind rows are free-form there, so the loader accepts equal lists either way; if plan 03/10 want a typed witness check, align the names then.
- Raw census output goes to `raw/<stem>.json` in `/.mt5-parity/<run>/` (gitignored); the orchestrator runs `marker.sql` first, one query per call.

## Threat Flags

None. No new endpoint, auth path or schema; the SQL runs read-only under the standing authorization and the gate that guards it is the T-155-04 mitigation.

## Self-Check: PASSED

- Created files all present: marker.sql, bind.sql, census-accounts.sql, census-edges.sql, README.md, mt5-parity-capture-sql.test.ts (checked with `[ -f ]`).
- Commits `44f936b70` and `858412d0b` are ancestors of HEAD.
- `commits: 2` is measured (`git rev-list --count e42f7cdd130827cb7f3051e42c0a2ba5d8b2d6d7..HEAD`).
