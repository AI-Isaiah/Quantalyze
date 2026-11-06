# Phase 171: READCEILING - Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 22 new/modified (13 code/test/SQL, 9 census/hand-maintained)
**Analogs found:** 21 / 22 (one file has a partial analog only)

All analog paths below were checked as git-tracked source. Line numbers are as read on 2026-10-27 at the phase worktree; the repo moves daily, so the planner should cite by SYMBOL in plan text and treat the numbers as a locator only (CLAUDE.md `[164.7-CITATION-DRIFT-01]`). No PROD ids, secrets, or home paths appear here.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/equity_reconstruction.py` (`_fetch_bybit_trades` continuation, scope read, new token, gather arm, handler arm) | service | request-response + batch (paged read) | same file: `_fetch_okx_inst_type_trades` (backward continuation), `_crawl_whole_account` outcome loop, `run_reconstruct_allocator_history_job` except ladder | exact (in-file) |
| `analytics-service/services/trade_read_store.py` (NEW: ContextVar scope, load/save_window/touch/purge, projection) | service (store) | CRUD | `services/exchange.py` `_LAST_DQ_FLAGS` ContextVar (scope channel); `services/db.py` `db_execute` call shape used across `equity_reconstruction.py` | role-match (no existing per-window store) |
| `analytics-service/services/equity_reconstruction.py` or `trade_read_store.py` `TradeReadDeferred` / `TradeReadStalled` exceptions | model (exception) | event-driven | `TruncatedTradeRead` (eq. line 128), `ForcedRebuildRefusedError` (line 2216), `okx_archive_job._Stop` (line 293) | role-match |
| defer helper (`_defer_reconstruct`, handler arm) | service | event-driven (queue defer) | `services/okx_archive_job.py` `_defer_job` / `_check_backstop` (lines 1070-1131) and `services/job_worker.py` `_check_circuit_breaker` defer block (lines 1342-1383) | exact |
| `analytics-service/scripts/allocator_history_probe.py` (new closed keys) | utility (read-only probe) | batch | same file: `ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS`, `_account_record`, `_probe_member` | exact (in-file) |
| `analytics-service/tests/test_trade_read_resume.py` (NEW) | test | request-response (fake venue) | `tests/test_trade_pages.py` + `tests/_trade_pages.py` (`VenueTradeBook`) | exact |
| `analytics-service/tests/test_trade_read_store.py` (NEW) | test | CRUD (fake supabase) | `tests/test_equity_reconstruction.py` `FakeSupabaseClient` / `_FakeTable` | role-match |
| `analytics-service/tests/test_trade_pages.py` (two pins move) | test | request-response | same file | exact (in-file) |
| `analytics-service/tests/test_reconstruct_force_rebuild.py` (15 -> 16 tokens) | test | pin | same file `test_forced_rebuild_refusal_reasons_are_a_closed_set` | exact (in-file) |
| `analytics-service/tests/test_bybit_two_year_window.py` (`== 15` pin) | test | pin | same file `test_the_two_year_refusal_adds_no_token` | exact (in-file) |
| `analytics-service/tests/test_allocator_history_probe.py` (new keys, vocabulary loop) | test | pin | same file | exact (in-file) |
| `analytics-service/tests/test_reconstruct_whole_account.py` (precedence, deferred handler) | test | event-driven | same file, the sibling-DEFERRED test (about line 1236) | exact |
| `supabase/migrations/<ts>_allocator_trade_reads.sql` (NEW) | migration | CRUD (service-role-only tables) | `supabase/migrations/20261029120000_api_key_nav_marks.sql` | role-match (this one is not write-once and has no owner policy) |
| `supabase/migrations/down/<ts>-rollback.sql` (NEW) | migration | batch | `supabase/migrations/down/20261029120000-rollback.sql` | exact |
| `supabase/tests/test_allocator_trade_reads.sql` (NEW gate) | test (SQL gate) | CRUD | `supabase/tests/test_api_key_nav_marks.sql` | exact |
| `scripts/mutation-floors.mjs` | config (ratchet) | pin | the 2026-10-26 NAVMTM raise entries | exact |
| `.github/workflows/ci.yml` (sql-tests sentinel roster) | config | pin | the `test_api_key_nav_marks.sql 11` row and its re-measure comment block | exact |
| `src/__tests__/mutation-runner-floors.test.ts`, `mutation-annotation-parser.test.ts`, `lint-sql-gates.test.ts`, `gate-family-meta.test.ts`, `drift-check-scripts.test.ts` | test (census) | pin | the NAVMTM-era values in each file | exact |
| `scripts/check-gdpr-export-coverage.ts` | config | pin | `api_key_nav_marks` allowlist entry (line 402) | exact |
| `src/lib/database.types.ts` | config (hand-maintained types) | n/a | `api_key_nav_marks` block (line 343) | exact |
| `src/lib/gdpr-export-manifest.ts` | config | n/a | NOT needed for these tables (allowlisted instead; the NAV-marks `direct` entry exists only because that table is owner-readable) | n/a |
| `supabase/schema/baseline.sql`, `BASELINE.md`, `baseline-carried-migrations.txt` | config | batch | follow-up `chore(release)` commit `53f25ac3e` | exact (separate commit, after PROD apply) |
| `CHANGELOG.md`, `VERSION`, `package.json` | config | n/a | CLAUDE.md "CHANGELOG discipline" | exact |

## Pattern Assignments

### `analytics-service/services/equity_reconstruction.py` - `_fetch_bybit_trades` continuation (service, paged read)

**Analog:** `_fetch_okx_inst_type_trades` in the same file (backward walk, `end = oldest + 1`, one retry at `end = oldest`, id dedupe). The Bybit window loop it replaces is `_fetch_bybit_trades`.

**Constants and exception to extend** (lines 115-131):
```python
_TRADE_PAGE_LIMIT: Final[int] = 100
_BYBIT_TRADE_WINDOW_MS: Final[int] = 7 * 24 * 60 * 60 * 1000
_BYBIT_WINDOW_PAGE_CEILING: Final[int] = 100
_TRADE_PASS_PAGE_CEILING: Final[int] = 500
_TRUNCATED_READ_MESSAGE: Final[str] = (
    "the trade read was cut short before the venue ran out of trades; nothing was kept"
)

