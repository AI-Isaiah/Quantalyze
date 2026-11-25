# Phase 223: FLOWKINDS - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 11 (4 source files modified, 6 test files modified or extended, 1 docstring-only edit counted with the tests)
**Analogs found:** 11 / 11 (every analog verified git-tracked; no gitignored mirror is cited)

All paths are relative to `analytics-service/`. Anchors are by symbol, not by line (the repo's
citation-drift rule; `plan-anchor-verify` re-resolves symbols). Every grep below was run with
`grep -a`. Every excerpt is quoted from the file as it stands at this worktree's HEAD.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `services/okx_archive_job.py` (`_live_reference`, one import) | service (job step) | request-response, named-stop | `run_derive_broker_dailies_job` funding branch in `services/job_worker.py` (mapping), `_check_live_realized_flags` in the same file (`_Stop` shape) | exact |
| `services/funding_fetch.py` (`fetch_funding_bybit` keyword, new `bybit_funding_windows`) | service (fetcher) | request-response, paginated walk | `fetch_funding_bybit` itself plus `_windows` in `services/exchange_pagination.py` | exact (self-extension) |
| `services/job_worker.py` (`run_sync_funding_job`, one private store helper after it) | service (job handler) | batch, CRUD upsert, event-driven retry | `run_sync_funding_job` itself (H-1115 error branch), `upsert_funding_rows` slicing loop | exact (self-extension) |
| `tests/test_okx_archive_apply.py` (two `_funding` fakes, one new decision test) | test | request-response | `TestLiveCrawlFlags::test_a_page_cap_truncation_is_a_named_stop_never_a_partial_series` | exact |
| `tests/test_job_worker_sync_funding.py` (drop pin x3 venues, C27 tests, one updated test) | test | request-response, timeout | `TestRunSyncFundingJob` in the same file, `TestOnMalformedRaise` row builders in `tests/test_funding_fetch.py`, `_dispatch_overrun` in `tests/test_derive_broker_dailies_dualmode.py` | role-match |
| `tests/test_job_worker_funding_cursor.py` (two deliberate updates) | test | request-response | the file's own `_ctx_with_funding_cursor` | exact |
| `tests/test_funding_fetch.py` (`until_ms` and window-helper tests) | test | request-response | `TestOnMalformedRaise` and `_bybit_mock_with_fallback` | exact |
| `tests/test_bybitreads_census_pins.py` (docstring sentence only) | test | n/a | itself | exact |
| `services/exchange.py` (`daily_pnl_read_verdict` docstring, one line) | service | n/a | itself | exact |
| `tests/test_daily_pnl_read_verdict.py` (docstring of the D-12 pin, no code) | test | n/a | itself | exact |
| `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` | records | n/a | see Shared Patterns, records | exact |

## Pattern Assignments

### `services/okx_archive_job.py::_live_reference` (service, named-stop)

**Analog 1, the mapping to copy:** the funding branch of `run_derive_broker_dailies_job` in `services/job_worker.py`.

Call shape (Bybit arm; the OKX arm is identical in the keyword):
```python
funding = await asyncio.wait_for(
    fetch_funding_bybit(
        ctx.exchange, funding_label, None, on_malformed="raise"
    ),
    timeout=_BROKER_CRAWL_TIMEOUT_S,
)
```
Mapping, in the order the derive uses (rate limit and ceiling first, then malformed):
```python
except (ccxt.RateLimitExceeded, ccxt.DDoSProtection):
    raise
except PaginationCeilingExceeded:
    return await _refuse_incomplete_read(
        "funding_truncated", None, permanent=True, read="funding"
    )
except FundingRowsMalformed:
    return await _refuse_incomplete_read(
        "funding_rows_malformed", None, permanent=True, read="funding"
    )
```
Import (inside the derive, from `services.funding_fetch`): `FundingRowsMalformed, fetch_funding_binance, fetch_funding_okx, fetch_funding_bybit`.

**Analog 2, the `_Stop` shape:** `_check_live_realized_flags` in the same file. It raises the closed class with a fixed-literal detail:
```python
if flags.get("daily_pnl_truncated_okx"):
    raise _Stop("live_anchor_unusable", "live_realized=truncated")
```
and `_live_reference` already uses the `from None` form for the neighbouring flows stop:
```python
except NavReconstructionError:
    # A coin flow with no same-day price, or a schema-drifted amount: ... (Message dropped: it can carry
    # a raw amount.)
    raise _Stop("live_anchor_unusable", "live_flows=unvaluable") from None
```
`_Stop.__init__` asserts the class is in `STOP_CLASSES`, so `live_anchor_unusable` (an existing member, not in `TRANSIENT_STOP_CLASSES`) needs no new class and no closed-set pin edit.

