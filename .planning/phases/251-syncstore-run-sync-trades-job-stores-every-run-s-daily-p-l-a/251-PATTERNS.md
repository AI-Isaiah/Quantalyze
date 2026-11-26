# Phase 251: SYNCSTORE - Pattern Map

**Mapped:** 2026-11-26
**Files analyzed:** 4 (1 production edit, 1 new test file, 2 test edits)
**Analogs found:** 4 / 4 (one sub-piece, the AST pin over `_record_dq_flag` literals, has no in-repo analog; see "No Analog Found")

Line numbers were re-measured at worktree HEAD `6f8a6ea56` and match 251-RESEARCH.md for `job_worker.py` (handler spans 2109-3071). The plans must still cite by SYMBOL (`plan-anchor-verify` re-resolves anchors). Every analog path below is git-tracked (`git ls-files` checked); no gitignored mirror paths appear.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/job_worker.py` (`run_sync_trades_job`) | service (queued job handler) | CRUD (RPC store + jsonb read-modify-write) + request-response (venue read) | `run_derive_broker_dailies_job` realized-read arm (same file, ~8897-8934) for the verdict/refusal/429 arm; the handler's own existing flag block (2569-2693) and Phase 222 tail (2877-3063) for the rest | exact (same-file, same reader) |
| `analytics-service/tests/test_sync_trades_store_truth.py` (NEW) | test (mocked-supabase handler driver) | request-response + event-driven (real `_record_dq_flag` ContextVar buffer) | `analytics-service/tests/test_okxtrades_cursor.py` (`_make_supabase` / `_FakeAnalytics` / `_run_job`) | exact |
| `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` (EDIT) | test (live-lane) | CRUD against real plpgsql bridge | itself: `_drive` + `_racing_read` + `test_a_row_published_between_the_read_and_the_write_is_not_overwritten` | exact |
| `analytics-service/tests/test_daily_pnl_read_verdict.py` (EDIT, optional pin) | test (pin) | transform | itself: `_DERIVE_ONLY_FLAGS` / D-12 malformed pin (lines 120-196) | role-match (the AST scan has no analog) |

Companion read-only analogs for the mocked SC-5 twin: `analytics-service/tests/test_job_worker.py::TestSyncTradesEnqueueFailurePublishState._run` (lines 3299-3377); for real-buffer flag planting: `tests/test_job_worker.py` ~4722-4795 (`TestRedTeamSyncTradesPreDrainPreservesDqFlag`) and the 429 test ~4870-4905; for the Binance spot-fill row: `tests/test_cron_router.py` `TestADegradedFetchIsNeverOk._SPOT_FILL` (7539-7547).

---

## Pattern Assignments

### `analytics-service/services/job_worker.py` :: `run_sync_trades_job` (service, CRUD + request-response)

**Analog:** `run_derive_broker_dailies_job` realized-read arm, `job_worker.py` ~8897-8934 (verdict, rate-limit re-raise, named refusal), plus the handler's own blocks. Edit in three separable pieces (RESEARCH recommendation): (a) verdict + moved store, (b) flag block, (c) tail try-scopes.

**Imports pattern:** nothing new. `daily_pnl_read_verdict` and `get_and_clear_last_dq_flags` are already imported at module level (lines ~126-127); `Final` already imported (line 58). If the owned-key predicate is a module constant, put it beside the verdict in `services/exchange.py` (RESEARCH Pattern 2) and import it next to `daily_pnl_read_verdict`.

**Piece (a) - drain, verdict, rate limit, refusal. Copy the derive's three-step order** (`job_worker.py` 8902-8913):
```python
_realized_dq_flags = get_and_clear_last_dq_flags()
_realized_verdict = daily_pnl_read_verdict(_realized_dq_flags)
...
if _realized_verdict.rate_limited:
    raise ccxt.RateLimitExceeded(
        "derive_broker_dailies: realized read was rate limited"
    )
if _realized_verdict.reasons:
    ...
