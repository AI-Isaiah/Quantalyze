---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 06
subsystem: analytics-service
tags: [deribit, nav-marks, flow-instants, stitch-composite, allocated-twin, d-01, d-04, d-05]

requires:
  - phase: 177-01
    provides: resolve_moved_flow_prices, unpriced_moved_flows, native_flow_instants(at_instant_index=...)
  - phase: 177-03
    provides: the price store, FlowPriceStoreError, FlowPricesTable
  - phase: 177-04
    provides: _MARK_FLOW_INDEX_UNAVAILABLE and the failure vocabulary
  - phase: 177-05
    provides: moved_flow_counts and the derive's D-01 line
provides:
  - _MemberFlowIndexUnavailable, the composite's named refusal of a member moved flow with no price
  - _member_moved_flow_index, one helper that prices a composite Deribit member's moved flows with its exact marks
  - the _apply_member_marks price_flows hook and the _apply_allocated_member_marks at_instant_index keyword
  - the composite D-01 counts-only line
affects: [177-07]

actuals:
  tokens: 7490
  tasks: 3
  commits: 6
plan_head_before: 8176c92c9eab753b4e6b0eb5eb6c4f1a32c2b08a
plan_head_after: 79866bb19e9477aec305fe43ef39f3fabd99e393
commits: 6

tech-stack:
  added: []
  patterns:
    - "Resolve a member's price index inside _reconstruct_deribit, with the member's exact marks and its exchange still open, so a composite member has no prediction miss"
    - "A failure class joins the composite refusal tuple only when it is permanent; transient reads and store faults are left to the existing re-raise arm and filed unknown"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_nav_marks_composite.py
    - analytics-service/tests/test_nav_marks_composite_allocated.py

key-decisions:
  - "One shared helper (_member_moved_flow_index) serves the plain member and the allocated NAV twin, instead of two copies of the resolve, check and raise. The plan's acceptance grep for at least 3 resolve_moved_flow_prices( call sites reads 2 (the derive and the helper); both member kinds go through the helper."
  - "The D-01 line is emitted from one nested function (_log_member_flows_moved) called by the plain path (after _apply_member_marks, only when the hook ran) and the allocated path (beside its applied line), so the format literal exists once."
  - "The plain member's flow instants are valued AFTER its composed flows and day P&L, as before, because native_flow_instants' contract requires the density check to have passed first."

requirements-completed: [SC-1, SC-2]

coverage:
  - id: D1
    description: "A plain Deribit composite member counts a moved BTC deposit at the open of its containing candle with its exact marks: r(03-09) = 21.42 / 1071.0 where own-day pricing stored 19.62 / 1071.0"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite.py#test_deribit_member_moved_btc_flow_priced_at_the_instant_price"
        status: pass
    human_judgment: false
  - id: D2
    description: "An allocated composite member's NAV twin counts its moved BTC deposit at the candle open: r(03-07) = 10.0 / 1900.0 where own-day pricing stored 9.1 / 1900.0"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite_allocated.py#test_allocated_member_moved_btc_flow_priced_at_the_instant_price"
        status: pass
    human_judgment: false
  - id: D3
    description: "A structural no-data minute refuses the whole composite by name (permanent, nothing persisted, one chart call) for a plain and an allocated member"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite.py#test_deribit_member_moved_flow_no_data_refuses_the_composite"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite_allocated.py#test_allocated_member_moved_flow_no_data_refuses_the_composite"
        status: pass
    human_judgment: false
  - id: D4
    description: "A 429 stamps the member key once and returns transient; a transient read and a store fault re-raise, are filed unknown by classify_exception (never permanent), and persist nothing"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite.py#test_deribit_member_moved_flow_rate_limited_stamps_the_member_key"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite.py#test_deribit_member_moved_flow_transient_read_is_retryable"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite.py#test_deribit_member_moved_flow_store_fault_is_retryable"
        status: pass
    human_judgment: false
  - id: D5
    description: "Each Deribit composite member that applies marks logs one counts-only line, emitted at zero, with seq and counts only; a ccxt member never logs it"
    requirement: SC-1
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite.py#test_deribit_member_flows_moved_log"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_composite_allocated.py#test_allocated_member_flows_moved_log"
        status: pass
    human_judgment: false

