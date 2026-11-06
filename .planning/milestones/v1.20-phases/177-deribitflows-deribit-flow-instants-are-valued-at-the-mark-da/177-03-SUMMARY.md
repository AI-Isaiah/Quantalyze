---
phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da
plan: 03
subsystem: analytics-service
tags: [deribit, flow-prices, write-once, postgrest, nav-marks, store]

requires:
  - phase: 177-01
    provides: resolve_moved_flow_prices, MovedFlowPrices, the 1-minute candle reader, the harness parameters of derive_deribit_key, _ScriptedChart
  - phase: 177-02
    provides: public.api_key_flow_prices (service-role only, write-once by grant, four CHECKs, cascade erasure)
provides:
  - services/flow_price_store.py (FLOW_PRICES_TABLE, FLOW_PRICE_SOURCE, FLOW_PRICES_CHUNK, FlowPriceStoreError, read_flow_prices, write_flow_prices)
  - resolve_moved_flow_prices that reads stored prices first, asks the venue only for missing minutes and builds the index from re-selected stored rows
  - FlowPricesTable (the in-memory mirror of the table) and route_flow_prices for derive harnesses
  - a live PostgREST probe of the list upsert, the chunked in_ read and the service_role UPDATE refusal
affects: [177-04, 177-05, 177-06, 177-07]

actuals:
  tokens: 12800
  tasks: 2
  commits: 3
plan_head_before: e724a4b28ef30619db060e07777ca6cb77bc5485
plan_head_after: 8c90f2d5295ea2ef6a61f6b9dd95330692b8c0bb
commits: 3

tech-stack:
  added: []
  patterns:
    - "A write-once list upsert (ON CONFLICT DO NOTHING) followed by a re-select, so the stored row and never the local read feeds money math"
    - "Reads chunked at 100 minutes per request, an order of magnitude under PostgREST's silent max_rows clamp"
    - "An in-memory table mirror with a hook that fires a concurrent writer between a read and a write"

key-files:
  created:
    - analytics-service/services/flow_price_store.py
    - analytics-service/tests/test_flow_price_store.py
    - analytics-service/tests/test_flow_price_store_live.py
  modified:
    - analytics-service/services/deribit_flow_prices.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_nav_marks_compose_roundtrip.py

key-decisions:
  - "A price is written before the apply, not after it: a price read correctly is a permanent fact, so it stays even if the derive later refuses for an unrelated reason and a retry costs no second chart request."
  - "A store fault (FlowPriceStoreError, including the table being absent because the worker deployed before the migration applied) propagates out of the crawl to the existing transient handling in this plan; plan 04 turns it into the named store_fault capture."
  - "The mirror gained an after_first_read hook, so a concurrent writer winning the race is a derive-level test (and drill D-N8 bites on it) and not only a unit test of the store module."

requirements-completed: [SC-3]

