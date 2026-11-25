# Phase 231: BYBITREADS - Pattern Map

**Mapped:** 2026-11-23
**Files analyzed:** 15 rows in the classification table (13 code/test rows, 1 no-change service file, 1 row of 3 phase-dir documents)
**Analogs found:** 13 of 14 rows that need one (11 exact, 2 role-match, 1 none: the cassette-to-markets fixture helper); the `bybit_unified_flows.py` row is n/a (no code change). Sub-patterns with no analog are listed separately under "No Analog Found".

All paths are repo-relative. Every analog below was checked with `git ls-files` (one call over all 17 service/test/script analogs returned 17 tracked paths, plus the earlier call over the probe, cassette and test analogs) and is tracked source (no gitignored mirror paths). Line numbers were read at the worktree HEAD on 2026-11-23; re-resolve by symbol before copying an anchor into a PLAN (`plan-anchor-verify` fails on a bad `file:line`), because 223 and 232 also edit `exchange.py` and `positions.py`. Anchors marked "per RESEARCH" were carried from RESEARCH and not re-read here; verify them with `grep -n` before anchoring.

Scope reminders from CONTEXT/RESEARCH that shape every excerpt below: write scopes are BY SYMBOL; no edit to `run_sync_trades_job`, `advance_fetched_cursor`, any stitch or composite file, OKX branches, or flow kinds; no address, id, amount or home path in any tracked text; error classes raised here carry STATIC text (no venue text, no counts), because `phase2_error_message = str(e)[:200]` is stored.

## File Classification

| New/Modified File (symbol scope) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/exchange.py`: new `fetch_bybit_stable_wallet_with_status` + the Bybit dispatch in `fetch_account_equity_usd` and `fetch_account_equity_and_upnl_usd` (plan 06, VREAD-01) | service | request-response (one balance read) | `fetch_usdt_balance_with_status` (same file, 3101-3152) + `_price_wallet_totals` (`services/equity_reconstruction.py`, 634-710) | exact (contract) + exact (rule) |
| `analytics-service/services/exchange.py`: `_fetch_raw_trades_bybit` + one named error class + one `ProviderPaginationContract` (plan 04, VREAD-03) | service | batch / windowed cursor walk | `fetch_bybit_unified_flows` (`services/bybit_unified_flows.py`, 144-227) and the contract in `fetch_funding_bybit` (`services/funding_fetch.py`, 829-850) | exact |
| `analytics-service/services/positions.py`: `_fetch_positions_bybit`, `_parse_bybit_v5_positions`, `_normalize_ccxt_position` (Bybit arm), `_bybit_ccxt_has_critical_fields`, one typed error (plan 03, VREAD-02) | service | request-response, 3 category reads | `_normalize_deribit_position` (same file, 109-230) for coin to USD; `fetch_bybit_unified_flows` for the typed refusal | role-match (units), exact (typed refusal) |
| `analytics-service/scripts/bybitreads_probe.py` (new, plan 02) | utility (worker-only probe) | batch, read-only, redacted output | `analytics-service/scripts/derivegaps_probe.py` | exact |
| `analytics-service/tests/test_bybitreads_probe.py` (new, plan 02) | test | request-response | `analytics-service/tests/test_derivegaps_probe.py` | exact |
| `analytics-service/tests/test_upnl_venues.py`: flip the coin-coverage pin, make `_fake_bybit` params-aware, add shared-constant test (plans 03, 06) | test | request-response | the same file (383-406, 166-178) | exact |
| `analytics-service/tests/test_positions.py`: USDC, inverse, three-category, fallback-limit/cursor, unusable-mark tests (plan 03) | test | request-response | the same file (`TestFetchPositionsBybitHappy` 233-253, `TestFetchPositionsBybitFallback` 260-282, `TestFetchPositionsDeribit` 430+) | exact |
| `analytics-service/tests/test_exchange.py`: windowed-walk gate with a venue-rule fake, cap-hit test, 24 h one-window test, flip three `since_ms=None` tests, split `test_bybit_binance_wedge_zero`, add stable-wallet arms (plans 04, 06) | test | batch | `TestClusterIBybitPageCapTruncationFlag` (5041-5097), `TestBybitDailyPnlStartTimePagination` (5262+), `TestClusterIC1301BybitCategoryGuard` (5683-5757), `test_bybit_binance_wedge_zero` (5852-5871) | exact |
| `analytics-service/tests/_trade_pages.py` (extend or reuse): a raw `execution_list` venue-rule fake | test helper | batch | the same file: `bybit_select` (125-147), `real_ccxt_client` `_execution_list` (419-436), `UnifiedLogBook` (274-336) | exact (reuse `bybit_select`) |
| `analytics-service/tests/test_allocator_positions.py`: Bybit cases that stub `fetch_positions` once (`test_bybit_uta_locked_collateral_surfaces_as_spot_row` 1206, `test_bybit_uta_multi_coin_walletbalance_extraction` 1255, `test_bybit_walletbalance_never_drops_nonzero_ccxt_total` 1299, `test_bybit_malformed_info_falls_back_to_ccxt_total` 1364): re-check each against the three-category fan-out (plan 03) | test | request-response | the same file | exact |
| `analytics-service/tests/test_nav_marks_l4_read.py`: add a USDC "admitted" case beside the BTC `wallet_basis_mismatch` case (plan 06) | test | request-response | the same file (891-923) | exact |
| `analytics-service/tests/test_derive_broker_dailies_dualmode.py`: VREAD-04 pin (existing `replace` pin stays; optionally one named-visibility pin) (plan 05) | test | event-driven (derive) | the same file, `TestBybitUnifiedFlowSource` (3270-3300) | exact |
| `analytics-service/tests/` shared real-market fixture helper (cassette to real ccxt markets) (plan 03) | test helper | transform (offline) | none (see "No Analog Found") | none |
| `analytics-service/services/bybit_unified_flows.py` | service | n/a | n/a: NO code change expected in this phase; evidence and pins only | n/a |
| `.planning/phases/231-*/231-CENSUS.md`, `231-FOUNDER-VREAD05.md`, `231-PROBE-RESULT.md` (plans 01, 02, orchestrator) | doc | n/a | Phase 186 `186-04-PLAN.md` / `186-04-SUMMARY.md` (probe run record), `.planning/milestones/v1.20-phases/186-derivegaps-*/` | role-match |

## Pattern Assignments

### 1. `services/exchange.py`: the Bybit stable-wallet helper (plan 06, VREAD-01, last wave, blocked on Phase 229 merged)

**Analog A (contract):** `analytics-service/services/exchange.py` `fetch_usdt_balance_with_status`, lines 3101-3152. The new helper must return the SAME three-state tuple.

**Imports pattern.** `exchange.py` already imports `from services.closed_sets import is_trade_side` and `from services.redact import scrub_freeform_string` at lines 17 and 20. Add `from services.price_rule import is_stable_value` beside them. `services/price_rule.py` imports only `services.closed_sets` (line 63), so there is no import cycle. Do NOT import `services.job_worker` from `exchange.py`.

**Core pattern to copy, adjusting only the sum** (lines 3126-3152):
```python
    try:
        balance = await exchange.fetch_balance()
    except Exception as e:
        # NEW-C13-10: ccxt NetworkError/AuthError for signed requests embed
        # &signature=<HMAC-SHA256> in str(e). Use scrub_freeform_string and
        # log at WARNING with exc_class for triage ...
        logger.warning(
            "Could not fetch account balance: exc_class=%s scrubbed=%s",
            type(e).__name__, scrub_freeform_string(str(e)),
        )
        return None, True
    try:
        usdt_total = balance.get("total", {}).get("USDT", 0)
        if usdt_total and float(usdt_total) > 0:
            return float(usdt_total), False
    except (TypeError, ValueError, AttributeError) as e:
        logger.error(
            "Malformed balance response shape: exc_class=%s scrubbed=%s",
            type(e).__name__, scrub_freeform_string(str(e)),
        )
        return None, True
    return None, False
