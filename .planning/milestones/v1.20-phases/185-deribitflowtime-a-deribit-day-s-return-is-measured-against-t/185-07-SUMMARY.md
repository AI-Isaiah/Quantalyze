---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 07
subsystem: analytics-ingest
tags: [deribit, options-basis, smoothed-mtm, same-crawl, native-ledger, tdd, sc-5-fixture]
status: complete

requires:
  - phase: 185-deribitflowtime
    provides: "plan 185-02: dry-gate: proceed (founder), the precondition for every task"
provides:
  - "_assemble_deribit_native_ledger: the post-crawl assembly of build_deribit_native_ledger, extracted as a pure move"
  - "build_deribit_native_ledger(..., retain_raw_rows=False) and CompletenessReport.raw_rows (repr=False, compare=False)"
  - "build_deribit_options_basis_ledger(exchange, *, report, account_state, pnl_basis, sleep): a second basis from the one crawl, no transaction-log call"
  - "analytics-service/tests/fixtures/deribit_option_round_trip.py: ROUND_TRIP_S, cash_round_trip_ledger, options_round_trip_ledger (the SC-5 oracle)"
affects: [185-08, 185-09]

requirements-completed: [SC-2, SC-5]

plan_head_before: 9802b63880e0910823fff7bd35a8294ba031d72a
plan_head_after: ed6df2688cc3a269b4c3044ecfbf60a5fdff71f1
actuals:
  tokens: 11000
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "extract-and-reuse for a second basis: the NAV-twin precedent generalised to any basis, with the assembly mutating only the report it is handed (the caller passes a copy)"
    - "retained raw rows as a repr=False, compare=False report field, never logged or persisted"

key-files:
  created:
    - analytics-service/tests/test_deribit_options_basis_ledger.py
    - analytics-service/tests/fixtures/deribit_option_round_trip.py
  modified:
    - analytics-service/services/deribit_ingest.py

key-decisions:
  - "The options report is a copy that also resets pre_coverage_option_days, pre_mark_retention_option_days, nav_twin_ledger and nav_twin_error, not only raw_rows: the copy is shallow, and the assembly writes those fields, so a smoothed cash report or a twin would otherwise leak into the options report."
  - "The A6 fixture is a native BTC round trip with the index stubbed flat, so a USD return equals the native one; every amount is a ratio of the 10 BTC day-0 deposit."

patterns-established:
  - "A second-basis ledger is built from report.raw_rows through _assemble_deribit_native_ledger, never by a second crawl"

duration: 40min
completed: 2026-11-01
---

# Phase 185 Plan 07: the options-basis ledger from one Deribit crawl Summary

**A Deribit key's smoothed or mark-to-market ledger is assembled from the same crawl's retained raw rows by the extracted `_assemble_deribit_native_ledger`, equal to an independent build, with zero extra transaction-log calls and the cash path byte-identical.**

## Performance

- **Tasks:** 2 (1 tracer, 1 auto), 3 task commits
- **Files:** 1 modified, 2 created (all under `analytics-service/`)

## Accomplishments

- `_assemble_deribit_native_ledger` is a pure move of everything `build_deribit_native_ledger` did after the digest block: the removed lines are all re-added verbatim except the `account_state` reference, which became `state_in`.
- `retain_raw_rows=True` puts the crawl's rows on `CompletenessReport.raw_rows`; the default leaves it `None`.
- `build_deribit_options_basis_ledger` raises `ValueError` on a report without rows or on the cash basis, copies the report, assembles on the copy and returns `(ledger, options_report)`. Its body contains no `paginate_txn_log` or `_crawl_deribit_ledger` reference.
- The SC-5 oracle is a shared fixture (`cash_round_trip_ledger`, `options_round_trip_ledger`) for plans 185-08 and 185-09.
- The extreme day is removed by the real assembler on raw rows, not only in the hand-built pair.

## Task Commits

1. **Task 1 (tracer): RED** - `4f31206e6` (test): both behaviors failed with `TypeError: build_deribit_native_ledger() got an unexpected keyword argument 'retain_raw_rows'`.
2. **Task 1 (tracer): GREEN** - `f36cf34e1` (feat): extracted assembly, keyword, report field, options function.
3. **Task 2** - `ed6df2688` (test): guards, retention arms, mark-to-market equality, A6, the fixture.

**Plan metadata:** the commit that adds this file (docs).

## RED evidence

Task 1 semantic assessment: both target tests executed and failed on the missing keyword the plan
names (the keyword and the function did not exist), not on an import, syntax or fixture fault. The
`red1.log` hold 2 failed.

Task 2: no test was RED before GREEN, because Task 1's code already satisfied them (`red2.log`:
15 passed). Task 2's tests are therefore PINS, each proven able to fail by a neuter drill or, for
the rest, by construction below. Which pin is proven by what:

| Pin | Proof it can fail |
|---|---|
| never mutates the cash report; cash report equals its deepcopy | neuter drill (i), 2 failed |
| no extra transaction-log call | neuter drill (ii), `assert 2 == 1` |
| options day values and the typed mark-driven bound; every marked day has a mark | neuter drill (iii), 2 failed |
| the cash basis shows a day above 0.5 | its own assertion on the same raw rows (cash 1.1833, the options neuter gives the cash ledger, so (c) fails) |
| `ValueError` guards, retention and straddler `LedgerValuationError`, mark-to-market equality, cash path unchanged, fixture oracle | not drilled; they restate contracts Task 1's code and the existing smoothed suite already enforce |

