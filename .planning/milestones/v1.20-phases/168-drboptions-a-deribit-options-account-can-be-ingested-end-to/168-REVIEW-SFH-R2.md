---
phase: 168
review: silent-failure-hunter
round: 2
reviewed_at_sha: 7d290453d
scope: "git diff 47bdc17e3..HEAD, excluding .planning/ (the round-1 fixes)"
counts:
  critical: 0
  high: 0
  medium: 0
  low: 4
  info: 5
round_1_findings_closed: "SFH-01..06 closed; INFO-1 closed; INFO-2 recorded by decision; INFO-3 fixed under D-09"
---

# Phase 168 DRBOPTIONS: silent-failure review, round 2

Scope: the round-1 fixes. That covers `_instrument_key`, the widened
`_ASSIGNMENT_CONTESTING_TYPES`, the contesting-row id in the contested refusal,
the non-option guard (`_ASSIGNMENT_NON_OPTION_PHRASE`), the WR-02 scope stamp
(`ROW_SCOPE_KEY`), `OptionRowFieldMissingError` with `MTM_REASON_OPTION_ROW_FIELD`,
the evidence-file regex, the D-09 expiry close (`_OPTION_BOOK_CLOSE_TYPES`,
`_expiry_close`, and the `exercise` refusal in `replay_option_positions`), and the
factsheet copy in `mtmDisabledReasonCopy`.

Method: I read the diff, its call sites in `deribit_ingest`, `job_worker` and
`stitch_composite`, and every consumer of the reason string. I ran synthetic rows
through `assert_assignment_uncontested`, `replay_option_positions` and
`_option_commission`. I then ran one neuter on a byte backup of
`services/deribit_txn.py`, restored it and compared it with `cmp`, and `git status`
came back clean. No broker, database or network call was made.
`tests/test_deribit_assignment.py` and `tests/test_mtm_single_key.py` passed at
HEAD: 123 passed.

## Verdict

**There is no CRITICAL, HIGH or MEDIUM finding.** Every round-1 refusal still
fires and still names its cause. None became silent. The new reason is mapped
correctly on the one path that can stamp it. The D-09 close zeroes only the
instrument its own `expiry` row names, and only on that row's day. The four LOW
findings are narrow edges. Three of them are the round-1 normalisation class
(SFH-05) that was fixed in the guard but not carried into the replay or the
commission coercion. The fourth is a test gap.

### Checks that came back clean

- **Reason mapping in `job_worker`.** The `OptionRowFieldMissingError` branch sits
  inside the existing structural catch of the MTM second pass in
  `run_derive_broker_dailies_job`, after the `InceptionReconciliationError`
  branch. The two classes are unrelated, so the order does not matter. Nothing
  between `_option_commission` and that catch re-wraps a `LedgerValuationError`.
  The `except ValueError` arms in `txn_rows_to_native_daily` wrap only
  `_row_utc_day`, so the subclass arrives intact.
- **Composite path (`run_stitch_composite_job`).** `mark_to_market_available`
  closes MTM for any member with option activity (`MTM_REASON_OPTIONS`), so a
  composite never runs `_option_commission` and cannot need the new reason.
  Nothing on the composite side is mis-mapped.
- **The reason string's consumers.** The only readers are `stitch_composite` (the
  constant), `basis-context.tsx` (copy and tone) and their tests. No other union,
  enum or constraint lists reason strings, so nothing else needed the new value.
- **The WR-02 stamp cannot hide a same-scope contest.** A stamp is honoured only
  when both rows carry one and the two differ. An assignment stamped `main` beside
  an unstamped delivery on the same put still refused in the probe. The USD twin
  receives the unstamped per-(scope, currency) page and still checks within one
  scope.
- **The D-09 close is narrow.** `_expiry_close` refuses nonzero cash and a present
  nonzero position. The refusal also holds for string forms: `change="0.001"`
  refused, and `position="0"` closed. `expiry` stays out of `CASH_BEARING_TYPES`
  (an import-time assert enforces this), so neither cash twin changed.

---

## LOW

### SFH-R2-01: a case-variant or padded `exercise` type skips the D-09 refusal, and a case-variant `expiry` does not close

- **Where:** `replay_option_positions` matches `row_type = str(row.get("type", ""))`
  against `_OPTION_BOOK_EVENT_TYPES`, `_OPTION_BOOK_CLOSE_TYPES` and
  `_OPTION_EXERCISE_TYPE` with no strip or lowercase. `assert_assignment_uncontested`
  normalises the sibling type (`strip().lower()`).