```
Return contract (docstring 3107-3116): `(float, False)` positive; `(None, False)` zero/absent; `(None, True)` read failure or malformed shape.

**Analog B (the shared rule; call it, do not copy a coin list):** `analytics-service/services/equity_reconstruction.py` `_price_wallet_totals`, the loop at lines 651-671 (function starts at 634):
```python
    for asset, qty in totals.items():
        if qty is None:
            continue
        try:
            q = float(qty)
        except (TypeError, ValueError):
            continue
        if q <= 0:
            continue
        asset_upper = str(asset).upper()
        ...
        if is_stable_value(asset_upper):
            total += q
            continue
```
and `analytics-service/services/price_rule.py` lines 82 and 99-101:
```python
_STABLE_VALUE: Final[frozenset[str]] = STABLECOINS | STABLECOIN_SPLIT_SUFFIXES
def is_stable_value(asset: str) -> bool:
    return asset.upper() in _STABLE_VALUE
```
Two deliberate differences from Analog B, both from RESEARCH "VREAD-01 design": (1) Analog B swallows a malformed quantity with `continue`; the new helper must treat a malformed STABLE quantity as `(None, True)` (matching Analog A) and must not parse non-stable coins at all, so a garbled BTC cannot fail the anchor; (2) skip `q <= 0` as Analog B does, so a negative stable coin (spot borrow) never reduces the anchor silently.

**Dispatch pattern (both entry points, so they cannot disagree, F7).** Current tails to edit:
- `fetch_account_equity_usd` ends `return await fetch_usdt_balance_with_status(exchange)` (line 3259), after the `if venue == "okx":` arm (3256-3258).
- `fetch_account_equity_and_upnl_usd` ends `equity, balance_error = await fetch_usdt_balance_with_status(exchange); return equity, balance_error, 0.0, False` (3300-3301), after the OKX arm (3292-3299).
Add a `if venue == "bybit":` arm in each that awaits the new helper; keep the wedge a hard-coded `0.0` and `upnl_unreadable` `False` (docstring 3277-3283 says a non-zero wedge is the double count). Binance keeps falling through to `fetch_usdt_balance_with_status`. Per orchestrator ruling OQ1 Option A, `fetch_usdt_balance_with_status` and `fetch_usdt_balance` (3081-3098) are NOT edited.

**Error handling pattern:** class-only plus `scrub_freeform_string`, as above; never `str(e)` raw (NEW-C13-10).

**Test pattern:** see section 7 (`test_upnl_venues.py`) and the `test_exchange.py` entry in section 8.

---

### 2. `services/exchange.py`: `_fetch_raw_trades_bybit` windowed walk (plan 04, VREAD-03)

**Analog A (the template, same driver, same venue):** `analytics-service/services/bybit_unified_flows.py` `fetch_bybit_unified_flows`, lines 144-227. CONTEXT's "allocator rebuild windowed reader" no longer exists (Phase 176); this is the template.

**Imports pattern** (lines 63-68):
```python
from services.exchange_pagination import (
    PageRequest,
    PageResult,
    ProviderPaginationContract,
    walk_paginated,
)
```
`exchange.py` currently has none of these; add them. Check there is no circular import (`exchange_pagination.py` imports only stdlib, lines 27-34).

**Core pattern: page callback + contract + walk + dedupe** (lines 152-227, adapt):
```python
    async def _fetch_page(req: PageRequest) -> PageResult[dict[str, Any]]:
        params: dict[str, str] = {
            ...
            "limit": str(BYBIT_LOG_PAGE_SIZE),
            "startTime": str(req.window_start),
            "endTime": str(req.window_end),
        }
        if req.cursor:
            params["cursor"] = req.cursor
        try:
            answer = await exchange.private_get_v5_account_transaction_log(params)
        except Exception as exc:
            logger.warning("... exc_class=%s", ..., type(exc).__name__)
            raise
        ...
        return PageResult(
            rows=rows,
            next_cursor=next_cursor,
            is_full_page=len(items) >= BYBIT_LOG_PAGE_SIZE,
            is_empty=not items,
        )

    contract = ProviderPaginationContract(
        fetcher="fetch_bybit_unified_flows",
        page_cap=UNIFIED_FLOW_PAGE_CAP,
        on_ceiling="raise",
        stop_on_short_page=False,
        stuck_cursor_is_stop=False,
        inst_types=UNIFIED_FLOW_TYPES,
        gated_inst_types=frozenset(),
        window_max_days=7,
        ceiling_exc=BybitUnifiedFlowReadError,
        ceiling_label="UNIFIED_FLOW_PAGE_CAP",
    )
    walked = await walk_paginated(contract, since_ms=since_ms, now_ms=now_ms, fetch_page=_fetch_page)
    # Windows do not overlap, so a repeated id means the venue served a row twice: count it once.
    seen: set[tuple[str, str]] = set()
```
For the execution list set (per RESEARCH Pattern 1): `fetcher="fetch_raw_trades_bybit"`, `page_cap` sized by the probe (orchestrator OQ7: default 200 until measured), `on_ceiling="raise"`, `stop_on_short_page=False`, `stuck_cursor_is_stop=True` (the legacy loop stops on a repeated cursor, lines 2905-2914), `window_max_days=7`, `default_lookback_days=365` (OQ2), `ceiling_exc=<new named class>`. Dedupe by `execId` after the walk (as above, key on the fill id).

**Analog B (a second `walk_paginated` user with a typed ceiling error and a per-category `inst_types` fan-out):** `analytics-service/services/funding_fetch.py` lines 829-850 (contract with `ceiling_exc=FundingFetchCeilingExceeded`, `default_lookback_days=BYBIT_FUNDING_DEFAULT_LOOKBACK_DAYS`) and the class at lines 91-107 (`class FundingFetchCeilingExceeded(PaginationCeilingExceeded)`).

**Typed, named refusal (copy this shape for the new error class):** `bybit_unified_flows.py` lines 82-88:
```python
class BybitUnifiedFlowReadError(RuntimeError):
    """... The text never carries venue text."""

def _refuse(log_type: str, what: str) -> BybitUnifiedFlowReadError:
    return BybitUnifiedFlowReadError(f"Bybit Unified {log_type} flow read refused: {what}")
```
Place the new class beside `ColdStartSymbolDiscoveryError` / `BinancePerSymbolFetchError` (`exchange.py` 631-660) for locality with the other typed sync errors. Placement does NOT change how `job_worker.py` classifies it: `job_worker.py` handles `ColdStartSymbolDiscoveryError` by name at lines 2244 and 15243, and any new class falls through to the generic handler unless the plan adds an `except` (which is a `job_worker.py` edit, out of scope here). State that in the plan.

**Keep verbatim (out of the change):** the per-fill validation block at `exchange.py` 2813-2898 (`ts_raw.isdigit()`, `_finite_positive_decimal`, `_finite_decimal`, `_check_fee_currency_mismatch`, `_make_fill_dict(...)`) and the `_BYBIT_FILL_CATEGORIES` guard at 2782-2792 (`category not in _BYBIT_FILL_CATEGORIES` records `bybit_unsupported_category` and raises `ValueError`). Linear only stays (CONTEXT; census C17).

**Error handling pattern to preserve** (lines 2916-2924, the per-page failure log):
```python
        except Exception as e:
            logger.error(
                "Bybit execution list failed page %d (re-raising to fail the sync): exc_class=%s scrubbed=%s",
                page, type(e).__name__, scrub_freeform_string(str(e)),
            )
            raise
