---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
reviewed: 2026-10-28T00:00:00Z
round: 3
depth: standard
files_reviewed: 6
files_reviewed_list:
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/scripts/okx_chain_record.py
  - analytics-service/services/okx_bills_chain.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_okx_bills_chain.py
  - analytics-service/tests/test_okx_chain_record.py
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 179: Code Review Report (round 3, after fix round 2)

**Reviewed:** 2026-10-28
**Depth:** standard. Scope is the fix round `a6e149c3f..HEAD -- analytics-service/` (commits
`c0ef32f51..e21d92111`). I read it against the full current files and against plan 179-03 Task 2's
completeness rule and precedence (`179-03-PLAN.md:153`, `:158-171`) and step 9's `sc1:` lines
(`:127`).
**Files Reviewed:** 6
**Status:** issues_found (no blocker)

## Summary

**Round-2 findings, re-checked:**

| Round-2 id | Verdict | Where |
|---|---|---|
| CR-01 / SFH-R2-02 (malformed close group reads as a complete search) | resolved | `okx_chain_record.py:558`, `:568`, `:582-584`. After any group failure `chain_ceiling_hit` stays field-absent, which plan 179-03 `:159` reads as cut-short. Pinned by `test_a_malformed_balance_in_the_close_group_is_not_a_complete_search`. |
| WR-01 / SFH-R2-03 (first failure wins) | resolved, with a regression on the `diverged` path (WR-02 below) | `okx_chain_record.py:569-575` |
| WR-02 / SFH-R2-05 (malformed row mid-sweep or mid-7-day loses the group) | resolved | `okx_bills_chain.py:533-536`, `:729-735`. Partial results are kept and `complete` is False. |
| WR-03 / SFH-R2-04 (a refusal leaves no trace) | resolved as a count (`chain_recent_refused`, `chain_sweep_refused`), not as a class or log line | `okx_chain_record.py:182-183`, `:524`, `:547`. Given SFH-R2-01, a record count is the only trace that reaches PROD, so this is the right channel. The class split is not done (IN-03). |
| WR-04 / SFH-R2-06 (chain deadline outlasts the outer bound) | resolved | `allocator_history_probe.py:1045`, `:1113-1118`; `okx_chain_record.py:559` |
| WR-05 (above-walk lag counted as hidden type) | mostly resolved; one case is left (WR-01 below) | `okx_bills_chain.py:698-712`, `:742` |
| SFH-R2-01 (logging disabled on PROD) | not fixed, by decision (the record carries class and step) | n/a |
| IN-01 / IN-02 (round 2) | not fixed (Info); IN-01 is now easier to reach (IN-02 below) | |

**Checked and holding:**

- **Can a group that did not finish still read as `chain-completeness: complete`?** I went through
  each group:
  - close: a failure sets `any_failed`, so `chain_ceiling_hit` is field-absent, which is cut-short.
  - repeat: a venue fault or a ceiling raises. An oracle reason is a measured verdict.
  - below_stop: a failure leaves `chain_below_stop_complete` field-absent, which is cut-short.
  - recent: a refusal or malformed page now returns `complete=False`.
  - sweep: a refused or malformed filter, a refused unfiltered page, zero types or a ceiling all
    give `complete=False`.
  - deadline: a `TimeoutError` is an `Exception`, so it sets `any_failed` and stops.
  - divergence: `chain_diagnostic=failed` routes to `sc1: not-measured`.

  I found no path that writes `chain_ceiling_hit=False` while a group failed, or `*_complete=True`
  for a read that did not finish. The one false-positive *hidden-kinds* path left is WR-01. It
  fires with `complete=True`, but it does not reach named-refusal: it would make row 6 match.
- **Remaining-budget arithmetic.** `started` is stamped with the loop clock on the first line of
  `_measure_anchor`. In Python 3.12, `wait_for` runs the coroutine in the same task under
  `asyncio.timeout`, so `started` is within microseconds of when the outer bound began, and both
  use the loop clock. `left_s = bound - elapsed - 30` is clamped at 0. `measure_chain` then takes
  `min(CHAIN_TIMEOUT_S, budget_s)` (`:559`), which the record-level test pins with `budget_s=0.05`.
  A bound overridden by env below 30 s gives a budget of 0. The first group then raises
  `TimeoutError` at once (3.12 `wait_for` with a timeout ≤ 0 cancels and raises), so it is recorded
  and never cancelled from outside. The 30 s margin covers cancelling an in-flight GET or a backoff
  `asyncio.sleep`. `_okx_bills_fetch_with_backoff` catches only `RateLimitExceeded` and
  `DDoSProtection`, so cancellation is not swallowed.