**Current import and call to change** (module-level import, line is `from services.funding_fetch import fetch_funding_okx`; the call is the only `fetch_funding_okx` use in the file):
```python
funding = await _within(
    budget, fetch_funding_okx(exchange, api_key_id, None),
    step="live_funding", cap=_BROKER_CRAWL_TIMEOUT_S,
)
```

**Target shape to copy together** (ruling 1):
```python
from services.funding_fetch import FundingRowsMalformed, fetch_funding_okx
...
try:
    funding = await _within(
        budget,
        fetch_funding_okx(exchange, api_key_id, None, on_malformed="raise"),
        step="live_funding", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
except FundingRowsMalformed:
    raise _Stop("live_anchor_unusable", "live_funding=malformed") from None
```
Constraints the planner must carry:
- The mapping MUST be inside `_live_reference`: `_within` converts only its own `asyncio.timeout` expiry into `_Stop("claim_budget_exceeded", ...)`, and `run_okx_archive_rebuild_job` catches only `_Stop` and the ccxt rate-limit classes, so an escaped `FundingRowsMalformed` reaches `dispatch`'s generic classification with no result block.
- Keep the module-level name `fetch_funding_okx` in `okx_archive_job`: tests monkeypatch `okx_archive_job.fetch_funding_okx`.
- Hunk is the funding `_within(...)` block only. Do not touch `_check_live_realized_flags`, `fetch_account_equity_and_upnl_usd` or `fetch_all_trades` lines (Phase 232 overlap).
- Refresh `_live_reference`'s docstring (now refuses a malformed funding row by name).

---

### `services/funding_fetch.py::fetch_funding_bybit` and new `bybit_funding_windows` (service, paginated walk)

**Analog:** the function itself plus `_windows` in `services/exchange_pagination.py`.

Current signature and the `now_ms` line to make overridable:
```python
async def fetch_funding_bybit(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
    *,
    on_malformed: Literal["drop", "raise"] = "drop",
) -> list[FundingFeeRow]:
...
    dropped = [0]  # boxed for the closure

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
```
The walk call that consumes it:
```python
walk = await walk_paginated(
    contract, since_ms=since_ms, now_ms=now_ms, fetch_page=_fetch_page
)
```
Contract fields that make the per-window call reproduce today's requests (`window_max_days=7`, `default_lookback_days=BYBIT_FUNDING_DEFAULT_LOOKBACK_DAYS`, `inst_types=("linear", "inverse")`).

The seam to reuse, `_windows` in `services/exchange_pagination.py`:
```python
window_ms = window_max_days * _MS_PER_DAY
w_start = start if start is not None else 0
while w_start < now_ms:
    w_end = min(w_start + window_ms, now_ms)
    yield (w_start, w_end)
    w_start = w_end + 1
```
Because a handler window has `w_end - w_start <= 7 d`, `fetch_funding_bybit(..., w_start, until_ms=w_end)` yields exactly the one pair `(w_start, w_end)`. Add `until_ms: int | None = None` (keyword-only, default means "now") next to `on_malformed`; add the public helper `bybit_funding_windows(since_ms, now_ms)` beside the fetcher so the handler never imports the private `_windows` and the 365-day lookback decision stays in this file. Never pass `until_ms` with `since_ms=None` from the handler. Refresh the docstring.

Compatibility proof for the planner to run, not assume: callers pass `(exchange, label, since_ms)` positionally and optionally `on_malformed=` (the derive, the composite path, `scripts/bybit_reconcile.py` and the probe scripts), so a defaulted keyword breaks none; the Phase 231 C27 pin calls `fetch_funding_bybit(exchange, "s", None)` and stays green.

---

### `services/job_worker.py::run_sync_funding_job` (service, batch upsert with retry)

**Analog:** the function itself. Pieces to keep verbatim:

Cursor lookup (unchanged):
```python
cursor_res = await db_execute(_load_funding_cursor)
cursor_rows = getattr(cursor_res, "data", None) or []
max_ts = cursor_rows[0].get("timestamp") if cursor_rows else None
since_ms = _funding_since_from_cursor(max_ts)
```
Lazy import block (keep lazy so `patch("services.funding_fetch.<name>")` keeps working; add `bybit_funding_windows` to the same block):
```python
from services.funding_fetch import (
    fetch_funding_binance,
    fetch_funding_okx,
    fetch_funding_bybit,
    upsert_funding_rows,
)
```
Unsupported-exchange permanent failure, the 429 stamp and the exchange close (all stay; the close must wrap the WHOLE window loop so the exchange stays open to the last window):
```python
else:
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"sync_funding: exchange {exchange_name} not supported",
        error_kind="permanent",
    )
except ccxt.RateLimitExceeded as exc:
    await _stamp_429(ctx.supabase, ctx.key_row, exc)
    raise
finally:
    try:
        await aclose_exchange(ctx.exchange)
    except Exception:  # pragma: no cover
        pass
```
The H-1115 error-branch shape that the per-window store must reproduce (same log line, same `DispatchResult`):
```python
for err in upsert_errors:
    logger.error(
        "sync_funding: upsert_funding_rows batch failed for "
        "strategy %s: %s",
        strategy_id, err,
    )
return DispatchResult(
    outcome=DispatchOutcome.FAILED,
    error_kind="transient",
    error_message=(
        f"sync_funding: {len(upsert_errors)} upsert "
        f"batch(es) failed: {upsert_errors[:3]}"
    ),
)
```
The slicing idiom to copy for the new private helper (placed directly after `run_sync_funding_job`), from `upsert_funding_rows` in `services/funding_fetch.py`:
```python
for i in range(0, len(rows), batch_size):
    batch = rows[i : i + batch_size]
```
use `FUNDING_UPSERT_BATCH_SIZE` as the slice size and call the UNCHANGED `upsert_funding_rows(supabase, slice)` per slice (its continue-past-error behaviour is pinned by `TestUpsertFundingRowsErrors::test_partial_batch_failure_records_error_continues` and `scripts/backfill_funding.py` shares it, so do not add a flag to it).

Target structure (Bybit arm only; Binance and OKX keep one fetch and one upsert after the walk, default `on_malformed="drop"`):
```python
# sketch, not final code
now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
for w_start, w_end in bybit_funding_windows(since_ms, now_ms):   # oldest first
    rows = await fetch_funding_bybit(ctx.exchange, strategy_id, w_start, until_ms=w_end)
    failed = await _store_funding_window(ctx.supabase, strategy_id, rows)
    if failed is not None:
        return failed                                              # FAILED transient; walk stops
```
Invariants the helper must hold (the cursor is `max(funding_fees.timestamp)` minus `FUNDING_CURSOR_OVERLAP_DAYS`, so persistence order is the correctness story):
1. `rows.sort(key=lambda r: r["timestamp"])` ascending before storing.
2. Store in `FUNDING_UPSERT_BATCH_SIZE` slices, stop at the FIRST slice whose `errors` is non-empty (return the H-1115 `DispatchResult`).
3. Empty window returns `None` without touching the upsert.
4. No self-deadline and no catch of `asyncio.TimeoutError`/`CancelledError`; the handler timeout stays the only stop (a timeout is classified transient with the text `Handler exceeded timeout` by `classify_exception` in the same module).
5. `try/except ccxt.RateLimitExceeded` and `finally: aclose_exchange` wrap the whole loop.

Decision recorded in code: keep `on_malformed="drop"` default on every arm; refresh the docstring with the windowed walk and the reason for dropping. Hunks stay inside `run_sync_funding_job` plus the one helper (Phase 232 edits the same file around `run_sync_trades_job`).

---

### `tests/test_okx_archive_apply.py` (test, request-response)

**Analog for the decision test:** `TestLiveCrawlFlags::test_a_page_cap_truncation_is_a_named_stop_never_a_partial_series`, assertion block to copy:
```python
outcome = await _run(_meta("calibrate", [STRATEGY_ID]))

assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
assert outcome.error_message == "okx_archive_rebuild: live_anchor_unusable live_realized=truncated"
assert world.result()["reconcile"] is None
_no_writes_but_progress(world, db)
```
Setup idiom: `db = _db_with((STRATEGY_ID, GAP_A))`, `world = _install(monkeypatch, db, live, q3=_standard_q3())`.

