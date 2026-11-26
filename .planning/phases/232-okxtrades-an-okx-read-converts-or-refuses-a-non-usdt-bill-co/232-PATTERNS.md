# Phase 232: OKXTRADES - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 17 (6 source symbols across 4 files, 3 new test files, 8 flip/rot edits to existing tests)
**Analogs found:** 17 / 17 (3 are role-match only: the window-major OKX walk has no exact analog; see "No Analog Found")

All analogs are git-tracked (`git ls-files` checked from `analytics-service/`). All paths are relative to
`analytics-service/`. Cite by SYMBOL; line numbers are hints measured at HEAD of worktree 232 and will drift.

## File Classification

| New/Modified File (symbol) | Role | Data Flow | Closest Analog | Match Quality |
|----------------------------|------|-----------|----------------|---------------|
| `services/exchange.py::fetch_daily_pnl` (OKX branch: window-major walk) | service | request-response, paged, batch | `fetch_daily_pnl` Bybit branch (`BYBIT_PNL_WINDOW_MS` loop, ~L2019-2078) + `_fetch_raw_trades_bybit._fetch_page` (~L2880) | role-match (window loop) |
| `services/exchange.py::fetch_daily_pnl` (OKX ccy refusal) | service | transform | same function, OKX aggregation loop (`_OKX_FUNDING_BILL_TYPE`, ~L1798-1818) | exact (same loop) |
| `services/exchange.py::daily_pnl_read_verdict` | utility | transform | itself (`daily_pnl_read_verdict`, ~L214-253) | exact |
| `services/exchange.py` new constants (`OKX_BILLS_WINDOW_DAYS`, `OKX_BILLS_REACH_DAYS`, `OKX_LIVE_BILLS_DAYS`) | config | n/a | `OKX_BILLS_PAGE_CAP` / `BYBIT_PNL_PAGE_CAP` / `BYBIT_EXECUTION_HISTORY_DAYS` block (~L147-179) | exact |
| `services/job_worker.py::READ_INCOMPLETE_TOKENS`, `_DAILY_PNL_REFUSAL_ORDER` | config | n/a | the two sets themselves (~L4127-4160) | exact |
| `services/job_worker.py::run_sync_trades_job` (`fills_since_ms` seed) | service | CRUD (read) | same function, the `fills_since_ms` block (~L2230-2234) + `load_strategy_high_waters` call (~L2190) | exact |
| `services/job_worker.py::run_sync_trades_job` (`advance_fetched_cursor` / `_p_last_fetched` epilogue) | service | CRUD (write via RPC) | same function (~L2678-2740) | exact |
| `services/trade_resume.py::load_strategy_fill_high_water` (new) | service | CRUD (read) | `load_strategy_high_waters` (whole file) | exact |
| `routers/cron.py::_fetch_degradation` (+ module constant) | utility | transform | itself (`_FETCH_INCOME_FALLBACK_FLAG`, `_FETCH_TRUNCATED_PREFIX`, ~L483-522) | exact |
| `routers/cron.py::_sync_single_key` (deadline kwarg, prefix gates) | controller | request-response, event-driven (cron tick) | same function: `fetch_degraded` gates (~L1036-1054, 1077, 1207-1209, 1333-1335, 1427-1433) | exact |
| `routers/cron.py` new `_fetch_prefix_only(flags)` helper | utility | transform | `_fetch_degradation` | role-match |
| `tests/test_okxtrades_ccy.py` (new) | test | request-response | `tests/test_exchange_harness.py::TestPageCapsStampTheTruncationFlag` + `tests/_okx_bills.py` | role-match |
| `tests/test_okxtrades_walk.py` (new) | test | request-response, paged | `tests/_okx_bills.py::OkxBillsArchive` + `TestPageCapsStampTheTruncationFlag` | role-match |
| `tests/test_okxtrades_cursor.py` (new) | test | CRUD | `tests/test_sync_trades_resume_seed.py` (`_make_supabase`, `_run_job`) | exact |
| Flip: `tests/test_daily_pnl_read_verdict.py` (matrix 480 -> 960, new flag dimension) | test | transform | itself (`_combinations`, `_DERIVE_ONLY_FLAGS`) | exact |
| Flip: `tests/test_derive_broker_dailies_dualmode.py` (token-set equality; refusal test for new token) | test | request-response | `TestRealizedReadRefusedByName::test_okx_truncation_refuses_the_key_and_writes_only_the_marker` | exact |
| Flip: `tests/test_cron_router.py` (`TestATruncatedWindowIsNeverTreatedAsComplete.FLAGS`, new prefix tests) | test | request-response | `_drive_cron_sync` + `TestATruncatedWindowIsNeverTreatedAsComplete` | exact |
| Flip: `tests/test_job_worker.py::TestAdvanceSyncCursorFence`, `tests/test_ana_recon_audit.py::test_redteam_c1_...`, `tests/test_exchange_harness.py` OKX tests, `tests/test_exchange.py` two ccy fixtures, `tests/test_walletoffset_probe.py` | test | n/a | the tests themselves | exact |

---

## Pattern Assignments

### 1. `services/exchange.py::fetch_daily_pnl`, OKX branch: window-major walk (service, paged request-response)

**Analog A (the window loop):** `fetch_daily_pnl` Bybit branch, `BYBIT_PNL_WINDOW_MS` loop. It is the only in-file
7-day window walk with a deadline check and a cap flag inside the same function. Copy the SHAPE (while-window loop, deadline
checked before EVERY request, `for _page in range(CAP)`, cap-hit flag), not the `window_start = window_end + 1` advance
(it drifts one ms per window off the UTC-day grid; the OKX walk must stay day-aligned, RESEARCH Pattern 1).

