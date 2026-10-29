---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
plan: 04
reviewed: 2026-10-28T19:57:50Z
depth: deep
round: 2
scope: "round 1: git diff 571847fa1..HEAD -- analytics-service/ (plan 179-04, D-06 close precision); round 2: git diff ac83de404..d546be063 -- analytics-service/ (D-07 fix delta, SFH-179-04-01)"
threshold: MEDIUM and above (LOW/INFO omitted per the review brief)
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/okx_opening_balance.py
  - analytics-service/services/okx_bills_chain.py
  - analytics-service/tests/test_okx_close_precision.py
callers_read:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/scripts/okx_chain_record.py
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
  - round: 2
    status: clean
    total: 0
status: clean
---

# Phase 179 Plan 04: Code Review Report (D-06 close at OKX precision)

**Reviewed:** 2026-10-28
**Depth:** deep (the changed files plus the forced OKX path, the probe and the chain record that consume them)
**Files Reviewed:** 3
**Status:** clean at the MEDIUM threshold

## Summary

The change replaces the exact close comparison in `per_ccy_opening` with `close_agrees(newest bal, cash,
bal_places(currency's walked bills))`, and makes `analyse_chain` and `close_race` use the same predicate with the
same places. I found no defect at MEDIUM or above. Each invariant in the brief was checked against the code:

- **Interior link stays exact.** `if bal != prev_bal + bal_chg:` in `per_ccy_opening` is unchanged. The diagnostic's
  interior residual (`bal - (prev_bal + change)`) and `_interior_breaks` are unchanged. `_INTERIOR_WORLDS` pins an
  interior residual inside both close allowances as `chain_break`.
- **`OPENING_TOLERANCE_REL` is 0.05, and no reason token was added.** `OPENING_UNAVAILABLE_REASONS` still holds the
  same six tokens. `bal_places` can only raise the existing `malformed_bills`.
  `test_the_close_bound_and_the_reason_set_are_the_decided_values` pins both.
- **The allowance never enters an opening's value.** The opening is still the oldest bill's `bal - balChg`. The cash
  value is used only inside the predicate. The close arm is also the wrong place to catch a missing early bill:
  a bill missing after the newest walked bill does not change the oldest bill's `bal - balChg`. So the allowance
  weakens a consistency proof but cannot move the opening.
- **The bounds are traced against the rule.**
  - `Decimal(5).scaleb(-(places + 1))` is half a unit in the last governing place.
  - `places >= 1` keeps integer prints from getting any precision allowance.
  - The relative arm multiplies by the larger absolute value and does not divide.
  - Both comparisons are inclusive.
  - `places` is the chain's maximum, so it is at least the newest bill's own places. A nonzero newest `bal` is
    therefore always more than half a unit from zero. A currency missing from the cash map (read as 0) can never
    pass on the precision arm, and it can pass the relative arm only when the balance is 0.
  - The `residual == 0` arm is exact. Decimal subtraction rounds only at 28 significant digits, so a nonzero
    difference cannot round to zero at realistic exponents.
- **The forced rebuild still fails closed.** `_okx_forced_opening_check` (equity_reconstruction.py) is unchanged:
  any outcome other than `"agreed"` refuses with `anchor_skipped_implausible`.
  `test_a_close_beyond_okx_precision_still_refuses_chain_break_on_the_forced_path` asserts the refusal string
  through `_refusal_audit`, and asserts `anchor_opening_check == "chain_break"`.
- **The oracle and the diagnostic agree.**
  - `analyse_chain` computes `places` from the same `ordered` list (sorted by `billId`) and the same `prev_bal` that
    the oracle uses.
  - `close_race` reuses `report.close_places`, so it cannot use a different precision from the verdict.
  - `cash_moved` stays an exact comparison.
  - `measure_chain`'s `diverged` guard still holds. The oracle raises `chain_break` only from these two arms, and
    the diagnostic evaluates both arms for every currency.
  - `ChainReport` is never built positionally outside `analyse_chain`. `test_okx_chain_record.py` uses
    `dataclasses.replace`, so the new required field breaks no consumer.
- **Venue input.** `_parse_bill` stores `str(Decimal(raw))`, and that round trip keeps the coefficient and the
  exponent exactly. So `bal_places` reads the venue's printed precision and not a normalized one. The tests build
  bills with `okx_bill` and skip `_parse_bill`, but because the round trip is lossless they test the same values
  that production sees.
- **Verification run here (read-only).**
  - `pytest` over `test_okx_close_precision`, `test_okx_opening_balance`, `test_okx_bills_chain`,
    `test_okx_chain_record` and `test_okx_anchor_rule`: 345 passed. It ran with caches disabled.
  - `mypy --strict` on both changed services: no issues.
  - `scripts/` and the five existing test files have an empty diff against `571847fa1`.

## Narrative Findings (AI reviewer)

No findings at MEDIUM or above.

## Round 2 (D-07 fix delta)

**Reviewed:** 2026-10-28T19:57:50Z
**Scope:** `git diff ac83de404..d546be063 -- analytics-service/` (one commit, the SFH-179-04-01 fix under founder
decision D-07): `services/okx_opening_balance.py`, `services/okx_bills_chain.py`,
`tests/test_okx_close_precision.py`. The whole current files were read, plus the forced OKX path
(`_okx_forced_opening_check` in `services/equity_reconstruction.py`), `scripts/allocator_history_probe.py` and
`scripts/okx_chain_record.py`.
**Status:** clean at the MEDIUM threshold. No findings.

