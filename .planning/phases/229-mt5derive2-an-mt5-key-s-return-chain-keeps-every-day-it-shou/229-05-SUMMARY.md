---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 05
subsystem: analytics-service
tags: [mt5, allocator-equity, key_inputs, returns-stamp, degrade-reasons, writer-basis]
requires: [229-02, 229-03]
provides:
  - "returns_stamp: a per-day record of the csv_daily_returns rows a derive wrote, stored in the same atomic key_inputs upsert as the writer basis"
  - "RETURNS_STAMP_TOL, returns_stamp_payload, read_returns_stamp, returns_stamp_mismatch_days (allocator_equity_derive.py)"
  - "the compose compares each key's RAW stored returns to its stamp before the stitch and raises the blocking key_inputs_mismatch"
affects: [allocator_equity compose, derive_broker_dailies epilogue]
tech-stack:
  added: []
  patterns: ["additive jsonb field written by the derive, read and compared by the compose (no migration)"]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_allocator_equity_writer_basis.py
key-decisions:
  - "Compare RETURNS (the stamp), not a P&L formula: a timed day's stored return is a product of cohort returns and cannot be inverted"
  - "The compare lives in the compose read loop per raw key, before stitch_shared_account; read_writer_basis stays byte-unchanged (sha256 prefix acd576aa4b645c00 before and after)"
  - "A row with no stamp (written before 229) is never refused, only counted at info level"
requirements-completed: [HOLD-03]
duration: 70min
completed: 2026-11-24
status: complete
actuals:
  tokens: 9217
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 0d4d9123fe20f605e698db78c449dd5a07368d41
plan_head_after: 8be3b2d158a804bdcecc7cc546084787df5aaca5
---

# Phase 229 Plan 05: a same-terminal re-derive pair whose returns differ is refused by name (HOLD-03)

The derive now stores the exact per-day returns it wrote (`returns_stamp`, rows `{utc_day_iso, return}`) in the same atomic `key_inputs` upsert as the writer basis, and the allocator compose compares each key's raw stored returns to that stamp before any stitch, mapping a mismatch to the blocking `key_inputs_mismatch` with a counts-only warning. ROADMAP SC-4's second sentence holds: a key_inputs row and a returns set from two different derives that share the calendar are refused, and a healthy pair never is.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 (tracer) | a same-terminal re-derive pair with a quiet-day correction is refused as key_inputs_mismatch | `bd432c46f` feat(229-05) |
| 2 | the departed, stitch-source and counted sites, the under-two-days exit, the removal loop, the timed-day, stitched, departed, short-exit and removed-key tests | `7fe3eae77` test(229-05) |
| 3 | the healthy-pair family, unit and malformed tables, non-finite refusal, determinism pin | `8be3b2d15` test(229-05) |

## What changed

