# Phase 177: DERIBITFLOWS - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 21 (9 new, 12 modified; census pins grouped as one row each where they move together)
**Analogs found:** 21 / 21 (2 are partial: the prefetch-then-capture placement and the migration-level list upsert have no exact precedent)

All analog paths are git-TRACKED source (checked with `git ls-files` at the worktree HEAD; no gitignored mirror is named). Line numbers are at this worktree's HEAD and will drift; cite by symbol where the planner can. Scope decisions come from `177-CONTEXT.md` D-01..D-05 and `177-RESEARCH.md`; this file adds only the code to copy.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/deribit_ingest.py` (ADD `fetch_deribit_perp_minute_prices`, a candle-selection pure fn, a sibling of `_validate_chart_ok_arrays` that also returns `open`) | service (venue public read) | request-response, retry | `fetch_deribit_option_daily_marks` (same file, :759-883) and `fetch_deribit_perp_daily_index` (:663-756) | exact (clone) |
| `analytics-service/services/nav_marks_apply.py` (EXTRACT `placed_flow_instants` from rule 10) | utility (pure fn) | transform | `apply_marks` rule 10 block (same file, :265-283) | exact (extract in place) |
| `analytics-service/services/native_nav.py` (`native_flow_instants(..., at_instant_index=None)`) | service (pure valuation) | transform | `native_flow_instants` itself (:1126-1144) | exact (extend) |
| `analytics-service/services/external_flows.py` (`FlowInstant` docstring only: `amount_prior_day` also set for Deribit) | model (NamedTuple) | n/a | `FlowInstant` (:78-97) | exact (docstring) |
| `analytics-service/services/flow_price_store.py` (NEW: `read_flow_prices` / `write_flow_prices`, `FlowPriceStoreError`) | service (Supabase store) | CRUD, write-once | `analytics-service/services/nav_marks.py` (`read_stored_mark`, `write_nav_mark`, `read_key_marks`, `_parse_stored`) | exact (role + flow) |
| `analytics-service/services/job_worker.py` (derive prefetch + capture + coverage check + `mark_flow_index_unavailable` token + D-01 log) | service (job handler) | event-driven (job), request-response | derive apply seam (:7612-7800, :7945), `_stamp_429` (:1388), `_MARK_ALLOCATED_NAV_UNRECONCILED` (:385) | role-match (placement has no exact precedent) |
| `analytics-service/services/job_worker.py` (composite members: `_apply_member_marks` :10039, `_apply_allocated_member_marks` :10126, `_MemberNavUnreconciled` sibling, `_refuse_member_marks` :10231) | service (job handler) | event-driven | the same functions (extend) | exact |
| `supabase/migrations/<ts>_api_key_flow_prices.sql` (NEW; next free ts after `20261031120000`) | migration | CRUD, write-once | `supabase/migrations/20261031120000_allocator_trade_reads.sql` (layout, service-role-only) + `supabase/migrations/20261029120000_api_key_nav_marks.sql` (write-once grant, NaN CHECK) | exact |
| `supabase/migrations/down/<ts>-rollback.sql` (NEW, keep-data) | migration (rollback) | n/a | `supabase/migrations/down/20261031120000-rollback.sql` | exact |
| `supabase/tests/test_api_key_flow_prices.sql` (NEW SQL gate, ~9 arms + RED-UNDER twins) | test (SQL gate) | request-response (privilege/CHECK probes) | `supabase/tests/test_allocator_trade_reads.sql` (+ arm 2/3/4 idioms of `supabase/tests/test_api_key_nav_marks.sql`) | exact |
| `analytics-service/tests/test_nav_marks_compose_roundtrip.py` (ADD Deribit BTC RED test, own-mark, failure, 429, no-data, no-chart-read, store cases) | test | request-response | `test_moved_btc_flow_priced_at_the_mark_day_close` (:1004-1040) and `test_deribit_key_mode_deposit_made_before_the_read_is_counted_in_the_mark_day` (:1189-1213) + `derive_deribit_key` (:1087-1170) | exact |
| `analytics-service/tests/test_nav_marks_flow_instants.py` (ADD `at_instant_index` cases) | test (unit) | transform | `test_a_days_deribit_instants_add_up_to_the_days_composed_flow` (:54-91) | exact |
| `analytics-service/tests/test_nav_marks_apply.py` (ADD predicate parity case) | test (unit) | transform | existing `apply_marks` cases in the same file | role-match |
| `analytics-service/tests/test_nav_marks_derive_apply.py` (ADD coverage-check, log-line cases) | test | event-driven | `assert_refusal_cost_nothing` (:1068-1100) | exact |
| `analytics-service/tests/test_nav_marks_composite.py` (ADD moved-flow member cases) | test | event-driven | `run_deribit_composite` (:422) | exact |
| `analytics-service/tests/test_deribit_ingest.py` (ADD `-k minute_prices` reader tests) | test (unit) | request-response, retry | `_ChartDataStub` (:2554-2573) + `test_perp_daily_*` (:2578-2640) + `_SleepSpy` (:29-36) | exact |
| `analytics-service/tests/test_flow_price_store.py` (NEW) | test (unit) | CRUD | fake route in `analytics-service/tests/test_nav_marks_writer.py` (`_MarksQuery`, `FakeDb`, `route_marks` :78-170) | role-match (fake lacks `in_`) |
| `analytics-service/tests/test_nav_marks_writer.py` fake (ADD a `_FlowPricesQuery` route, or put it in the new test file) | test helper | CRUD | `_MarksQuery` / `route_marks` (same file) | exact |
| `scripts/mutation-floors.mjs` (`FILES_FLOOR`, `ARMS_FLOOR`) + `src/__tests__/{gate-family-meta,mutation-annotation-parser,mutation-runner-floors}.test.ts` | config / census pin | n/a | commit `5ff4ba968` | exact |
| `.github/workflows/ci.yml` (sentinel roster row, `SENTINEL_FLOOR`, `ARMS_FLOOR`) + `src/__tests__/{drift-check-scripts,lint-sql-gates}.test.ts` | config / census pin | n/a | commit `03e6bb179` | exact |
| `src/lib/database.types.ts` (hand-add table, hygiene only) | model (types) | n/a | the `allocator_trade_reads` hand-added block (RESEARCH cites :336-342) | role-match |