class TruncatedTradeRead(ccxt.BadRequest):  # type: ignore[misc]  # ccxt is untyped
    """A trade read cut short, raised at the truncation sites only. ..."""
```
New work: add a typed `site` attribute (closed token set) to this class and set it at each raise site, for the D-01 probe record. Add `_BYBIT_WINDOW_SEGMENT_CEILING`.

**Core pattern to copy: the OKX backward continuation** (lines 815-863, abbreviated; copy the shape, not the literals):
```python
trades: list[dict[str, Any]] = []
seen: set[Any] = set()
end_ms: int | None = None
oldest_seen: int | None = None
for _ in range(_TRADE_PASS_PAGE_CEILING):
    ...
    added = _extend_unseen(trades, seen, page)
    page_oldest = min(int(t.get("timestamp") or 0) for t in page)
    oldest_seen = page_oldest if oldest_seen is None else min(oldest_seen, page_oldest)
    if oldest_seen <= since_ms:
        break
    next_end_ms = oldest_seen + 1
    if added == 0 or (end_ms is not None and next_end_ms >= end_ms):
        if len(page) < _TRADE_PAGE_LIMIT:
            break
        if end_ms == oldest_seen or max(int(t.get("timestamp") or 0) for t in page) <= oldest_seen:
            logger.warning(
                "okx trade pass stopped on a page that did not advance "
                "venue=okx inst_type=%s page_rows=%d rows=%d", inst_type, len(page), len(trades),
            )
            raise TruncatedTradeRead(_TRUNCATED_READ_MESSAGE)
        next_end_ms = oldest_seen
    end_ms = next_end_ms
    await _rate_limit_sleep(exchange)
```

**Current Bybit window loop being changed** (lines 673-726): the `for _ in range(_BYBIT_WINDOW_PAGE_CEILING)` / `else:` ceiling raise is the "100 pages then raise" to replace with a segment loop. Keep: the two-year guard at the top (lines 659-672, untouched), `NotSupported` handling, the `_next_page_cursor` use, the `len(page) >= _TRADE_PAGE_LIMIT` no-cursor WARNING, and the counts-only WARNING style (venue, `window_age_days`, `page_rows`, `rows`; never venue text). RESEARCH Code Example A is the sketch; one WARNING per loud stop (a test counts them).

**Helpers reused unchanged:** `_extend_unseen` (line 606), `_next_page_cursor` (line 626), `_rate_limit_sleep` (imported from `services.ccxt_flow_fetch`).

**Error handling:** stalled page falls into continuation; a segment that does not strictly lower `until`, or a full page that adds nothing after the one retry, raises `TruncatedTradeRead` with the typed site. `TradeReadDeferred` is NOT a `ccxt` class (it must not classify permanent); raise it only at window boundaries after progress is stored.

**Resume scope without a new keyword (PD-J pin):** `_fetch_and_price_window` and its crawl call shape are pinned by `test_unforced_reconstruct_calls_the_crawl_and_the_anchor_with_their_existing_arguments` (about line 835 of `tests/test_reconstruct_force_rebuild.py`). Copy the existing side-channel precedent: `_AnchorPartialSet` (line 3756 of `equity_reconstruction.py`):
```python
class _AnchorPartialSet(set[str]):
    """... It rides the existing return so the function's signature, and every caller and
    fake that unpacks two values, is unchanged (PD-J)."""
    positions_unread: bool = False
    wallet_total_usd: float | None = None
