---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 07
reviewed: 2026-11-27T00:00:00Z
depth: deep
diff: b9d4e4d9e..c3e7c0c8f -- analytics-service
files_reviewed: 8
files_reviewed_list:
  - analytics-service/services/deribit_txn.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/scripts/deribit_options_smoothed_probe.py
  - analytics-service/scripts/navbreach_anchor_probe.py
  - analytics-service/tests/test_smoothed_mtm_core.py
  - analytics-service/tests/test_deribit_assignment.py
  - analytics-service/tests/test_deribit_options_smoothed_probe.py
  - analytics-service/tests/test_navbreach_anchor_probe.py
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
  necessity: 1
status: issues_found
---

# Phase 252 plan 07: Code Review Report

**Reviewed:** 2026-11-27
**Depth:** deep (cross-file: every consumer of the three new classes was traced)
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Scope: the plan-07 change set, `git diff b9d4e4d9e..c3e7c0c8f -- analytics-service`. The worktree
HEAD (`c38764bb1`) has no further `analytics-service` change, so the reviewed source is the
shipped source.

Severity scale. The caller's five words are used on every finding. Frontmatter mapping:
CRITICAL/HIGH go to `critical`, MEDIUM/LOW to `warning`, INFO to `info`. **No CRITICAL, HIGH or
MEDIUM finding.** There are two LOW findings and six INFO findings. Under this repo's review rule,
none of them requires a fixer round.

### What was checked and held

**1. Consumers keyed on class (none moves).** The audit covered every `except`, `isinstance` and
`type(exc).__name__` site in `analytics-service` outside `tests/` and `.venv`. The new classes
are direct subclasses of `LedgerValuationError` and not of `OptionRowFieldMissingError`, and the
result per consumer is:
- **MTM second-pass degrade, `services/job_worker.py` ~7594-7640.** It uses a tuple catch plus
  `isinstance(_mtm_exc, OptionRowFieldMissingError)`, so the reason stays
  `MTM_REASON_SUMMARY_COVERAGE`. The three refusals cannot fire on that basis anyway.
- **Key-mode options-basis loop, `job_worker.py` ~7293-7385.** It runs the smoothed basis
  (`_KEY_MODE_OPTIONS_BASES`, `job_worker.py:1269`), and the plan's consumer table did not name
  it. It catches `LedgerValuationError` by tuple and logs the scrubbed message, so behaviour is
  unchanged. It never reaches `_record_refusal`.
- **`_record_refusal(type(exc).__name__)`, `job_worker.py:7879/7906`.** It persists only when
  `is_key_mode and denominator_config is None`, so the headline basis is cash. The three classes
  cannot reach it, and a scratch run confirmed that cash and mark_to_market build cleanly on all
  three fixtures (see IN-05). No reader of the stored `refusal_class` exists outside tests.
- **Composite `_PERMANENT_LEDGER_ERRORS`, `job_worker.py:14348/14916`.** Tuple catch, unchanged.
- **`nav_twin_error`, `deribit_ingest.py:2966`.** The smoothed build at `deribit_ingest.py:2739`
  runs before and outside the twin wrapper, so this field cannot carry the new names. It is only
  logged in any case (`job_worker.py:10219/13454/13460`).
- **Navbreach `classify_ledger_error`.** The allow-list was extended, so the probe prints the new
  names and not `other`.
- **Scrubbed detail and `error_message`.** Both are built from `str(exc)`, which is byte-identical
  and pinned by tests.

**2. Hostile row data.** `_row_field_shape` never raised on NaN, inf, bool, `10**400`, a
5000-digit string, bytes, blanks, lists or dicts, all measured. The census can raise on a
non-Mapping or hostile row, which production cannot produce (see WR-02).

**3. Probe redaction.** `refusal_shape` admits only closed words and non-bool non-negative ints.
Its validators check `isinstance` first, so unhashable values read as "not a word" and never
raise. `_refuse_floats` and `assert_sanitized` still run, and the new nested keys are not deny
keys. I found no path to stdout for a date, instrument, amount or id.

**4. Tests are real.** The matrix pins strict-earlier `<` (cutoff equal to the day reads
`not-older`), the ingest cutoff threading (red would read `unknown`), exact message bytes and
`args`, the hierarchy, and an `other` row that a per-instrument-rows mutation would miss. The
plan's test files pass (529), and so does the wider regression (401). mypy 2.4.0 `--strict` is
clean on `deribit_txn.py`, `deribit_ingest.py` and the probe.

**5. `retention_cutoff`.** The ingest passes the HARD cutoff local, not `soft_cutoff`, on the only
production call (`deribit_ingest.py:2680-2685`), and `option_mtm_daily` has no other production
caller. `older` is `day < retention_cutoff`. That matches the existing bucketing convention, where
`expiry >= retention_cutoff` is the in-retention side (`deribit_ingest.py` near-cutoff branch). A
hole day inside the 30-day tolerance band reads `not-older`. The plan's next-step section already
records that such a reading can still be a straddler, so this is by design and not a finding.