```
**DQ flag pattern** (lines 2926-2936, the existing cap-hit flag; under the new `on_ceiling="raise"` contract the cap hit raises the named error instead, so decide in the plan whether `_record_dq_flag("sync_truncated_bybit", True)` / `("sync_truncated_bybit_pages", int(...))` is still set before the raise; CONTEXT says "a window cap hit raises a named data-quality flag and refuses"):
```python
        _record_dq_flag("sync_truncated_bybit", True)
        _record_dq_flag("sync_truncated_bybit_pages", int(PAGE_CAP))
```
`_record_dq_flag` (228-259) is defensive and never raises; counters sum, booleans OR-merge. `get_and_clear_last_dq_flags` (105-130) is how callers drain.

**Conflict to resolve in the plan (do not blend):** the three analogs disagree on a repeated cursor. `fetch_bybit_unified_flows` uses `stuck_cursor_is_stop=False` and raises `_refuse(... "the cursor did not advance")` when rows came back with an unchanged cursor (lines 189-193); `fetch_funding_bybit` uses `stuck_cursor_is_stop=False` and lets a stuck cursor exhaust to the ceiling (funding_fetch 838-840); the legacy `_fetch_raw_trades_bybit` (and RESEARCH Pattern 1's `stuck_cursor_is_stop=True`) stops SILENTLY and keeps the rows read so far (exchange.py 2905-2914, pinned by `test_fetch_raw_trades_bybit_stuck_cursor_terminates`). Under this phase's "covers every execution or refuses by name" a silent stop on a still-live cursor is a possible silent partial. Recommendation for the planner: follow the unified-flows analog (raise a named refusal on an unchanged cursor that came with rows), because it is the most recent and the only one whose test pins "never a short list"; flip `test_fetch_raw_trades_bybit_stuck_cursor_terminates` deliberately and record old and new expectation. The planner may overrule, but must pick one.

**Gotchas the planner must carry into the plan action (read from `walk_paginated`, `exchange_pagination.py`):**
1. `_windows` treats a `None` start as `0` for a walked contract (lines 164-175), so `default_lookback_days` MUST be set; otherwise `since_ms=None` walks from epoch. The driver only applies the lookback inside `walk_paginated` (lines 198-204).
2. The driver raises `contract.ceiling_exc(f"{fetcher} exhausted {ceiling_label}={page_cap} on inst_type=... window=[...] with more rows remaining")` (lines 241-247). That text carries the cap and window bounds. If the named error's text must be static (RESEARCH Pitfall 8, `phase2_error_message[:200]` is stored), the subclass `__init__` should discard or replace the driver's message. `BybitUnifiedFlowReadError` does NOT do this today; decide and pin with a test.
3. The two-year guard (start older than 730 days is refused by Bybit with retCode 10001, `tests/_trade_pages.py` 42 and 218-223 mirror it) must run BEFORE the walk and refuse by name, never clamp. There is no analog in `exchange.py` for this guard; model the refusal on `_refuse` above.
4. `fetch_raw_trades` (2252-2300) applies `OVERLAP_WINDOW_MS` (628) and resets `_LAST_DQ_FLAGS` at entry (2271); the new walk sits below that seam and must not edit it. Reconcile sends `now - 24h`, which must be exactly one window (census C15b).
5. Do NOT edit `run_sync_trades_job` / `advance_fetched_cursor` (`services/job_worker.py` 2655: `advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)`). Record the dependency in the plan SUMMARY (orchestrator ruling OQ5).

---

### 3. `services/positions.py`: three-category Bybit position read, USD-correct rows (plan 03, VREAD-02)

**Analog A (inverse coin to USD conversion, the in-repo precedent CONTEXT names):** `analytics-service/services/positions.py` `_normalize_deribit_position`, lines 161-196 and 219-230:
```python
    index_price = float(info.get("index_price") or 0)
    mark_price = float(info.get("mark_price") or 0)
    ...
    if coin_settled:
        if index_price > 0:
            rate = index_price
        elif (not option_style) and mark_price > 0:
            rate = mark_price
        else:
            raise ValueError(
                "deribit inverse position: no usable index_price for coin→USD "
                f"conversion (index={index_price}, mark={mark_price})"
            )
        coin_pnl = reported_pnl(info.get("floating_profit_loss"))
        unrealized_pnl = coin_pnl * rate if coin_pnl is not None else None
    ...
    symbol = info.get("instrument_name") or str(pos.get("symbol") or "")
    return {"symbol": symbol, "side": side, "size_base": size_base, "size_usd": size_usd,
            "entry_price": entry_price, "mark_price": mark_out,
            "unrealized_pnl": unrealized_pnl, "exchange": "deribit"}
```
Take from it: read raw `info` fields, use the raw id as `symbol`, convert coin P&L at the mark, keep `None` as `None`, and raise on an unusable rate. Differences for Bybit (RESEARCH F1 and "Per-field output spec"): use `services.price_rule.usable_price(raw_mark)` (finite, strictly above 0, `price_rule.py` 87-97) instead of the Deribit `float(... or 0)` guard, and raise a NEW typed named error with static text rather than a bare `ValueError`.

**TRAP, read from `usable_price`'s own docstring (`price_rule.py` 87-97): it returns `None` for a numeric STRING ("a numeric string is not usable"; only a finite `int`/`float` strictly above 0 passes).** The raw V5 path receives `markPrice` as a string (`"61000"`, see `BYBIT_V5_RAW_RESPONSE` in `tests/test_positions.py` 145-176), so `usable_price(item["markPrice"])` would refuse EVERY raw-path inverse row. On the raw path convert fail-loud first (`float(item["markPrice"])`, as `_parse_bybit_v5_positions` already does at line 97) and then pass the float to `usable_price`; on the ccxt path `markPrice` is already a float. Add a test arm for a string mark on the raw path and for a non-finite or zero mark on both paths. The Deribit path is contained per position (`_normalize_ccxt_positions` 297-331); Bybit must stay FAIL-LOUD (the docstring at 300-311 says only Deribit skips), so the new error must propagate.

**Analog B (symbol and raw-parser rows to fix; do not restyle):** `_normalize_ccxt_position`, lines 258-271 (the symbol strip `symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")` is the defect for `BTC/USDC:USDC` giving `BTCUSDCC` and for `BTC/USD:BTC` giving `BTCUSD:BTC`; `size_usd` is `float(pos.get("notional") or 0)`; `unrealized_pnl` passes through `reported_pnl`) and `_parse_bybit_v5_positions`, lines 74-100 (category-blind; `size_usd = float(item.get("positionValue", 0))`; `unrealized_pnl = reported_pnl(item.get("unrealisedPnl"))`). Per RESEARCH the output spec is: linear USDT unchanged; linear USDC uses `info["symbol"]` (e.g. `BTCPERP`); inverse uses `info["symbol"]` (e.g. `BTCUSD`), `size_usd = coin_notional * mark`, `unrealized_pnl = coin_upnl * mark`. Do not re-derive dated symbols for USDT rows (orphaning `allocator_holdings` rows is a data-migration decision).

**Analog C (the P&L reported-vs-absent helper to keep using):** `reported_pnl`, lines 30-43 (`None`/blank means "not reported", a real `"0"` stays `0.0`).

**Core request pattern to change** (`_fetch_positions_bybit`, lines 362-375):
```python
async def _fetch_positions_bybit(exchange: Any) -> list[dict[str, Any]]:
    raw_positions = await exchange.fetch_positions()
    if raw_positions and _bybit_ccxt_has_critical_fields(raw_positions):
        return _normalize_ccxt_positions(raw_positions, "bybit")
    logger.info("Bybit CCXT positions missing critical fields, falling back to V5 API")
    raw_response = await exchange.private_get_v5_position_list(
        {"category": "linear", "settleCoin": "USDT"}
    )
    return _parse_bybit_v5_positions(raw_response)
```
Request shapes measured by research on the ccxt 4.5.89 wheel: `fetch_positions()` sends `{"settleCoin":"USDT","limit":200,"category":"linear"}`; `fetch_positions(None, {"settleCoin":"USDC"})` sends settleCoin USDC; `fetch_positions(None, {"subType":"inverse"})` sends `{"category":"inverse","limit":200}`. The raw fallback must add `limit` 200 and follow `nextPageCursor` (it sends neither today). Sub-reads are awaited without a swallow so any exception propagates; `fetch_allocator_holdings` (`services/allocator_positions.py` 1747-1801) already turns a retryable derivative failure into partial success with `DERIVATIVE_FETCH_FAILED_NOTE` and re-raises a permanent one.