```
Insert point in the sync is the ccxt `else:` arm, immediately after the existing drain (lines 2214-2216) and BEFORE `account_balance = await fetch_usdt_balance(ctx.exchange)` (line 2217):
```python
daily_pnl_dq_flags = get_and_clear_last_dq_flags()      # 2214 - the ONE daily drain; do not add a second
if daily_pnl_dq_flags:
    exchange_dq_flags.update(daily_pnl_dq_flags)
account_balance = await fetch_usdt_balance(ctx.exchange)  # 2217 - the moved store goes between these
```
Use STATIC exception text (no venue string). Raising here lands in the outer `except ccxt.RateLimitExceeded as exc:` at 2332-2345 (`_stamp_429`, drain, re-raise; `finally` closes the exchange). Do NOT place the raise inside the nested `except ccxt.RateLimitExceeded:` at 2289; that arm wraps `fetch_raw_trades` only.

**Piece (a) - the store being MOVED** (existing block, lines 2366-2391; move verbatim into the ccxt arm, gate with `elif trades:` after the refusal branch). Two source pins force exact spellings:
```python
if trades:
    def _sync() -> int:
        res = ctx.supabase.rpc(
            "sync_trades",
            {"p_strategy_id": strategy_id, "p_trades": trades},
        ).execute()
        return res.data if isinstance(res.data, int) else 0

    try:
        inserted = await db_execute(_sync)
        logger.info("sync_trades: persisted %s rows for strategy %s", inserted, strategy_id)
    except Exception as e:           # <-- RENAME in the moved copy (see pin below)
        phase1_failed = True
        logger.warning(...)
```
Pins the move must keep green (RESEARCH Q7, verified lines in `tests/test_ana_recon_audit.py`):
- `test_c12_01_phase2_rate_limit_reaches_outer_handler` (212-222): `src.find("except ccxt.RateLimitExceeded") < src.find("except Exception as e")` over the whole function source. Today the first `except ccxt.RateLimitExceeded` is the nested one at 2289 and the first `except Exception as e` is 2299. A moved `except Exception as e:` placed before 2289 REDDENS it, so write `except Exception as persist_exc:` (a name starting with `e` still matches the pin's prefix; `except Exception:` without `as` also avoids it). Note: after the move, `except Exception as e` at 2299 remains the first match, which is fine.
- `test_c12_02_phase1_failed_flag_initialised` (421-441): `phase1_failed` must stay an unannotated `ast.Assign` Name target (line 2167 `phase1_failed = False`). Do NOT write `phase1_failed: bool = False`. Initialise the new `phase1_read_refused = False` (and `phase1_read_ran = False`, `write_needed = False`) beside it at 2167.
- `test_c12_02_phase1_failed_gates_last_sync_at` (444-456): the literal `"if not phase1_failed"` must remain in the source (today line 2791). Keep it, e.g. `_p_last_sync = None if phase1_read_refused else (_now_iso if not phase1_failed else None)`.

**Piece (a) - epilogue consumers of the new `phase1_read_refused`:**
- Fills cursor gate (2726-2732): add `and not phase1_read_refused` beside `and not phase1_failed`.
- `_p_last_sync` (2791): see pin above.
- Skip log (2797-2802): keep the `phase1_failed=%s` text, append the refusal so a held `last_sync_at` is distinguishable.
- Return (3070): `trade_count=0 if phase1_failed else len(trades)` becomes `0 if (phase1_failed or phase1_read_refused) else len(trades)`.
- Leave the follow-on enqueue (2877-2888) and the balance write unchanged (CONTEXT item 2).

**Piece (b) - flag block, core pattern to MODIFY** (existing, 2569-2693). The existing skeleton to keep: `_load_existing_flags` via `db_execute` (NOT `db_read_with_retry`, so the live harness's `_racing_read`, keyed on `fn.__name__ == "_strategy_has_published_numbers"`, never sees it), merge `exchange_dq_flags`, `write_needed`, then the literal-dict upsert at the unchanged site:
```python
phase2_success = _RAW_TRADE_INGESTION_ENABLED and not phase2_failed
needs_flag_write = phase2_failed or phase2_success or phase1_failed     # 2572 - add `or phase1_read_ran`
...
existing_flags = await db_execute(_load_existing_flags)                 # 2598 ; except -> existing_flags = {}, flag_load_failed = True (2599-2609)
...
if write_needed:
    def _stamp_phase2_flags() -> None:
        ctx.supabase.table("strategy_analytics").upsert(
            {
                "strategy_id": strategy_id,
                "data_quality_flags": existing_flags,
            },
            on_conflict="strategy_id",
        ).execute()