**Window loop + deadline-before-every-request** (Bybit branch, ~L2026-2064):
```python
BYBIT_PNL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000  # 7-day max per request
items: list[dict[str, Any]] = []
window_start = start_ms
_bybit_cap_hit = False
_bybit_deadline_hit = False
while window_start < now_ms and not _bybit_deadline_hit:
    window_end = min(window_start + BYBIT_PNL_WINDOW_MS, now_ms)
    cursor = ""
    for _page in range(BYBIT_PNL_PAGE_CAP):
        if _monotonic() >= _read_deadline:
            _bybit_deadline_hit = True
            break
        ...
        if _page == BYBIT_PNL_PAGE_CAP - 1:
            _bybit_cap_hit = True
    window_start = window_end + 1
```
Differences the OKX walk MUST make against this analog (all from RESEARCH, orchestrator rulings Q2/Q5/Q6):
- window-MAJOR with the literal `for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]` loop kept INSIDE `fetch_daily_pnl`
  and INSIDE each window (the AST pin `tests/test_okx_archive_parse.py::TestLiveInstTypePin` needs a `For` over a list
  literal with target `inst_type`, else it fails "the pin would be vacuous");
- a window's bills go into a LOCAL list and join `all_bills` only when all instTypes and endpoints of that window finish;
  a deadline or cap breach DROPS the in-progress window and STOPS (contiguous oldest prefix; Bybit continues past a cap hit,
  OKX must not);
- `begin = str(a - 1)`, `end = str(b)`, clip to `[a, b)`, any other out-of-window ts raises a typed exception (class name
  flows to `daily_pnl_fetch_error_class`).

**Analog B (the paged OKX request, KEEP as is)** `fetch_daily_pnl` OKX live loop, ~L1635-1675: call through
`_okx_bills_fetch_with_backoff` (never a raw method call), `after` = last `billId`, stop on empty or `< 100` page, cap-hit on
`page == OKX_BILLS_PAGE_CAP - 1`, error handler logs class + scrubbed text then re-raises:
```python
for page in range(OKX_BILLS_PAGE_CAP):
    if _monotonic() >= _read_deadline:
        _okx_deadline_hit = True
        break
    params: dict[str, str] = {"instType": inst_type, "limit": "100"}
    if since_ms:
        params["begin"] = str(since_ms)
    if after_id:
        params["after"] = after_id
    try:
        bills = await _okx_bills_fetch_with_backoff(
            exchange, "private_get_account_bills", params, label=inst_type, page=page,
        )
        data = bills.get("data", [])
        if not data:
            break
        ...
        after_id = data[-1].get("billId", "")
        if len(data) < 100:
            break
        if page == OKX_BILLS_PAGE_CAP - 1:
            _okx_bills_cap_hit = True
    except Exception as e:
        logger.error(
            "OKX bills fetch failed for %s page %d: exc_class=%s scrubbed=%s — "
            "re-raising (partial daily_pnl rejected)",
            inst_type, page, type(e).__name__, scrub_freeform_string(str(e)),
        )
        raise
```
The archive twin (~L1705-1758) is identical with `private_get_account_bills_archive` and `OKX_ARCHIVE_PAGE_CAP`; in the new
walk one per-(window, instType, endpoint) page helper replaces both.

**Analog C (a Bybit raise-by-name self-check, the template for the OKX window self-checks):**
`_fetch_raw_trades_bybit._fetch_page`, ~L2903-2918: required-keys check and stuck-cursor check each `raise
BybitTradeWindowIncomplete("<closed reason>")` BEFORE returning a short page, with a `logger.warning` that carries no venue
text. Copy that discipline for "billId not strictly descending" and "ts outside `[a-1, b]`".

**Merge/dedup by billId and the aggregator stay unchanged** (~L1767-1779 and ~L1787-1855): drop type `8`, then (new) ccy,
then `_finite_float` pnl+fee, group by UTC day, daily row with `fee_currency: "USDT"`.

**Cap constants (pin unchanged, "raising is not a close")** ~L147-148:
```python
OKX_BILLS_PAGE_CAP: int = 100
OKX_ARCHIVE_PAGE_CAP: int = 100
```
Module constants (NOT `Final`) so tests lower them by `monkeypatch.setattr(ex, "OKX_BILLS_PAGE_CAP", 3)`; the new
`OKX_BILLS_WINDOW_DAYS`, `OKX_BILLS_REACH_DAYS`, `OKX_LIVE_BILLS_DAYS` follow the same non-`Final` convention and sit in the
same block with a `#:` doc comment each (copy the comment style of ~L149-179).

**Deadline plumbing already exists:** `_read_deadline = float("inf") if read_deadline_s is None else _monotonic() + read_deadline_s`
(~L1614) and `fetch_all_trades(exchange, symbol=None, since_ms=None, *, read_deadline_s=None)` (~L3168) forwards it. The cron
only needs to pass the kwarg (see 9).

**Marker:** reuse `_record_dq_flag("daily_pnl_deadline_okx", True)` (as at ~L1693) with the tightened contract (Q2). The
`_record_dq_flag` signature: `_record_dq_flag(key: str, value: Any) -> None`, never raises, booleans OR-merge.

---

### 2. `services/exchange.py::fetch_daily_pnl`, OKX ccy refusal (service, transform)

**Analog:** the aggregation loop itself, right after the type-8 drop (~L1798-1818). Insert the check between the `continue`
and `_finite_float`, so a type-8 BTC funding bill never refuses (arm `okx-funding-bill-in-btc-not-refused`).