## Warnings

### WR-01 (LOW): The probe's reading guide is wrong. A hole reading DOES rule out a D-09 row refusal; the "only path to stdout" sentence is also attached to the wrong paragraph

**File:** `analytics-service/scripts/deribit_options_smoothed_probe.py:75-80`. The same claim
appears in `252-07-SUMMARY.md:63` and `252-07-PLAN.md:122`.

**Issue:** The docstring says *"a hole reading does not rule out a row refusal later in the
ledger"*. That cannot be true. `_build_smoothed_option_mtm` calls
`replay_option_positions(raw_rows)` over EVERY row before it fetches any mark
(`deribit_ingest.py:2584`), and `option_mtm_daily` runs only after the replay returns. The replay
has two passes:
- The first walks all rows and refuses the first `exercise` row on any option.
- The second refuses any bad `expiry` row on every instrument.

So an `OptionMarkHoleError` means the replay accepted the whole ledger: no exercise row on any
option and no refusing expiry row anywhere. The real asymmetries go the other way:
- An expiry reading rules out an exercise row on every option instrument, because pass one
  completed.
- An exercise reading says nothing about expiry rows or marks.

The guide understates what a reading proves. That is conservative, but it is the text the founder
reads to pick between a code fix and a founder question, and it could prompt a re-measurement
that is not needed.

Separately, the plan-07 edit put the new paragraph mid-sentence-group. *"The only path to stdout
is `emit_record` … Logging is switched off for the run."* now ends the `WHAT THE READING CAN AND
CANNOT SAY` paragraph instead of the `REDACTION CONTRACT`, so the redaction contract reads as if
it had no single-emitter clause.

**Fix:** Move the stdout sentence back to the end of the REDACTION CONTRACT paragraph, and replace
the guide with:

```text
WHAT THE READING CAN AND CANNOT SAY: the probe names the FIRST refusal per member only. The
position replay walks every row before any mark is fetched: its first pass refuses the first
exercise row, its second pass the first bad expiry row it meets. So a hole reading means
the replay accepted every row (no exercise row, no refusing expiry row); an expiry reading means
no option carries an exercise row; an exercise reading says nothing about expiry rows or marks.
The hole guard stops at the earliest missing day across held instruments (alphabetical on a tie),
so one hole reading does not rule out a second hole.
```

Correct the SUMMARY line 63 sentence in the same records commit.

### WR-02 (LOW): The census can change a typed permanent refusal into an untyped error on hostile rows. Unreachable in production today

**File:** `analytics-service/services/deribit_txn.py:216-230`, called at `:2579` (exercise) and
`:2475` (expiry).

**Issue:** `_same_instrument_census` runs inside the raise expression. It calls `r.get(...)` and
`str(...)` on EVERY row, including:
- on the exercise path, rows the replay's first loop has not reached yet;
- on both paths, the `instrument_name` of non-option rows, which the replay never stringifies.

Measured on the pure core, with a typed `LedgerValuationError` before the change:

| Input placed after the refusing exercise row | Raised now |
|---|---|
| a `None` row | `AttributeError` |
| an `int` row | `AttributeError` |
| a row whose `instrument_name` has a raising `__str__` | `RuntimeError` |
| an `instrument_name` int over 4300 digits | bare `ValueError` |

None of these is a `LedgerValuationError`. The key-mode options loop (`job_worker.py` ~7372) and
the outer permanent arms would let them escape as a transient, and the dispatcher retries the
whole derive. That breaks "the same rows refuse at the same point".

**Why LOW, with proof:** production cannot produce these rows.
- `paginate_txn_log` keeps only Mapping rows (`deribit_ingest.py:469`,
  `rows.extend(r for r in logs if isinstance(r, Mapping))`).
- Key mode reuses that same crawl's retained rows.
- The values come from JSON, which cannot yield an int over 4300 digits (`json` parses through
  `int()` under the same limit) or an object with a hostile `__str__`.

It is a regression in the pure core's never-raise-differently contract, not a reachable defect.

**Fix:** Make the census unable to raise (no new data, same counts on every real row):

```python
def _same_instrument_census(rows, instrument):
    census = {key: 0 for key in ROW_SIBLING_TYPES}
    for r in rows:
        if not isinstance(r, Mapping):
            continue
        name = r.get("instrument_name", "")
        if not (isinstance(name, str) and name == instrument):
            continue
        row_type = r.get("type", "")
        census[row_type if isinstance(row_type, str) and row_type in ROW_SIBLING_KEYS else "other"] += 1
    return census
