---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 02
subsystem: database
tags: [postgres, migration, rls, service-role, write-once, deribit, flow-prices, sql-gate]

requires:
  - phase: 171 READCEILING
    provides: the service-role-only store pattern (forced RLS, zero policies, cascade erasure) and the SQL gate house style
  - phase: 167.2.1.1.1 NAVMTM
    provides: the write-once-by-grant precedent (api_key_nav_marks) and the NaN / Infinity CHECK form
provides:
  - public.api_key_flow_prices, the per-key, write-once, service-role-only store of resolved at-instant prices
  - the keep-data manual rollback for it
  - an 8-arm SQL gate with 13 measured RED-UNDER-M twins
affects: [177-03, 177-04, 177-07]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: fac1cac34f281e5aa68b39b98d41bd2474ffa58f
plan_head_after: f9d40110ea668b098660c08d8079df603f695ad4
commits: 2

tech-stack:
  added: []
  patterns:
    - "Write-once is the grant: service_role holds SELECT and INSERT only; the primary key arbitrates the worker's ON CONFLICT DO NOTHING"
    - "One unique mutation-runner arm id per twin, so an arm with several independent defects carries sub-identities (5a/5b, 7a-7e)"

key-files:
  created:
    - supabase/migrations/20261101120000_api_key_flow_prices.sql
    - supabase/migrations/down/20261101120000-rollback.sql
    - supabase/tests/test_api_key_flow_prices.sql
  modified: []

key-decisions:
  - "Timestamp 20261101120000 kept: re-measured free on the branch and on origin/main (newest was 20261031120000), so no renumbering."
  - "Arms 5 and 7 carry sub-identities (5a/5b, 7a-7e): the runner requires one unique arm id per twin and the plan asked for two twins on arm 5 and five on arm 7. The sentinel still counts eight arms."
  - "RED-UNDER-M lines sit at column 0 so the plan's own verify regex (^-- RED-UNDER-M:) counts them; the runner accepts any leading whitespace."

requirements-completed: [SC-3]

coverage:
  - id: D1
    description: "A service-role-only, RLS-forced, write-once per-key price store exists; anon and authenticated hold no privilege and service_role holds SELECT and INSERT only"
    requirement: SC-3
    verification:
      - kind: sql-gate
        ref: "supabase/tests/test_api_key_flow_prices.sql arms 1, 4, 5a, 5b, 8 on a throwaway pg-lane cluster"
        status: pass
    human_judgment: false
  - id: D2
    description: "Rows erase with their key (delete_allocator_api_key) and with their account (auth user), although service_role holds no DELETE"
    requirement: SC-3
    verification:
      - kind: sql-gate
        ref: "supabase/tests/test_api_key_flow_prices.sql arm 6"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every value rule is a named CHECK and the worker's ON CONFLICT DO NOTHING leaves a stored price byte-identical"
    requirement: SC-3
    verification:
      - kind: sql-gate
        ref: "supabase/tests/test_api_key_flow_prices.sql arms 2, 3, 7a-7e"
        status: pass
    human_judgment: false
  - id: D4
    description: "The manual rollback sets the table aside with its row kept and every privilege withdrawn"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "scratch round trip on a throwaway lane: seed one row, run the rollback, check the renamed table"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 02: the per-key moved-flow price store Summary

**`public.api_key_flow_prices` stores each resolved Deribit at-instant price once per (api key, instrument, candle minute): service-role only, write-once by grant, erased with its key and account, proven by an 8-arm gate whose 13 twins each redden their own arm.**

## Performance

- **Duration:** about 40 min (estimated; the start time was not captured)
- **Completed:** 2026-10-28
- **Tasks:** 2 (one tracer, one auto)
- **Files created:** 3

## Accomplishments

