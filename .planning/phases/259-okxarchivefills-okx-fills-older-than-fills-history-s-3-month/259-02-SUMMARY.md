---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 02
subsystem: analytics-service / OKX archive parser
tags: [okx, archive, parser, fixtures, oracle, python]
requires: []
provides:
  - "ArchiveRow trailing raw trade cells (trade_id, ord_id, inst_id, px_raw, sz_raw, exec_type, fill_time_raw)"
  - "fills_q2_2026.csv and fills_q3_2026.csv archive fixtures with populated trade cells and a chaining bal"
  - "tests/_okx_archive_fills_fixtures.py shared oracle (instants, window trade ids, EXPECTED_ROWS, stored_row, QUARTER_BALANCES)"
affects: [259-04, 259-05, 259-06, 259-07]
tech-stack:
  added: []
  patterns: ["trailing defaulted dataclass fields to extend a pinned frozen dataclass", "hand-typed literal oracle beside a PostgREST-shaped twin"]
key-files:
  created:
    - analytics-service/tests/fixtures/okx_archive/fills_q2_2026.csv
    - analytics-service/tests/fixtures/okx_archive/fills_q3_2026.csv
    - analytics-service/tests/_okx_archive_fills_fixtures.py
    - analytics-service/tests/test_okx_archive_fills_parse.py
  modified:
    - analytics-service/services/okx_archive_files.py
key-decisions:
  - "Trade cells stay raw strings in ArchiveRow; px, sz, tradeId and fillTime are not parsed or validated in parse_archive_csv (the committed fixtures carry blank cells on subType 1 and 2). Plan 04's mapper owns that validation."
  - "trade_id and ord_id are stripped at ArchiveRow construction, after the in-file dedupe tuple is taken, so the duplicate-conflict stop compares the same bytes as before."
  - "Fixture trade bills carry a .123 millisecond part on ts and fillTime = ts - 1, so the mapper's isoformat text (.123000) and PostgREST's text (.123) differ and a string-comparing reconcile fails."
status: complete
commits: 2
plan_head_before: 69646de134c48eb9ec05abd2bd7fd54dcf0da7d3
plan_head_after: 7e0a33398f9152c27299871594d28d48d5ff155d
actuals:
  tokens: 6400
  tasks: 2
  commits: 2
---

# Phase 259 Plan 02: Archive parser keeps the trade cells, fixtures and shared oracle Summary

`ArchiveRow` now keeps seven raw trade cells (tradeId, ordId, instId, px, sz, execType, fillTime), with two new Q2/Q3 archive fixtures that chain across the quarter seam and a hand-typed oracle module for plans 04-07.

## What was built

- **Parser extension (`okx_archive_files.py`).** Seven trailing `str = ""` fields on `ArchiveRow` and seven keyword arguments in the one `ArchiveRow(...)` construction in `parse_archive_csv`. `trade_id` and `ord_id` reuse `_strip_bill_id` (D-17). No new raise site, no new parse step, header check, quarter cut, in-file dedupe tuple and `ArchiveFile` untouched. `grep -c 'ArchiveParseError("' services/okx_archive_files.py` prints 7 at the base and 7 after.
- **Fixtures.** `fills_q2_2026.csv` (7 bills, 4 trade bills: one before the 2026-05-01 anchor, three after) and `fills_q3_2026.csv` (7 bills, 4 trade bills: two below the write bound, two above). ETH-USDT-SWAP, USDT, subType 1/2 trade bills, funding bills 173/174, billIds 910000001-910000014, tradeIds 880000001-880000008. `verify_bal_chain([q2, q3], {"USDT"})` returns `total_pairs: 13` (the second commit message says 12; 13 is the measured figure). Q3's header line is byte-equal to `q3_like.csv`'s.
- **Oracle module.** `_okx_archive_fills_fixtures.py`: all instants from the plan, `TRADE_IDS_BEFORE_ANCHOR` (1), `TRADE_IDS_WRITE_WINDOW` (5), `TRADE_IDS_RECONCILE_WINDOW` (2), `EXPECTED_ROWS` (8 literal 15-key rows), `stored_row` (floats, 8-decimal quantity strings, `.123+00:00` timestamps), `QUARTER_BALANCES` (dict with `q2_last_bal` "5034.62" and `q3_first_bal` "5033.52").
- **Tests.** `test_okx_archive_fills_parse.py`, 9 tests: the three Task 1 arms (`test_trade_bill_keeps_every_trade_cell`, `test_funding_bill_trade_cells_are_blank`, `test_committed_fixture_parses_unchanged`) and six more (seam chain, wrapped-tradeId in-file conflict with a duplicate-dropped control, wrap strip, widened cross-file equality with an identical-copy control, EXPECTED_ROWS re-derived from the fixture cells with plain Decimal and datetime arithmetic, window tuples re-derived from fixture timestamps).

## Verification

- New module plus the seven pinned suites (test_okx_archive_parse, _job, _apply, _rebuild, _reconcile, _download, test_main_worker): 852 passed after Task 1; the new module with _parse, _job and _rebuild: 411 passed after Task 2.
- `make typecheck`: no issues in 146 source files, after each task.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 12 claims.
- The seven pinned test files and `q2_like.csv` / `q3_like.csv` are byte-identical to `git merge-base HEAD origin/main` (`git diff --quiet` exit 0).
- Neuter checks (restored with `cp` from a byte backup, `cmp` clean, `git diff` of the parser empty afterwards): replacing `trade_id=_strip_bill_id(row["tradeId"])` with `trade_id=""` turned 5 tests RED including `test_trade_bill_keeps_every_trade_cell`; stripping tradeId before the dedupe tuple turned `test_wrapped_trade_id_difference_still_conflicts_in_file` RED.

## Deviations from Plan

None - plan executed exactly as written. Two notes: the Task 2 commit message says "12 pairs" where the measured figure is 13; the plan's Task 1 behaviour arm for the committed fixture said "same row_count ... as before", which is pinned against the CSV cells themselves (22 rows) rather than a stored snapshot.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or trust-boundary surface; T-259-03 and T-259-04 mitigations applied as planned.

## Commits

- `181d9b8b2` feat(259-02): ArchiveRow keeps the raw trade cells; Q3 fills fixture and parser pins
- `7e0a33398` test(259-02): Q2 fills fixture, shared oracle module, wrap and dedupe pins

## Self-Check: PASSED

- Files exist: okx_archive_files.py, both fixtures, `_okx_archive_fills_fixtures.py`, `test_okx_archive_fills_parse.py`.
- Commits `181d9b8b2` and `7e0a33398` are ancestors of HEAD; `git rev-list --count 69646de134c..HEAD` printed 2 before this file was added.
