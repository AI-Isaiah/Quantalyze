---
phase: 168
review: silent-failure-hunter
round: 1
reviewed_at_sha: 151c3ae9f
scope: "git diff $(git merge-base HEAD origin/main)..HEAD, excluding .planning/"
counts:
  critical: 0
  high: 0
  medium: 4
  low: 2
  info: 3
---

# Phase 168 DRBOPTIONS — silent-failure review, round 1

Scope: the `assignment` classification in `services/deribit_txn.py` and
`services/deribit_ingest.py`, `assert_assignment_uncontested`, the `since_ms`
refusal in `_crawl_deribit_ledger`, the `_SIBLING_TYPES` / `_SHAPE_FIELDS`
changes, and `check_perp_only_eligibility` in `scripts/deribit_acceptance.py`.

Method: I read the diff and its call sites, then ran synthetic rows through both
twins (`txn_rows_to_native_daily`, `txn_rows_to_daily_records`) to measure each
edge case below. No broker, database or network call was made.

## Verdict

**No CRITICAL or HIGH finding.** No refusal is swallowed or downgraded inside the
diff. The `since_ms` refusal does not leak on any path. Every production caller
of `build_deribit_native_ledger` (the four `job_worker` sites and the two
acceptance scripts) passes no `since_ms`. The refusal's type match is exact,
which is the same match both twins use to classify, so a case-variant type
cannot get past the refusal and then be counted as cash. Such a row is an
unknown type, and the unknown-type guard refuses it on a nonzero `change`.

The four MEDIUM findings share one theme: the guard licenses a wider shape than
the census records. Each shape below was measured to be **summed as cash** where
the licence says it should refuse.

---

## MEDIUM

### SFH-01 — a non-option `assignment` is summed as cash in both twins

- **Where:** `assert_assignment_uncontested`, and the option arm of
  `txn_rows_to_native_daily`, where the non-derivative guard fires only for
  `cls in ("unknown", "spot")`.
- **What:** the census licence is an option (`option_kind: put`). The guard
  checks only that the row has an instrument name and no contesting sibling. An
  `assignment` whose instrument classifies as `future`, `inverse_perpetual` or
  `linear_perpetual` falls through every arm and books its full `change`.
  Under mark_to_market inside coverage it is not fee-only either, because the
  fee-only arm is gated on `cls == "option"`.
- **Measured:** `BTC-27SEP24` (future) and `BTC-PERPETUAL` with nonzero change
  were both summed by both twins, with no raise.
- **Hidden:** a Deribit schema change, or a mislabelled future expiry, that emits
  `assignment` on a future. Its cash would be booked on a channel no census
  licensed.
- **Fix:** in `assert_assignment_uncontested`, refuse unless
  `classify_instrument(str(instrument)) == "option"`. Give the refusal its own
  phrase constant, as `_ASSIGNMENT_UNNAMED_PHRASE` has. Add a parametrised
  future and perp case beside `test_site6_spot_named_assignment_refuses`.

### SFH-02 — a second same-instrument `assignment` does not contest

- **Where:** `_ASSIGNMENT_CONTESTING_TYPES` = `{delivery, settlement}`.
- **What:** the census is n=1 (one assignment, `trade=1`). Two `assignment` rows
  on one instrument is an unobserved shape, just as assignment-plus-delivery is,
  but the guard refuses only the second. The self-skip is by identity, so a
  second assignment row (a partial-lot split, a replayed row, or a second
  subaccount in the native batch) is summed alongside the first.
- **Measured:** two assignments on `BTC-27SEP24-60000-P` summed to twice the
  cash in both twins, with no raise.
- **Hidden:** a double count of expiry cash. That is exactly the harm the
  `delivery`/`settlement` refusal exists to prevent.
- **Fix:** add `"assignment"` to `_ASSIGNMENT_CONTESTING_TYPES`. The identity
  self-skip already keeps a row from contesting itself. The false positive
  across subaccounts in the native batch is already accepted as loud (see
  SFH-03).

### SFH-03 — the contested refusal cannot tell the accepted false positive from a real double count

- **Where:** the contested branch of `assert_assignment_uncontested`, and its
  docstring's "Batch scope" paragraph.
- **What:** the native twin's batch spans every scope. The docstring accepts
  that two subaccounts on the same instrument can refuse as a false positive:
  loud, never silent. But the message names only the assignment's own `id`, and
  the census counts from `describe_unclassified_row`. It does not name the
  contesting row's `id` or type, or any sign that it came from another scope.
  The refusal is permanent, and every recompute of that account fails. The
  operator then has no way to tell the accepted false positive from a real
  double count without a fresh live crawl.
- **Hidden:** it is loud, not silent. But the documented false positive and the
  real defect produce the same text, so the refusal is not actionable.
- **Fix:** add the contesting row's `id` and `type` to the message. The `id` is
  already considered safe to print, because the assignment's own `id` is
  printed. Also state that the native batch spans scopes. That lets the reader
  compare against the USD twin, which checks one (scope, currency) at a time:
  if the USD twin passed, the contest crossed scopes.