```
Keep that upsert argument an inline dict literal at that one site: both censuses read `.upsert({...})` literals (`tests/test_computation_error_provenance_census.py` `EXPECTED_INERT_SITES = 1`, counts only payloads naming `computation_error`; `tests/test_computing_started_at_stamp.py` `EXPECTED_SKIPPED_UNRESOLVED = 0` reddens on a payload it cannot resolve). Do not build the payload in a helper.

The defect to remove (existing, 2673-2674) is the clobber:
```python
            elif exchange_dq_flags_present:
                write_needed = True
            else:
                write_needed = False        # <-- erases write_needed = True set at 2631 / 2636
```
Fix shape per CONTEXT "Research resolutions": initialise `write_needed = False` before the Phase-1 branches (before 2628), only ever OR it up, and gate the Phase-2 success/recovery arms (2643-2674) on "Phase 2 actually ran" (`_RAW_TRADE_INGESTION_ENABLED and not isinstance(ctx.exchange, Mt5Session)`), not on `phase2_failed` being False. A failed flag read (`flag_load_failed`) with Phase 2 not run must skip the write and log at WARNING naming the strategy (an upsert of a guessed payload REPLACES the whole `data_quality_flags` jsonb). The existing recovery arm (2662-2667) stays, gated on Phase 2 having run. This keeps `tests/test_job_worker.py::TestSyncTradesEnqueueFailurePublishState::test_unreadable_publish_state_writes_nothing_and_returns_done` (3481-3497) green: its single scripted `select...maybe_single.execute` raises `RuntimeError`, so the NEW flag read also raises on a flag-OFF run and the test asserts `upserts == []`.

Owned-key replacement, order matters (RESEARCH Example 5): pop owned keys absent from this run's drained set FIRST, merge the drained set SECOND (the existing `existing_flags.update(exchange_dq_flags)` at 2623-2624), then compare owned subsets before/after to decide `write_needed`. Store `verdict.error_class` (regex-validated identifier, omit when `None`) for `daily_pnl_fetch_error_class`, never the raw drained string. `daily_pnl_malformed_*` is NOT matched by the owned predicate (merged as today, never popped). Do not clear a stale `phase1_daily_pnl_persist_failed` on a refused run: gate the existing clear arm (2632-2636) with `and not phase1_read_refused`.

Phase-1 stamp pattern to keep as is (2628-2631):
```python
if phase1_failed:
    existing_flags["phase1_daily_pnl_persist_failed"] = True
    existing_flags["phase1_failed_at"] = datetime.now(timezone.utc).isoformat()
    write_needed = True
```
A read refusal must NOT set `phase1_failed` (the persist never ran), so this stamp is never written for a refusal; the control arm in the new test proves it still lands for a real persist failure.

**Piece (c) - tail try-scope split** (existing 2986-3050; the code to change is 3033-3050):
```python
wrote = await db_execute(_mark_analytics_failed)
if not wrote and await db_read_with_retry(_strategy_has_published_numbers):   # 3034 - the re-read, inside the same try as the write
    logger.error(... "(R2-WR-01)." ...)
    _nothing_published = False
except Exception as mark_exc:  # noqa: BLE001                               # 3043 - catches BOTH the write and the re-read
    logger.exception("... wizard may still hang. Error: %s", ...)             # 3044-3050 - sentence to remove