**Real-fetcher capture idiom (so the test can fail when the kwarg is removed):** the file already captures a real seam at import for the same reason:
```python
#: Captured at import (collection), before any test patches the module: the base harness
#: installs a no-op for the evaluation seam, and these tests need the real one back.
REAL_RUN_EVALUATION = okx_archive_job._run_evaluation
```
Copy that for `REAL_FETCH_FUNDING_OKX = funding_fetch.fetch_funding_okx` (captured at import) and restore it with `monkeypatch.setattr(okx_archive_job, "fetch_funding_okx", REAL_FETCH_FUNDING_OKX)` after `_install` (which installs the fake `_funding`).

**Exchange-level fake:** `_FakeExchange.__getattr__` in `tests/test_okx_archive_job.py` serves `world.answers[<private_ method>]`, a value or a callable. Set `world.answers["private_get_account_bills"] = {"data": [good, bad]}` and `world.answers["private_get_account_bills_archive"] = {"data": []}`. Row shapes (one good, one blank-`instId` bad) are the `_okx` builder in `tests/test_funding_fetch.py::TestOnMalformedRaise`.

**Required fake edits** (otherwise `TypeError` on the new keyword): the two fixed-signature fakes, `_funding` inside `_install` and the second `_funding` inside `TestClaimBudget` (the budget test), change from
```python
async def _funding(exchange: Any, label: str, since_ms: Any) -> list[dict[str, Any]]:
```
to accept `**kwargs: Any`. Keep `live.calls.append(("funding", since_ms))`.

Parametrize the decision test over `["calibrate", "apply"]`; confirm the apply-mode input validation accepts a dummy `approved_fingerprint` (the stop fires before the fingerprint comparison). Stay local to the `_funding` fakes and the one new test (Phase 232 may edit the `_equity`/`_trades` fakes).

---

### `tests/test_job_worker_sync_funding.py` (test, request-response and timeout)

**Analog for structure:** the file's `TestRunSyncFundingJob`: `_build_mock_ctx(exchange_name)` and the patch stack
```python
with patch(
    "services.job_worker._exchange_preflight",
    new=AsyncMock(return_value=ctx),
), patch(
    "services.funding_fetch.fetch_funding_bybit",
    new=mock_fetch,
), patch(
    "services.funding_fetch.upsert_funding_rows",
    new=mock_upsert,
):
    result = await run_sync_funding_job(job)
```
and the assertion tail `ctx.exchange.close.assert_awaited()`.

**Drop-pin decision test (three venues):** copy the row builders `_binance`, `_okx`, `_bybit` from `tests/test_funding_fetch.py::TestOnMalformedRaise` (one good row plus one blank-symbol row; the Bybit builder uses `_bybit_mock_with_fallback(page)` so per-window calls get the page then empty pages). Do NOT patch `fetch_funding_*` with a mock returning clean rows (cannot fail); patch only `upsert_funding_rows` and give `ctx.exchange` the builder's fake exchange. For Bybit give the cursor a timestamp inside the last 6 days so one window runs. Assert `DispatchOutcome.DONE`, exactly one row (the good one) reached the upsert, caplog contains `dropped 1 malformed rows`, nothing raised.

Cursor wiring note: `_build_mock_ctx` uses a bare `MagicMock` supabase, so the cursor read yields a non-string, `_funding_since_from_cursor` returns `None`, and the Bybit arm becomes a 53-window walk. Use `_ctx_with_funding_cursor(max_ts, last_sync_at)` from `tests/test_job_worker_funding_cursor.py` (it sets `ctx.supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(data=data)`) for a recent cursor.

**C27 cancelled-walk test (real `dispatch` plus real `asyncio.wait_for`):** copy the budget-override idiom from `_dispatch_overrun` in `tests/test_derive_broker_dailies_dualmode.py`:
```python
with (
    patch.dict(TIMEOUT_PER_KIND, {"derive_broker_dailies": 0.05}),
    patch("services.job_worker.run_derive_broker_dailies_job", new=_never_finishes),
    ...
):
    result = await dispatch(job)
```
For this phase use `monkeypatch.setitem(jw.TIMEOUT_PER_KIND, "sync_funding", 0.3)` (the `test_account_identity_stamper.py` form) and an async fake `fetch_funding_bybit` where windows 1 and 2 return rows with datetime `timestamp` immediately and window 3 does `await asyncio.sleep(30)`. Assert FAILED, `error_kind == "transient"`, message starts `Handler exceeded timeout`, the upsert awaited exactly twice with rows in ascending order. Then a second run whose cursor returns the newest stored timestamp: first fetch `since_ms` equals that timestamp minus `FUNDING_CURSOR_OVERLAP_DAYS` in ms, later windows contiguous (`next_start == prev_end + 1`), walk ends at about now.