coverage:
  - id: D1
    description: "A moved Deribit flow's price is read from the venue once, written once, and every later derive reads it back from the stored row: the second derive of the same moved BTC deposit makes zero chart requests and stores the same 22.92 / 1171.0"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_flow_price_store_second_derive_reads_no_chart"
        status: pass
    human_judgment: false
  - id: D2
    description: "The stored row is the authority: a pre-seeded price (101200.0) wins over the chart (101000.0) giving 22.82 / 1171.0, only missing minutes go to the venue, and a concurrent writer that stores first wins the race"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_flow_price_store_seeded_price_wins_over_the_chart"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_flow_price_store_only_missing_minutes_are_read"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_flow_price_store_a_concurrent_writer_wins_the_race"
        status: pass
    human_judgment: false
  - id: D3
    description: "The store reads in chunks of at most 100 minutes, parses every stored row strictly, raises FlowPriceStoreError with static text and makes zero calls on empty input; a derive that moves no indexed flow touches neither the store nor the chart"
    requirement: SC-3
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_flow_price_store.py -k flow_price_store (20 tests)"
        status: pass
      - kind: integration
        ref: "analytics-service/tests/test_nav_marks_compose_roundtrip.py#test_flow_price_store_no_moved_indexed_flow_touches_nothing"
        status: pass
    human_judgment: false
  - id: D4
    description: "The PostgREST forms the store depends on (list upsert with a three-column on_conflict and ignore_duplicates, chunked in_ read, service_role UPDATE refused with 42501) behave as the store assumes on a real PostgREST"
    requirement: SC-3
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_flow_price_store_live.py (4 passed on a throwaway local-stack lane; skipped locally elsewhere, run by CI's python job)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-10-28
status: complete
---

# Phase 177 Plan 03: the moved-flow price store, worker half Summary

**A moved Deribit flow's price is read from the venue once, written once to `api_key_flow_prices` write-once, and read back from the stored row on every later derive with no chart request; the stored row, never the local read, is what the index is built from.**

## Performance

- **Duration:** about 55 min (estimated; the start time was not captured)
- **Completed:** 2026-10-28
- **Tasks:** 2 (one tracer, one auto)
- **Files modified:** 6 (3 created)

## Accomplishments

- Tracer: `test_flow_price_store_second_derive_reads_no_chart` was seen RED on plan 01's code and is GREEN. The plan 01 scenario (0.0005 BTC at 00:05:20Z, candle open 101000.0) is derived twice over one store: the first derive reads three candles and stores exactly one row (the 00:05 open, source `deribit_perp_1m_open`), the second runs with an EMPTY chart script and stores the same `22.92 / 1171.0`, with zero chart calls and zero upserts. Every recorded upsert used `on_conflict == "api_key_id,instrument,minute_ms"` and `ignore_duplicates is True`.
- The stored row is the authority, proven three ways: a pre-seeded 101200.0 beats the chart's 101000.0 (`22.82 / 1171.0`, chart never called); with one of two moved minutes stored only the other is read (one chart call, the store gains exactly the 00:05 row, `22.92 / 1171.0`); and a concurrent derive that stores 101200.0 between this derive's read and write wins the race (this derive read 101000.0, its insert loses, the re-select hands back 101200.0).
- `flow_price_store.py`: reads go per instrument in sorted chunks of at most 100 minutes, so a response can never reach PostgREST's 1000-row clamp unnoticed; more rows than asked, a repeated minute, and any row that is malformed, non-finite, non-positive, out of chunk, of another instrument or of another source raise `FlowPriceStoreError` with static text. Writes are list upserts in chunks of 100 followed by a re-select that must return every key.
- Live PostgREST probe: the four probes passed against the throwaway local-stack lane (plan 02's migration replayed on boot): the list upsert keeps the first price and returns it to the loser, 120 minutes cross the chunk boundary and come back whole (two upserts, two reads), and a `service_role` UPDATE is refused with `42501` with the price unchanged. With `ignore_duplicates=False` the same probe goes RED (three live failures), so it can fail.

## Task Commits

1. **Task 1 (tracer), RED:** `4c95f1382` (test) - `FlowPricesTable`, `route_flow_prices`, the harness routing and the second-derive roundtrip
2. **Task 1 (tracer), GREEN:** `b3f90ef08` (feat) - the store module, the resolution wiring, the key-mode call site
3. **Task 2:** `8c90f2d52` (test) - the unit suite, three more roundtrips plus the race test, the live probe

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `analytics-service/services/flow_price_store.py` - the table's whole read and write path (sync; callers wrap it in `db_execute`)
- `analytics-service/services/deribit_flow_prices.py` - `resolve_moved_flow_prices(exchange, supabase, api_key_id, flow_instants, marks, indexable_currencies, *, sleep)`: wanted instants, stored read, venue read of missing groups only, one write-once write, index built from stored rows. Nothing wanted returns at once with no store or chart call. `unpriced_moved_flows` is unchanged.
- `analytics-service/services/job_worker.py` - two arguments at the one call site (`ctx.supabase`, `ctx.key_row["id"]`, the key row and never the job payload)
- `analytics-service/tests/test_flow_price_store.py` - the mirror, `route_flow_prices`, `client_for` and 20 unit tests (the file's `-k flow_price_store` selection)
- `analytics-service/tests/test_flow_price_store_live.py` - the live probe (3 writing probes behind the loopback guard, plus the guard's own test)
- `analytics-service/tests/test_nav_marks_compose_roundtrip.py` - `derive_deribit_key(flow_prices=...)` always routes the store and patches `services.deribit_flow_prices.db_execute`; five new roundtrips

## Decisions Made

- The write happens before the apply (see key-decisions), and a transient or 429 error raises before any write, so a failed derive writes nothing partial.
- This plan does not turn `FlowPriceStoreError` into a named capture: it propagates to the existing transient handling. Plan 04 owns `store_fault`.

## Deviations from Plan

**1. [Rule 1 - plan text] The RED run failed on the first derive's store assertion, not on the second derive's chart call**
- **Found during:** Task 1 RED
- **Issue:** the plan expected red1.log to fail "because the second derive calls the chart". On plan 01's code the store is never written, so the test failed earlier, on the assertion that the first derive stored one row (`assert {} == {('key-drb', ...101000.0, ...}}`). That is the same missing behaviour seen one step sooner; the second-derive chart call is what drill D-N5 proves.
- **Files modified:** none

**2. [Rule 1 - plan text] Drill D-N6 reddens the write-once unit test and the second-derive roundtrip, not `seeded_price_wins`**
- **Found during:** Task 2 drills
- **Issue:** the plan named `test_flow_price_store_seeded_price_wins_over_the_chart` for D-N6. That scenario never writes (the minute is stored, so nothing is fetched), so dropping `ignore_duplicates=True` cannot affect it. The seeded test is reddened by D-N5 instead (4 failures including it).
- **Fix:** none needed in code. The write path's conflict behaviour under a race is pinned by a derive-level test the plan did not list, `test_flow_price_store_a_concurrent_writer_wins_the_race`, which drill D-N8 reddens.
- **Committed in:** `8c90f2d52`

**3. [Rule 2 - missing critical] A hook in the mirror and one extra roundtrip**
- **Found during:** Task 2 (drill D-N8)
- **Issue:** index-from-local-read versus index-from-re-selected-row differ only when a concurrent writer stored another price, which no listed test produced, so D-N8 as planned could not be seen RED at derive level.
- **Fix:** `FlowPricesTable.after_first_read` plus `test_flow_price_store_a_concurrent_writer_wins_the_race`.
- **Files modified:** `analytics-service/tests/test_flow_price_store.py`, `analytics-service/tests/test_nav_marks_compose_roundtrip.py`
- **Committed in:** `8c90f2d52`

**Total deviations:** 3 (2 plan-text mismatches, 1 missing coverage). **Impact on plan:** none on behaviour or interfaces.

## Neuter-and-see-RED drills (byte backups in the scratch dir, never git checkout/restore/stash)

| Drill | Neuter | RED line | Restore |
|---|---|---|---|
| RED-1 (red1.log) | plan 01's code, tests first | `AssertionError: assert {} == {('key-drb', ...101000.0, ...}}` on `test_flow_price_store_second_derive_reads_no_chart`; `1 failed, 1 passed` | n/a (commit `4c95f1382`) |
| D-N5 (`dfp.bak`) | treat `stored` as empty in `resolve_moved_flow_prices` | the second derive's chart call: `assert <DispatchOutcome.FAILED> == <DispatchOutcome.DONE>` (unpriced=1); across the module `4 failed, 49 passed` (second-derive, seeded-wins, only-missing, race) | `cmp` exit 0 |
| D-N6 (`fps.bak`) | `ignore_duplicates=False` in `write_flow_prices` | `FAILED test_flow_price_store_write_once_returns_the_stored_price_not_the_local_read` and `FAILED test_flow_price_store_second_derive_reads_no_chart`; `2 failed, 50 passed` | `cmp` exit 0 |
| D-N7 (`fps2.bak`) | the strict parse `continue`s past a bad row | 12 failures, every case of `test_flow_price_store_a_malformed_stored_row_raises_and_is_never_skipped` | `cmp` exit 0 |
| D-N8 (`dfp2.bak`) | index built from the locally read prices | `FAILED test_flow_price_store_a_concurrent_writer_wins_the_race`; `1 failed, 52 passed` | `cmp` exit 0 |
| D-N6 live (`fps3.bak`) | `ignore_duplicates=False`, against the lane | three live probes fail with `FlowPriceStoreError: api_key_flow_prices: insert failed`; `3 failed, 1 passed` | `cmp` exit 0, live `4 passed` after |

## Verification

- Base quick suite (before any change): `123 passed` over the five NAV-marks modules.
- Task 2 verify: `test_flow_price_store.py`, `test_flow_price_store_live.py`, `test_nav_marks_compose_roundtrip.py`, `test_nav_marks_flow_instants.py`, `test_nav_marks_apply.py`, `test_nav_marks_derive_apply.py`, `test_nav_marks_composite.py` -> `149 passed, 3 skipped`; `-k flow_price_store` selects 20 unit tests, all pass.
- The 3 skips are the three writing live probes, skipped locally because `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_KEY` are unset in an ordinary shell (reported by `-rs`: `local-stack lane not configured (local dev)`). The probe module RAN with the lane exported and passed: `4 passed`. CI's `python` job runs it on its private lane and `pytest.fail`s if the two variables are unset.
- Wider Deribit / NAV-marks / native / MTM / flow / job-worker files (name match): `1712 passed, 7 skipped`; the skips are pre-existing.
- CI's mypy line from `analytics-service/`: `Success: no issues found in 129 source files` (128 after plan 01 plus the new module).
- Local-stack lane: no foreign `supabase_` container was running, so this run booted the lane (`run.sh up`: baseline loaded, plan 02's migration replayed on top, ledger row written), asserted the loopback handoff (`values not printed`), ran the probe and brought it down (`down complete`, no container left). No PROD, TEST, Railway or Deribit access; every chart call is scripted.

## Issues Encountered

None beyond the deviations above. A zsh note for the next executor: an unquoted `$VAR` holding several paths is not word-split, which made one drill run select zero tests; the drills were re-run with explicit paths.

## Known Stubs

None. No placeholder, hardcoded empty value flowing to a UI, or unwired data source was introduced.

## Threat Flags

None. The only new outbound surface is PostgREST access to a table plan 02 created and reviewed; T-177-11..15 are mitigated as the register states (write-once with a re-select and index from stored rows: unit test, seeded test, race test, drills D-N6 and D-N8; strict parse: D-N7; chunk of 100 and a more-rows-than-asked refusal; static error text asserted against the literals used; loopback guard on every writing probe).

## Next Phase Readiness

- Plan 04 turns `FlowPriceStoreError` (and the absent-table case) into the named `store_fault` capture that keeps the day's mark, and adds the other closed reasons. It extends the call site that this plan already feeds with `ctx.supabase` and the key row id.
- Plans 05 and 06 wire the remaining `native_flow_instants` sites; `resolve_moved_flow_prices` already takes the store arguments, so they pass `supabase` and the key id they hold. Any harness that reaches the store must route `FlowPricesTable` (a MagicMock table returns an empty read and then ends in "no row after insert").
- Plan 07 owns the census rows; this plan added one test module and one live probe module under `analytics-service/tests`, no SQL file and no `ci.yml` change.

## Self-Check: PASSED

All created and modified files exist, and commits `4c95f1382`, `b3f90ef08` and `8c90f2d52` are ancestors of HEAD; `git rev-list --count` from the recorded plan base to HEAD is 3.

---
*Phase: 177-deribitflows-deribit-flow-instants-are-valued-at-the-mark-da*
*Completed: 2026-10-28*
