---
phase: 168
fixed_at: 2026-09-26T13:51:02Z
review_path: .planning/phases/168-drboptions-a-deribit-options-account-can-be-ingested-end-to/168-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 12
skipped: 0
recorded: 1
status: all_fixed
---

# Phase 168: Code Review Fix Report

**Fixed at:** 2026-09-26
**Source reviews:** `168-REVIEW.md` (WR-01, WR-02, IN-01, IN-02) and `168-REVIEW-SFH.md` (SFH-01..06, INFO-1..3)
**Iteration:** 1 (round 1)

**Summary:**
- Findings in scope: 13. WR-01 and SFH-01 are the same defect and share one fix.
- Fixed: 11 (WR-01/SFH-01, WR-02, SFH-02, SFH-03, SFH-04, SFH-05, SFH-06, IN-01, IN-02, INFO-1).
- Recorded, not changed: INFO-2 (convention).
- INFO-3 was first recorded, then fixed under founder decision D6 (see "Founder decision D6" below).
- Skipped: 0.

Every new test was seen RED before its fix, or under a neuter restored from a byte backup and
compared with `cmp`. The RED line is quoted per finding below.

## Fixed Issues

### SFH-06: one non-Mapping row blanked the refusal evidence

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/tests/test_deribit_assignment.py`
**Commit:** 7c31d0daf
**Applied fix:** `describe_unclassified_row` skips a non-Mapping entry per row in its sibling census.
**RED:** `assert '<unrenderable' not in 'Deribit ass...ributeError>'` (both twins).

### SFH-05: raw instrument_name match; non-string name passed as named

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/tests/test_deribit_assignment.py`
**Commit:** d76de4d7b
**Applied fix:** a new `_instrument_key` helper returns the stripped, upper-cased name, or `None` for an
absent, blank or non-string value. The guard treats `None` as unnamed and matches siblings on the key.
The census in `describe_unclassified_row` uses the same key.
**RED:** `DID NOT RAISE LedgerValuationError` on the USD twin for a lower-case, a padded and an int/dict/list
name. On the native twin the name was refused by the wrong arm (the non-derivative wording, not
`_ASSIGNMENT_UNNAMED_PHRASE`).

### SFH-02: a second same-instrument assignment did not contest

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/tests/test_deribit_assignment.py`
**Commit:** ba1d62019
**Applied fix:** `assignment` joined `_ASSIGNMENT_CONTESTING_TYPES`. The identity self-skip is unchanged.
The phrase constant, the guard docstring, the refusal text and the `CASH_BEARING_TYPES` comment name it.
**RED:** `DID NOT RAISE LedgerValuationError` (both twins).

### SFH-03: the contested refusal did not name the contesting row

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/tests/test_deribit_assignment.py`
**Commit:** 7363d4215
**Applied fix:** the message carries `(contesting row id=<venue row id> type=<normalised type>)`. No other
field of the sibling, and no change value, is rendered.
**RED:** `assert "contesting row id=77 type='delivery'" in 'Deribit assignment row id=2 shares ...'` (both
twins; settlement likewise).