## Pattern Assignments

### `analytics-service/services/deribit_ingest.py` — `fetch_deribit_perp_minute_prices` (service, public read with retry)

**Analog:** `fetch_deribit_option_daily_marks` (:759-883) for the loop (it is the only reader that already classifies the 200 body inside the retry loop via `_validate_chart_ok_arrays`/GLB-4); `fetch_deribit_perp_daily_index` (:663-756) for instrument naming (`_PERP_DAILY_INSTRUMENT_SUFFIX`) and parameters. Do not touch either; the new reader is a clone.

**Constants and helpers to reuse** (:90-91, :208, :602-610, :613-660):
```python
PUBLIC_READ_MAX_RETRIES: int = LEDGER_MAX_RETRIES
PUBLIC_READ_BACKOFF_BASE_SECONDS: float = LEDGER_BACKOFF_BASE_SECONDS
_PERP_DAILY_INSTRUMENT_SUFFIX = "_USDC-PERPETUAL"
_CHART_NO_DATA_STATUS = "no_data"

def _is_transient_read_error(exc: BaseException) -> bool:
    return isinstance(exc, ccxt.NetworkError)
```
`_validate_chart_ok_arrays(resp)` returns `(ticks, close)` or `None` (explicit `no_data`) or raises `_FlakyChartResponse`. It does not return `open`, so add a sibling validator (or an optional argument) rather than changing the two existing callers.

**Core retry loop to copy** (:814-858, option reader):
```python
params: dict[str, Any] = {
    "instrument_name": instrument,
    "start_timestamp": start_ms,
    "end_timestamp": end_ms,
    "resolution": _PERP_DAILY_RESOLUTION,   # NEW reader: "1"
}
retries = 0
while True:
    try:
        resp = await exchange.public_get_get_tradingview_chart_data(params)
        arrays = _validate_chart_ok_arrays(resp)
        break
    except _FlakyChartResponse as exc:
        retries += 1
        if retries > max_retries:
            raise DeribitTransientReadError(
                "deribit get_tradingview_chart_data returned a flaky/unexpected "
                f"200 body across {max_retries} retries for "
                f"instrument={instrument} ({exc}) — refusing a silently-empty "
                "daily-mark map (retryable)"
            ) from None
        await sleep(PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))
        continue
    except Exception as exc:  # noqa: BLE001
        if _is_transient_read_error(exc):
            retries += 1
            if retries > max_retries:
                raise DeribitTransientReadError(
                    "deribit get_tradingview_chart_data transient read budget "
                    f"({max_retries}) exhausted for instrument={instrument} — "
                    "refusing a silently-partial daily-mark map (retryable)"
                ) from None
            await sleep(PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1)))
            continue
        logger.warning(
            "deribit get_tradingview_chart_data structural no-data for "
            "instrument=%s (%s); returning no daily marks",
            instrument,
            scrub_freeform_string(str(exc)),
        )
        return {}
```

**Deliberate deviations from the analog (D-05), each needs a pinned test:**
1. Structural `BadSymbol` / `status == "no_data"` / absent containing candle must NOT return `{}` silently. Raise a distinct, named structural error (the caller turns it into `mark_flow_index_unavailable`). The sibling's `return {}` is exactly the quiet fallback D-05 forbids.
2. When the final failed attempt was a `ccxt.RateLimitExceeded`, re-raise it instead of wrapping in `DeribitTransientReadError`, so it reaches `_stamp_429` (RESEARCH "Failure vocabulary" gap). In the transient branch: `if retries > max_retries: if isinstance(exc, ccxt.RateLimitExceeded): raise` before the wrap.
3. Parse `open` too; guard each price with `float()` plus `math.isfinite` and `> 0` (same guard as `build_deribit_indexable_currencies`, deribit_ingest.py:1152-1157). A non-finite or non-positive open is structural, never skipped into a default. Note the sibling's per-row `continue` on `(TypeError, ValueError)` is the opposite and must not be copied for the price.
4. Params: `resolution="1"`, `start_timestamp = 00:00Z of the read day`, `end_timestamp = max(at_ms) + 60_000` (end is inclusive, probe-verified).

**Candle selection** is a pure function (table-driven tests): the candle whose tick `T` satisfies `T <= at_ms < T + 60_000`; key `minute_ms = at_ms - at_ms % 60000`; no candle in that minute means no price (never the earlier close).

**Error-text rule:** every ccxt string passes `scrub_freeform_string(str(exc))` (already imported, deribit_ingest.py:68).

---

### `analytics-service/services/nav_marks_apply.py` — extract `placed_flow_instants` (utility, transform)

**Analog:** rule 10 inline in `apply_marks` (:265-283). Behaviour must stay byte-identical; `apply_marks` calls the extracted function and the prefetch, the coverage check and the D-01 count call it too.