duration: about 90min
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 06: stitch composites Summary

**Both composite Deribit member kinds (plain, and the allocated member's NAV twin) now count a moved INDEXED flow at the open of its containing candle, read with the member's exact marks while its exchange is open. A structural no-data minute refuses the whole composite by name; a 429, a transient read and a store fault keep the composite's existing arms; each Deribit member that applies marks logs one counts-only `deribit flows moved by marks` line.**

## Performance

- **Duration:** about 90 min (estimated; the start time was not captured)
- **Completed:** 2026-10-28
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 3 (0 created)

## Accomplishments

- Tracer (plain member): a 0.0004 BTC deposit at 00:05:20Z on 03-10 inside the 03-09 mark (NAV 1132.62) is counted at 0.0004 x 100500.0 = 40.2, so r(03-09) = 21.42 / 1071.0 (equal to the no-deposit `R_0309`). Own-day pricing stored 19.62 / 1071.0. The chart read happens before the member's exchange close (asserted on the chart's own event list), once, and the price is stored.
- Allocated member: the same fix on the NAV twin's instants. A 0.0002 BTC deposit at 00:05:20Z on 03-08 inside the 03-07 mark (NAV 1930.1) is counted at 20.1, so r(03-07) = 10.0 / 1900.0 (own-day: 9.1 / 1900.0), and r(03-06) stays -0.04.
- `_apply_member_marks` gained one optional keyword, `price_flows`, awaited with the member's exact marks after `relevant` is known and before `build_inputs` values the instants. Only the Deribit plain member passes it, so every ccxt member is byte-identical. `_apply_allocated_member_marks` gained `at_instant_index`, resolved in `_reconstruct_deribit` beside `_alloc_marks`.
- `_MemberFlowIndexUnavailable` (token `mark_flow_index_unavailable`) joins the Deribit member arm's refusal tuple, first, above every broader arm. No new arm exists for the other failures: a 429 reaches the member's `ccxt.RateLimitExceeded` arm (stamps the member key, transient); a `DeribitTransientReadError` or `FlowPriceStoreError` reaches the bare `except Exception` arm, which re-raises, and `classify_exception` files it `unknown` (retried).
- D-01: `run_stitch_composite_job: deribit flows moved by marks (seq=%d moved=%d at_instant=%d usd_family=%d on_last_mark=%d)`, INFO, emitted at zero, `seq` and counts only.

## Task Commits

1. **Task 1 RED:** `936be6736` (test) - harness options on `run_deribit_composite`, the plain-member oracle
2. **Task 1 GREEN:** `2557805c0` (feat) - hook, plain-member pricing, `_MemberFlowIndexUnavailable` and the arm tuple
3. **Task 2 RED:** `513f68d13` (test) - allocated harness options, the allocated oracle, five failure-arm tests
4. **Task 2 GREEN:** `920d5f632` (feat) - the shared helper, the allocated wiring
5. **Task 3 RED:** `03009f5c6` (test) - the plain and allocated log tests
6. **Task 3 GREEN:** `79866bb19` (feat) - the counts line

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `analytics-service/services/job_worker.py` - `_MemberFlowIndexUnavailable`, `_member_moved_flow_index`, `_log_member_flows_moved`, the `price_flows` and `at_instant_index` keywords, the arm tuple; imports `MarkReadAt`
- `analytics-service/tests/test_nav_marks_composite.py` - `run_deribit_composite` keywords (`ledgers`, `composed`, `charts`, `flow_prices`, `extra_patches`, `fake_sink`), the plain-member oracle, four failure-arm tests, the log test
- `analytics-service/tests/test_nav_marks_composite_allocated.py` - `run_allocated_composite` keywords (`twin_instants`, `ledger_marks`, `chart`, `flow_prices`), the allocated oracle, the no-data test, the log test