- **Failure scenario:** a row typed `Exercise` or ` exercise` on an option is
  skipped as an unrelated type. The D-09 refusal never fires, so the long position
  stays open in the smoothed book. A zero-change row of that type is also ignored
  by both cash twins, which is the module's exact-match convention.
  Measured: `[trade position=+1, type="Exercise"]` gave positions
  `{'2026-01-15': 1.0}`, with no raise. `type="Expiry"` likewise left the short at
  `-1.0`. If there is later option activity on the same account, the open position
  resurfaces as the existing daily-MTM hole, which is loud but names the wrong
  cause. If there is none, the book carries the position to the end of its
  expiry-capped mark grid.
- **Why LOW:** Deribit's types are lower-case and canonical. The cash twins match
  them exactly, so this does not reopen a cash leak. It does mean the "exercise
  refuses by name" claim holds only for the exact spelling.
- **Fix:** in the replay, normalise the type once
  (`str(row.get("type", "")).strip().lower()`) and use it for all three
  membership tests and for the close check inside the per-instrument loop. The
  fix is one line. Add a parametrised `Exercise` / ` exercise` / `Expiry` case
  beside `test_d09_an_exercise_row_refuses_in_the_replay`.

### SFH-R2-02: the replay groups on the raw instrument name, so a variant-named `expiry` closes a phantom instrument

- **Where:** `replay_option_positions` sets
  `instrument = str(row.get("instrument_name", ""))` as the `per_instr` key.
  `classify_instrument` upper-cases before it classifies, so a lower-case name
  still passes the option gate. Round 1's `_instrument_key` (SFH-05) is used by
  the guard and by `describe_unclassified_row`, but not here.
- **Failure scenario:** an `expiry` row naming the lower-case form of the put
  creates a second book entry holding only `{expiry_day: 0.0}`. The real position
  is never closed. Measured: the output held both `BTC-17JAN26-50000-P` at `-1.0`
  and `btc-17jan26-50000-p` at `0.0`. `_build_smoothed_option_mtm` then fetches
  marks for the phantom name, and D-09's fix does not apply to the real instrument.
  Later activity produces the hole refusal (loud). Without later activity the
  close is simply missed.
- **Why LOW:** the name case is venue-canonical. The same raw-key grouping
  predates this phase for `trade` rows. The outcome is loud or matches the
  pre-D-09 behaviour. It is never a wrong number.
- **Fix:** key `per_instr` on `_instrument_key(...)`, and skip or refuse a
  `None` key. Alternatively, refuse an option row whose name is not already
  canonical (`name != name.strip().upper()`). That second option is louder and
  matches the D-08 "never guess" rule.

### SFH-R2-03: a non-numeric commission is still stamped with the coverage reason

- **Where:** `_option_commission`. An absent, null or blank commission raises
  `OptionRowFieldMissingError`. A present but non-numeric one (`"abc"`) goes
  through `_coerce_float` and raises the base `LedgerValuationError`. In
  `replay_option_positions`, a non-numeric `position` raises the subclass.
- **Failure scenario:** schema drift that turns `commission` into a non-numeric
  value degrades the MTM second pass with `MTM_REASON_SUMMARY_COVERAGE`. That is
  the misleading stamp SFH-04 set out to remove, now for a malformed commission
  rather than a missing one. Measured: `_option_commission({... "commission":
  "abc"})` raised `LedgerValuationError`, the base class. The two fields now
  disagree about what counts as "missing".
- **Fix:** wrap the coercion so that a non-numeric commission raises
  `OptionRowFieldMissingError` with the same wording, as the replay already does
  for `position`. Add a `non_numeric` case to
  `test_sfh04_a_missing_commission_raises_the_distinct_class`.

### SFH-R2-04: the "mixed stamped / unstamped keeps the stricter check" rule is unpinned

- **Where:** the WR-02 branch of `assert_assignment_uncontested`, which reads
  `row_scope is not None and other_scope is not None and row_scope != other_scope`.
  Its docstring promises that "a direct caller passing unstamped rows keeps the
  stricter batch-wide check".
- **Failure scenario:** a later edit loosens `and` to `or` in the None tests, so
  that one stamp is enough to skip. A stamped assignment beside an unstamped
  same-scope delivery would then be summed twice with no raise. This could happen
  if a caller merges crawl output with rows from another source.
- **Measured (neuter):** I changed the condition to
  `(row_scope is not None or other_scope is not None) and row_scope != other_scope`
  and ran `tests/test_deribit_assignment.py`: **83 passed**. No test went RED. I
  restored the file from its byte backup, `cmp` came back clean, and so did
  `git status`. Today's code is correct (the mixed probe refused). The guarantee
  simply has no test.
- **Fix:** add a test on both twins with an assignment stamped `main` and an
  unstamped same-instrument delivery. It must raise `_ASSIGNMENT_CONTESTED_PHRASE`.
  Add the mirror case too: an unstamped assignment beside a stamped delivery.

---

## INFO

