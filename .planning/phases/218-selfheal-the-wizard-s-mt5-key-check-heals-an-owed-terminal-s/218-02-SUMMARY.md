---
phase: 218-selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
plan: 02
subsystem: analytics-service / MT5 wizard validation
tags: [mt5, validation-terminal, scrub, wizard, selfheal, time-budget, status-contract]
status: complete

requires:
  - phase: 218-01
    provides: the inline owed gate, envelope anchored at lease acquisition, healed_inline and inline_scrub_elapsed_s
provides:
  - _MT5_VALIDATE_PROBE_FLOOR_S (40 s) and the floor refusal in the owed branch
  - _MT5_INLINE_SCRUB_RECORD_S (5 s) and the clamp on the inline-scrub bound
  - healed park-skip INFO (budget_exhausted caused by the inline scrub does not page)
  - ordering test for the scrub term, with the floor-below-stage inversion stated
  - STATUS_CONTRACT row S-31, narrowed S-30, tally 31 rows and 28 editable sites
  - go-live runbook rows for the two new knobs
affects: [218-03, 218-04]

actuals:
  tokens: 17000
  tasks: 2
  commits: 2
plan_head_before: 6c6740b000f6671f706550c334a02d8d6235bf11
plan_head_after: 20fc88e9f

key-files:
  created: []
  modified:
    - analytics-service/routers/exchange.py
    - analytics-service/tests/test_mt5_validate.py
    - analytics-service/tests/test_mt5_validation_park.py
    - analytics-service/docs/STATUS_CONTRACT.md
    - docs/runbooks/mt5-go-live.md
    - analytics-service/services/ingestion/mt5.py

key-decisions:
  - "The floor breach after a `scrubbed` kind does NOT call report_scrub_owed_refusal: that scrub verified, so nothing is owed and the reporter would page for a covered condition. It logs a WARNING and takes the same 424 raise"
  - "The clamp is max(0.0, min(S, E - record - FLOOR)) so a patched small deadline cannot hand the scrub a negative bound"

requirements-completed: [218-SC-4, 218-SC-5]
completed: 2026-11-19
---

# Phase 218 Plan 02: Envelope floor, clamp and park noise Summary

**A heal can no longer stretch the request past the 105 s server worst case: the inline scrub bound is clamped to `E - record - FLOOR`, a scrub that leaves under 40 s refuses with `MT5_TERMINAL_NOT_READY` instead of probing, and a park skip the scrub itself caused logs at INFO instead of paging.**

## Accomplishments

- `routers/exchange.py`: `_MT5_VALIDATE_PROBE_FLOOR_S` (env `MT5_VALIDATE_PROBE_FLOOR_S`, 40.0) and `_MT5_INLINE_SCRUB_RECORD_S` (5.0). The owed gate passes `budget_s=max(0.0, min(_MT5_INLINE_SCRUB_BUDGET_S, E - record - FLOOR))`, read at call time. The single post-scrub `_park_clock` read now happens right after the `owed_scrub` stage event for every kind, so `remaining = E - inline_scrub_elapsed_s` decides the refusal. The refusal condition is `kind != SCRUB_KIND_SCRUBBED or remaining < FLOOR`; no second `VenueTransientHTTPException(` construction. The floor applies in the owed branch only; the unowed path still reads the clock exactly twice.
- Park gate: a `budget_exhausted` skip on a healed request whose gate budget plus `inline_scrub_elapsed_s` is at least `_MT5_PARK_MIN_BUDGET_S` logs one INFO line and makes no `report_park_skipped` call. A healed request whose probe alone spent the budget, and any skip without an inline heal, still pages.
- Header budget paragraph and the constants' comment carry the arithmetic `75 - 30 - 5 = 40 = FLOOR` (zero slack) and the accepted residue.
- Tests: `test_mt5_validate_inline_scrub_budget_fits_inside_the_envelope` (hand-typed 30 / 40 / 5, equality with `mt5_terminal_scrub._SCRUB_RECORD_TIMEOUT_S`, `30 + 5 + 40 <= E`, and the deliberate `FLOOR < STAGE` inversion with its message). Eight behaviour tests in `test_mt5_validation_park.py`: envelope (probe `wait_for` timeout is `E - 12`), floor refusal (no client, no login, `scrub_unhealed`), inclusive floor, floor never applies to an unowed request, env override clamp, heal-caused skip INFO, probe-caused skip still pages, no-heal skip still pages. The existing `test_mt5_validate_timeout_chain_is_strictly_nested`, `test_mt5_validate_worst_case_stays_inside_the_client_budget` (the `105_000` assertion) and the three `_ParkClock` D-07 park-floor tests are byte-unchanged and pass.
- Docs: S-30 narrowed to the held-lease refusal (dated CORRECTED note); row S-31 added; the "Two more raises" paragraph, the section-7 heading and the tally carry dated CORRECTED notes with the originals kept. `grep -c '^| S-'` prints 31. The tally rule counts a shared-code group as one site and a reused existing code (`MT5_VALIDATION_UNCONFIGURED`) as no new site, so editable sites are 28 (27 plus S-31), as the plan expected. Runbook Step 4a table lists both knobs, marked PROVISIONAL.

