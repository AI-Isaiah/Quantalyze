---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 05
subsystem: analytics-service
tags: [deribit, nav-marks, flow-instants, strategy-mode, allocated-twin, coverage-check, d-01, d-04, d-05]

requires:
  - phase: 177-01
    provides: native_flow_instants(at_instant_index=...), the prefetch, the coverage check, the harness keywords
  - phase: 177-03
    provides: the price store and FlowPricesTable
  - phase: 177-04
    provides: _MARK_FLOW_INDEX_UNAVAILABLE, the closed failure reasons, the capture-then-surface prefetch
provides:
  - one shared coverage check (_deribit_moved_flow_gate) used by the key writer basis, the strategy-mode seam and the allocated twin
  - at_instant_index wired at the strategy-mode and allocated-twin native_flow_instants calls
  - the price prefetch runs on every Deribit derive, not only key mode
  - MovedFlowCounts and moved_flow_counts, and D-01's counts-only derive log line
affects: [177-06, 177-07]

actuals:
  tokens: 7990
  tasks: 3
  commits: 6
plan_head_before: 42ae7e133d0f496a5c2253e28f95136d798b0124
plan_head_after: 1c9f6893baa098fee9d01faf8f62ef64c0d13ddb
commits: 6

tech-stack:
  added: []
  patterns:
    - "One coverage-check function returning None, a refusal token or a transient DispatchResult, called from every seam with the raw instants of the ledger that seam values"
    - "A prediction-miss test models a concurrent writer by hiding one mark from read_key_marks until the exchange close has been awaited"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/deribit_flow_prices.py
    - analytics-service/tests/test_nav_marks_derive_apply.py
    - analytics-service/tests/test_nav_marks_allocated.py
    - analytics-service/tests/test_nav_marks_compose_roundtrip.py

key-decisions:
  - "The coverage check was lifted out of the key-mode branch into a module-level function and called three times, instead of copying the split. It returns None, the token, or the transient result, so each seam keeps its own two-line handling."
  - "The prefetch gate `is_key_mode and any(INDEXED)` lost `is_key_mode`. Without that, a strategy-mode or allocated derive would have had a coverage check but no prices and would have retried forever. The prediction already includes the derive's own mark in both modes (the mark write is shared)."
  - "The D-01 line sits after the `nav marks applied` line and counts over `_apply_instants`, the instants actually passed to apply_marks, with `amount_prior_day` as the at-instant marker (Pitfall 6)."

requirements-completed: [SC-1, SC-2]

coverage:
  - id: D1
    description: "A strategy-mode Deribit derive counts a moved BTC deposit at the open of its containing candle: r(03-08) = 19.9 / 1100.0 where own-day pricing stored 19.0 / 1100.0"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_derive_apply.py#test_deribit_strategy_moved_btc_flow_priced_at_the_instant_price"
        status: pass
    human_judgment: false
  - id: D2
    description: "The allocated NAV twin counts its moved BTC deposit at the candle open: r(03-07) = 10.0 / 1900.0 where own-day pricing stored 9.1 / 1900.0"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_allocated.py#test_allocated_moved_btc_flow_priced_at_the_instant_price"
        status: pass
    human_judgment: false
  - id: D3
    description: "Each seam refuses a no-data minute permanently as mark_flow_index_unavailable (one chart call, nothing written) and retries a prediction miss as transient reason=prediction_miss (no chart call, nothing written)"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_derive_apply.py#test_deribit_strategy_moved_flow_no_data_refuses_by_name"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_derive_apply.py#test_deribit_strategy_moved_flow_prediction_miss_is_a_retry"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_allocated.py#test_allocated_moved_flow_no_data_refuses_by_name"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_allocated.py#test_allocated_moved_flow_prediction_miss_is_a_retry"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every Deribit derive that applies marks logs one counts-only line, emitted at moved=0, with no key or strategy id"
    requirement: SC-1
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_flows_moved_log_key_mode"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_flows_moved_log_at_zero"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_derive_apply.py#test_deribit_flows_moved_log_strategy_mode"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_nav_marks_derive_apply.py#test_moved_flow_counts_splits_the_flows_each_mark_moves"
        status: pass
    human_judgment: false

duration: about 60min
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 05: strategy mode, the allocated twin and D-01's log line Summary

**Every single-derive path that values Deribit flow instants (key writer basis, strategy mode, allocated NAV twin) now counts a moved INDEXED flow at its candle open, under one shared coverage check that refuses a no-data minute and retries a prediction miss; every Deribit derive that applies marks logs one counts-only `deribit flows moved by marks` line.**

## Performance

- **Duration:** about 60 min (estimated; the start time was not captured)
- **Completed:** 2026-10-28
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 5 (0 created)

## Accomplishments

