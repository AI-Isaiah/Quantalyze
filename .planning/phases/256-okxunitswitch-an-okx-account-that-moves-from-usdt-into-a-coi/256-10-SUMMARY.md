---
phase: 256-okxunitswitch
plan: 10
subsystem: planning-ledgers
tags: [close, sc-6, proof-01-index, ship-order, post-deploy-read, okx, unit-switch]
status: complete

requires:
  - phase: 256-01 through 256-09
    provides: the nine SUMMARY.md files and their PROOF-01 blocks
provides:
  - "232-CONTEXT.md and ROADMAP.md: the dated SC-6 correction (buy days 2026-11-14 and 2026-11-20 by UTC bill timestamp)"
  - "this SUMMARY: the PROOF-01 index for plans 01-09, the two-PR ship order, the post-deploy SC-5 read procedure, the open-item list for the orchestrator"
affects: [ship, verify-work]

plan_head_before: f33a7cf6748e0c5ca461495448608476eb8129e6
plan_head_after: ebe66229618785eb2a4daa79fae5d1e8d6e5d99b

# actuals (#2632): chars/4 over the added lines of the realized diff (two ledger notes, about 1600 chars) plus
# this SUMMARY (about 24000 chars, not counted: it is the deliverable of tasks 2 and 3). commits is MEASURED from
# the per-plan ledger (base above); the SUMMARY commit that follows is not in that range. Tasks 2 and 3 change no file
# other than this SUMMARY.
actuals:
  tokens: 400
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/256-okxunitswitch-an-okx-account-that-moves-from-usdt-into-a-coi/256-10-SUMMARY.md
  modified:
    - .planning/phases/232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co/232-CONTEXT.md
    - .planning/ROADMAP.md

key-decisions:
  - "SC-7 is NOT marked met: the migration-reviewer and rls-policy-auditor verdicts for plan 02 were not supplied to this plan, and one census pin the phase's own gate file moves is still red (see Open items 1 and 2)"
  - "SC-5 stays open as a post-deploy step; this plan ran no PROD query and records no result"

requirements-completed: [SC-6]

duration: about 1h
completed: 2026-11-27
---

# Phase 256 Plan 10: CLOSE Summary

**SC-6 is met: 232-CONTEXT and the ROADMAP both state the buy days as 2026-11-14 and 2026-11-20 by UTC bill timestamp (holdings asof labels 11-15 and 11-21), with the older wording kept as lineage under a dated correction. The PROOF-01 evidence of plans 01-09 is indexed below (42 gate rows, every named gate present with a RED, a silent cmp and a GREEN). SC-5 is a post-deploy read with an exact id-free procedure; no PROD query was run here.**

## What was done

