---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
round: 2
reviewed: 2026-10-27T15:29:30Z
reviewed_at_head: 490c56210
depth: deep
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/tests/test_trade_pages.py
  - analytics-service/tests/test_trade_read_resume.py
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 171: Code Review Report (round 2)

**Reviewed:** 2026-10-27T15:29:30Z, head `490c56210`
**Depth:** deep
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Scope: the round-1 fixes, `git diff a91bb8cad..HEAD -- analytics-service/` (commits
`ed613df1b`, `b373ffd50`, `b0d29b147`, `d4f021b81` and the two merges). I read the changed code
in context: `_read_bybit_window`, `_read_bybit_range`, `_read_bybit_trades_resumable`, the forced
account crawl's outcome loop, the unforced handler arms, `classify_exception`, and the
probe's scope-less path. Only MEDIUM and above is reported, as asked.

### Round-1 findings: status

| Finding | Status | Evidence |
|---|---|---|
| WR-01 an empty first page of a continuation segment ends the window | **Fixed** | The round-1 repro (`<scratchpad>/probe_empty_seg.py`) now raises `TruncatedTradeRead` `bybit_no_advance` at `equity_reconstruction.py:820`, where it used to return 200 of 500 rows. `empty_continuation` skips both the `oldest + 1` lowering and the inclusive-end retry (`:802-811`), so it always reaches the `else` refusal. A cursor-fetched empty page in a continuation still ends the window cleanly (`:774`), which is correct because that walk has run out. |
| WR-02 a short page that repeats its cursor refuses permanently | **Fixed** | The round-1 repro (`<scratchpad>/probe_repeat_cursor.py`) now returns all 150 rows after 2 calls. A short stalled page ends the window (`:797-798`). Only a full stalled page continues by time. |
| S-1 a window that ended on an uncertain stop is stored | **Fixed** | `_read_bybit_window` returns False on a full page with no cursor (`:791`) and on a short stalled page (`:798`), and True on an empty page or a short page with no cursor. The save at `:1008` is gated on `storable and complete`. The bool matters only when `storable` is true. The window holding now and the straddle window were never stored, and they keep their rows and their `since_ms` cut. Layer 1 (`_read_bybit_range:893`) ignores the bool, which is right because it stores nothing. |
| S-2 a store fault on a big book refuses permanently | **Fix is wrong: see WR-01 below** | The conversion catches the wrong failure, and it masks real refusals. |

Other paths traced, no finding:
- A storable window that always ends uncertain is never stored, so a claim re-reads it. If
  Bybit answered every window's last page that way, a multi-claim book would store nothing
  and stop by name (`TradeReadStalled`) after the stalled-claims limit. That fails closed and
  writes nothing. At round-1 HEAD the same venue behaviour refused as `bybit_no_advance`, so
  this is not a regression. Whether Bybit answers that way is still unmeasured.
- The allocator history probe sets no scope, so it never reaches the `state is None` branch.
  Its `TruncatedTradeRead` classification is unchanged.
- The four affected test files at HEAD (`test_trade_pages.py`, `test_trade_read_resume.py`,
  `test_bybit_two_year_window.py`, `test_reconstruct_force_rebuild.py`) all pass: 107 passed.

## Warnings

### WR-01 (MEDIUM, user-facing): the S-2 conversion relabels deterministic venue refusals as a transient store fault, and never reaches the case it was written for

**File:** `analytics-service/services/equity_reconstruction.py:958-967` (and the S-2 test,
`analytics-service/tests/test_trade_read_resume.py:661-682`)

**Issue:** S-2's premise was that, with no resume, a big book makes layer 1 raise
`TruncatedTradeRead`. That is not true in this branch. `_read_bybit_range` has no page budget
and no claim budget. It reads every window whole, up to `_BYBIT_WINDOW_SEGMENT_CEILING` ×
`_BYBIT_WINDOW_PAGE_CEILING` × `_TRADE_PAGE_LIMIT` (100 × 100 × 100) rows per 7-day window. A book
too big for one run therefore ends on the wall clock: `asyncio.wait_for(...,
_RECONSTRUCT_CRAWL_TIMEOUT_S)` at `:5924-5927` (forced) and `:6001-6003` (unforced) raises
`asyncio.TimeoutError`. That error was ALREADY classified transient (`:6042-6067`, and
`classify_exception` in the forced loop) before this fix.

Layer 1 raises `TruncatedTradeRead` from only three sites:
- `bybit_no_advance`: a venue fault, including the empty continuation page added by this
  round's own WR-01 fix.
- `bybit_segment_ceiling`: one 7-day window holds more than one million rows.
- `bybit_not_supported` after rows were read.

All three are per-window and deterministic. The resumable path calls the same
`_read_bybit_window` over the same window on a first claim (grid origin = `since_ms`), and it
lets the same exception through as permanent. The store cannot change any of these outcomes.
The S-2 test confirms it: it models "over one run's reach" by setting
`_BYBIT_WINDOW_SEGMENT_CEILING = 1`, which is a per-window limit and not a per-run one.

Reproduced at HEAD: the S-2 test's book and settings, with the store UP and an unlimited
budget, compared with the store DOWN (scratch test under `<scratchpad>`):
```
STORE_UP= True  outcome=FAILED kind=permanent msg=the trade read was cut short before the venue ran out of trades; nothing was kept
STORE_UP= False outcome=FAILED kind=transient msg=the trade store was unavailable and the trade read could not finish in one run
```
The same window refuses permanently whenever the store answers. The conversion only affects
claims where the store faulted, and on those it:
1. **Masks a real refusal.** An unforced job ends `transient` and is retried up to
   `max_attempts` (bounded, not forever). A forced rebuild becomes
   `_AccountCrawlRetryableError("transient", "RequestTimeout")` in `_crawl_whole_account`
   (`:5740-5746`). It never reaches `_forced_refusal_result(..., "account_key_read_failed")`,
   so the refusal the forced-rebuild handoff reads is never recorded.
2. **Records a false cause.** `last_error` and the `reconstruct_failed` audit say the store was
   unavailable and the read "could not finish in one run". The real stop was a venue no-advance
   or a window over the segment ceiling. The SFH's own complaint about S-2 was a misattributed
   cause, and this fix produces the mirror image of it.
3. **Is made repeatable by the store faults S-2 named.** These are the deploy-before-migration
   window (tables absent) and a persistent defect inside `_begin_claim`, such as a `TypeError`
   on a malformed state row swallowed by `begin_claim`'s `except Exception`. In both, every
   attempt takes the `state is None` branch, so every retry gets the same false transient
   until attempts run out.

**Fix (minimal):** revert `d4f021b81`'s conversion. Restore
`return await _read_bybit_range(exchange, since_ms, now_ms)` in the `state is None` branch and
the matching docstring sentence. Then replace
`test_a_store_fault_on_a_book_over_one_run_retries_instead_of_failing_permanent` with a pin of
the real behaviour:
- with the store down, a book over one run ends through the `asyncio.TimeoutError` arm as
  `transient` (patch `_RECONSTRUCT_CRAWL_TIMEOUT_S` low and make the fake venue slow);
- a `TruncatedTradeRead` keeps its permanent disposition whether the store is up or down.

Record S-2 as resolved by measurement: the size-bound failure without the store was already
transient, through FLIPRETRY-01. If a store fault should still be told apart from a venue
rejection, that belongs in the store's own WARNING. It must not be done by reclassifying the
venue's exception.

---

_Reviewed: 2026-10-27T15:29:30Z (round 2)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