- Tracer (strategy mode): three tests seen RED on plan 04's code, then GREEN. A 0.0002 BTC deposit at 00:05:20Z on 03-09 inside the 03-08 mark is counted at 0.0002 x 100500.0 = 20.1 and r(03-08) = 19.9 / 1100.0 (own-day pricing stored 19.0 / 1100.0).
- Allocated twin: the same fix on `_twin_ledger`'s instants; r(03-07) = 10.0 / 1900.0 (own-day: 9.1 / 1900.0), r(03-06) unchanged at -0.04.
- One coverage-check implementation, `_deribit_moved_flow_gate`, replaces the inline key-mode block. It is called with the raw instants of the ledger each branch values, and with `mode` = `key` or `strategy` for the warning text.
- The prefetch no longer waits for key mode. Without that, a strategy-mode derive would have been checked against an empty price index and retried on every run.
- D-01: `MovedFlowCounts` and `moved_flow_counts` in `deribit_flow_prices.py`, and the INFO line in `job_worker.py` after `nav marks applied`.

## Task Commits

1. **Task 1 RED:** `e19317a54` (test) - harness keywords on `run_deribit`, the oracle, the no-data and prediction-miss tests
2. **Task 1 GREEN:** `f8d29fd49` (feat) - shared gate, strategy-mode wiring, prefetch gate lifted
3. **Task 2 RED:** `09a8ab1cf` (test) - harness keywords on `derive_allocated`, three tests
4. **Task 2 GREEN:** `5c2c74ff0` (feat) - the allocated twin site
5. **Task 3 RED:** `472dcfbd1` (test) - two unit cases and three log cases
6. **Task 3 GREEN:** `1c9f6893b` (feat) - `moved_flow_counts` and the log line

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `analytics-service/services/job_worker.py` - `_deribit_moved_flow_gate`, `at_instant_index` at two more sites, the prefetch gate, the D-01 line
- `analytics-service/services/deribit_flow_prices.py` - `MovedFlowCounts`, `moved_flow_counts`
- `analytics-service/tests/test_nav_marks_derive_apply.py` - `run_deribit` keywords (`ledger_marks`, `chart`, `flow_prices`, `marked_run_patches`, `mark_read_at`), `scripted_chart`, `candles`, `concurrent_writer_marks`, the strategy-mode, count and log tests
- `analytics-service/tests/test_nav_marks_allocated.py` - `derive_allocated` keywords (`twin_instants`, `ledger_marks`, `chart`, `flow_prices`), three allocated tests
- `analytics-service/tests/test_nav_marks_compose_roundtrip.py` - the key-mode log tests

## Decisions Made

See key-decisions. Nothing under the phase CONTEXT's locked decisions changed. D-01's SQL upper bound is already in 177-CONTEXT.md: `grep -a "deribit_marks=16"` finds `deribit_marks=16, deribit_keys_with_marks=8` (measured on PROD 2026-10-28, counts only). Reading the real moved count off the new line after the next nightly derives is the orchestrator's post-merge step.

## The D-01 log line, for whoever reads it

`derive_broker_dailies: deribit flows moved by marks (moved=%d at_instant=%d usd_family=%d on_last_mark=%d mode=%s)`, INFO, counts and a closed mode word only (no `id=`, no `funding_label`, no amount, minute or instrument).

- It is emitted even at `moved=0`, so a missing line is never read as zero.
- `moved` is CUMULATIVE over the key's mark history (every derive re-applies every mark); `on_last_mark` is the nightly increment.
- A key is logged by its key-mode derive and again by the strategy-mode derive of any strategy on it. Read `mode=key` lines for a per-key count.
- A derive retry logs again.
- `moved` always equals `at_instant + usd_family`, because the coverage check fails the derive first otherwise.

## Deviations from Plan

**1. [Rule 3 - Blocking] The prefetch gate was key-mode only**
- **Found during:** Task 1 (reading the seam before the GREEN edit)
- **Issue:** the plan's GREEN wires `at_instant_index` and the shared check at the strategy-mode site only. The prefetch that fills `_moved_flow_prices` ran only under `is_key_mode`, so a strategy-mode or allocated derive would have had an empty index, found every moved flow `missing`, and retried forever.
- **Fix:** dropped `is_key_mode and` from the gate. The prediction already includes the derive's own mark in both modes, because the mark write is shared by both. The allocated path's early marks read and its twin-inclusive raw-instant union were already in place.
- **Files modified:** `analytics-service/services/job_worker.py`
- **Committed in:** `f8d29fd49`

**2. [Structure] The key-mode block became the shared function in Task 1, not copied**
- The plan says the strategy and allocated seams "share the block plans 01/04 built". That block was inline in the key branch and set a local, so it could not be shared as it stood. It is now `_deribit_moved_flow_gate`; behaviour and texts for key mode are unchanged (the existing plan 04 tests pass untouched).

**3. [Wording] Log format string on one line**
- The acceptance grep matches the format as one literal, so the string is not split across two source lines.

