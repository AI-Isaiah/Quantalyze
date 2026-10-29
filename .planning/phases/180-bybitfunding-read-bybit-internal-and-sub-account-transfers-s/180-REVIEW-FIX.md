# Phase 180: Code Review Fix Report

**Source reviews:** `180-REVIEW.md`, `180-SFH.md`
**Fixer:** Claude (gsd-code-fixer), isolated to the 180 worktree, branch `feat/180-bybitfunding`

## Round 1 — topic A (services)

Scope: `analytics-service/services/ccxt_flow_fetch.py`, `services/bybit_unified_flows.py`, `services/equity_reconstruction.py` and their tests. Minimal fixes only, no new abstractions.

**Summary:** 4 fixed, 1 not fixed by disposition (SFH M-2), LOW/INFO untouched.

### Fixed

| Finding | Commit | Files |
|---|---|---|
| REVIEW WR-02 = SFH H-1: Bybit transfer cursor read from a ccxt-parsed row | `be74e6084` | `services/ccxt_flow_fetch.py`, `tests/test_ccxt_flow_fetch.py` |
| REVIEW WR-03 = SFH M-1: 1000-page ceiling returns success, cursor cycle reaches it | `0fd5234b8` | `services/ccxt_flow_fetch.py`, `tests/test_ccxt_flow_fetch.py` |
| SFH M-3: Unified read failure log carries scrubbed venue text | `4061cdac5` | `services/bybit_unified_flows.py`, `tests/test_bybit_unified_flows.py` |
| SFH M-4: forced refusal `from None` leaves no trace of the cause | `088960547` | `services/equity_reconstruction.py`, `tests/test_reconstruct_force_rebuild.py` |

**WR-02 / H-1.** `_bybit_next_cursor(exchange)` now reads `result.nextPageCursor` from `exchange.last_json_response` (the raw answer ccxt keeps) instead of a parsed row's `info`. An empty parsed page that still carries a raw cursor continues instead of ending the window. The test `test_a_bybit_page_without_a_cursor_ends_the_window` (which pinned the truncation) is replaced by `test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues`; the double `_NewestFirstBybitTransfers` now sets `last_json_response`, can drop the newest parsed row (and its `info` cursor) like ccxt's `filter_by_since_limit`, and can script a cursor sequence. The unused `no_cursor` option is gone.

RED proof (WR-02): byte backup, `nxt` neutered to the old source (the `info` cursor of the parsed page), `tests/test_ccxt_flow_fetch.py`:
`AssertionError: assert [None] == [None, 'off:50', 'off:100']` in `test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues` (1 failed, 7 passed). Restored from the backup, `cmp` identical, 8 passed.

**WR-03 / M-1.** `_read_bybit_transfer_window` keeps a `seen_cursors` set and raises `TransferPageStalled` on any cursor already seen in the window (repeat or cycle). The loop-exit warning-and-return-True is replaced by a `TransferPageStalled` (static text: kind and window start only). New tests: `test_a_cycling_bybit_cursor_raises_instead_of_truncating` (A, B, A: raises after 3 calls) and `test_a_bybit_window_past_the_page_ceiling_raises_instead_of_truncating` (1000 distinct cursors: raises after exactly 1000 calls).

RED proofs (WR-03), each from a byte backup, restored and `cmp`-checked:
- Neuter `nxt in seen_cursors` back to `nxt == cursor`: `test_a_cycling_bybit_cursor_raises_instead_of_truncating` failed (`IndexError: list index out of range`, the walk ran past the scripted cycle instead of raising); 1 failed, 9 passed.
- Neuter the ceiling to log and `return True`: `test_a_bybit_window_past_the_page_ceiling_raises_instead_of_truncating` failed (`Failed: DID NOT RAISE TransferPageStalled`); 1 failed, 9 passed.

**M-3.** `bybit_unified_flows.py` logs `exc_class=<ClassName>` only (and the type and window); `scrub_freeform_string` and its import are removed. New `test_a_failed_page_logs_the_exception_class_never_the_venue_text` asserts `exc_class=BadRequest` is logged and the `fake-venue-text` message is absent.