**Where it goes** (current text):
```python
_OKX_FUNDING_BILL_TYPE = "8"
_okx_funding_bills_dropped = 0
for bill in all_bills:
    bill_type = str(bill.get("type", "")).strip()
    if bill_type == _OKX_FUNDING_BILL_TYPE:
        _okx_funding_bills_dropped += 1
        continue
    # >>> NEW ccy check here (after the continue, before _finite_float) <<<
    _pnl_raw = _finite_float(bill.get("pnl", 0), label="OKX bill pnl")
    _fee_raw = _finite_float(bill.get("fee", 0), label="OKX bill fee")
    if _pnl_raw is None or _fee_raw is None:
        logger.warning(...)
        _record_dq_flag("daily_pnl_malformed_okx", True)
        continue
    pnl_val = _pnl_raw + _fee_raw
```
**Predicate to copy (ruling Q3, overrides RESEARCH's ccy-only):** refuse only when `not is_stable_value(str(bill.get("ccy") or ""))`
AND the finite `pnl + fee` is nonzero. `is_stable_value` is `services/price_rule.py::is_stable_value(asset: str) -> bool` =
`asset.upper() in _STABLE_VALUE` (STABLECOINS | STABLECOIN_SPLIT_SUFFIXES); it is NOT yet imported in `exchange.py`, so add the
import. `str(... or "")` first because `.upper()` on `None` raises. On refusal: `_record_dq_flag("daily_pnl_non_usd_okx", True)`,
clear `daily_totals`, `return []` (Pattern 3: a flag alone is not the stop; flag-blind callers must get `[]`). Note the
function's `return`s sit inside a `try` whose outer `except Exception` stamps `daily_pnl_fetch_error`; verify the early
`return []` happens before any code path re-appends to `daily_pnl`. Log the ccy census at WARNING by count only, ccy code
accepted only if it matches `^[A-Za-z0-9]{1,16}$` (else `"malformed"`), never put the code in the flag.

**Warning-log shape to copy for the refusal** (same module, ~L1811-1816): whitelisted fields only (`billId`, never `bill` dump).

---

### 3. `services/exchange.py::daily_pnl_read_verdict` (utility, transform)

**Analog:** itself. Current reasons assembly (~L233-243):
```python
reasons: list[str] = []
if flags.get("daily_pnl_fetch_error"):
    reasons.append("daily_pnl_fetch_error")
if flags.get("daily_pnl_binance_income_fallback"):
    reasons.append("daily_pnl_binance_income_fallback")
reasons.extend(
    key
    for key, value in flags.items()
    if key.startswith(("daily_pnl_truncated_", "daily_pnl_deadline_"))
    and value
)
```
Add an explicit `if flags.get("daily_pnl_non_usd_okx"): reasons.append("daily_pnl_non_usd_okx")` beside the
income-fallback line (the new token matches neither prefix). `_fetch_degradation` in `routers/cron.py` must name it
IDENTICALLY (the parity matrix asserts `verdict.reasons == sorted(cron_reasons + derive_only_deadline)`).

---

### 4. Token registration in `services/job_worker.py` (config)

**Analog:** the sets at ~L4127-4160. Exact edit shape:
```python
READ_INCOMPLETE_TOKENS: Final[frozenset[str]] = frozenset(
    {
        "daily_pnl_fetch_error",
        "daily_pnl_truncated_okx",
        # add "daily_pnl_non_usd_okx" here
        "daily_pnl_truncated_bybit",
        ...
    }
)
_DAILY_PNL_REFUSAL_ORDER: Final[tuple[str, ...]] = (
    "daily_pnl_fetch_error",
    "daily_pnl_truncated_okx",
    # insert "daily_pnl_non_usd_okx" right after truncated_okx (both permanent)
    "daily_pnl_truncated_bybit",
    "daily_pnl_binance_income_fallback",
    "read_deadline",
)
_TRANSIENT_REFUSAL_TOKENS: Final[frozenset[str]] = frozenset(
    {"daily_pnl_fetch_error", "read_deadline"}   # DO NOT add the new token: permanent class
)
```
`_realized_refusal_token(reason)` maps only `daily_pnl_deadline_*` to `read_deadline`; every other reason is the token
itself, so no change there. `_record_read_incomplete` returns False for a token outside `READ_INCOMPLETE_TOKENS` ("token
outside the set") so an unregistered token would refuse the key UNNAMED. The derive's use site (~L8645-8668) needs no edit.

---

### 5. `services/job_worker.py::run_sync_trades_job`: `fills_since_ms` seed (service, CRUD read)

**Analog:** the current seed + the daily high-water read in the same function. Edit scope is EXACTLY this span (222
ALERTTRUTH re-bases on it).

**Current code** (~L2230-2237):
```python
fills_since_ms = parse_since_ms(
    None, preferred=ctx.key_row.get("last_fetched_trade_timestamp")
)
if fills_since_ms is None:
    fills_since_ms = daily_since_ms
try:
    raw_fills = await fetch_raw_trades(
        ctx.exchange, strategy_id, ctx.supabase, since_ms=fills_since_ms
    )
```
**Off-event-loop DB read idiom to copy** (~L2190-2193):
```python
_hw_by_strategy, _hw_err = await db_execute(
    lambda: load_strategy_high_waters(ctx.supabase, [strategy_id])
)
daily_since_ms = parse_since_ms(_hw_by_strategy.get(strategy_id))
```
**Shape of the new seed (RESEARCH "Fills seed and stamp" + ruling Q1):** read the column; ONLY when it parses (lazy), call
`await db_execute(lambda: load_strategy_fill_high_water(ctx.supabase, strategy_id))`; `fills_since_ms = min(col_ms,
parse_since_ms(hw_iso))` when a fill exists; when no stored fill OR the read failed, ignore the column and use
`daily_since_ms`; a NULL/unparsable column keeps today's `daily_since_ms`. Import beside L137: `from services.trade_resume import
load_strategy_high_waters` -> add `load_strategy_fill_high_water`. The comment at ~L2225-2229 ("TODOS ... stays OPEN: this read
still trusts its cursor") must be rewritten (it becomes false).

---

### 6. `services/job_worker.py::run_sync_trades_job`: epilogue stamp and gate (service, CRUD write via RPC)

**Analog:** the epilogue (~L2678-2740). Current:
```python
advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)
...
_now_iso = datetime.now(timezone.utc).isoformat()
_p_last_fetched = _now_iso if advance_fetched_cursor else None
_p_last_sync = _now_iso if not phase1_failed else None

if _p_last_fetched is None and _p_last_sync is None and account_balance is None:
    logger.info(
        "sync_trades: advance_sync_cursor skipped — no columns to write "
        "(advance_fetched_cursor=%s phase1_failed=%s account_balance=%s; "
        "last_sync_at intentionally held for retry)",
        advance_fetched_cursor, phase1_failed, account_balance,
    )
else:
    def _advance_cursor() -> bool:
        res = ctx.supabase.rpc("advance_sync_cursor", {
            "p_api_key_id": ctx.key_row["id"], "p_job_id": job["id"],
            "p_claim_token": (job.get("claim_token") if WORKER_FENCE_V2 else None),
            "p_last_fetched_ts": _p_last_fetched,
            "p_last_sync_at": _p_last_sync,
            "p_account_balance": account_balance,
        }).execute()
        return bool(res.data)
```
**New stamp (RESEARCH design 3, rulings Q1, Q7):** `_p_last_fetched` = ISO of `max(coerce_to_aware_utc(f["timestamp"],
"sync_trades") for f in raw_fills)` only when `raw_fills and phase2_complete and not phase2_failed and not phase1_failed` and
no `sync_truncated_*` key in `exchange_dq_flags` is truthy; a `ValueError` from `coerce_to_aware_utc` holds the cursor (None).
Else None, EXCEPT the Q1 bootstrap anchor: when `phase2_failed` AND the column was NULL at read time AND the run had a non-NULL
seed, pass that seed (as an ISO string) as `_p_last_fetched`. `coerce_to_aware_utc` lives in
`services/ingestion/_timestamps.py` (`def coerce_to_aware_utc(ts_raw: Any, source: str) -> datetime`, raises `ValueError`);
`services/job_worker.py` does not import it today, so add the import. Keep the skip-log message accurate (it names
`advance_fetched_cursor`). `phase2_failed` is set at ~L2289 (fetch raised) and ~L2477 (persist failed); both are defined before
the epilogue, so the gate can read it. The RPC (migration `20260602173710_advance_sync_cursor_claim_token_fence.sql`) is
monotonic per column; NO migration, NO RPC change.

---

### 7. `services/trade_resume.py::load_strategy_fill_high_water` (new; service, CRUD read)

**Analog:** `load_strategy_high_waters` in the same file. Copy the contract (leaf module, imports only `services.db`; FAIL
OPEN; never raise; error string; the `rows(result)` unwrap). Differences: `.eq("is_fill", True)`, exact timestamp (NO
`high_water_floor_iso` day floor, per LASTSYNC-SEED decision 4: the fills seed is unfloored), one strategy.

**Imports pattern** (file L1-26):
```python
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Any
from services.db import rows
logger = logging.getLogger("quantalyze.analytics")
```
**Core query + fail-open pattern to copy** (`load_strategy_high_waters`):
```python
try:
    result = (
        supabase.table("trades")
        .select("timestamp")
        .eq("strategy_id", sid)
        .eq("is_fill", False)          # -> True for the fills helper
        .order("timestamp", desc=True)
        .limit(1)
        .execute()
    )
    newest = rows(result)
    mapping[sid] = (
        high_water_floor_iso(newest[0]["timestamp"]) if newest else None   # -> newest[0]["timestamp"] unfloored
    )
except Exception as exc:
    logger.exception(
        "stored-high-water read failed for strategy %s — failing OPEN ...", sid,
    )
    mapping[sid] = None
    errors.append(f"{sid}: {type(exc).__name__}: {exc}")
```
Return type `tuple[str | None, str | None]` (iso, error). Add a docstring that mirrors the `is_fill = false IS THE WHOLE
FILTER` warning, inverted: here `is_fill = true` is the whole filter and is the REASON this helper differs. Index
`idx_trades_strategy_timestamp ON trades (strategy_id, timestamp)` serves the read. mypy strict applies (`services/` is in the
gate path set).

---

### 8. `routers/cron.py::_fetch_degradation` (utility, transform)

**Analog:** itself (~L483-522). Add a module constant beside `_FETCH_INCOME_FALLBACK_FLAG` and name it explicitly:
```python
_FETCH_INCOME_FALLBACK_FLAG = "daily_pnl_binance_income_fallback"
_FETCH_TRUNCATED_PREFIX = "daily_pnl_truncated_"
...
def _fetch_degradation(flags: dict[str, Any]) -> tuple[list[str], str | None]:
    reasons: list[str] = []
    if flags.get(_FETCH_ERROR_FLAG):
        reasons.append(_FETCH_ERROR_FLAG)
    if flags.get(_FETCH_INCOME_FALLBACK_FLAG):
        reasons.append(_FETCH_INCOME_FALLBACK_FLAG)
    reasons.extend(key for key, value in flags.items()
                   if key.startswith(_FETCH_TRUNCATED_PREFIX) and value)
```
Hazard to carry into the plan: "an empty list plus an unnamed token reads as an idle tick (`not trades`) and advances the
cursor", so an unregistered token is silent data loss, not a cosmetic miss.

---

### 9. `routers/cron.py::_sync_single_key` (controller, cron tick)

**Analog:** the existing `fetch_degraded` plumbing, which the prefix path must sit BESIDE and not inside (a prefix is NOT
degraded: rows ARE stored). Six touch points, all verified in the current text:

1. **Call** (~L1036): `trades = await fetch_all_trades(exchange, since_ms=since_ms)` -> add
   `read_deadline_s=OKX_CRON_READ_DEADLINE_S if exchange_name == "okx" else None` (OKX ONLY: Bybit's
   `daily_pnl_deadline_bybit` is a partial window, not a prefix). `fetch_all_trades` already accepts `read_deadline_s`. Existing
   tests read `fetch_mock.call_args.kwargs["since_ms"]`, so an extra kwarg is safe. Check the local name for the venue
   (`exchange_name`/`key["exchange"]`) in the function before copying the expression.
2. **Drain + derive flags** (~L1050-1054):
   ```python
   fetch_dq_flags = get_and_clear_last_dq_flags()
   fetch_degraded_reasons, fetch_error_class = _fetch_degradation(fetch_dq_flags)
   fetch_degraded = bool(fetch_degraded_reasons)
   ```
   add `fetch_prefix_only = _fetch_prefix_only(fetch_dq_flags) and not fetch_degraded` right after.
3. **Store gate** (~L1077) `if trades and strategy_ids and not fetch_degraded:` stays AS IS (a prefix IS stored).
4. **Key cursor** (~L1207): copy the conjunct style
   ```python
   should_advance_cursor = (
       ((not trades) or synced_count > 0) and not fetch_degraded
   )
   ```
   -> add `and not fetch_prefix_only` (also stops an EMPTY prefix reading as an idle tick).
5. **Recompute enqueue** (~L1333): `recompute_strategy_ids = [] if fetch_degraded else list(dict.fromkeys(strategy_ids))`
   -> `if (fetch_degraded or fetch_prefix_only)`.
6. **Per-strategy advance** (~L1427): `strategy_advances = (not fetch_degraded) and ( ... )` -> `(not fetch_degraded) and
   (not fetch_prefix_only) and ( ... )`. Keep the "IDLE DISJUNCT IS EVIDENCE-BASED" comment true: `not trades` is idle ONLY
   when no deadline flag is set. A marker-less held strategy writes NO marker row (the `if sid not in strategy_cursors:
   continue` branch ~L1438-1456): do not change it.

Status falls out of the existing classifier as `held` (in `_NON_OK_STATUSES`); add `result["fetch_partial_prefix"] = True`
to the key result beside where `fetch_degraded` is surfaced. `_fetch_prefix_only(flags) -> bool` = `bool(flags.get("daily_pnl_deadline_okx"))`,
a new tiny helper next to `_fetch_degradation`; define the cron deadline constant (RESEARCH: ~35 s of `KEY_SYNC_TIMEOUT = 60`,
tune at plan time, `[ASSUMED]`) beside `KEY_SYNC_TIMEOUT` (~L81).

Held-key log idiom to copy (~L1238-1250) for a prefix-hold warning: key id + reason + "next tick re-reads" wording.

---

### 10. `tests/test_okxtrades_ccy.py`, `tests/test_okxtrades_walk.py` (new; tests, request-response)

**Analog (fake):** `tests/_okx_bills.py::OkxBillsArchive` + `okx_bill`. It honours `begin`/`end`/`after`/`limit`/`instType`,
serves newest-first by `billId`, and has negative switches. Real `fetch_daily_pnl` is driven with
`exchange.private_get_account_bills = AsyncMock(side_effect=OkxBillsArchive(rows))` (same for
`private_get_account_bills_archive`).

**Bill builder** (`tests/_okx_bills.py`): `okx_bill(bill_id: int, ts: int, ccy: str, bal: str, bal_chg: str, *, bill_type="2",
inst_type="SPOT", sub_type="", mgn_mode="", pos_bal_chg="", pnl="", fee="")`; `pnl`/`fee` keys are present ONLY when given, so a
ccy test passes `pnl="10"`, `fee="-1"`, `ccy="BTC"`. Funding bill = `bill_type="8"`. Extend the helper ONLY additively and
default-off (the module docstring records every earlier phase doing the same).

**Venue-faithful negatives (use these, do not hand-roll):**
```python
OkxBillsArchive(rows, oldest_first_with_begin=True)   # begin-bounded reply served ascending -> walk must refuse by name
OkxBillsArchive(rows, ignore_after=True)              # stalled cursor
OkxBillsArchive(rows, empty_after_cursor=True)        # second page empty
```
**Legacy in-file bill builder** (`tests/test_exchange_harness.py::_okx_bill`, L22-36): string `billId`, `ccy: "USDT"`,
`type` absent. Fine for non-window tests; the new walk tests need window-relative integer-id bills, so use `okx_bill`.

**Exchange object + time helpers** in `tests/test_exchange_harness.py`: `_make_okx_exchange()`, `_ts(y, m, d, h)`. Check whether
they are importable (module-level helpers, not fixtures) before reusing; otherwise build the same 5-line stub locally. Build
timestamps RELATIVE TO NOW (`now - timedelta(days=...)`), never fixed 2024/2026 dates (the calendar-rot trap, see 17).

**Cap-lowering + deadline-without-sleep idioms to copy** (`TestPageCapsStampTheTruncationFlag`):
```python
monkeypatch.setattr(ex, "OKX_BILLS_PAGE_CAP", 3)            # reach the cap in 3 calls, not 100
monkeypatch.setattr(ex, "_monotonic", _clock)                # _clock returns 0.0 then 1e12 keyed off counter["n"]
rows = await fetch_daily_pnl(exchange, since_ms, read_deadline_s=ex.DAILY_PNL_READ_DEADLINE_S)
flags = ex.get_and_clear_last_dq_flags()
assert flags.get("daily_pnl_deadline_okx") is True
assert "daily_pnl_truncated_okx" not in flags
```
and the "never runs out" page stub `_full_pages(prefix, inst_type, ts_ms)` (100 rows, fresh billIds each call). In the new
walk file prefer `OkxBillsArchive` with a dense synthetic day so the stub honours `begin`/`end` per window (a canned-page mock
that serves the same bills to every window lets dedup hide a missing window, RESEARCH Pitfall 4).

**Flag drain:** always `ex.get_and_clear_last_dq_flags()` BEFORE the call (buffer is a per-task ContextVar) and read it from
the real walk, never from a patched buffer.

**Named-arm convention (PROOF-01):** one test per arm named exactly as RESEARCH's Req->Test table (`okx-mixed-ccy-day-refused`,
`okx-blank-ccy-refused`, `okx-stable-ccy-counted-at-1`, `okx-funding-bill-in-btc-not-refused`, `okx-usdg-refused`,
`long-first-window-completes`, `deadline-returns-whole-windows-only`, `cap-breach-returns-contiguous-prefix`,
`ticks-complete-the-range`, `begin-oldest-first-venue-refused`, `out-of-window-row-refused`, `edge-bill-counted-once`,
`okx-page-cap-unchanged`). Module docstring lists the NEUTER per arm in the `NEUTER (each recorded in the SUMMARY, restored
from a byte backup)` form that `tests/test_sync_trades_resume_seed.py` uses (N1..Nk).

---

### 11. `tests/test_okxtrades_cursor.py` (new; test, CRUD)

**Analog (exact):** `tests/test_sync_trades_resume_seed.py`. Copy `_Recorder`, `_make_supabase(trades_rows=..., trades_select_error=...)`
with its `_FakeTradesQuery` (applies every `.eq/.order/.limit`, so a failed read is distinguishable from a real seed),
and `_run_job(supabase=..., last_fetched_trade_timestamp=...)` which drives the REAL `run_sync_trades_job`. Extend the helper
copy (do not edit the original) so `fetch_raw` can `side_effect` raise or return fills, and so the `advance_sync_cursor` RPC
params are captured.

**Imports pattern:**
```python
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from services.job_worker import DispatchOutcome, run_sync_trades_job
```
**Driver patch block to copy** (`_run_job`):
```python
with patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=mock_ctx)), \
     patch("services.job_worker.fetch_all_trades", new=fetch_all), \
     patch("services.job_worker.fetch_usdt_balance", new=AsyncMock(return_value=10000.0)), \
     patch("services.job_worker.fetch_raw_trades", new=fetch_raw), \
     patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())), \
     patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", True):
    result = await run_sync_trades_job(job)
