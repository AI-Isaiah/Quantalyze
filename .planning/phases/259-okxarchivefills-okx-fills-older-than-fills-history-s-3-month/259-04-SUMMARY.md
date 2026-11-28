---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 04
subsystem: analytics-service / OKX archive fills mapper
tags: [okx, archive, fills, mapper, reconcile, pure-module, mypy]

requires:
  - phase: 259-01
    provides: "`_normalize_okx_fill`, the shared per-fill OKX normaliser"
  - phase: 259-02
    provides: "ArchiveRow raw trade cells, fills fixtures, `EXPECTED_ROWS` / `stored_row` oracle"
provides:
  - "`okx_archive_fills_map.map_trade_bills`: archive trade bills -> stored-fill rows through the live helper, with six named stop classes"
  - "`archive_census`, `parse_stored_fill`, `reconcile_window` (by value), `legacy_subset` (never raises)"
affects: [259-05, 259-06, 259-07, 259-08]

status: complete
commits: 3
plan_head_before: b9431f8b3f91535187b3da015aac427642464634
plan_head_after: 1af397693e3ddfe4d6e4449e35b7e92f9e5f0b0d

actuals:
  tokens: 10400       # chars/4 over the two new files (41780 chars)
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one normaliser for two sources: the mapper rebuilds the fills-history object and calls the live helper"
    - "judge every bill, then raise the first class in a fixed precedence with per-class counts"
    - "Decimal and parsed-instant comparison against PostgREST-shaped stored rows"

key-files:
  created:
    - analytics-service/services/okx_archive_fills_map.py
    - analytics-service/tests/test_okx_archive_fills_map.py
  modified: []

key-decisions:
  - "The cell checks (tradeId digits, px and sz plain positive decimals inside the helper's own length and magnitude bounds, fillTime digits when the ts column is fillTime) run BEFORE the helper, so the helper's log lines, which quote the offending value, are not reached by a cell the mapper can already name. A None from the helper is still `unreadable_trade_bill`."
  - "The synthesized fills-history dict carries only fills-history keys (no billId or subType, which the plan's list had). With `EXCHANGE_STORE_RAW_DATA=1` the full dict is stored, and extra archive-only keys would make an archive row differ from a live row of the same trade."
  - "`shape` in a refusal detail: for `unproven_inst_type` it is the string `<instType label>/<settle label>` (labels pass `[0-9A-Za-z_-]{1,16}` else `(malformed)`); for `unreadable_trade_bill` it is `_bill_id_shape` of a non-blank tradeId that is not plain digits; otherwise None."
  - "Reconcile miss field precedence: stored_unreadable, stored_duplicate, absent_in_archive, absent_in_stored, count, symbol, side, price, quantity, fee, fee_currency, timestamp. `misses_by_field` tallies every field, the detail `field` is the first present. `count` is reachable when the archive side repeats a tradeId."
  - "`legacy_subset` names the FIRST differing field of each unequal row in `unequal_by_field`; `reconcile_window` tallies every differing field."

requirements-completed: [SC-1, SC-2]

coverage:
  - id: D1
    description: "A fixture archive bill maps through the live helper to its hand-typed expected row; the row also equals the helper's own output for a hand-built fills-history dict plus `source`"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_map.py::test_map_one_fixture_bill_equals_expected_row"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_map.py::test_mapped_row_equals_live_helper_row"
        status: pass
  - id: D2
    description: "All six subTypes map as CONTEXT states; every unproven shape is refused by a named class with value-free detail"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_map.py::test_map_subtype_sides"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_map.py::test_exception_detail_is_value_free"
        status: pass
  - id: D3
    description: "Window reconcile proves value equality on every SC-2 field plus timestamp, names the first failing field and both timestamp columns"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_map.py::test_reconcile_equal_by_value"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_map.py::test_reconcile_miss_timestamp_names_both_columns"
        status: pass
---

# Phase 259 Plan 04: Archive fills mapper and reconcile Summary

`services/okx_archive_fills_map.py` maps each OKX archive trade bill to the stored row the live `fills-history` read would store (by calling the same `_normalize_okx_fill`), refuses every shape no real file has proven by a named class, and reconciles mapped fills against stored fills by value. It is pure: no network, no database, no clock, no import of `okx_archive_job` or `job_worker`.

## What was built