RED proof (M-3): byte backup, log restored to `exc_class=%s scrubbed=%s` with `str(exc)`: `AssertionError: assert 'fake-venue-text' not in 'WARNING  qu...venue-text'`. Restored, `cmp` identical, 50 passed.

**M-4.** Before raising `ForcedRebuildRefusedError("account_flow_source_unreadable") from None`, `equity_reconstruction` logs one WARNING with `type(exc).__name__` only (`from None` kept). The existing parametrized test `test_a_forced_bybit_read_whose_flow_source_is_unreadable_refuses_by_name` now captures `caplog` and asserts a record from the `equity_reconstruction` logger carries `exc_class=<cause class>` (the venue class, or `BybitUnifiedFlowReadError` for the reader's own refusals) and never the leaked signature text.

RED proof (M-4): byte backup, the `logger.warning` removed: `AssertionError: []` / `assert False` on `any(f"exc_class={cause_class}" in m for m in ours)` (the only line left was the `bybit_unified_flows` logger's, which the test filters out by logger name). Restored, `cmp` identical, 55 passed.

### Not fixed (disposition)

**SFH M-2** (`services/bybit_unified_flows.py:182-193`, a full 50-row Unified page with an empty cursor ends the window): not changed, by the caller's instruction. Bybit's cursor is authoritative by its documented contract, and the same walk contract runs in production in `funding_fetch`. Refusing would reject a valid read whose last page holds exactly 50 rows. No code or test change.

**LOW / INFO and SFH M-5, M-6, M-7** (probe scripts): outside topic A's file list and scope; not touched here.

### Verification

Run in the 180 worktree with the main checkout's venv binaries (ccxt 4.5.85 locally, repo pins 4.5.88; `last_json_response` is a base `Exchange` attribute and the cursor shape `result.nextPageCursor` is the raw Bybit v5 answer, so the fix does not depend on the minor version, but it was not exercised against a live venue).

- CI mypy line, verbatim, from `analytics-service/`: `Success: no issues found in 131 source files`.
- Focused tests (`test_ccxt_flow_fetch.py`, `test_exchange_pagination.py`, `test_bybit_unified_flows.py`, `test_trade_pages.py`, `test_reconstruct_force_rebuild.py`, `test_job_worker.py`): `304 passed, 1 skipped` (the one skip is pre-existing in the selected files, not added by this round).

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1, topic A_

## Round 1 — topic A (correction)

**Why.** The WR-02 fix in `be74e6084` read the cursor from `exchange.last_json_response`. ccxt only sets that attribute when `enableLastJsonResponse` is true (`base/exchange.py:338`, default `False`; set in `async_support/base/exchange.py:266`), and nothing in `analytics-service` enables it. In production the cursor was therefore always None and every Bybit 30-day window ended after its first page, the truncation D-02 removes, for every `fetch_ccxt_transfers` caller. The test double set `last_json_response` itself, which hid it. It is also shared mutable state on the exchange object, unsafe under concurrent use.

**Fix** (commit `bf2a8ccab`): the Bybit branch of `fetch_ccxt_transfers` (`_read_bybit_transfer_window`) now calls the raw record endpoints itself, `privateGetV5AssetDepositQueryRecord` / `privateGetV5AssetWithdrawQueryRecord`, with `startTime`, `endTime`, `limit` 50 and `cursor`. The cursor is `result.nextPageCursor` of that call's own answer. The rows are turned into the same transactions callers get today by what `fetch_deposits` / `fetch_withdrawals` do with the answer: `load_markets()` when `markets` is None, then `parse_transactions(add_pagination_cursor_to_result(response), None, window_start, 50)`, which sorts, drops rows stamped 0 or None and caps at 50. `ccxt.NotSupported` stays the only exception caught. The seen-cursor and 1000-page raises from the WR-03 fix are kept. No dependence on `last_json_response` remains.

**Source mirrored.** ccxt 4.5.88, the pinned version, read from the local uv cache (`ccxt-4.5.88`, async_support `bybit.py`). `fetch_deposits`, `fetch_withdrawals`, `add_pagination_cursor_to_result` and base `parse_transactions` are line-for-line identical to 4.5.85 in the main checkout's venv. Neither takes a `{'type': ...}` param; `paginate` defaults to False and `until` maps to `endTime` through `handle_until_option`, which the request reproduces.

**Tests.** `_NewestFirstBybitTransfers` is now a subclass of the real `ccxt.bybit` whose raw record endpoints answer Bybit-shaped raw rows (`result.rows`, `result.nextPageCursor`), so ccxt's own `add_pagination_cursor_to_result` and `parse_transactions` run. It never sets `last_json_response`. The drop option is now `unstamped_newest` (the newest raw row of each page gets `successAt` "0", which ccxt really drops with its cursor-bearing `info`). The Bybit cap tests use a real-ccxt `_RecordingBybit`; `_RecordingExchange` is now the non-Bybit double.

RED proofs (byte backup, neuter, RED, restore, `cmp`, GREEN):
- Cursor read from `getattr(exchange, 'last_json_response', None)` (the previous fix, production-like): 6 failed, 4 passed (`test_a_bybit_window_holding_more_than_one_page_returns_every_row`, `test_a_repeated_bybit_cursor_raises_instead_of_truncating`, `test_a_cycling_bybit_cursor_raises_instead_of_truncating`, `test_a_bybit_window_past_the_page_ceiling_raises_instead_of_truncating`, `test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues`, `test_not_supported_on_a_later_bybit_page_returns_what_was_read`).
- Cursor read from the parsed page's `info` (the original defect): 2 failed, 8 passed (`test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues`: `assert [None] == [None, 'off:50', 'off:100']`; the ceiling test: `DID NOT RAISE TransferPageStalled`).
- Both restored, `cmp` identical, 10 passed.

**Verification.** CI mypy line: `Success: no issues found in 131 source files`. Pytest over `test_ccxt_flow_fetch.py`, `test_exchange_pagination.py`, `test_bybit_unified_flows.py`, `test_trade_pages.py`, `test_reconstruct_force_rebuild.py`, `test_job_worker.py`, `test_stitch_composite_job.py`, `test_nav_marks_composite.py`, `test_broker_dailies.py`, `test_derive_broker_dailies_dualmode.py`, `test_okx_archive_apply.py`, `test_equity_reconstruction.py`: 837 passed, 1 skipped. Also green: `test_allocator_history_probe.py`, `test_reconstruct_whole_account.py`, `test_reconstruct_marker_writer.py`, `test_reconstruct_sibling_replace_scope.py`, `test_bybit_funding_record.py` (319 passed). Not exercised against a live venue.

**Noted, not changed.** `scripts/allocator_history_probe.py:764` records transfers by wrapping the client's `fetch_deposits` / `fetch_withdrawals`. The Bybit branch no longer goes through those methods, so that recorder would not see Bybit rows read by `fetch_ccxt_transfers`. The rebuild's Bybit flow read is the Unified log (D-01) and the recorder wraps that separately, so the probe's own Bybit evidence is unaffected, but it is outside topic A's file scope and worth a look by whoever owns the probe topic.

## Round 1 — topic B

Scope: `analytics-service/scripts/allocator_history_probe.py`, `scripts/bybit_funding_record.py` and their tests (`tests/test_allocator_history_probe.py`, `tests/test_bybit_funding_record.py`). Minimal fixes only. `tests/_bybit_evidence.py` needed no change.

**Summary:** 3 fixed (REVIEW WR-01 with IN-04, SFH M-5 inside WR-01, SFH M-6, SFH M-7 half one), 1 not fixed by disposition (SFH M-7 half two = M-2), LOW/INFO untouched.

### Fixed

| Finding | Commit | Files |
|---|---|---|
| REVIEW WR-01 = SFH M-5 (+ IN-04): `bybit_unified_state` reads `read`, and the Unified counts include rows, for a read the rebuild refused or a crawl-bound cancel cut | `ab3c53007` | `scripts/allocator_history_probe.py`, `tests/test_allocator_history_probe.py` |
| SFH M-6: `bybit_funding_explained` used the first member's evidence and counted non-Bybit trades | `fbc4127e6` | `scripts/allocator_history_probe.py`, `tests/test_allocator_history_probe.py` |
| SFH M-7 (cursor half): a non-string evidence cursor was coerced to `""` and the source read `read` | `fb16c9b3a` | `scripts/bybit_funding_record.py`, `tests/test_bybit_funding_record.py` |

**WR-01 / M-5 / IN-04 (logic fix, requires human verification).** Three changes in the probe:
- The recorder now counts only rows the rebuild's reader would accept (`_reader_accepts_unified_row`: an object of the requested type, a usable id, `transactionTime`, a non-empty currency and a finite `change`, else `cashFlow`), once per `(kind, id)` as the replay does. A row the reader would refuse, a non-object entry, a non-string cursor, and a cursor that came back as the one sent on a page with rows are each counted as malformed. `_log_rows` no longer drops non-objects silently.
- A `CancelledError` out of the Unified log call (the crawl bound is the only canceller) records the failure class `Timeout` and is re-raised unchanged.
- When a member's refusal is `account_flow_source_unreadable` and its recorder state is still `read` (the page ceiling and any refusal made after a call returned are invisible to the recorder), the member's state becomes `malformed`. This is done per member in `_probe_member`, not on the account, so a clean second member is not relabelled.

Row check mirrored, not imported: plan 03 pins that the probe has no `services.bybit_unified_flows` import (an older deployed tree lacks it; the plan's check is `grep -ac 'services.bybit_unified_flows' scripts/allocator_history_probe.py` = 0, still 0). A parity test, `test_the_probes_unified_row_check_agrees_with_the_readers`, runs the mirror and the reader's `normalise_unified_flow_row` over one 28-row corpus and asserts equal verdicts.

Fixture changes that follow from counting only reader-acceptable rows: `_log_row` carries `currency`, the Unified stub stamps each row with the type it was asked for (an explicit `type` on the row wins), and two tests that pinned the old behaviour were corrected: rows with no amount or no id are now malformed and recorded nowhere (the sign-mismatch test no longer includes two rows the reader would refuse).

Known limit: a cancel that lands between two Unified calls (not inside one) is invisible to the recorder; the member's own `failure_class` is `Timeout` there and `bybit_transfers_cause` still reads `read_incomplete` from it.

RED proofs (byte backup, neuter, RED, restore, `cmp` identical, GREEN; test file `tests/test_allocator_history_probe.py`):
- refusal override off (`if False:`): `test_a_flow_source_refusal_the_recorder_saw_no_fault_in_is_not_read` failed (state `read`); 1 failed, 191 passed.
- cancel arm off: `test_a_call_cut_by_the_crawl_bound_is_a_timeout_and_the_cancel_is_reraised` and `test_a_member_cut_by_the_crawl_bound_mid_unified_read_prints_its_state` failed; 2 failed.
- reader-acceptance call off (any object accepted): `test_a_unified_page_of_another_type_is_malformed_and_counts_nothing`, `test_a_venue_that_answers_each_type_with_the_other_prints_a_refused_read` and `test_a_malformed_unified_answer_is_named_and_handed_back_unchanged` failed; 3 failed.
- currency check dropped from the mirror: `test_the_probes_unified_row_check_agrees_with_the_readers` failed; 1 failed.
- dedup off / repeated-cursor check off: `test_a_repeated_unified_cursor_is_malformed_and_a_repeated_row_counts_once` failed (each); non-string cursor check off: `test_a_unified_cursor_that_is_not_a_string_is_malformed` failed.
- whole previous probe file restored over the new tests: 9 failed, 183 passed.

**M-6.** `bybit_funding_explained` takes every Bybit member's evidence (a sequence) instead of the first member's. `off_edge` fires when any member's inflow source shows rows; `unexplained` needs the evidence of ALL `bybit_members` and every source `read` or `not-master`; fewer evidences than members gives `unmeasured`. `_probe_account` passes `fundings` and a trade count taken over the Bybit members only. Tests: `test_the_funding_explanation_needs_every_bybit_members_evidence`, `test_an_account_with_two_bybit_members_reads_the_evidence_of_both` (member 2's evidence shows an inflow: `off_edge`), `test_another_venues_trades_do_not_make_a_bybit_funding_unexplained` (OKX + Bybit, OKX trades only: `unmeasured`). The existing token tests pass lists.

RED proofs (each from a byte backup, restored, `cmp` identical): call site passes `fundings[:1]` (`test_an_account_with_two_bybit_members_reads_the_evidence_of_both` failed); trades summed over every member (`test_another_venues_trades_do_not_make_a_bybit_funding_unexplained` failed); member-count requirement removed (`test_the_funding_explanation_needs_every_bybit_members_evidence` failed); `off_edge` read from the first evidence only (that test and the two-member account test failed).

**M-7 (cursor half).** `_page_of` raises `EvidenceShapeError` for a `nextPageCursor` that is neither absent nor a string, as the Unified reader does, so the source reads `malformed` with its counts as before. Two cases (int and dict cursor) added to `test_a_malformed_page_is_named_and_counts_nothing`. RED: the previous `bybit_funding_record.py` over the new tests, `[answer4]` and `[answer5]` failed (2 failed, 37 passed); restored, `cmp` identical.

### Not fixed (disposition)

**SFH M-7, second half** (a full evidence page with an empty cursor ends the window as complete): the same case as SFH M-2 and not fixed, by the caller's instruction. Bybit's cursor is authoritative by its documented contract, and refusing would reject a valid read whose last page holds exactly 50 rows. No code or test change. The `Every Bybit walk is cursor-authoritative` comment in `_read_source` already states the contract.

### Probe dependence on Bybit `fetch_deposits` / `fetch_withdrawals` (topic A's note)

Confirmed no dependence, no code change. `_fetch_and_price_window` calls `fetch_bybit_unified_flows` for a Bybit member and reaches `fetch_ccxt_transfers` only in its `if not is_bybit` branch (`services/equity_reconstruction.py` around 4201 to 4216), so the probe's recorder wrapping of `fetch_deposits` / `fetch_withdrawals` (`allocator_history_probe.py`, around line 795) sees OKX rows only. Every Bybit deposit and withdrawal the probe counts (`transfers`, the per-kind gate inputs, `bybit_unified_*`) comes from the Unified log wrapper, which is recorded separately. The wrapper on a Bybit client is dead but harmless; the only test that drives it (`test_the_rebuilds_own_transfer_read_is_what_the_recorder_sees`) uses a non-Bybit stub. The other `fetch_ccxt_transfers` callers (`job_worker`, `okx_archive_job`) are outside the probe.

### Verification

Run in the 180 worktree with the main checkout's venv binaries (ccxt 4.5.85 locally).
- CI mypy line, verbatim, from `analytics-service/`: `Success: no issues found in 131 source files`. Probe line (`scripts/allocator_history_probe.py scripts/bybit_funding_record.py`): `Success: no issues found in 2 source files`.
- Pytest `test_allocator_history_probe.py`, `test_bybit_funding_record.py`, `test_okx_chain_record.py` (pins the record's key order), `test_bybit_unified_flows.py`, `test_trade_pages.py`: 430 passed. The probe file went from 184 to 195 tests.
- Plan 03's pin: `grep -ac 'services.bybit_unified_flows' scripts/allocator_history_probe.py` = 0.

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1, topic B_

---

## Round 2

Source: `180-REVIEW-2.md` (CR-01) and `180-SFH-2.md` (F-1, F-2). Files touched: `analytics-service/services/ccxt_flow_fetch.py` and `analytics-service/tests/test_ccxt_flow_fetch.py` only. Run in the 180 worktree with the main checkout's venv binaries (ccxt 4.5.85 locally).

### Fixed

**CR-01 = F-1** (commit `314806593`). `_read_bybit_transfer_window` decided the stop on the parsed page (`not page and nxt is None`), so a raw answer with zero rows that still carried a cursor kept walking and raised `TransferPageStalled` once the cursor repeated. The raw rows are now taken first (`add_pagination_cursor_to_result(response)`) and an empty raw page returns True before the seen-cursor check; parsing follows. A full raw page whose parsed rows all dropped still continues on its cursor (`test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues` stays green). Test `test_an_empty_bybit_page_ends_the_window_even_when_its_cursor_repeats`: 50 rows with cursor `off:50`, then an empty page still carrying `off:50`; expects the 50 rows, 2 calls, no raise. Existing test adjusted: `test_a_bybit_window_past_the_page_ceiling_raises_instead_of_truncating` served 120 rows and relied on empty pages with fresh cursors to keep walking; under the empty-page stop that premise is gone, so it now serves 1100 rows so every one of its 1000 pages is non-empty.

RED proof (byte backup, restored, `cmp` identical): the stop neutered to `if not raw_rows and _bybit_next_cursor(response) is None:`; the new test failed with `TransferPageStalled: a Bybit transfer window's page cursor did not advance`. The test also failed on the unmodified round-1 source before the fix was applied.

**F-2** (commit `45a2ff0e3`). When `parse_transactions` returns fewer rows than the raw page, one WARNING logs `kind`, `window_start_ms`, `raw_rows` and `parsed_rows` (counts only, no ids, amounts or venue text). No new raise. Test `test_a_bybit_page_whose_rows_parsing_drops_logs_the_counts_only` (caplog): 3 raw rows, one stamped 0; asserts the one line, the counts, and that no row id or currency appears. RED proof (byte backup, restored, `cmp` identical): the guard neutered to `if False:`; the test failed (`assert 0 == 1`, no log record).

### Not fixed (LOW / INFO, by instruction)

L-1 to L-5 and IN-01 to IN-05 (including the `classify_exception` arm for `TransferPageStalled`, the `str()` cursor coercion, and the more-than-50-raw-rows raise suggested inside F-2).

### Verification

- CI mypy line, verbatim, from `analytics-service/`: `Success: no issues found in 131 source files`.
- Pytest `test_ccxt_flow_fetch.py` (12 tests, 2 added), `test_exchange_pagination.py`, `test_job_worker.py`, `test_stitch_composite_job.py`, `test_nav_marks_composite.py`, `test_broker_dailies.py`, `test_derive_broker_dailies_dualmode.py`, `test_equity_reconstruction.py`: 498 passed, 1 skipped.

---

## Round 3

Source: `180-REVIEW-3.md` (WR-01) and `180-SFH-3.md` (N-1, N-2). Test gap only: one file touched, `analytics-service/tests/test_ccxt_flow_fetch.py`. No source change. Run in the 180 worktree with the main checkout's venv binaries (ccxt 4.5.85 locally).

### Fixed

**WR-01** (commit `a253eb778`). No shipped test covered a full raw Bybit transfer page whose rows all parse away but which carries a cursor, so a regression `if not page: return True` after the cursor line would have truncated a window and passed the suite. Two tests added, with a small double `_FirstPageAllUnstamped` (page 1's rows all stamped `successAt "0"`):

- `test_a_full_bybit_page_whose_rows_all_parse_away_still_continues`: 70 rows, page 1 fully parsed away; expects calls `[None, "off:50"]` and the 20 older rows back.
- `test_an_empty_bybit_page_with_a_fresh_cursor_ends_the_window`: 50 rows, then an empty raw page carrying a never-seen cursor; expects 50 rows and exactly 2 calls (plan 05's empty-page stop).

RED proofs (byte backup of `analytics-service/services/ccxt_flow_fetch.py`, restored, `cmp` identical after each):

- Mutation A, `if not page: return True` inserted after the `nxt = _bybit_next_cursor(response)` line: the first test failed with `assert [None] == [None, 'off:50']`; the second passed.
- Mutation C, the empty-raw stop changed to `if not raw_rows and _bybit_next_cursor(response) in seen_cursors:`: the second test failed with `IndexError: list index out of range` (the double was asked for a call it never planned); the first passed.

### Not fixed (LOW, by instruction)

- **SFH-3 N-1** (LOW): the empty-raw-page early return is the one exit with no log, so an answer whose rows moved to an unread key (zero rows plus a non-empty cursor) now ends the window clean with no trace. Same family as round-2 L-1. Not fixed.
- **SFH-3 N-2** (LOW): the drop warning cannot tell stamp-0 drops, `since` drops and the 50-row slice apart; adding an `over_limit` count would separate them. Observability only; the round-2 disposition on the slice stands. Not fixed.

### Verification (main checkout's venv, run from the 180 worktree `analytics-service/`)

- `tests/test_ccxt_flow_fetch.py` + `tests/test_exchange_pagination.py`: 32 passed (the first file went from 12 to 14 tests).
- CI mypy line, verbatim: `Success: no issues found in 131 source files`.

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