D-07 (179-CONTEXT): the close passes only when the newest bill's `bal` equals today's `cashBal` or differs by at
most 1e-12 of the larger of the two. The rest of D-06 stands. Each invariant was checked against the code:

- **The rule is D-07 and nothing else.** `close_agrees(newest_bal, cash)` is now
  `residual == 0 or residual <= CLOSE_RESIDUAL_REL_BOUND * max(abs(newest_bal), abs(cash))`. The bound is
  inclusive, it multiplies and never divides, and there is no decimal-places arm. A currency missing from the cash
  map (read as 0) passes only when its newest `bal` is 0, because `|bal| <= 1e-12 * |bal|` holds only at 0.
- **No dangling reference to the removed parameter.** A `git grep` for `bal_places`, `close_places` and
  `close_agrees` over `analytics-service/`, `scripts/`, `src/`, `supabase/` and `docs/` finds only the new
  two-argument definition, its two call sites in `okx_bills_chain.py` (`analyse_chain` and `close_race`), the
  `per_ccy_opening` call site, and docstrings. `ChainReport.close_places` is removed, and nothing builds or reads
  it: `test_okx_chain_record.py` uses `dataclasses.replace`, and the probe and the chain record never named it.
  The unused `Iterable` import was dropped along with `bal_places`. `mypy --strict` on both services reports no
  issues.
- **The oracle and the diagnostic still share one rule.** `per_ccy_opening`, `analyse_chain` and `close_race` all
  call the same two-argument `obal.close_agrees` on the same `billId`-ordered newest `bal`. A cash value missing
  from the map reads as 0 in all three. `close_residuals` is computed only for a close-broken currency. There the
  residual is not 0, so `max(|bal|, |cash|)` is above 0 and the division cannot fail.
- **The interior arm stays exact.** `bal != prev_bal + bal_chg` in `per_ccy_opening`, and the diagnostic's
  `residual != 0`, are unchanged. `_INTERIOR_WORLDS` still refuses a 1e-16-relative interior residual on an exact
  close.
- **`OPENING_TOLERANCE_REL` is 0.05, `CLOSE_RESIDUAL_REL_BOUND` is `Decimal("1e-12")`, and the six reason
  tokens are unchanged.** All three are pinned by `test_the_close_bound_and_the_reason_set_are_the_decided_values`.
  The removed `bal_places` could raise only `malformed_bills`. `per_ccy_opening` still validates every `bal`
  through `_decimal` before the close, so no validation was lost.
- **a4's sub-1e-12 USDT shape passes.** The `a4-shape` world (residual 4e-18), the end-to-end oracle test, and the
  forced-path test that reads `agreed` all pass. The close bucket from a4's plan-01 reading was
  `lt_1e-12`. `max_close_residual_rel` uses the same `max(|bal|, |cash|)` denominator as `close_agrees`, so every
  close-broken currency in that reading is inside the inclusive D-07 bound.
- **The one-place 0.5 vs 0.54 case refuses `chain_break`.** `test_a_one_place_print_does_not_forgive_a_visible_gap`
  asserts `chain_break` from the oracle, `close_broken == {USDT}` from the diagnostic, and no interior break. The
  same case appears as the close worlds `one-place-8-percent-gap` and `one-place-hundred-gap`.
- **The forced rebuild still fails closed.** `_okx_forced_opening_check` is unchanged in this delta (its diff
  against `ac83de404` is empty, and so is the diff of `scripts/`). Any outcome other than `agreed` is returned as a
  refusal token. `test_a_close_beyond_the_trillionth_bound_refuses_chain_break_on_the_forced_path` asserts
  `anchor_opening_check == "chain_break"` through `_refusal_audit`.
- **The tests can fail (measured, not assumed).** Four mutations of `close_agrees` were run against
  `tests/test_okx_close_precision.py` in a throwaway copy of `analytics-service/` under the session scratchpad.
  The worktree was never edited, and the copy was deleted afterwards.

  | Mutation | Result |
  |---|---|
  | M1: exact equality only (the pre-D-06 rule) | 7 failed |
  | M2: a 0.05 absolute allowance added (the shape of the deleted one-place rule) | 8 failed |
  | M3: the bound loosened to 1e-9 inside the function, with the constant left alone | 3 failed |
  | M4: the bound made exclusive | 1 failed |

  Every mutation went red. M3 matters most: if someone edited the constant, the pin test would catch it, but this
  shows a widened bound inside the function also goes red, through the `four-places-gap-4e-9` world.
- **Verification run here (read-only).**
  - `pytest -p no:cacheprovider` over `test_okx_close_precision`, `test_okx_opening_balance`,
    `test_okx_bills_chain`, `test_okx_chain_record`, `test_okx_anchor_rule` and `test_allocator_history_probe`:
    451 passed.
  - `mypy --strict` on both changed services: no issues.

Below threshold, not filed. One test docstring line (`test_okx_close_precision.py:85`) runs to 133 characters,
and the world id `four-places-gap-4e-9` names a bill that prints eight places. No CI ruff gate reads either.

---

_Reviewed: 2026-10-28 (round 1); 2026-10-28T19:57:50Z (round 2)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
