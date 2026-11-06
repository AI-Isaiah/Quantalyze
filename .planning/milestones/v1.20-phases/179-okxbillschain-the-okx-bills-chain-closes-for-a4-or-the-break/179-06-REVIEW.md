---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
plan: 06
reviewed: 2026-10-28T22:55:46Z
depth: deep
round: 1
scope: "git diff 9139887cc..f126657f8 -- analytics-service/ (plan 179-06, D-08: OPENING_TOLERANCE_REL 0.05 -> 0.02)"
threshold: MEDIUM and above (LOW/INFO omitted per the review brief)
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/okx_opening_balance.py
  - analytics-service/tests/test_okx_close_precision.py
  - analytics-service/tests/test_okx_opening_balance.py
  - analytics-service/tests/test_okx_opening_tolerance.py
callers_read:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/tests/test_okx_anchor_rule.py
findings:
  critical: 0
  high: 0
  medium: 0
  warning: 0
  info: 0
  total: 0
rounds:
  - round: 1
    status: clean
    total: 0
status: clean
---

# Phase 179 Plan 06: Code Review Report (D-08 opening tolerance 2%)

**Reviewed:** 2026-10-28
**Depth:** deep (the changed files plus every reader of `OPENING_TOLERANCE_REL` / `opening_agrees` and the test helpers the new file imports)
**Files Reviewed:** 4
**Status:** clean at the MEDIUM threshold

## Summary

The change is one constant (`OPENING_TOLERANCE_REL` 0.05 to 0.02), its comment block, two value pins, and a new
test file. `OPENING_TOLERANCE_USD`, `CLOSE_RESIDUAL_REL_BOUND`, `OPENING_UNAVAILABLE_REASONS` and the body of
`opening_agrees` are byte-unchanged in the diff. No MEDIUM-or-above defect was found.

## What was checked, and how

**Readers of the value.** In `analytics-service/`, only `opening_agrees` (`services/okx_opening_balance.py`) reads
`OPENING_TOLERANCE_REL` in production code. It reads the module global at call time. Nothing does a `from ... import
OPENING_TOLERANCE_REL`, so nothing holds a stale copy. Its one production caller is `_okx_forced_opening_check` in
`services/equity_reconstruction.py`. That function runs only on the forced OKX path after the 5x arm flags, and
anything but `agreed` still refuses `anchor_skipped_implausible`. Fail-closed is unchanged, and D-08 only narrows what
agrees. The unforced path and the daily refresh never call it, so stored history is not re-judged. The allocator
history probe reaches the rule only through the real forced window call (`anchor_opening_agreed`), so it follows the
new value without a separate copy. The probe's `opening_check` vocabulary deliberately carries no tolerance.

**Stale 0.05 claims in analytics code.** A grep for `0.05`, `5%` and the symbol across the service, the probe and the
chain record turned up no remaining statement that the opening tolerance is 5%. The other `0.05`/`5%` hits are the
unrelated perp ctVal divergence threshold. The docstring of `_okx_forced_opening_check` names the symbol, not a
number. The new comment block matches 179-CONTEXT D-08 and the 179-05 SC-3 reading (`opening_check=measured`,
residual -0.0136, `bills_read=1490`). The pre-existing small-account docstring ("every allowed relative tolerance
times 10 is below 1") is still true at 0.02.

**Can the tests fail?** I checked this independently, without editing source. A scratchpad pytest plugin overrode
the module attribute at configure time:

| value | result |
|---|---|
| 0.05 | 9 RED: both 3% forced-job refusals, all six band cases, the value pin |
| 0.01 | 5 RED: both a4 tests, the two pre-existing 0.0143 agreed-ratio tests in `test_okx_anchor_rule.py`, the value pin |
| 0.025 | 3 RED: the 0.021 band cases, the value pin |
| 0.0205 | 1 RED: the value pin only. This is expected: the band cases sit at 2.1% and up, and the exact pin catches it |
| 0.0137 | 3 RED: the 0.0143 tests, the value pin. The a4 tests correctly stay green, because 0.0137 is still above a4's 0.0136 |
| 0.0135 | 5 RED: both a4 tests, the 0.0143 tests, the value pin |

The unmutated run of the four related files was 111 passed. The new file passes on its own (10 passed).

**Rule 9.** Each new test's docstring states its own arithmetic and the consequence (a 2-5% opening would anchor
again, or a4 would refuse). Every expected value is a fixture constant, never recomputed by the module under test.

**Test-helper coupling.** `tests/test_okx_opening_tolerance.py` imports underscore-prefixed helpers from
`tests/test_okx_anchor_rule.py`, the same pattern `tests/test_okx_close_precision.py` already uses. No `test_*` name
is imported, so nothing is collected twice. `tests/` is a package, so there is no double import. All autouse fixtures
live in `tests/conftest.py`, not in the imported module, so the helpers do not depend on fixtures the new module would
lack. The new file has no `importlib` and no `reload`.

---

_Reviewed: 2026-10-28T22:55:46Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