- Tracer: the gate was written first and run on a throwaway pg-lane cluster without the migration. RED line: `psql:supabase/tests/test_api_key_flow_prices.sql:536: ERROR:  P0001: TEST FAILED (1): public.api_key_flow_prices does not exist - this gate has nothing to test and must not skip`. With the migration applied last it ran GREEN and printed the sentinel `ALL 8 ARMS EXECUTED (1,2,3,4,5,6,7,8)` with no `TEST FAILED` line.
- Erasure, both paths, proven with service_role holding no DELETE: deleting a key through `delete_allocator_api_key` as its owner removed that key's row, deleting the auth user removed that user's row, and a third user's row stayed (arm 6; no foreign key to auth.users was added).
- Write-once in the worker's own form: `ON CONFLICT (api_key_id, instrument, minute_ms) DO NOTHING` with a different price reports `ROW_COUNT` 0 and leaves the stored row image byte-identical (arm 3). UPDATE, DELETE and TRUNCATE each answer 42501 `permission denied for table api_key_flow_prices` (arms 4, 5a, 5b).
- Every value rule is a named CHECK and arm 7 pins each refusal to its own constraint: price NaN / Infinity / -Infinity and price 0 / -1 (`_price_chk`), a tick off the minute grid, 0 and negative (`_minute_chk`), a lower-case, currency-less, USDT or over-long instrument (`_instrument_chk`), a foreign source (`_source_chk`).
- Measured twins, narrowed mutation run on throwaway lanes: `scope: DIAGNOSTIC supabase/tests/test_api_key_flow_prices.sql`, `scope-reason: a narrowed DIAGNOSTIC run (--file/--arm)`, `arms: 13/13/0`, `biting: 13`, `lane-invocations: 13`, baseline exit 0, restore exit 0, run exit code 2. Each of the 13 arms scored `RED (identity ok)`.
- Rollback round trip: seed one synthetic row, run the rollback, the scratch check printed `RB-CHECK ok: original name gone, renamed table keeps exactly 1 row, no role holds any privilege`, and the rollback printed `Rollback 20261101120000: api_key_flow_prices is set aside as api_key_flow_prices_rolled_back_20261101 with every stored row kept and access withdrawn from every role.`
- Lints: `lint-migration-data-dependence` self-test OK and corpus `311 migration(s), 391 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` (baseline file untouched); `lint-sql-gates` `0 finding(s), 0 measure-fail(s)`, self-test `7 rules, red+green each`.

## Task Commits

1. **Task 1 (tracer):** `56102fe02` (feat) - the migration and the 8-arm gate, RED first, GREEN after
2. **Task 2:** `f9d40110e` (test) - 13 RED-UNDER-M twins and the keep-data rollback

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created

- `supabase/migrations/20261101120000_api_key_flow_prices.sql` - the table, four named CHECKs, comments, forced RLS with no policy, `REVOKE ALL` then one `GRANT SELECT, INSERT` to service_role, a catalogue-only verify block. No transaction statement, policy, trigger, function, CREATE OR REPLACE or cron call.
- `supabase/migrations/down/20261101120000-rollback.sql` - marker-query header, catalogue-only precondition, revoke every privilege, rename the table and its primary key aside, catalogue-only verify, no DROP.
- `supabase/tests/test_api_key_flow_prices.sql` - the gate; its setup list is the Phase 171 list read programmatically from that gate's own `RED-UNDER-SETUP` line with this migration last.

## Decisions Made

- Shape FP-1..FP-6 as the plan decided them (per key, `source` a closed set of one, write-once by grant, not exported, no retention bound, rollback keeps the rows). The operator-facing items the plan said the orchestrator would surface to the founder (Open Questions 6, 7, 9) are unchanged.
- The mutation runner's arm id must be unique per twin, so arm 5 became sub-identities 5a (DELETE) and 5b (TRUNCATE), and arm 7 became 7a (NaN and the infinities), 7b (0 and -1), 7c (minute), 7d (instrument), 7e (source plus the stored-count check). Each carries its own prose `RED-UNDER:` and one machine twin.