**Error handling pattern:** typed error with static text, never swallowed in `_normalize_ccxt_positions` for Bybit (see Analog A note). A full 200-row page from any category is unprovable-complete, so refuse by name (`services/equity_reconstruction.py` 598-613 already reasons this way for the forced path; cite as the in-repo precedent for `>= page limit` means unprovable).

**Gotchas:** (1) `if raw_positions and ...` means an EMPTY ccxt list also takes the raw path, so a flat account is 3 ccxt + 3 raw calls (RESEARCH Pitfall 2); state the count in the plan. (2) Existing tests stub `fetch_positions.return_value=[...]` and assert `private_get_v5_position_list.assert_awaited_once()`; three category calls triple the rows (Pitfall 1), so those assertions flip, never delete. (3) Symbol/key stability: do not change USDT rows' stored `symbol`.

---

### 4. `scripts/bybitreads_probe.py` (new, plan 02; the orchestrator runs it, an executor does not)

**Analog:** `analytics-service/scripts/derivegaps_probe.py` (Phase 186; reviewed pattern, exit-code and fingerprint contract). Prefer IMPORTING the shared harness over copying it, as `derivegaps_probe` itself does (lines 85-111 import from `scripts.bybit_funding_record`, `scripts.bybit_upnl_probe`, `scripts.deribit_ground_truth`, `scripts.walletoffset_probe`).

**Imports pattern** (derivegaps_probe 83-111, the subset the new probe needs):
```python
import ccxt
from scripts.bybit_funding_record import AGE_BUCKETS, age_bucket, read_key_info
from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from scripts.walletoffset_probe import ReadOnlySupabase
from services.allocator_equity_derive import eligible_key_predicate
from services.bybit_unified_flows import (
    BybitUnifiedFlowReadError, fetch_bybit_unified_flows, pair_onchain_with_unified,
)
from services.ccxt_flow_fetch import fetch_ccxt_transfers
from services.closed_sets import STABLECOINS
from services.okx_bills_chain import CallCeilingReached
```
Add `from services.price_rule import is_stable_value` for the exposure counts (RESEARCH section C) so the probe does not carry its own coin list.

**Read-only recording view (reuse, do not rewrite).** `ReadOnlyRecordingExchange`, lines 201-247, resolves only `_PLAIN_ATTRS`, `_PURE_HELPERS`, names starting with `_GET_PREFIXES` (line 176: `private_get_`, `privateGet`, ...) or in `_READ_METHODS` (`fetch_balance` etc.), counts every call, and refuses the call that would exceed `ceiling` with `CallCeilingReached` BEFORE the inner call:
```python
        async def _counted(*args: Any, **kwargs: Any) -> Any:
            if self.calls >= self.ceiling:
                self.ceiling_reached = True
                raise CallCeilingReached(self.ceiling)
            self.calls += 1
            reply = await method(*args, **kwargs)
            first = args[0] if args else None
            self.requests.setdefault(name, []).append(dict(first) if isinstance(first, dict) else {})
            self.replies.setdefault(name, []).append(reply)
            return reply
```
`private_get_v5_execution_list` and `private_get_v5_position_list` both match the GET prefix, so no view change is needed. A new vocabulary, validators and `emit_record` must be NEW (a record of a different shape) but copy the mechanics exactly:

**Vocabulary and emit pattern** (lines 500-598): per-key validators dict keyed by record key (`_is_bool_or_absent`, `_is_count_or_absent`, `_is_seconds_or_absent`, `_is_one_of(...)` closed tokens, label regex `^k[0-9]{1,3}$`), an import-time assertion that validators and key tuple agree (lines 561-564), `validate_record` whose messages name the PATH and never the value (574-592), and `emit_record` as the ONLY path to stdout (595-598):
```python
def emit_record(record: Mapping[str, Any]) -> str:
    """The ONLY path to stdout: validate, then serialize one compact JSON line."""
    validate_record(record)
    return json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False)
```
"Not measured" is the word `field-absent`, never 0; `_key_record` (1415-1431) defaults every reading to `FIELD_ABSENT`; `failure_token` (1403-1412) is the one place an exception becomes a closed token and never reads the message.

**Section B (deposits, VREAD-04): copy `measure_bybit_flows` almost whole** (lines 1097-1205). It already reads the REAL `fetch_ccxt_transfers` (`deposits`, `withdrawals`) and `fetch_bybit_unified_flows` and takes pair counts from `pair_onchain_with_unified`. The only changes: widen the window to `now-729d..now` (research probe design B; `flow_retention_floor("bybit")` is 365 days today), and add the verdict token from the RESEARCH decision table (`undecided`, `replace_supported`, `undecided_near_miss`, `unpaired_present`). The state handling is the pattern to keep verbatim:
```python
    try:
        onchain_deposits = await fetch_ccxt_transfers(view, "deposits", since_ms, now_ms)
        onchain_withdrawals = await fetch_ccxt_transfers(view, "withdrawals", since_ms, now_ms)
        values["onchain_read_state"] = "complete"
    except CallCeilingReached:
        raise
    except Exception:  # noqa: BLE001 - the state is the reading; the class and message are not printed
        onchain_deposits = onchain_withdrawals = None
        values["onchain_read_state"] = "failed"
```

**Sections A (trade window) and C (exposure): NEW code, but follow this rule from RESEARCH: measure the VENUE, not our function.** Issue the legacy request shape (startTime on first page only, cursor pages, no endTime) and the windowed shape directly through the view (`await view.private_get_v5_execution_list(params)`), because after plan 04 the repo function is the windowed read and would no longer measure legacy behaviour. Mirror the `informative` discipline of `measure_bybit_limit` (derivegaps_probe 989-1035; its tests at `test_derivegaps_probe.py` 952-1010): a result that cannot distinguish the two shapes reads `undecided`, never a pass.

**Run wrapper (copy):** `run()` lines 1706-1760 (ReadOnlySupabase once; `eligible_key_predicate`; decrypt inside the worker with `get_kek`; per-key `try/except Exception` mapped to a closed token; one JSON line per key then a summary; exit 1 on any unmeasurable key, skipped section or failed read), `_read_one_key` 1685-1703 (`decrypt_credentials`, `_make_exchange_client`, `aclose_exchange` in `finally`), `deploy_fingerprint` 1763-1779 (one line starting with the probe name, exit codes, record-vocabulary sizes), and `main` 1782-1796:
```python
    parser = argparse.ArgumentParser(description="... (takes no arguments)")
    parser.parse_args(argv)
    logging.disable(logging.CRITICAL)
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 - the TYPE only; a message can carry an id
        print(f"failed: {type(exc).__name__}", file=sys.stderr)
        return EXIT_FAILED
```
Fingerprint prefix for the new probe: `bybitreads ...` (RESEARCH suggests `bybitreads <EXIT_OK> <EXIT_FAILED> <len(KEY_RECORD_KEYS)> <len(SUMMARY_RECORD_KEYS)> <len(VERDICTS)>`).

**Redaction contract to restate in the module docstring** (derivegaps_probe 38-44): labels `k1..kN`, counts, booleans, closed tokens, age buckets, 3-significant-figure seconds; no id, amount, symbol, address, venue text or timestamp finer than the run date; logging disabled; rows counted, never printed.

**Module docstring structure to copy:** WHAT IT MEASURES, REDACTION CONTRACT, READ-ONLY, USAGE (no arguments; deploy fingerprint check `python -c 'import scripts.bybitreads_probe as p; print(p.deploy_fingerprint())'`), EXIT CODES (derivegaps_probe 1-67).