**Stop-at-first-error test:** an upsert mock whose second slice returns `{"errors": ["..."]}`; assert no third slice and the H-1115 transient result (same assertions as `test_upsert_errors_routes_to_failed_transient`).

**Deliberate update:** `TestRunSyncFundingJob::test_happy_path_calls_upsert_with_rows` (bybit, bare MagicMock cursor, rows without `timestamp`): it now walks 53 windows and the ascending sort would raise `KeyError`. Preserve the intent (non-empty fetch reaches `upsert_funding_rows`, DONE) by giving the rows `timestamp` values and a recent cursor, or by asserting per window.

---

### `tests/test_job_worker_funding_cursor.py` (test, two deliberate updates)

**Analog:** the file's own `_ctx_with_funding_cursor` and `TestRunSyncFundingJobCursorWiring`. Current assertions that break under the windowed walk:
```python
mock_fetch.assert_awaited_once()
# fetch_funding_bybit(exchange, strategy_id, since_ms)
assert mock_fetch.await_args.args[2] == expected_since
assert mock_fetch.await_args.args[2] != parse_since_ms(newer_last_sync)
```
and
```python
mock_fetch.assert_awaited_once()
assert mock_fetch.await_args.args[2] is None
```
Preserve the intents: (1) the FIRST call's `args[2]` equals `max(funding_fees.timestamp) - overlap` and differs from the `last_sync_at` value (use `mock_fetch.await_args_list[0]`); (2) an empty table backfills 365 days regardless of `last_sync_at`: first window starts within a few seconds of now minus 365 days, windows contiguous, last window ends at about now. Leave `TestFundingSinceFromCursor` untouched.

---

### `tests/test_funding_fetch.py` (test, fetcher-level)

**Analog:** `TestOnMalformedRaise` for builders, and `_bybit_mock_with_fallback` for serving a response list then `_BYBIT_EMPTY_PAGE`:
```python
response_list = list(responses)
call_count: dict[str, int] = {"n": 0}

async def _side_effect(*args, **kwargs) -> dict:
    idx = call_count["n"]
    call_count["n"] += 1
    if idx < len(response_list):
        item = response_list[idx]
        if isinstance(item, BaseException):
            raise item
        return item
    return _BYBIT_EMPTY_PAGE

return AsyncMock(side_effect=_side_effect)
```
New tests (name them with `until_ms` so `-k until_ms` selects them): `until_ms = since_ms + 3 days` makes every request carry `endTime == until_ms` and exactly one window runs; `bybit_funding_windows(since_ms, now_ms)` equals the window list one full walk uses (+1 ms seam; 53 windows for a first walk). Key the fake on `startTime` or use a recent range, or a per-window walk upserts the same page 53 times (pitfall 4 in RESEARCH). Existing tests call `fetcher(ex, STRATEGY_ID, since_ms=None, ...)` and must stay green unedited.

---

### Docstring-only edits (no behaviour)

- `tests/test_bybitreads_census_pins.py`: module docstring sentence "C27 is the first Bybit funding walk being longer than the `sync_funding` handler budget" and the C27 test docstring sentence "the fix is owned outside this phase": update to "fixed by 223". The test body (a direct `fetch_funding_bybit(exchange, "s", None)` call and `TIMEOUT_PER_KIND["sync_funding"] == 180`) stays byte-identical and must stay green. The file never opens `231-CENSUS.md`; do not edit that census (Phase 231 owns it).
- `services/exchange.py`, the `daily_pnl_read_verdict` docstring: replace the pointer to `[186-REALIZED-MALFORMED-COUNT]` with the recorded reading (0 flags on every measured key and strategy, 2026-11-24, `223-PROD-MALFORMED-COUNT.md`) and ruling 2. One line only (Phase 232 edits this file).
- `tests/test_daily_pnl_read_verdict.py::test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing`: same pointer replacement in the docstring. Code stays: `verdict = daily_pnl_read_verdict({flag: True})`, `assert verdict.reasons == ()`. This test IS FLOWK-03's pin (D-12); do not touch `_check_live_realized_flags`.

## Shared Patterns