**Current predicate to extract** (:268-282):
```python
for mark, md in zip(marks, mark_days):
    if mark.read_at is None:
        continue
    read_s = mark.read_at.timestamp()
    read_day = (md + timedelta(days=1)).isoformat()
    placed = [
        fi for fi in flow_instants if fi.day == read_day and fi.at_ms / 1000.0 <= read_s
    ]
    moved_out = sum(_finite(fi.amount) for fi in placed)
    moved_in = sum(
        _finite(fi.amount if fi.amount_prior_day is None else fi.amount_prior_day)
        for fi in placed
    )
    if moved_in != 0.0 or moved_out != 0.0:
        moves[md] = moved_in
        moves_out[md] = moved_out
```
Extract only the `read_day`/`placed` lines; leave the sums and the `moves`/`moves_out` writes alone (RESEARCH: "Mark/flow arithmetic: any change to `apply_marks`' numbers" is a Don't-Hand-Roll). Add a unit test in `tests/test_nav_marks_apply.py` pinning parity between the predicate and what `apply_marks` moves.

---

### `analytics-service/services/native_nav.py` — `native_flow_instants(..., at_instant_index=None)` (service, transform)

**Analog:** itself, :1126-1144.
```python
def native_flow_instants(
    ledger: NativeLedger,
    *,
    indexable_currencies: frozenset[str],
) -> list[FlowInstant]:
    out: list[FlowInstant] = []
    for fi in ledger.flow_instants:
        branch = classify_currency(fi.currency, indexable=indexable_currencies)
        if branch is MarkBranch.USD_FAMILY:
            out.append(fi._replace(currency="USD"))
        elif branch is MarkBranch.INDEXED:
            mark = ledger.marks[fi.currency].loc[pd.Timestamp(fi.day)]
            out.append(fi._replace(amount=fi.amount * float(mark), currency="USD"))
    return out
```
Add a keyword-only `at_instant_index: Mapping[tuple[str, int], float] | None = None`; in the INDEXED branch set `amount_prior_day = fi.amount * price` only when the key `(fi.currency, fi.at_ms)` is present, else leave `None`. USD family stays `None`. With no index argument the output must be byte-identical (pin with the existing `test_a_days_deribit_instants_add_up_to_the_days_composed_flow`, unchanged). `amount` stays `qty x mark(own day)` because that is what leaves D+1.

Because the function replaces `currency` with `"USD"`, count INDEXED vs USD-family from the RAW ledger instants and `classify_currency` before valuing (RESEARCH Pitfall 6).

---

### `analytics-service/services/flow_price_store.py` — NEW (service, write-once store)

**Analog:** `analytics-service/services/nav_marks.py` (sync functions; callers wrap them in `await db_execute(lambda: ...)`). `trade_read_store.py` shows the alternative (its own async `_upsert` wrapping `db_execute` at :340-344) but nav_marks.py is the closer role+flow match for a write-once, re-select-the-stored-row store.

**Module constants/imports pattern** (nav_marks.py :61-75, :136-141, :144-146):
```python
from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any, Final

MARKS_TABLE: Final[str] = "api_key_nav_marks"
_MARKS_PAGE_SIZE: Final[int] = 1000
_STORED_COLUMNS: Final[str] = (
    "mark_day,marked_at,venue,nav_usd,open_pnl_usd,nav_native,open_pnl_native,native_unit"
)

class NavMarkError(RuntimeError):
    """A stored mark could not be written or read back. Static text, no amount."""
```
New equivalents: `FLOW_PRICES_TABLE`, `FLOW_PRICE_SOURCE = "deribit_perp_1m_open"`, a chunk constant of 100, `FlowPriceStoreError(RuntimeError)` with static text (no amount, no key, no instant).

**Strict parse, never skip** (nav_marks.py :406-421): a malformed stored row raises.
```python
def _parse_stored(row: Mapping[str, Any]) -> StoredMark:
    """A database row as a ``StoredMark``. A malformed row raises (KeyError, TypeError,
    ValueError): a stored mark that cannot be read is never silently skipped."""
```
Add the finite and `> 0` guard and a minute-in-chunk check.

**Write-once then re-select the STORED row** (nav_marks.py :441-464) — copy this structure; the stored row, not the local read, is the authority (Pitfall 1):
```python
supabase.table(MARKS_TABLE).upsert(
    read.to_row(api_key_id, allocator_id),
    on_conflict="api_key_id,mark_day",
    ignore_duplicates=True,
).execute()
stored = read_stored_mark(supabase, api_key_id, read.mark_day)
if stored is None:
    raise NavMarkError(
        "api_key_nav_marks: no row for the key and day after an insert that cannot lose "
        "to anything but an existing row"
    )
return stored
```
For the new table: `on_conflict="api_key_id,instrument,minute_ms"`, a LIST of rows chunked at 100 (A11: the list and three-column forms are unexercised in this repo; the new unit test plus one local-stack run must prove them), then re-select the same keys with `.eq("api_key_id", ...).eq("instrument", ...).in_("minute_ms", chunk)`.

**Read shape**: unlike `read_key_marks` (keyset paging, :467-494, because a key accumulates many marks and `max_rows = 1000`), the flow-price read needs no paging: at most 100 keys per request, so at most 100 rows. Assert `len(rows) <= len(chunk)`. Do not copy the keyset loop.

**Call site pattern** (job_worker.py :7578-7580):
```python
_stored_marks = await db_execute(lambda: read_key_marks(ctx.supabase, ctx.key_row["id"]))
```
Zero DB calls and zero chart calls when the wanted set is empty (a derive that moves no Deribit flow must stay byte-identical, and no existing fake then needs a route for the new table).

---

### `analytics-service/services/job_worker.py` — derive prefetch, capture, coverage check, refusal, D-01 log (service, job handler)

**Analog 1 — where the exchange is open and `_mark_read_at` is known** (Deribit branch, :5011-5020):
```python
try:
    account_state = await asyncio.wait_for(
        fetch_deribit_native_account_state(ctx.exchange),
        timeout=_BROKER_CRAWL_TIMEOUT_S,
    )
except asyncio.TimeoutError as _exc:
    raise DeribitTransientReadError(
        "Deribit get_account_summaries anchor read exceeded the "
        f"{_BROKER_CRAWL_TIMEOUT_S}s per-crawl bound — retrying rather "
        "than wedging the worker (FLIPRETRY-01)"
    ) from _exc
# 167.2.1.1.1 D-03: the instant the summaries read finished is the mark's read time.
_mark_read_at = _utc_now()
```
Wrap the new prefetch in `asyncio.wait_for(..., timeout=_BROKER_CRAWL_TIMEOUT_S)` the same way (RESEARCH Security: worker wedge). The prefetch must run BEFORE the `finally` at :7232-7236 closes the exchange.

**Analog 2 — the exchange close and why the failure is captured, not raised** (:7229-7240):
```python
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row, exc)
        raise
    finally:
        try:
            await aclose_exchange(ctx.exchange)
        except Exception:  # pragma: no cover
            pass

    # ── 167.2.1.1.1 NAVMTM plan 06 — THE MARK WRITE ...
```
Raising from the crawl would skip the mark write that follows the `finally`. Capture the failure into a local, let the mark write run, surface the failure at the apply seam. For a 429 inside the capture block: call `await _stamp_429(ctx.supabase, ctx.key_row, exc)` then record the failure (do not re-raise before the mark write).

**Analog 3 — the apply seam and its three `native_flow_instants` call sites** (:7658-7668, :7715-7719, :7732-7734): pass the prefetched index as `at_instant_index=` at all three. Key-mode excerpt:
```python
_apply_instants = (
    native_flow_instants(
        native_ledger,
        indexable_currencies=_completeness.indexable_currencies,
    )
    if venue == "deribit"
    else _event_flow_instants
)
```
The non-writer-basis key-mode branch (:7672-7679) uses `_event_flow_instants`, which moves no Deribit flow; leave it alone.

**Analog 4 — the refusal road a new token joins** (token constants :380-394, refusal return :7773-7795):
```python
_MARK_ALLOCATED_NAV_UNRECONCILED: Final[str] = "mark_allocated_nav_unreconciled"

if _marks_refusal is not None:
    logger.error(
        "derive_broker_dailies: nav marks refused (reason=%s venue=%s id=%s)",
        _marks_refusal, venue, funding_label,
    )
    await _stamp_strategy_analytics_failed(
        "This strategy's marked-to-market values could not be applied to its "
        "return series, so its performance figures were not updated. The issue "
        "has been reported to us and needs nothing from you.",
        detail=f"nav marks refused ({_marks_refusal})",
        heal_series=False,
    )
    return DispatchResult(
        outcome=DispatchOutcome.FAILED,
        error_message=f"derive_broker_dailies: nav marks refused ({_marks_refusal})",
        error_kind="permanent",
    )
```
Add `_MARK_FLOW_INDEX_UNAVAILABLE: Final[str] = "mark_flow_index_unavailable"` beside the two existing constants and set `_marks_refusal` to it (structural no-data / coverage miss on a no-data minute). The TRANSIENT dispositions (budget exhausted, 429, store read/write fault) are a different return: `DispatchResult(outcome=DispatchOutcome.FAILED, error_kind="transient")` with static text and counts only, nothing written, after the mark write. Mirror the transient shape used by the composite 429 arm (:10848-10860).

**Analog 5 — `_stamp_429`** (:1388-1425, signature and geo-block skip):
```python
async def _stamp_429(
    supabase: Client, key_row: dict[str, Any], exc: BaseException
) -> None:
    if is_geo_blocked(exc):
        ...
        return
    def _stamp() -> None:
        supabase.rpc("stamp_api_key_429", {"p_api_key_id": key_row["id"]}).execute()
```
Reuse as is. Deribit has no `EXCHANGE_COOLDOWNS` entry (default 120 s applies); do not add one.

**Analog 6 — the D-01 log line, placed beside the existing one** (:7945-7949). The existing line carries `id=%s` (`funding_label`, which is the api_key_id in key mode and the strategy_id otherwise, :4162/:4165):
```python
logger.info(
    "derive_broker_dailies: nav marks applied (marks=%d since=%s gaps=%d mode=%s id=%s)",
    len(_marks_to_apply), _applied_marks.marks_since,
    len(_applied_marks.mark_gap_days), "key" if is_key_mode else "strategy",
    funding_label,
)
```
The NEW line must not reuse `id=%s` or any identifier. RESEARCH's wording, emitted when `venue == "deribit"`, even at `moved=0`:
```python
logger.info(
    "derive_broker_dailies: deribit flows moved by marks "
    "(moved=%d at_instant=%d usd_family=%d on_last_mark=%d mode=%s)",
    n_moved, n_priced_at_instant, n_usd_family, n_on_last_mark,
    "key" if is_key_mode else "strategy",
)
```
Counts come from the raw ledger instants and the marks actually passed to `apply_marks` (`_marks_in`) through the extracted `placed_flow_instants`.

**Composite members** (job_worker.py :10039-10060, :10150-10180, :10231-10247, :10316-10335): `_apply_member_marks` and `_apply_allocated_member_marks` already read `read_key_marks(ctx.supabase, key_id)` by `ctx.key_row["id"]`, hold the exact marks, and run with `ctx.exchange` open inside `_reconstruct_deribit`. Prefetch there with exact marks and let failures propagate to the existing arms. `_MemberNavUnreconciled` (:388-394) is the pattern for a sibling exception whose `token` is the new constant:
```python
class _MemberNavUnreconciled(Exception):
    token: Final[str] = _MARK_ALLOCATED_NAV_UNRECONCILED
```
Refusal return to reuse unchanged (`_refuse_member_marks`, :10231-10247): `detail = f"nav marks refused (seq={seq}, {reason})"`, static user text, `error_kind="permanent"`. Composite 429 arm to reuse unchanged (:10848-10860): `await _stamp_429(ctx.supabase, ctx.key_row, exc)` then a transient FAILED. Composite log line mirrors `nav marks applied to member (seq=%d ...)` (:10100-10103), which uses `seq=%d` and no id.

---

### `supabase/migrations/<ts>_api_key_flow_prices.sql` — NEW (migration, service-role-only write-once)

**Primary analog:** `supabase/migrations/20261031120000_allocator_trade_reads.sql` (layout, service-role-only, FORCE RLS with zero policies, catalogue-only verify). **Secondary:** `supabase/migrations/20261029120000_api_key_nav_marks.sql` for the write-once grant and NaN CHECK.

**Header/ordering to copy** (trade_reads :52-87): the paragraphs "SERVICE-ROLE ONLY, ON PURPOSE", "NO DATA CENSUS RUNS INSIDE THIS MIGRATION ... [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]", "DEPLOY ORDER IS NOT ENFORCED", "Transaction style: NO explicit transaction statements", "Rollback (manual ...)". Then:
```sql
SET LOCAL lock_timeout = '3s';
```

**Table + named constraints** (trade_reads :91-107 style; columns per RESEARCH section D-05.1):
```sql
CREATE TABLE public.allocator_trade_reads (
  api_key_id      UUID        PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE CASCADE,
  ...
  CONSTRAINT allocator_trade_reads_venue_chk
    CHECK (venue IN ('bybit')),
```
New table: composite `PRIMARY KEY (api_key_id, instrument, minute_ms)` with `api_key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE`; named `<table>_<what>_chk` constraints for instrument pattern, `minute_ms > 0 AND minute_ms % 60000 = 0`, price, and `source IN ('deribit_perp_1m_open')`.

**NaN/Infinity CHECK** (nav_marks :109-112) — copy the `NOT IN ('NaN','Infinity','-Infinity')` form and add `price > 0` (PostgreSQL orders NaN above every number, so `price > 0` alone admits it):
```sql
CHECK (nav_usd NOT IN ('NaN', 'Infinity', '-Infinity')
   AND ...
```

**RLS + grants** (trade_reads :163-174, and nav_marks :220-222 for the write-once grant):
```sql
ALTER TABLE public.allocator_trade_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_reads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_key_nav_marks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.api_key_nav_marks TO service_role;
```
For the new table: no policy at all, `GRANT SELECT, INSERT` to `service_role` only (UPDATE, DELETE, TRUNCATE withheld; the FK cascade still erases rows because it runs with the owner's privileges, which the gate proves).

**COMMENT ON** (trade_reads :139-155): table comment names the phase and decisions (D-04, D-05), write-once, erasure path; the `api_key_id` column comment carries the verbatim "do NOT add a delete-guard trigger ... MUST exempt `current_setting('quantalyze.sanitize_in_progress', true) = 'on'`" text.

**Self-verify block** (trade_reads :182-206): `DO $verify$` that reads the catalogue only (`to_regclass`, `pg_constraint` by `conname`/`contype = 'p'`); deliberately does not assert grants, RLS flags, policies, FK actions or CHECK bodies, so the mutation gate can apply a mutated copy. No `CREATE OR REPLACE` of any function, so the re-base requirement is vacuous (`delete_allocator_api_key` needs no edit; its latest definition is in `20261028120000_replace_allocator_equity_snapshots_window.sql`).

**Timestamp:** next free after `20261031120000`; re-check `origin/main` at merge (Phase 171's migration was renamed once when `20261030120000` was taken).

---

### `supabase/migrations/down/<ts>-rollback.sql` — NEW (keep-data rollback)

**Analog:** `supabase/migrations/down/20261031120000-rollback.sql` (whole file, 94 lines). Copy: manual-run header (`psql --single-transaction -v ON_ERROR_STOP=1 -f`), `SET LOCAL lock_timeout`, catalogue-only `$precondition$` block, `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, then rename-aside:
```sql
ALTER TABLE public.allocator_trade_reads RENAME TO allocator_trade_reads_rolled_back_20261031;
ALTER TABLE public.allocator_trade_reads_rolled_back_20261031
  RENAME CONSTRAINT allocator_trade_reads_pkey TO allocator_trade_reads_pkey_rolled_back_20261031;
```
then the catalogue-only `$verify$` block and the "migration ledger row is left in place" warning. Never DROP.

---

### `supabase/tests/test_api_key_flow_prices.sql` — NEW (SQL gate)

**Primary analog:** `supabase/tests/test_allocator_trade_reads.sql` (673 lines). Borrow arm-2/3/4 idioms from `supabase/tests/test_api_key_nav_marks.sql`.

**File skeleton to copy** (trade_reads :1-137): header with arms listed in executed order, anti-green-skip contract, sentinel paragraph, `-- RED-UNDER-SETUP: {"apply":[...]}` line, `BEGIN;`, `pg_temp` helper functions (`tr_user`, `tr_key`, `tr_try_*` that RETURN `SQLSTATE|message` and never raise an identity), one `DO $$` block, closing `RAISE NOTICE 'ALL N ARMS EXECUTED (...)'` then `ROLLBACK;`. Reuse the Phase 171 `RED-UNDER-SETUP` line verbatim, ending with the new migration instead of `20261031120000_allocator_trade_reads.sql`; it includes `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql` (makes every REVOKE falsifiable) and `41-fixture-api-keys-user-id-fk.sql` (makes the account-deletion cascade reach `api_keys`).

**Anti-green-skip guard** (:128-134): absence of the table is `RAISE EXCEPTION 'TEST FAILED (1): ... must not skip'`, never a skip.

**Arm + twin pairing idiom** (every arm carries prose `RED-UNDER:` plus machine-readable `RED-UNDER-M:` with a measured `occurrences`), e.g. the privilege arm (trade_reads :170-180 shape):
```sql
-- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/<ts>_api_key_flow_prices.sql","find":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;","replace":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;\nGRANT SELECT ON public.api_key_flow_prices TO authenticated;","occurrences":1}]}
```
Pin the 42501 message text (`'42501|permission denied for table <name>%'`), because FORCE RLS with no policy also answers 42501 on INSERT and would hide a stray grant.

**Write-once arm (arm 2)** — copy nav_marks arm 2 (:253-305): INSERT as `service_role`, capture `to_jsonb(row)`, second INSERT `ON CONFLICT (api_key_id, instrument, minute_ms) DO NOTHING`, assert `ROW_COUNT = 0` and the row image byte-identical. Twin widens the primary key (`find` on the `PRIMARY KEY (...)` text). Note the nav_marks twin edits `UNIQUE (api_key_id, mark_day),`; here the arbiter is the composite PK.

**UPDATE / DELETE+TRUNCATE arms (3, 4)** — copy nav_marks :313-345 (`SET LOCAL ROLE service_role`, BEGIN/EXCEPTION capturing `RETURNED_SQLSTATE`/`MESSAGE_TEXT`, assert `42501` and `'permission denied for table ...%'`). Twins add `UPDATE` / `DELETE` to the service_role grant.

**Erasure arms (key, account)** — copy trade_reads arm 3 (:362-430): seed three users/keys, `set_config('request.jwt.claims', json_build_object('sub', ..., 'role','authenticated')::text, true)`, `SET LOCAL ROLE authenticated`, `PERFORM public.delete_allocator_api_key(v_ka, false)`, assert rows gone and the other keys' rows stay; then `DELETE FROM auth.users WHERE id = v_b`. Twin: `ON DELETE CASCADE` -> `ON DELETE RESTRICT` on the key FK (trade_reads uses `find` on the exact `api_key_id ... REFERENCES ... ON DELETE CASCADE` text; give the account arm a distinct twin).

**CHECK arm** — copy the `FOR v_case IN SELECT * FROM (VALUES (label, overrides, constraint_name))` loop (trade_reads :560-585): each refusal must be `23514|%"<constraint>"%`, preceded by a legitimate row accepted first. Cases: price 0, negative, NaN, Infinity; `minute_ms` non-multiple of 60000 and non-positive; malformed instrument; source outside the closed set.

**Primary-key arm** — copy trade_reads arm 7 (:588-632): duplicate refused `23505|%"<table>_pkey"%`; same minute other instrument accepted; other minute same instrument accepted.

**Catalogue arm (last)** — copy trade_reads arm 8 (:645-665): `relrowsecurity AND relforcerowsecurity`, zero `pg_policy` rows, and the per-role `has_table_privilege` matrix with `service_role` = SELECT + INSERT only (change `v_want` to `v_role = 'service_role' AND v_priv IN ('SELECT','INSERT')`).

**Rules shared by both analogs:** synthetic data only (`@invalid.local`, generated uuids, no amounts in messages); every `TEST FAILED (N)` raise sits directly in the DO body (the mutation runner reads an identity only from a single-frame `inline_code_block` raise).

---

### `analytics-service/tests/test_nav_marks_compose_roundtrip.py` — Deribit BTC RED test (test, request-response)

**Analog:** `test_moved_btc_flow_priced_at_the_mark_day_close` (:1004-1040) for the docstring-with-hand-arithmetic shape; `test_deribit_key_mode_deposit_made_before_the_read_is_counted_in_the_mark_day` (:1189-1213) plus `derive_deribit_key` (:1087-1170) for the Deribit harness. The harness already takes `instants=` and `composed_flows=`; add a scripted `ctx.exchange.public_get_get_tradingview_chart_data` (extend `derive_deribit_key` with an optional exchange script, or patch it on `ctx`).

**Test body pattern to copy** (:1189-1213):
```python
marks = {**OKX_MARKS, "2026-03-10": 1244.42}
db = KeyDb()
seed_deribit_marks(db, marks)
at = int(datetime(2026, 3, 11, 0, 5, tzinfo=timezone.utc).timestamp() * 1000)
result, capture = await derive_deribit_key(
    db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
    composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 50.0},
    instants=(FlowInstant(at, "2026-03-11", 50.0, "USDC"),),
)
assert result.outcome == DispatchOutcome.DONE, result.error_message
assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
ki = _key_inputs_payload(capture, KEY_DRB)
payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
assert_levels(levels(payload), marks)
assert_trustworthy(payload)
```
New case: instants `FlowInstant(at, "2026-03-11", 0.0005, "BTC")`, a ledger with `marks={"BTC": Series(03-10: 100000.0, 03-11: 102000.0)}`, scripted candles at 00:04 / 00:05 / 00:06 with opens 100_900.0 / 101_000.0 / 101_100.0 (so containing-minute selection is distinguishable from an adjacent-candle rule). Hand-typed expectation from RESEARCH "Code Examples": `rows["2026-03-10"] == approx(22.92 / 1171.0, abs=1e-12)` (own-day code gives `22.42 / 1171.0` and must fail), stored `composed_flows` 03-10 == 50.5, 03-11 nets to 0.0. Never compute the expected value with the code under test.

**Required companion cases (from RESEARCH Validation Architecture):** own-mark prediction path; failing read keeps the derive's own mark and writes no csv/`key_inputs`; `RateLimitExceeded` on the last attempt calls `_stamp_429` exactly once (pattern: `stamp = AsyncMock()` patched at `services.job_worker._stamp_429`, then `stamp.assert_awaited_once()` and `stamp.await_args.args[2] is exc`, see `tests/test_nav_marks_l4_read.py` :519-538); structural no-data -> `mark_flow_index_unavailable`; no moved INDEXED flow -> `public_get_get_tradingview_chart_data.assert_not_called()`; second derive of the same scenario makes ZERO chart calls (store).

**Pitfall to bake in** (RESEARCH Pitfall 5): the derive tests build `ctx.exchange = AsyncMock()`, so an unscripted chart call returns a mock, the validator calls it flaky, and the real 1+2+...+128 s backoff runs. Script the exchange explicitly in every new test and set `services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS = 0.0` (monkeypatch) in failure tests. Record call order so a read after the patched `aclose_exchange` fails the test (Pitfall 1: `_base_patches` mocks `aclose_exchange`, which hides the closed-exchange bug).

**Refusal-cost assertion to reuse** (`tests/test_nav_marks_derive_apply.py` :1068-1100, `assert_refusal_cost_nothing`): no csv upserts/deletes, exactly one failed stamp with static text containing no digits, operator detail `| detail: nav marks refused (<token>)` plus an ERROR record `reason=<token>`.

**Log-line test:** `caplog` pattern from the same file (:1095-1098: `r.getMessage()` filtered, `r.levelname == "ERROR"`); assert the new INFO line is present at `moved=0`, and that no key/strategy id substring appears in it.

---

### `analytics-service/tests/test_deribit_ingest.py` — `-k minute_prices` (test, unit, retry)

**Analog:** `_ChartDataStub` and the `test_perp_daily_*` family (:2554-2640), `_SleepSpy` (:29-36).
```python
class _ChartDataStub:
    def __init__(self, script: list[Any]) -> None:
        self._script = list(script)
        self.calls: list[dict[str, Any]] = []
    async def public_get_get_tradingview_chart_data(self, params: dict[str, Any]) -> Any:
        self.calls.append(dict(params))
        item = self._script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item
```
Retry assertion shape (:2619-2631):
```python
stub = _ChartDataStub([ccxt.RequestTimeout("blip")] * 3)
spy = _SleepSpy()
with pytest.raises(DeribitTransientReadError):
    await di.fetch_deribit_perp_daily_index(stub, "SOL", oldest_day="2025-07-01", sleep=spy, max_retries=2)
assert len(stub.calls) == 3      # initial + 2 retries
assert spy.waits == [1.0, 2.0]   # exponential backoff
```
`_chart_ok` (:2565-2570) builds `{"result": {"status": "ok", "ticks": ..., "close": ...}}`; the new reader needs an `open` array too, so add a sibling helper. New assertions the sibling tests do NOT have: last-attempt `RateLimitExceeded` is re-raised as `ccxt.RateLimitExceeded` (not wrapped), structural `BadSymbol` / `no_data` raises the named structural error (sibling tests assert `== {}`; do not copy that), `resolution == "1"`, `instrument_name == "BTC_USDC-PERPETUAL"`. Also pin that `classify_exception(DeribitTransientReadError("x"))[0] != "permanent"` stays true (existing precedent at :2517).

---

### `analytics-service/tests/test_flow_price_store.py` — NEW; fake route for the new table

**Analog:** the in-memory fake in `analytics-service/tests/test_nav_marks_writer.py` (:67-170).
```python
class _Exec:
    def __init__(self, fn): self._fn = fn
    def execute(self): return MagicMock(data=self._fn())

class _MarksQuery:
    def upsert(self, row, on_conflict=None, ignore_duplicates=False) -> _Exec:
        self._db.upserts.append((MARKS, row, on_conflict, ignore_duplicates))
        return _Exec(lambda: self._db.insert_mark(row, ignore_duplicates))
    def select(self, cols): ...
    def eq(self, col, val): ...
    # NO in_ / lt / list-upsert: the new route must add them

def route_marks(ctx, db):
    inner = ctx.supabase.table.side_effect
    def _routed(name):
        db.touched.append(name)
        return _MarksQuery(db) if name == MARKS else inner(name)
    ctx.supabase.table.side_effect = _routed
    return ctx
```
Write a sibling `_FlowPricesQuery` with `eq`, `in_`, `select`, and `upsert(list_of_rows, on_conflict=..., ignore_duplicates=True)` that returns `[]` for an existing key (ON CONFLICT DO NOTHING) and records `(table, rows, on_conflict, ignore_duplicates)` in `db.upserts`, then route it with the same `_routed` wrapper (chain it over `route_marks` the way `derive_deribit_key` already does, `route_key_csv(route_marks(ctx, db), db)`). Assertions: chunking at 100 keys, strict row parsing, `ignore_duplicates=True` with the three-column `on_conflict`, the re-select returns the stored row, a pre-seeded stored price wins over a disagreeing scripted chart, only the MISSING minutes are fetched, and a store write error is the named transient failure with the mark still stored.

---

### Census pins for the new SQL gate file (config / test pins)

**Precedent commits (read-only):** `5ff4ba968` (mutation floors and runner pins) and `03e6bb179` (sql-tests sentinel census). Do not copy numbers; re-measure at HEAD after merging `main`, with ONE full `node scripts/mutation-runner/run.mjs`. Live values at this HEAD for orientation only: `FILES_FLOOR = 81` (scripts/mutation-floors.mjs :1316), `ARMS_FLOOR = 816` (:3323), `WAIVED_CEILING = 0` (:3437), ci.yml `SENTINEL_FLOOR=25` (:5184) and `ARMS_FLOOR=386` with its `8 + 13 + ...` sum (:5185).

**`5ff4ba968` moved exactly:** `scripts/mutation-floors.mjs`, `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/mutation-runner-floors.test.ts`. Floor edit shape (dated RAISED comment above the constant, then the constant):
```js
// RAISED 80 -> 81 2026-10-27 (Phase 171 READCEILING plan 06): +1 file, test_allocator_trade_reads.sql ...
// ... The stale-low direction was observed first: `RATCHET STALE: 81 of 108 gate files
// are now annotated but FILES_FLOOR is still 80.` WAIVED_CEILING stays 0.
export const FILES_FLOOR = 81;
```
**`03e6bb179` moved exactly:** `.github/workflows/ci.yml` (roster row in the contiguous, equally-indented block, in file-name order, plus `SENTINEL_FLOOR` and `ARMS_FLOOR` and its sum), `src/__tests__/drift-check-scripts.test.ts`, `src/__tests__/lint-sql-gates.test.ts` (`scanned N file(s)`). Roster row shape:
```
#   test_allocator_trade_reads.sql                   8
```
Keep prose OUT of that block: it is read as a contiguous block and prose inserted between rows makes the table read as gone. Also run `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` (RESEARCH section 3). Read each stale-low failure message first, as both precedents did.

No re-dump of `supabase/schema/baseline.sql` or `baseline-carried-migrations.txt` in this PR (the post-PROD-apply automation owns it; the local-stack lane replays the new migration on top of the dump).

---

## Shared Patterns

### Untrusted numeric input from the venue
**Source:** `analytics-service/services/deribit_ingest.py` `build_deribit_indexable_currencies` (:1152-1157, RESEARCH-cited) and `fetch_deribit_perp_daily_index` (:743-750).
**Apply to:** the new minute reader and `read_flow_prices`.
Coerce with `float()`, require `math.isfinite` and `> 0`. A bad number is a structural failure, never a skipped row or a defaulted price. (The sibling readers `continue` past bad rows; the new reader must not.)

### No identifying fields in logs or user text
**Source:** `nav marks applied` line (job_worker.py :7945-7949) prints `id=%s`; the composite line (:10100-10103) uses `seq=%d` instead. `NavMarkError` (nav_marks.py :144-146) and the refusal text (job_worker.py :7773-7795) carry static text.
**Apply to:** the D-01 log line, `FlowPriceStoreError`, the transient `DispatchResult` text, and the new refusal token. Counts and closed tokens only; exception text through `scrub_freeform_string(str(exc))`.

### Write-once, then trust the stored row
**Source:** `write_nav_mark` (nav_marks.py :441-464).
**Apply to:** `write_flow_prices`; also the migration grant (`GRANT SELECT, INSERT` only).

### Sync store functions wrapped in `db_execute` by the caller
**Source:** job_worker.py :7578-7580 `await db_execute(lambda: read_key_marks(...))` with `services/db.py` `db_execute` (:137).
**Apply to:** every `flow_price_store` call from the derive and the composite members.

### Named-refusal road, nothing written
**Source:** `_marks_refusal` block (job_worker.py :7773-7795) and `_refuse_member_marks` (:10231-10247).
**Apply to:** `mark_flow_index_unavailable` (permanent). Transient dispositions take the `error_kind="transient"` road instead; a 429 goes through `_stamp_429` first.

### Hand-typed arithmetic oracles, neuter-and-see-RED
**Source:** `test_moved_btc_flow_priced_at_the_mark_day_close` docstring (compose_roundtrip :1004-1020) and RESEARCH "Neuter-and-see-RED".
**Apply to:** every new money-math test. Expected values typed by hand; each guard neutered by a byte-backup edit (never `git checkout/restore/stash`) and the named test seen RED, then restored.

### mypy line (every analytics-touching brief and pre-push check)
`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`
New code is typed strictly: `Mapping[tuple[str, int], float]` for the index, `Final[str]` for tokens, `FlowInstant` is a `NamedTuple` so `_replace` keeps its types.

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|----------------|------|-----------|--------|
| Prefetch-before-close with captured failure, surfaced after the mark write (inside `derive_broker_dailies`) | service orchestration | event-driven | No existing read is deferred past `finally: aclose_exchange` and re-raised after the mark write. Nearest are the mark-write ordering comment (:7238-7245) and the OKX option read that must stay on the open exchange (:7055-7058, "B1"). Use RESEARCH Pattern 3 plus the coverage check. |
| Predicting this derive's own mark (`marked_at = _mark_read_at`, `mark_day = date(marked_at) - 1`) to know which flows rule 10 will move before the mark is written | service logic | transform | `mark_day_for(marked_at)` (nav_marks.py :205) is the helper to reuse for the label; the "predicted mark set = stored marks plus own mark" merge is new, and the coverage check on the FINAL marks is what makes a miss loud instead of silent. |
| Supabase-py list upsert with a three-column `on_conflict` and `in_` filter | store | CRUD | Existing code only does single-row `upsert(..., on_conflict="a,b", ignore_duplicates=True)` (nav_marks.py :453-457) and `delete().in_("api_key_id", ids)` (trade_read_store.py :439). RESEARCH A11: prove the list and 3-column forms with the unit test and one local-stack run. |
| Candle `open` extraction from `get_tradingview_chart_data` | parse | transform | Every existing reader takes `close` only; the validator returns `(ticks, close)`. Add a sibling rather than changing the shared one. |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/tests/`, `supabase/migrations/` and `down/`, `supabase/tests/`, `scripts/mutation-floors.mjs`, `.github/workflows/ci.yml`, commits `5ff4ba968` and `03e6bb179`.
**Files scanned:** about 30 read in part or whole (large files, `job_worker.py` 12k lines, `deribit_ingest.py` 3.1k lines, read by targeted ranges only).
**Tracked-source gate:** `git ls-files` printed all 14 service/test analogs and all 6 SQL/migration analogs queried; no `.gsd/capabilities` mirror path is named anywhere.
**Pattern extraction date:** 2026-10-28