```
**Reading the stamped value** (copy `tests/test_job_worker.py::TestAdvanceSyncCursorFence._find_advance_call`):
```python
for call in mock_ctx.supabase.rpc.call_args_list:
    if call.args and call.args[0] == "advance_sync_cursor":
        return call.args[1]          # params["p_last_fetched_ts"]
```
Fixtures are TYPED LITERALS with hand-typed epoch ms (the file's `DAILY_NEWEST_DAY_START_MS = 1778112000000`, `FILLS_CURSOR_MS`
convention), never computed from the code under test. Arms: `refused-fills-read-holds-cursor` (fetch_raw raises ->
`p_last_fetched_ts is None`, RED on HEAD), `cursor-stamps-stored-through-not-now` (== max fill timestamp), `empty-run-leaves-column-untouched`
(ingestion off, clean empty read), `truncated-fills-read-holds-cursor` (`sync_truncated_okx` in the raw flags),
`ahead-key-reads-from-stored-fill-high-water` (assert the `fetch_raw` `since_ms` == stored fill ms; no stored fill -> daily seed;
read failure -> daily seed; NULL column -> daily seed with NO `is_fill=True` query recorded), `refusal-then-clean-sequence`.
`fetch_raw.side_effect` must be `get_and_clear_last_dq_flags`-aware: patch
`services.job_worker.get_and_clear_last_dq_flags` to return the flag dict for the truncated arm, as the cron driver does with
`cron_mod`.

**Rule 9 note (carry into the plan):** `tests/test_ana_recon_audit.py::test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance`
re-types the formula inline and ends with `inspect.getsource(...)` substring checks (`"not phase1_failed" in src`), so it
can never go RED. REPLACE it with a case in this new file that drives `run_sync_trades_job` with `phase1_failed` (sync_trades
RPC raising) and fills present, asserting `p_last_fetched_ts is None`.

---

### 12. Flip: `tests/test_daily_pnl_read_verdict.py` (test, transform)

**Analog:** the file itself. Add a flag dimension exactly like the income-fallback one:
```python
_FLAG_STATES: tuple[bool | None, ...] = (None, True)
...
for fetch_error, klass, trunc_okx, trunc_bybit, income, derive_only in itertools.product(
    _FETCH_ERROR_ABSENT_OR_TRUE, _CLASSES, _FLAG_STATES, _FLAG_STATES, _FLAG_STATES, _DERIVE_ONLY_FLAGS):
