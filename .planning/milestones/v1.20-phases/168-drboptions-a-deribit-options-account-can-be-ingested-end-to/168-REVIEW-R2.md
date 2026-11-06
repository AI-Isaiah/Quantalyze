---
phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to
reviewed: 2026-09-26T16:00:00Z
depth: deep
iteration: 2
diff_base: 47bdc17e3
reviewed_head: 7d290453d
files_reviewed: 9
files_reviewed_list:
  - analytics-service/docs/deribit-ingestion-design.md
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/deribit_txn.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/stitch_composite.py
  - analytics-service/tests/test_deribit_assignment.py
  - analytics-service/tests/test_mtm_single_key.py
  - src/app/factsheet/[id]/v2/basis-context.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
findings:
  critical: 0
  high: 0
  warning: 1
  low: 3
  info: 8
  total: 12
status: issues_found
---

# Phase 168: Code Review Report (round 2)

**Reviewed:** 2026-09-26
**Depth:** deep (round-1 fix commits `47bdc17e3..7d290453d`, with the surrounding code re-read and call chains traced into `deribit_ingest`, `job_worker` and the factsheet copy)
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Round 1's fixes are sound in substance, and nothing found here blocks. No finding produces a wrong
shipped number or leaks data. Under the founder policy (only user-facing or data-integrity findings
block), all 12 findings are fix-or-Info.

- **One Warning.** The D-09 expiry close adds a new failure path: an `expiry` row with a timestamp
  the replay cannot parse now raises a bare `ValueError`. That error escapes the smoothed pass's
  structural catch, retries the whole derive to `failed_final`, and loses the cash headline (WR-01).
- **Three Low findings.** All come from `_instrument_key` being applied only inside the assignment
  guard. `classify_instrument` does not strip whitespace, and the smoothed replay keys positions on
  the raw name. So a padded name still makes the twins disagree, a case variant still splits the
  replay's book, and a non-numeric commission is still stamped with the coverage reason.
- **WR-02 (logic review deferred to this round): correct, but it cannot run in production.**
  `enumerate_scopes` returns exactly one scope (`main`), so every production row carries the same
  stamp. Only the monkeypatched two-scope test exercises the fix (IN-01).

Verified negatives (checked, nothing found):
- **The scope stamp does not leak.** `ROW_SCOPE_KEY` is not in `_SHAPE_FIELDS`. `_coerce_float`,
  the refusal messages and `describe_unclassified_row` render only `id`/`type` or whitelisted
  fields. No code in `deribit_txn` or `deribit_ingest` renders, serialises or hashes a whole row.
  `raw_rows` is never persisted.
- **The only production callers of the twins are the crawl.** `txn_rows_to_daily_records` runs
  inside `_crawl_deribit_ledger`, and `txn_rows_to_native_daily` runs in
  `build_deribit_native_ledger` on the crawl's stamped rows.
- **Nothing else validates the new reason string.** No TypeScript union, zod schema or DB CHECK
  constraint lists `mtm_*` reasons.
- **The stamp's `None` and missing cases are safe.** A stamp that is `None` on either row, and a
  mix of stamped and unstamped rows, both fall back to the stricter batch-wide check (probed on both
  twins).

The two phase test files pass locally: `123 passed`.

### Round-1 disposition

| Round-1 id | Verdict at HEAD |
|---|---|
| WR-01 / SFH-01 (non-option assignment) | Closed for canonical names. A whitespace-padded name still makes the twins disagree (LR-01). |
| WR-02 (cross-subaccount false refusal) | Logic correct: equality is per scope label and one label covers every currency in a subaccount. Unreachable in production (IN-01). |
| SFH-02 (second assignment contests) | Closed. The identity self-skip holds because the native twin iterates the same stamped copies it passes as `rows`. |
| SFH-03 (name the contesting row) | Closed. Only the sibling's `id` and normalised `type` are rendered. |
| SFH-04 (distinct reason) | Closed for an absent commission. A non-numeric commission still gets the coverage reason (LR-03). |
| SFH-05 (normalised match) | Closed inside the guard and the census only. The replay and `classify_instrument` sites were not updated (LR-01, LR-02). |
| SFH-06 (non-Mapping row) | Closed. |
| IN-01 / IN-02 / INFO-1 | Closed (documentation and test only). |
| INFO-3 → D-09 | Implemented. It adds the new failure path in WR-01 below. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: An undatable `expiry` row now escapes the smoothed pass as a bare `ValueError` and sinks the whole derive

**File:** `analytics-service/services/deribit_txn.py`: `replay_option_positions` (the `sorted(... key=_row_utc_instant ...)` call and the `_OPTION_BOOK_CLOSE_TYPES` branch that calls `_row_utc_day`). The escape happens in `analytics-service/services/job_worker.py`, `run_derive_broker_dailies_job`, at the smoothed third pass's structural `except (LedgerValuationError, …)` arm.