**Run protocol (orchestrator, not an executor):** precedent is `.planning/milestones/v1.20-phases/186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed/186-04-PLAN.md` and `186-04-SUMMARY.md` (temporary start-command wrapper, fingerprint compare, restore, `worker-restored: yes`). RESEARCH "Run protocol" gives the sequence; the founder's explicit approval is needed each time.

---

### 5. `tests/test_bybitreads_probe.py` (new, plan 02)

**Analog:** `analytics-service/tests/test_derivegaps_probe.py`. Copy these test groups, adapting names:

- Module docstring style "Why each group matters (Rule 9)" (lines 1-22): realized-state, redaction, read-only, fingerprint, each with the reason a pin that cannot fail proves nothing.
- Imports and constants (23-55): `import scripts.derivegaps_probe as dp`, a `_PROBE_SRC = Path(dp.__file__).read_text(...)`, distinctive synthetic sentinels (`_VENUE_MESSAGE = "venue-said-boom-secret-123"`, `_KEY_ONE`, `_CIPHER`), and the autouse DQ-buffer fixture (57-60):
```python
@pytest.fixture(autouse=True)
def _clean_dq_buffer() -> None:
    """The DQ buffer is per asyncio task; start every test with it empty."""
    get_and_clear_last_dq_flags()
```
- Emitter-refusal tests (311-375): default record valid and one compact line; undeclared key refused by PATH not value (`assert _VENUE_MESSAGE not in str(caught.value)`); int where bool declared; raw string where closed token declared; float/negative count; unrounded seconds; summary refuses an extra key.
- Read-only view tests (383-477): `_Inner` fake with GET and POST methods, `@pytest.mark.parametrize("name", [... write names ...])` asserting `AttributeError` and `inner.hits == []`; the ceiling test (`CallCeilingReached`, the venue never saw the over-budget call).
- Source pin that can fail (464-477):
```python
_WRITE_NAMES = (
    r"private_post_|create_order|cancel_order|withdraw\(|transfer\(|\.insert\(|\.upsert\(|"
    r"\.delete\(|\.rpc\(|enqueue"
)
def test_the_probe_source_names_no_write_method() -> None:
    assert re.search(_WRITE_NAMES, _PROBE_SRC) is None
def test_the_write_name_pin_can_fail() -> None:
    assert re.search(_WRITE_NAMES, "await exchange.private_post_trade_order(params)") is not None
```
- Fingerprint tests (485-499): starts with the probe name, one line, moves when a record key is added (`monkeypatch.setattr(dp, "KEY_RECORD_KEYS", (*dp.KEY_RECORD_KEYS, "a_new_key"))`).
- A fake client that is a REAL ccxt Bybit with raw endpoints replaced (`_FakeBybitFlows(ccxt_async.bybit)`, 1069-1135) for the Section B tests (paired, unpaired, near-miss, onchain failed, unified reader error, call budget spent: 1143-1395). The Section A fake for the probe should be the venue-rule execution fake from section 8 below, so legacy-shape RED and windowed-shape GREEN come from the venue's rule, not from the probe's own params.
- Redaction test with a planted amount (RESEARCH PROOF-01 table: "remove a redaction check, expected first RED: the planted-amount output test"); model on the tracer `test_tracer_one_okx_key_end_to_end` (617-654) and `test_a_venue_error_outside_the_fetcher_prints_its_class_only` (696-716).

---

### 6. `tests/_trade_pages.py` and the VREAD-03 venue-rule fake (plan 04)

**Analog (reuse, do not rewrite the rule):** `analytics-service/tests/_trade_pages.py`.

`bybit_select` (125-147) already encodes the venue rule: rows in `[start, end]`, a missing end means start plus 7 days, a range over 7 days raises `ccxt.BadRequest`, newest first, cursor `c<offset>`:
```python
def bybit_select(trades, *, start, end, cursor, size):
    end = start + BYBIT_WINDOW_MS if end is None else int(end)
    if end - start > BYBIT_WINDOW_MS:
        raise ccxt.BadRequest("bybit: endTime - startTime must be at most 7 days")
    inside = sorted((t for t in trades if start <= int(t["timestamp"]) <= end), key=_order_key, reverse=True)
    offset = int(str(cursor)[1:]) if cursor else 0
    chunk = inside[offset : offset + size]
    return chunk, (f"c{offset + size}" if offset + size < len(inside) else None)
```
`real_ccxt_client("bybit", trades)` (385-455) wires a stub onto the camelCase attribute `privateGetV5ExecutionList` (line 452) that applies `bybit_select` to the RAW request and returns raw rows through `_raw_bybit_execution` (348-361); the raw row shape and the `{"retCode":0,"result":{"list":[raw rows],"nextPageCursor":...}}` envelope are what `_fetch_raw_trades_bybit` consumes.

**TRAP (verified by running ccxt locally, 4.5.64, in this mapping session): `privateGetV5ExecutionList` and `private_get_v5_execution_list` are SEPARATE attributes. Assigning a stub to the camelCase name leaves the snake_case name pointing at ccxt's real implicit method (`b.private_get_v5_execution_list is stub` is `False` after the camelCase assignment, `True` only after assigning the snake_case name itself).** `_fetch_raw_trades_bybit` calls the snake_case name (`exchange.py` 2774 docstring and 2807), so `real_ccxt_client` as written would let the code under test reach the real client (it serves `fetch_my_trades`, which uses the camelCase endpoint). The new fake must be assigned at `private_get_v5_execution_list`, the way `install_unified_log` assigns `exchange.private_get_v5_account_transaction_log = AsyncMock(side_effect=book)` (339-345); build it as `install_execution_list(exchange, trades)` over `bybit_select` + `_raw_bybit_execution`. `_FakeBybitFlows` (`test_derivegaps_probe.py` 1094-1113) sets each endpoint by the name the code under test uses, which is the same discipline. `UnifiedLogBook` (274-336) is the pattern for a call-recording book exposed via `AsyncMock(side_effect=book)` with `inspect.markcoroutinefunction(self)`; `install_unified_log` (339-345) is the wiring helper to mirror (`install_execution_list(exchange, trades)`).

**Gap the planner must close (read from the helper):** `bybit_select` treats a missing `startTime` as `start=0` in `real_ccxt_client` (line 423: `int(request["startTime"]) if "startTime" in request else 0`), but the real venue answers a request with NEITHER bound as only the LAST 7 days (RESEARCH VREAD-03 venue semantics; `since_ms=None` census C16). For the `since_ms=None` default test, the new fake must model "neither bound: now minus 7 days to now" so the legacy code is RED for the right reason. Also `_raw_bybit_execution` has no `orderId`, `feeCurrency` or `isMaker`; `_fetch_raw_trades_bybit` reads them with `.get` defaults (2861, 2872, 2889), so no change is needed, but assert on `execId`.

**Test shape (RESEARCH Code Examples, "fake `execution_list` built from the venue's rule"):** fills with ids spread over 22 days; legacy code returns only the first 7 days (RED: assertion names the first missing `execId`); the windowed read returns all; a 24 h start sends exactly one `execution_list` request; a window beyond the (lowered) page cap raises the named error; `since_ms=None` walks 365 days. Pattern for lowering the cap: `monkeypatch.setattr(buf, "UNIFIED_FLOW_PAGE_CAP", 2)` in `tests/test_bybit_unified_flows.py` 150-156 (the cap is a module constant read at call time; make the new cap one too, per `BYBIT_PNL_PAGE_CAP` at `exchange.py` 148, "Module constants (NOT `Final`) so a test can lower them").

---

### 7. `tests/test_upnl_venues.py`: flip the pin, params-aware fake, shared-constant proof (plans 03 and 06)

**Analog:** the same file.