- **Task 1 (tracer, commit `ebe662296`).** `232-CONTEXT.md` gained a `CORRECTED 2026-11-27 (Phase 256 research)` paragraph under the dated note; the ROADMAP Phase 256 "Cause." bullet gained the same correction as a trailing sentence. Both name each other. The 232-03 ROADMAP note was checked and still states the reason (the refusal froze one account's 3 strategies and failed 7 nightly derives); it carries no buy dates, so it needed no edit. Edits were scoped `Edit` replacements, `git diff --stat` shows 3 insertions and 1 modified line (the Cause bullet itself), no phase section removed. Both greps return 1: `grep -c "2026-11-14 and 2026-11-20"` on the ROADMAP and on 232-CONTEXT.
- **Task 2 (no file change).** The PROOF-01 index and the ship order are the sections below. The Phase 256 ROADMAP section needed no objective correction after execution, so ROADMAP.md was not touched further.
- **Task 3 (no file change).** The post-deploy SC-5 procedure is the section "Post-deploy SC-5 read" below.

## PROOF-01 index (plans 01-09)

`grep -c "## PROOF-01"` returns 1 for each of the nine SUMMARY files, so no plan has fewer blocks than it promised: every gate each PLAN names (01: A, B; 03: A, B, C; 04: A, B, C; 05: A, B, C; 06: A, B, C; 07: A, B, C; 08: A, B, C; 09: A, B, C; 02: the CHECK) has a block. Every row's cmp was reported silent (exit 0) and every restore was by `cp`. "First FAILED" is the first named failing test (or assertion) pasted in that SUMMARY; GREEN is the pasted pass line after the restore.

| Plan | Gate | Neuter | First FAILED line | cmp | GREEN |
|---|---|---|---|---|---|
| 01 | A | `derive_unit_switch`: S is always the first coin bill day (min dropped) | `test_majority_before_the_first_bill_pins_s_to_the_majority_day` (1 failed, 73 passed) | silent | 74 passed |
| 01 | A2 (extra) | S is always the first majority day (bill day ignored) | `test_differently_shaped_account_derives_its_own_dates` (3 failed, 71 passed) | exit 0 | 74 passed |
| 01 | B | `split_daily_pnl_at_switch`: the coin bill dated S goes to `coin_by_day` | `test_boundary_oracle_each_day_is_in_exactly_one_unit` (8 failed, 66 passed) | exit 0 | 74 passed |
| 02 | CHECK | `CHECK (true)` in place of the object check | `TEST FAILED (3): a JSON array was not refused by strategy_analytics_unit_segments_object_chk` (lane exit 3) | exit 0 | lane exit 0 |
| 03 | pre-fix | origin/main `exchange.py` swapped in | `test_tracer_a_switched_coin_is_read_as_stable_pnl_with_the_coin_bills_on_the_side_channel` (20 failed, 11 passed) | silent | 31 passed |
| 03 | A | coin amount also added into `daily_totals` | `...::test_tracer_a_switched_coin_is_read_as_stable_pnl_with_the_coin_bills_on_the_side_channel` (1 failed, 20 passed) | silent | 21 passed |
| 03 | B | a code other than the switched coin no longer refuses | `test_a_bill_in_any_other_coin_still_refuses_even_beside_a_switched_one` (1 failed, 20 passed) | silent | 21 passed |
| 03 | C | `sync_trades` call passes `unit_switch=None` (call-site AST pin) | `test_only_the_derive_may_pass_unit_switch` (1 failed, 20 passed) | silent | 21 passed |
| 04 | A | step 6 concatenates native coin returns unconverted | `test_tracer_founder_shaped_inputs_give_a_whole_history_usd_headline` (9 failed, 14 passed) | silent | 23 passed |
| 04 | B | step 5 anchors the USD segment at `anchor_usd` | `test_tracer_founder_shaped_inputs_give_a_whole_history_usd_headline` (2 failed, 21 passed) | silent | 23 passed |
| 04 | C | `transforms.py` floors default is the BTC row | `test_transforms.py::TestDustThresholdC0233::test_genuine_dust_balance_still_falls_back_to_heuristic` (6 failed, 104 passed, 2 errors, `--noconftest`); see caveat 1 | silent | 113 passed (repo conftest) |
| 05 | A | adjacency check in `parseUnitSwitch` | `a first coin day two days after the last USD day reads as absent` (3 failed, 51 passed) | silent | 54 passed |
| 05 | B | `composeUnitSwitchSentence` swaps the two days | `composeUnitSwitchSentence > builds the founder's frame from the two derived days` (7 failed, 57 passed across 2 files) | silent | 64 passed |
| 05 | C | `unitSwitch` spread removed in `fetch-and-build-payload.ts` | `a switched row carries unitSwitch and unitSegments and leaves returnsUnit and usdView unset` (3 failed, 9 passed) | silent | 12 passed |
| 05 | composite (extra) | `isComposite ? null :` removed | `AssertionError: expected true to be false` | silent (stated) | green (stated); see caveat 2 |
| 06 | pre-fix | BASE `job_worker.py` swapped in | `test_tracer_ends_done_with_the_whole_history_usd_headline_and_the_two_unit_record` (2 failed) | exit 0 | n/a (restored byte-exact) |
| 06 | A | switched combine branch disabled (`if False and ...`) | `test_tracer_ends_done_with_the_whole_history_usd_headline_and_the_two_unit_record` (13 failed, 9 passed) | exit 0 | 22 passed |
| 06 | B | runner carry disabled in `analytics_runner.py` | `test_the_marker_survives_the_rebuild_and_the_benchmark_is_still_paired` (2 failed, 8 passed) | exit 0 | 10 passed |
| 06 | C | `unit_segments` written only when switched | `test_an_unswitched_strategy_writes_unit_segments_null_explicitly` (1 failed, 21 passed) | exit 0 | 22 passed |
| 06 | D (extra) | latest-completed-day filter removed | `test_todays_stable_pnl_is_left_out_and_the_derive_still_ends_done` (1 failed, 21 passed) | exit 0 | not pasted; see caveat 3 |
| 07 | A | the two segments joined into one path (`TimeSeriesChart.tsx`) | `draws the USD and the coin segment as two separate accent paths that meet only in x` (4 failed, 18 passed) | silent | 22 passed |
| 07 | B | `UnitSwitchLeverageHold` wrapper removed | `a consumer that sets leverage 3 still reads 1, and every KPI, chart and caption equals the 1x render byte for byte` (1 failed, 4 passed) | silent | 5 passed |
| 07 | C | comparator allowed past x(S) (`chart-configs.ts`) | `the comparator path ends at x(S) and the figcaption names the stop` (1 failed, 21 passed) | silent | 22 passed |
| 07 | D, E, F (extra) | unpriced day's return dropped; coin-segment seam filter removed; overflow flip removed | one named arm each, 1 failed, 21 passed each | silent | 22 passed (stated for all three) |
| 08 | A | `UnitSwitchChip` renders the days swapped | `UnitSwitchChip > renders the compact visible text, the sr-only sentence, the title and the attribute` (4 failed, 17 passed) | silent | 21 passed |
| 08 | B1 | `queries.ts` select drops one projected scalar | `each of the six aliases is in the select exactly once` (4 failed, 179 passed) | silent | 183 passed |
| 08 | B2 | `queries.ts` projection drops one scalar | `shapeRowAnalytics ... an anonymous ranked row: the projected aliases become the three scalars` (16 failed, 23 passed) | silent | 39 passed |
| 08 | C | scenario-share page takes the switch coin as a unit source | `reads the leg unit from native_unit alone` (2 failed, 40 passed) | silent | 42 passed |
| 08 | C2 | returns route takes the switch coin as a unit source | `a switched strategy keeps returns_unit null and returns the three switch fields` (4 failed, 6 passed) | silent | 10 passed |
| 08 | D (extra) | OG route drops the switch note | `prints the switch sentence and 'Figures in USD.' as one note` (4 failed, 6 passed) | silent | 10 passed |
| 08 | E (extra) | factsheet page card URL drops the switch key | `a switched strategy's card URL carries the coin and both days, and differs from the plain URL` (2 failed, 21 passed) | silent | 23 passed |
| 08 | F (extra) | returns route drops the `unit_switch` field | `a switched strategy keeps returns_unit null and returns the three switch fields` (3 failed, 7 passed) | silent | 10 passed |
| 08 | G1 | `ScenarioComposer.tsx` names `unit_switch` | `... (scenario composer) reads a leg's unit from the returns payload's returns_unit alone` (1 failed, 11 passed) | silent | 12 passed |
| 08 | G2 | `HoldingsTable.tsx` names `unit_switch` | `... (allocator book view) reads a holding's unit from quantity_unit` (1 failed, 11 passed) | silent | 12 passed |
| 08 | G3 | `AllocatorExchangeManager.tsx` names `unit_switch` | `... (allocator keys) reads a key's unit from account_currency` (1 failed, 11 passed) | silent | 12 passed |
| 08 | G4 | `departed-history.ts` names `unit_switch` | `... (departed history) takes its not-in-USD reasons from the derive's stamp` (1 failed, 11 passed) | silent | 12 passed |
| 08 | G5 | `queries.ts` allocator book cast adds the switch as a unit source | `... allocator book payload (getMyAllocationDashboard) reads a strategy's unit from native_unit alone` (1 failed, 11 passed) | silent | 12 passed |
| 09 | A | coin days priced at S's close | `test_usd_day_pnl_for_coin_days_is_priced_at_each_days_own_close` (2 failed, 9 passed) | exit 0 | 11 passed |
| 09 | B | `native_unit` written into the key payload and strategy flags | `test_tracer_key_derive_ends_done_with_usd_key_inputs_and_unit_segments` (9 failed, 10 passed) | exit 0 | 19 passed |
| 09 | C | `"unpriced_days": []` in the payload | `test_the_payload_names_the_unpriced_days_and_the_level_before_the_hole` (2 failed, 9 passed) | exit 0 | 11 passed |

Plan 02 additionally ran the mutation runner on its gate file: `arms: 9/9/0`, `biting: 9`, `lane-invocations: 9`, every arm `RED (identity ok)`, baseline and restore legs exit 0.

### Caveats to the index (Rule 12, nothing hidden)

1. **Plan 04 gate C** was run with `--noconftest`; the first FAILED line in that run was `test_broker_dailies.py::test_deribit_routes_through_native_combine` plus 2 errors, which plan 04 itself says it did not investigate and does not claim (a sibling Deribit test fails at baseline under `--noconftest`). The claim rests on the `test_transforms.py` rows, all green under the final repo-conftest GREEN. The row above names a `test_transforms.py` test for that reason.
2. **Plan 05 composite arm** quotes the RED assertion but pastes no count line and no GREEN line; its SUMMARY states the restore by `cp`, a silent `cmp` and GREEN. Extra gate, not a plan-named one.
3. **Plan 06 gate D** pastes the RED and `cmp exit: 0` but no GREEN line; the production file was stated equal to its committed bytes after each restore. Extra gate, not a plan-named one.
4. **Plan 08's static-pin gates (C, G1-G5)** prove a text rule ("no reader reads `unit_switch` as a unit source"), not behaviour; plan 08 says so itself and carries the behavioural proof through the projection, payload and returns-route arms. Several of those readers were already correct on origin/main, so they have no pre-fix RED by design (plan 08's reachability table).