## Decisions Made

See key-decisions. Nothing under the phase CONTEXT's locked decisions changed.

## Deviations from Plan

**1. [Structure] One shared helper instead of two copies**
- **Found during:** Task 2 (writing the allocated wiring)
- **Issue:** the plain member's resolve, coverage check and two raises would have been repeated verbatim for the allocated twin.
- **Fix:** `_member_moved_flow_index(ctx, raw_instants, marks_in, indexable)` holds them once. The plan's acceptance grep `resolve_moved_flow_prices(` at least 3 therefore reads 2 (the derive and the helper); both member kinds are covered by the helper and by their own RED-first tests.
- **Files modified:** `analytics-service/services/job_worker.py`
- **Committed in:** `920d5f632`

**2. [Drill wording] D-N20b and D-N21b neuter the shared helper's call sites**
- D-N20b skips the check for the allocated member alone by replacing its helper call with a bare `resolve_moved_flow_prices(...).index` at the allocated call site. D-N21b edits the shared helper (so it hits both kinds); only the plain-member transient and store-fault tests are the ones that go RED, because those are the only tests of that disposition.

**3. [Rule 2 - coverage] Two extra tests and one extra drill**
- An allocated D-01 log test (`test_allocated_member_flows_moved_log`), which the plan's behavior section did not list, and a drill D-N21c for the 429 test (below).

**4. [Environment] One test in the full suite fails here, and it is not this plan's**
- See Verification.

**Total deviations:** 4 (1 structure, 1 drill wording, 1 added coverage, 1 environment). **Impact on plan:** none on behaviour or interfaces.

## RED evidence