## Deviations from Plan

**1. [Rule 1 - plan text] The narrowed mutation run does not print the plan's quoted success line**
- **Found during:** Task 2 verify
- **Issue:** the plan expects `✅ No defects. Every annotated arm bit its own arm first.`; `run.mjs` prints that only for a full-corpus run. A `--file` run prints `No defects in the narrowed scope.` and exits 2, as the plan's own fact list says about the exit code.
- **Fix:** none needed in code. Verified instead by the exit code 2, the `arms: 13/13/0` and `biting: 13` lines and the per-arm `RED (identity ok)` rows. The orchestrator's literal grep for the check-mark line will not match on this log.
- **Files modified:** none

**2. [Rule 3 - Blocking] Sub-identities for arms 5 and 7**
- **Found during:** Task 2 (`--parse-only` reported `duplicate arm "5"` and `"7"`)
- **Issue:** the plan asked for two twins on arm 5 and five on arm 7, but the grammar requires a unique `arm` per twin and matches it to `TEST FAILED (<arm>)`.
- **Fix:** split into 5a/5b and 7a-7e with one prose and one twin each (see Decisions). The sentinel text and its `(1,2,3,4,5,6,7,8)` list are unchanged. Plan 07's census work should treat the file as 13 annotated arms (`sections 8 / annotated 13`), not 8.
- **Files modified:** `supabase/tests/test_api_key_flow_prices.sql`
- **Committed in:** `f9d40110e`

**3. [Rule 1 - plan text] Twin lines at column 0**
- **Found during:** Task 2
- **Issue:** the plan's verify and acceptance regex is `^-- RED-UNDER-M:` (no indentation), while the Phase 171 gate indents its twins.
- **Fix:** the 13 twin lines start at column 0 so the literal check counts 13; the runner reads either form.
- **Committed in:** `f9d40110e`

**Total deviations:** 3 (2 plan-text mismatches, 1 grammar constraint). **Impact on plan:** none on the migration, the grants or the gate's coverage.

## Neuter-and-see-RED evidence

The mutation runner is the neuter drill: each of the 13 twins edits the migration in the scratch copy, the gate went RED with the intended identity first (`RED (identity ok)`), and the file was restored and re-run GREEN (`restore ... exit 0`). The tracer's RED (no migration) is the first drill. No byte backup of a tracked file was needed; the scratch backup of the gate (`gate.bak`) was only used to rebuild the file before the twins were added, and the committed gate matches `cmp` against the tree.

## Known Stubs

None.

## Threat Flags

None. T-177-06 to T-177-10 are mitigated as the register states and each has a gate arm that bites: grants (4, 5a, 5b, 8), cross-user reads (1, 8), erasure (6), value rules (7a-7e), data-independent verify block (lint reports 0 NEW).

## Handback for the orchestrator

- Review gate still owed before merge (not run here): migration-reviewer and rls-policy-auditor on `supabase/migrations/20261101120000_api_key_flow_prices.sql`.
- Census files are plan 07's and were not touched: the `ci.yml` sentinel roster, the mutation floors (`FILES_FLOOR` / `ARMS_FLOOR` rise by 1 file and 13 arms), the TS pins and `src/lib/database.types.ts`.
- Plan 03 can rely on: `FLOW_PRICES_TABLE = "api_key_flow_prices"`, columns `api_key_id, instrument, minute_ms, price, source, created_at`, `on_conflict='api_key_id,instrument,minute_ms'`, `FLOW_PRICE_SOURCE = "deribit_perp_1m_open"`, and a missing table surfacing as a database error on the read.
- No Supabase CLI, `--linked`, `db push`, TEST, PROD or Railway access was used; all lanes were throwaway clusters on 127.0.0.1.

## Self-Check: PASSED

The three created files exist, and commits `56102fe02` and `f9d40110e` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD is 2.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