- **`map_trade_bills(files)`**: unique bills (first file wins per billId); trade-shaped means subType 1-6 or a non-blank tradeId. Each is judged in the order unproven instType or settle (SWAP and USDT only), unmapped subType, unreadable cells, unknown contract size. All bills are judged before anything is raised, so `detail.classes` counts every class present; the raised class is the first of those four, then `duplicate_trade_id` (checked after mapping). Output is ordered `(row_ms, trade_id)`, and `raw_data["source"]` is set after the factory returns. `ARCHIVE_TS_COLUMN = "ts"` is the one switch if a real reconcile shows `fillTime` is the stored instant.
- **`archive_census(files)`**: never raises; counts by instType and subType, trade bills, readable trade cells, and value-free tradeId shapes (at most 10 distinct, rest under `(more)`).
- **`parse_stored_fill`, `reconcile_window`, `legacy_subset`**: PostgREST floats, padded quantity text and `.123+00:00` timestamps are read as `Decimal` and parsed instants. The reconcile reports `ts_match` and `fill_time_match` at millisecond precision.
- **Exceptions**: `FillsMapError` text is the class alone; detail is counts, a UTC day, closed field names and shape tokens.

## Verification (measured)

- `pytest tests/test_okx_archive_fills_map.py`: 49 passed. With `test_okx_archive_fills_parse.py` and `test_okx_normalize_fill_golden.py`: 84 passed.
- `make typecheck` (mypy strict): no issues in 148 source files.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 8 claims.
- `grep -nE "^(from|import) services\.(okx_archive_job|job_worker)"` on the module prints nothing.
- Local neuters (byte backup in scratch, restored with `cp`, proven with `cmp`; plan 08 does the formal version):
  - contract-size prefix check skipped (N4): `test_refuse_unknown_contract_size` RED.
  - duplicate-tradeId check skipped (N7): `test_refuse_duplicate_trade_id` RED.
  - quantity comparison dropped (N8): `test_reconcile_miss_quantity` RED.
  - trade-cell pre-check skipped (N33): `test_refuse_unreadable_trade_bill[blank_trade_id]`, `[nondigit_trade_id]` and `[exponent_px]` RED.
  - absent-in-stored and count dropped (N10): `test_reconcile_absent_in_stored` RED.
  - quantity compared as a string: `test_reconcile_equal_by_value` and nine more RED. A price string comparison stayed green, because `str(Decimal(3150.75))` equals the mapper text for that fixture; the quantity (padded text) and timestamp forms carry the by-value proof.

## Deviations from Plan

**1. [Process] The module was written whole in the first commit.** The plan splits it across three tasks, but mapper gates, census, parser and reconcile live in one pure file and were written together. Commit 1 holds the whole module with the two tracer arms, commit 2 adds the Task 2 arms, commit 3 the Task 3 arms. The RED-before-GREEN step per task was replaced by the neuter checks above, run on the finished module.

**2. [Minor] `billId` and `subType` are not in the synthesized fills-history dict** (the plan listed them); see key-decisions.

**3. [Minor] The reconcile-miss arms are one function per field name (`test_reconcile_miss_quantity` etc.) over a shared helper**, so plan 08's neuters can name them. Extra arms beyond the plan: `test_reconcile_miss_null_stored_fee`, `test_reconcile_stored_duplicate`, `test_reconcile_count_when_archive_repeats_an_id`, `test_census_merges_shapes_past_ten`, `test_parse_stored_fill_reads_postgrest_forms`, `test_legacy_subset_counts_unreadable_and_never_raises`, `test_ts_column_is_the_live_normalisers`, `test_unknown_stop_class_is_refused`.

An early commit attempt carrying the harness's attribution trailers was refused; the three commits carry none, per the project's no-attribution rule.

## Notes for plans 05-07

- `legacy_subset` keys: `stored`, `matched`, `unequal`, `unequal_by_field`, `absent_in_archive`, `unreadable` (as plan 05 reads them).
- `reconcile_window` returns `state` `"equal"` or `"window_empty"` plus `position`, `pairs`, `archive_count`, `stored_count`, `ts_column`, `ts_match`, `fill_time_match`; a miss raises with those plus `field` and `misses_by_field`.
- The mapper's stored `timestamp` text (`...123000+00:00`) differs from PostgREST's text; every comparison is by parsed instant, so the job must not compare the two as strings either.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change. T-259-09, T-259-10 and T-259-11 mitigations are in place as planned.

## Commits

- `88ccf1aaf` feat(259-04): archive trade bill maps to a stored fill through the live normaliser
- `c7a22be77` test(259-04): every subType, each named refusal, duplicates and the census
- `1af397693` test(259-04): window reconcile by value, field-named misses, legacy-subset reading

## Self-Check: PASSED

- FOUND: analytics-service/services/okx_archive_fills_map.py, analytics-service/tests/test_okx_archive_fills_map.py
- FOUND commits 88ccf1aaf, c7a22be77, 1af397693 (ancestors of HEAD; `git rev-list --count b9431f8b3..HEAD` printed 3 before this file was added)