**Total deviations:** 3 (1 Rule 3, 2 structure/wording). **Impact on plan:** none on behaviour beyond the prefetch gate, which the plan's own tests require.

## RED evidence

- red1.log (Task 1, on plan 04's code): `3 failed, 36 deselected`. The oracle sees `0.017272727272727273` (19.0 / 1100.0) against `0.018090909090909088` (19.9 / 1100.0); the no-data and prediction-miss tests see `DispatchOutcome.DONE` where `FAILED` is expected.
- red2.log (Task 2, on Task 1's code): `3 failed, 16 deselected`. The oracle sees `0.004789473684210478` (9.1 / 1900.0) against `0.005263157894736842` (10.0 / 1900.0); the other two see `DONE` instead of `FAILED`.
- red3.log (Task 3): `5 failed, 88 deselected`. Two unit cases fail on the missing `MovedFlowCounts`; the key, zero and strategy log cases see an empty list of lines.

## Neuter-and-see-RED drills (byte backups in `/tmp/deribitflows-05`, never git checkout/restore/stash)

| Drill | Neuter | RED line | Restore |
|---|---|---|---|
| D-N16 (`jw.bak`) | strategy-mode site passes `at_instant_index=None` | oracle `0.01727... == 0.01809...` (19.0 / 1100.0); `1 failed, 2 passed` | `cmp` exit 0 |
| D-N16b (`jw1b.bak`) | strategy-mode site feeds `[]` to the shared check | no-data and prediction-miss tests each `DONE` instead of `FAILED`; `2 failed, 1 passed` | `cmp` exit 0 |
| D-N17 (`jw2.bak`) | allocated site passes `None` | oracle `0.0047894... == 0.0052631...` (9.1 / 1900.0); `1 failed, 2 passed` | `cmp` exit 0 |
| D-N17b (`jw2b.bak`) | allocated site feeds `[]` to the shared check | no-data and prediction-miss tests each `DONE` instead of `FAILED`; `2 failed, 1 passed` | `cmp` exit 0 |
| D-N18 (`dfp.bak`) | `at_instant` counted from the instants' currency instead of `amount_prior_day` | `test_deribit_flows_moved_log_key_mode`, `test_deribit_flows_moved_log_strategy_mode` and the counts unit case RED; `3 failed, 2 passed` | `cmp` exit 0 |

## Verification

- Plan suite (`test_nav_marks_flow_instants`, `_apply`, `_derive_apply`, `_compose_roundtrip`, `_composite`, `_allocated`, `test_flow_price_store`): `191 passed`.
- `-k deribit_strategy_moved`: `3 passed`. `-k allocated_moved`: `3 passed`. `-k "deribit_flows_moved_log or moved_flow_counts"`: `5 passed`.
- Wider name match (nav_marks, deribit, native, mtm, flow, job_worker, derive, allocat): `2944 passed, 10 skipped`; none of the skips was added by this plan.
- CI's mypy line from `analytics-service/`: `Success: no issues found in 129 source files`.
- `grep -ac 'at_instant_index=_moved_flow_prices.index' analytics-service/services/job_worker.py` is 3; the D-01 format grep is 1; `def moved_flow_counts` is 1.
- No Deribit, PROD, TEST or Railway access: every chart call is scripted.

## Known limits

- The composite closures (plan 06) still value flows without `at_instant_index`; plan 06 owns them and reuses the same token.
- The allocated path's prefetch looks at all stored marks, not only those inside the mandate window, so it may read a price for a flow a mark outside the window moves. The seam's check uses only the in-window marks, so a no-data answer for an out-of-window flow cannot refuse the derive. The extra read is stored and not repeated.
- A minute with no candle refuses on every derive on all three paths (plan 04's accepted limit, RESEARCH Open Question 8).

## Issues Encountered

None beyond the deviations above.

## Known Stubs

None. No placeholder, hardcoded empty value flowing to a UI, or unwired data source was introduced.

## Threat Flags

None. No new network endpoint, auth path, file access or schema change. T-177-21 and T-177-31 are mitigated as the register states (wiring and shared check at both sites; per-seam no-data and prediction-miss tests; drills D-N16, D-N16b, D-N17, D-N17b). T-177-22 is mitigated: the log carries counts and the closed mode word only, and the tests assert the absence of the strategy and key ids.

## Next Phase Readiness

- Plan 06 wires the two composite closures. It can reuse `_deribit_moved_flow_gate`'s split and the vocabulary; the composite log line is its own (`run_stitch_composite_job: deribit flows moved by marks`).
- Plan 07 owns the census rows; this plan added no SQL file, no test module and no `ci.yml` change.

## Self-Check: PASSED

`job_worker.py`, `deribit_flow_prices.py` and the three test files exist; commits `e19317a54`, `f8d29fd49`, `09a8ab1cf`, `5c2c74ff0`, `472dcfbd1`, `1c9f6893b` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD is 6 and the working tree held nothing else uncommitted.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