```
Mirror the SAME function's first publish-read arm for the outcome and wording style (2929-2955, `except read_exc ... else: if _published ... else: _nothing_published = True`; the comment at 2932-2937 "an unreadable state is not 'nothing published'" and T-222-13 is the basis for DONE). Target shape is RESEARCH Example 4 (separate `try` for the write; `try/except/else` for the re-read; re-read raising sets `_nothing_published = False`; write raising keeps `_nothing_published` True so FAILED). Keep verbatim: the R2-WR-01 `logger.error` sentence for the `_raced` branch, the conditional-UPDATE closure, and the FAILED `DispatchResult` at 3055-3063. Pins: `tests/test_no_contact_support_copy.py` requires the constant "Analytics enqueue failed during sync. The next scheduled sync will retry — use the contact form if this persists." to stay inside the function (lines 2998-3001) and AST-scans all `services/` string constants for `contact\s+support`: do not write that phrase in any new log or exception string. New log lines name the strategy id and which call failed, with no venue text.

**Error handling pattern to copy for new log lines** (existing, 2938-2944): `logger.exception("sync_trades: ... for strategy %s ... Error: %s", strategy_id, exc)` for tail failures; `logger.warning("sync_trades: ... strategy %s (%s) ...", strategy_id, ",".join(_verdict.reasons))` for the refusal (closed reason tokens only).

**mypy:** CI runs `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py ...`. Baseline for `services/job_worker.py` was clean; annotate the new constants with `Final[...]` as `exchange.py` does (`DAILY_PNL_RATE_LIMIT_CLASSES: Final[frozenset[str]]`, line 218).

---

### `analytics-service/tests/test_sync_trades_store_truth.py` (NEW; test, request-response + buffer-driven)

**Analog:** `analytics-service/tests/test_okxtrades_cursor.py` (drives the REAL `run_sync_trades_job`, stored-flags-aware `strategy_analytics` double). Import its helpers or copy them (repo precedent: `test_computation_error_provenance_census.py` imports from `test_computing_started_at_stamp.py`). Copying is safer than a cross-test import if the new file needs an ordered call recorder.

**Imports + module-header pattern** (`test_okxtrades_cursor.py` 45-55; `asyncio_mode = auto` in `pytest.ini`, so bare `async def test_*` works and `@pytest.mark.asyncio` is also accepted in this repo):
```python
from __future__ import annotations

import copy
import itertools
import logging
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.job_worker import DispatchOutcome, run_sync_trades_job
```
Add `import ccxt` (as `tests/test_job_worker.py` line 29) and `from services.exchange import _record_dq_flag, get_and_clear_last_dq_flags`.

**Module docstring convention:** a "WHY THIS MATTERS" paragraph plus a `NEUTER` list naming each neuter and the arm that goes RED (copy the shape of `test_okxtrades_cursor.py` 1-43). The N1..N6 neuter plan is in RESEARCH "Validation Architecture" (store back below Phase 2; delete verdict `reasons` branch; delete owned-key pop; drop `phase1_read_ran` from `needs_flag_write`; merge the write and re-read `try` scopes; reintroduce the `write_needed = False` clobber). PROOF-01: `cp` byte backup, see RED, `cp` back, `cmp -s`.

**Stored-flags-aware strategy_analytics double (core fake)** (`test_okxtrades_cursor.py` 191-211; upsert REPLACES `stored_flags`, which is exactly the PostgREST semantics the pop depends on):
```python
class _FakeAnalytics:
    def select(self, *_a: Any, **_k: Any) -> "_FakeAnalytics": return self
    def eq(self, *_a: Any, **_k: Any) -> "_FakeAnalytics": return self
    def maybe_single(self) -> "_FakeAnalytics": return self
    def execute(self) -> Any:
        return MagicMock(data={"data_quality_flags": copy.deepcopy(stored_flags)})
    def upsert(self, payload: dict[str, Any], **_k: Any) -> Any:
        def _execute() -> Any:
            rec.analytics_upserts.append(copy.deepcopy(payload))
            stored_flags.clear()
            stored_flags.update(copy.deepcopy(payload["data_quality_flags"]))
            return MagicMock(data=None)
        return MagicMock(execute=_execute)
