---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
round: 3
reviewed: 2026-10-27T16:30:00Z
reviewed_at_head: 318f3fd09
depth: deep
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/tests/test_trade_pages.py
  - analytics-service/tests/test_trade_read_resume.py
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 171: Code Review Report (round 3)

**Reviewed:** 2026-10-27T16:30:00Z, head `318f3fd09`
**Depth:** deep
**Files Reviewed:** 3
**Status:** clean

## Summary

Scope: the round-2 fixes, `git diff 490c56210..HEAD -- analytics-service/`. That covers commits
`69e770908` (the S-2 conversion reverted, with new pins) and `51d49b08d` (R2-1, one counts-only
WARNING on the short stalled exit), plus their merge `318f3fd09`. Outside `.planning/`, the
range changes only the three files listed. I re-read `_read_bybit_window`, `_read_bybit_range`,
`_fetch_bybit_trades`, `_read_bybit_trades_resumable` and the crawl-timeout arm of the unforced
handler in full at HEAD. As asked, only MEDIUM and above is reported. Nothing at that level was
found.

### Round-2 findings: status

| Finding | Status | Evidence |
|---|---|---|
| WR-01 r2: the S-2 conversion relabelled venue refusals as a transient store fault | **Fixed** | The `state is None` branch is back to `return await _read_bybit_range(exchange, since_ms, now_ms)` (`equity_reconstruction.py:963-964`), and the docstring sentence that described the conversion is gone (`:954-955`). The static "trade store was unavailable" text no longer appears in any source or test file outside `.planning/`. `TruncatedTradeRead` from layer 1 now passes through to its existing permanent disposition. `test_a_truncated_read_stays_permanent_whether_the_store_is_up_or_down` (parametrized over the store being up or down, `bybit_segment_ceiling`) pins this, along with nothing persisted and no venue text. `test_a_book_over_one_run_with_the_store_down_ends_on_the_crawl_timeout_as_transient` pins the size-bound case through the real FLIPRETRY-01 arm: the outcome is `transient` and the message says "per-crawl wall-clock bound" (`:6047`). The test fixes `_RECONSTRUCT_CRAWL_TIMEOUT_S` at 0.3 s, and the 105-window read takes far more than 0.3 s of 50 ms sleeps, so the timeout fires every run. A loaded runner only makes it fire sooner, so the test is not flaky. |
| R2-1 (SFH): the short stalled exit ended the window silently | **Fixed** | `:797-805`: one `logger.warning` before `return False`. It uses the same shape as the sibling full-page-no-cursor WARNING (`:780-786`): `venue=bybit window_age_days page_rows rows`, counts only, with no venue text and no ids. `age_days` is in scope (`:742`). It is still not a refusal, so TRADEPAGES D-02 is kept. `test_a_short_page_that_repeats_its_cursor_or_adds_nothing_ends_the_window` now asserts exactly one WARNING containing "did not advance", `venue=bybit`, `page_rows=50` and `rows=150`, and that the planted `_SIGNATURE` is absent. The fixture now carries the signature in `info`, so the absence check can fail. |

### Round-1 findings: still hold at HEAD

| Finding | Evidence |
|---|---|
| WR-01: an empty first page of a continuation segment is refused, not taken as the end of the window | `empty_continuation` is set at `:763-768`, and both `elif` arms check it (`:809`, `:813`), so this case reaches the `bybit_no_advance` raise (`:820-826`). Round 2 did not touch this code. |
| WR-02: a short page that repeats its cursor ends the window instead of refusing | `:796-805` still returns False on a short stalled page. Only a full stalled page `break`s into time continuation (`:806`). The round-1 test still returns all 150 rows. |
| S-1: a window that ended on an uncertain stop is not stored | Both uncertain exits return False (`:786`, `:805`). The save is still gated on `storable and complete` (`:1031`). |

### Checks run at HEAD

- `pytest tests/test_trade_pages.py tests/test_trade_read_resume.py tests/test_bybit_two_year_window.py tests/test_reconstruct_force_rebuild.py`: 109 passed. Round 2 counted 107. The difference is +2: the S-2 test was replaced by one test, and one test parametrized two ways was added.
- `mypy services/equity_reconstruction.py`: no issues.
- `ruff` could not run: it is not installed in the analytics venv.

### Considered, below the reporting bar

- Suppose Bybit routinely answers a window's last page with a fresh cursor and then repeats that page. Every window would then end on the short-stall exit. Each one would log the new WARNING and none would be stored. This is the residual already recorded in round 2 (it fails closed into `TradeReadStalled` and writes nothing), and the new WARNING makes it visible. It is not a regression from these fixes.
- The timeout test shows that a store-down book ends transient through the wall-clock arm. It does not show that the timeout fired inside the trade read rather than in another step of the crawl. Either way the disposition it pins is the right one (test precision only, LOW).
- The new WARNING says "ended on a page that did not advance". The `bybit_no_advance` WARNING says "stopped on a page that did not advance". The two are close enough that a log search for "did not advance" matches both (LOW).

---

_Reviewed: 2026-10-27T16:30:00Z (round 3)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