```
add `non_usd` as one more `_FLAG_STATES` factor, set `flags["daily_pnl_non_usd_okx"] = True` when present, and change
`test_the_parity_matrix_has_the_documented_size` from `480` to `960` (and its comment). The parity assertion body is unchanged
(`verdict.reasons == tuple(sorted([*cron_reasons, *derive_only]))`), which is what forces `_fetch_degradation` to name the token
identically. `_check_live_realized_flags` (Phase 223 file) is compared only on `rate_limited`, so the matrix will not force it:
that is the hand-off (ruling Q4), not an edit here.

### 13. Flip: `tests/test_derive_broker_dailies_dualmode.py` (test, request-response)

**Token-set equality** (`test_the_token_set_is_exactly_the_shipped_closed_set`, ~L2584): add `"daily_pnl_non_usd_okx"` to the
expected frozenset.
**New refusal case:** copy `TestRealizedReadRefusedByName::test_okx_truncation_refuses_the_key_and_writes_only_the_marker`
(~L2113-2135) verbatim with `{"daily_pnl_non_usd_okx": True}` and assert `error_kind == "permanent"` on the FIRST attempt (the
token is not in `_TRANSIENT_REFUSAL_TOKENS`), marker `kind == "read_incomplete:key-fh"`, `payload["token"] == "daily_pnl_non_usd_okx"`.
Driver: `_refused_key_derive("okx", {...})` (~L2055) -> `_ccxt_key_derive_with_real_combine`; helper asserts
`_read_incomplete_rows(capture)` and `_assert_nothing_written_but_the_marker(seen)`.

### 14. Flip: `tests/test_cron_router.py` (test, request-response)

- Add `"daily_pnl_non_usd_okx"` to `TestATruncatedWindowIsNeverTreatedAsComplete.FLAGS` (~L7696). The class's parametrized
  tests (`test_each_truncation_flag_is_a_degradation_reason`, `test_a_truncated_window_is_not_stamped_stored_or_marked`,
  `test_a_truncated_window_leaves_an_error_heartbeat`) then cover it for free. NOTE the class docstring/the parametrization
  assert `key_result["fetch_degraded_reasons"] == [flag]`, which holds only because `_fetch_degradation` names the token.
- New prefix tests copy that class's driver shape:
  ```python
  mock_supabase = _make_mock_supabase_for_cron_sync(keys_data=[_strategy_key("live", "okx")])
  response = await _drive_cron_sync(
      mock_supabase,
      fetch_mock=AsyncMock(return_value=[{"id": "t1"}]),
      dq_flags={"daily_pnl_deadline_okx": True},
  )
  ```
  Assertions to mirror from `test_a_truncated_window_is_not_stamped_stored_or_marked`, INVERTED for the store and equal for
  the rest: `sync_trades` RPC IS called (`[c for c in mock_supabase.rpc.call_args_list if c.args[0] == "sync_trades"]`),
  `mock_supabase.strategy_analytics_updates == []`, `mock_supabase.strategy_cursor_upserts == []`, no `enqueue_compute_job`
  rpc, `key_result["status"] == "held"`, `key_result["fetch_partial_prefix"] is True`, and no `last_sync_at` update. An
  EMPTY prefix test uses `fetch_mock=AsyncMock(return_value=[])` + the deadline flag and must still read `held`, not idle.
  `cron-okx-gets-a-deadline` / `cron-bybit-gets-none`: read `fetch_mock.call_args.kwargs["read_deadline_s"]` (same style as
  the existing `fetch_mock.call_args.kwargs["since_ms"]` reads at ~L4839).
- `test_the_venue_set_is_exactly_the_branches_fetch_daily_pnl_has` (~L7878) regex-reads `exchange.id == "..."` in
  `inspect.getsource(fetch_daily_pnl)`; keep the `exchange.id == "okx"` literal in place when restructuring the branch.

### 15. Flip: `tests/test_job_worker.py::TestAdvanceSyncCursorFence::test_threads_claim_token_when_fence_on` (~L1203)

`assert params["p_last_fetched_ts"] is not None` (ingestion OFF, one daily trade) flips to `is None`, with the rationale
recorded in the assertion message (the column now stamps stored-through or nothing). Unchanged and still green:
`TestSyncTradesPhase2PartialBatchFailure` (`p_last_fetched_ts is None`, ~L3843), `tests/test_compute_jobs_fencing.py`,
`tests/test_mt5_sync_path.py`.

### 16. Flip: `tests/test_exchange_harness.py` OKX tests (test, request-response)

Re-fixture, do not delete: `TestOKXFetchDailyPnl::test_since_ms_passed_to_recent_and_archive` (asserts `params["begin"] ==
str(since_ms)` -> window `begin`/`end`), `test_90_day_gate_skips_archive` (flips: archive is age-routed, Q6),
`test_pagination` (numeric-ascending ids trip the descending check), every canned-page test with a fixed 2024 `ts` (window clip
drops or refuses it; re-date to window-relative times, ~20 mechanical edits), `TestPageCapsStampTheTruncationFlag` deadline
tests (`assert rows` now means whole windows only) and `test_okx_archive_that_ends_on_a_short_page_is_not_truncated`
(`calls["n"] == 100` stub is not window-aware). Cap-flag tests (`counter["n"] == 100 / 3 / 2`) keep passing because the first
window caps. Also `tests/test_exchange.py`: `TestFetchDailyPnlOkxFailLoud::test_okx_bill_dropped_on_non_digit_ts_logs_warning`
(3 bills, no `ccy`) and `TestClusterIOkxFundingBillFilter::test_okx_funding_bills_excluded_from_daily_pnl` (the `bill-trade`
bill needs `ccy`), 2 tests / 5 bill dicts; and `tests/test_walletoffset_probe.py::test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx`
(`_B_MS` = 2026-10-27 goes RED about 2027-01-28: make it relative to now).

---

## Shared Patterns

### Fail loud with a closed token, never venue text
**Source:** `services/exchange.py::_okx_bills_fetch_with_backoff` / the OKX error handlers (~L1664-1675); `routers/cron.py::_ERROR_CLASS_NAME_RE`; `services/job_worker.py::_READ_INCOMPLETE_CLASS_RE`.
**Apply to:** the window self-check exceptions, the ccy refusal, every new log line.
```python
logger.error(
    "OKX bills fetch failed for %s page %d: exc_class=%s scrubbed=%s — re-raising (partial daily_pnl rejected)",
    inst_type, page, type(e).__name__, scrub_freeform_string(str(e)),
)
raise
```
Only a class name matching `^[A-Za-z_][A-Za-z0-9_]{0,63}$` or a closed token reaches a flag, a marker or the cron envelope.
`daily_pnl_*` flags drained by the queued job are merged into the PUBLICLY readable `strategy_analytics.data_quality_flags`, so a ccy code never goes into a flag.

### DQ buffer discipline
**Source:** `services/exchange.py::fetch_daily_pnl` entry `_LAST_DQ_FLAGS.set({})`; `routers/cron.py` ~L1050 and `services/job_worker.py` ~L2198 (`get_and_clear_last_dq_flags()` IMMEDIATELY after the await, before any other exchange call).
**Apply to:** the cron deadline call and every new test (drain before AND after).

### Cursor writes go through the fenced RPC only
**Source:** `services/job_worker.py::run_sync_trades_job` `_advance_cursor` (`advance_sync_cursor`, monotonic CASE per column, claim-token fence). A NULL param leaves the column. No `api_keys.update()` for `last_fetched_trade_timestamp` anywhere (the reconcile job is not a writer).

### Whole windows or nothing (partial days never stored)
**Source:** `routers/cron.py::_floor_to_utc_day_ms` + the `sync_trades` RPC's payload-window delete (a partial day overwrites a whole stored one). Day-aligned windows keep every returned day entirely inside one completed window.

### Test-harness conventions (PROOF-01)
**Source:** `tests/test_sync_trades_resume_seed.py` module docstring (`NEUTER (each recorded in the SUMMARY, restored from a byte backup)`, N1..Nk) and `TestPageCapsStampTheTruncationFlag` (`monkeypatch.setattr(ex, "<CAP>", 3)`).
**Apply to:** all three new test files: every gate arm named, each with its neuter line (RESEARCH "PROOF-01: the neuter for each gate"), RED seen on pre-fix/neutered code, `cp` restore from a byte backup then `cmp`, GREEN, recorded verbatim in the plan SUMMARY. Pytest only from `analytics-service/`, never `importlib.reload`, `grep -a`.

### mypy strict
CI gate: `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (HEAD baseline: no issues in 142 files). `tests/` is untyped by design. New helpers need full annotations; `# type: ignore[...]` in tests is the existing idiom where dict-typed harness returns are indexed.

