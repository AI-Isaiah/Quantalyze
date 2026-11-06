---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
plan: 06
subsystem: analytics-service / okx opening-balance oracle
tags: [okx, opening-tolerance, d-08, sc-3, forced-rebuild, fail-closed]
requires:
  - phase: 179-okxbillschain
    provides: "179-05 SC-3 reading (a4 residual -0.0136) and the founder's tolerance decision D-08 ('Tighten to 2%')"
provides:
  - "OPENING_TOLERANCE_REL at 0.02 with the D-08 basis in its comment"
  - "tests/test_okx_opening_tolerance.py: the 2-5% band refuses on both sides (unit and forced job), a4's residual agrees and anchors"
  - "the two value pins asserting 0.02 and citing D-08"
affects: [179-07 operator re-read of a4 on the deployed value]
plan_head_before: 9139887cc6cc2b5c901da6c7fec337363ca4497a
plan_head_after: f126657f81dc2066c1364e4003ba662c7fcbabb6
actuals:
  tokens: 2700
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns: ["tolerance change lands with a test RED at the old value, proven by byte-backup mutation"]
key-files:
  created:
    - analytics-service/tests/test_okx_opening_tolerance.py
  modified:
    - analytics-service/services/okx_opening_balance.py
    - analytics-service/tests/test_okx_opening_balance.py
    - analytics-service/tests/test_okx_close_precision.py
key-decisions:
  - "D-08 implemented exactly: one value (0.05 to 0.02) and its comment; USD floor, close bound, reason set and opening_agrees body untouched"
requirements-completed: []
coverage:
  - id: D1
    description: "OPENING_TOLERANCE_REL is 0.02 with the D-08 basis recorded in its comment; both value pins assert 0.02 and cite D-08"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "tests/test_okx_opening_balance.py#test_the_tolerance_is_the_measured_value"
        status: pass
      - kind: unit
        ref: "tests/test_okx_close_precision.py#test_the_close_bound_and_the_reason_set_are_the_decided_values"
        status: pass
    human_judgment: false
  - id: D2
    description: "An opening 2.1% to 4.9% of the anchor off the implied one refuses on both sides, through opening_agrees and through the forced OKX job (disagreed, nothing written)"
    requirement: "SC-3"
    verification:
      - kind: integration
        ref: "tests/test_okx_opening_tolerance.py#test_a_forced_okx_rebuild_whose_bills_sit_three_percent_above_the_implied_opening_refuses"
        status: pass
      - kind: integration
        ref: "tests/test_okx_opening_tolerance.py#test_a_forced_okx_rebuild_whose_bills_sit_three_percent_below_the_implied_opening_refuses"
        status: pass
      - kind: unit
        ref: "tests/test_okx_opening_tolerance.py#test_an_opening_two_to_five_percent_of_the_anchor_off_refuses"
        status: pass
    human_judgment: false
  - id: D3
    description: "a4's measured residual (-0.0136) still agrees and anchors at 0.02"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "tests/test_okx_opening_tolerance.py#test_a4s_measured_residual_agrees_at_the_decided_tolerance"
        status: pass
      - kind: integration
        ref: "tests/test_okx_opening_tolerance.py#test_a_forced_okx_rebuild_with_a4s_residual_anchors"
        status: pass
    human_judgment: false
duration: 25min
completed: 2026-10-28
status: complete
---

# Phase 179 Plan 06: OPENING_TOLERANCE_REL 0.02 (D-08) Summary

**The relative opening tolerance of the forced OKX anchor rule is 2% of the anchor (founder decision D-08), with a band of tests that go RED at the old 5% and a pair that go RED below a4's measured -0.0136 residual.**

## Performance

- **Started:** 2026-10-28T22:24Z (approx.)
- **Completed:** 2026-10-28T22:50Z
- **Tasks:** 2
- **Files modified:** 4 (1 created)

## Accomplishments