- **INFO-R2-1: WR-02 is inert in production today.** `enumerate_scopes` returns
  exactly one `Scope(label="main", ...)` and raises `ScopeAuthError` when more
  than one subaccount is funded. Every stamp is therefore `main`, and the
  cross-scope skip never fires outside the injected two-scope test harness. Also
  latent: `replay_option_positions` ignores `ROW_SCOPE_KEY`. If multi-scope crawls
  are ever enabled, the per-instrument replay would interleave two subaccounts'
  post-trade `position` values. WR-02 now admits the cross-scope assignment and
  delivery pair past the native twin, where it used to refuse, so that pair would
  reach the interleaving replay. Scope the replay by `(scope, instrument)` in the
  same change that enables multi-scope.
- **INFO-R2-2: the new copy's "or position" half cannot be stamped.**
  `replay_option_positions` runs only under `PNL_BASIS_SMOOTHED_MTM`
  (`_build_smoothed_option_mtm`). The MTM second pass can therefore raise
  `OptionRowFieldMissingError` only from `_option_commission`. The
  `mtm_option_row_field_missing` copy ("missing its fee or position") names a
  cause that pass cannot produce. That is harmless, but it is broader than the
  truth. A missing `position` in the smoothed pass degrades with a log line only
  (see INFO-R2-3).
- **INFO-R2-3: the D-09 refusals surface as a log line plus an omitted key.**
  The `exercise` refusal and both unobserved-expiry refusals are raised only in
  the smoothed pass. Its structural catch in `run_derive_broker_dailies_job` (and
  its composite twin) degrades with a scrubbed `logger.warning`, and the
  `smoothed_mtm` by-basis key is omitted. There is no reason column (Phase 133,
  LOW-01), so the refusal is not silent, but its only persisted trace is the
  missing key. Any account that ever received an option `exercise` loses the
  smoothed basis permanently, and the factsheet does not say why. This is the
  founder's chosen D-09 behaviour and the reason-channel gap predates it.
- **INFO-R2-4: two assertions cannot fail on their own.** In
  `test_missing_option_row_field_on_mtm_stamps_its_own_reason`, the line
  `assert MTM_REASON_OPTION_ROW_FIELD not in (MTM_REASON_SUMMARY_COVERAGE,
  MTM_REASON_ANCHOR_RACE)` compares module constants, so it is a tautology. The
  test's real assertion, the prestamp reason equality, can fail, and the fix
  report quotes it RED. In `test_d09_both_twins_agree_on_an_expiry_row`, the
  zero-cash half (`twin([opening, quiet]) == alone`) holds whether `expiry` is
  cash-bearing or informational, because adding 0.0 changes nothing. The refusal
  half carries the test, and the fix report quotes it RED under an
  informational neuter. Neither is a defect. Both are noted so nobody counts
  them as independent pins.
- **INFO-R2-5: an `expiry` row on a same-instant tie loses to a later-id
  `trade`.** The replay's tie-break is by timestamp and then by shortlex id. A
  `trade` on the same instrument at the expiry row's exact instant with a larger
  id overrides the close. Measured: `-2.0` at the expiry day. A trade at the
  expiry instant of the same instrument is not a real venue shape, so this is
  recorded only.

---

## Round-1 findings: closure

| id | status at 7d290453d | evidence |
|---|---|---|
| SFH-01 (non-option assignment summed) | closed | `_ASSIGNMENT_NON_OPTION_PHRASE` in the shared guard; `test_wr01_*` over 4 names × 2 twins |
| SFH-02 (second assignment does not contest) | closed | `assignment` added to `_ASSIGNMENT_CONTESTING_TYPES`; `test_sfh02_*` |
| SFH-03 (contesting row unnamed) | closed | the message carries the contesting row's id and normalised type, not its change; `test_sfh03_*` |
| SFH-04 (missing field stamped as coverage) | closed for absent/null/blank commission and all position cases; see SFH-R2-03 for a non-numeric commission | `OptionRowFieldMissingError`, `MTM_REASON_OPTION_ROW_FIELD`, and the worker ternary branch |
| SFH-05 (raw instrument match) | closed in the guard and the census; not carried into the replay (SFH-R2-02) | `_instrument_key` |
| SFH-06 (non-Mapping row blanks the evidence) | closed | per-row `isinstance(other, Mapping)` in `describe_unclassified_row` |
| INFO-1 (twins trust full history) | closed | the docstrings of both twins |
| INFO-2 (bare import-time assert) | recorded by decision (module convention) | fix report |
| INFO-3 (OTM expiry never closes) | fixed under D-09 | `_OPTION_BOOK_CLOSE_TYPES`, `_expiry_close`, `test_d09_*` |

_Reviewer: silent-failure-hunter, round 2. Reviewed at 7d290453d._