---

## No Analog Found

| File / part | Role | Data Flow | Reason |
|-------------|------|-----------|--------|
| OKX window-major walk with a discarded in-progress window and a contiguous-oldest-prefix return | service | paged, batch | `services/exchange_pagination.py::walk_paginated` is INST-major, has no deadline hook, advances `prev_end + 1` (off the UTC-day grid) and cannot discard a partial window; the Bybit loops continue past a cap hit. Use the Bybit loop SHAPE plus the Pattern 1/2 rules in RESEARCH. Do NOT reuse `walk_paginated` or `_windows`. |
| Self-checking walk (billId strictly descending, ts inside `[a-1, b]`, named exception) | service | validation | Closest is `_fetch_raw_trades_bybit._fetch_page` raising `BybitTradeWindowIncomplete("<reason>")`; no OKX bills equivalent exists. Mint a typed exception class beside `BybitTradeWindowIncomplete` (~L668) so its class name reaches `daily_pnl_fetch_error_class`. |
| Cron "prefix" outcome (store rows, hold every cursor, status `held`, `fetch_partial_prefix`) | controller | cron tick | No existing tick stores rows while holding cursors: the nearest, `fetch_degraded`, stores NOTHING. The four gates are a deliberate asymmetry; copy the conjunct style of the `fetch_degraded` edits. |
| Venue behaviour under `begin`/`end` (inclusivity, order, window older than 7 days for `/account/bills`) | n/a | n/a | UNMEASURED in-repo (`tests/_okx_bills.py` docstring: "inclusive is assumed, RESEARCH A4"). Guarded by overlap-by-1ms + clip + the self-check, not by measurement. |

