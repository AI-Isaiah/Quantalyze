---
phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to
reviewed: 2026-09-26T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - analytics-service/docs/deribit-ingestion-design.md
  - analytics-service/docs/evidence/drb-assignment-census-2026-09.json
  - analytics-service/scripts/deribit_acceptance.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_acceptance.py
  - analytics-service/tests/test_deribit_assignment.py
  - analytics-service/tests/test_deribit_txn.py
  - analytics-service/tests/test_deribit_unclassified_evidence.py
  - analytics-service/tests/test_smoothed_mtm_core.py
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 168: Code Review Report

**Reviewed:** 2026-09-26
**Depth:** deep
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Scope: the plan 01 and plan 02 diff (`096671f2d..HEAD`, `.planning/` excluded). That covers the `assignment`
cash-bearing classification, the `assert_assignment_uncontested` co-occurrence guard in both twins, the
windowed-crawl refusal in `_crawl_deribit_ledger`, the move of the six option-book sites plus the acceptance
eligibility site to `_OPTION_BOOK_EVENT_TYPES` / `_OPTION_EXPIRY_TYPES`, the new `commission` and `position`
entries in the `describe_unclassified_row` whitelist, and the counts-only census evidence file.

Deep cross-file checks, all with a clean verdict:
- Every production caller of `build_deribit_native_ledger` in `services/job_worker.py` passes no `since_ms`
  (4 of 4 sites), so the claim that the windowed-crawl guard is inert in production holds. The guard runs
  before the USD twin and before any index fetch.
- The index helpers `inverse_days_needing_index`, `_day_ccy_own_index` and
  `deribit_dated_external_flows_usd` select cash rows through `_row_is_cash_bearing` rather than a literal
  type tuple. A quiet-day inverse `assignment` therefore gets its supplemental settlement index.
- `assert_balance_identity` builds its reference set through `_row_is_native_cash_bearing`, so the
  assignment sits on both sides of the identity.
- `replay_option_positions`, `_assert_smoothed_summary_cross_check`, `_pre_coverage_option_days`,
  `_option_activity_after_coverage`, the mark_to_market option arm and `check_perp_only_eligibility` all read
  the shared vocabulary. A grep for leftover `("trade", "delivery")` literals in `services/` and
  `scripts/deribit_acceptance.py` finds 0.
- `_SHAPE_FIELDS` already rendered `change`, so adding `commission` and `position` creates no new class of
  leak.
- `pytest tests/test_deribit_assignment.py tests/test_deribit_unclassified_evidence.py
  tests/test_deribit_acceptance.py`: 77 passed, 0 skipped (`asyncio_mode = auto`, so the async e2e tests
  do run).

Vacuity sweep of the tests in scope: every new test has a red path. `test_site3_cross_check_includes_the_assignment`
calibrates its own breach. The two weak trailing asserts (`"BTC" in ledger.native_pnl` in
`test_windowed_refuses_an_assignment`, and `isinstance(returns, pd.Series)` in
`test_site5_mtm_e2e_assignment_through_the_native_ledger`) both follow strong assertions in the same test.
No test is vacuous.

Main concerns: the guard licenses `assignment` on any instrument class, although the evidence is one
option. The native twin's re-check over the flat cross-scope batch also adds a permanent false refusal
that the per-scope USD twin never raises.

## Warnings

### WR-01: The assignment licence is broader than its evidence: a perpetual- or future-named `assignment` sums silently on both twins, and a spot- or unknown-named one sums silently on the USD twin

**File:** `analytics-service/services/deribit_txn.py`, `assert_assignment_uncontested` (around line 944), with its call sites in `txn_rows_to_daily_records` (around line 1544) and `txn_rows_to_native_daily` (around line 2532)
**Issue:** The census licence rests on one observation: an `assignment` on an expired option put. It is
documented in the code, the design doc and the evidence file as "option expiry cash on the assigned
(short) side". `assert_assignment_uncontested` checks only that the instrument is named and that no
same-instrument `delivery` or `settlement` row exists. It never checks that the instrument IS an option.
A local probe with synthetic rows, one row per class, measured:
- an `assignment` naming a perpetual, and one naming a dated future: summed on BOTH twins, with no
  refusal.
- an `assignment` naming a spot pair, and one naming an unclassifiable bare coin: summed silently by
  `txn_rows_to_daily_records`, refused by `txn_rows_to_native_daily` only through the pre-existing
  non-derivative arm (`row_type in _OPTION_EXPIRY_TYPES and cls in ("unknown", "spot")`).