```
and the ContextVar precedent in `services/exchange.py` (lines 86-88):
```python
_LAST_DQ_FLAGS: ContextVar[dict[str, Any]] = ContextVar(
    "_LAST_DQ_FLAGS", default={}
)
```
Use `ContextVar[TradeReadScope | None]` with `default=None` (an immutable default; the exchange.py comment warns that a shared mutable default leaks across tasks). Without a scope the read is layer 1 only. The probe sets no scope.

---

### `analytics-service/services/equity_reconstruction.py` - token, gather arm, handler arm (service, event-driven)

**Token set to extend** (lines 2188-2213): add ONE literal to `FORCED_REBUILD_ACCOUNT_REASONS`:
```python
FORCED_REBUILD_ACCOUNT_REASONS: Final[frozenset[str]] = frozenset(
    {
        "account_state_unreadable",
        "account_identity_pending",
        "account_key_venue_unsupported",
        "account_key_not_working",
        "account_key_read_failed",
        "account_key_no_rows",
        "account_sum_empty",
        "account_keys_changed",
        "history_days_unreproduced",
        # + the new stalled-read token (RESEARCH A11 proposes account_key_read_stalled)
    }
)
```
Also update the comment above the set that says "these 15 tokens". The raise site MUST use a double-quoted literal, `ForcedRebuildRefusedError("account_key_read_stalled")`, because the raise-site scan regex is `ForcedRebuildRefusedError\(\s*"([a-z_]+)"\s*\)`.

**Gather outcome loop** (`_crawl_whole_account`, lines 5330-5389). Current order: `ForcedRebuildRefusedError` -> `DispatchResult` -> generic `BaseException` (classify, retryable vs `account_key_read_failed`). Insert a deferral arm BEFORE the generic `BaseException` arm, and decide precedence over ALL outcomes first (refusal beats a sibling's deferral; then settled `DispatchResult`; then deferral; then retryable; then permanent). The existing loop raises on the first refused member in key order, so precedence needs a pre-pass, not a new `elif`. Keep the static-fields WARNING style:
```python
logger.warning(
    "reconstruct_allocator_history account crawl failed "
    "allocator=%s key=%s venue=%s exc_class=%s",
    allocator_id, key.get("id"), _key_venue(key), type(outcome).__name__,
)
```
Convert `TradeReadStalled` to `ForcedRebuildRefusedError("account_key_read_stalled")` here (forced path). Unforced path maps to FAILED permanent with a static counts-only message; do not reuse the "forced rebuild refused" text.

**Handler except ladder** (`run_reconstruct_allocator_history_job`, lines 5515-5660): order is `ForcedRebuildRefusedError`, `_AccountCrawlRetryableError`, `ccxt.RateLimitExceeded`, `asyncio.TimeoutError`, `except Exception`. The new `except TradeReadDeferred` MUST precede `except Exception` (and `TradeReadStalled` for the unforced path likewise). The unforced crawl sits at lines 5578-5587 (`asyncio.wait_for(_crawl, timeout=_RECONSTRUCT_CRAWL_TIMEOUT_S)`); the scope must also be set there (RESEARCH Pitfall 3 and section 4). The refusal helper to reuse is `_forced_refusal_result` (line 5123), which logs a WARNING, writes one `allocator.equity.reconstruct_failed` audit, and returns FAILED/permanent. Do NOT add a new audit action (`test_action_literal_matches_ts_union`).

**Soft vs hard bound:** the hard bound is `_RECONSTRUCT_CRAWL_TIMEOUT_S` (lines 144-146, `float(os.getenv("RECONSTRUCT_CRAWL_TIMEOUT_S", "1500"))`). Copy this env-override-with-default shape for the new soft budget; validate it is below the hard bound at import.

---

### `analytics-service/services/equity_reconstruction.py` - defer helper (service, event-driven)

**Analog:** `services/okx_archive_job.py` `_check_backstop` + `_defer_job`, and `services/job_worker.py` `_check_circuit_breaker` defer block. Note: `equity_reconstruction.py` imports from `services.job_worker` at lines 73-84 but does NOT currently import `_defer_lost_ownership`; add it to that import list. Do not import `okx_archive_job` (it is OKX-specific and imports job_worker).

**Constants to mirror** (`okx_archive_job.py` lines 207-215):
```python
MAX_DEFER_S: Final[int] = 3600   # defer_compute_job raises above one hour
MIN_DEFER_S: Final[int] = 60     # a wait shorter than this is a tight loop
BACKSTOP_AFTER_S: Final[int] = 24 * 60 * 60
```

**Backstop pattern** (lines 1070-1089): unreadable `created_at` counts as too old.
```python
def _check_backstop(job: Mapping[str, Any]) -> None:
    raw = job.get("created_at")
    created_ms: int | None = None
    if isinstance(raw, str) and raw.strip():
        try:
            created = datetime.fromisoformat(raw.strip())
        except ValueError:
            created = None
        if created is not None:
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            created_ms = int(created.timestamp() * 1000)
    if created_ms is None:
        raise _Stop("archive_give_up", "backstop age=unreadable")
    age = max(0.0, (_wall_ms() - created_ms) / 1000.0)
    if age >= BACKSTOP_AFTER_S:
        raise _Stop("archive_give_up", f"backstop age_h={int(age // 3600)}")
```

**Defer pattern** (lines 1092-1131):
```python
defer_seconds = int(min(max(seconds, MIN_DEFER_S), MAX_DEFER_S))

def _defer() -> None:
    supabase.rpc(
        "defer_compute_job",
        {
            "p_job_id": job.get("id"),
            "p_defer_seconds": defer_seconds,
            "p_reason": reason,
            "p_claim_token": job.get("claim_token"),
        },
    ).execute()

try:
    await db_execute(_defer)
except asyncio.CancelledError:
    raise  # never swallow cancellation
except Exception as exc:  # noqa: BLE001
    if _defer_lost_ownership(exc):
        return DispatchResult(outcome=DispatchOutcome.DEFERRED)   # watchdog reclaim: another worker owns it
    raise
