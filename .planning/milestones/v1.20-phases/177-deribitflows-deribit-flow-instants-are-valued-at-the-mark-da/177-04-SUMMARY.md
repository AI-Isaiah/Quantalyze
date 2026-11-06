---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 04
subsystem: analytics-service
tags: [deribit, nav-marks, flow-instants, failure-vocabulary, derive, d-05]

requires:
  - phase: 177-01
    provides: the prefetch, the coverage check, the minute reader and its D-05 exceptions, the harness keywords (chart, ledger_marks)
  - phase: 177-03
    provides: FlowPriceStoreError, FlowPricesTable (fail_reads, fail_inserts), the store wiring at the one call site
provides:
  - _MARK_FLOW_INDEX_UNAVAILABLE, the permanent refusal token of a moved INDEXED flow with a structural no-data answer
  - the prefetch capture (read_transient, timeout, rate_limited, store_fault) that keeps the day's mark and surfaces at the apply seam
  - _MOVED_FLOW_PRICE_MIN_SECONDS and the remaining-budget bound on the prefetch
  - the seam's split into permanent refusal (no_data) and transient retry (captured failure or prediction_miss)
affects: [177-05, 177-06, 177-07]

actuals:
  tokens: 7950
  tasks: 3
  commits: 5
plan_head_before: 0b5c93a99a406a6c657ce590953905d045af295d
plan_head_after: 7411411ca93df368a01e8ec62ab5243500d5d8d1
commits: 5

tech-stack:
  added: []
  patterns:
    - "Capture an expected failure inside the crawl and surface it at the apply seam, so the failure never costs the day's mark (Pitfall 2)"
    - "Bound a late read by the derive's remaining budget less the post-crawl reserve, and do not start it below a floor"
    - "A closed reason vocabulary in operator text: static tokens, the exception class name and counts only"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_nav_marks_compose_roundtrip.py

key-decisions:
  - "One capture arm over the four expected exception types with an isinstance dispatch to the reason token, instead of four arms with four copies of the log line. Behaviour and the closed vocabulary are as the plan states; the 429 is stamped inside the arm so the outer except never sees it."
  - "The seam's transient count is unpriced=missing only: a structural no-data count now takes the permanent refusal road, so the two never share a counter."
  - "The floor _MOVED_FLOW_PRICE_MIN_SECONDS is 10.0 s (Claude's discretion per the plan). It is not a latency measurement; a read cut off by the bound is captured as timeout either way."

requirements-completed: [SC-2, SC-3]