The first case is an unobserved shape booked as realized cash, which is the guess the census exists to
refuse. The second is a twin divergence. The USD twin does not gate any production write (the job worker
consumes the native ledger), but `fetch_deribit_ledger_daily_records` and the acceptance script still
consume it. `test_site6_spot_named_assignment_refuses` exercises only the native twin, so the divergence
is unpinned. No test covers a perpetual- or future-named assignment.
**Fix:** Refuse any non-option instrument inside the shared guard. That closes both twins at one site and
also removes the twin divergence:
```python
    instrument = row.get("instrument_name")
    if instrument is None or (isinstance(instrument, str) and not instrument.strip()):
        raise LedgerValuationError(...)  # unchanged
    if classify_instrument(str(instrument)) != "option":
        raise LedgerValuationError(
            f"Deribit assignment row id={row.get('id')!r} names a non-option "
            "instrument — the assignment classification is licensed only for an "
            "option expiry (docs/evidence/drb-assignment-census-2026-09.json); "
            "refusing to sum or skip it. " + describe_unclassified_row(row, rows)
        )
```
Give the refusal its own module-level phrase constant, as the two existing branches have. Then
parametrize a new test over `TWINS` × {perpetual, dated future, spot pair, bare coin}. Each case should
assert that phrase and nothing else. The native-only `test_site6_*` then stays a pin for the
pre-existing non-derivative arm on `delivery`.

### WR-02: The native twin's re-check over the flat, all-scope batch adds a permanent false refusal for a cross-subaccount long/short pair on one instrument

**File:** `analytics-service/services/deribit_txn.py`, `txn_rows_to_native_daily` (the `if row_type == "assignment": assert_assignment_uncontested(row, rows)` block, around line 2532); the batch is assembled in `analytics-service/services/deribit_ingest.py`, `_crawl_deribit_ledger` (`raw_rows_all.extend(...)`, around line 1325)
**Issue:** `_crawl_deribit_ledger` already runs the identical guard per (scope, currency) through the USD
twin, on exactly the rows it later concatenates into `raw_rows_all`. The native twin's second run over the
flat concatenation therefore adds exactly one new class of refusal: a contesting `delivery` or `settlement`
in a DIFFERENT subaccount. That is the shape the census hypothesis itself predicts. The short ITM side is
logged as `assignment`, so a long position on the same strike held in a sibling subaccount would be logged
as `delivery`. A probe confirmed it: an assignment in one scope plus a same-instrument delivery in another
passes the per-scope USD twin and is refused by `txn_rows_to_native_daily`. Every production caller crawls
full history, so the refusal recurs on every recompute. The account can never ingest, and no operator
remedy exists short of a code change. The docstring accepts this ("loud, never silent"), but a known
permanent false refusal on a plausible shape is a robustness defect even when it is loud. It is not a
wrong number, hence WARNING rather than BLOCKER.
**Fix:** Scope the contest to the row's own subaccount. Stamp each retained row with its scope label in the
crawl. `_SHAPE_FIELDS` is a whitelist, so the stamp cannot leak into a refusal message. Then have the guard
ignore a sibling from a different scope when both rows carry the stamp:
```python
# deribit_ingest._crawl_deribit_ledger
raw_rows_all.extend({**r, "_scope": scope.label} for r in rows if isinstance(r, Mapping))

# deribit_txn.assert_assignment_uncontested, inside the sibling loop
row_scope, other_scope = row.get("_scope"), other.get("_scope")
if row_scope is not None and other_scope is not None and row_scope != other_scope:
    continue
```
Direct callers that pass no stamp keep today's stricter behaviour. Add a test for each side: the
cross-scope pair ingests through `build_deribit_native_ledger` with two stub scopes, and the same-scope
pair still refuses.

## Info

### IN-01: The design doc and module docstring state an assumption as fact, and misplace the windowed-crawl refusal

**File:** `analytics-service/docs/deribit-ingestion-design.md` (the D-11 "Inside coverage" bullet and the type allow-list paragraph); `analytics-service/services/deribit_txn.py` (the module docstring's MARK_TO_MARKET amendment and the comment on the option arm in `txn_rows_to_native_daily`)
**Issue:** Both say that under mark_to_market an in-coverage `assignment` is fee-only "so it is never
counted both in the ledger and in the summary". That holds only if `options_settlement_summary` actually
carries the assignment payout. The census file's own `classification_licence` calls the
assignment-as-delivery reading "an assumption, not a measurement", and no summary co-occurrence was
observed. Separately, the allow-list paragraph lists "any assignment on a `since_ms`-windowed crawl" among
the shapes that "refuse on both twins". That refusal actually lives in `_crawl_deribit_ledger`, before
either twin runs.
**Fix:** Reword the mark_to_market sentences to say the fee-only treatment *assumes* the summary carries
the assignment payout, citing the census file's licence. Name `_crawl_deribit_ledger` as the site of the
windowed refusal.

### IN-02: The D-03 leak test's instrument regex does not see an expiry written as an ISO date

**File:** `analytics-service/tests/test_deribit_assignment.py`, `test_census_evidence_file_carries_counts_and_nothing_identifying` (`_INSTRUMENT_RE`)
**Issue:** `_INSTRUMENT_RE` matches only `DDMMMYY`-shaped tokens, in upper case. An instrument expiry
recorded as an ISO date, or in lower case, would pass the "nothing identifying" check. The file is
hand-authored and currently clean, so the risk is low, but the test's docstring promises more coverage
than the regex delivers.
**Fix:** Add `re.IGNORECASE`, and assert the evidence file's only ISO-date strings are the `_generated`
and `_recorded` values.

---

_Reviewed: 2026-09-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