- `OPENING_TOLERANCE_REL` is 0.02 in `services/okx_opening_balance.py`; the comment block above the tolerance constants now records the D-08 basis (founder 2026-10-28, "Tighten to 2%", against the recommendation to keep 5%, a4's SC-3 residual -0.0136 on a complete walk, ONE account, a founder choice and not a calibration), with one lineage sentence for Phase 172 plan 03's 5%.
- `test_the_tolerance_is_the_measured_value` and `test_the_close_bound_and_the_reason_set_are_the_decided_values` pin 0.02 and cite D-08; the close-precision docstring no longer says the tolerance holds "until SC-3".
- `tests/test_okx_opening_tolerance.py` (new, 10 test cases): 3% above and 3% below the implied opening refuse `disagreed` through the real forced job; six `opening_agrees` cases (2.1%, 3%, 4.9%, each side) are False; a4's shape (implied 0.923, bills 0.937, residual -0.0136) agrees through the rule and anchors through the forced path.
- Fail closed is unchanged: `_okx_forced_opening_check` still refuses anything but `agreed`; D-08 only narrows what agrees.

## Task Commits

1. **Task 1 (tracer): the 3%-above forced-job refusal, the constant, its comment, the two value pins** - `8848fa429` (feat)
2. **Task 2: the band on both sides, a4's residual, mutations M1 and M2** - `f126657f8` (test)

**Plan metadata:** the commit carrying this file (docs).

## Task 1 RED reason

Run on the unchanged code (value 0.05), before any production edit, `python3 -m pytest tests/test_okx_opening_tolerance.py -q` from `analytics-service/`:

```
>       assert result.outcome == DispatchOutcome.FAILED, result
E       AssertionError: DispatchResult(outcome=<DispatchOutcome.DONE: 'done'>, error_message=None, error_kind=None, trade_count=None)
E       assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
FAILED tests/test_okx_opening_tolerance.py::test_a_forced_okx_rebuild_whose_bills_sit_three_percent_above_the_implied_opening_refuses
1 failed
```

The job ended DONE (the 3% opening, 2100 against a 3500 allowance, anchored) where `_refusal_audit` asserts FAILED. After the value change the same test passes.

## Mutations (Task 2, byte backup of `services/okx_opening_balance.py` kept outside the repo, restored, `cmp` identical, backup dir deleted and confirmed gone)

- mutation M1: RED test_a_forced_okx_rebuild_whose_bills_sit_three_percent_above_the_implied_opening_refuses, test_a_forced_okx_rebuild_whose_bills_sit_three_percent_below_the_implied_opening_refuses, test_an_opening_two_to_five_percent_of_the_anchor_off_refuses (all six cases); restored (cmp identical); GREEN
- mutation M2: RED test_a4s_measured_residual_agrees_at_the_decided_tolerance, test_a_forced_okx_rebuild_with_a4s_residual_anchors; restored (cmp identical); GREEN

M1 (value back to 0.05): `8 failed, 2 passed`; the two passing tests are the two a4 tests, recording D-08's premise that a4 also passed at 5%. M2 (value 0.01): `2 failed, 8 passed`; restored runs read `10 passed`.

## Verification (every `<automated>` run)

- Task 1 verify: `TRACER_OK` printed (102 passed across the four test files; constant, USD floor, close bound, `opening_agrees` return line, comment tokens, both pins, reason set, and the census of analytics `.py` files naming the symbol all as gated).
- Task 2 verify: `BAND_OK` printed. `495 passed, 1 warning` across the eight related test files; CI's mypy line printed `Success: no issues found in 130 source files`.
- Plan verification: `git diff --stat 9139887cc..HEAD -- analytics-service/scripts/ analytics-service/services/equity_reconstruction.py analytics-service/tests/test_okx_anchor_rule.py supabase/ src/` printed nothing. `services/okx_opening_balance.py` changed only in the `#:` comment block above `OPENING_TOLERANCE_USD` and the `OPENING_TOLERANCE_REL` line. The `SUMMARY_OK` check is run on this file just before its commit (result in the return message).
- Not run: the full analytics suite (CI owns it with `--cov-fail-under=80`; plan time measurement was 3 failed of which two are the pins now updated and one is the pre-existing xdist-only test).

## Decisions Made

None beyond D-08, which this plan implements verbatim.

## Deviations from Plan

None - plan executed exactly as written. Task 2's tests passed on first run (the plan expected that), each proven able to fail by M1 or M2.

## Issues Encountered

None. One scripting slip (a wrong anchor string in my own edit helper) raised before writing anything and was corrected; no file was affected.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

The value is in code on branch `feat/179-okxbillschain` and not shipped (plans do not ship: no VERSION, package.json or CHANGELOG change). Plan 179-07 (operator) re-reads a4 on the deployed value and records it in `TODOS.md` (`172-OKX-OPENING-TOLERANCE-ONE-ACCOUNT`, `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`). STATE.md and ROADMAP.md were not touched (the orchestrator owns them).

## Self-Check: PASSED

- `analytics-service/tests/test_okx_opening_tolerance.py`, `analytics-service/services/okx_opening_balance.py`, `analytics-service/tests/test_okx_opening_balance.py`, `analytics-service/tests/test_okx_close_precision.py` exist.
- Commits `8848fa429` and `f126657f8` are ancestors of HEAD.

---
*Phase: 179-okxbillschain*
*Completed: 2026-10-28*