## Neuter drills (byte backup, restore, `cmp` each time)

1. `options_report = report` instead of the copy: `neuter1.log` 2 failed (`never_mutates_the_cash_report`, `cash_report_equals_its_deepcopy`). Restored, `cmp` clean.
2. The function re-crawls through `build_deribit_native_ledger(exchange, account_state=..., pnl_basis=...)`: `neuter2.log` 1 failed (`assert 2 == 1`, the paginate log). Restored, `cmp` clean.
3. The function hands the assembly `pnl_basis=DEFAULT_PNL_BASIS`: `neuter3.log` 2 failed, including the raw-row magnitude test (c). Restored, `cmp` clean against `.bak3` and `.bak`.

## A6 readings (raw rows, real assembler, 4 decimals)

Native BTC, S = 10 BTC deposit, index stubbed flat at 60,000; premium 0.4 S, book up 0.06 S a day for five days, delivery 0.01 S over the last mark.

| basis | largest \|r\| | day values |
|---|---|---|
| cash | **1.1833** (2026-01-17, payout 7.1 over a 6.0 NAV; the premium day is -0.4000) | -0.4000, 0 x5, +1.1833 |
| options | **0.0600** (2026-01-12; typed bound 0.6 / 10.0) | 0.0000, 0.0600, 0.0566, 0.0536, 0.0508, 0.0484, 0.0077 |

No A6 fix was needed: the dense marks already span the merged `native_pnl`, so every ΔMTM day has a mark and `combine_native_ledger` raised no `missing_daily_marks` refusal.

SC-5 fixture through `combine_native_ledger(..., frozenset())`: cash (-0.4839, +0.0279, +3.3342, cumulative +1.2993, `flow_timing_day_level_large` set), options (0.0000, +0.1740, +0.9585, cumulative +1.2993, flag absent); the research figures differ by at most 3e-4, inside the plan's `abs=5e-4`.

## Verification

- `pytest tests/test_deribit_options_basis_ledger.py tests/test_smoothed_mtm_core.py tests/test_deribit_ingest.py tests/test_deribit_nav_twin.py tests/test_deribit_assignment.py tests/test_native_nav_sc4_identity.py`: **344 passed** (baseline of the first three modules before the change: 207 passed; every existing test passes unedited).
- CI's mypy line: `Success: no issues found in 131 source files`.
- Acceptance greps: `async def build_deribit_options_basis_ledger` 1, `async def _assemble_deribit_native_ledger` 1; the options function body is non-empty (2765 bytes) and holds 0 references to `paginate_txn_log` or `_crawl_deribit_ledger`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] The options report copy resets more than `raw_rows`**
- **Found during:** Task 1 (GREEN)
- **Issue:** the plan's `dataclasses.replace(report, raw_rows=None)` is a shallow copy. The assembly writes `pre_mark_retention_option_days`, `pre_coverage_option_days`, `balance_identity_open_option_ccys`, `has_option_activity` and the twin fields on the report it is handed. If the cash report was itself a smoothed build (or carried a NAV twin), the options report would inherit that cash build's lists and twin instead of "carrying its own", which the plan's truth 4 requires.
- **Fix:** the copy also passes `pre_coverage_option_days=[]`, `pre_mark_retention_option_days=[]`, `nav_twin_ledger=None`, `nav_twin_error=None`. The other two are reassigned by the assembly.
- **Files modified:** `analytics-service/services/deribit_ingest.py`
- **Verification:** the cash-report and retention tests; neuter drill (i).
- **Committed in:** `f36cf34e1`

---

**Total deviations:** 1 auto-fixed (Rule 2). **Impact on plan:** none on behavior the plan specifies; it only makes "the options report carries its own lists" true for a smoothed cash report too.

## Known limits (recorded, not fixed)

- A smoothed options build needs a FULL-history crawl (WR-05). The cash build's `since_ms` guard only fires when the CASH basis is smoothed; the report does not record the crawl's `since_ms`, so `build_deribit_options_basis_ledger(pnl_basis="smoothed_mtm")` over a `since_ms`-cropped cash crawl would not refuse. Plan 185-08 must call the cash build with `since_ms=None` (the derive's key-mode path does). Not changed here: it is outside the plan's files and prohibitions.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None. The retained rows live on an in-memory report field with `repr=False`; no new endpoint, auth path or file access.

## PR-2 ship note

A Deribit key's options-basis ledger is assembled from its one crawl; nothing in the cash path changed (every existing ingest, smoothed, twin and SC-4 identity test passes unedited). With plans 185-08 and 185-09 this is PR-2.

## Next Phase Readiness

Plan 185-08 can call `build_deribit_native_ledger(..., retain_raw_rows=True)` then `build_deribit_options_basis_ledger(...)` and import the SC-5 pair from `tests/fixtures/deribit_option_round_trip.py`.

## Self-Check: PASSED

- FOUND: `analytics-service/tests/test_deribit_options_basis_ledger.py`, `analytics-service/tests/fixtures/deribit_option_round_trip.py`
- FOUND commits `4f31206e6`, `f36cf34e1`, `ed6df2688` (ancestors of HEAD)