return DispatchResult(outcome=DispatchOutcome.DEFERRED)
```
`p_reason` becomes `last_error`: a static class plus counts (windows, trades), never venue text.

**Claim budget:** `okx_archive_job.py` lines 240 and 318-326 (`CLAIM_BUDGET_S`, `_ClaimBudget`, monotonic clock seam `_monotonic = time.monotonic`). Copy the seam idea so tests drive a fake clock; the read budget is checked only at window boundaries and the deadline is taken once at crawl start so all members share it.

---

### `analytics-service/services/trade_read_store.py` (NEW; service/store, CRUD)

**Analog:** no existing per-window store; compose from (a) the PostgREST access shape used throughout `equity_reconstruction.py` (`db_execute` with a local closure; see `_stored_curve` in the probe, below), (b) the `ContextVar` precedent above, (c) `FakeSupabaseClient` capabilities (below) so tests can drive it.

**Access shape to copy** (`scripts/allocator_history_probe.py` lines 631-646, `_stored_curve`, which shows the closure + `db_execute` + `rows` idiom):
```python
from services.db import db_execute, rows

def _load() -> Any:
    return (
        supabase.table("allocator_equity_snapshots")
        .select("asof, value_usd")
        .eq("allocator_id", allocator_id)
        .gte("asof", window_start.isoformat())
        .execute()
    )

return {str(r["asof"]): float(r["value_usd"]) for r in rows(await db_execute(_load))}
```
For writes use `.upsert(rows, on_conflict="api_key_id,window_start_ms")` (idempotent: a window is a pure function of key, start and `read_version`). The fake supports `upsert(..., on_conflict=..., ignore_duplicates=...)`, `select`, `eq`, `neq`, `is_`, `in_`, `gte`, `lte`, `delete`, `order`, `limit`; it has NO `lt` (use `lte` for the expiry purge or extend the fake in the same plan).

**Module hygiene:** no import of `job_worker` or `equity_reconstruction` (avoids the cycle; scope type lives here). Counts and static tokens only in logs (H-3: never `logger.exception`, never venue text). A stored window whose rows do not parse is rejected, not used.

**Projection:** positional array `[ts, symbol, side, amount, price, cost, fee_cost]`, preserving append order (same-millisecond tie order is by insertion index via `sort_events_stable`, imported at line 70 of `equity_reconstruction.py`). The column order is part of `read_version`.

---

### `analytics-service/scripts/allocator_history_probe.py` (utility, read-only batch)

**Analog:** the same file. Every new record key needs three coordinated edits, and `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` (line 888 of the probe test) pins that key sets and validators agree.

**Key tuple** (lines 126-154): append the new keys to `ACCOUNT_RECORD_KEYS`, e.g. `"truncated_site"`, `"last_window_age_bucket"`, `"read_elapsed_s"`.

**Validators** (lines 205-233): add one per key, reusing the existing helpers (`_is_count` line 179, `_is_one_of` line 201):
```python
"failure_class": _is_one_of(_FAILURE_CLASSES),
"member_refusal": _is_one_of(_REFUSAL_TOKENS),
"trade_calls": _is_count,
```
**Defaults** (`_account_record`, lines 649-679): add a default per key (`"none"` for token keys, `0` for counts) so records with no truncation still validate.

**Token derivation** (lines 123-124): `_SELECTION_TOKENS` / `_REFUSAL_TOKENS` are built from `er.FORCED_REBUILD_REFUSAL_REASONS`, so the new refusal token flows into the probe automatically; the probe test loop is what must be re-pinned.

**Truncation mapping to extend** (`_probe_member`, lines 606-614):
```python
except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
    calls = recorder.calls if recorder is not None else []
    moved = recorder.transfers if recorder is not None else []
    return _MemberResult(
        read=False,
        failure_class="truncated" if isinstance(exc, er.TruncatedTradeRead) else classify_failure(exc),
        calls=calls,
        transfers=moved,
    )
```
Read the typed `site` off the `TruncatedTradeRead` instance here (a raised call is never in the recorder, so deriving the site from the call log cannot see a `NotSupported` mid-walk). Elapsed seconds: monotonic clock around the `asyncio.wait_for(_read_member(...), er._RECONSTRUCT_CRAWL_TIMEOUT_S)` at lines 593-596. Keep logging off and all output through `emit_record`/`validate_record`/`assert_sanitized`; floats must be rounded (`_is_sig3_float`) or integers (`_is_count`). Static pins that must stay green: `test_the_probe_source_calls_no_writer` (line 786), `test_the_probe_names_only_the_two_tables_it_reads` (line 802: `.table("allocator_equity_snapshots")` and `.table("api_keys")` only), and the `ReadOnlySupabase` wrapper test (line 809). The probe never sets the resume scope.

---

### `analytics-service/tests/test_trade_read_resume.py` (NEW test, request-response over a fake venue)

**Analog:** `tests/test_trade_pages.py` driven by `tests/_trade_pages.py::VenueTradeBook`.

**Imports pattern** (`test_trade_pages.py` lines 11-23):
```python
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock
import pytest