## Accepted residue (stated, not fixed)

A scrub that ends `scrubbed` within a hair of its 30 s bound, whose cron row write also runs near its 5 s ceiling, leaves just under 40 s and refuses with `MT5_TERMINAL_NOT_READY`. It is recoverable and the mark is already cleared, so the Retry probes at once. It needs both terms near their ceilings together (the measured scrub is about 6 s, a row write takes milliseconds). On a floor breach the `owed_scrub` event says `scrub_healed` and the request ends `trace.outcome = "scrub_unhealed"`: together that reads "scrubbed, but too late to probe". The floor below `_MT5_VALIDATE_STAGE_TIMEOUT_S` is a deliberate inversion, accepted only when scrub and probe are both slow (CONTEXT "Amended after research" "Budget", research option B).

## Verification

- `pytest` on `test_mt5_validate`, `test_mt5_validation_park`, `test_mt5_terminal_scrub`, `test_validate_key_venue_transient`, `test_mt5_server_known`, `test_ingestion_mt5`, `test_status_contract_exchange_internal`: 411 passed, 1 skipped (pre-existing empty-parameter-set skip). Task 1's set plus `test_raw_5xx_census`: 363 passed, 1 skipped.
- `mypy --strict ...` (the CI line): `Success: no issues found in 142 source files`.
- Full analytics suite (`python3 -m pytest -p no:cacheprovider -q` from `analytics-service/`, with `tests/test_xdist_group_is_real.py` deselected because `pytest-xdist` is not installed locally, the same environment gap plan 01 recorded): 15150 passed, 93 skipped, 0 failed.

### Neuter-once RED proof (floor, SC-4)

Backed up `routers/exchange.py` to the scratchpad, changed `if kind != SCRUB_KIND_SCRUBBED or remaining < _MT5_VALIDATE_PROBE_FLOOR_S:` to `if kind != SCRUB_KIND_SCRUBBED:`. `test_a_scrub_that_leaves_less_than_the_probe_floor_refuses_without_probing` went RED (`1 failed, 2 passed, 99 deselected`: the request proceeded to build a client and log in instead of refusing). Restored from the backup, `cmp` exit 0.

## Deviations from Plan

**1. [Rule 2 - correctness] The floor breach does not call `report_scrub_owed_refusal`.** The plan widened the refusal condition and left the reporter inside it. For `kind == scrubbed` the scrub verified and nothing is owed, so the reporter (which pages ERROR plus a windowed capture when nothing was pending) would page for a covered condition. It logs a WARNING instead; the 424 raise is the same single construction.

**2. [Scope] `services/mt5_client.py` is unchanged.** The plan's `refuses (wizard)` grep finds nothing there: the scrub-owed comment block says only "the next validation consumes it before its probe (D-08)", which is still true. No stale claim, so no correction was invented. The one stale statement outside the plan's list was in `routers/exchange.py`'s `lease_busy` arm ("the same code the owed-scrub gate answers"); it got a dated CORRECTED note in the task 2 commit.

**3. [Robustness] The clamp is wrapped in `max(0.0, ...)`** so a deadline patched below `record + floor` (tests do this) cannot pass a negative bound to the scrub.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Files: `analytics-service/routers/exchange.py`, the two test files, `analytics-service/docs/STATUS_CONTRACT.md`, `docs/runbooks/mt5-go-live.md`, `analytics-service/services/ingestion/mt5.py`: FOUND.
- Commits `53e3d6aa9` (feat) and `20fc88e9f` (docs): FOUND on `worktree-agent-a98b9f78e1adb4b34`.