**Issue:** Before D-09, `replay_option_positions` ignored `expiry` rows, so no code ever dated one.
- **The twins never parse its timestamp.** A zero-change `expiry` goes to the unknown-type branch,
  which checks only `change`.
- **`_day_ccy_own_index` swallows the parse error.** It catches `ValueError` and skips the row.
- **The replay is now the first place the timestamp is parsed.** `_row_utc_instant` in the sort
  key, and `_row_utc_day` in the close branch, both raise a bare `ValueError` on a timestamp they
  cannot interpret.

Measured: an `expiry` row with `timestamp=None` passes both twins, then
`replay_option_positions` raises `ValueError: uninterpretable transaction-log timestamp: None`.

That is not a `LedgerValuationError`, so the smoothed third pass's structural arm does not catch
it. It then goes past the outer `except LedgerValuationError` arm to the generic transient handler.
The comment there says this path "burns 3 retries". Result: `failed_final`, and the healthy cash and
MTM headline is not shipped.

This is exactly what the GLB-2 comment on the smoothed arm says must never happen ("never sinking
the healthy cash+MTM factsheet"). Trade, delivery and assignment rows cannot reach this state: the
cash twin dates them first and wraps the error as a permanent `LedgerValuationError`. The new close
type is the only row the replay dates first.

The trigger is a malformed venue timestamp, and the pass is gated on `SMOOTHED_MTM_ENABLED`. That is
why this is a Warning and not a blocker.

**Fix:** In the replay, date each row the way the twins do, before the sort:
```python
try:
    instant = _row_utc_instant(r.get("timestamp"))
    day = _row_utc_day(r.get("timestamp"))
except ValueError as e:
    raise LedgerValuationError(
        f"option Deribit row id={r.get('id')!r} type={r.get('type')!r} has an "
        "undatable timestamp"
    ) from e
```
Pre-compute `(instant, row)` pairs, sort on the pre-computed instant, and reuse `day` in both
branches. Add a test: an `expiry` row with `timestamp=None` must raise `LedgerValuationError` from
`replay_option_positions`. Also add a job-worker test: a bare-`ValueError` smoothed-pass side
effect must not end in `failed_final`. Mirror `test_missing_option_row_field_on_mtm_stamps_its_own_reason`.

## Low

### LR-01: A whitespace-padded assignment name passes the guard as an option but is "unknown" everywhere else, so the twins still disagree

**File:** `analytics-service/services/deribit_txn.py`: `_instrument_key`, `assert_assignment_uncontested` (the `classify_instrument(instrument) != "option"` check on the normalised key), `classify_instrument` (upper-cases, does not strip), and the option arm of `txn_rows_to_native_daily` (`classify_instrument(str(row.get("instrument_name", "")))` on the raw name).

**Issue:** The guard classifies the stripped, upper-cased key. Every other site classifies the raw
name, and `classify_instrument` does not strip, so a trailing space makes an option name
"unknown". Measured with the assigned put's name padded by spaces:
- **USD twin:** the guard passes, and the row is summed as cash (records returned).
- **Native twin:** the guard passes, then the option arm classifies the raw name as `unknown` and
  refuses with the non-derivative wording.

So round 1's claim, "one site closes both twins and removes the twin disagreement", does not hold
for whitespace variants. The SFH-05 test docstring (`test_sfh05_a_case_or_space_variant_sibling_still_contests`)
also says a padded delivery "is still an option delivery and is summed". It is not: the native twin
classifies it as unknown.

This is Low because no wrong number ships. Nothing in production consumes the USD records:
`build_deribit_native_ledger` discards `_daily_records`, and `fetch_deribit_ledger_daily_records`
has no production caller. The native refusal fails the job loudly.

**Fix:** Pick one normalisation and use it everywhere. Either make `classify_instrument` strip
(`name = instrument_name.strip().upper()`), or make `_instrument_key` only upper-case, so the guard
refuses a padded name as non-option on both twins. The first option is the root-cause fix. Add a
both-twins test for a padded assignment name, and correct the SFH-05 docstring.

### LR-02: The smoothed replay still keys the option book on the raw `instrument_name`, so a case variant splits one position into two instruments

**File:** `analytics-service/services/deribit_txn.py`: `replay_option_positions` (`instrument = str(row.get("instrument_name", ""))`, then `per_instr.setdefault(instrument, …)`).

**Issue:** SFH-05 argued that a case-variant sibling "IS the same option" and normalised the guard
and the census on that basis. The replay is also a same-instrument comparison site, and it was left
on raw equality. Measured: an upper-case opening trade (position −1) plus a lower-case `assignment`
(position 0) replay as two instruments, `{UPPER: {day1: -1.0}, lower: {day2: 0.0}}`. The short is
never closed. On a later settled day this becomes a daily-MTM hole (a smoothed degrade), or an open
position that is never marked if the expiry cap hides it.

The same split applies to a D-09 `expiry` row with a case-variant name. This is pre-existing
behaviour, but the round-1 normalisation claim covers this site and did not fix it. Deribit emits
canonical upper-case names, so the trigger is schema drift.

**Fix:** Key `per_instr` and `ccy_of` on `_instrument_key(row.get("instrument_name"))`, skipping
`None`. Keep the marks fetch on the canonical key. Add a replay test with a lower-case close row.

### LR-03: A non-numeric commission still gets the coverage reason; only an absent one gets the new reason

**File:** `analytics-service/services/deribit_txn.py`: `_option_commission` (the final `_coerce_float(raw, field="commission", row=row)`) and `replay_option_positions` (the `float(raw_pos)` `except` branch).

**Issue:** The two new-class sites disagree on the non-numeric case:
- **Position:** a non-numeric position raises `OptionRowFieldMissingError`. Test:
  `test_sfh04_a_missing_position_raises_the_distinct_class[non_numeric]`.
- **Commission:** a non-numeric commission (`"abc"`, a dict) goes through `_coerce_float`, which
  raises the base `LedgerValuationError`.

In the job worker's MTM second pass, the base class maps to `MTM_REASON_SUMMARY_COVERAGE`. The
factsheet then tells the reader that "settlement history does not fully cover this book". SFH-04
was fixed to stop exactly that mislabel. The result is a wrong explanation on a user-facing
surface, not a wrong number.

**Fix:** In `_option_commission`, wrap the coercion:
```python
try:
    return float(raw)
except (TypeError, ValueError):
    raise OptionRowFieldMissingError(
        f"option Deribit row id={row.get('id')!r} type={row.get('type')!r} "
        "INSIDE coverage has a non-numeric commission — ..."
    ) from None
```
Add a `non_numeric` case to `test_sfh04_a_missing_commission_raises_the_distinct_class`, as the
position test already has.

## Info

### IN-01: WR-02's scope stamp cannot run in production: every crawl has exactly one scope

**File:** `analytics-service/services/deribit_ingest.py`: `enumerate_scopes` (returns `[Scope(label="main", …)]`, or raises `ScopeAuthError` when more than one account is funded) and `_crawl_deribit_ledger` (`{**r, ROW_SCOPE_KEY: scope.label}`).

**Issue:** The stamp logic is correct:
- the per-label equality keeps every currency of one subaccount in the same scope;
- different labels do not contest;
- a missing or `None` stamp falls back to the stricter batch-wide check;
- the stamp is never rendered or persisted.

But production always crawls one scope, so every row is stamped `main` and the guard's
scope-skip branch never runs. The round-1 fix report marks WR-02 "requires human verification".
No human can observe it on a real account. The only thing that exercises it is the monkeypatched
two-scope test `test_wr02_a_cross_subaccount_pair_ingests_on_both_twins`.

The docstring's claim that the census is "per subaccount on both twins" also does not extend to
the rest of the flat batch. `replay_option_positions`, `_option_activity_after_coverage` and
`describe_unclassified_row` are all scope-blind. In a future multi-scope crawl, a D-09 `expiry` in
one subaccount would zero a sibling subaccount's position on the same instrument.

**Fix:** State in the guard docstring and in the design doc that the stamp is inert while
`enumerate_scopes` is single-scope. Record that the replay and the census would need the same
scoping before a multi-scope crawl is enabled.

### IN-02: The refusal's sibling census ignores the scope stamp

**File:** `analytics-service/services/deribit_txn.py`: `describe_unclassified_row`

**Issue:** The guard skips siblings from another scope, but the census rendered into the same
message counts them. In a multi-scope batch, a contested refusal could print `delivery=2` when only
one delivery contests. This is evidence that disagrees with the verdict it accompanies. It cannot
happen today because of IN-01.

**Fix:** Apply the same both-stamped, labels-differ skip in the census loop.

### IN-03: The WR-02 calibration test writes the stamp key as a literal

**File:** `analytics-service/tests/test_deribit_assignment.py`: `test_wr02_the_same_pair_in_one_subaccount_still_refuses_on_both_twins` (`dict(r, _scope="main")`)

**Issue:** If `ROW_SCOPE_KEY` is renamed, these rows become unstamped to the guard. The guard falls
back to the batch-wide check, still refuses, and the "stamp must not weaken the guard" calibration
passes without ever exercising the stamp.

**Fix:** Import `ROW_SCOPE_KEY` and build rows with `{**r, ROW_SCOPE_KEY: "main"}`.

### IN-04: Same-instant tie-break does not favour the close row

**File:** `analytics-service/services/deribit_txn.py`: `replay_option_positions` (sort key `(instant, len(id), id)`)

**Issue:** A trade row and an `expiry` row can share an instant, and the trade has the larger id.
In that case the trade's position wins and the option stays open. Measured: expiry id 9 and trade
id 10 at the same millisecond give `{…, expiry_day: -1.0}`. Deribit ids are monotonic and nothing
trades an instrument after its expiry, so this should not happen in real data. The D-09 tests do
not pin the ordering.

**Fix:** Optionally add a secondary key that sorts `_OPTION_BOOK_CLOSE_TYPES` last within an
instant, plus a test.

### IN-05: The new factsheet copy promises "fee or position", but only a missing fee can stamp this reason

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx`: `mtmDisabledReasonCopy` (`case "mtm_option_row_field_missing"`); `analytics-service/services/stitch_composite.py`: the `MTM_REASON_OPTION_ROW_FIELD` comment

**Issue:** The reason is stamped only by the mark_to_market second pass, which never runs
`replay_option_positions`. So only `_option_commission` can raise it there. A missing position
surfaces only in the smoothed third pass, which has no reason channel. The copy is accurate but
wider than any path that produces it.

**Fix:** Either narrow the copy to "missing its fee", or leave it and note in the comment that
"position" is reserved for a future smoothed reason channel.

### IN-06: Three comments are stale after the fix round

**File:**
- `analytics-service/services/stitch_composite.py`: the `MTM_REASON_OPTION_ROW_FIELD` comment ("The UI's reason union is open, so it renders the honest basis-agnostic default copy"). Commit `b418e0805` gave it specific copy.
- `src/app/factsheet/[id]/v2/basis-context.tsx`: the `unsmoothed_options_book` case comment, which lists the single-key reasons as SECOND_PASS_TIMEOUT / ANCHOR_RACE / SUMMARY_COVERAGE / SERIES_UNCOMPUTABLE and omits the new one.
- `analytics-service/services/job_worker.py`: the comment above `mtm_gated_reason = MTM_REASON_SERIES_UNCOMPUTABLE`, which says the second-pass catch stamps only SUMMARY_COVERAGE or ANCHOR_RACE.

**Fix:** Update all three to name `MTM_REASON_OPTION_ROW_FIELD`.

### IN-07: The new tone assertion cannot fail by deleting a case

**File:** `src/app/factsheet/[id]/v2/basis-context.test.tsx`: Test 6b (`expect(mtmReasonTone("mtm_option_row_field_missing")).toBe("steady")`)

**Issue:** `mtmReasonTone` has no case for this reason, and the default is `steady`, so the
assertion holds whether or not the reason exists. It fails only if someone moves the reason into
the transient arm, which is its real purpose. The copy assertion in Test 6 is meaningful: removing
the case falls back to the generic default and goes red.

**Fix:** None required. Optionally reword the comment to say it guards against a transient
misclassification.

### IN-08: `replay_option_positions` docstring still says "NOT yet called by any production path"

**File:** `analytics-service/services/deribit_txn.py`: `replay_option_positions` docstring (and `option_mtm_daily`, which says the same)

**Issue:** `_build_smoothed_option_mtm` in `deribit_ingest` calls both. Round 1 edited this
docstring for D-09 and left the stale sentence in place. The fail-loud paragraph also still says it
raises `LedgerValuationError`, when it now raises the `OptionRowFieldMissingError` subclass and
refuses `exercise` rows.

**Fix:** Drop the sentence, and name the subclass and the D-09 refusals in the fail-loud paragraph.

## Test-vacuity check (D-09 and SFH-04 arms, neutered mentally)

- **Close arm removed** → `test_d09_replay_closes_an_otm_short_at_its_expiry_row` goes RED
  (positions stay `{day1: -1.0}`).
- **Nonzero-change or nonzero-position refusal removed** →
  `test_d09_an_unobserved_expiry_shape_refuses_in_the_replay` goes RED (`DID NOT RAISE`). The
  nonzero-change arm is defence in depth: the twins' unknown-type guard refuses the same row
  earlier in `build_deribit_native_ledger`.
- **Exercise branch removed** → the exercise row falls through to the missing-position raise, the
  `match="exercise row shape is unmeasured"` fails, and the test goes RED.
- **Worker `OptionRowFieldMissingError` branch removed** →
  `test_missing_option_row_field_on_mtm_stamps_its_own_reason` goes RED.
- **Not covered:**
  - an undatable `expiry` row (WR-01);
  - an `expiry` row with an explicit `position=0` or `"0"` (probed, accepted);
  - a same-instant ordering case (IN-04);
  - a non-numeric commission (LR-03).

---

_Reviewed: 2026-09-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