from services import equity_reconstruction as er
from services.job_worker import classify_exception
from tests._trade_pages import DAY_MS, VenueTradeBook, real_ccxt_client, trade_rows
from tests.test_equity_reconstruction import _make_ohlcv_row
```

**Finite fake venue** (SC-2: a FINITE over-ceiling book; the existing ceiling tests use an infinite generator and cannot RED at base):
```python
exchange = AsyncMock()
exchange.id = "bybit"
exchange.fetch_my_trades = AsyncMock(side_effect=VenueTradeBook(exchange, trades))
exchange.fetch_deposits = AsyncMock(return_value=[])
exchange.fetch_withdrawals = AsyncMock(return_value=[])
exchange.fetch_ohlcv = AsyncMock(
    return_value=[_make_ohlcv_row(start_ms + d * DAY_MS, 50000.0) for d in range(62)]
)
```
`VenueTradeBook` models the 7-day rule, 100-row pages, descending order, `nextPageCursor` on the newest row's `info`, and records every call on `.calls` (`since`, `limit`, `params`, `rows`). `trade_rows(count, first_ms, step_ms, *, symbol, inst_type, id_prefix)` (line 43) builds ccxt-shaped rows. Per RESEARCH section 1 summary, `trade_rows(10_500, SINCE + DAY_MS, 50, id_prefix="w")` inside one 7-day window raises `TruncatedTradeRead` after 100 calls at base (RED), and must be read whole after the change.

**Equivalence oracle spy** (`test_trade_pages.py` lines 58-71): the same finite book read in one pass and across N claims with a tiny deadline must yield identical `_compute_daily_equity` rows:
```python
seen: list[list[dict[str, Any]]] = []
original = er._compute_daily_equity

def _spy(trades_in: list[dict[str, Any]], *args: Any, **kwargs: Any) -> Any:
    seen.append(list(trades_in))
    return original(trades_in, *args, **kwargs)

monkeypatch.setattr(er, "_compute_daily_equity", _spy)
```
**No-secret-in-logs pattern** (lines 78-80, 186-215): a planted `_SIGNATURE = "SIGNATURE-signed-url-secret"` placed in `row["info"]`, with `caplog.set_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction")` and `assert _SIGNATURE not in record.getMessage()` for every record. Copy it for every new log line. Never `importlib.reload`; pytest only from `analytics-service/`.

---

### `analytics-service/tests/test_trade_read_store.py` (NEW test, CRUD over a fake client)

**Analog:** `tests/test_equity_reconstruction.py::FakeSupabaseClient` / `_FakeTable` (lines 73-300). The upsert path keys rows by `on_conflict` columns (`pk = tuple(row.get(c) for c in conflict_cols)`), honours `ignore_duplicates`, and overwrites otherwise. Add `lt` (or purge with `lte`) in the same plan. Assert: stale state discarded (other `read_version`, expired, `since` earlier than origin); duplicate writers of one window leave one identical row; float equality through the JSON round trip; append order preserved; a fee given as a dict and as a number replay-equal.

---

### Existing tests whose pins move deliberately (RED before, GREEN after)

