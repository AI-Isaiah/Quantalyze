---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 01
subsystem: analytics-service
tags: [deribit, nav-marks, apply-marks, flow-instants, tradingview-chart, ccxt]

requires:
  - phase: 167.2.1.1.1 NAVMTM
    provides: apply_marks rule 10 (flow instants placed against a mark's read), FlowInstant, write-once marks
  - phase: MARKSOURCE plan 03
    provides: FlowInstant.amount_prior_day and the moved-in / moved-out split in apply_marks
provides:
  - placed_flow_instants, the one rule-10 predicate shared by apply_marks, the prefetch and the coverage check
  - native_flow_instants(at_instant_index=...) valuation keyword
  - fetch_deribit_perp_minute_prices, DeribitChartNoDataError, perp_minute_instrument, price_for_minute
  - services/deribit_flow_prices.py (wanted_moved_flows, resolve_moved_flow_prices, unpriced_moved_flows)
  - key-mode Deribit derive that counts a moved BTC deposit at the open of its 1-minute perpetual candle
affects: [177-02, 177-03, 177-04, 177-05, 177-06, 177-07]

actuals:
  tokens: 10000
  tasks: 2
  commits: 4
plan_head_before: 9b932ab4c1e505d7b124cf86f2a7dde4a6c69337
plan_head_after: 57e4811fc564815b3ded894625ff72c2cabb7b3a
commits: 4

tech-stack:
  added: []
  patterns:
    - "Prefetch against predicted marks while the exchange is open, then a coverage check on the final marks at the apply seam"
    - "A reader that raises a named structural error instead of returning an empty map (D-05)"

key-files:
  created:
    - analytics-service/services/deribit_flow_prices.py
  modified:
    - analytics-service/services/nav_marks_apply.py
    - analytics-service/services/native_nav.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/external_flows.py
    - analytics-service/tests/test_nav_marks_compose_roundtrip.py
    - analytics-service/tests/test_deribit_ingest.py
    - analytics-service/tests/test_nav_marks_apply.py
    - analytics-service/tests/test_nav_marks_flow_instants.py

key-decisions:
  - "MovedFlowPrices is a frozen dataclass, not the NamedTuple the plan named: a NamedTuple field called index shadows tuple.index and mypy --strict rejects it. Field names and positional construction are unchanged."
  - "The price is attached as FlowInstant.amount_prior_day inside native_flow_instants (the single choke point), keyed (CCY, at_ms); amount stays the own-day ledger mark."
  - "The tracer's prefetch bound is the fixed _BROKER_CRAWL_TIMEOUT_S, as the plan specified; plan 04 replaces it with the derive's remaining budget minus _DERIVE_POST_CRAWL_RESERVE_S."

requirements-completed: [SC-2]

coverage:
  - id: D1
    description: "A key-mode Deribit derive counts a moved BTC deposit at the open of the 1-minute BTC_USDC-PERPETUAL candle containing it, read before the exchange closes; stored return 22.92 / 1171.0 where the old code stored 22.42 / 1171.0"
    requirement: SC-2
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_deribit_moved_btc_flow_priced_at_the_instant_price"
        status: pass
    human_judgment: false
  - id: D2
    description: "The minute reader's D-05 vocabulary: named structural error, shared transient retry budget, last-attempt 429 re-raised, containing-minute selection"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_ingest.py -k minute_prices (16 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One rule-10 predicate shared by apply_marks and the prefetch, pinned by a parity test; the valuation keyword prices only a moved INDEXED instant"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_nav_marks_apply.py#test_placed_flow_instants_is_what_apply_marks_moves"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_nav_marks_flow_instants.py#test_at_instant_index_prices_only_a_moved_indexed_instant"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 01: Deribit moved flows priced at the instant Summary

**A key-mode Deribit derive now counts a moved BTC deposit at the open of its 1-minute BTC_USDC-PERPETUAL candle, read on the derive's own exchange before it closes, and refuses transiently when a moved INDEXED flow has no such price.**

## Performance

- **Duration:** about 45 min (estimated; the start time was not captured)
- **Completed:** 2026-10-28
- **Tasks:** 2 (one tracer, one auto)
- **Files modified:** 10 (1 created)

## Accomplishments

- The tracer test `test_deribit_moved_btc_flow_priced_at_the_instant_price` was seen RED on the unchanged tree with the own-day value and is GREEN: 0.0005 BTC at 00:05:20Z on 03-11, candle open 101000.0, own-day mark 102000.0, stored r(03-10) = 22.92 / 1171.0 (old code 22.42 / 1171.0). The stored composed flows hold 03-10 = 50.5 and 03-11 nets to 0.0, and the compose reproduces every mark.
- `placed_flow_instants` is the single statement of rule 10. `apply_marks`, `wanted_moved_flows` and `unpriced_moved_flows` all call it; a parity test pins it to what `apply_marks` moves (instant before, exactly at, 1 ms after the read, another day, and a mark with no read).
- `fetch_deribit_perp_minute_prices` never answers a structural case with an empty map: BadSymbol, `status == no_data`, NaN, inf, zero, negative, string and None opens, a bad tick and a repeated tick all raise `DeribitChartNoDataError`. A transient read or flaky 200 shares one 8-attempt, 1 s doubling budget and then raises `DeribitTransientReadError`; a 429 on the last attempt is re-raised as `ccxt.RateLimitExceeded`.
- The key-mode apply seam runs `unpriced_moved_flows` on the FINAL marks after the mark write and before any series write, and returns FAILED with `error_kind="transient"` and a counts-only message instead of falling back to the own-day amount.
- The three sibling chart readers and `_validate_chart_ok_arrays` are untouched: the diff of `deribit_ingest.py` against the plan base removes 0 lines.

## Task Commits

1. **Task 1 (tracer), RED:** `8891ffb89` (test) - the oracle and the harness keywords (`ledger_marks`, `chart`)
2. **Task 1 (tracer), GREEN:** `4dfb0c0bf` (feat) - predicate, valuation keyword, reader, new module, key-mode wiring
3. **Task 2, RED:** `d80cf9187` (test) - reader vocabulary, candle table, predicate parity, keyword
4. **Task 2, GREEN:** `57e4811fc` (feat) - last-attempt 429 re-raise and the `FlowInstant` docstring

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `analytics-service/services/deribit_flow_prices.py` - `MarkReadAt`, `MovedFlowPrices`, `UnpricedMoves`, `wanted_moved_flows`, `resolve_moved_flow_prices` (one request per currency and read day, zero requests when nothing is wanted), `unpriced_moved_flows`
- `analytics-service/services/deribit_ingest.py` - the minute reader and its helpers, additions only
- `analytics-service/services/nav_marks_apply.py` - `placed_flow_instants`, called from rule 10; arithmetic unchanged
- `analytics-service/services/native_nav.py` - `native_flow_instants(..., at_instant_index=None)`
- `analytics-service/services/job_worker.py` - `_moved_flow_prices`, the prefetch in the Deribit branch, the coverage check and the keyword at the key-mode writer-basis site
- `analytics-service/services/external_flows.py` - `FlowInstant` docstring only
- tests: `test_nav_marks_compose_roundtrip.py` (`_ScriptedChart`, the oracle), `test_deribit_ingest.py` (16 `minute_prices` tests), `test_nav_marks_apply.py`, `test_nav_marks_flow_instants.py`

## Decisions Made

- The price is the perpetual's traded price (candle open), and no code, log or docstring calls it the index (D-04).
- `amount` stays qty x the own-day ledger mark (what leaves the read day); `amount_prior_day` is qty x candle open (what is counted in the mark day).
- The prefetch reads only when a raw instant of the ledger or its NAV twin classifies INDEXED, so a derive with no BTC-style flow makes no extra `read_key_marks` call and no chart request.
- Only the key-mode writer-basis `native_flow_instants` call is wired here. The allocated twin branch, the strategy-mode Deribit branch and the two composite member closures are plans 05 and 06.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `MovedFlowPrices` as a frozen dataclass instead of a NamedTuple**
- **Found during:** Task 1 (mypy gate)
- **Issue:** a `NamedTuple` field named `index` overrides `tuple.index`; `mypy --strict` reports `Incompatible types in assignment`.
- **Fix:** `@dataclass(frozen=True)` with the same two fields (`index`, `no_data`) and the same positional construction, so `_moved_flow_prices.index` and `MovedFlowPrices({}, frozenset())` read exactly as the plan wrote them. Later plans can import it unchanged.
- **Files modified:** `analytics-service/services/deribit_flow_prices.py`
- **Verification:** mypy clean, tracer GREEN
- **Committed in:** `4dfb0c0bf`

**2. [Rule 2 - Missing critical] Reject boolean ticks/opens and `OverflowError` in the minute reader**
- **Found during:** Task 1 (writing the parse loop against threat T-177-01)
- **Issue:** `float(True)` is 1.0 and `int(float("inf"))` raises `OverflowError`; both would have slipped past a `(TypeError, ValueError)` catch.
- **Fix:** an explicit `bool` rejection and `OverflowError` in the except tuple, both raising `DeribitChartNoDataError`.
- **Committed in:** `4dfb0c0bf`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical). **Impact on plan:** none on behaviour or interfaces.

## Neuter-and-see-RED drills (byte backups in the scratch dir, never git checkout/restore/stash)

| Drill | Neuter | RED line | Restore |
|---|---|---|---|
| RED-1 (red1.log) | the unchanged tree | `Obtained: 0.019146029035012873` (22.42 / 1171.0) vs expected 0.019573014517506405 (22.92 / 1171.0) | n/a (commit `8891ffb89`) |
| D-N1 | `at_instant_index=None` at the key-mode site (`jw.bak`) | `assert 0.019146029035012873 == 0.019573014517506405 ± 1.0e-12`, the own-day value | `cmp` exit 0 |
| D-N2 | look up the minute before the containing one (`dfp.bak`) | `Obtained: 0.019615713065755824` (22.97 / 1171.0) | `cmp` exit 0 |
| RED-2 (red2.log) | Task 1 code, tests first | `FAILED test_minute_prices_last_attempt_rate_limit_is_reraised`, `1 failed, 15 passed` | n/a (commit `d80cf9187`) |
| D-N3 | remove the 429 re-raise (`di.bak`) | `FAILED test_minute_prices_last_attempt_rate_limit_is_reraised` | `cmp` exit 0 |
| D-N4 | `price_for_minute` falls back to the nearest earlier tick (`dfp2.bak`) | `FAILED test_minute_prices_candle_selection_table` | `cmp` exit 0 |

## Verification

- Base quick suite (before any change): `120 passed`. After Task 1: `121 passed` (base plus the new test, none removed or skipped).
- Task 2 verify: `-k minute_prices` -> `16 passed`; `test_deribit_ingest.py`, `test_nav_marks_apply.py`, `test_nav_marks_flow_instants.py`, `test_nav_marks_compose_roundtrip.py` -> `224 passed`.
- Wider Deribit / NAV-marks / native / flow files (65 test files by name match): `2271 passed, 6 skipped`; the 6 skips are pre-existing and none was added by this plan.
- CI's mypy line from `analytics-service/`: `Success: no issues found in 128 source files` (127 at plan time plus the new module).
- No Deribit, PROD, TEST or Railway access: every chart call in the tests is scripted.

## Issues Encountered

None beyond the two deviations above.

## Known Stubs

None. No placeholder, hardcoded empty value flowing to a UI, or unwired data source was introduced.

## Threat Flags

None. The new outbound call is a public, unauthenticated read against the venue the derive already talks to; no new endpoint, auth path, file access or schema change was added. T-177-01..05 are mitigated as the plan's register states (strict parse, coverage check, bounded wait, one request per group, counts-only text).

## Next Phase Readiness

- Plan 04 replaces the tracer's propagate-on-failure prefetch with the capture that keeps the day's mark, splits the refusal, stamps `_stamp_429` and swaps the fixed `_BROKER_CRAWL_TIMEOUT_S` bound for the derive's remaining budget.
- Plans 05 and 06 wire the remaining `native_flow_instants` call sites (allocated twin, strategy-mode Deribit, composite member closures). They can import `MovedFlowPrices`, `resolve_moved_flow_prices` and `unpriced_moved_flows` as written.
- Plan 03's store arguments extend `resolve_moved_flow_prices` and `unpriced_moved_flows`; their current signatures are the no-store forms.

## Self-Check: PASSED

All created and modified files exist; commits `8891ffb89`, `4dfb0c0bf`, `d80cf9187`, `57e4811fc` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD is 4.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