- red1.log (Task 1, on plan 05's code): the oracle sees `0.018319327731092336` (19.62 / 1071.0) against `0.02 +/- 1e-12` (21.42 / 1071.0).
- red2.log (Task 2, on Task 1's code): `2 failed, 5 passed`. The allocated oracle sees `0.004789473684210478` (9.1 / 1900.0) against `0.005263157894736842` (10.0 / 1900.0); the allocated no-data test sees `DONE` where `FAILED` is expected. The plain member's no-data, 429, transient and store-fault tests passed on Task 1's code, so each is proved by a drill.
- red3.log (Task 3): `2 failed`, both on an empty list of `deribit flows moved by marks` lines.

## Neuter-and-see-RED drills (byte backups in `/tmp/deribitflows-06`, never git checkout/restore/stash)

| Drill | Neuter | RED line | Restore |
|---|---|---|---|
| D-N19 (`jw.bak`) | `_deribit_apply_inputs` drops `at_instant_index=` | oracle `0.018319327731092336 == 0.02 +/- 1e-12` (19.62 / 1071.0); `1 failed` | `cmp` exit 0 |
| D-N20 (`jw_green2.bak`) | allocated call passes `at_instant_index=None` | `FAILED test_allocated_member_moved_btc_flow_priced_at_the_instant_price`; `1 failed, 6 passed` | `cmp` exit 0 |
| D-N20b (`jw_green2.bak`, the plan's `jw4.bak`) | allocated call site skips the check and the raise | `FAILED test_allocated_member_moved_flow_no_data_refuses_the_composite` (`DONE` instead of `FAILED`); `1 failed, 6 passed` | `cmp` exit 0 |
| D-N21 (`jw_green2.bak`) | `_MemberFlowIndexUnavailable` removed from the arm's tuple | `FAILED` plain and allocated no-data tests; `2 failed, 5 passed` | `cmp` exit 0 |
| D-N21b (`jw_green2.bak`, the plan's `jw3.bak`) | helper catches `DeribitTransientReadError` and `FlowPriceStoreError` and raises `_MemberFlowIndexUnavailable` | `FAILED` the transient-read and the store-fault tests; `2 failed, 5 passed` | `cmp` exit 0 |
| D-N21c (`jw_green2.bak`) | helper catches `ccxt.RateLimitExceeded` and raises `_MemberFlowIndexUnavailable` | `FAILED test_deribit_member_moved_flow_rate_limited_stamps_the_member_key`; `1 failed, 4 passed` | `cmp` exit 0 |
| D-N22 (`jw3.bak`) | the counts line only when `moved > 0` | `FAILED` plain and allocated log tests (the `moved=0` line missing); `2 failed, 37 deselected` | `cmp` exit 0 |

## Verification

- `tests/test_nav_marks_composite.py`, `tests/test_nav_marks_composite_allocated.py`, `tests/test_stitch_composite_job.py`: `141 passed`. `-k moved`: `7 passed`. `-k flows_moved_log`: `2 passed`.
- Full suite with CI's coverage flags (serial; pytest-xdist is not installed here): `1 failed, 13469 passed, 102 skipped` in 333 s, coverage `Required test coverage of 80% reached. Total coverage: 94.50%`.
- **The one failure is `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`.** It spawns a pytest run with `-n --dist` and fails with `unrecognized arguments: -n --dist`, because `xdist` is not installed in this interpreter (`ModuleNotFoundError: No module named 'xdist'`) and the plan forbids installing it. It touches none of this plan's files. CI installs xdist, so the failure is environmental; it was not run against the plan base, so "pre-existing here" rests on that reading and not on a base run.
- Skips: 102 in this run. This plan added none (`git diff` of the plan's range holds no `skip`, `skipif` or `pytest.skip`). The PLAN_BASE run's skip count was not measured, because that needs a second 6-minute suite run; plan 05 measured 10 skips in a narrower name-matched set, which is not comparable.
- CI's mypy line from `analytics-service/`: `Success: no issues found in 129 source files`.
- Acceptance greps: `class _MemberFlowIndexUnavailable` is 1; the exact D-01 format literal is 1; `_MemberFlowIndexUnavailable)` is 1; `resolve_moved_flow_prices(` is 2 (see deviation 1).
- No Deribit, PROD, TEST or Railway access: every chart call is scripted.

## Known limits

- A minute with no candle refuses the composite on every run, indefinitely (plan 04's accepted limit, RESEARCH Open Question 8), for both member kinds.
- The allocated member's prices are read for its in-mandate-window marks only (the marks `_apply_allocated_member_marks` applies), so unlike the allocated derive there is no extra read for an out-of-window flow.
- A composite log line is emitted per stitch, so a retry logs again; `moved` is cumulative over the member's mark history and `on_last_mark` is the nightly increment.

## Issues Encountered

None beyond the deviations above.

## Known Stubs

None. No placeholder, hardcoded empty value flowing to a UI, or unwired data source was introduced.

## Threat Flags

None. No new network endpoint, auth path, file access or schema change. T-177-23 and T-177-24 are mitigated as the register states (D-N19, D-N20, D-N20b, D-N21). T-177-25 is mitigated by the 429 test and D-N21c. T-177-32 is mitigated by the transient-read and store-fault tests and D-N21b. T-177-26 is mitigated: the line carries `seq` and counts only, and the log tests assert no key id in it.

## Next Phase Readiness

- Plan 07 owns the census rows; this plan added no SQL file, no test module and no `ci.yml` change.
- After the next nightly composite stitches, the real moved counts per member can be read off the new `run_stitch_composite_job: deribit flows moved by marks` lines (orchestrator step, counts only).

## Self-Check: PASSED

`job_worker.py` and the two test files exist; commits `936be6736`, `2557805c0`, `513f68d13`, `920d5f632`, `03009f5c6`, `79866bb19` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD is 6 and the working tree held nothing else uncommitted.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