## Ship

The order is binding:

1. **PR-1 carries only plan 02's files**: the migration, its rollback, the SQL gate file and the census files that file moved (`scripts/mutation-floors.mjs`, `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/lint-sql-gates.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/mutation-runner-floors.test.ts`). It must merge and apply to PROD (`apply-test`, then `apply`) before PR-2 opens, because the analytics select now names `unit_segments` and a PostgREST select naming an absent column fails the whole request. Status given to this plan by the orchestrator: shipped as PR #1402, merged to main as `f7c80fb7a781f731eca75e07dfcdc58c1fa46080` (v0.133.108.0), migration re-stamped to `20261127200000_strategy_analytics_unit_segments.sql` (this branch still has `20261128120000_...`; the orchestrator reconciles that at rebase; not renamed here); the TEST then PROD auto-apply is running and the orchestrator confirms it. See Open item 2: a pin that this gate file moves is still red in this branch and must have been carried into PR-1.
2. **PR-2 carries plans 01 and 03-09** (code only). It opens only after PR-1's apply is confirmed.
3. **Every ship PR** writes its CHANGELOG entry in the same commit as the VERSION bump (VERSION and `package.json` byte-equal 4-digit strings, never `npm version`), changes nothing under `.planning`, and never writes the skip trailer (CLAUDE.md), not even to deny it. CHANGELOG, VERSION and `package.json` are written at ship time by the orchestrator, not in this plan.
4. **No TODOS entry is closed by this phase**: `grep -n -i "non_usd_okx\|OKXUNITSWITCH" TODOS.md` prints nothing (re-run at this HEAD: nothing), so no CHANGELOG entry names one.
5. After PR-1 applies to PROD, the routine baseline re-dump follows `supabase/schema/BASELINE.md` "Regenerating" in its own release.

