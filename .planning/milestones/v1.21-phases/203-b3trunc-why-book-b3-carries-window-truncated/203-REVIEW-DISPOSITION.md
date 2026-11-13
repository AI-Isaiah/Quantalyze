# Phase 203 B3TRUNC: review disposition

Scope: `git diff 498217b1e..HEAD`, MEDIUM and above only. Written 2026-11-07.

## Round 1

- **gsd-code-reviewer:** clean, 0 findings (`203-REVIEW.md`).
- **silent-failure-hunter:** two MEDIUMs.
  1. `203-REPORT.md` overclaimed on key C. It said C's eleven-day-earlier last return day "is not" a stale tail and called A1 "settled". The stored reason set shows only that C's equity index reaches the book's last day. That index is built from return, flow and writer-basis days, and both `window_truncated` and `STALE_MARK_CARRY` compare index endpoints only, so real marks and carried or filled days cannot be told apart. Classed as data-integrity (a records claim stronger than its evidence). Not user-facing: b3 is already untrusted.
  2. The new test exercised only the `key_first` half of the `window_truncated` predicate, so deleting the `key_last` half still passed. Not user-facing.

A data-integrity MEDIUM triggers one fixer round that fixes all MEDIUM+.

## Fixer round 1

- `fe2f8a42b` fix(203): the report states what the key C tail inference shows (the index reaches the last day, inferred from the stored reasons) and what it does not (whether the last eleven index days are real marks). A1 now reads "inferred, not read". The verdict is unchanged, because it rests on the seven distinct start days.
- `98b5a2699` test(203): adds a common-start, early-end arm. It asserts `window_truncated` True, `n_tail_days_carried == 1`, no rotated-out keys, reasons exactly `{WINDOW_TRUNCATED, STALE_MARK_CARRY}`, and trustworthy. Neutering the `key_last` half on a byte-backed copy of `allocator_equity_derive.py` turned it RED (`assert False is True` on `early.flags["window_truncated"]`). The file was restored with `cp`, and `cmp` confirmed it identical. GREEN after the restore.
- Gates (from `analytics-service/`): the two curve test files gave 110 passed. mypy strict on the CI surface gave `Success: no issues found in 132 source files`. ruff found 1 error, the F401 unused `KeyEquity` import, which was already there at the base (recorded in `203-01-SUMMARY.md`) and is LOW, so it was not fixed.
- The orchestrator read the fixer diff.

## Round 2

- **silent-failure-hunter (re-review of `40b069bdd..HEAD`):** both findings are resolved against the code, and the fix introduces no new MEDIUM+ issue.

## Booked

Nothing. No MEDIUM+ survives.