- **The unfiltered page and the call ceiling.** The page goes through `budget`, so it is counted.
  A `CallCeilingReached` there returns `ceiling_hit=True`, and the record writes
  `chain_ceiling_hit=True`, which is cut-short. A 429 that outlives the backoff, a network fault or
  an auth failure on that page propagates, so `any_failed` leaves the ceiling field-absent. A
  refused or malformed page adds to `rejected`, so `complete` is False. The tests' call counts went
  up by exactly 1 (`chain_calls` 14 → 15, 13 → 14), and the ceiling tests were re-based (3 → 4,
  8 → 9).
- **Forced rebuild path unchanged.** The diff touches only the six reviewed files. Outside tests,
  only `scripts/allocator_history_probe.py` and `scripts/okx_chain_record.py` import the chain
  modules. `okx_opening_balance.py`, `equity_reconstruction.py` and `exchange.py` are untouched.
- **No leak in the new keys.** `chain_recent_refused` is 0 or 1, and `chain_sweep_refused` is at
  most 1 + types + 6. Both are counts validated by `_is_count_or_absent`, and the bad-value tests
  cover `-1` and `True`. `CHAIN_KEYS` is 59, with the new keys appended at the end, so
  `ACCOUNT_RECORD_KEYS[-59:] == CHAIN_KEYS` holds (tested). Plan 179-03's import check computes
  `len(c.CHAIN_KEYS)` fresh, so it still works.
- **Checks run:**
  - The three test files pass: `310 passed`.
  - `mypy` is clean on the three source modules.
  - The probe-level outer-bound test runs in under 5 ms against its 0.5 s bound, so it is not a
    flake risk.
  - A scratch script (not committed) confirmed WR-01:
    `scratchpad/r3_sweep_cover.py` → `types_hidden 1 kinds {('34','','SPOT'): 1} complete True`.

## Warnings

### WR-01: The unfiltered page does not check that it covers the bills above the walk, so a lagged bill can still count as a hidden type with `complete=True`

**File:** `analytics-service/services/okx_bills_chain.py:698-712`, `:742`

**Issue:** The WR-05 fix excludes an above-walk bill only if it is in `served_now`, which is ONE
unfiltered newest-first page of 100 rows. That page covers every bill above `walk_max` only when
it is short, or when its smallest `billId` is at or below `walk_max`. Neither is checked.

Suppose 100 or more bills have a `billId` above `walk_max` by sweep time. Ordinary activity
during the run is enough: the walk started minutes before the sweep, and those bills are excluded
from "hidden" only because `_after_the_walk` drops them. They fill the page. A bill stamped before
the walk began and ingested late then falls off the page. So it is absent from `served_now`, a
filtered probe serves it, and it counts as hidden. That is the WR-05 misreading again.

Nothing marks the sweep incomplete in this case. I reproduced it with a scratch script: one walked
bill, one lagged type-34 bill stamped before the walk began, and 100 bills created after it. The
result was `types_hidden=1`, `hidden_kinds={('34','','SPOT'): 1}`, `complete=True`, `refused=0`.

Under plan 179-03 this matches row 6 (hidden-kinds). It can win outright when the 7-day read does
not support row 3. On a busy account `chain_sweep_partial > 0` is likely as well, but row 6 still
matches then, with the count read as a lower bound. For a4 (1282 trades over the window) 100 new
bills during one run is unlikely, which is why this is a warning and not a blocker. The guard,
though, assumes something it never checks.

**Fix:** treat a page that does not reach the walk as one that could not rule lag out, the same
way as the refused-page branch:

```python
        page = [obal._parse_bill(r) for r in obal._page_rows(newest)]
        served_now = {b["billId"] for b in page}
        if len(page) >= obal.BILLS_ARCHIVE_PAGE_ROWS and min(int(b["billId"]) for b in page) > walk_max:
            # The newest page did not reach the walk: lag above it cannot be ruled out.
            rejected += 1
```

`walk_max` has to be computed before this block, which it already is (`:689`). Add a test with
100 bills created during the run, as in the scratch script, that asserts `complete is False`.

### WR-02: A venue fault after a `diverged` re-fold overwrites `analysis`, so the founder's `sc1: not-measured` line blames a network fault for what is a diagnostic defect

**File:** `analytics-service/scripts/okx_chain_record.py:485-494`, `:574`; pinned by
`analytics-service/tests/test_okx_chain_record.py` `test_a_venue_fault_after_a_diverged_refold_is_the_recorded_failure`