## Post-deploy SC-5 read

**Status: PENDING. This plan ran no PROD query and records no result.** SC-5 (the account's 4 key-mode and 3 strategy-mode `derive_broker_dailies` jobs end `done`; its 3 strategies stop standing on `read_refusal_kept_figures`) can only be read after PR-2 deploys (Railway analytics deploys only after main CI is green) and after the next nightly derive. The code merge does not wait for it. SC-5 stays open (human_needed / post-deploy) until the procedure has run twice: once after the deploy, once after the next nightly derive.

Rules for whoever runs it: PROD reads go through the MCP first, one query per call, never chained; read-only; print counts, booleans and the two switch days only; write no id, amount or account number anywhere tracked (public repo). Record the results in the phase VERIFICATION, never ids.

1. **Marker query, verbatim from CLAUDE.md. Stop unless the answer names PRODUCTION.** `current_database()` proves nothing; the marker is the only check.

   ```sql
   SELECT shobj_description(oid, 'pg_database') AS which_database
     FROM pg_database WHERE datname = current_database();
   ```

   NULL or a non-PRODUCTION answer: stop, re-set or re-point, do not proceed on a guess.

2. **Job census (one query).** `compute_jobs` rows of `kind = 'derive_broker_dailies'` created since the deploy, whose own previous failed row's `last_error` contained `daily_pnl_non_usd_okx`, grouped by mode (`api_key_id IS NOT NULL` is key mode, `strategy_id IS NOT NULL` is strategy mode, exactly one is set by `compute_jobs_target_xor`) and `status`; print counts only. **Expect 4 key-mode and 3 strategy-mode `done`**, no `failed_final` among them. A pending or running row is not yet a verdict: wait for it.

3. **Standing refusal (one query).** For the same 3 strategies, the latest strategy-mode `derive_broker_dailies` job's `metadata` has no `read_refusal_kept_figures` key (the key lives on a failed job's own `compute_jobs.metadata`; a `done` latest job means no live failure holds it). Print a count of strategies whose latest job still carries it. **Expect 0.**

