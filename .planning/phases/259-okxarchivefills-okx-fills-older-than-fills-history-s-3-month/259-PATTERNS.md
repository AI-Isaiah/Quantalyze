# Phase 259: OKXARCHIVEFILLS - Pattern Map

**Mapped:** 2026-11-27
**Files analyzed:** 13 (4 new source modules, 3 modified source files, 3 new test files, 1 extended test, 2 new fixtures)
**Analogs found:** 13 / 13 (one file is an exact extraction of live code; the chain seam and the fills job have role-match analogs)

All paths are repo-relative and git-TRACKED (checked with `git ls-files` for every analog named). Line numbers are for this checkout and drift; the symbol names are the stable anchor, so cite by symbol in plans (CLAUDE.md: `[164.7-CITATION-DRIFT-01]` class).

## Decisions this map assumes (from CONTEXT.md Addendum 2026-11-27)

- Two new modes of kind `okx_archive_rebuild`: `fills_calibrate` (everything except the write) and `fills_apply`. No migration, no new kind, no `TIMEOUT_PER_KIND` / `JOB_CHAIN_FOLLOW_ON` / `WATCHDOG_PER_KIND_OVERRIDES` / `BACKFILL_KINDS` / `display-labels.ts` change.
- Fork at the top of `run_okx_archive_rebuild_job` into a new module.
- Cooldown trigger (14 days, `fills_apply` jobs only), anchor = earliest `csv_daily_returns` date, stored `timestamp` = archive `ts`, GET-first apply budget, one extracted pure normaliser helper pinned by a golden recorded BEFORE the extraction.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/exchange.py` (extract helper from `_fetch_raw_trades_okx_inst_type` loop body) | utility (pure normaliser) | transform | the loop body itself, `exchange.py` `_fetch_raw_trades_okx_inst_type` | exact (extraction) |
| `analytics-service/services/okx_archive_files.py` (extend `ArchiveRow`, parse loop) | utility (parser) | transform | itself, `ArchiveRow` + `parse_archive_csv` | exact (extension) |
| `analytics-service/services/okx_archive_fills_map.py` (NEW: ArchiveRow to fills-history-shaped dict to live helper; stop errors) | utility (pure mapper) | transform | `okx_archive_files.py` (pure, stdlib-only, named-stop style) + the extracted helper | role-match |
| `analytics-service/services/okx_archive_fills.py` (NEW: the job body, targets, quarters, gates, reconcile, write, result) | service (durable job) | event-driven + batch (stateless wait, CRUD upsert) | `analytics-service/services/okx_archive_job.py` `run_okx_archive_rebuild_job` | role-match (same kind, same wait) |
| `analytics-service/services/okx_archive_job.py` (4-line fork at top of `run_okx_archive_rebuild_job`) | service (handler) | request-response | itself | exact |
| `analytics-service/services/job_worker.py` (one best-effort chain call before the final `return` of `run_sync_trades_job`) | service (chain edge) | event-driven (enqueue) | `_enqueue_linked_strategy_recompute` + the follow-on enqueue block in `run_sync_trades_job` | role-match |
| `analytics-service/services/okx_archive_fills_chain.py` (NEW, optional: trigger predicate + enqueue, lazily imported by the seam) | service (trigger) | CRUD read + enqueue | `_enqueue_linked_strategy_recompute` (cooldown/in-flight reads) | role-match |
| `analytics-service/tests/test_okx_archive_fills_map.py` | test | transform | `tests/test_okx_archive_parse.py` + `tests/test_exchange.py` OKX arms | role-match |
| `analytics-service/tests/test_okx_archive_fills_job.py` | test | event-driven | `tests/test_okx_archive_job.py` (`_World`, `_FakeExchange`, `_FakeSupabase`, `_install`) | exact |
| `analytics-service/tests/test_okx_archive_fills_chain.py` | test | event-driven | `tests/test_okxtrades_cursor.py` (`_make_supabase`, `_run_job` driving the real `run_sync_trades_job`) | role-match |
| `analytics-service/tests/test_exchange.py` (golden for the extracted helper) | test | transform | `tests/test_exchange.py` `test_fetch_raw_trades_okx_happy_path`, `_okx_swap_only` | exact |
| `analytics-service/tests/fixtures/okx_archive/q*_trades.csv` (NEW) | fixture | n/a | `tests/fixtures/okx_archive/q3_like.csv` (real 28-column header) | exact shape |

## Phase 256 overlap: the exact symbols this phase touches in the two shared files

Phase 256 OKXUNITSWITCH is editing `exchange.py` and `job_worker.py` now. Measured against its branch diff (RESEARCH Q4): its `exchange.py` hunks are the import block, the DQ side channels after `get_and_clear_last_dq_flags`, `_okx_bills_window_read` / `fetch_daily_pnl`, `fetch_all_trades` and `fetch_okx_total_equity_and_upl_usd`; its `job_worker.py` hunks are the `from services.exchange import (` block, `_realized_refusal_token`, `_read_okx_option_refusal_once_per_day` and `run_derive_broker_dailies_job`. This phase touches none of those.

### `analytics-service/services/exchange.py` (the ONLY symbols this phase touches)

| Symbol | Change | Notes |
|---|---|---|
| `_fetch_raw_trades_okx_inst_type` (the `for fill in data:` loop body, today `exchange.py` roughly lines 3109-3219) | Replace the per-fill body with ONE call to the extracted helper; keep the pager, cursor, `natural_break`, `PAGE_CAP`, `except` untouched | Behaviour-preserving. A helper returning `None` keeps the live drop-and-`continue` (with the same `logger.error` text) in the loop |
| NEW pure helper, defined immediately ABOVE `_fetch_raw_trades_okx_inst_type` (suggested name `_normalize_okx_fill`) | Add | Takes `(fill, inst_type, exchange)`; returns `FillRow`-as-dict or `None` |

Read-only reuse (no edit): `_okx_fills_begin_floor_ms`, `_OKX_INGEST_CONTRACT_SIZE`, `_okx_contract_size_for_inst_id`, `normalize_symbol`, `_make_fill_dict`, `_finite_decimal`, `_finite_positive_decimal`, `_check_fee_currency_mismatch`, `_OKX_VALID_POS_SIDES`, `_trim_raw_data`, `FillRow`.

Do NOT touch: the import block, `_fetch_raw_trades_okx` (the `okx_fills_reach_clamped` flag), `_OKX_FILL_INST_TYPES`, `OKX_FILLS_REACH_DAYS`, `fetch_daily_pnl`, `fetch_all_trades`. The new modules import what they need from `services.exchange` in THEIR OWN import block, never by adding to the one `exchange.py` has.

### `analytics-service/services/job_worker.py` (the ONLY symbols this phase touches)

| Symbol | Change | Notes |
|---|---|---|
| `run_sync_trades_job`, the tail: insert one `try/except Exception` block IMMEDIATELY BEFORE the final `return DispatchResult(outcome=DispatchOutcome.DONE, trade_count=0 if (phase1_failed or phase1_read_refused) else len(trades))` (today `job_worker.py` line ~3746), AFTER the whole follow-on enqueue `try/except` that can return FAILED | Add | Lazy import inside the block, so the shared import block stays untouched |

Do NOT touch: the `from services.exchange import (` block, `TIMEOUT_PER_KIND` (stays 16 entries, `test_main_worker.py` pins `== 16`), `JOB_CHAIN_FOLLOW_ON` (`[0]` at the follow-on enqueue is load-bearing; `test_okx_archive_job.py` pins `"okx_archive_rebuild" not in chain`), the `dispatch` `elif kind == "okx_archive_rebuild":` arm (the fork lives in `okx_archive_job.py`, so the arm is unchanged), `_enqueue_linked_strategy_recompute`.

### `analytics-service/services/okx_archive_job.py` (no Phase 256 hunk, but `test_okx_archive_job.py` must pass unedited)

| Symbol | Change |
|---|---|
| `run_okx_archive_rebuild_job` | 4-line fork keyed on the literal modes `fills_calibrate` / `fills_apply`, placed BEFORE `supabase = get_supabase()` / `_blank_result(None)` / `_read_job_input` |

`MODES`, `ACCEPTED_MODES`, `STOP_CLASSES`, `TRANSIENT_STOP_CLASSES`, `_blank_result`, `_read_job_input` are NOT edited (see Pitfall P1 and P2 below).

---

## Pattern Assignments

### `analytics-service/services/exchange.py` : extracted normaliser helper (utility, transform)

**Analog:** the live loop body, `_fetch_raw_trades_okx_inst_type` (`exchange.py` ~3109-3219). This is an extraction, so the pattern IS the existing code; copy it byte-for-byte into the helper and replace `continue` with `return None`.

**Core pattern to extract (steps in order, `exchange.py` ~3110-3219):**
```python
ts_raw = fill.get("ts", "")
if ts_raw and ts_raw.isdigit():
    ts_dt = datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc)
else:
    logger.error("OKX fill dropped: unparseable ts=%r (instId=%s, tradeId=%s)", ...)
    continue                                   # -> return None

raw_inst_id = fill.get("instId", "")
symbol = normalize_symbol("okx", raw_inst_id)
side = fill.get("side", "").lower()
price_chk = _finite_positive_decimal(fill.get("fillPx", 0), label="OKX fillPx")
amount_chk = _finite_positive_decimal(fill.get("fillSz", 0), label="OKX fillSz")
...
if _is_linear_type:                            # inst_type in ("SWAP", "FUTURES")
    _inst_parts = raw_inst_id.split("-")
    _settle = _inst_parts[1].upper() if len(_inst_parts) >= 2 else ""
    if _settle in ("USDT", "USDC", "BUSD", "USDE", "PYUSD", "USDB"):
        _ct = _okx_contract_size_for_inst_id(raw_inst_id, exchange)
        amount = fill_sz_contracts * Decimal(str(_ct))
        if _ct != 1.0:
            fill.setdefault("_ingest_ctval", _ct)      # MUTATES `fill`; keep it
    else:
        amount = fill_sz_contracts
else:
    amount = fill_sz_contracts
amount_chk = _finite_positive_decimal(str(amount), label="OKX amount (post-ctVal rescale)")
...
fee_chk = _finite_decimal(fill.get("fee", 0), label="OKX fee")
fee = fee_chk if fee_chk is not None else Decimal("0")
fee_currency = fill.get("feeCcy", "USDT")
_check_fee_currency_mismatch(exchange="okx", symbol=raw_inst_id, fee_currency=fee_currency)
is_maker = fill.get("execType", "") == "M"
raw_data = dict(fill)
pos_side_raw = fill.get("posSide")
...
return dict(_make_fill_dict(exchange="okx", symbol=symbol, side=side, price=price,
    quantity=amount, fee=fee, fee_currency=fee_currency, timestamp=ts_dt.isoformat(),
    exchange_order_id=fill.get("ordId", ""), exchange_fill_id=fill.get("tradeId", ""),
    is_maker=is_maker, raw_data=raw_data, position_direction=position_direction))
```

**Constraints the extraction must keep (each one a golden arm):**
- `datetime.fromtimestamp(int(ts_raw) / 1000, ...)` is a float division; the mapper must reach it through the helper, never re-implement it (byte-equal `timestamp`).
- `fill.setdefault("_ingest_ctval", _ct)` mutates the input dict, and `raw_data = dict(fill)` is taken AFTER it. Keep the order, or `_ingest_ctval` disappears from `raw_data`.
- The `logger.error` drop messages keep their text (the existing `test_exchange.py` arms may match them).
- The helper takes `exchange` only for the `exchange.markets` fallback in `_okx_contract_size_for_inst_id`; the archive caller passes `None` AFTER it has pre-checked the instId prefix against `_OKX_INGEST_CONTRACT_SIZE` itself (Pitfall P6).

**Golden-first rule (CONTEXT Addendum "Normaliser"):** record the golden of fills-history-shaped inputs through the CURRENT loop BEFORE any edit to `exchange.py`, commit it as its own task, then extract, then replay. See the test pattern for `test_exchange.py` below.

---

### `analytics-service/services/okx_archive_files.py` : `ArchiveRow` extension (utility, transform)

**Analog:** itself. `ArchiveRow` (line 133) and the one construction loop in `parse_archive_csv` (the `rows.append(ArchiveRow(...))` at line 342).

**Current dataclass (lines 133-147):**
```python
@dataclass(frozen=True)
class ArchiveRow:
    bill_id: str
    sub_type: str
    type_raw: str | None
    ts_ms: int
    day: str
    inst_type: str
    ccy: str
    pnl: Decimal
    fee: Decimal
    bal_chg: Decimal
    bal: Decimal
```

**Extension pattern (trailing defaulted raw-string fields, filled in the same loop, NO new parse, NO new `ArchiveParseError` label):**
```python
    trade_id: str = ""
    ord_id: str = ""
    inst_id: str = ""
    px_raw: str = ""
    sz_raw: str = ""
    exec_type: str = ""
    fill_time_raw: str = ""
# in the existing loop, beside row["billId"] = _strip_bill_id(row["billId"]) (line 297):
row["tradeId"] = _strip_bill_id(row["tradeId"])      # D-17 wrap applies to tradeId and ordId too
row["ordId"] = _strip_bill_id(row["ordId"])
# ... and in ArchiveRow(...): trade_id=row["tradeId"], ord_id=row["ordId"], inst_id=row["instId"],
#     px_raw=row["px"], sz_raw=row["sz"], exec_type=row["execType"], fill_time_raw=row["fillTime"]
```

**Pins that must stay green UNEDITED:** the 28-column `ARCHIVE_HEADER` check, the UTC+8 quarter cut, the D-17 billId strip, `duplicate_bill_conflict` (the `earlier == cell_tuple` test at the `seen` dict compares the stripped row tuple; stripping `tradeId`/`ordId` before `raw_rows.append(... tuple(row.values()) ...)` at line 301 only matters for rows differing solely by a wrap), `tests/test_okx_archive_parse.py`, `tests/test_okx_archive_job.py`.

**Two hazards (Pitfalls P3 and P4 below):** a new `ArchiveParseError("<label>"` literal in this module or in `okx_archive_classify.py` fails `test_every_stop_the_parser_and_classifier_can_raise_maps_into_the_closed_set` (it regex-scans both modules' raise sites against `okx_archive_job._PARSE_STOP_CLASS`). So `unreadable_trade_bill` is raised by the FILLS module, never by the parser. And `ArchiveRow` equality drives `duplicate_bill_conflict` across files (`earlier != row` in `aggregate_archive`, `kept[0] != row` in `verify_bal_chain`); widening the fields widens equality, which is correct for the same bill in two adjacent files.

---

### `analytics-service/services/okx_archive_fills_map.py` (NEW; utility, transform)

**Analog:** `okx_archive_files.py` for the module shape (pure, stdlib-only plus the extracted helper, no network, no I/O, named stop errors with value-free detail) and the extracted helper for the row construction.

**Module-shape pattern to copy (`okx_archive_files.py` lines 99-130):**
```python
class ArchiveParseError(Exception):
    """A permanent, named stop. ``detail`` holds dates, labels and counts only."""

    def __init__(self, stop_class: str, detail: Mapping[str, Any] | None = None) -> None:
        self.stop_class: str = stop_class
        self.detail: dict[str, Any] = dict(detail or {})
        super().__init__(f"{stop_class}: {self.detail}")
```
Define a SEPARATE exception here (for example `FillsMapError(stop_class, detail)`) with its own closed class set: `unproven_inst_type`, `unmapped_trade_subtype`, `unreadable_trade_bill`, `unknown_contract_size`, `duplicate_trade_id`. Detail is counts and value-free shape tokens only (never `tradeId`, `px`, `sz`, amounts).

**subType map (CONTEXT, copy as a module constant):**
```python
# subType -> (side, posSide)
1: ("buy",  "net")    2: ("sell", "net")
3: ("buy",  "long")   4: ("sell", "short")
5: ("sell", "long")   6: ("buy",  "short")
```

**Synthesized fills-history-shaped dict handed to the extracted helper (RESEARCH Code Examples):**
```python
{ "instType": row.inst_type, "instId": row.inst_id, "side": side, "posSide": pos_side,
  "fillPx": row.px_raw, "fillSz": row.sz_raw, "fee": str(row.fee), "feeCcy": row.ccy,
  "ts": str(row.ts_ms), "ordId": row.ord_id, "tradeId": row.trade_id, "execType": row.exec_type }
```
A `None` from the helper is a NAMED stop (`unreadable_trade_bill`), never a logged skip. Set the source AFTER the factory returns (`_trim_raw_data` drops unknown keys, so it cannot ride in): `row["raw_data"] = {**(row["raw_data"] or {}), "source": "okx_bills_history_archive"}`; that literal equals `_ARCHIVE_SOURCE` at `okx_archive_job.py:1518`, reuse it, do not invent a second.

**Proven-instType gate:** a module constant `PROVEN_INST_TYPES = frozenset({"SWAP"})`; any trade-shaped bill (subType 1-6 or a bill carrying a `tradeId`) of another `instType` is `unproven_inst_type`. A trade-shaped bill of a subType outside the committed table (for example 104) is `unmapped_trade_subtype`.

---

### `analytics-service/services/okx_archive_fills.py` (NEW; service, event-driven + batch)

**Analog:** `analytics-service/services/okx_archive_job.py`, `run_okx_archive_rebuild_job` (line 2545) and its helpers. The fills job is the same state machine minus the live reference/rebuild, plus mapper, reconcile and write.

**Imports pattern** (`okx_archive_job.py` lines 61-146; import the helpers, do not copy them):
```python
from services.db import db_execute, get_supabase, one, rows
from services.job_worker import DispatchOutcome, DispatchResult, _allocator_key_preflight
from services.okx_archive_job import (
    _ApplyPacer, _ClaimBudget, _JobInput, _Stop, _check_account, _check_keys, _defer_job,
    _download_quarter, _parse_stop, _read_quarter_status, _record_ready, _within,
    _write_result, _age_s, _apply_quarter_on_fresh_instance, CLAIM_BUDGET_S, KIND,
)
from services.okx_archive_classify import verify_bal_chain
from services.okx_archive_files import ArchiveFile, ArchiveParseError, parse_archive_csv, quarter_bounds
```
`okx_archive_fills` imports `okx_archive_job`, so the fork in `okx_archive_job.py` must import it LAZILY inside the function (same reason the `dispatch` arm imports lazily; `okx_archive_job` already imports `job_worker`, which is why the module-level cycle is avoided there).

**Handler skeleton to copy (`okx_archive_job.py` 2545-2613):** the order is the D-02 guarantee: input, then `_check_keys` (database only, no OKX call), then `_allocator_key_preflight` (a `DispatchResult` passes straight through), then `_check_account`, then quarters, then the wait, then ingest, then evaluation; `finally: await aclose_exchange(ctx.exchange)`; rate limit defers 15 min and is never stamped on the key; DONE only after `json.dumps(result)` and a successful `_write_result`.
```python
    try:
        inp = _read_job_input(job)
        scope = await _check_keys(supabase, job, inp)
    except _Stop as stop:
        return await _finish_stop(supabase, job, result, stop)
    ctx = await _allocator_key_preflight(job, "run_okx_archive_rebuild_job")
    if isinstance(ctx, DispatchResult):
        return ctx
    try:
        exchange = cast("ccxt.Exchange", ctx.exchange)
        try:
            await _check_account(exchange, scope, result)
            ...
            waits = [step.wait_s for step in steps if step.href is None]
            if waits:
                return await _defer_job(supabase, job, min(waits), f"{KIND}: waiting quarters_ready={ready}/{len(steps)}")
        except _Stop as stop:
            return await _finish_stop(supabase, job, result, stop)
        except (ccxt.RateLimitExceeded, ccxt.DDoSProtection) as exc:
            ... return await _defer_job(supabase, job, RATE_LIMIT_DEFER_S, f"{KIND}: waiting rate_limited")
        json.dumps(result)
        await _write_result(supabase, job, result)
        return DispatchResult(outcome=DispatchOutcome.DONE)
    finally:
        await aclose_exchange(ctx.exchange)
```

**D-02 target list pattern:** `_check_keys` reads only `inp.target_strategy_ids`, so build `_JobInput(mode=..., quarters=(), target_strategy_ids=...)` (`okx_archive_job.py` line 482 dataclass; line 636 reader, `ids = list(inp.target_strategy_ids)`). It raises `target_key_disconnected` for ANY disconnected target key, so FILTER disconnected siblings out of the target list first (use `_key_is_connected`, line 626) and report the skipped COUNT.

**Targets in-claim (no analog does exactly this; compose from `_KEY_COLUMNS` line 265 and the `_check_keys` reads):** read the job key's `venue_account_id`, select `api_keys` with `exchange = 'okx'` and the same non-blank `venue_account_id` and connected, then `strategies` with `api_key_id in (...)`, excluding `archived` (RESEARCH Open Question 4).

**Anchor read (copy the keyset shape of `_read_daily_returns`, `okx_archive_job.py` 1864-1889):** select `csv_daily_returns` `date`, `.eq("strategy_id", ...)`, `.order("date", desc=False).limit(1)`, via `db_execute` and `rows`. For the earliest stored OKX fill: `trades` `.eq("is_fill", True).eq("exchange", "okx")` ordered by `timestamp` ascending, `limit(1)` (legacy daily rows carry a NULL `exchange_fill_id`, so always filter `is_fill`).

**Quarter step, GET FIRST (the one deliberate departure from `_quarter_step`, lines 986-1067):** `_quarter_step` calls `answer = await pacer.apply(key_row, year, label)` on EVERY claim, which spends the 12-per-day budget in about 2 h 15 min for 3 quarters. The fills step reads first and applies only when needed. Reuse these pieces verbatim:
```python
reading = await _read_quarter_status(exchange, year, label)       # line 944; state in {finished, ongoing, failed} or None
# finished + href  -> _record_ready(entry, reading.href)          # line 968, records scheme+host only
# ongoing          -> _QuarterStep(wait_s=STATUS_POLL_INTERVAL_S), archive_give_up at GIVE_UP_AFTER_S
# no entry / failed -> ONE apply: answer = await pacer.apply(key_row, year, label)   # _ApplyPacer, line 928
#                      then wait to FIRST_STATUS_READ_AFTER_S (2 h) from answer.ts_ms
```
Note `_read_quarter_status` returns `state=None` for an empty `data`, which `_quarter_step` treats as `archive_request_failed`. The fills step must treat "no entry" as "never requested" (apply) but still treat a non-mapping or an unknown state word as `archive_request_failed` (RESEARCH A6). Keep the apply on its own fresh client, one attempt, no retry loop: `_apply_quarter_on_fresh_instance` (line 889) already does that (`decrypt_credentials` then `_make_exchange_client`, the POST is the last call, `aclose_exchange` in `finally`).

**Wait pattern:** a deferral, never a held claim: `_defer_job` (line 1092) calls `_check_backstop` first, clamps to `MAX_DEFER_S = 3600`, uses `defer_compute_job` fenced on the claim token, and returns `DispatchResult(outcome=DEFERRED)` (it returns DEFERRED, not an exception, on a lost claim via `_defer_lost_ownership`).

**Download and parse:** `_download_quarter` (line 1211) then `await asyncio.to_thread(parse_archive_csv, csv_bytes, year=year, quarter=label)`; map `ArchiveParseError` with `_parse_stop(exc, tag)` (line 1187, raises into the EXISTING closed classes). `ctx` for these is the same preflight exchange.

**Completeness gate:** `verify_bal_chain(files, summed_ccys)` (`okx_archive_classify.py` line 214). Compute `summed_ccys` IN THE FILLS MODULE (set of `ccy` with a nonzero `pnl`, `fee` or `balChg` on any bill) and do NOT call `aggregate_archive`, which also raises the daily-rebuild stops `non_usd_ccy`, `unknown_subtype_nonzero` and `subtype_map_drift` that would block a Q4 file carrying a coin-denominated fee bill (RESEARCH Pitfall 9; Phase 256 interaction). Adjacent quarters must be requested together so the seam is chained.

**Write path (copy the call shape exactly, `job_worker.py` lines 2965-2972):**
```python
for i in range(0, len(raw_fills), 100):
    batch = raw_fills[i:i + 100]
    def _insert_fills(batch_rows: list[dict[str, Any]] = batch) -> None:
        ctx.supabase.table("trades").upsert(
            [{"strategy_id": strategy_id, **fill} for fill in batch_rows],
            on_conflict="strategy_id,exchange,exchange_fill_id",
            ignore_duplicates=True,
        ).execute()
    await db_execute(_insert_fills)
```
Wrap the loop in `_within(budget, ..., step="write")` (`okx_archive_job.py` line 329) so an overlong write ends as the transient `claim_budget_exceeded` and resumes idempotently. Pin the three literals (`"strategy_id,exchange,exchange_fill_id"`, `ignore_duplicates=True`, batch `100`) with a source-text test (the repo binds two copies this way: `inspect.getsource(...)` as in `tests/test_okx_archive_job.py:1978-1983`). NEVER call `advance_sync_cursor` or `set_strategy_fills_reread_bound`: the archive writes older fills and must not move the fills cursor.

**Result block:** do not edit `_blank_result` or `RESULT_VERSION`. Write via `_write_result` (line 408; `set_compute_job_progress` atomic merge fenced on `claim_token`, never read-modify-write `compute_jobs.metadata`). Put the mode, the per-quarter outcome, the census, `bal_chain` reading, reconcile reading per strategy, would-insert counts per strategy (calibrate) and inserted counts (apply), and the names of unwritten spans in a result dict whose top-level keys follow Result shape v1 conventions; counts and dates only.

**Error handling pattern, and the closed stop set (Pitfall P1):**
```python
class _Stop(Exception):                       # okx_archive_job.py line 293
    def __init__(self, stop_class: str, detail: str = "") -> None:
        if stop_class not in STOP_CLASSES:    # raises AssertionError for any new name
            raise AssertionError(f"unknown stop class {stop_class!r}")
```
`tests/test_okx_archive_job.py` line 1953 asserts `STOP_CLASSES == {...}` exactly. So the fills job needs its OWN exception and `FILLS_STOP_CLASSES` set and its own finisher that mirrors `_finish_stop` (lines 443-479: write the result block FIRST, swallow a failed result write on this path except `CancelledError`, return `FAILED` with `error_kind="transient"` only for the transient classes, `error_message` from `_error_text`). The job must catch BOTH its own exception and `_Stop` (raised by the reused `_check_keys`, `_check_account`, `_download_quarter`, `_parse_stop`, `_defer_job`). A reused helper's `_Stop` classes stay in the existing closed set and need no edit.

**Logging rule (CONTEXT, OKXHISTORY rule kept):** no download link, request `ts`, amount, uid or `tradeId` in a log, `last_error`, exception text or tracked text; scheme and host only (`describe_href`); counts and value-free shape tokens (`okx_archive_classify._bill_id_shape` at line 166 for a `tradeId` that is not all digits).

---

### `analytics-service/services/okx_archive_job.py` : the fork (service, request-response)

**Analog:** itself (lines 2545-2561). Insert BEFORE `supabase = get_supabase()`:
```python
async def run_okx_archive_rebuild_job(job: dict[str, Any]) -> DispatchResult:
    metadata = job.get("metadata")
    raw_mode = metadata.get("mode") if isinstance(metadata, Mapping) else None
    if raw_mode in ("fills_calibrate", "fills_apply"):          # literal names no existing test feeds
        from services.okx_archive_fills import run_okx_archive_fills_job   # lazy: it imports this module
        return await run_okx_archive_fills_job(job)
    supabase = get_supabase()
    ...
```
Constraints: the existing invalid-mode test feeds `"nonsense"` and `None` and must keep getting `invalid_input` with `result["mode"]` echo only for a `MODES` member; do not add the new names to `MODES` / `ACCEPTED_MODES` (it would let the rebuild's `_read_job_input` accept them and demand `quarters`). `tests/test_okx_archive_job.py` and the whole Pins row must pass unedited.

---

### `analytics-service/services/job_worker.py` : the chain seam (service, event-driven)

**Analog 1 (placement, in-handler): the follow-on enqueue block in `run_sync_trades_job`, `job_worker.py` 3524-3540.**
```python
_follow_on_kind = JOB_CHAIN_FOLLOW_ON["sync_trades"][0]
try:
    def _enqueue_follow_on() -> None:
        ctx.supabase.rpc(
            "enqueue_compute_job",
            {"p_strategy_id": strategy_id, "p_kind": _follow_on_kind},
        ).execute()
    await db_execute(_enqueue_follow_on)
except Exception as exc:  # noqa: BLE001
    logger.exception(...)
```
**Analog 2 (cooldown, in-flight and per-strategy isolation): `_enqueue_linked_strategy_recompute` (`job_worker.py` 5245-5432).** Its guards are the template for this trigger:
```python
def _read_in_flight(sid: str = sid) -> list[dict[str, Any]]:
    return rows(supabase.table("compute_jobs").select("id")
        .eq("strategy_id", sid).in_("status", list(_LINKED_RECOMPUTE_INFLIGHT_STATUSES)).limit(1).execute())
...
cutoff = (datetime.now(timezone.utc) - window).isoformat()
def _read_recent_attempt(sid: str = sid, cutoff: str = cutoff) -> list[dict[str, Any]]:
    return rows(supabase.table("compute_jobs").select("id")
        .eq("strategy_id", sid).in_("kind", list(_LINKED_RECOMPUTE_ATTEMPT_KINDS))
        .gt("created_at", cutoff).limit(1).execute())
if await db_read_with_retry(_read_recent_attempt):
    continue
...
await db_execute(lambda: supabase.rpc("enqueue_compute_job", payload).execute())
except Exception as exc:  # noqa: BLE001 - one strategy's failure never starves the next
    logger.exception(...)
```
For the fills trigger the cooldown query is keyed on `api_key_id` (the job is api_key scoped), `.eq("kind", "okx_archive_rebuild")`, `metadata->>mode = 'fills_apply'` (PostgREST: `.eq("metadata->>mode", "fills_apply")`), `.gt("created_at", cutoff)`, 14 days, counting statuses in-flight, `done`, or `failed_final` with a NAMED permanent stop (not `invalid_input`; an old worker ends an unknown mode as `invalid_input`, which must not count as answered). `fills_calibrate` never counts (RESEARCH trap, PROD step 5).

**api_key-scoped enqueue payload shape (the RPC takes `p_strategy_id` first with NO default; pass `None` explicitly), copy from `_enqueue_allocator_compose` (`job_worker.py` 5185-5202):**
```python
supabase.rpc("enqueue_compute_job", {
    "p_strategy_id": None,
    "p_api_key_id": key_id,
    "p_kind": "okx_archive_rebuild",
    "p_metadata": {"mode": "fills_apply"},
})
```
The enqueue dedupe returns the existing in-flight row and DROPS new metadata (in-flight unique per api_key), so no strategy list and no quarter list ever rides in metadata; targets and quarters are derived in-claim.

**Seam (inline in `run_sync_trades_job`, immediately before the final `return`, `job_worker.py` ~3746):**
```python
    # Phase 259: best-effort archive-fills chain. Never changes the sync outcome.
    if ctx.key_row.get("exchange") == "okx" and <clean read: not phase1_failed and not phase1_read_refused and not phase2_failed and not _fills_incomplete>:
        try:
            from services.okx_archive_fills_chain import chain_okx_archive_fills   # lazy; shared import block untouched
            await chain_okx_archive_fills(ctx, strategy_id)
        except Exception:  # noqa: BLE001
            logger.exception("sync_trades: okx archive-fills chain failed for strategy %s", strategy_id)
    return DispatchResult(outcome=DispatchOutcome.DONE, trade_count=...)
```
Predicate inputs in scope at the tail: `phase1_failed`, `phase1_read_refused`, `phase2_failed`, `_fills_incomplete` (the `advance_fetched_cursor` predicate at `job_worker.py` ~3036-3044 uses the same set). Chain on clean-or-empty-clean, never on a failed or truncated read. `except Exception` does not catch `asyncio.CancelledError`; keep it that way (the same note sits above `_LINKED_RECOMPUTE_TIMEOUT_S`, line 5237, which bounds the helper with a timeout because an unbounded stall would spend the job's 900 s budget; consider the same bound, `asyncio.timeout(...)`, for the chain call).

**Trigger predicate (CONTEXT Addendum "Cooldown"):** anchor (earliest `csv_daily_returns` date) below `_okx_fills_begin_floor_ms(now) + 86_400_000`, earliest stored OKX fill later than anchor + 2 days, and no counted `fills_apply` job in the last 14 days. Do NOT use the `okx_fills_reach_clamped` flag (only set when the sync's cursor is below the floor) and do NOT add the kind to `JOB_CHAIN_FOLLOW_ON` (not a parented follow-on; the file's own comment above `JOB_CHAIN_FOLLOW_ON` records the cross-target re-entry precedent).

**Existing-test hazard:** every existing `run_sync_trades_job` OKX test drives the real handler with a `MagicMock` supabase (`tests/test_okxtrades_cursor.py` `_make_supabase`, `tests/test_sync_trades_store_truth.py`). The new tail block runs for them. It must be exception-safe (it is: `try/except Exception`) and must not add an unexpected `rpc` that an exact-call assertion rejects; run `tests/test_okxtrades_cursor.py tests/test_okxtrades_walk.py tests/test_sync_trades_store_truth.py tests/test_sync_trades_preserves_fills.py tests/test_sync_trades_resume_seed.py tests/test_mt5_sync_path.py tests/test_main_worker.py` after the edit and fix the hazard in the NEW code, not the old tests.

---

### `analytics-service/services/okx_archive_fills_chain.py` (NEW, optional split; service, CRUD read + enqueue)

**Analog:** `_enqueue_linked_strategy_recompute` (above). Same reads through `db_read_with_retry`, same `rows` / `one` unwrapping, same one-strategy-never-starves-the-next try/except. Keeping the trigger in its own module keeps the `job_worker.py` diff to the single seam block (the Phase 256 constraint). The module may live inside `okx_archive_fills.py` instead; the planner's call.

---

### `analytics-service/tests/test_okx_archive_fills_job.py` (test, event-driven)

**Analog:** `analytics-service/tests/test_okx_archive_job.py` (exact). Copy the fake world, do not invent a second one; import it or lift the pieces.

**Fake harness to copy (lines 33-300):**
- Constants: `KEY_ID`, `OTHER_KEY_ID`, `STRATEGY_ID`, `STRATEGY_2_ID`, `LINK_SECRETS`, `FIXTURES = Path(__file__).parent / "fixtures" / "okx_archive"`, `REQUEST_TS_MS`, `NOW_MS` (three hours after the request: past the 2 h first-read rule, short of the 8 h give-up).
- Answer builders `_finished`, `_status`, `_apply_answer`; endpoint-name constants `CONFIG`, `SUBTYPES`, `APPLY`, `STATUS`.
- `_FakeExchange` records every call by endpoint and instance (`__getattr__` for `private_*`), `_FakeSupabase` records `reads` and `rpcs` (including `set_compute_job_progress`, `enqueue_compute_job`), `_World.result()` asserts EXACTLY one result write carrying the claim token.
- `_install(monkeypatch, ...)` patches BOTH modules (`job_worker` and `okx_archive_job`): `get_supabase`, `get_kek`, `decrypt_credentials`, `_make_exchange_client`; plus `okx_archive_job._utc_today`, `_wall_ms`, `download_archive_csv`. The fills module must read these seams through names the same patches reach (import them from `okx_archive_job` as module attributes used at call time, or patch the fills module's names too).
- `_job(metadata)` builds a claimed row (`kind`, `api_key_id`, `claim_token="tok-1"`, `metadata`, `created_at`).

**Arms to write (CONTEXT "Decided autonomously" + RESEARCH Validation map):** golden mapping per subType 1-6; `_FakeSupabase` extended with a `trades` table that emulates `trades_dedup_fill` (SC-3 idempotency); reconcile mismatch arms one per field (size, price, fee, side, timestamp, absent-in-archive, archive-only, count, duplicate `tradeId`); refuse arms (`unproven_inst_type`, `unmapped_trade_subtype`, `unreadable_trade_bill`, `unknown_contract_size`); GET-first arms (zero apply when `ongoing`/`finished`, exactly one apply on a separate instance that is the LAST call on it when no entry); wait arm (returns DEFERRED, never awaits the 2 h); leak scan using `LINK_SECRETS`:
```python
everything = json.dumps(world.progress_writes()) + caplog.text + repr(outcome)
for secret in LINK_SECRETS:
    assert secret not in everything, f"the link leaked: {secret!r}"
```
Apply-is-last-call assertion pattern (line ~372): `assert [i.calls for i in world.instances] == [[CONFIG, STATUS], [APPLY]]` and `assert all(i.closed for i in world.instances)`.

**PROOF-01 neuter discipline (CLAUDE.md, MEMORY):** each data-integrity gate gets a neutered copy that goes RED on its named arm first, restored from a byte backup (`cp`, prove with `cmp`), never `git checkout/restore/stash` on uncommitted work. The neuter table is in RESEARCH "PROOF-01".

---

### `analytics-service/tests/test_okx_archive_fills_chain.py` (test, event-driven)

**Analog:** `analytics-service/tests/test_okxtrades_cursor.py` (drives the REAL `run_sync_trades_job` with a recording fake `trades` table).

**Fake supabase pattern (lines 80-215):** `_make_supabase(...)` returns `(MagicMock, _Recorder)`; `_FakeTradesQuery` applies every `.eq`, `.order`, `.limit` (so a failed read is distinguishable from a real answer, a bare `MagicMock` would fail open); `supabase.rpc.side_effect = _rpc` records by name; `supabase.table.side_effect = _table` dispatches by table. Extend it with a `compute_jobs` and `csv_daily_returns` table and an `enqueue_compute_job` recorder. Hand-typed epoch ms beside ISO literals, never computed by the code under test.

**Arms (RESEARCH SC-4):** the seam runs AFTER the follow-on enqueue, never before; its exception leaves the outcome DONE and unchanged; a non-OKX key never calls it; `JOB_CHAIN_FOLLOW_ON` and the `not in chain` pins unchanged; a failed or truncated read does not chain; the cooldown (a `fills_calibrate` job does not count, a `fills_apply` job inside 14 days does).

---

### `analytics-service/tests/test_exchange.py` : golden for the extracted helper (test, transform)

**Analog:** `tests/test_exchange.py` `test_fetch_raw_trades_okx_happy_path` (line ~981) and `_okx_swap_only` (line ~376).
```python
mock_exchange = AsyncMock()
mock_exchange.id = "okx"
mock_exchange.private_get_trade_fills_history = _okx_swap_only([{ "instId": "BTC-USDT-SWAP", "side": "buy",
    "fillPx": "60000", "fillSz": "0.1", "fee": "-0.6", "feeCcy": "USDT", "ts": "1700000000000",
    "ordId": "ord-1", "tradeId": "trade-1", "execType": "T", "posSide": "long" }, ...])
result = await fetch_raw_trades(mock_exchange, "strat-1", MagicMock())
assert Decimal(result[0]["quantity"]) == Decimal("0.001")      # NEW-C13-01 ctVal rescale
```
The golden (Wave 0, recorded BEFORE the extraction): a table of fills-history-shaped inputs (ETH-USDT-SWAP ctVal 0.1 with `_ingest_ctval` in `raw_data`, linear SWAP, inverse BTC-USD-SWAP unchanged, SPOT passthrough, bad `ts`, non-finite `fillPx`, `posSide` net/long/short/invalid) mapped to their exact output rows, replayed after the extraction. Existing OKX arms in this file (`-k "Okx or okx"`) must stay green unedited and are the second oracle.

---

### `analytics-service/tests/fixtures/okx_archive/q*_trades.csv` (NEW; fixture)

**Analog:** `tests/fixtures/okx_archive/q3_like.csv`. Same 28-column header, row layout:
```
instType,billId,subType,ts,balChg,posBalChg,bal,posBal,sz,px,ccy,pnl,fee,mgnMode,instId,ordId,execType,interest,tag,fillTime,tradeId,clOrdId,fillIdxPx,fillMarkPx,fillPxVol,fillPxUsd,fillMarkVol,fillFwdPx
SWAP,700000001,2,1782864000000,10.25,0,3438.70,0,,,USDT,10.50,-0.25,cross,BTC-USDT-SWAP,,,,,,,,,,,,,
```
The committed `q2_like.csv` / `q3_like.csv` carry BLANK `sz`, `px`, `tradeId`, `fillTime`, `ordId` on subType 1 and 2 rows and must NOT be edited (existing pins). New fixtures carry populated trade cells, with a running `bal` that chains (so `verify_bal_chain` passes) and ETH-USDT-SWAP rows for the ctVal 0.1 arm. All amounts invented; billIds are digit strings.

---

## Shared Patterns

### Durable wait, never a held claim
**Source:** `okx_archive_job._defer_job` (line 1092) with `_check_backstop` (line 1070), constants `STATUS_POLL_INTERVAL_S`, `GIVE_UP_AFTER_S`, `BACKSTOP_AFTER_S`, `MAX_DEFER_S` (lines 198-218).
**Apply to:** `okx_archive_fills.py`.
```python
return await _defer_job(supabase, job, min(waits), f"{KIND}: waiting quarters_ready={ready}/{len(steps)}")
```

### D-02 identity (OKX key, connected, uid equals stored `venue_account_id`, `read_only`)
**Source:** `_check_keys` (line 636) then `_check_account` (line 724).
**Apply to:** the fills job, for the job key AND every target. A NULL stored `venue_account_id` can never match (fail-closed).

### Result writer
**Source:** `_write_result` (line 408), `_finish_stop` ordering (line 443).
**Apply to:** the fills job. Write the result FIRST, then return FAILED; DONE only after the result is stored.

### No bearer link, `ts`, amount, uid or `tradeId` in any durable text
**Source:** `describe_href` (scheme and host only), `_safe_counts` (line 1201), `_malformed_or` (line 759), `okx_archive_classify._bill_id_shape` (line 166), `scrub_freeform_string` for venue text.
**Apply to:** every log line, `last_error`, exception text and result field of the new modules and tests.

### Single write semantics
**Source:** `run_sync_trades_job` upsert (`job_worker.py` 2965-2972). `trades_dedup_fill` is `UNIQUE (strategy_id, exchange, exchange_fill_id)`; `trades.side` has `CHECK (side IN ('buy','sell'))`. Archive fills copy the call shape verbatim and pin it by a source-text test.

### mypy strict and test hygiene
**Source:** `analytics-service/pyproject.toml` `[tool.mypy]`, `pytest.ini` (`asyncio_mode = auto`). Every new module needs complete annotations (`Final`, `Mapping`, `Any` for ccxt). `from __future__ import annotations` at the top of every new file, as every analog has. pytest only from `analytics-service/`, never `importlib.reload`, always `grep -a`. The agent gate includes `make typecheck`.

---

## Pitfalls specific to the analog files (found while reading them; the planner must carry each)

- **P1: the stop set is closed and pinned.** `_Stop.__init__` asserts `stop_class in STOP_CLASSES`, and `tests/test_okx_archive_job.py:1953` asserts `STOP_CLASSES == {...}` exactly. Do not add the fills classes to it. The fills job defines its own exception, class set and finisher, and catches `_Stop` from reused helpers too.
- **P2: `_read_job_input` and `MODES` are not for the fills modes.** It requires `quarters` (1 to 4) and `rebuild_strategy_ids` for calibrate and apply. The fork avoids all of it by running first.
- **P3: no new `ArchiveParseError("...")` literal in `okx_archive_files.py` or `okx_archive_classify.py`.** `test_every_stop_the_parser_and_classifier_can_raise_maps_into_the_closed_set` regex-scans both modules and requires every label in `okx_archive_job._PARSE_STOP_CLASS`. Raise `unreadable_trade_bill` (and the other fills classes) from the fills modules.
- **P4: `ArchiveRow` is constructed only in `parse_archive_csv`** (no test constructs `ArchiveRow(`), so defaulted trailing fields cannot break a call site; equality widens, which is intended.
- **P5: raw cells stay raw in the parser.** The committed fixtures carry subType 1 and 2 rows with blank `px`, `sz`, `tradeId`; strict parsing in `parse_archive_csv` would break the existing pins. Parse and gate in the fills module.
- **P6: unknown contract size.** `_okx_contract_size_for_inst_id` falls back to `exchange.markets` then to `1.0` plus `_record_dq_flag("okx_unknown_ctval", True)`; no archive job drains that flag. The mapper pre-checks the `BASE-QUOTE` prefix against `_OKX_INGEST_CONTRACT_SIZE` and stops `unknown_contract_size` by name, so a 10x-wrong ETH quantity can never be written silently.
- **P7: `_trim_raw_data` drops unknown keys** (`_RAW_DATA_KEEP_KEYS`: `posSide, position_direction, instType, category, execType, feeCcy, feeCurrency, _ingest_ctval`). Set `raw_data["source"]` AFTER the factory returns; do not edit the shared whitelist.
- **P8: timestamp column.** The live helper stores `ts`, not `fillTime`. Reconcile compares the stored `timestamp` with BOTH archive columns, gates on one named constant, and records the other's match count in the result's `info`.
- **P9: apply budget.** `_quarter_step` re-applies on every claim; the fills step must not copy that. `_ApplyPacer` only spaces applies WITHIN a claim.
- **P10: 00:00-01:45 UTC window.** The PROD enqueue forms refuse inside it (OKXHISTORY runbook); schedule the backfill outside it.

## No Analog Found

| File / Behaviour | Role | Data Flow | Reason |
|---|---|---|---|
| In-claim target discovery by `venue_account_id` (all connected OKX keys of the account, their strategies) | service | CRUD read | `_check_keys` verifies a GIVEN target list; nothing discovers siblings by account. Compose from `_KEY_COLUMNS`, `_key_is_connected` and the `strategies` / `api_keys` reads in `_check_keys` |
| Reconciliation of archive-mapped rows against stored `fills-history` rows | service | transform | `okx_archive_reconcile.py` reconciles DAILY legs, not fills. Use it only for the evidence-reading style (named misses, a miss cap like `_MAX_MISSES_REPORTED` at `okx_archive_job.py` line 1523) |
| `compute_jobs` cooldown keyed on `api_key_id` and `metadata->>mode` | service | CRUD read | The nearest analog (`_read_recent_attempt`) is keyed on `strategy_id` and `kind`; adapt the select, keep the shape |

## Metadata

**Analog search scope:** `analytics-service/services/` (okx_archive_*, exchange.py, job_worker.py, db.py), `analytics-service/tests/` (okx archive suites, `test_exchange.py`, `test_okxtrades_*`, `test_sync_trades_*`), `analytics-service/tests/fixtures/okx_archive/`, `supabase/schema/baseline.sql` (RPC signature).
**Files scanned:** about 25 (13 read in full or by targeted range, the rest by grep).
**Pattern extraction date:** 2026-11-27