### WR-01 / SFH-01: a non-option assignment was summed

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/tests/test_deribit_assignment.py`
**Commit:** 2aaacb019
**Applied fix:** `assert_assignment_uncontested` refuses unless `classify_instrument(name) == "option"`, with
its own phrase constant `_ASSIGNMENT_NON_OPTION_PHRASE`. One site closes both twins and removes the twin
disagreement. `test_site6_spot_named_assignment_refuses` became `test_site6_spot_named_delivery_refuses`:
the shared guard now fires first for an assignment, so the test stays the pin for the pre-existing
non-derivative arm on `delivery`. The assignment case is the new parametrised test. Plan anchors:
`node scripts/verify-plan-anchors.mjs` on the pending `168-03-PLAN.md` reports `OK: 1 plan file(s), no
stale claims.` The old test name and phrase survive only in completed plan, summary and research
artifacts, which are historical records.
**RED:** over TWINS × {perpetual, dated future, spot pair, bare coin}: 6 × `DID NOT RAISE
LedgerValuationError` and 2 × the native twin's non-derivative wording in place of the new phrase.

### WR-02: cross-subaccount false refusal on the native twin

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/services/deribit_ingest.py`, `analytics-service/tests/test_deribit_assignment.py`
**Commit:** 659504c27
**Status:** fixed: requires human verification (a logic change to the guard's batch scope).
**Applied fix:** `_crawl_deribit_ledger` retains a copy of each row stamped with its scope label under
`ROW_SCOPE_KEY` (`"_scope"`). The guard skips a sibling whose stamp differs from the assignment's. A direct
caller passing unstamped rows keeps the stricter batch-wide check. The stamp is not in `_SHAPE_FIELDS`, so
it never reaches a message. The guard's "Batch scope" docstring paragraph was rewritten: it had accepted
the false positive this removes.
**RED:** `test_wr02_a_cross_subaccount_pair_ingests_on_both_twins` raised the contested refusal from
`txn_rows_to_native_daily` on the real two-scope crawl. The calibration
`test_wr02_the_same_pair_in_one_subaccount_still_refuses_on_both_twins` went RED (`DID NOT RAISE
LedgerValuationError`) under a neuter that skipped every stamped sibling, then was restored and compared
with `cmp`.

### SFH-04: a missing commission or position degraded MTM under the coverage reason

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/services/stitch_composite.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_deribit_assignment.py`, `analytics-service/tests/test_mtm_single_key.py`
**Commit:** ab910ef13
**Applied fix:** `OptionRowFieldMissingError`, a `LedgerValuationError` subclass, is raised at the
`_option_commission` site and both `replay_option_positions` sites, with byte-identical messages. Every
existing catch and `match=` still holds. `stitch_composite`, which owns the reason vocabulary, gains
`MTM_REASON_OPTION_ROW_FIELD = "mtm_option_row_field_missing"`. The job worker's MTM second-pass reason
ternary gains one `isinstance` branch. The change only relabels the reason: the pass still degrades and
cash still ships. The smoothed third pass has no reason column and already logs the scrubbed message, so
it is unchanged.
**Frontend note:** the UI's reason union is open. The new value renders the default copy ("Mark-to-market
unavailable for this strategy.") in the steady tone, which is correct because a missing field does not
heal on the next refresh. No frontend file changed in this commit; founder decision D6 added the specific
copy afterwards (see below).
**RED:** `AssertionError: assert 'mtm_summary_...ge_incomplete' == 'mtm_option_row_field_missing'` (worker
test). The two unit tests raised the base `LedgerValuationError` instead of the subclass.

### IN-02: the census leak test missed ISO-dated and lower-case expiries

**Files modified:** `analytics-service/tests/test_deribit_assignment.py`
**Commit:** d8a35d88d
**Applied fix:** `_INSTRUMENT_RE` gained `re.IGNORECASE`. Every ISO date in any string of the evidence file
must equal its `_generated` or `_recorded` value. The file's one prose ISO date is the documentation fetch
date, and it equals `_recorded`.
**RED:** two neuters on a byte backup of the evidence file, each restored and compared with `cmp`:
`ISO date(s) ['2026-01-16'] at $.limits[3] are neither _generated nor _recorded` and `instrument/expiry-shaped
string at $.limits[3]` (an injected lower-case option name).

### IN-01 and INFO-1: over-claims in the doc, docstrings and comment; the twins' full-history trust

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/docs/deribit-ingestion-design.md`
**Commit:** bb91564c6
**Applied fix:** the D-11 "Inside coverage" bullet, the module docstring's MARK_TO_MARKET amendment and the
option-arm comment now say that the fee-only treatment of an in-coverage assignment ASSUMES the summary
carries its payout, citing the census file's `classification_licence`. The allow-list paragraph names
`_crawl_deribit_ledger` as the site of the windowed refusal and records the round-1 guard. INFO-1: both
twins' docstrings now say they trust their batch to be full history, and that a new windowed caller
feeding a twin directly bypasses the crawl's refusal. This commit changes documentation and comments only.

## Recorded, not changed

### INFO-2: the `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` invariant is a bare `assert`

It is stripped under `python -O`. It matches the module's other import-time asserts (the
CASH_BEARING/INFORMATIONAL disjointness assert and the linear/inverse disjointness assert). Converting only
this one would split the module's convention, so it was left as is. If the class is ever fixed, fix all
three together.