- `tests/test_trade_pages.py::test_a_bybit_window_that_never_runs_out_hits_the_page_ceiling_loudly` (line 258): asserts `calls == er._BYBIT_WINDOW_PAGE_CEILING` and a "ceiling" WARNING. The endless fake there (constant timestamps `_T0 + DAY_MS`, a new id and cursor every call) stops on the no-advance rule after the second segment. Re-pin to the new loud-stop contract; do not weaken.
- `tests/test_trade_pages.py::test_a_venue_that_repeats_its_page_ends_the_read_with_one_warning[bybit]` (line 178): exactly ONE WARNING; the one-time retry must not add a second.
- `tests/test_reconstruct_force_rebuild.py::test_forced_rebuild_refusal_reasons_are_a_closed_set` (line 727): the `account` frozenset gains the new token, `len(anchor) + len(account) == 15` becomes 16, docstring "15 tokens" updated, raise-site equality scan unchanged in form.
- `tests/test_bybit_two_year_window.py::test_the_two_year_refusal_adds_no_token` (line 356): `assert len(er.FORCED_REBUILD_REFUSAL_REASONS) == 15` moves with the set.
- `tests/test_allocator_history_probe.py`: end-to-end and emitter tests (new keys), plus line 888 vocabulary loop.
- `tests/test_reconstruct_whole_account.py` (sibling-DEFERRED test, about line 1236): the model for the new "a sibling's refusal beats a Bybit deferral" and "a deferral is not an unknown fault" tests; it uses `_run_forced_two_account_job(monkeypatch, fake, exchange_1, exchange_2, results={...})` and asserts `_book_state(fake) == before` (the allocator's history is untouched). Copy that assertion for a deferred claim.

---

### `supabase/migrations/<ts>_allocator_trade_reads.sql` (migration, CRUD)

**Analog:** `supabase/migrations/20261029120000_api_key_nav_marks.sql`. Differences that matter: the new tables are service-role-only (no owner SELECT policy, no `allocator_id`, no coherence trigger, hence no SECURITY DEFINER function, no `supabase/schema/functions/*.sql` snapshot, no VAC-04 acknowledgement), and service_role needs UPDATE and DELETE (counters, purge), unlike the write-once marks.

**Header discipline** (analog lines 1-75): what-it-is-for block; decisions with ids; the three load-bearing warnings reproduced as relevant:
```sql
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue
-- and none of its data, and a failed TEST apply blocks the PROD apply, so the
-- verify block below reads the catalogue only ... [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]
--
-- ⛔ DEPLOY ORDER. Merging supabase/migrations/** applies to TEST and then to PROD
-- with no human stop, BEFORE the worker that writes this table deploys. An old
-- worker never touches the table, so the order is safe.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- Rollback (manual, off the auto-apply path; it KEEPS every stored mark):
-- supabase/migrations/down/20261029120000-rollback.sql
```
**Statements to copy** (analog lines 78-83, 140-ish, STEP 3/4):
```sql
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.api_key_nav_marks (
  ...
  api_key_id       UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  ...
  CONSTRAINT api_key_nav_marks_venue_chk
    CHECK (venue IN ('okx', 'bybit', 'binance', 'deribit', 'mt5', 'sfox')),
  CONSTRAINT api_key_nav_marks_native_detail_object_chk
    CHECK (native_detail IS NULL OR jsonb_typeof(native_detail) = 'object'),
  ...
);

ALTER TABLE public.api_key_nav_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_nav_marks FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_key_nav_marks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.api_key_nav_marks TO service_role;   -- new: SELECT, INSERT, UPDATE, DELETE
```
Use the proposed DDL in RESEARCH section 7 (two tables: `allocator_trade_reads`, `allocator_trade_read_windows`; every CHECK named `<table>_<what>_chk` so the SQL gate can name its own constraint). Add `COMMENT ON TABLE` / column comments in the analog's style, including the "no delete-guard trigger without a `quantalyze.sanitize_in_progress` exemption" note (it applies to cascades from `auth.users`/`api_keys`).

**Verify block** (analog tail): catalogue only, constraint named by `conname`, and it deliberately does NOT assert grants, RLS flags, FK delete actions or CHECK bodies, because asserting what the SQL gate mutates would abort the mutated apply:
```sql
DO $verify$
BEGIN
  IF to_regclass('public.api_key_nav_marks') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261029120000 failed: public.api_key_nav_marks is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'api_key_nav_marks_key_day_key'
                    AND conrelid = 'public.api_key_nav_marks'::regclass
                    AND contype = 'u') THEN
    RAISE EXCEPTION '...';
  END IF;
  RAISE NOTICE 'Migration 20261029120000: ...';
END
$verify$;
```
Expiry: `expires_at` column and an opportunistic app-side delete. No `cron.schedule`, no data-reading `DO` block. Pick the migration timestamp later than the newest on disk (`20261029120000_api_key_nav_marks.sql` when mapped; re-measure at PR time).

---

### `supabase/migrations/down/<ts>-rollback.sql` (migration, manual rollback)

**Analog:** `supabase/migrations/down/20261029120000-rollback.sql`. Copy its structure: a long header (psql `--single-transaction -v ON_ERROR_STOP=1`, what it undoes, the ledger-row warning), `SET LOCAL lock_timeout`, a catalogue-only `$precondition$` DO block refusing on a database that does not carry the migration or already has a `*_rolled_back_<date>` table, `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, `ALTER TABLE ... RENAME TO ..._rolled_back_<date>` plus renaming the primary key / owned names so the migration can re-apply, then a catalogue-only `$verify$` block. It KEEPS data (never `DROP TABLE`). For transient trade windows the founder may prefer a plain DROP; make that an explicit decision in the plan, not a copy-paste.

---

### `supabase/tests/test_allocator_trade_reads.sql` (NEW SQL gate, CRUD)

**Analog:** `supabase/tests/test_api_key_nav_marks.sql` (686 lines, 11 arms).

**Structure to copy:**
1. Header comment with Background, an arm list ("LISTED and EXECUTED in this order; the order is LOAD-BEARING"), the ANTI-GREEN-SKIP CONTRACT ("Absence of the table is an EXCEPTION, never a skip"), the SENTINEL paragraph (`ALL N ARMS EXECUTED`), and "every `TEST FAILED (N)` raise sits DIRECTLY in the DO body" (the mutation runner reads an identity only from a single-frame `inline_code_block` raise; helpers return values and never raise an identity).
2. `-- RED-UNDER-SETUP: {"apply":[ ...fixtures and migrations... ]}` single-line JSON listing the pg-lane fixtures and the prerequisite migrations in order, ending with the new migration. Copy the NAV-marks list and add the new migration as the last entry; keep `07-fixture-supabase-default-privileges.sql` (it is what makes every REVOKE falsifiable).
3. `BEGIN;` ... `ROLLBACK;` wrapping pg_temp helpers (`pg_temp.nm_user()`, `pg_temp.nm_key(p_user)`, `pg_temp.nm_try(p_row jsonb)` returning NULL or `SQLSTATE|message`) and one `DO $$ ... $$` with arms.
4. Each arm: a prose `RED-UNDER:` paragraph plus a one-line machine twin `RED-UNDER-M: {"arm":"N","apply":[{"kind":"edit","file":"supabase/migrations/<ts>_allocator_trade_reads.sql","find":"...","replace":"...","occurrences":1}]}`. Schema: `scripts/mutation-runner/GRAMMAR.md`. Every twin edits the migration that DEFINES what it mutates and must leave the migration's verify block satisfied so the mutated apply succeeds.

**Arm shapes to copy** (all from the analog):
- Privilege refusal with the message pinned (arm 5): RLS refusal also answers 42501, so pin the text.
```sql
v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01'));
IF v_out IS NULL OR v_out NOT LIKE '42501|permission denied for table api_key_nav_marks%' THEN
  RAISE EXCEPTION 'TEST FAILED (5): authenticated INSERT answered %, expected 42501 permission denied for the table', COALESCE(v_out, 'no error (the row was stored)');
END IF;
```
  For the new tables: anon and authenticated each get SELECT and INSERT refused by privilege (no owner read exists); twin: `GRANT SELECT ON ... TO authenticated`.
- Role switching: `SET LOCAL ROLE service_role; ... RESET ROLE;` and `PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);`.
- Key-delete cascade through the app path (arm 6): `PERFORM public.delete_allocator_api_key(v_k, false);` as the owning authenticated user, then assert zero rows; twin changes `ON DELETE CASCADE` to `ON DELETE RESTRICT` on the exact find string.
- Auth-user cascade (arm 7): `DELETE FROM auth.users WHERE id = v_u;`.
- Named CHECKs (arm 10): each refusal is 23514 naming its own constraint (a `FOR v_case IN SELECT * FROM (VALUES ...)` loop); also insert the legitimate shapes first so the checks are shown not over-strict.
- Service_role CAN update and delete here (the opposite of NAV-marks arms 3 and 4): write the positive arm, with a twin that removes UPDATE or DELETE from the grant.
- Catalogue arm (arm 11): `has_table_privilege` matrix loop over `anon`, `authenticated`, `service_role` x `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` with `v_want` computed per role; `relrowsecurity` and `relforcerowsecurity`; zero rows in `pg_policy` for the table.
```sql
FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    v_want := ...;
    v_got := has_table_privilege(v_role, 'public.api_key_nav_marks', v_priv);
    IF v_got IS DISTINCT FROM v_want THEN
      RAISE EXCEPTION 'TEST FAILED (11): % % on api_key_nav_marks is %, expected %', v_role, v_priv, v_got, v_want;
    END IF;
  END LOOP;