### Named refusal, never a quiet pass
**Source:** `run_derive_broker_dailies_job` funding branch (`except FundingRowsMalformed:` then `_refuse_incomplete_read("funding_rows_malformed", None, permanent=True, read="funding")`), and `_Stop(...)` in `okx_archive_job`.
**Apply to:** `_live_reference`. Fixed-literal detail, `from None`, count-only exception messages (`FundingRowsMalformed` carries venue and count only, pinned by `TestOnMalformedRaise::test_raise_mode_refuses_a_walk_that_dropped_a_row`).

### Decision tests drive the real caller and fail when the decision flips
**Source:** `REAL_RUN_EVALUATION` capture in `tests/test_okx_archive_apply.py`; `TestOnMalformedRaise` row builders in `tests/test_funding_fetch.py`.
**Apply to:** every new decision test. Avoid the shape in `tests/test_derive_broker_dailies_dualmode.py::test_malformed_funding_rows_are_refused_and_asked_for_with_raise`, which feeds a fake that raises `FundingRowsMalformed` (a stub raising the exception stays green if the keyword is removed from the call; the derive test escapes that only by also asserting `await_args.kwargs.get("on_malformed") == "raise"`). For the OKX stop, mock at the exchange endpoint; for `sync_funding`, patch only the upsert.

### Neuter, see RED, restore from a byte backup (PROOF-01)
**Source:** project rules (no git checkout/restore/stash on uncommitted work). Procedure per decision: `cp <file> <scratch>/<name>.bak`, apply the neuter edit, run the test (expect RED), `cp` back, `cmp`, run again (GREEN). The eight neuter edits are tabulated in RESEARCH "PROOF-01: proposed neuter edits".

### Failure classification already exists
**Source:** `dispatch` and `classify_exception` in `services/job_worker.py` (`asyncio.TimeoutError` becomes `("transient", "Handler exceeded timeout: ...")`).
**Apply to:** C27. Do not catch the timeout in the handler; a timeout is a visible failure, retried, and each attempt keeps the windows it stored.

### Gates and commands
`pytest` and `mypy` run from `analytics-service/` only. mypy path set: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. Relevant quick set: `tests/test_job_worker_sync_funding.py tests/test_job_worker_funding_cursor.py tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py tests/test_okx_archive_apply.py tests/test_okx_archive_job.py tests/test_daily_pnl_read_verdict.py`.

### Records (ship PR)
**Source:** project instructions on CHANGELOG discipline and TODOS.md holding open work only. Delete the `[186-OTHER-FUNDING-CALLERS-DROP]` and `[186-REALIZED-MALFORMED-COUNT]` entries from `TODOS.md` (do not tick them), name both in the CHANGELOG entry, state the composite caller is out of scope by F-2 and not fixed, state C27 is fixed here, bump `VERSION` and `package.json` byte-equal in the same commit. Never write a CI skip token in a commit or PR body; a ship branch changes nothing under `.planning`.

## No Analog Found

| File / Piece | Role | Data Flow | Reason |
|--------------|------|-----------|--------|
| the per-window, oldest-first, ascending-sorted, stop-at-first-error store loop in `run_sync_funding_job` | service | batch with cursor-resume | No existing handler persists per window; `upsert_funding_rows` continues past a failed slice by design and OKX/Binance upsert once after the walk. Use RESEARCH "Pattern 2: C27" (sketch plus the prefix invariant). The slicing idiom and the H-1115 error return are the two reusable halves quoted above. |
| `bybit_funding_windows` (public window helper) | utility | transform | Thin wrapper over the private `_windows`; no other fetcher exposes its window list. Shape is in RESEARCH Pattern 2. |

## Metadata

**Analog search scope:** `services/okx_archive_job.py`, `services/funding_fetch.py`, `services/exchange_pagination.py`, `services/job_worker.py` (`run_sync_funding_job`, `run_derive_broker_dailies_job`, `dispatch`), and the `tests/` files named above (`test_okx_archive_apply.py`, `test_okx_archive_job.py`, `test_job_worker_sync_funding.py`, `test_job_worker_funding_cursor.py`, `test_funding_fetch.py`, `test_bybitreads_census_pins.py`, `test_derive_broker_dailies_dualmode.py`, `test_account_identity_stamper.py`, `test_daily_pnl_read_verdict.py`).
**Files scanned:** about 14 read or targeted-grepped; all 11 source and test files named in this map confirmed git-tracked with `git ls-files`.
**Pattern extraction date:** 2026-11-24