### INFO-3: an out-of-the-money `expiry` row and the smoothed marks path (investigated)

Measured with synthetic rows through `replay_option_positions` and the real `build_deribit_native_ledger`
harness (`_run_options_ledger`, `smoothed_mtm`). There was no broker or network call.

- `replay_option_positions` does not replay `type=expiry`. A short OTM put opened at position −1 keeps
  −1 as its last replayed position whether or not a zero-change `expiry` row is present. Replay output:
  `{'2026-01-15': -1.0}` in both cases.
- `_build_smoothed_option_mtm` caps the marks fetch at the expiry date parsed from the name. If no other
  instrument extends the day grid past the expiry, the ledger builds. With a synthetic expiry-day mark of
  0.0 the book closes to zero: native pnl `{'2026-01-15': 0.03, '2026-01-16': 0.005, '2026-01-17': 0.005}`.
  That closure depends on the expiry-day bar being exactly 0.0. The real value of Deribit's expiry-day 1D
  bar for an OTM option was not measured.
- If any later option activity on another instrument extends the grid past the expiry, the ledger
  refuses: `LedgerValuationError: option daily-MTM hole: instrument=BTC-17JAN26-50000-P carries a nonzero
  position on 2026-01-18 but has NO daily mark (bar)`. The job worker's smoothed third pass degrades on
  that error (cash and MTM ship, and the smoothed key is omitted). The error is loud and no wrong number
  is written, but the smoothed basis stays unavailable for any options account that let an option expire
  OTM and then traded again.

This was first recorded as outside the phase diff, with no fix attempted. Founder decision D6 then chose to
fix it inside Phase 168; see the next section.

## Founder decision D6 (2026-09-26): "Fix inside 168"

Recorded as scope amendment D-09 in `168-CONTEXT.md` and in the ROADMAP's Phase 168 section.

### INFO-3 fixed: the smoothed replay closes an option at its expiry row