END LOOP;
```
5. Foot: `RAISE NOTICE 'ALL N ARMS EXECUTED (1,2,...,N): ...';` immediately before `ROLLBACK;`. Every identity carries a digit. Seed data synthetic only (generated uuids, `@invalid.local` emails, invented 2026 dates). pgTAP is not installed.

---

### Census files a new `supabase/tests` file and a new table move (RESEARCH section 8)

All values below were read on 2026-10-27 and WILL move; re-measure at PR time by symbol or by running the runner, never copy a number from this file.

| File | What moves | Analog (the NAVMTM edit to mirror) |
|---|---|---|
| `scripts/mutation-floors.mjs` | `FILES_FLOOR` (read 80, line 1309), `ARMS_FLOOR` (read 803, line 3292), `WAIVED_CEILING` stays 0 (line 3406). Add a dated "RAISED" comment entry beside each, with the runner's measured output (`coverage: files X/Y`, per-file `sections N / judged N / annotated N / waived 0 / biting N`). | the "RAISED 79 -> 80 2026-10-26 (Phase 167.2.1.1.1 NAVMTM plan 02)" and "RAISED 792 -> 803" comment blocks near lines 1301 and 3288 |
| `.github/workflows/ci.yml` | `sql-tests` sentinel roster: add `#   test_allocator_trade_reads.sql   N` to the contiguous, equally indented table (about line 4915-4925, rows in file-name order); move `SENTINEL_FLOOR` and its arms floor; add a dated "Re-measured" paragraph in the comment block that follows (about lines 5120-5150). Prose goes ABOVE the table, never between rows (`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` reads the rows as a contiguous block). | the `test_api_key_nav_marks.sql 11` row and the "Re-measured 2026-10-26 (Phase 167.2.1.1.1 NAVMTM, plan 02)" paragraph |
| `src/__tests__/mutation-runner-floors.test.ts` | file count, arm count, per-file line pins | the NAVMTM-era values |
| `src/__tests__/mutation-annotation-parser.test.ts` | `armsSeen`, `stepsSeen`, file count | same |
| `src/__tests__/lint-sql-gates.test.ts` | `lint-sql-gates: scanned N file(s)` | same |
| `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/drift-check-scripts.test.ts` | floor mirrors; roster comment (drift-check-scripts has a NAVMTM comment near line 5031) | same |
| `scripts/check-gdpr-export-coverage.ts` | add BOTH tables to the CASCADE-erasure allowlist object with a dated comment and a `reason:` string | `api_key_nav_marks: { reason: "..." }` entry at line 402 with the comment block above it (lines 391-401) |
| `src/lib/database.types.ts` | hand-add the two tables (Row/Insert/Update/Relationships); the file's own comment says a regen against PROD drops them until the migration applies | the `api_key_nav_marks` block at line 343 (comment at 336-342); list only the `api_keys` foreign key, not FKs into `auth` |
| `src/lib/gdpr-export-manifest.ts` | NO row for an allowlisted table. The existing NAV-marks `{ kind: "direct", table: "api_key_nav_marks", user_column: "allocator_id" }` (line 649) exists because that table is owner-readable and carries `allocator_id`. The new tables have neither. | n/a |
| `supabase/schema/baseline.sql`, `BASELINE.md`, `baseline-carried-migrations.txt` | re-dump AFTER the PROD apply, in the follow-up `chore(release)` commit that also regenerates the marker (`## Regenerating` in `BASELINE.md`) | commit `53f25ac3e` |
| `CHANGELOG.md`, `VERSION`, `package.json` | ship commit; byte-equal 4-digit strings; never `npm version`; enumerate every commit then cross-check themes (CLAUDE.md "CHANGELOG discipline"); never write a CI skip token in a commit message or PR body | CLAUDE.md |

Post-deploy handoff text that names the refusal tokens lives under `.planning` (ACCTREBUILD plans 06/07/09 SUMMARY and PLAN files, `167.2.1.1.2-DESIGN-INPUT-upnlvenues-*.md`, and the TRADEPAGES runbook text). These are planning artefacts: update them in the planning commit, not in the ship branch (a ship branch must change nothing under `.planning`).

---

## Shared Patterns