4. **Stored switch (one query).** `strategy_analytics` for those strategies: `data_quality_flags->'unit_switch'` has `coin = 'BTC'`, `last_usd_day = 2026-11-20` and `first_coin_return_day = 2026-11-21` (⛔ CORRECTED 2026-11-27 after the founder's R2-01 ruling, "≥95% coin and stays"; the plan-time 11-14/11-15 is superseded), and `unit_segments IS NOT NULL`, printed as booleans and the two days only. **Expect all three strategies true.** This is the evidence for "the derived switch is BTC / 2026-11-20 / 2026-11-21": the code logs only the coin and counts (`OKX unit switch read: coin=%s coin_bills=%d coin_days=%d`, `services/exchange.py`), not the days, so the stored flag, not a log line, is what carries them.

5. **Census count (Railway log, counts only).** In the analytics log for the key-mode and strategy-mode derives, read the `OKX unit switch read:` line and report `coin_bills` and `coin_days`. This settles RESEARCH assumption A1 (11 BTC bills): expect `coin=BTC coin_bills=11`. A different count is a finding to route, not a failure of SC-5 by itself; report it.

6. **Repeat steps 2-4 after the next nightly derive** (the second run; step 5 need not repeat). Both runs must match the expectations before SC-5 is closed.

7. **Key mode (256-09 open item 1).** Steps 2 and 3 cover the 4 key-mode jobs' status. In addition, for those 4 keys' latest `done` job, confirm the stored key inputs carry `unit_segments` and no `native_unit` (print two booleans per key as counts: keys with `unit_segments` present, keys with `native_unit` present; expect 4 and 0). Note the orchestrator referred to this as 256-09's "open item 7"; in the committed 256-09 SUMMARY the item is numbered 1 of "Open items for the orchestrator", and there are three items there.

## Open items for the orchestrator

1. **SC-7 is open: plan 02's migration-reviewer and rls-policy-auditor verdicts were not supplied to this plan.** Plan 02's SUMMARY says the two reviews are still owed before merge and that it could not spawn them. PR-1 already merged per the orchestrator; if both ran clean there, record their verdicts in the phase VERIFICATION and SC-7 can close on this evidence index.
2. **A red census pin sits in this branch, owned by plan 02's gate file, flagged by plan 06 (its Open item 1) and not fixed anywhere.** Measured at this HEAD, from `analytics-service/` with `--noconftest`: `tests/test_sql_gate_scoped_updates.py::test_scanner_is_not_vacuous` FAILS: `_EXPECTED_MATCH_COUNTS` lacks `'test_strategy_analytics_unit_segments.sql': 4` (actual has it; the test says to update the map in the same commit as the SQL edit). Because the map travels with the SQL gate file, the fix belongs in PR-1; if PR-1 merged without it, `main` carries this red and needs a one-line follow-up. Not edited here (outside this plan's file list).
3. **Local-stack lane did not run plan 02's SQL gate** (Docker `supabase_analytics` container unhealthy; the file was proven on the pg-lane and by the mutation runner). The CI `sql-tests` lane is the first execution on the baseline-loading stack; read it for that file.
4. **Date format conflict (UI-SPEC named open conflict, plans 05, 07, 08):** every surface prints `Nov 14, 2026` through `formatCloseDay` (Phase 201 U-14), not the founder's yearless `14 Nov`. A DESIGN-level exception needs recording in CONTEXT and the ROADMAP if the founder wants the literal form. Routed to UI review / UAT, not changed.
5. **UAT / human items carried from the plans:** plan 07's visual backstop (the break reads as a break on screen, in print preview and in an exported SVG on the founder's factsheet); plan 08 deviation 4 (`aria-hidden` on the chip's visible text, UI-SPEC silent) and plan 07 deviation 5 (legend and tooltip copy `in USD` / `in BTC`) for the UI review.
6. **Founder confirmations carried (plans 06 and 09):** today's realized P&L and funding are left to the next derive, and a deposit or a switch dated today refuses transient. Not re-decided here.
7. **Rule 7 flag (plan 07), cleanup not done:** DESIGN.md calls `TimeSeriesChart` a frozen island (lines about 139-143 and the 2026-06-30 table row), which the frozen-spine guard at HEAD contradicts, and `applyChartUnit`'s doc comment repeats it.
8. **Deferred, pre-existing (plans 05 and 08):** `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C fail on a last-digit `skew` float difference at this base, independent of phase 256.
9. **Files edited outside their plan's `files_modified` must travel with the plan's merge:** plan 09's two test files (`test_derive_broker_dailies_dualmode.py`, `test_okx_unit_switch_derive.py`), plan 05's cache-key pins, plan 08's `types.ts`, `queries.test.ts`, `page.tsx` and two test files.

## Deviations from Plan

None - plan executed as written, with two clarifications that are not code deviations:

- The plan's SC-5 truth says the derived switch is "logged as BTC / 2026-11-14 / 2026-11-15". The code logs only the coin and counts; the days are stored in `data_quality_flags.unit_switch`. The procedure reads the stored flag (step 4) rather than a log line.
- The orchestrator's brief named "256-09's open item 7"; the committed SUMMARY's open-item list has three items and the key-mode item is number 1. Step 7 of the procedure covers it.

## Known Stubs

None.

## Threat Flags

None. No file with security-relevant surface was created or modified (two ledger notes and this SUMMARY). T-256-29 and T-256-30 are met by construction: the procedure prints counts, booleans and the two switch days only, starts with the marker query and is read-only; this SUMMARY holds no id, account number, amount or home path.

## Self-Check: PASSED

- FOUND: `.planning/phases/256-okxunitswitch-an-okx-account-that-moves-from-usdt-into-a-coi/256-10-SUMMARY.md`
- FOUND commit `ebe662296` (ancestor of HEAD)
- `grep -c "2026-11-14 and 2026-11-20"` returns 1 for `.planning/ROADMAP.md` and 1 for `232-CONTEXT.md`
- `grep -c "## PROOF-01"` returns 1 for each of the nine SUMMARY files 01-09
- STATE.md untouched; ROADMAP.md changed only by the Phase 256 Cause-bullet correction