## Hand-offs and deliberate non-edits (carry into the plans' scope fences)

- `services/okx_archive_job.py::_check_live_realized_flags` (Phase 223): not edited. It matches only `daily_pnl_fetch_error` and `daily_pnl_truncated_okx`, so it will not refuse on `daily_pnl_non_usd_okx` (ruling Q4: one-line hand-off to the coordinator for 223, `if flags.get("daily_pnl_non_usd_okx"): raise _Stop("live_anchor_unusable", "live_realized=non_usd")`).
- `services/funding_fetch.py`, `run_sync_funding_job`: not edited (223).
- `run_sync_trades_job`: edit ONLY the `fills_since_ms` block and the `advance_fetched_cursor`/`_p_last_fetched` epilogue; 231 gap 3 and the Phase-1-store-under-flags behaviour route to 222 ALERTTRUTH by name.
- `USE_RAW_TRADE_INGESTION` is read once at import (`_RAW_TRADE_INGESTION_ENABLED`); tests patch the module constant, not the env.

## Metadata

**Analog search scope:** `analytics-service/services/{exchange,job_worker,trade_resume,exchange_pagination,price_rule}.py`, `analytics-service/routers/cron.py`, `analytics-service/tests/{_okx_bills,test_exchange_harness,test_exchange,test_cron_router,test_job_worker,test_sync_trades_resume_seed,test_daily_pnl_read_verdict,test_derive_broker_dailies_dualmode,test_ana_recon_audit,test_okx_archive_parse,test_walletoffset_probe}.py`
**Files scanned:** about 20 read or grepped (large files read by targeted ranges, no range read twice)
**Pattern extraction date:** 2026-11-24