### Closed vocabulary, one change in four places
**Source:** `analytics-service/services/equity_reconstruction.py` lines 2188-2213 and `tests/test_reconstruct_force_rebuild.py::test_forced_rebuild_refusal_reasons_are_a_closed_set`.
**Apply to:** the new stalled-read token only.
A new token moves, together: the frozenset and its "these 15 tokens" comment, the pin test (`account` set, `len(...) == 15`, docstring), `test_the_two_year_refusal_adds_no_token`, the probe vocabulary test, and the post-deploy handoff text. The raise literal must be double-quoted at the raise site.

### Counts-only, static-text logging (H-3)
**Source:** `_crawl_whole_account` WARNINGs (lines 5347-5351, 5375-5380) and the Bybit window WARNINGs (lines 699-722).
**Apply to:** every new log line, `p_reason`, `last_error`, refusal text.
```python
logger.warning(
    "reconstruct_allocator_history account crawl failed "
    "allocator=%s key=%s venue=%s exc_class=%s",
    allocator_id, key.get("id"), _key_venue(key), type(outcome).__name__,
)
```
Class names and integers only. Never `logger.exception` (it embeds signed URLs). Tests plant a signature in `row["info"]` and assert it never reaches a record.

### Nothing is written until the read is whole (ACCTREBUILD D-02)
**Source:** the placement of the crawl before the persist half in `run_reconstruct_allocator_history_job` (the comment at lines 5588-5589 and the refusal arm at 5590-5596: "Nothing has been persisted (this is before the persist half and the marker writer)").
**Apply to:** the deferral arm and the stall refusal. Both return before `replace_equity_snapshots_window` and the marker loop. Test: `_book_state(fake) == before` after a deferred claim (see the sibling-DEFERRED test pattern above).

### Claim-token-fenced deferral that tolerates a watchdog reclaim
**Source:** `okx_archive_job._defer_job` (lines 1092-1131) and `job_worker._defer_lost_ownership` (line 1243: SQLSTATE `55006` or the RPC's own message text).
**Apply to:** the one `defer_compute_job` call this phase adds.

### SQL gate integrity
**Source:** `supabase/tests/test_api_key_nav_marks.sql` header (lines 1-100).
**Apply to:** the new gate. Every arm annotated `RED-UNDER` and `RED-UNDER-M`; `WAIVED_CEILING` stays 0, do not add a waiver; absence of the table is an EXCEPTION, never a skip; floors read by symbol from `scripts/mutation-floors.mjs`, never restated from prose.

### Service-role-only table access
**Source:** the NAV-marks migration STEP 4 (`REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role` then explicit `GRANT`). service_role has BYPASSRLS, so a policy cannot gate it; the control is the table privilege (ADR-0001/0003). FORCE RLS plus no anon/authenticated policy and no anon/authenticated grant.

## No Analog Found

| File / piece | Role | Data Flow | Reason |
|---|---|---|---|
| `analytics-service/services/trade_read_store.py` (as a whole) | service (store) | CRUD | No existing module persists per-window venue reads. Compose from the `db_execute` closure idiom, the `ContextVar` precedent in `services/exchange.py`, and the fake client's capabilities. Use RESEARCH sections 1, 2, 4, 5 and Code Example B as the design source. |
| the stalled-claims counter and soft budget | service | event-driven | `okx_archive_job` has the backstop and claim-budget shapes (copied above) but no per-key stalled counter; RESEARCH section 5 designs it. Do not overload `set_compute_job_progress` (it merges into `metadata->'member_progress'`, which the stitch poll route reads as an array). |

## Pitfalls the planner should carry into plan actions (from reading the code)

- `equity_reconstruction.py` does not import `_defer_lost_ownership`; add it to the `from services.job_worker import (...)` list (lines 73-84), or put the defer helper in `trade_read_store.py` with a lazy import. Do not import `okx_archive_job`.
- The Bybit continuation must keep `window_age_days` WARNING wording stable: `test_a_venue_that_repeats_its_page_ends_the_read_with_one_warning` asserts `venue in message` and `"100" in message`.
- `_AnchorPartialSet` and the `ContextVar` default: use `default=None`, never a mutable shared default (the `exchange.py` comment records the cross-task leak).
- The probe's `ACCOUNT_RECORD_KEYS` and `_ACCOUNT_VALIDATORS` must change in lockstep; `validate_record` refuses unknown keys.
- A new `supabase/tests` file moves several censuses at once; grep every one (`grep -a`) and re-measure by running `node scripts/mutation-runner/run.mjs` on a throwaway local lane, never against TEST or PROD.
- Migration merge auto-applies to TEST then PROD with no human stop: migration-reviewer and rls-policy-auditor must be clean before merge; no data-reading `DO` block.

## Metadata

**Analog search scope:** `analytics-service/services`, `analytics-service/scripts`, `analytics-service/tests`, `supabase/migrations` (+ `down/`), `supabase/tests`, `scripts/`, `src/__tests__`, `src/lib`, `.github/workflows/ci.yml`.
**Files read:** about 20 (the two phase documents plus the analogs above); large files (`equity_reconstruction.py`, `okx_archive_job.py`, `job_worker.py`, the probe, the NAV-marks gate) were read in targeted non-overlapping ranges.
**Tracked-source gate:** all named analog paths are git-tracked (checked with `git ls-files` for the Python, SQL and TS analogs; no `.gsd/capabilities` mirrors involved).
**Pattern extraction date:** 2026-10-27
