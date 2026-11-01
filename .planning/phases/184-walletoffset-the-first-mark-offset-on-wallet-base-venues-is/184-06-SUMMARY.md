---
phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
plan: 06
subsystem: testing
tags: [okx, walletoffset, probe, bills-archive, funding, gap-closure]

requires:
  - phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
    provides: plan 184-04 first PROD run (G-01) and the 184-03 probe and test file
provides:
  - "_parse_window_bill keeps instId, so an in-window OKX stablecoin funding bill is measured instead of refusing the key as malformed (G-01 closed in code)"
  - "A test that drives a funding bill with instId from the archive fake through run(), the walk, the parser and okx_window_terms, RED before the fix"
  - "deploy-fingerprint: and parser-shape: lines for plan 184-07 to compare against"
affects: [184-07]

plan_head_before: d7a5982cb3a0c0a715db77c403423907cf8d8f1b
plan_head_after: d9cb6ce315e976a97d494007d491634b9f738acb

actuals:
  tokens: 2000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A parser test must drive the bill from the archive fake, never hand okx_window_terms a bill that already carries the field the parser may drop"

key-files:
  created: []
  modified:
    - analytics-service/scripts/walletoffset_probe.py
    - analytics-service/tests/test_walletoffset_probe.py

key-decisions:
  - "Minimal fix only (founder rule): one added line, no strip, no new check, no sub-reason field"
  - "The one-space parameter of the blank-instrument test is removed, not made to pass by stripping, because the chain keeps a whitespace-only instId"

requirements-completed: [SC-1, SC-3]

coverage:
  - id: D1
    description: "A marked OKX key whose first-mark window holds a USDT funding bill (type 8) with an instId is measured end-to-end, with funding ratio -0.00015, instead of being refused as malformed"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_walletoffset_probe.py#test_okx_a_funding_bill_read_from_the_archive_keeps_its_instrument_so_the_key_is_measured"
        status: pass
    human_judgment: false
  - id: D2
    description: "The diff under analytics-service/, supabase/ and src/ is the probe and its test file only, the script change being 1 insertion and 0 deletions"
    requirement: "SC-3"
    verification:
      - kind: other
        ref: "SCOPE_OK gate of Task 2 (git diff against the parent of the first 184-06 commit)"
        status: pass
      - kind: unit
        ref: "full analytics suite: 14256 passed, 102 skipped, 0 failed; CI mypy line: Success: no issues found in 131 source files"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-11-01
status: complete
---

# Phase 184 Plan 06: instId on the OKX window bill Summary

**One added line in `_parse_window_bill` keeps `instId`, so a marked OKX key that held a perpetual through a funding settlement in its window is measured (funding ratio -0.00015 on the test world) instead of refused as `malformed`; a test that was RED before the fix and a byte-backup neuter check prove it can fail.**