### SFH-04 — the first likely assignment failure under mark_to_market is stamped with a misleading reason

- **Where:** `_option_commission` (the fee-only arm, which now covers
  `assignment`) and `replay_option_positions` (which now replays
  `assignment`). Their exceptions are caught by the MTM second-pass and smoothed
  third-pass structural catches in `services/job_worker.py`. `job_worker` is not
  in this diff, but this diff newly routes rows into it.
- **What:** the census `limits` state that whether an `assignment` carries
  `commission` and `position` is unobserved. If it lacks either, the diff
  correctly raises `LedgerValuationError`. The MTM pass then degrades with the
  fixed reason `MTM_REASON_SUMMARY_COVERAGE` (`mtm_summary_coverage_incomplete`),
  and the smoothed pass silently omits its by-basis object, leaving one
  warning log line. The cash headline ships, which is correct. But the
  persisted reason points a reader at summary coverage, not at the
  assignment's missing field. This is the most likely first failure, because
  those two fields are the census's open question.
- **Fix, for either this phase or the owner of the degrade-reason vocabulary:**
  give an assignment missing `commission` or `position` a distinct refusal
  phrase, and stamp a distinct reason, or at minimum log the phrase. The
  `_SHAPE_FIELDS` addition only helps if an unknown-type refusal fires. It never
  fires for `assignment` now, because the type is classified.

---

## LOW

### SFH-05 — the sibling match is on the raw instrument name; the type match is normalised

- **Where:** `assert_assignment_uncontested`: `other.get("instrument_name") != instrument`.
- **What:** the guard strips and lowercases the sibling's `type`, but compares
  `instrument_name` by exact equality. `classify_instrument` uppercases before
  classifying, so a case-variant or whitespace-variant `delivery` on the same
  option still classifies as `option` and is summed, but it does not contest.
  Separately, a non-string `instrument_name` (an int or a dict) passes the
  unnamed-instrument check, because the check is `is None` or blank-str only.
- **Measured:** an assignment on `BTC-27SEP24-60000-P` beside a `delivery` on the
  lowercase name summed both in both twins. An int instrument passed the guard.
- **Fix:** normalise both sides (`str(x).strip().upper()`) before comparing.
  Treat any non-str or blank `instrument_name` as unnamed.

### SFH-06 — the refusal's evidence can be replaced wholesale by a single non-Mapping row

- **Where:** `describe_unclassified_row`, called from both refusals in
  `assert_assignment_uncontested`.
- **What:** `_crawl_deribit_ledger` passes the USD twin the unfiltered page
  batch. `describe_unclassified_row` calls `other.get(...)` on every row with no
  `isinstance(other, Mapping)` check, so one non-Mapping row raises
  `AttributeError`. The helper's broad `except` then replaces the whole shape and
  census with `<unrenderable: AttributeError>`. The refusal still fires. Only
  its evidence is lost, and that evidence is what this phase's census method
  relies on.
- **Fix:** skip non-Mapping rows in the census comprehension, as
  `assert_assignment_uncontested` already does.

---

## INFO

- **INFO-1 — the `since_ms` refusal lives only at the crawl layer.** The pure
  twins accept any batch. The production windowed-leak surface is empty, as
  measured: every caller passes no `since_ms`, and the only other
  `paginate_txn_log`-shaped crawler, `scripts/deribit_ground_truth.py`, does not
  classify cash. A future windowed caller that feeds either twin directly would
  bypass the refusal. The twins' docstrings do not warn about this.
- **INFO-2 — the `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` invariant is
  a bare `assert`.** It is stripped under `python -O`. This matches the
  module's existing import-time asserts, so it is recorded, not a defect.
- **INFO-3 — `expiry` is not replayed and was not verified here.** The
  `_OPTION_BOOK_EVENT_TYPES` comment names the hazard: "a smoothed replay that
  never zeroes the expired position". Deribit's documentation says an
  out-of-the-money expiry logs as `expiry`, with zero cash. That row falls to
  the unknown-type guard, which ignores a zero change, and
  `replay_option_positions` never sees it. I did not check whether the
  smoothed marks path zeroes an expired instrument some other way. This is
  outside the diff and is recorded as a question, not a finding.

## Done well

- `assert_assignment_uncontested` fires regardless of `change`, so there is no
  magnitude rule. The self-skip is by identity, and the phrase constants are
  imported by the tests, so a presence check and an absence check cannot drift.
- The windowed refusal fires before any index I/O, and names only the scope and
  currency.
- `check_perp_only_eligibility` now reads the shared vocabulary instead of a
  literal pair, so an assignment-only key is correctly ineligible.
- The native twin's non-derivative guard was widened from `delivery` to
  `_OPTION_EXPIRY_TYPES`, so an unknown-named or spot-named assignment refuses.