- `allocator_equity_derive.py` (after `read_writer_basis_withheld`; `read_writer_basis` untouched): `RETURNS_STAMP_TOL = 1e-12` with its derivation, `returns_stamp_payload` (ISO order; a non-finite value raises `NavReconstructionError` with a message carrying no digit), `read_returns_stamp` (absent or null is None; otherwise `_read_basis_rows(raw, "return", "returns stamp")`), `returns_stamp_mismatch_days` (window is the stamp's first to last day; a day on one side only, or `abs(diff) > tol`, counts; days outside the window are ignored; an empty stamp counts 0; `None` series counts the whole stamp).
- `job_worker.py`: derive local `_returns_stamp_rows` declared beside `_writer_basis_reason` with the closure-trap comment; set from `rows_payload` at the main key-mode exit and from the marked rows the under-two-days exit upserted (`_short_exit_stamp`, None when it wrote nothing) immediately before each epilogue call; the store gate's writer-basis branch adds `returns_stamp_payload(...)` when it is not None (statements only). Compose: `stamp_mismatch_days_by_key` and a `_compare_returns_stamp` closure called at the departed site (against `returns_by_key`), the stitch-source site (against `source_returns`) and the counted-key site (against `returns_by_key`), all before `stitch_shared_account`; the no-history removal loop pops the key; one counts-only warning (keys refused, total mismatching days) and one info line (basis rows without a stamp); `(KEY_INPUTS_MISMATCH, bool(withheld_by_key) or bool(stamp_mismatch_days_by_key))` in `_compose`'s reason list.
- No migration, no new column.

## Deliberate placement (A-05-5)

ROADMAP SC-4 names `read_writer_basis` and the writer-basis gate in `replay_key_equity`. The compare runs instead in the compose read loop per raw key, because the replay sees the stitched series and not each member's own rows, and because any edit to `read_writer_basis` fires the open entry `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY`. The reader half still lives in `allocator_equity_derive.py` beside the writer half. Intended, not a missed symbol.

## Tracer HEAD RED reading (unedited production code)

Probe (not committed), A's payload composed with B's returns, B moving a position's P&L by 0.001 BTC with equity moved with it:

```
HEADREAD 1 [] True      (10-07 position 0.021 -> 0.022: quiet-day pair; degrade_reasons, is_trustworthy)
HEADREAD 0 [] True      (10-05 position 0.011 -> 0.012: timed-day pair)
```

Both pairs composed with `degrade_reasons == []` and `is_trustworthy True`, as RESEARCH measured. The committed tracer on the unedited code failed at its first assertion on A's payload:

```
>       stamp = {r["utc_day_iso"]: r["return"] for r in a[0]["returns_stamp"]}
E       KeyError: 'returns_stamp'
```

## PROOF-01 (neuter, RED, restore by cp and cmp from a byte backup outside the repository, GREEN)

Task 1 tracer `test_a_same_terminal_rederive_pair_with_a_quiet_day_correction_is_refused`:

```
=== PROOF-01 (a): returns_stamp_mismatch_days returns 0 ===
>       assert "key_inputs_mismatch" in mixed["degrade_reasons"], mixed["degrade_reasons"]
E       AssertionError: []
E       assert 'key_inputs_mismatch' in []
1 failed in 14.59s
cmp: restored byte-identical (silent)
=== PROOF-01 (b): remove the stamp write in the store gate ===
>       stamp = {r["utc_day_iso"]: r["return"] for r in a[0]["returns_stamp"]}
E       KeyError: 'returns_stamp'
1 failed in 12.41s
cmp: restored byte-identical (silent)
=== GREEN ===
1 passed in 15.88s
```

Task 2:

```
=== PROOF-01 (c): drop the stitch-source compare ===
E       AssertionError: []
E       assert 'key_inputs_mismatch' in []
FAILED tests/test_allocator_equity_writer_basis.py::test_a_stitched_member_whose_rows_disagree_with_its_stamp_is_refused[key-A]
1 failed, 1 passed, 113 deselected in 4.86s
cmp: restored byte-identical (silent)
=== PROOF-01 (d): short exit stamps the in-memory returns ===
E       AssertionError: assert 'returns_stamp' not in {'flows': [{'utc_day_iso': '2025-11-09', 'usd_signed': 100000.0}], 'anchor_usd': None, 'anchor_null_reason': 'dust', 'anchor_asof': '2026-11-24T15:55:27.230618+00:00', ...}
E       AssertionError: assert 'returns_stamp' not in {'flows': [{'utc_day_iso': '2025-11-09', 'usd_signed': 100000.0}], 'anchor_usd': None, 'anchor_null_reason': 'dust', 'anchor_asof': '2026-11-24T15:55:27.320139+00:00', ...}
FAILED tests/test_allocator_equity_writer_basis.py::test_the_short_exit_stamps_only_the_rows_it_wrote[False]
FAILED tests/test_allocator_equity_writer_basis.py::test_the_short_exit_stamps_only_the_rows_it_wrote[True]
2 failed, 113 deselected in 4.84s
cmp: restored byte-identical (silent)
=== PROOF-01 (e): drop the no-history removal pop ===
E       AssertionError: ['key_inputs_mismatch']
E       assert 'key_inputs_mismatch' not in ['key_inputs_mismatch']
FAILED tests/test_allocator_equity_writer_basis.py::test_a_removed_no_history_key_with_a_stamp_does_not_block_the_book
1 failed, 114 deselected in 5.02s
cmp: restored byte-identical (silent)
=== PROOF-01 (f): drop the departed compare ===
E       AssertionError: ['classified_rotation', 'inception_unreconciled', 'window_truncated']
E       assert ('key_inputs_mismatch' in ['classified_rotation', 'inception_unreconciled', 'window_truncated']) is not False
FAILED tests/test_allocator_equity_writer_basis.py::test_a_departed_key_whose_rows_disagree_with_its_stamp_is_refused[False]
1 failed, 1 passed, 113 deselected in 4.66s
cmp: restored byte-identical (silent)
=== PROOF-01 (g): drop the counted-key compare (timed-day pair) ===
E       AssertionError: []
E       assert 'key_inputs_mismatch' in []
FAILED tests/test_allocator_equity_writer_basis.py::test_a_same_terminal_rederive_pair_with_a_timed_day_correction_is_refused
1 failed, 114 deselected in 4.61s
cmp: restored byte-identical (silent)
=== GREEN ===
9 passed, 106 deselected in 4.61s
```

Task 3:

```
=== PROOF-01 (h): returns_stamp_mismatch_days returns 0 (both RED pairs) ===
FAILED tests/test_allocator_equity_writer_basis.py::test_a_same_terminal_rederive_pair_with_a_quiet_day_correction_is_refused
FAILED tests/test_allocator_equity_writer_basis.py::test_a_same_terminal_rederive_pair_with_a_timed_day_correction_is_refused
2 failed, 151 deselected in 4.87s
cmp: restored byte-identical (silent)
=== PROOF-01 (i): returns_stamp_mismatch_days returns 1 (over-refusal: the healthy family goes RED) ===
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused[btc-timed]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused[usd-timed-mixed]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused[usd-timed-flows-net-to-zero]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused[usd-guard-nan-day]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused[usd-dust-interior-nan-day]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused[usd-two-day-run]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused_with_a_gap_filled_quiet_day
FAILED tests/test_allocator_equity_writer_basis.py::test_a_healthy_pair_is_never_refused_in_the_nav_marks_era
8 failed, 145 deselected in 4.78s
cmp: restored byte-identical (silent)
=== PROOF-01 (j): drop the compose read of the stamp (malformed stamp no longer disposed) ===
FAILED tests/test_allocator_equity_writer_basis.py::test_a_malformed_returns_stamp_disposes_the_compose_job_as_a_corrupt_input[dup-day]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_malformed_returns_stamp_disposes_the_compose_job_as_a_corrupt_input[bad-day]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_malformed_returns_stamp_disposes_the_compose_job_as_a_corrupt_input[str-value]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_malformed_returns_stamp_disposes_the_compose_job_as_a_corrupt_input[bool]
FAILED tests/test_allocator_equity_writer_basis.py::test_a_malformed_returns_stamp_disposes_the_compose_job_as_a_corrupt_input[not-a-list]
5 failed, 6 passed, 142 deselected in 4.74s
cmp: restored byte-identical (silent)
=== GREEN ===
44 passed, 109 deselected in 4.92s
```

Run (a) used a `return 0` placed first in `returns_stamp_mismatch_days`, so the quiet-day pair went RED first on the by-name assertion; run (h) shows both pairs RED under the same neuter.

## Healthy-pair family: measured HEAD reasons

HEAD here means the pre-229-05 compose, taken as the same row with `returns_stamp` removed (the compose then compares nothing); the test asserts the stamped and stamp-less composes agree on `degrade_reasons` and `is_trustworthy`, and that the stamp warning is absent.

| Shape | HEAD degrade_reasons | is_trustworthy |
|---|---|---|
| btc-timed (BTC timed ledger) | [] | True |
| usd-timed-mixed (overnight, quiet gap day, withdrawal after an open) | [] | True |
| usd-timed-flows-net-to-zero (deposit +100, trade, withdrawal -100) | [] | True |
| usd-guard-nan-day (funding and dominated book; dropped_day_pnl non-empty) | [] | True |
| usd-dust-interior-nan-day (dropped_day_pnl non-empty) | [] | True |
| usd-two-day-run | [] | True |

Also green: a gap-filled quiet day (stamp row 0.0), a nav-marks-era MT5 key (stamp equals exactly the rows the table holds, compose does not refuse), a row with no stamp (not refused, one info count).

## Returns-stamp payload size (plan-checker advisory)

One stamp row is `{"utc_day_iso": "2026-10-04", "return": -0.012345678901234567}`: measured 60 bytes compact (63 with the default `json.dumps` separators) including the list comma, with a 17-digit float (the worst case; short floats are smaller). The stamp has one row per stored return day:

| History | Rows | Compact | Default separators |
|---|---|---|---|
| 1 year | 365 | about 21.9 KB | about 23.0 KB |
| 3 years | 1095 | about 65.7 KB | about 69.0 KB |
| about 5.5 years | 2000 | about 120 KB | about 126 KB |

That is the same order as the existing `composed_day_pnl` list (one row per NAV day, same shape), so a long-history key's `key_inputs` roughly gains the size of one more per-day list. It rides in the `allocator_equity_derived.payload` jsonb and is rewritten whole on every derive.

## Re-run census of key-axis `csv_daily_returns` writers

Re-run at this head (`grep -n 'table("csv_daily_returns")'` over `services/` and `routers/`): the under-two-days exit's upsert (`_measured`) and its stale-day delete, the main exit's upsert (`rows_payload`) and its span delete, and the strategy-axis writer further down (`strategy_id` conflict key). No new key-axis writer; the walk is unchanged from the plan.

## Verification

- `tests/test_allocator_equity_writer_basis.py`, `test_derive_allocator_equity_job.py`, `test_allocator_equity_dropped_day_pnl.py`, `test_mt5_derive_branch.py`, `test_nav_marks_compose_roundtrip.py`, `test_derive_determinism.py`: 506 passed.
- Whole `analytics-service/tests`: 15583 passed, 93 skipped (pre-existing skips), 0 failed.
- mypy strict (the CI command): `Success: no issues found in 142 source files`.
- Vitest literal pins (`tiny-base-literal-pin`, `options-cash-basis-literal-pin`): 21 passed.
- `read_writer_basis` sha256 prefix `acd576aa4b645c00`, equal to the value before the edit.

## Deviations from Plan

### Execution notes

**1. [Ordering] All production sites landed in the Task 1 commit.** The departed, stitch-source and counted sites, the short-exit stamp and the removal pop were written together with the tracer, because they share the compare closure; the Task 2 commit is therefore tests only. Each Task 2 test was neutered against its own site (PROOF-01 c to g) and went RED, so the sites are proven individually even though they share a commit. The Task 2 commit message was amended once (unpushed) to say so.

**2. [Rule 3 - fixture reach] The short-exit positive case is not covered.** `test_the_short_exit_stamps_only_the_rows_it_wrote` covers the two reachable short exits (a key with a stored mark applied, a key without), both of which upsert no `csv_daily_returns` row and must carry no stamp; neutering that rule goes RED (d). A short exit that DOES upsert a marked row (so its stamp must equal those rows) could not be driven: the mark fixtures tried either produced no measured row (`nav_mark_refusal`) or took the main exit. That branch is a three-line assignment from the rows it just upserted (`_short_exit_stamp`); it is reviewed, not test-pinned. Built on the `read_key_marks` patch shape of `_derive_and_observe_apply_marks` (own harness copy with `ctx.strategy_row = None`, 10 USD equity so the material-equity refusal does not fire).

**3. [Scope] The tiny-base NaN-day shape is not in the healthy family.** `tiny_base_after_withdrawal_book` cannot go through `_mt5_deals`, whose precondition is a trading deal on every day. The dust-interior and guard-NaN shapes (both with a non-empty `dropped_day_pnl`) cover the NaN-day stamp rule.

**4. [Observation] A bad stored day string is echoed by the corrupt-input message.** `date.fromisoformat`'s own error text reaches the dispose message for a malformed stamp day, exactly as it already does for the basis fields. It names no amount; the test pins that no stored amount is echoed and was not widened to scrub the day (that would change `_read_basis_rows`, shared with the basis, outside this plan).

No auth gates. No checkpoints.

## Known limits

- Transient race (T-229-12, accepted): a compose running while the epilogue enqueues can leave a transiently blocked book until the next trigger; same shape as `realized_terminal_day_mismatch`.
- A-05-1: a correction confined to a day with no stored return that moves no other return leaves the stored rows identical to the row's own; that pair is content-consistent and is not refused.
- A-05-2: rows written before 229-05 carry no stamp, so legacy books are not compared until their next derive writes one (counted at info level).
- A-05-3: the 1e-12 tolerance rests on the float8 round trip being exact or within about 5e-15; not measured against the live PostgREST stack. A noisier round trip would show as refusals of healthy books after deploy.
- A-05-4: the under-two-days exit without a measured row writes no stamp, so its pair is not compared.
- The determinism pin is a no-false-refusal pin only; the RED pairs are the close.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or file access; the stamp warnings carry counts only (no key id, allocator id, day or amount), pinned by the tracer and the stitched test.

## Self-Check: PASSED

- `bd432c46f`, `7fe3eae77`, `8be3b2d15` are ancestors of HEAD; `git rev-list --count 0d4d9123f..HEAD` was 3 before this SUMMARY commit.
- Modified files exist: `analytics-service/services/allocator_equity_derive.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_allocator_equity_writer_basis.py`.