The deploy fingerprint did not move (it equals 184-03-SUMMARY's line), so plan 184-07 must use the parser-shape line below to tell this probe from the one the first run used.

## Performance

- **Duration:** about 25 min
- **Started:** 2026-11-01T18:50:00Z (approximate)
- **Completed:** 2026-11-01T19:20:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- G-01 closed in code: `_parse_window_bill` returns an `instId` key beside `type` and `instType` (`str(row.get("instId") or "")`). `okx_window_terms` reads `bill.get("instId", "")` on every in-window stablecoin funding bill; it used to always get an empty string and raise `Unmeasurable("malformed")`. It now sees the real instrument, so the blank-instrument refusal and the one-row-per-instrument-and-hour rule, which mirror `fetch_funding_okx`, see what the chain sees.
- A new test, `test_okx_a_funding_bill_read_from_the_archive_keeps_its_instrument_so_the_key_is_measured`, drives one USDT type-8 SWAP bill (pnl -3, instId `BTC-USDT-SWAP`) from the archive fake through `run()`, `_measure_okx`, `walk_okx_window_bills`, the parser and `okx_window_terms`. It asserts, as literals, measured true, reason `none`, failure class `none`, partial false, `bills_in_window` 1, `funding_rows_in_window` 1, `pnl_trading_ratio` 0.0, `pnl_funding_ratio`, `pnl_ratio` and `offset_ratio` all -0.00015 (-3 / 20000 by hand), and EXIT_OK.
- The older funding tests built bills that already carried `instId` and handed them to `okx_window_terms` directly, past the parser, which is why they could not see G-01.

## RED evidence

- RED test id: `tests/test_walletoffset_probe.py::test_okx_a_funding_bill_read_from_the_archive_keeps_its_instrument_so_the_key_is_measured`.
- At HEAD before the fix the test failed on `assert record["measured"] is True` (`assert False is True`). The key record printed `measured` false, `unmeasurable_reason` `malformed`, `failure_class` `none`, and `run()` returned exit code 1 (read from a one-off drive of the same world, because pytest truncates the record in its failure output).
- The assertions on the record come before the exit-code assertion on purpose, so the failure names the record, not just the exit code.
- Semantic assessment: the target test executed and failed on the planned assertion for the intended reason (the parser dropped `instId`, the funding check refused the blank instrument). It was not a collection, import or fixture fault.

## Task Commits

1. **Task 1 RED: failing test** - `df5297121` (test)
2. **Task 1 GREEN: the `instId` line and the reduced parameter** - `d9cb6ce31` (fix)
3. **Task 2: neuter check, fingerprint, parser shape, gates** - no commit (verification only; the script was restored byte-identical)

**Plan metadata:** the commit that adds this file (docs).

## Files Created/Modified

- `analytics-service/scripts/walletoffset_probe.py` - one added line in the dict `_parse_window_bill` returns: `"instId": str(row.get("instId") or ""),`. Nothing else, not even the docstring.
- `analytics-service/tests/test_walletoffset_probe.py` - the new test, and `test_okx_a_funding_bill_with_a_blank_inst_id_makes_the_key_malformed` reduced to its empty-string case.

## Reduced parameter and its reason

The decorator of `test_okx_a_funding_bill_with_a_blank_inst_id_makes_the_key_malformed` went from `["", " "]` to `[""]`, with its body untouched. The chain keeps a funding bill whose `instId` is only whitespace: `normalize_symbol` removes only dashes, and `_normalize_funding_row` drops only an empty symbol. At planning time `fetch_funding_okx` returned 1 row for a one-space `instId` and 0 rows for an empty one. The probe mirrors the chain, so it now sums that bill too. The one-space case passed before only because the parser dropped every `instId`, which is the G-01 defect itself. Making it pass by stripping would be a new defensive check, and the probe would then print a quantity the chain does not book. Per the founder rule (minimal fix only), no strip was added. The empty-instrument case and the same-hour test now reach their own checks through the parser and stay green, unchanged.

## Neuter check, fingerprint and parser shape

Neuter check, done with a byte backup (`cp -p` to a `mktemp -d` directory outside the repo), the `instId` line deleted, the new test alone run RED, then restored with `cp -p` and compared with `cmp`; no `git checkout`, `git restore` or `git stash` was used. With the line removed the test failed on `measured` and the one-off drive of the same world read `measured` false, reason `malformed`.

neuter G01: RED tests/test_walletoffset_probe.py::test_okx_a_funding_bill_read_from_the_archive_keeps_its_instrument_so_the_key_is_measured (measured false, reason malformed); restored (cmp identical); GREEN

The deploy fingerprint was recomputed at the fixed code. It equals 184-03-SUMMARY's line and 184-04's `import-check:`, as expected, because it is built only from constants the fix does not touch. No `fingerprint-changed:` line is needed.

deploy-fingerprint: walletoffset 0 1 27 30 14 binance,bybit,okx

The parser shape (the keys `_parse_window_bill` returns for a minimal row) now names `instId`; at HEAD before the fix it printed the same words without it. Because the fingerprint does not move with this fix, plan 184-07 prints this line on the worker to prove the deployed parser keeps `instId`.

parser-shape: billId ccy fee instId instType pnl ts type

## Gate results

- `tests/test_walletoffset_probe.py` alone: 178 passed (HEAD baseline 178: one test added, one parameter removed). New test alone: 1 passed, 177 deselected.
- FIX_SHAPE_OK printed (parser line present exactly once; blank-instrument test collects exactly one case).
- CI mypy line, verbatim from `analytics-service/`: `Success: no issues found in 131 source files`.
- Local mypy on `scripts/walletoffset_probe.py`: `Success: no issues found in 1 source file`.
- SCOPE_OK printed (script diff 1 insertion, 0 deletions; only the two planned files under analytics-service/, supabase/ and src/).
- Full analytics suite, `.venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`: `14256 passed, 102 skipped, 1171 warnings in 134.29s (0:02:14)`, 0 failed, 0 errors; `Required test coverage of 80% reached. Total coverage: 94.66%`. The 102 skips are pre-existing skips elsewhere in the suite, not tests of this plan.

## Decisions Made

- Followed the plan as specified. The one choice inside the plan: the new test asserts the record before the exit code, so a regression reads as "record measured false" and not as a bare exit code.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The first attempt to edit the test file was refused because the file had not been read in the session; the file was read and the same edit applied, with no effect on the result.

## Known Stubs

None.

## Threat Flags

None. The instrument name is carried in the parsed bill only; `emit_record` prints whitelisted record keys and `validate_record` refuses any other key (T-184-26, accepted).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for review and shipping as one code PR by the orchestrator (`/gsd-ship`, then `/land-and-deploy`). The release commit carries the CHANGELOG entry and the `VERSION` / `package.json` bump; the ship branch changes nothing under `.planning`.
- Plan 184-07 runs only after Railway deploys that merge and the founder approves the re-run. It compares its freshly computed `deploy-fingerprint:` and `parser-shape:` lines with the two above.
- Not in this plan (routed elsewhere): the same-hour funding dedup in the chain (Phase 186), a sub-reason field.

## TDD Gate Compliance

RED commit `df5297121` (test) precedes GREEN commit `d9cb6ce31` (fix). No REFACTOR commit was needed.

## Self-Check: PASSED

- `analytics-service/scripts/walletoffset_probe.py` and `analytics-service/tests/test_walletoffset_probe.py`: FOUND.
- Commits `df5297121` and `d9cb6ce31`: FOUND on the branch.

---
*Phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is*
*Completed: 2026-11-01*