```
Extend it for the new cases: a variant whose `execute()` returns `MagicMock(data=None)` (first sync, no row; `one()` yields `{}`, db.py 396-411) and a variant whose `execute()` raises (failed flag read, SC-4). The tail's publish read (`select("computation_status, metrics_json")`) goes through the same `select...maybe_single.execute`, so the SC-5 mocked twin should patch `services.job_worker.db_read_with_retry` keyed on `fn.__name__ == "_strategy_has_published_numbers"` (as the live harness does at lines 229-236) rather than script `execute.side_effect = [..]` (the new flag read would consume a list entry in an implementation-dependent order).

**rpc recorder pattern** (`test_okxtrades_cursor.py` 213-227): `supabase.rpc.side_effect = _rpc` recording `advance_sync_cursor` params, with `data=True` for `advance_sync_cursor` and `0` otherwise, and `stub.execute.side_effect = sync_trades_error` for a failing store. For SC-1 keep ONE ordered list that records `sync_trades` RPC, `fetch_usdt_balance` and the Phase-2 `fetch_raw_trades` call so the order is assertable (RESEARCH Wave 0 gap).

**Driver pattern** (`test_okxtrades_cursor.py` 245-318): patch `services.job_worker._exchange_preflight` to return a ctx whose `.exchange` is `AsyncMock()` (ccxt shape, not `Mt5Session`), `fetch_all_trades`, `fetch_usdt_balance`, `fetch_raw_trades`, `db_execute` (`AsyncMock(side_effect=lambda fn: fn())`) and `_RAW_TRADE_INGESTION_ENABLED` (via `patch`, never `importlib.reload`); key row needs `"id"`, `"exchange"`, `"last_fetched_trade_timestamp"`. IMPORTANT: that file's `_run_job` patches `get_and_clear_last_dq_flags` with `itertools.chain([{}, second], repeat({}))`, "call 1 = the daily drain, call 2 = the fills drain". For this new file do NOT patch the drain; plant flags through the real buffer instead (below), and keep exactly one daily drain in the handler so the existing file's patch order is not shifted.

**Planting flags through the real buffer** (`tests/test_job_worker.py` ~4722-4795 and ~4872-4890; RESEARCH Example 2):
```python
get_and_clear_last_dq_flags()   # clean any residue on this asyncio task first

async def _fetch_all(*_a, **_k):
    _record_dq_flag("daily_pnl_binance_income_fallback", True)
    return [_SPOT_FILL]