**Files modified:** `analytics-service/services/deribit_txn.py`, `analytics-service/tests/test_deribit_assignment.py`, `analytics-service/docs/deribit-ingestion-design.md`
**Commit:** 66604bbcb
**Applied fix:** `replay_option_positions` sets an option's position to 0 at a zero-cash `expiry` row
(`_OPTION_BOOK_CLOSE_TYPES`). An `expiry` row with no `position` field is accepted; whether Deribit's row
carries one is unmeasured, and the close does not depend on it. `expiry` stays out of the cash-bearing set
(an import-time assert pins it), so both twins are unchanged: a zero-cash `expiry` adds nothing, and one
carrying cash still refuses through the unknown-type guard.
**ITM variant: chosen to REFUSE.** The replay refuses three shapes rather than guess: an `expiry` row
carrying cash, an `expiry` row with a nonzero position, and any `exercise` row on an option. `exercise` is
the documented label for the in-the-money long side, and no census has measured its row shape. (The short
side's `assignment` was already replayed.)
**RED:** the pure replay close (`assert {'2026-01-15': -1.0} == {...'2026-01-17': 0.0}`). The real
smoothed-harness run (an OTM short expires, then a later put trades) raised `option daily-MTM hole:
instrument=BTC-17JAN26-50000-P carries a nonzero position on 2026-01-18`. Both unobserved-shape refusals
and the exercise refusal gave `DID NOT RAISE`. After the fix, the smoothed total equals the cash total, and
the expired put has no book entry after its expiry day. `test_d09_both_twins_agree_on_an_expiry_row` pins
existing behaviour. It was seen RED under a neuter that made `expiry` informational (`DID NOT RAISE` on
both twins), then restored and compared with `cmp`.

### SFH-04 UI copy

**Files modified:** `src/app/factsheet/[id]/v2/basis-context.tsx`, `src/app/factsheet/[id]/v2/basis-context.test.tsx`
**Commit:** b418e0805
**Applied fix:** `mtmDisabledReasonCopy` gains a case for `mtm_option_row_field_missing`: "Mark-to-market
unavailable: an options entry in the venue ledger is missing its fee or position, so a mark-to-market series
cannot be reconstructed." `mtmReasonTone` keeps it steady, and a test pins the tone.
**RED:** `Expected: "Mark-to-market unavailable: an options entry ..." Received: "Mark-to-market unavailable
for this strategy."`

### Planning records

**Commit:** e8103fc40. D-09 is in `168-CONTEXT.md`, and the dated scope amendment is in the ROADMAP's Phase
168 section. A note in `168-03-PLAN.md` says the founder retry now also exercises the expiry close, but only
when the smoothed pass runs. That pass is gated on `SMOOTHED_MTM_ENABLED`, and its production value was not
measured. `verify-plan-anchors` on plan 03: `OK: 1 plan file(s), no stale claims.`

WR-02's logic review is deferred to round 2, as instructed.

## Verification

All gates ran in the pinned phase-168 worktree (a separate checkout of `feat/168-deribitassign`), using
the main checkout's `analytics-service/.venv` interpreter. No `node_modules` were present in the worktree.
The planning-hygiene check ran after every `git add` and reported OK each time.

- Full analytics-service pytest, from `analytics-service/`, with the four TEST database variables unset:
  `6420 passed, 90 skipped, 470 warnings in 147.88s (0:02:27)`. Exit 0. A second `-rs` run
  (`6420 passed, 90 skipped`) grouped the skip reasons. 73 need a live test database or service key
  that the unset variables withhold. 5 need `HAS_PY_ENV=1`. 3 need a founder-held broker key and 1
  needs `QUANTALYZE_LIVE_CCXT=1`. 4 wait on unrecorded cassettes. 3 are the pre-existing
  flaky-timeout skips tracked in TODOS.md. 1 is an empty parameter set. Total 90. None are in a file
  this round touched (0 skips in `test_deribit_assignment.py` or `test_mtm_single_key.py`).
- `mypy --strict services/ routers/ models/`: `Success: no issues found in 96 source files`.
- ruff 0.15.7 (from PATH) over `analytics-service/`: `Found 172 errors.` before the first fix and
  `Found 172 errors.` after the last. Per touched file, before (at 47bdc17e3) and after: deribit_txn 0/0,
  deribit_ingest 0/0, stitch_composite 0/0, test_deribit_assignment 0/0, job_worker 5/5,
  test_mtm_single_key 1/1. No new findings.
- After the D6 work (same worktree, same interpreter):
  - pytest: `6427 passed, 90 skipped, 470 warnings in 131.34s (0:02:11)`. Exit 0. That is 7 new tests
    and the same 90 skips.
  - mypy: `Success: no issues found in 96 source files`.
  - ruff: `Found 172 errors.` (unchanged), with deribit_txn 0 and test_deribit_assignment 0.
  - vitest `src/app/factsheet/[id]/v2/basis-context.test.tsx`: `Test Files  1 passed (1)`,
    `Tests  17 passed (17)`. Before commit, the whole `v2/` directory gave `Test Files  40 passed (40)`,
    `Tests  396 passed (396)`. eslint on both files was clean. vitest ran through a temporary
    `node_modules` symlink to the main checkout, removed before each commit.

---

_Fixed: 2026-09-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