**Issue:** `diverged` sets `chain_diagnostic=failed`, `chain_failed_step=analysis` and
`chain_diagnostic_failure_class=other`. That says the re-fold disagrees with the oracle, which is a
defect that a second run will not clear. The WR-01 fix (`:574`) now lets any stopping failure
overwrite step and class without condition. A diverged run whose 7-day read hits a `NetworkError`
or a Timeout is then recorded as `chain_diagnostic=failed`, `chain_failed_step=recent`,
`class=NetworkError`.

Plan 179-03 step 9 (`179-03-PLAN.md:127`) prints this case as
`sc1: not-measured (opening_check=.. reason=.. chain_diagnostic=failed step=recent class=NetworkError)`.
`chain_arm` is not on that line. The line the founder reads to decide whether to spend another
approved run now names a transient venue fault as the reason the diagnostic failed. The real
reason (`diverged`) shows only in the long `chain-reading:` line.

Routing stays `not-measured`, so no wrong fix can follow. But the next run is approved on a false
premise, and it will diverge again. The malformed branch already refuses to overwrite `analysis`
(`:571`), so the two branches now disagree about whether a divergence can be replaced.

**Fix:** a stopper may replace `none` or a recorded malformed failure, never `analysis`:

```python
            if out["chain_failed_step"] != "analysis":
                out = {**out, "chain_diagnostic_failure_class": _failure_class(exc), "chain_failed_step": step}
            break
```

The stopper on a diverged record still shows: `chain_ceiling_hit` is field-absent and the later
groups' keys are field-absent. Change the pinned test to assert `chain_failed_step == "analysis"`
and `chain_ceiling_hit == FIELD_ABSENT`. Alternatively, return right after marking `diverged`
(round-2 IN-02), so a diverged record carries no venue keys to misread.

## Info

### IN-01: A ceiling at the sweep's first call prints measured zeros for a sweep that probed nothing

**File:** `analytics-service/services/okx_bills_chain.py:705-706`; `analytics-service/scripts/okx_chain_record.py:539-548`

**Issue:** When the ceiling falls on the new unfiltered page, `sweep_hidden` returns
`Sweep(0, 0, 0, 0, 0, {}, False, True)`. The record then writes `chain_types_hidden=0`,
`chain_inst_types_hidden=0`, `chain_hidden_kinds=none` and `chain_sweep_partial=0`. This goes
against the module rule ("Not measured is field-absent, never 0") and against `measure_chain`'s
docstring ("A group that hits CHAIN_CALL_CEILING leaves its keys at their defaults").

Routing is safe, because `chain_ceiling_hit=True` and `chain_sweep_complete=False` are cut-short.
The same shape already existed for a ceiling at the first filter. Before this round, a ceiling
here would have hit `read_bill_types` and left the defaults.

**Fix:** in `_sweep`, when `sweep.ceiling_hit` and nothing was probed, return only
`chain_sweep_complete=False` and leave the counts at their defaults.

### IN-02: When the outer budget is used up, the Timeout is charged to `close` with zero calls made

**File:** `analytics-service/scripts/allocator_history_probe.py:1113-1117`; `analytics-service/scripts/okx_chain_record.py:559-562`

**Issue:** `budget_s=max(0.0, left_s)` makes the first group time out at once. The record then
reads `chain_failed_step=close`, `class=Timeout`, `chain_calls=0`, although the time went to the
crawl and the walk. The probe test pins this
(`assert account["chain_failed_step"] == "close"  # no budget was left`). This is round-2 IN-01,
which is now reachable whenever the crawl uses more than about 1470 s. `chain_calls=0` in the
`sc1-steps` line lets a careful reader tell the cases apart.

**Fix:** when `budget_s` is ≤ 0, skip the venue groups and record the step as `analysis` with
class `Timeout`, or document `close` + `calls=0` as "no budget left" next to `CHAIN_TIMEOUT_S`.

### IN-03: The refusal counts merge causes the founder may need to tell apart

**File:** `analytics-service/services/okx_bills_chain.py:497-499`, `:664-665`, `:709-712`, `:724-735`

**Issue:** `chain_sweep_refused` adds up three different things:
- a refused or malformed unfiltered page, which is a lag-guard failure and not a filter;
- refused type filters (the D-02 evidence);
- refused instType filters.

It does not separate a venue refusal from a malformed page either. `Sweep.refused`'s comment says
"Filters the venue refused", but the unfiltered page is not a filter. The SFH-R2-04 minimum (split
type from instType, so a refused instType does not block a complete type sweep) was not done.
Plan 179-03 reads none of these keys, so no recommendation changes. Separately, the plan's
"all six groups" (`179-03-PLAN.md:159`) still names six groups where there are five.

**Fix:** none needed for the decision. If the founder has to choose between a second run and a
replan after a refused sweep, split the count into type, instType and unfiltered-page parts.

---

_Reviewed: 2026-10-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