```
Spot-fill row shape (`tests/test_cron_router.py` 7539-7547): `{"exchange": "binance", "symbol": "BTC/USDT", "side": "buy", "price": 64000.0, "quantity": 0.01, "order_type": "limit", "timestamp": "2026-10-10T12:00:00+00:00"}`.

**Rate-limit arm pattern** (`tests/test_job_worker.py` ~4872-4905): patch `services.job_worker._stamp_429` with `AsyncMock`, `with pytest.raises(ccxt.RateLimitExceeded): await run_sync_trades_job(job)`, then assert the buffer is empty (`get_and_clear_last_dq_flags() == {}`). Plant `{"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "RateLimitExceeded"}` and the `"DDoSProtection"` variant.

**Cancellation (SC-1) pattern** (RESEARCH Example 1): patch `fetch_raw_trades` with an `await asyncio.sleep(3600)` coroutine, ingestion ON, `await asyncio.wait_for(run_sync_trades_job(job), timeout=0.2)` under `pytest.raises(asyncio.TimeoutError)`, then assert a `sync_trades` rpc was recorded and that it precedes the `fetch_usdt_balance` record.

**Assertion pattern for the advance RPC** (`test_okxtrades_cursor.py` 321-325): `_the_advance(rec)` asserts exactly one `advance_sync_cursor` call and returns its params; assert `["p_last_sync_at"] is None` on refusal, `["p_last_fetched_ts"] is None` (ingestion-ON refused run with fills in hand), and `p_account_balance` still written.

**Test coverage list** (from RESEARCH Phase Requirements to Test Map; parametrize over reasons `daily_pnl_fetch_error`, `daily_pnl_non_usd_okx`, `daily_pnl_truncated_okx`, a Deribit-shaped pair `{"daily_pnl_fetch_error": True, "daily_pnl_unsupported_venue": True}`, a synthetic `daily_pnl_deadline_okx`; controls: `daily_pnl_malformed_okx` alone is NOT a refusal; a real persist failure DOES stamp `phase1_daily_pnl_persist_failed`; clean read pops owned keys but spares `daily_pnl_malformed_*` and `last_success_snapshot`; MT5 run makes no flag read; failed flag read writes nothing; first sync with no row writes only owned keys).

Also add the source-text guard that the old sentence is gone: `assert "wizard may still hang" not in inspect.getsource(run_sync_trades_job)`.

---

### `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` (EDIT; live-lane test)

**Analog:** the same file; add one parameter and one test, copying `test_a_row_published_between_the_read_and_the_write_is_not_overwritten` (447-487).

**Edit 1: `_drive` signature** (159-167): add `reread_raises: bool = False` beside `publish_race_row`; document it in the docstring block 175-181.

**Edit 2: `_racing_read`** (229-236). Existing:
```python
real_read = job_worker.db_read_with_retry

async def _racing_read(fn: Any, *args: Any, **kwargs: Any) -> Any:
    out = await real_read(fn, *args, **kwargs)
    if publish_race_row is not None and fn.__name__ == "_strategy_has_published_numbers":
        admin.table("strategy_analytics").upsert(
            {"strategy_id": strategy_id, **publish_race_row},
            on_conflict="strategy_id",
        ).execute()
    return out
```
Add a call counter (a one-element list or `nonlocal`) incremented only when `fn.__name__ == "_strategy_has_published_numbers"`; when `reread_raises` and the count is 2, `raise RuntimeError("simulated re-read failure")` BEFORE calling `real_read`. The first call still reads (no row, so "nothing published") and then upserts `publish_race_row`, so the conditional UPDATE matches zero rows; the second call is the re-read.

**Edit 3: new test** (copy the shape of 447-487): `_need_supabase()`, `_require_loopback_lane(SUPABASE_URL)`, `admin = _lane_client()`, then
```python
left: dict[str, Any] = {}
result, row, job = _drive(
    admin, tag="reread-raises", seed_row=None,
    publish_race_row={"computation_status": "complete_with_warnings", "computation_warned": True, "metrics_json": _METRICS},
    reread_raises=True, after_handler=left,
)
```
Assert `result.outcome == DispatchOutcome.DONE`, `job["status"] == "done"`, and (after the mark RPC and bridge) `row["computation_status"] == "complete_with_warnings"`, `row["computation_warned"] is True`, `row["metrics_json"] == _METRICS`. Assert the stored row (not just the return value) per the module header ("an offline test can show the handler's return value, never what the owner's row reads afterwards"). Default `attempts_before_claim=None` makes this the LAST attempt, which is what exposes the pre-fix FAILED path (`failed_final` -> bridge branch (b) writes `failed` over the published row).

**Gating (unchanged, copy as is):** `_need_supabase()` skips locally and `pytest.fail`s in CI when unset; `_require_loopback_lane` refuses non-loopback hosts. Locally this module reads `1 passed, 7 skipped`, so the local RED for SC-5 comes from the mocked twin in the new test file (CONTEXT "Decided autonomously").

**Harness facts that the new flag read must not break:** `_HandlerSupabase.table("strategy_analytics")` is the real lane table (141-149), so the NEW flag read hits the real table, reads `data_quality_flags` NULL, is clean, and writes nothing; flag OFF is patched at line 251. Optional extra live arms (RESEARCH Wave 0): A1 (seed an owned key, clean run, assert gone) and Q2 (first-sync refusal creates a `pending` row carrying only the owned keys). These need the stubbed `fetch_all_trades` to plant a flag through `_record_dq_flag`.

---

### `analytics-service/tests/test_daily_pnl_read_verdict.py` (EDIT, optional pin; test, transform)

**Analog:** the same file's D-12 malformed pin and parity style (lines 120-196). Imports to extend (lines 17-27):
```python
from routers.cron import _fetch_degradation
from services.exchange import (
    DAILY_PNL_RATE_LIMIT_CLASSES,
    DailyPnlReadVerdict,
    daily_pnl_read_verdict,
)
```
Add the owned-key predicate to that import list. Pattern to copy for the "malformed is not owned" assertion:
```python
@pytest.mark.parametrize("flag", ["daily_pnl_malformed_okx", "daily_pnl_malformed_bybit", "daily_pnl_malformed_binance"])
def test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing(flag: str) -> None:
    verdict = daily_pnl_read_verdict({flag: True})
    assert verdict.reasons == ()
    assert verdict.rate_limited is False
```
New pins in the same style: (1) every `verdict.reasons` token from a flag set built from the closed reason names is `owned`, and `daily_pnl_malformed_*` is not; (2) the AST scan that every `_record_dq_flag("daily_pnl_...")` literal in `services/exchange.py` is either owned or in the documented non-owned `daily_pnl_malformed_*` set (the 17 literals at `exchange.py` 1836-2402 are the inventory: deadline_okx, truncated_okx, malformed_okx x2, non_usd_okx, malformed_binance, binance_income_fallback, truncated_bybit, deadline_bybit, malformed_bybit x2, fetch_error x3, fetch_error_class x2, unsupported_venue). The AST idiom is `ast.parse` + `ast.walk` over `ast.Call` nodes (as `tests/test_ana_recon_audit.py` 426-436 does over `ast.Assign`); see "No Analog Found".

---

## Shared Patterns

### One shared reader, never a fourth predicate
**Source:** `analytics-service/services/exchange.py` `daily_pnl_read_verdict` / `DailyPnlReadVerdict` (lines 229-283) and `DAILY_PNL_RATE_LIMIT_CLASSES` (218-221).
**Apply to:** the handler edit only. The verdict returns `reasons` (sorted tuple), `error_class` (regex-validated identifier or `None`), `rate_limited`:
```python
rate_limited = bool(flags.get("daily_pnl_fetch_error")) and (
    flags.get("daily_pnl_fetch_error_class") in DAILY_PNL_RATE_LIMIT_CLASSES
)
return DailyPnlReadVerdict(tuple(sorted(reasons)), error_class, rate_limited)
```
`daily_pnl_malformed_*` is deliberately NOT a reason (founder decision D-12; docstring 252-259).

### Drain-before-next-exchange-call (ContextVar buffer)
**Source:** `job_worker.py` 2211-2216 (daily drain) and 2280-2288 / 2297 / 2306 / 2344 (fills drains, including the failure and 429 arms).
**Apply to:** every new path that can raise out of the handler. A new `raise ccxt.RateLimitExceeded` must be reached AFTER the daily drain (buffer already empty) so the outer arm's own drain at 2344 is a no-op; do not add a second `get_and_clear_last_dq_flags()` call in the success path (it would shift the `itertools.chain([{}, second], ...)` patch in `tests/test_okxtrades_cursor.py` 300-308).

### Venue text never reaches a stored flag, exception or log verbatim
**Source:** `exchange.py` `_DAILY_PNL_ERROR_CLASS_RE` (223) and `test_daily_pnl_read_verdict.py::test_a_class_that_is_not_an_identifier_is_dropped_never_kept` (T-186-13); derive's static exception text at `job_worker.py` 8910-8912.
**Apply to:** the new `RateLimitExceeded` message, the stored `daily_pnl_fetch_error_class` (write `verdict.error_class`), and new log lines (strategy id plus closed reason tokens only).

### Flag read-modify-write with REPLACE semantics
**Source:** `job_worker.py` 2574-2594 (`_load_existing_flags`), 2676-2693 (`_stamp_phase2_flags`), and the test double `test_okxtrades_cursor.py` 204-209 (upsert replaces the jsonb). Evidence for REPLACE also in `src/app/api/keys/sync/route.ts:549` per RESEARCH P8; the handler's own comment at 2650-2651 ("PostgREST upsert merges JSONB keys") contradicts it and should be corrected in the same edit (Rule 7).
**Apply to:** the handler flag block. Always send the full merged object read in the same run; never a partial object; skip the write when the read failed and Phase 2 did not run.

### Source-text and census pins that the edit must keep green
**Source / run after the change:**
```
cd analytics-service && python3 -m pytest tests/test_ana_recon_audit.py tests/test_no_contact_support_copy.py tests/test_computation_error_provenance_census.py tests/test_computing_started_at_stamp.py tests/test_mt5_handover.py -k "..." -q -p no:cacheprovider
```
Specifically: `test_ana_recon_audit.py` 212-222 / 421-456, `test_no_contact_support_copy.py` (sentence pin plus `contact\s+support` scan), the two censuses (no new `strategy_analytics` write site), `test_mt5_handover.py` ~690-700 (`_fetch_mt5_account_balance(` with `api_key_id=ctx.key_row.get("id")`; do not touch the MT5 arm at 2169-2197). MT5 must not set `phase1_read_ran`, or its `needs_flag_write` changes (`tests/test_mt5_sync_path.py::test_run_sync_trades_job_mt5_routes_balance_and_skips_ccxt`).

### Mocked-handler tests: patch recipe
**Source:** `tests/test_okxtrades_cursor.py` 283-299 and `tests/test_job_worker.py` 3363-3377. Always patch `_exchange_preflight`, `fetch_all_trades`, `fetch_usdt_balance`, `db_execute` (inline `fn()`), and `_RAW_TRADE_INGESTION_ENABLED` via `patch(...)`; `fetch_raw_trades` when ingestion is ON. Never `importlib.reload`.

### Regression sets to run per wave (read-only, from RESEARCH baselines; do not run full suites)
- Drivers (`1074 passed` baseline): `tests/test_sync_trades_resume_seed.py tests/test_okxtrades_cursor.py tests/test_mt5_sync_path.py tests/test_failed_status_logged.py tests/test_ana_recon_audit.py tests/test_no_contact_support_copy.py tests/test_daily_pnl_read_verdict.py tests/test_okxtrades_ccy.py`
- Handler subset: `tests/test_job_worker.py -k "TestSyncTrades or TestAdvanceSyncCursorFence or TestRedTeamSyncTrades or enqueue_failure or sync_trades"`
- mypy: `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py`

---

## No Analog Found

| File / Piece | Role | Data Flow | Reason |
|--------------|------|-----------|--------|
| AST pin "every `_record_dq_flag(\"daily_pnl_...\")` literal in `services/exchange.py` is owned or `daily_pnl_malformed_*`" (optional, in `tests/test_daily_pnl_read_verdict.py`) | test (pin) | transform | No existing test scans `exchange.py` for `_record_dq_flag` literals (`grep -ln _record_dq_flag tests/` hits only `test_derive_broker_dailies_dualmode.py`, `test_exchange.py`, `test_job_worker.py`, `test_okx_archive_apply.py`, `test_ana_recon_audit.py`, and those call it rather than scan for it). Use the generic `ast.parse`/`ast.walk` idiom at `tests/test_ana_recon_audit.py` 426-436 and walk `ast.Call` nodes whose `func` is the Name `_record_dq_flag` with a `Constant` str first arg starting `daily_pnl_`. |
| Owned-key predicate (`_is_sync_owned_daily_pnl_key`) | utility | transform | New helper; the closest shape is the verdict's own prefix test (`key.startswith(("daily_pnl_truncated_", "daily_pnl_deadline_"))`, `exchange.py` ~268-273). RESEARCH Pattern 2 gives the shape; home (`exchange.py` beside the verdict vs `job_worker.py` module level) is the planner's call. |

## Metadata

**Analog search scope:** `analytics-service/services/job_worker.py` (handler 2109-3071; derive arm 8895-8934), `analytics-service/services/exchange.py` (verdict 215-283, flag stampers), `analytics-service/tests/` (`test_okxtrades_cursor.py`, `test_sync_trades_resume_seed.py`, `test_sync_trades_enqueue_failure_bridge_live.py`, `test_daily_pnl_read_verdict.py`, `test_job_worker.py`, `test_ana_recon_audit.py`, `test_cron_router.py`).
**Files scanned:** about 10 read (targeted ranges only, `job_worker.py` is 19058 lines), plus grep inventories of `_record_dq_flag` literals and handler symbols.
**Pattern extraction date:** 2026-11-26