coverage:
  - id: D1
    description: "A transient moved-flow price read failure keeps the day's mark: the derive stores its own 03-10 mark (nav 1244.42), writes nothing else, and returns transient reason=read_transient with a counts-only log line"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_index_read_failure_is_named_and_keeps_the_mark"
        status: pass
    human_judgment: false
  - id: D2
    description: "The prefetch is bounded by the derive's remaining budget less the post-crawl reserve: not started below the 10 s floor (zero chart or store calls, reason=timeout), and a hung read is cut at the remaining budget (reason=timeout) with the mark kept"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_index_timeout_below_the_floor_reads_nothing_and_keeps_the_mark"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_index_timeout_is_bounded_by_the_remaining_budget"
        status: pass
    human_judgment: false
  - id: D3
    description: "A last-attempt 429 is stamped through _stamp_429 exactly once with the reader's own exception instance, and the derive returns transient reason=rate_limited with the mark kept"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_index_rate_limited_is_stamped_once_and_keeps_the_mark"
        status: pass
    human_judgment: false
  - id: D4
    description: "Four structural no-data answers (no_data body, BadSymbol, no candle in the containing minute, NaN open) refuse permanently as mark_flow_index_unavailable on the nav-marks refusal road with one chart call, nothing written and the mark kept"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_index_no_data_refuses_by_name (4 parametrized cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A store read fault or write fault (an absent table included) is a transient retry reason=store_fault, never a price used without the store"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_index_store_fault_is_transient_and_keeps_the_mark (read, write)"
        status: pass
    human_judgment: false
  - id: D6
    description: "This derive's own mark is part of the prediction (22.92 / 1171.0 with no stored 03-10 mark), a prediction miss is a prediction_miss retry from the coverage check on the final marks and never the own-day price, and a derive with no moved INDEXED flow reads neither the venue nor the store"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_flow_uses_this_derives_own_mark"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_coverage_check_turns_a_prediction_miss_into_a_retry"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_no_chart_read_without_a_moved_indexed_flow (4 parametrized cases)"
        status: pass
    human_judgment: false

duration: 50min
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 04: the failure vocabulary of the at-instant price read Summary

**A key-mode Deribit derive now keeps the day's mark through every moved-flow price failure and answers each in the house vocabulary: a transient read, timeout, store fault or prediction miss retries with a named reason, a last-attempt 429 is stamped once, and a structural no-data answer refuses permanently as `mark_flow_index_unavailable`. The read is bounded by the derive's remaining budget.**

## Performance

- **Duration:** about 50 min (estimated; the start time was not captured)
- **Completed:** 2026-10-28
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 2 (0 created)

## Accomplishments

- Tracer: three tests seen RED on plan 03's code (red1.log) and GREEN. A nine-times-timed-out chart no longer loses the 03-10 mark: the failure is captured inside the crawl, the exchange closes, the derive's own mark (nav 1244.42) is written, and the seam returns `FAILED` transient with `reason=read_transient unpriced=1`. `csv_daily_returns`, `key_inputs` and the price table stay untouched. The log line carries the reason and the exception class only (asserted: no key id, no amount).
- W2 budget: the prefetch bound is `min(_BROKER_CRAWL_TIMEOUT_S, derive budget - elapsed - _DERIVE_POST_CRAWL_RESERVE_S)`. Below `_MOVED_FLOW_PRICE_MIN_SECONDS` (10.0 s) the read is not started at all (zero chart calls, zero store calls, `reason=timeout`); a hung read with the floor lifted is cut after about 2 s and the mark is still stored. With nothing wanted there is no bound, no read and no warning.
- A last-attempt 429 is awaited through `_stamp_429(ctx.supabase, ctx.key_row, exc)` exactly once, with the ninth instance the reader raised; the outer `except ccxt.RateLimitExceeded` never sees it. Result: transient `reason=rate_limited`, mark kept.
- `_MARK_FLOW_INDEX_UNAVAILABLE = "mark_flow_index_unavailable"` joins the existing nav-marks refusal road unchanged: `FAILED` permanent, `derive_broker_dailies: nav marks refused (mark_flow_index_unavailable)`, an ERROR record with `reason=mark_flow_index_unavailable`, one chart call per structural kind (never retried), nothing written, the mark stored.
- A store fault on either side (read or write) is `reason=store_fault`; the mirror's `fail_reads` stands for the absent-table case.
- Pitfall 3: the derive's own mark is in the prediction (`22.92 / 1171.0` with no stored 03-10 mark); a mark a concurrent writer stored between the two reads is caught by the coverage check on the final marks as `reason=prediction_miss`, with no chart call and nothing written.

## Task Commits

1. **Task 1 (tracer), RED:** `475794693` (test) - read failure, below-the-floor and bounded-timeout cases
2. **Task 1 (tracer), GREEN:** `447c81e57` (feat) - capture, reason token, remaining-budget bound and floor
3. **Task 2, RED:** `ac3975bb5` (test) - 429, four no-data kinds, two store-fault sides
4. **Task 2, GREEN:** `193a0934a` (feat) - the token, the two extra captures, the seam split
5. **Task 3:** `7411411ca` (test) - own-mark, prediction miss, no-read cases

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `analytics-service/services/job_worker.py` - `_MARK_FLOW_INDEX_UNAVAILABLE`, `_MOVED_FLOW_PRICE_MIN_SECONDS`, `_moved_flow_price_failure`, the bounded and captured prefetch, the seam's no-data refusal and reason-bearing transient return; imports `wanted_moved_flows` and `FlowPriceStoreError`
- `analytics-service/tests/test_nav_marks_compose_roundtrip.py` - `derive_moved_btc_without_a_stored_mark`, the assertion helpers, `_HungChart`, and 16 new test cases (9 functions); `asyncio` and `ccxt` imports

## Decisions Made

See key-decisions. Nothing under the phase CONTEXT's locked decisions changed.

## Deviations from Plan

**1. [Structure] One capture arm instead of four**
- **Found during:** Task 2
- **Issue:** the plan describes arms per exception. Four arms would repeat the same log call four times.
- **Fix:** one `except (DeribitTransientReadError, asyncio.TimeoutError, ccxt.RateLimitExceeded, FlowPriceStoreError)` with an `isinstance` dispatch to the closed token; the 429 stamps inside it. The catch list is exactly the four types the plan allows, no bare `Exception`.
- **Files modified:** `analytics-service/services/job_worker.py`
- **Committed in:** `447c81e57`, `193a0934a`

**2. [Rule 2 - test coverage] A fourth no-read case, `usdc_beside_an_unmoved_btc`**
- **Found during:** Task 3 (drill D-N15)
- **Issue:** a lone USDC instant never enters the prefetch (the `any(INDEXED)` gate in job_worker is false), so the wanted-flow filter in `wanted_moved_flows` was never reached by the three listed cases from the prefetch side.
- **Fix:** a case with a moved USDC deposit beside an unmoved BTC one, which passes the gate and so exercises the filter inside the prefetch.
- **Committed in:** `7411411ca`

**3. [Plan text] Drill D-N15 names the wrong function and the wrong RED line**
- **Found during:** Task 3
- **Issue:** the plan neuters the INDEXED filter "in `resolve_moved_flow_prices`" and expects `usdc_in_window` RED "on the chart call". The filter lives in `wanted_moved_flows`, which the prefetch AND the seam's coverage check both call. Neutered there, `usdc_in_window` goes RED on the SEAM (the USD-family instant counts as unpriced, so the derive fails instead of completing), not on a chart call; `usdc_beside_an_unmoved_btc` goes RED on the prefetch (the empty chart script turns the USDC read into a no-data refusal, ERROR `reason=mark_flow_index_unavailable`).
- **Files modified:** none (drill only)

**4. [Wording] Seam text uses a hyphen**
- The transient text is `derive_broker_dailies: deribit moved-flow price unavailable (reason=<token> unpriced=<n>) - retrying`, as the plan wrote it. It replaces plan 01's text; no other test asserted the old wording.

**Total deviations:** 4 (1 structural, 1 added coverage, 2 plan-text mismatches). **Impact on plan:** none on behaviour or interfaces.

## Neuter-and-see-RED drills (byte backups in the scratch dir, never git checkout/restore/stash)

| Drill | Neuter | RED line | Restore |
|---|---|---|---|
| RED-1 (red1.log) | plan 03's code, tests first | `3 failed, 33 deselected`; the read-failure test sees `DeribitTransientReadError` raised out of the crawl, the below-the-floor test sees `assert 'reason=timeout' in '... have no at-instant price (unpriced=1) ...'`, the bounded test hits its 15 s guard (`TimeoutError`) | n/a (commit `475794693`) |
| D-N9 (`jw.bak`) | re-raise the captured `DeribitTransientReadError` | `FAILED test_deribit_moved_flow_index_read_failure_is_named_and_keeps_the_mark`; `1 failed, 2 passed` | `cmp` exit 0 |
| D-N9a (`jw2.bak`) | fixed `_BROKER_CRAWL_TIMEOUT_S` as the `wait_for` timeout, floor check removed | `FAILED ..._timeout_below_the_floor_...` (`assert 'reason=timeout' in '...reason=prediction_miss...'`, a chart call was made) and `FAILED ..._timeout_is_bounded_by_the_remaining_budget` (the 15 s guard, `TimeoutError`); `2 failed, 1 passed` | `cmp` exit 0 |
| D-N9b (`jw3.bak`) | the `asyncio.TimeoutError` arm no longer matches | `FAILED ..._timeout_is_bounded_by_the_remaining_budget`; `1 failed, 2 passed` | `cmp` exit 0 |
| RED-2 (red2.log) | Task 1's code, tests first | `7 failed, 3 passed`: the 429 test sees `RateLimitExceeded: 429 attempt 8` escape, four no-data cases see `'transient' == 'permanent'`, two store-fault cases see `FlowPriceStoreError` escape | n/a (commit `ac3975bb5`) |
| D-N10 (`jw4.bak`) | drop the `_stamp_429` call | `AssertionError: Expected mock to have been awaited once. Awaited 0 times.`; `1 failed, 9 passed` | `cmp` exit 0 |
| D-N11 (`jw5.bak`) | `no_data` takes the transient return | `FAILED` all four `..._no_data_refuses_by_name[*]` cases; `4 failed, 6 passed` | `cmp` exit 0 |
| D-N12 (`jw6.bak`) | remove `FlowPriceStoreError` from the capture | `FlowPriceStoreError: api_key_flow_prices: insert failed` / `read failed` escape; `FAILED ..._store_fault_...[write]` and `[read]`; `2 failed, 8 passed` | `cmp` exit 0 |
| D-N13 (`jw7.bak`) | drop this derive's own mark from the predicted marks | `FAILED test_deribit_moved_flow_uses_this_derives_own_mark` (`DispatchOutcome.FAILED` instead of `DONE`: `prediction_miss`); `1 failed, 5 passed` | `cmp` exit 0 |
| D-N14 (`jw8.bak`) | skip the seam's coverage check | `FAILED test_deribit_coverage_check_turns_a_prediction_miss_into_a_retry` (`DispatchOutcome.DONE` instead of `FAILED`: the own-day price is written); `1 failed, 5 passed` | `cmp` exit 0 |
| D-N15 (`dfp.bak`) | drop the INDEXED filter in `wanted_moved_flows` | `FAILED ..._no_chart_read_...[usdc_in_window]` (seam coverage check) and `[usdc_beside_an_unmoved_btc]` (prefetch, ERROR `reason=mark_flow_index_unavailable`); `2 failed, 2 passed`. Also bypassing the job_worker `any(INDEXED)` gate (`jw9.bak`): the same two fail | `cmp` exit 0 on both files |

## Verification

- Base quick suite (before any change, `test_nav_marks_compose_roundtrip`, `_derive_apply`, `_composite`, `test_flow_price_store`): `107 passed`. After Task 1: `110 passed`.
- `-k moved_flow_index`: `10 passed` (1 read failure, 2 timeout, 1 rate limit, 4 no-data kinds, 2 store-fault sides). `-k "own_mark or coverage_check or no_chart_read"`: `6 passed`.
- Task 3 verify set (`test_nav_marks_flow_instants`, `_apply`, `_derive_apply`, `_compose_roundtrip`, `_composite`, `test_flow_price_store`, `test_deribit_ingest`): `319 passed`. Plan-level set with `test_nav_marks_l4_read`, `test_flow_price_store`, `test_deribit_ingest`: `240 passed`.
- Wider Deribit / NAV-marks / native / MTM / flow / job-worker / derive files (62 by name match): `1993 passed, 10 skipped`; none of the skips was added by this plan.
- CI's mypy line from `analytics-service/`: `Success: no issues found in 129 source files`.
- No Deribit, PROD, TEST or Railway access: every chart call is scripted, and the hung read is a local event nobody sets.

## Known limits

- **A minute with no candle refuses on every derive, indefinitely (RESEARCH Open Question 8, accepted under D-05).** A moved INDEXED flow whose containing minute has no candle in `{CCY}_USDC-PERPETUAL` (the `no_containing_candle` kind, also `no_data` and `BadSymbol`) takes the permanent `mark_flow_index_unavailable` refusal every night, because such a minute has no price to store and there is no override and no fallback in this phase. The plausible cases are thinly traded USDC perpetuals of non-BTC/ETH coins (RESEARCH A5). The refusal writes nothing, so the previous series stays as it was.
- The capture covers the key-mode Deribit branch only. The allocated twin, the strategy-mode Deribit branch and the two composite member closures are plans 05 and 06, which must reuse this vocabulary.
- The floor (10.0 s) is a judgement, not a measurement. A wrongly low floor starts a read that is then cut and captured as `timeout`; a wrongly high one skips a read that would have finished. Both outcomes keep the mark and retry.

## Issues Encountered

None beyond the deviations above. One note for the next executor: zsh does not word-split an unquoted `$VAR` holding several paths, so the wide-suite run needs `bash -c` (the first attempt returned pytest exit 4).

## Known Stubs

None. No placeholder, hardcoded empty value flowing to a UI, or unwired data source was introduced.

## Threat Flags

None. No new network endpoint, auth path, file access or schema change. T-177-16..20 and T-177-30 are mitigated as the register states: the coverage check on the final marks (D-N14), the permanent refusal with nothing written (D-N11), capture-then-surface so the mark survives (D-N9), `_stamp_429` exactly once (D-N10), closed reason tokens with no key id or amount in the log or the transient text (asserted in the read-failure, below-the-floor and no-data tests), and the remaining-budget bound (D-N9a, D-N9b).

## Next Phase Readiness

- Plans 05 and 06 wire the remaining `native_flow_instants` sites. They can reuse `_MARK_FLOW_INDEX_UNAVAILABLE`, `_MOVED_FLOW_PRICE_MIN_SECONDS`, the closed reasons (`read_transient`, `timeout`, `rate_limited`, `store_fault`, `prediction_miss`) and the `derive_moved_btc_without_a_stored_mark` harness shape; the composite member refusal `_MemberFlowIndexUnavailable` (plan 06) uses the same token.
- Plan 07 owns the census rows; this plan added no SQL file, no test module and no `ci.yml` change.

## Self-Check: PASSED

`job_worker.py` and `test_nav_marks_compose_roundtrip.py` exist; commits `475794693`, `447c81e57`, `ac3975bb5`, `193a0934a`, `7411411ca` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD is 5 and the working tree held nothing else uncommitted.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