```

Add one pin: an exercise row followed by a `None` row still raises `OptionExerciseRowError`.

## Info

### IN-01 (INFO): The new exceptions cannot be pickled or copied

**File:** `analytics-service/services/deribit_txn.py:155, 168, 188`

**Issue:** The required keyword-only constructor arguments make `pickle.loads(pickle.dumps(exc))`,
`copy.copy(exc)` and `copy.deepcopy(exc)` raise `TypeError: missing 2 required keyword-only
arguments` (measured). `BaseException.__reduce__` replays `cls(*args)`. A search of
`analytics-service`, excluding `tests/` and `.venv`, found 0 sites that pickle, copy or rebuild
an exception (`ProcessPoolExecutor`, `pickle.dumps`, `copy.copy(exc`, `type(exc)(`,
`__class__(`). Latent only.

**Fix:** Define `__reduce__` on each class, for example
`return (_rebuild_hole, (self.args[0], self.vs_marks, self.vs_retention))`, or let `__init__`
accept the attributes positionally after the message.

### IN-02 (INFO): The two non-numeric expiry paths add a link to the cause chain

**File:** `analytics-service/services/deribit_txn.py:2494, 2508`

**Issue:** `raise _expiry_refusal(str(e), row, rows) from e` makes `__cause__` the intermediate
`LedgerValuationError` instead of the original `ValueError`/`TypeError`. `str(exc)` and
`exc.args` are unchanged, as the constraint asks. Rendered tracebacks and Sentry chain grouping
gain one entry. Of the 12 `__cause__`/`__context__` readers measured, none reads a ledger error
before a structural arm catches it (`geo_block._exc_text` and the job_worker classifier at ~1470
and ~1507 run on other exception families).

**Fix:** `raise _expiry_refusal(str(e), row, rows) from e.__cause__` keeps the original cause, and
the display matches the old one, since `from` suppresses the context.

### IN-03 (INFO): `change_shape` reads a falsy non-numeric `change` differently from the refusal it describes

**File:** `analytics-service/services/deribit_txn.py:202-213` against `:2492`

**Issue:** `_expiry_close` reads `change` as `row.get("change", 0.0) or 0.0`, so `[]`, `{}` and
`False` count as zero. `_row_field_shape` reports `[]`/`{}` as `non-numeric`. On a
nonzero-position expiry refusal with `change: []`, the probe prints
`change: non-numeric, position: nonzero`. That is the same change word a non-numeric-change
refusal prints. Deribit JSON does not send these values; noted for completeness.

**Fix:** None needed. If wanted, compute the expiry change word from the same `or 0.0` reading.

### IN-04 (INFO, necessity): The `isinstance(siblings, Mapping)` re-check in `_refusal_shape` is redundant

**File:** `analytics-service/scripts/deribit_options_smoothed_probe.py:424`
**Category:** necessity

**Issue:** This is an already-defended-elsewhere case. `_is_refusal_shape(row)` on the same line
already requires `_is_siblings(x.get("siblings"))`, which starts with `isinstance(x, Mapping)`
(`_is_siblings`, same file). So the second operand can never be the one that is false. It is
provable from the file and harmless.

**Fix:** Drop the second operand, or keep it and add a comment that it narrows for the
`dict(siblings)` below.

### IN-05 (INFO): The cross-basis pin is real but looser than it has to be

**File:** `analytics-service/tests/test_smoothed_mtm_core.py:1522-1538`

**Issue:** The test passes both when nothing raises and when any non-new exception is raised. A
scratch run measured all six (case, basis) pairs: each one BUILDS on `cash_settlement` and on
`mark_to_market`. Together with the smoothed control test, that means removing the basis gate
would turn the pin red, so the test can fail. Asserting the build instead of "not one of the
three" would also catch a regression that starts raising some other error on these bases.

**Fix:** Replace the `try/except` with a plain call and an assertion that the ledger is returned.

### IN-06 (INFO): The two row-refusal classes duplicate their constructor bodies

**File:** `analytics-service/services/deribit_txn.py:161-199`

**Issue:** `OptionExerciseRowError.__init__` and `OptionExpiryRowError.__init__` are
byte-identical. An intermediate base is ruled out on purpose: the test at
`test_smoothed_mtm_core.py` (`cls.__mro__[1] is LedgerValuationError`) forbids it. A shared module
helper that sets the three attributes would remove the copy without changing the MRO.

**Fix:** Optional. Add `def _set_row_shape(self, change_shape, position_shape, siblings)` and call
it from both constructors.

---

_Reviewed: 2026-11-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Review round outcome (orchestrator, 2026-11-27)

- gsd-code-reviewer (Opus): 0 CRITICAL/HIGH/MEDIUM; LOW-01, LOW-02, INFO-01 to INFO-06 recorded here and not fixed (repo rule: only MEDIUM and above).
- silent-failure-hunter: 0 MEDIUM or above. Its LOW-4 (`after-last-bar` merges marks that stop early with a position still open after expiry) was treated as a phase-goal gap, because the probe exists to name the cause in one PROD run. Fixed by commit `6868f9972` (`vs_expiry`: past-expiry / not-past-expiry / unknown), PROOF-01 RED then GREEN in the fixer's report. Its other LOW items are recorded and not fixed.