**The pin that flips, never deletes** (lines 383-406; keep the fixture and rename `..._derive_and_reconstruct_sum_the_same_stable_coins`, keep the TODOS id in the docstring):
```python
async def test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin() -> None:
    payload = bybit_wallet_balance(
        "UNIFIED",
        [bybit_coin("USDT", "1000", "250.5"), bybit_coin("USDC", "200", "0")],
    )
    parsed = await real_bybit_parse_balance(payload)
    derive, _err, _wedge, _unreadable = await fetch_account_equity_and_upnl_usd(
        _fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit"
    )
    reconstruct, _ = await _fetch_current_equity(_fake_bybit(parsed, BYBIT_LINEAR_POSITIONS), "bybit")
    ...
    assert derive == 1000.0, ...          # becomes: derive == 1200.0
    assert reconstruct == pytest.approx(1450.5, abs=1e-9), ...   # stays; add reconstruct == approx(derive + 250.5)
```
CONTEXT's flipped assertion: derive equals the stable-coin wallet sum (1200), wedge `0.0`, `_err is False`, `reconstruct == derive + open uPnL` (1450.5). RED-first (PROOF-01): run the flipped test on today's code; the first failure must be `derive == 1200.0` reading `1000.0`.

**Real-parser fixture helpers to reuse (all in this file):** `bybit_coin(coin, wallet, upnl)` (107-122), `bybit_wallet_balance(account_type, coins)` (125-145), `real_bybit_parse_balance(payload)` (148-155; ccxt's REAL `parse_balance`, instance closed in `finally`), `_coin_row` (158-163), `BYBIT_LINEAR_POSITIONS` (93-104), `BYBIT_UNIFIED_WALLET_BALANCE` (60-88), and the ccxt pin guard `test_ccxt_pin_is_the_version_these_semantics_were_read_from` (231-242). Every expected number is typed with its arithmetic beside it, never produced by the code under test (module docstring 11-14).

**Params-aware `_fake_bybit` (Pitfall 1).** Today (166-178) one `AsyncMock(return_value=...)` list is returned for EVERY `fetch_positions` call, so three category calls triple the rows. The block below is the CURRENT code (not the target); the plan replaces the `fetch_positions` line with a `side_effect` that dispatches on `params` (`settleCoin`, `subType`) and records the calls, so a test asserts one call per category:
```python
def _fake_bybit(balance, positions) -> MagicMock:
    ex = MagicMock()
    ex.id = "bybit"
    ex.fetch_balance = AsyncMock(return_value=copy.deepcopy(balance))
    if isinstance(positions, BaseException):
        ex.fetch_positions = AsyncMock(side_effect=positions)
    else:
        ex.fetch_positions = AsyncMock(return_value=copy.deepcopy(positions))
    ...
```
Existing assertion to flip: `test_holdings_bybit_spot_row_is_wallet_balance_and_derivative_row_carries_upnl` asserts `len(spot_rows) == 1 and len(deriv_rows) == 1` (318).

**New shared-constant test (RESEARCH Don't Hand-Roll, "Stable-coin rule"):** `monkeypatch.setattr(services.price_rule, "_STABLE_VALUE", <frozenset plus a synthetic code>)`, then show BOTH the new anchor and `_price_wallet_totals` include it; RED if the helper hard-codes `{"USDT","USDC"}`. Note `_STABLE_VALUE` is `Final` at module level (`price_rule.py` 82) but is looked up at call time inside `is_stable_value` (99-101), so monkeypatching the module attribute works; the helper MUST call `is_stable_value` (not bind the frozenset at import).

**Failure-path pattern with a class-only, no-signature log assertion** (414-439), reuse for the new helper's `fetch_balance` raising arm:
```python
    failing = ccxt.NetworkError("bybit GET https://api.bybit.com/v5/position/list?category=linear&signature=deadbeef")
    ...
    assert "venue=bybit" in message and "exc_class=NetworkError" in message, message
    assert "deadbeef" not in caplog.text, "the request signature must not reach the log ..."
```

---

### 8. `tests/test_positions.py` (plan 03)

**Analog:** the same file.

**Existing tests that move (flip, never delete):**
- `TestFetchPositionsBybitHappy::test_bybit_ccxt_complete` (233-253): `mock_exchange = AsyncMock()`, `mock_exchange.fetch_positions.return_value = BYBIT_CCXT_COMPLETE`. With three categories, the same return value is served on every call; make the mock dispatch on `params`.
- `TestFetchPositionsBybitFallback::test_bybit_fallback_to_v5` (260-282): asserts `mock_exchange.private_get_v5_position_list.assert_awaited_once()` (282). With three categories this becomes "awaited once per category" and the new request params (`limit`, per-category) are asserted.
- `TestBybitV5ReportedPnl::test_ccxt_none_still_routes_to_v5_and_v5_zero_is_a_real_zero` (805+).
- Inverse-conversion test analogs already in this file: `TestFetchPositionsDeribit` (430-743): `test_inverse_perp_short_normalized` (434), `test_linear_usdc_perp_pnl_passthrough` (467), `test_inverse_index_and_mark_zero_fails_loud` (563), `test_one_bad_position_does_not_drop_the_batch` (605), `test_non_deribit_malformed_still_fails_loud` (712). Model the new Bybit inverse arms on these (coin-denominated P&L times the mark, unusable mark raises by name, malformed Bybit row still aborts the batch).

**Fixture shapes:** `BYBIT_V5_RAW_RESPONSE` (145-176) is the Bybit-documented raw row shape the raw-fallback tests use (`"symbol":"BTCUSDT"`, `"positionValue":"6100"`, `"unrealisedPnl":"100"`, `"nextPageCursor": ""`). Add USDC-linear (`BTCPERP`) and inverse (`BTCUSD`) rows beside it from Bybit's documented v5 responses; assume nothing about the parser's own field names (CONTEXT PROOF-01: "Mocks mirror recorded real payloads"). The cassette holds NO position-list reply, only `instruments-info` (see "No Analog Found"), so position rows stay documented shapes with typed arithmetic beside them.

**Poll-job coverage (census C12):** no test in `tests/` drives `run_poll_positions_job` (`services/job_worker.py` 14649) through `positions.fetch_positions` for Bybit; `tests/test_job_worker.py` 559-564 only checks that dispatch routes `kind='poll_positions'` to the handler. C12's "fixed by inheritance" therefore needs a NEW test (a USDC row through the job carries the corrected symbol and USD fields); there is no analog to copy for it beyond the dispatch patch style at `tests/test_job_worker.py` 559-570.

**Required per-field assertions (RESEARCH VREAD-02 table):** `symbol` (`BTCPERP`, `BTCUSD`, not `BTCUSDCC`, not `BTCUSD:BTC`); `size_usd`; `unrealized_pnl` at mark; `None` stays `None`; a 21-position raw read spans two pages (the PROOF-01 neuter "drop `limit` / cursor" expects this arm to go RED); one-call-per-category on both the ccxt and raw paths; a failed sub-read propagates.

---

### 9. `tests/test_exchange.py` (plans 04 and 06)

**Analog:** the same file. Existing tests to flip, with the exact location:

1. **`since_ms=None` Bybit cursor tests (Pitfall 4)**, each turns into 53 windows under a 365-day default and exhausts a short `side_effect`:
   - `TestFetchRawTrades::test_fetch_raw_trades_bybit_cursor` (line 1101, `await_count == 2`),
   - `TestG12BPaginationGuards::test_fetch_raw_trades_bybit_stuck_cursor_terminates` (class at 2059, test at 2063; its `await_count < 100` assertion per RESEARCH, not re-read; see the stuck-cursor conflict note in section 2),
   - `TestClusterIBybitPageCapTruncationFlag::test_bybit_page_cap_records_dq_flag` (5041-5097): shape to adapt:
```python
        async def _execution_list(params):
            call_state["n"] += 1
            return {"result": {"list": [ {... "execId": f"exec-{call_state['n']}-{i}", ...} for i in range(100)],
                               "nextPageCursor": f"cursor-{call_state['n']}"}}
        mock_exchange.private_get_v5_execution_list = _execution_list
        result = await _fetch_raw_trades_bybit(mock_exchange, since_ms=None)
        assert len(result) == 100 * 100
        flags = get_and_clear_last_dq_flags()
        assert flags.get("sync_truncated_bybit") is True
        assert flags.get("sync_truncated_bybit_pages") == 100
```
   Flip deliberately: explicit start, or a window-aware fake; record old and new expectation in the plan SUMMARY.
2. **`TestClusterIC1301BybitCategoryGuard`** (5683-5757): `test_default_category_linear_passes`, `test_inverse_category_rejected_with_dq_flag`, `test_spot_category_rejected_with_dq_flag` stay green and pin census C17 (linear only). `test_default_category_linear_passes` calls `_fetch_raw_trades_bybit(mock_exchange, None)` against an empty list: under the new default lookback this is 53 empty windows, which is fine for an `AsyncMock(return_value=empty)`, but assert the call count if the plan wants it pinned.
3. **Window pagination style to copy for new assertions:** `TestBybitDailyPnlStartTimePagination` (5262+): every call has `startTime` and `endTime`; the `since_ms=None` first window reaches at least 60 days back; `nextPageCursor` followed within a window.
4. **`test_bybit_binance_wedge_zero` (5852-5871)** patches `services.exchange.fetch_usdt_balance_with_status` for BOTH venues:
```python
    for venue in ("bybit", "binance"):
        with patch("services.exchange.fetch_usdt_balance_with_status",
                   new=AsyncMock(return_value=(123456.0, False))):
            eq, err, upl, unreadable = await fetch_account_equity_and_upnl_usd(AsyncMock(), venue)
```
   Under Option A split it per venue: the Bybit half patches the new helper (`services.exchange.fetch_bybit_stable_wallet_with_status`), the Binance half keeps this patch. Flip, never delete.
5. **New stable-wallet arms (census C05 pin too):** `fetch_balance` raises gives `(None, True)` with the class-only log; malformed stable quantity gives `(None, True)`; all-stable-zero gives `(None, False)`; negative stable coin skipped; non-stable coin ignored; `fetch_usdt_balance` on a mixed USDT+USDC real-parsed Bybit balance returns the USDT figure (pins C05, "USDT by the column's own name"); Binance unchanged (`tests/test_upnl_venues_binance.py` stays green).

---

### 10. `tests/test_nav_marks_l4_read.py` (plan 06, F5)

**Analog:** the same file, the dry-run parametrization (891-923):
```python
@pytest.mark.parametrize("venue_name", ["bybit", "binance"])
@pytest.mark.parametrize(
    "wallet,tickers,token",
    [
        ({"USDT": 1000.0}, {}, None),
        ({"USDT": 1000.0, "BTC": 0.1}, {"BTC": 60000.0}, "wallet_basis_mismatch"),
    ],
    ids=["markable", "mixed-basis"],
)
async def test_the_dry_run_sequence_reaches_the_verdict_the_derive_stores(...)
```
Add a USDC case: for `bybit`, `({"USDT": 1000.0, "USDC": 200.0}, {}, None)` is now admitted (the derive anchor sums stable coins, so the mark's all-asset wallet no longer differs by more than max(1 USD, 0.5%) from `usdt_wallet_usd`, `services/nav_marks.py` 373-390); the BTC case stays `wallet_basis_mismatch`. Binance is unchanged, so its USDC case still reads USDT-only; assert that explicitly. Companion pin that stays green: `tests/test_nav_marks_bybit_uta.py::test_non_usdt_collateral_beyond_tolerance_stays_refused_by_name` (246-255) and `::test_a_stablecoin_only_account_needs_no_ticker` (258+). The user-visible consequence (marks begin to be written for stable-coin-mixed Bybit accounts) goes into the plan SUMMARY and phase report.

---

### 11. `tests/test_derive_broker_dailies_dualmode.py` (plan 05, VREAD-04)

**Analog:** the same file, `TestBybitUnifiedTransfersAreFlows::test_unified_rows_replace_the_on_chain_reads_and_count_once` (class at 3190, test at 3276-3292; RESEARCH and the census call the class `TestBybitUnifiedFlowSource`, which does NOT exist: a `grep -n "class TestBybitUnifiedFlowSource"` over `tests/` finds nothing, so cite the real class name), the existing pin that stays:
```python
        seen = await _ccxt_key_derive_with_real_combine(
            venue="bybit", realized=_internally_funded_history(),
            deposits=[_stable_deposit(7, 1234.0)], equity=15_500.0,
            unified=([_unified_transfer_in(7)], []),
        )
        ...
        assert [(f.utc_day_iso, f.usd_signed) for f in flows] == [(_utc_day(7), 5000.0)]
        seen["mocks"]["transfers"].assert_not_awaited()
```
Plus `test_oracle_b_the_marks_show_no_pnl_spike_on_the_transfer_day` (3246-3273), whose `spike.loc[day3] >= 0.4` (line 3272) is "the spike a missing flow makes" (RESEARCH F6). Per RESEARCH F6 no reader can name an unpaired on-chain deposit at HEAD (the per-key derive's Bybit arm never calls `fetch_ccxt_transfers`), so under an `undecided` verdict the deliverable is the probe evidence plus keeping this pin; do not invent a reader. Code stays as-is unless the probe returns `unpaired_present`, which is a founder question, not a switch to union.

---

## Shared Patterns

### Typed, scrubbed, class-only failures ("fail loud, fail alone")
**Source:** `analytics-service/services/exchange.py` 3126-3137 and 2916-2924; `services/redact.scrub_freeform_string` (imported at 20).
**Apply to:** every new Bybit read in plans 03, 04, 06 and the probe.
```python
        logger.warning(
            "Could not fetch account balance: exc_class=%s scrubbed=%s",
            type(e).__name__, scrub_freeform_string(str(e)),
        )
```
The alternative used by `bybit_unified_flows.py` 165-172 logs the exception CLASS only and re-raises the same object (no scrub), the stricter form; prefer it where a venue message must never be stored. Raised refusals carry STATIC text (`_refuse` in `bybit_unified_flows.py` 87-88).

### One windowed, cursor walker
**Source:** `analytics-service/services/exchange_pagination.py` (`walk_paginated` 178-271, `ProviderPaginationContract` 53-102, `PageRequest` 105-112, `PageResult` 115-134). Seven-day windows with a +1 ms boundary (`_windows` 155-175), natural stops are empty page, empty cursor, short page (only when `stop_on_short_page`), repeated cursor (only when `stuck_cursor_is_stop`); the `for...else` fires the ceiling only when `page_cap` is exhausted on a still-live page.
**Apply to:** plan 04. Bybit is CURSOR-authoritative (`stop_on_short_page=False`); a single `len(rows) < page_size` stop would silently truncate every Bybit walk (module docstring 16-24). Do not hand-roll a third loop (the source of NEW-C30-01).

### Data-quality flags
**Source:** `exchange.py` `_record_dq_flag` (228-259), `get_and_clear_last_dq_flags` (105-130), `_LAST_DQ_FLAGS` ContextVar (89-91). Booleans OR-merge, counters sum, lists append with a 64-item cap; the function never raises.
**Apply to:** plan 04 (cap-hit flag and the cursor-dependency note), the existing `bybit_unsupported_category` flag stays.

### One stable-coin rule
**Source:** `services/price_rule.py` `is_stable_value` (99-101) over `_STABLE_VALUE = STABLECOINS | STABLECOIN_SPLIT_SUFFIXES` (82); members in `services/closed_sets.py` (255-264: `STABLECOINS = {USDT, USDC, DAI, BUSD, TUSD, FDUSD, USD}`, `STABLECOIN_SPLIT_SUFFIXES = {USDE, PYUSD, USDB}`).
**Apply to:** plan 06 helper and the probe's exposure counts. A literal `{"USDT","USDC"}` anywhere is the defect class this phase removes.

### Real-parser, venue-rule fixtures (never the parser's own field names)
**Source:** `tests/test_upnl_venues.py` (real `parse_balance`: 148-155), `tests/_trade_pages.py` (`bybit_select` venue rule: 125-147), `tests/test_derivegaps_probe.py` (`_FakeBybitFlows(ccxt_async.bybit)`: 1069-1135).
**Apply to:** every new test. A fake that echoes the code's own params proves nothing (RESEARCH Pitfall 5).

### PROOF-01 (neuter, RED, byte-restore, GREEN)
**Source:** RESEARCH "PROOF-01 protocol and per-gate neuter"; there is no mutation machinery for pytest, so the recorded proof IS the gate. `cp` the file under test to a scratch path, apply the smallest edit that re-introduces the defect, run the gate (RED with the expected arm FIRST), `cp` back and `cmp`, run again (GREEN), paste edit, command, RED line and GREEN line verbatim into the plan SUMMARY. Never `git checkout`, `restore` or `stash` on uncommitted work. Gate/neuter/expected-RED rows are listed in RESEARCH lines 593-602.
**Apply to:** every plan with a gate. Run pytest only from `analytics-service/`. Local ccxt is 4.5.64, CI pins 4.5.89, local mypy 2.0.0, CI `mypy==2.4.0` (RESEARCH F8): use a venv from `requirements.txt` + `requirements-dev.txt` or the 4.5.89 wheel for PROOF-01 runs, and run the exact CI mypy command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`), which covers `services/` but not `scripts/`.

### Redaction and read-only (probe and every SUMMARY block)
**Source:** `derivegaps_probe.py` header 38-51, `emit_record` 595-598, `ReadOnlyRecordingExchange` 201-247; `scripts/deribit_ground_truth.assert_sanitized`.
**Apply to:** plan 02, the orchestrator's recorded run in `231-PROBE-RESULT.md`, and any SUMMARY. Public repo: no address, key id, amount, PROD id or home path.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Shared real-market fixture helper (cassette to real ccxt Bybit markets), e.g. a new `tests/_bybit_real_markets.py` | test helper | transform (offline) | `tests/cassettes/bybit/happy.yaml` (2.5 MB, vcr format: top-level `interactions:` list; each entry `request.uri` plus `response.body.string` holding JSON; ends `version: 1`) is used today ONLY by `tests/test_repro_key_flow.py` through `phase16_vcr.use_cassette` for `fetch_balance` replay (`tests/conftest_vcr.py`). No test decodes its `instruments-info` replies into ccxt markets. Use the builder in RESEARCH "Real ccxt markets offline from the recorded cassette" (decode the `category=linear` reply at cassette line 9676 and the `category=inverse` reply at line 17324; skip the `status=PreLaunch` URIs at 17255 and 17669 or answer them empty; set `ex.publicGetV5MarketInstrumentsInfo = fake_public`, call `fetch_future_markets({"category": cat})` per category, `ex.set_markets(markets)`, then `ex.parse_position(...)`). Load the YAML once per session (it is large). Observed output per RESEARCH: linear `BTCUSDT` gives `BTC/USDT:USDT`, linear `BTCPERP` gives `BTC/USDC:USDC`, inverse `BTCUSD` gives `BTC/USD:BTC`. The cassette holds no position-list reply, so position rows stay documented shapes. |
| Two-year start guard in `_fetch_raw_trades_bybit` (refuse by name, never clamp) | service | request-response | `tests/_trade_pages.py` 218-223 mirrors the venue's retCode 10001 for a start older than 730 days, but no service code in `exchange.py` refuses a stale Bybit start before the walk. Model the refusal on `_refuse` (`bybit_unified_flows.py` 87-88) with static text. |
| Bybit "neither bound = last 7 days" in a fake | test helper | batch | `_trade_pages.bybit_select` and `real_ccxt_client` treat a missing start as 0 (line 423); needed for the `since_ms=None` arm (see section 6). |
| Verdict-token function for VREAD-04 (`undecided` / `replace_supported` / `undecided_near_miss` / `unpaired_present`) | utility | transform | RESEARCH decision table (lines 335-342); no existing verdict function. `measure_bybit_limit`'s `informative` discipline (derivegaps_probe 989-1035) is the style analog; the pairing inputs come from `pair_onchain_with_unified` (`bybit_unified_flows.py` 235-251 `FlowPairing`). |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/scripts/`, `analytics-service/tests/` (including `tests/cassettes/bybit/`), `.planning/milestones/v1.20-phases/186-derivegaps-*`.
**Files read (Read tool, no re-reads of a range):** `services/exchange_pagination.py` (whole), `services/positions.py` (whole), `services/bybit_unified_flows.py` (1-330), `services/exchange.py` (80-259, 625-665, 1940-2015, 2252-2300, 2766-2940, 3095-3310), `services/funding_fetch.py` (70-110, 690-863), `scripts/derivegaps_probe.py` (1-260, 425-610, 1097-1210, 1400-1445, 1640-1796), `tests/test_upnl_venues.py` (whole), `tests/test_positions.py` (1-182, 230-292), `tests/test_derivegaps_probe.py` (1-66, 305-505, 1066-1166), `tests/_trade_pages.py` (whole), `tests/test_bybit_unified_flows.py` (1-190), `tests/test_exchange.py` (5041-5100, 5262-5352, 5683-5757, 5845-5885), `tests/test_nav_marks_l4_read.py` (855-940), `tests/test_derive_broker_dailies_dualmode.py` (3236-3300); plus targeted `sed` extracts of `price_rule.py`, `equity_reconstruction.py` 630-715, `job_worker.py` 2200-2215 and 2650-2658, and the cassette.
**Tracked-source gate (#3645):** `git ls-files` returned non-empty for `services/exchange_pagination.py`, `services/exchange.py`, `services/positions.py`, `services/bybit_unified_flows.py`, `services/funding_fetch.py`, `services/equity_reconstruction.py`, `services/price_rule.py`, `services/closed_sets.py`, `services/nav_marks.py`, `services/allocator_positions.py`, `services/job_worker.py`, `scripts/derivegaps_probe.py`, `scripts/bybit_funding_record.py`, `scripts/deribit_ground_truth.py`, `scripts/walletoffset_probe.py`, `scripts/bybit_upnl_probe.py`, `tests/cassettes/bybit/happy.yaml`, `tests/_trade_pages.py`, `tests/conftest_vcr.py`, `tests/test_exchange.py`, `tests/test_upnl_venues.py`, `tests/test_positions.py`, `tests/test_derivegaps_probe.py`, `tests/test_bybit_unified_flows.py`, `tests/test_nav_marks_l4_read.py`, `tests/test_nav_marks_bybit_uta.py`, `tests/test_derive_broker_dailies_dualmode.py`, `tests/test_allocator_positions.py`, and the 186 phase directory (all under `analytics-service/` except the 186 directory). No mirror path is named. No `.claude/skills` or `.agents/skills` directory exists in this worktree.
**Carried from RESEARCH and not re-read here (grep before anchoring in a PLAN):** `services/nav_marks.py` 373-390 (the `wallet_basis_mismatch` comparison was seen at 383-386 via `sed`), `services/allocator_positions.py` 1747-1801 (`DERIVATIVE_FETCH_FAILED_NOTE` seen at 232 and 1800), `services/equity_reconstruction.py` 598-613 (the `_POSITIONS_PAGE_LIMIT` comment seen at 596-609, use of it at 947), the `TestG12BPaginationGuards` assertion `await_count < 100`, and the 186 run-protocol steps in `186-04-PLAN.md`.
**Pattern extraction date:** 2026-11-23
