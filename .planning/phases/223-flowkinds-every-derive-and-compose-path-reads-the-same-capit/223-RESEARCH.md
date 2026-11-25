# Phase 223: FLOWKINDS - Research

**Researched:** 2026-11-24
**Domain:** analytics-service Python worker (ccxt funding reads, `compute_jobs` retry semantics, pytest/mypy gates). No new packages.
**Confidence:** HIGH for the code mechanics (every claim below was read in this session); MEDIUM for the C27 attempt arithmetic (the upsert latency is unmeasured).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Ruling 1, `okx_archive_job` and a malformed live funding row: "Stop by name (Recommended)". `_live_reference` calls `fetch_funding_okx(..., on_malformed="raise")` and turns `FundingRowsMalformed` into `_Stop("live_anchor_unusable", "live_funding=malformed")` before any write. Reversibility: costly (the stop decides whether an operator-run rebuild publishes a series; live funding feeds `rebuild_union` and the rolled NAV anchor on live-only days that the cent-level reconciliation does not cover).
- Ruling 2, FLOWK-03 and a malformed realized row: "Keep flagging (Recommended)". Phase 186 D-12 stays: the `daily_pnl_malformed_<venue>` flag is recorded and the key is not refused. No code adds a realized-row refusal in this phase.
- Ruling 3, C27, the Bybit `sync_funding` walk over budget: "Yes, 223 fixes it". The walk must fit its budget, or be restructured so it fills the table, without hiding a timeout.
- `run_sync_funding_job` keeps the default `on_malformed="drop"` (WARNING log), pinned by a test that fails if the caller starts raising or stops dropping. Reason: no published number reads `funding_fees`; refusing would also starve the table (a refused walk stores nothing, the cursor never moves, the job would refuse daily). Revisit when a published reader of `funding_fees` appears.
- F-2 (founder 2026-11-23, unchanged): `[186-OTHER-FUNDING-CALLERS-DROP]`'s composite caller is recorded in the ship as out of scope by F-2, not as fixed.
- [C27] `run_sync_funding_job` walks the Bybit range one 7-day window at a time (`fetch_funding_bybit` gains an optional end bound), reading both categories per window and upserting after each window, oldest first, so the max-timestamp cursor only advances over ranges already stored and the next attempt resumes there. No schema, no migration; local to the handler and one fetcher keyword.
- [C27] No self-deadline. The handler timeout stays the only stop, so a walk still over budget fails as "Handler exceeded timeout" and is retried; each attempt keeps what it stored.
- [C27] Category order inside a window: linear then inverse inside the same window, before that window's upsert (the per-strategy cursor is shared by both categories).
- [PROOF-01] One test per caller drives a malformed row through the real caller with the fetcher's walk mocked at the exchange call, plus a C27 test that a cancelled walk keeps the windows it finished; each goes RED on a neutered copy and GREEN after cp/cmp restore. Test-only.

### Claude's Discretion
- Test file placement, the exact `_Stop` detail wiring and the fetcher keyword's name.

### Deferred Ideas (OUT OF SCOPE)
- A realized-row refusal (ruling 2 keeps D-12; nothing to build).
- The composite member funding read (F-2).
- Out of scope by CONTEXT: `run_stitch_composite_job` and its member funding read; Phase 232's symbols (`run_sync_trades_job`, OKX trade reads, the OKX bills reader in `services/exchange.py`); any refusal of a malformed REALIZED row, including `okx_archive_job._check_live_realized_flags`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLOWK-02 | `run_sync_funding_job` and `okx_archive_job` each have a recorded, test-pinned decision to refuse a malformed funding row by name or keep dropping it | Sections "OKX archive job mechanics" and "sync_funding drop pin"; decision tests and neuter edits in Validation Architecture. C27 (ruling 3) rides in this phase: section "C27 design". |
| FLOWK-03 | The per-key PROD count of `daily_pnl_malformed_<venue>` flags is recorded read-only and the founder's ruling is recorded before any realized-row refusal | Count already recorded in `223-PROD-MALFORMED-COUNT.md` (0 on every measured key and strategy; 2 Bybit `key_inputs` rows and Bybit keys with no derived row are not measured). Ruling 2 recorded in CONTEXT and ROADMAP. Existing pin `test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing` keeps D-12 true (section "FLOWK-03"). Pointer fixes in "TODOS pointers". |
</phase_requirements>

## Summary

The phase is three small code changes plus tests, and every mechanic the planner needs is already read. (1) `_live_reference` in `services/okx_archive_job.py` gets `on_malformed="raise"` plus one `except FundingRowsMalformed` that raises the existing `_Stop` class `live_anchor_unusable`. `_within` does not convert the exception, and the handler's outer `try` catches only `_Stop` and ccxt rate limits, so the mapping MUST live in `_live_reference` or the exception falls through to the dispatcher's generic classification. No stop class is added, so the closed-set pins stay untouched. (2) `run_sync_funding_job` keeps its drop default and gets a per-venue pin. (3) C27 is the only design-heavy part: a per-window walk for Bybit with one upsert per window.

C27 has one hazard the locked design does not name, and the plan must prescribe it. The cursor is the MAX stored timestamp minus 2 days. A window holds about 1,250 rows at the probe's density (65,522 rows over 53 windows, about 3 upsert batches of 500). If a window's rows are upserted newest-first, a cancel between batches leaves the newest rows stored and the older ones unstored, and the next attempt starts only 2 days before the newest, so those rows are never re-read. The fix is handler-side and needs no shared-helper change: sort each window's rows ascending by timestamp, upsert them in `FUNDING_UPSERT_BATCH_SIZE` slices through the unchanged `upsert_funding_rows`, and stop the walk at the first slice that reports an error. Then the stored set is always a strict time prefix and "the cursor only advances over stored ranges" is true.

A first walk needs at least three attempts (379 s over a 180 s budget), which equals the default `max_attempts` of 3, so there is no headroom. The honest statement for the plan: "three attempts at best; otherwise the next day's cron job finishes it from the stored cursor; SC-5 holds either way".

**Primary recommendation:** Add keyword-only `until_ms: int | None = None` to `fetch_funding_bybit` (default behaviour byte-identical, so the 231 C27 pin stays green), add one public window helper beside it, restructure `run_sync_funding_job` into a per-window fetch, ascending sort, sliced upsert, stop-at-first-error loop for Bybit only, and leave OKX and Binance as they are.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Malformed live funding row refusal (ruling 1) | API / Backend (analytics worker, `okx_archive_job`) | Database / Storage (result block via `set_compute_job_progress`) | The worker decides before any write; the stop is recorded in `last_error` and the result block. |
| `sync_funding` drop decision (pin only) | API / Backend (analytics worker, `run_sync_funding_job`) | Database / Storage (`funding_fees`) | Behaviour is unchanged; a test pins it. |
| C27 per-window walk and upsert | API / Backend (worker) | Database / Storage (`funding_fees` is the cursor) | The cursor lives in the table; no schema change. |
| Daily enqueue | Frontend Server (Vercel cron route `src/app/api/cron/sync-funding/route.ts`) | Database (`enqueue_compute_job`) | Untouched. Daily 04:00 UTC enqueue is what resumes a walk after `failed_final`. |
| Retry and backoff | Database / Storage (`mark_compute_job_failed`) | API / Backend (`dispatch` timeout classification) | Retry count and backoff live in SQL; the worker only classifies the timeout as transient. |

## Standard Stack

### Core (all already in the repo; nothing is installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | pinned `ccxt==4.5.89` [VERIFIED: `analytics-service/requirements.txt:33`, quote `ccxt==4.5.89`] | Exchange calls (`private_get_v5_account_transaction_log`, `private_get_account_bills`) | Already the project's exchange layer; tests mock the exchange call. |
| pytest, pytest-asyncio | `pytest<9.2`, `asyncio_mode = auto` [VERIFIED: `analytics-service/requirements-dev.txt:43`, `analytics-service/pytest.ini`] | Test runner | Existing. |
| mypy | `--strict` over the CI path set (below) | Type gate | Existing CI gate. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Handler-side window loop (locked) | A callback parameter on `walk_paginated` | Larger change to a shared driver used by four other fetchers; the locked decision names an end-bound keyword instead. |
| Handler-side sliced upsert | New `stop_on_error` flag on `upsert_funding_rows` | The helper's continue-past-error behaviour is pinned by `TestUpsertFundingRowsErrors::test_partial_batch_failure_records_error_continues`, and `scripts/backfill_funding.py` shares it. Slicing in the handler leaves the helper alone. |

**Installation:** none. **Version verification:** no package is added or bumped, so there is no registry check to run.

## Package Legitimacy Audit

No external package is installed by this phase. Packages removed due to SLOP: none. Packages flagged SUS: none.

## Architecture Patterns

### System Architecture Diagram

```
Vercel cron 04:00 UTC --enqueue_compute_job(kind=sync_funding)--> compute_jobs
                                                                    |
              claim (attempts += 1) --> dispatch(job) --asyncio.wait_for(handler, 180 s)
                                                                    |
                          run_sync_funding_job
   _exchange_preflight -> read newest funding_fees.timestamp -> since_ms = newest - 2 d (None if empty)
        |
        +-- binance / okx : ONE fetch (since_ms, default on_malformed="drop") --> ONE upsert after the walk (unchanged)
        |
        +-- bybit : windows = bybit_funding_windows(since_ms, now_ms)   (None -> now - 365 d, 7-day windows, +1 ms seam)
              for each window, OLDEST first:
                  fetch_funding_bybit(ex, sid, w_start, until_ms=w_end)  -> linear then inverse for that window
                  sort rows ascending by timestamp
                  upsert in 500-row slices; first slice with errors -> return FAILED transient (stop)
              |
        timeout at any await --> CancelledError into handler --> finally closes exchange
              --> dispatch: TimeoutError -> FAILED, error_kind transient, "Handler exceeded timeout"
              --> mark_compute_job_failed: failed_retry (+30 s, +2 min) until attempts = 3, then failed_final
              --> windows already upserted PERSIST; next attempt / next day resumes at newest stored - 2 d
```

```
okx_archive_rebuild (calibrate | apply) --> _run_evaluation --> _evaluate --> _live_reference
    equity -> realized -> flags check -> fetch_funding_okx(..., None, on_malformed="raise")
        FundingRowsMalformed --> _Stop("live_anchor_unusable","live_funding=malformed")
        --> run_okx_archive_rebuild_job: except _Stop --> _finish_stop
            writes result block FIRST (set_compute_job_progress), returns FAILED permanent
        (nothing downstream ran: no _reconcile, no _d03_check, no apply RPC)
```

### Recommended change set (by symbol)

```
analytics-service/services/okx_archive_job.py   _live_reference (+ one import)
analytics-service/services/funding_fetch.py     fetch_funding_bybit (until_ms), bybit_funding_windows (new, public)
analytics-service/services/job_worker.py        run_sync_funding_job (+ one small private helper for the sliced store)
analytics-service/tests/                        new decision tests + deliberate updates listed below
```

### Pattern 1: OKX archive job, ruling 1 (mechanics read in this session)

- `_within(budget, work, *, step, cap)` wraps `asyncio.timeout`. It converts only its own expiry into `_Stop("claim_budget_exceeded", ...)`; any other exception, `FundingRowsMalformed` included, propagates untouched (docstring: "A `TimeoutError` the work raises on its own account is NOT the budget's: it propagates untouched"). [VERIFIED: `services/okx_archive_job.py::_within`]
- The handler `run_okx_archive_rebuild_job` wraps `_check_account` through `_run_evaluation` in `try: ... except _Stop as stop: return await _finish_stop(...)` and `except (ccxt.RateLimitExceeded, ccxt.DDoSProtection)`. A `FundingRowsMalformed` that escapes `_live_reference` is neither, so it would leave the handler and reach `dispatch`'s generic `classify_exception` with no result block written. That is the failure the neutered copy must show. [VERIFIED: `run_okx_archive_rebuild_job`]
- `_Stop.__init__` asserts the class is in `STOP_CLASSES`. `live_anchor_unusable` is a member and is NOT in `TRANSIENT_STOP_CLASSES`. Quoted verbatim: `"live_anchor_unusable",` inside `STOP_CLASSES`, and `TRANSIENT_STOP_CLASSES` is `{"link_expired", "live_fetch_failed", "claim_budget_exceeded"}`. [VERIFIED: `services/okx_archive_job.py:156-191`] So the stop is permanent (`error_kind="permanent"`), no class is added, and `tests/test_okx_archive_job.py` line 1953's closed-set equality and line 1964's transient-set equality stay untouched.
- `_finish_stop` sets `result["stop_class"]`, logs a WARNING, writes the result block FIRST through `_write_result` (RPC `set_compute_job_progress`), then returns `DispatchResult(FAILED, error_message="okx_archive_rebuild: live_anchor_unusable live_funding=malformed", error_kind="permanent")`. `_error_text` is `f"{KIND}: {stop_class}" + (f" {detail}" ...)` with `KIND = "okx_archive_rebuild"`. [VERIFIED: `_finish_stop`, `_error_text`]
- Calibrate and apply both reach `_live_reference`: `_run_evaluation` calls `_evaluate` for both modes, and `_evaluate` calls `_live_reference` as its first statement; the apply RPCs run only after `_evaluate` returns (`_apply_targets`). Preflight stops earlier and never evaluates. `_evaluate`'s docstring states every stop there is "raised BEFORE any write". [VERIFIED: `_run_evaluation`, `_evaluate`]
- `_live_reference` is the only call to `fetch_funding_okx` in `okx_archive_job.py`.
- `_Stop.detail` rule: "dates and counts only: never venue text". `live_funding=malformed` is a fixed literal of the same shape as `live_realized=truncated`. Drop the exception text (`from None`); `FundingRowsMalformed`'s message already carries venue and count only, but the stop must not depend on that.

```python
# Source: services/okx_archive_job.py::_live_reference (current shape) + ruling 1
from services.funding_fetch import FundingRowsMalformed, fetch_funding_okx

try:
    funding = await _within(
        budget,
        fetch_funding_okx(exchange, api_key_id, None, on_malformed="raise"),
        step="live_funding", cap=_BROKER_CRAWL_TIMEOUT_S,
    )
except FundingRowsMalformed:
    raise _Stop("live_anchor_unusable", "live_funding=malformed") from None
```

A page-ceiling raise (`FundingFetchCeilingExceeded`) from the same call is also uncaught in `_live_reference` today and takes the generic path. It is not part of ruling 1; do not widen scope, but note it in the SUMMARY as an observation.

### Pattern 2: C27, per-window Bybit walk (mechanics read in this session)

`walk_paginated` (`services/exchange_pagination.py`):
- Categories are the OUTER loop and windows the inner loop. A single fetch therefore walks all linear windows, then all inverse windows. That is why one per-window call (a fresh `walk_paginated` over one window) is needed to get "both categories per window".
- `_windows(start, now_ms, window_max_days)`: `w_end = min(w_start + window_ms, now_ms)`, then `w_start = w_end + 1`, loop `while w_start < now_ms`. `since_ms=None` with `default_lookback_days` starts at `now_ms - default_lookback_days * 86400000`. [VERIFIED: `_windows`, `walk_paginated`]
- Page ceiling is `page_cap` per (inst_type x window), and the ceiling raises `FundingFetchCeilingExceeded`. The ceiling count restarts per window, so the per-window call changes nothing about it.
- Per-window calls reproduce today's request sequence exactly. A handler window `(w_start, w_end)` has `w_end - w_start <= 7 d`, so `fetch_funding_bybit(..., since_ms=w_start, until_ms=w_end)` runs `_windows(w_start, w_end, 7)`, which yields the single pair `(w_start, w_end)`, then `w_end + 1` is not `< w_end` and it stops. The `+1 ms` seam between handler windows is the same seam `_windows` already bakes in. A test must pin this (window list from the helper equals the window list one big walk would use).
- First walk window count: 53 (the C27 pin comment reads "2 x 53 = 106"). [VERIFIED: `tests/test_bybitreads_census_pins.py`]

`fetch_funding_bybit` today computes `now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)` once and passes it to `walk_paginated(contract, since_ms=since_ms, now_ms=now_ms, ...)`. The keyword is keyword-only after `*`, next to `on_malformed: Literal["drop", "raise"] = "drop"`. [VERIFIED: `services/funding_fetch.py:652-658`] Recommended name: `until_ms` (it mirrors `since_ms`; the walker's `now_ms` stays internal).

```python
# Source: proposed change to services/funding_fetch.py
async def fetch_funding_bybit(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
    *,
    on_malformed: Literal["drop", "raise"] = "drop",
    until_ms: int | None = None,   # None = now (every existing caller)
) -> list[FundingFeeRow]:
    now_ms = (
        int(datetime.now(timezone.utc).timestamp() * 1000)
        if until_ms is None else until_ms
    )
    ...

def bybit_funding_windows(since_ms: int | None, now_ms: int) -> list[tuple[int, int]]:
    """The exact (start, end) pairs one full walk would use, oldest first."""
    start = (
        since_ms if since_ms is not None
        else now_ms - BYBIT_FUNDING_DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    )
    return [(s, e) for s, e in _windows(start, now_ms, 7) if s is not None and e is not None]
```

Rules for the plan:
- The handler never passes `until_ms` together with `since_ms=None`. The fetcher's own `None` default (365 days back from its `now`) stays untouched, so the 231 C27 pin (`fetch_funding_bybit(exchange, "s", None)` sends at least 106 requests) stays true without an edit, and `TIMEOUT_PER_KIND["sync_funding"] == 180` is pinned by the same test, so the budget must not be raised.
- A public helper beats importing the private `_windows` into the handler, and it keeps the 365-day lookback decision in one file.
- `scripts/bybit_reconcile.py`, `scripts/bybitreads_probe.py`, `scripts/derivegaps_probe.py`, `scripts/walletoffset_probe.py` and the derive and composite callers in `job_worker.py` call the fetcher with positional `(exchange, label, since_ms)` and optionally `on_malformed=`. A keyword-only addition with a default breaks none of them.

Handler shape (Bybit branch only; OKX and Binance keep one fetch and one upsert):

```python
# Source: proposed change to run_sync_funding_job (sketch, not final code)
if exchange_name == "bybit":
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    windows = bybit_funding_windows(since_ms, now_ms)
    for w_start, w_end in windows:                      # oldest first
        rows = await fetch_funding_bybit(ctx.exchange, strategy_id, w_start, until_ms=w_end)
        failed = await _store_funding_window(ctx.supabase, strategy_id, rows)
        if failed is not None:
            return failed                                # FAILED transient, walk stops
```

`_store_funding_window` (private, in `job_worker.py`): returns `None` on an empty window; otherwise `rows.sort(key=lambda r: r["timestamp"])`, then for each `FUNDING_UPSERT_BATCH_SIZE`-sized slice calls the unchanged `upsert_funding_rows(supabase, slice)` (lazy import inside the function, the pattern the file already uses so `patch("services.funding_fetch.upsert_funding_rows")` keeps working), and on the first slice whose `errors` list is non-empty logs each error with the strategy id (the H-1115 log shape) and returns the same `DispatchResult(FAILED, error_kind="transient", error_message="sync_funding: N upsert batch(es) failed: [...]")` the handler returns today. Keep the unsupported-exchange `FAILED permanent` check BEFORE the loop and keep `try/except ccxt.RateLimitExceeded` (stamp 429, re-raise) and `finally: aclose_exchange` around the whole loop; the exchange must stay open until the last window.

Why sort, why slice, why stop (the invariant). The cursor is `max(funding_fees.timestamp)` for the strategy, minus `FUNDING_CURSOR_OVERLAP_DAYS` (value: `FUNDING_CURSOR_OVERLAP_DAYS: Final[int] = 2` [VERIFIED: `services/job_worker.py:3027`]). Two failure paths put the newest stored row ahead of unstored older rows inside one 7-day window, which the 2-day overlap cannot cover:
1. A cancel between two upsert batches of one window, when batches are in venue order (newest-first is the typical but unverified order, so do not rely on it: sort).
2. A failed batch followed by a successful one. `upsert_funding_rows` records the error and continues by design.
Ascending sort plus sliced upsert plus stop-at-first-error makes the stored set a strict time prefix in both cases. Ties at the cut are re-read by the overlap. This needs no change to `upsert_funding_rows` or `walk_paginated`.

Cancellation facts (verified by a local probe in this session, Python 3.12): `asyncio.wait_for(handler, timeout)` raises `TimeoutError` (an `asyncio.TimeoutError`), the handler's `finally` runs, work already completed before the cancel is kept, and a blocking call already handed to `run_in_executor` runs to completion after the cancel (output: `finally ran, stored = ['w1', 'w2']`, `raised TimeoutError True ''`, `thread outcome after cancel: ['thread-finished']`). `db_execute` uses `loop.run_in_executor(_DB_EXECUTOR, fn)` and its docstring names the same zombie-thread behaviour. [VERIFIED: local probe; `services/db.py::db_execute`] Consequence: every upsert that returned before the timeout persists, and the one in flight at the instant of the timeout usually persists too; the next slice never starts. `classify_exception` maps `asyncio.TimeoutError` to `("transient", "Handler exceeded timeout: ...")`. [VERIFIED: `services/job_worker.py::classify_exception`]

Retry and attempt arithmetic. `compute_jobs.max_attempts` is `INTEGER NOT NULL DEFAULT 3` [VERIFIED: `supabase/migrations/20260411144407_compute_jobs_queue.sql:122`, quote `max_attempts    INTEGER NOT NULL DEFAULT 3,`] and no enqueue path in `supabase/migrations` sets it (grep for `max_attempts` beside the enqueue functions returned nothing). Claim increments `attempts`; `mark_compute_job_failed` makes the row `failed_final` when `v_attempts >= v_max_attempts`, otherwise `failed_retry` with backoff: `WHEN v_attempts <= 1 THEN ... interval '30 seconds'`, `WHEN v_attempts = 2 THEN ... interval '2 minutes'`. [VERIFIED: `supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql:876-889`] The `sync_funding` handler budget is `"sync_funding": 3 * 60` [VERIFIED: `services/job_worker.py:996`], and the watchdog default of 10 minutes sits above it.

So a first walk of 379 s needs ceil(379 / 180) = 3 attempts at best, and the third attempt is the last (a third timeout is `failed_final`). That is zero headroom: the 379 s probe stored nothing, so about 130 upsert round trips (65,522 rows / 500) are unmeasured on top of it, and each resume re-reads a 2-day overlap. [ASSUMED: upsert latency; ASSUMED: row density even across windows.] State in the plan and the CHANGELOG exactly this: "three attempts at best; otherwise the next day's cron job (04:00 UTC) resumes from the stored cursor and finishes; SC-5 holds either way because every attempt keeps what it stored." Do not claim "a first walk fills the table in N attempts". Once filled, a daily run reads about 2 to 3 windows.

Two behaviours the per-window call changes, to be recorded, not fixed:
- `skip_inst_type` abandons inverse for the REST OF ONE WALK. With a fresh walk per window, a key without inverse scope sends one refused inverse request and logs one WARNING per window (about 53 extra requests and warnings on a first walk, then 2 to 3 a day). Accept; the alternative is a new fetcher parameter, which the locked design avoids. [VERIFIED: `_fetch_page` inverse `BadRequest`/`PermissionDenied` branches and `walk_paginated` `abandon_inst_type`] Whether the one live key lacks inverse scope is unmeasured. [ASSUMED]
- The dropped-row counter is per call, so the WARNING "dropped N malformed rows" repeats per window rather than once per walk. Totals are unchanged.

OKX and Binance: leave as is. Risk note for the SUMMARY only. Both upsert once after the whole walk, so a handler timeout stores nothing for them too, but neither has a measured timeout (the only reading is Bybit's). Do not copy the Bybit loop: OKX pages by `after` id with no time windows (so per-page upserts need a page-order check first, and the OKX walk pages newest-first, so the prefix invariant does not hold), and Binance advances `startTime` per full page. [VERIFIED: `fetch_funding_okx`, `fetch_funding_binance` bodies read]

### Anti-Patterns to Avoid
- **Upserting a window's rows in fetch order.** Breaks the cursor invariant (above).
- **Catching the timeout in the handler and returning DONE.** CONTEXT and SC-5 forbid hiding a timeout.
- **Passing `until_ms` with `since_ms=None`.** Changes the fetcher's lookback anchor and defeats the C27 pin's meaning.
- **A new stop class for the malformed stop.** `live_anchor_unusable` is the ruled class, and the closed sets are pinned.
- **Mocking `fetch_funding_okx` with a fake that raises `FundingRowsMalformed`** as the decision test. It stays green when `on_malformed="raise"` is removed from the call. The decision test must run the REAL fetcher with the bad row at the exchange endpoint.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Window arithmetic with the 1 ms seam | A second `while` loop in the handler | `_windows` (through `bybit_funding_windows`) | One definition of the seam keeps the per-window walk byte-equal to today's walk. |
| Batched upsert on `match_key` | A new upsert helper | `upsert_funding_rows` called per slice | Idempotent (`on_conflict="match_key"`, `ignore_duplicates=True`), already tested. |
| Failure classification | Custom timeout handling | `dispatch` + `classify_exception` | A timeout is already `transient`; do not duplicate it. |
| Malformed-row detection | Re-counting rows in the handler | `FundingRowsMalformed` / `_raise_if_malformed` | Already shared by all three fetchers and the derive. |

**Key insight:** the cursor is the table itself, so persistence order is the whole correctness story for C27.

## Runtime State Inventory

Not a rename or migration phase; omitted. One related note: `funding_fees` rows written by the new windowed walk are the same shape and `match_key` as before, so no data migration exists.

## Common Pitfalls

### Pitfall 1: Window rows persisted out of time order (C27)
**What goes wrong:** a cancel or failed slice leaves newer rows stored and older ones missing, and the 2-day overlap never re-reads them.
**Why it happens:** the cursor is MAX timestamp; the venue's page order is not controlled by us.
**How to avoid:** ascending sort, sliced upsert, stop at first error (above). Pin each with a test.
**Warning signs:** a stored max timestamp newer than a hole; a test that passes without the sort.

### Pitfall 2: Existing pins that fail under the locked design (update them deliberately, by node id)
All three are in `analytics-service/tests/` and all fail because the handler now resolves the Bybit start itself and calls the fetcher once per window:
- `test_job_worker_sync_funding.py::TestRunSyncFundingJob::test_happy_path_calls_upsert_with_rows` (venue bybit; the cursor MagicMock resolves to `None`, so the walk is 53 windows; `mock_upsert.assert_awaited_once()` fails, and its rows carry no `timestamp`, so the ascending sort raises `KeyError`). Preserve the intent "non-empty fetch reaches `upsert_funding_rows` and the result is DONE": give the rows `timestamp` values, use a recent cursor so one window runs, or assert per-window.
- `test_job_worker_funding_cursor.py::TestRunSyncFundingJobCursorWiring::test_since_derived_from_funding_cursor_not_last_sync_at` (`assert_awaited_once()` and `await_args.args[2]` fail on a multi-window walk). Preserve "the start comes from `max(funding_fees.timestamp) - overlap`, never from `last_sync_at`": assert the FIRST call's `args[2]` equals that value and that it differs from the `last_sync_at` value.
- `test_job_worker_funding_cursor.py::TestRunSyncFundingJobCursorWiring::test_empty_funding_table_passes_none_for_backfill` (`args[2] is None` is false once the handler resolves the 365-day start). Preserve "an empty table backfills 365 days regardless of `last_sync_at`": assert the first window starts within a few seconds of now minus 365 days, the windows are contiguous (`next_start == prev_end + 1`), and the last window ends at about now.

The two fixed-signature fakes in `test_okx_archive_apply.py` (`async def _funding(exchange, label, since_ms)` in `_install` and the second one in the budget test) raise `TypeError` on the new `on_malformed` keyword: add `**kwargs` to both. `live.calls.append(("funding", since_ms))` and the assertion `("funding", None) in live.calls` stay valid.

Stay green without edits (verify, do not assume): `tests/test_bybitreads_census_pins.py::test_census_c27_a_first_bybit_funding_walk_is_at_least_106_requests_under_a_180_second_budget` (calls `fetch_funding_bybit(exchange, "s", None)` directly and asserts `TIMEOUT_PER_KIND["sync_funding"] == 180`), all of `tests/test_funding_fetch.py` (positional and `since_ms=` calls; `until_ms` defaulted), `tests/test_job_worker_flipretry.py` (derive path, patches `fetch_funding_bybit` with `AsyncMock(return_value=[])`), and the derive and nav-marks tests that patch `services.funding_fetch.fetch_funding_bybit` with `AsyncMock` (any signature). The census pin's module docstring says "the fix is owned outside this phase": that is prose, not a read of the census file (the file never opens `231-CENSUS.md`; grep for `CENSUS`, `read_text` and `open(` hits only the docstring on line 3), so editing it cannot break the test. Update that docstring sentence in this phase (C27 is now fixed here); do NOT edit `231-CENSUS.md`, which belongs to Phase 231, whose plan 06 is still open. Say "C27 fixed by 223" in 223's SUMMARY and the CHANGELOG instead. Phase 231's pending `231-06-PLAN.md` carries no anchor into `run_sync_funding_job`, `funding_fetch.py` or `okx_archive_job.py` (grep), so `plan-anchor-verify` is not affected.

### Pitfall 3: A decision test that cannot fail
**What goes wrong:** a fake that raises `FundingRowsMalformed` (OKX) or a fetch mock returning clean rows (sync_funding) never exercises the keyword or the drop.
**How to avoid:** mock at the exchange call (below). The fake exchange in the OKX job tests serves `world.answers[<private_ method name>]`, either a value or a callable, so `world.answers["private_get_account_bills"] = {"data": [good, bad]}` and `world.answers["private_get_account_bills_archive"] = {"data": []}` give the real fetcher a malformed row. [VERIFIED: `tests/test_okx_archive_job.py::_FakeExchange.__getattr__`]

### Pitfall 4: Per-window fakes returning the same page for every window
**What goes wrong:** a mocked exchange that ignores `startTime` returns the same rows in every window, so a 365-day walk upserts 53 copies.
**How to avoid:** use a recent cursor (one or two windows) or key the fake on `startTime`. `_bybit_mock_with_fallback` in `test_funding_fetch.py` serves a response list then empty pages; reuse it.

### Pitfall 5: Moving the exchange close
The current handler closes the exchange in `finally` before the upsert. The loop must keep it open until the last window; `ctx.exchange.close.assert_awaited()` is asserted by the existing tests, so keep the `finally`.

### Pitfall 6: Skip-trailer tokens and `.planning` on a ship branch
Never write the CI skip tokens in a commit message or PR body (CLAUDE.md "CI gate integrity"). A ship branch must change nothing under `.planning` (memory: ship planning guard).

## Code Examples

### The OKX decision test (real fetcher, bad row at the exchange)

```python
# Source: pattern from tests/test_okx_archive_apply.py (_install, _run, _no_writes_but_progress)
# and tests/test_funding_fetch.py::TestOnMalformedRaise._okx (row shapes)
from services.funding_fetch import fetch_funding_okx as REAL_FETCH_FUNDING_OKX  # real, captured at import

@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["calibrate", "apply"])
async def test_a_malformed_live_funding_row_is_a_named_stop_with_zero_writes(monkeypatch, mode):
    db = _db_with((STRATEGY_ID, GAP_A))
    world = _install(monkeypatch, db, _standard_live(), q3=_standard_q3())
    monkeypatch.setattr(okx_archive_job, "fetch_funding_okx", REAL_FETCH_FUNDING_OKX)
    good = {"instId": "BTC-USDT-SWAP", "type": "8", "pnl": "-0.01", "ccy": "USDT",
            "ts": "1700000000000", "billId": "ok1"}
    bad = {**good, "instId": "", "billId": "bad1"}      # blank symbol -> dropped by the normalizer
    world.answers["private_get_account_bills"] = {"data": [good, bad]}
    world.answers["private_get_account_bills_archive"] = {"data": []}
    meta = _meta(mode, [STRATEGY_ID], **({"approved_fingerprint": "0" * 64} if mode == "apply" else {}))
    outcome = await _run(meta)
    assert outcome.outcome == DispatchOutcome.FAILED and outcome.error_kind == "permanent"
    assert outcome.error_message == "okx_archive_rebuild: live_anchor_unusable live_funding=malformed"
    assert world.result()["stop_class"] == "live_anchor_unusable"
    _no_writes_but_progress(world, db)
```
Planner must confirm the harness details (`world` is `_World` from `tests/test_okx_archive_job.py`, `answers` lives there; confirm how `_install` in the apply file exposes it, and that the apply-mode input validation accepts the dummy fingerprint, since the stop fires before the fingerprint comparison). The bad row's timestamp is irrelevant (the fake ignores `begin`).

### The sync_funding drop pin (real caller, mocked exchange)

Reuse the row builders in `tests/test_funding_fetch.py::TestOnMalformedRaise` (`_binance`, `_okx`, `_bybit`: one good row and one blank-symbol row). Parametrize over the three venue branches because Bybit becomes a separate code path. Drive `run_sync_funding_job` with `_exchange_preflight` patched to a ctx whose `exchange` is the builder's fake and with `services.funding_fetch.upsert_funding_rows` patched; for Bybit give the cursor a timestamp inside the last 6 days so one window runs. Assert: `DispatchOutcome.DONE`, exactly one row reached the upsert (the good one), the dropped-row WARNING was logged (caplog, text `dropped 1 malformed rows`), and no exception escaped.

### The C27 test (cancelled walk keeps finished windows, then resumes)

Drive `dispatch(job)` with `monkeypatch.setitem(TIMEOUT_PER_KIND, "sync_funding", 0.3)` so the real `asyncio.wait_for` cancels. Patch `services.funding_fetch.fetch_funding_bybit` with an async fake: windows 1 and 2 return rows (datetime timestamps) immediately, window 3 does `await asyncio.sleep(30)`. Patch `upsert_funding_rows` with an `AsyncMock` that records its row lists. Assert: outcome FAILED, `error_kind == "transient"`, message starts `Handler exceeded timeout`; the upsert was awaited exactly twice and the stored rows are windows 1 and 2 in ascending order. Then run again with the cursor mock returning the newest stored timestamp: the first fetch's `since_ms` equals that timestamp minus `FUNDING_CURSOR_OVERLAP_DAYS` in ms, the later windows are contiguous, and the walk ends at about now (resume, not restart). Add a separate fetcher-level test that `until_ms` bounds the request: with `until_ms = since_ms + 3 days` every request's `endTime == until_ms` and exactly one window runs.

## State of the Art

Not applicable (internal code). One historical note: Phase 186 D-05 introduced `on_malformed="raise"` for the derive (`run_derive_broker_dailies_job` maps `FundingRowsMalformed` to the named refusal `funding_rows_malformed`); ruling 1 applies the same keyword to the archive job's live read.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Upsert latency of about 130 round trips is small enough that three 180 s attempts can cover a 379 s read-only walk | C27 attempt arithmetic | The first walk needs a fourth attempt; next day's cron finishes it. No data loss, only latency. State "three at best". |
| A2 | Row density is roughly even across the 53 windows | C27 attempt arithmetic | A dense early window could make one window alone approach the budget; a single window over the page ceiling (10,000 rows per category) fails every day (`FundingFetchCeilingExceeded`) while keeping earlier windows. |
| A3 | The one live Bybit key lacks (or has) inverse permission | per-window inverse cost | About 53 extra refused requests and warnings on a first walk if it lacks it. Cost only. |
| A4 | Bybit returns transaction-log pages newest-first | why the sort exists | None: the design sorts and does not rely on the order. |
| A5 | Slicing inside the handler is acceptable under "fetch_funding_bybit only as far as C27 needs" | C27 design | If the founder wants the stop-on-error inside the shared helper, `upsert_funding_rows` needs a flag and its pinned continue-on-error test must be kept as the default arm. |

## Open Questions (RESOLVED)

1. **Should the sliced store be handler-private or reused by scripts?**
   - What we know: `scripts/backfill_funding.py` shares `upsert_funding_rows` and `FUNDING_UPSERT_BATCH_SIZE`; the prefix invariant matters only to the cursor-driven handler.
   - Recommendation: keep it private to `job_worker.py`. Do not touch the backfill script.
   - RESOLVED (planner, 2026-11-24): private. `223-04-PLAN.md` Task 1 adds `_store_funding_window` to `job_worker.py` directly after `run_sync_funding_job`; no plan touches `scripts/backfill_funding.py` or `upsert_funding_rows`.
2. **Should OKX and Binance `sync_funding` timeouts get a follow-up entry?**
   - What we know: same store-after-walk shape, no measured timeout. Repo rule: LOW and Info review items are not booked in `TODOS.md`.
   - Recommendation: record it in the 223 SUMMARY as an unmeasured risk; book only if a timeout is measured.
   - RESOLVED (planner, 2026-11-24): not booked. `223-04-PLAN.md` Task 3 records it in `223-04-SUMMARY.md` as an unmeasured risk; the OKX and Binance arms stay unchanged.
3. **Is the `_live_reference` ceiling raise worth naming?**
   - Recommendation: no code; one sentence in the SUMMARY.
   - RESOLVED (planner, 2026-11-24): no code. `223-01-PLAN.md` Task 2 records it in `223-01-SUMMARY.md` as an observation; ruling 1 is not widened.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | pytest, mypy | yes (via a venv in the main checkout, not in this worktree) | 3.12 (the CI interpreter per `analytics-service/Makefile`) | `make install` creates `analytics-service/.venv` on 3.12 |
| ccxt | tests that import it | yes, but the available venv has 4.5.85, not the pinned 4.5.89 | 4.5.85 vs `ccxt==4.5.89` | tests mock the exchange call, so the version gap (4.5.85 vs 4.5.89) does not change these tests; run the final gate on a venv built from `requirements.txt` |
| pytest | all tests | yes | 9.1.1 (CI pins `pytest<9.2`) | none needed |
| mypy | type gate | yes | 2.4.0 | none needed |
| Supabase / PROD | none | not needed | | The PROD count was recorded read-only before this research; this phase needs no database access. |

The worktree has no `.venv`. Either create one (`make install` from `analytics-service/`) or point the main checkout's interpreter at the worktree sources; all commands below are relative to `analytics-service/`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`pytest<9.2`) with `asyncio_mode = auto`, `pythonpath = .` [VERIFIED: `analytics-service/pytest.ini`] |
| Config file | `analytics-service/pytest.ini` |
| Quick run command | `python -m pytest <files> -q -p no:cacheprovider` (run from `analytics-service/` only) |
| Full suite command | `python -m pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (the CI `python` job step, [VERIFIED: `.github/workflows/ci.yml` pytest step]) |
| Type gate | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` [VERIFIED: `.github/workflows/ci.yml:5714-5715`, quote `run: mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`]. Baseline at HEAD run this session: `Success: no issues found in 142 source files`. Tests are outside the mypy path set. |

Measured this session at HEAD, with an interpreter from the main checkout: `tests/test_job_worker_sync_funding.py tests/test_job_worker_funding_cursor.py tests/test_bybitreads_census_pins.py tests/test_funding_fetch.py` gave `88 passed in 34.08s` (about 30 s of that is import and collection overhead per invocation). Always `grep -a` when reading these files.

Relevant file set for the quick command: `tests/test_job_worker_sync_funding.py tests/test_job_worker_funding_cursor.py tests/test_funding_fetch.py tests/test_bybitreads_census_pins.py tests/test_okx_archive_apply.py tests/test_okx_archive_job.py tests/test_daily_pnl_read_verdict.py` (add the new test files).

### Phase Requirements to Test Map

| Req / SC | Behavior | Test Type | Automated Command | File Exists? |
|----------|----------|-----------|-------------------|-------------|
| FLOWK-02 / SC-1 (okx) | A malformed live OKX funding row ends calibrate AND apply as `live_anchor_unusable live_funding=malformed`, permanent, result block written, zero table writes and only the progress RPC | integration (real fetcher, fake exchange) | `python -m pytest tests/test_okx_archive_apply.py -k malformed_live_funding -q -p no:cacheprovider` | no, Wave 0 (new test in an existing file; `**kwargs` fix to two fakes first) |
| FLOWK-02 / SC-1 (sync_funding) | `run_sync_funding_job` drops a malformed row for each of binance, okx, bybit: DONE, one good row upserted, drop WARNING logged, no exception | unit (real handler, fake exchange) | `python -m pytest tests/test_job_worker_sync_funding.py -k malformed -q -p no:cacheprovider` | no, Wave 0 (new test) |
| SC-5 (windows kept) | A timeout mid-walk keeps finished windows, ends FAILED transient "Handler exceeded timeout", and the next run resumes from newest stored minus 2 days | integration (real `dispatch` + `wait_for`) | `python -m pytest tests/test_job_worker_sync_funding.py -k c27 -q -p no:cacheprovider` | no, Wave 0 |
| SC-5 (order and prefix) | Each window's rows reach the upsert in ascending time order, in 500-row slices, and the walk stops at the first failing slice | unit | same file, `-k c27` | no, Wave 0 |
| SC-5 (fetcher bound) | `until_ms` bounds `endTime` and runs one window; windows from the helper equal one full walk's windows (+1 ms seam, 53 for a first walk) | unit | `python -m pytest tests/test_funding_fetch.py -k until_ms -q -p no:cacheprovider` | no, Wave 0 |
| SC-5 (no regression) | The 231 C27 pin and the 180 s budget stay true | unit | `python -m pytest tests/test_bybitreads_census_pins.py -q -p no:cacheprovider` | yes |
| FLOWK-03 / SC-2 | A malformed realized row is a flag, not a refusal (D-12) | unit | `python -m pytest tests/test_daily_pnl_read_verdict.py -k malformed -q -p no:cacheprovider` | yes (docstring pointer edit only) |
| SC-3 | The two TODOS entries are deleted, named in the CHANGELOG; cited pointers fixed | manual / grep | `grep -a -rn "186-OTHER-FUNDING-CALLERS-DROP\|186-REALIZED-MALFORMED-COUNT" TODOS.md CHANGELOG.md analytics-service` (TODOS: 0 hits, CHANGELOG: names both) | n/a |
| Type gate | no new mypy error | static | the mypy command above | yes |

### PROOF-01: proposed neuter edits (one per decision, each from a byte backup)

Procedure for every row: `cp <file> <scratch>/<name>.bak`, apply the edit, run the test (expect RED, paste the first failing line), `cp <scratch>/<name>.bak <file>` then `cmp <file> <scratch>/<name>.bak`, run again (GREEN). Never `git checkout`, `git restore` or `git stash` on this work.

| Test | Neuter edit | Expected RED |
|------|-------------|--------------|
| OKX stop (kwarg) | in `_live_reference` delete `on_malformed="raise"` from the `fetch_funding_okx(...)` call | the real fetcher drops the row, the job continues, the message assertion fails |
| OKX stop (mapping) | keep the kwarg, delete the `except FundingRowsMalformed:` clause | the exception leaves the handler; dispatch classifies it generically; the message assertion fails and no result block exists |
| sync_funding drop pin | add `on_malformed="raise"` to one venue's fetch call in `run_sync_funding_job` (per venue, so each parametrized arm goes RED on its own) | `FundingRowsMalformed` escapes, the arm fails |
| C27 keeps windows | accumulate rows across the loop and call the upsert once after the loop (the old shape) | the cancelled-walk test sees zero upserts |
| C27 oldest first | iterate `reversed(windows)` | the resume assertion (first `since_ms` equals newest stored minus 2 d) fails |
| C27 ascending slices | delete the `rows.sort(...)` line | the ascending-order assertion fails |
| C27 stop at first error | `continue` past a slice that reports errors | the stop-at-first-error assertion fails (later slices are upserted) |
| `until_ms` bound | ignore `until_ms` (always use the fetch-time now) | the `endTime == until_ms` assertion fails |

### Sampling Rate
- **Per task commit:** the quick command on the files touched.
- **Per wave merge:** the 7-file relevant set plus mypy.
- **Phase gate:** full suite and mypy green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_okx_archive_apply.py`: add `**kwargs` to the two `_funding` fakes, then the new decision test.
- [ ] `tests/test_job_worker_sync_funding.py`: the drop pin (three venues), the C27 tests, and the deliberate update of `test_happy_path_calls_upsert_with_rows`.
- [ ] `tests/test_job_worker_funding_cursor.py`: the two deliberate updates (intent preserved as written above).
- [ ] `tests/test_funding_fetch.py`: the `until_ms` and window-helper tests.
- [ ] Framework install: none.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json`, so this section applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no new auth surface |
| V3 Session Management | no | none |
| V4 Access Control | no | the job runs with the existing service credentials; no new RPC |
| V5 Input Validation | yes | venue payloads are validated by `_normalize_funding_row` and the response-shape checks already in the fetchers; the malformed-row path stays count-only |
| V6 Cryptography | no | none |
| V7 Error Handling and Logging | yes | `last_error` and logs carry venue and counts only; the new stop detail is the fixed literal `live_funding=malformed`; keep `from None` so no venue text rides on the exception chain |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Venue text, amounts or signed URLs leaking into `last_error` | Information disclosure | fixed-literal `_Stop.detail`; `FundingRowsMalformed` message is venue and count only (pinned by `TestOnMalformedRaise::test_raise_mode_refuses_a_walk_that_dropped_a_row`); the Bybit fetch scrubs error URLs with `scrub_freeform_string` |
| Partial writes making a rebuild publish a skewed anchor | Tampering | ruling 1: the stop is raised inside `_evaluate`, before any apply RPC |
| Unbounded retry of a doomed walk | Denial of service | `max_attempts` default 3 and the watchdog; no new loop without a bound (the window list is finite) |

## Project Constraints (from CLAUDE.md and memory)

- Run pytest and mypy from `analytics-service/` only; CI mypy strict belongs in every analytics-touching brief and pre-push check.
- Always `grep -a`. Cite code by symbol, never `file:line`, in plans and in anything `plan-anchor-verify` reads.
- Tests must be able to fail: neuter, see RED, restore from a byte backup (`cp` back, `cmp`), never `git checkout`, `git restore` or `git stash` on uncommitted work.
- Every ship writes a CHANGELOG entry in the same commit as the VERSION bump (VERSION and `package.json` byte-equal); the entry names the closed TODOS ids (`[186-OTHER-FUNDING-CALLERS-DROP]`, `[186-REALIZED-MALFORMED-COUNT]`) and says the composite caller is out of scope by F-2, not fixed, and that C27 is fixed here. Never write a CI skip token in a commit or PR body.
- A ship branch changes nothing under `.planning`.
- No PROD ids, home paths or account numbers in tracked text.
- TODOS.md holds open work only: delete the two closed entries in the ship PR; do not tick them.
- No AI authorship trailers in commits (project memory); do not edit `ROADMAP.md` or `STATE.md` with handlers without `git diff` afterwards.
- Design system (DESIGN.md) and the Next.js notice in AGENTS.md do not apply: no UI or Next.js code is touched.

## TODOS pointers (item 6)

The two entries, both in `TODOS.md`: `[186-REALIZED-MALFORMED-COUNT]` and `[186-OTHER-FUNDING-CALLERS-DROP]` (both already tagged "owned by Phase 223 FLOWKINDS"). `[186-COMPOSITE-MEMBER-READ-GAPS]` is a separate entry in the same file; its text says the composite funding gap is the same gap, so deleting `[186-OTHER-FUNDING-CALLERS-DROP]` leaves the composite caller tracked there and in `REQUIREMENTS.md` Out of Scope. [VERIFIED: grep of `TODOS.md` and `REQUIREMENTS.md`]

Every live pointer outside `.planning/milestones` history:
- `analytics-service/services/exchange.py`, the `daily_pnl_read_verdict` docstring: "(TODOS ``[186-REALIZED-MALFORMED-COUNT]``)". Replace with the recorded reading (0 flags on every measured key and strategy, 2026-11-24, `223-PROD-MALFORMED-COUNT.md`) and ruling 2. Comment-only. Phase 232 writes this same file (`fetch_daily_pnl`, DQ-flag code), so keep it a one-line docstring edit.
- `analytics-service/tests/test_daily_pnl_read_verdict.py`, docstring of `test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing`: "(TODOS ``[186-REALIZED-MALFORMED-COUNT]`` books the production count before refusing is reconsidered)". Replace the same way. This test is also FLOWK-03's pin: it asserts `verdict.reasons == ()` for `daily_pnl_malformed_okx`, `_bybit` and `_binance`, so it fails the day a realized-row refusal is switched on.
- `CHANGELOG.md` lines for Phase 186 name both ids as history: leave untouched (history). The new 223 entry names them as closed.
- `.planning/ROADMAP.md` Phase 223 entry and `.planning/REQUIREMENTS.md` FLOWK-02/03 name them as scope; `.planning/research/v1.22/*` are research history. Update only the ROADMAP/REQUIREMENTS completion state through the normal records flow, not in the ship PR.
- No hit in `CLAUDE.md`, `docs/`, `scripts/`, `src/`, `supabase/` or `.github/` (grep). No runbook lists the okx stop details (`live_realized=truncated`, `live_flows=unvaluable` appear only in the job module and its test).
- Docstrings to refresh in the same change: `_live_reference`'s docstring (now refuses a malformed funding row), `fetch_funding_bybit`'s docstring (`until_ms`), `run_sync_funding_job`'s docstring (windowed Bybit walk, drop decision and its reason), and the census-pin docstring (C27 fixed here).

## Phase 232 overlap (item 5)

232's CONTEXT lists `okx_archive_job.py` as "a Phase 223 file: read only, not edited" and owns `run_sync_trades_job`, the OKX bills reader and the `_record_dq_flag`/DQ-buffer code in `services/exchange.py`. Overlap to watch:
1. `analytics-service/services/job_worker.py`: both phases edit it, 232 around `run_sync_trades_job` and the realized-refusal tables, 223 at `run_sync_funding_job` (about 1,000 lines apart at HEAD). Low conflict risk, but keep 223's hunks inside `run_sync_funding_job` plus one new private helper placed directly after it.
2. `analytics-service/services/exchange.py`: 223's only edit is the one-line docstring pointer in `daily_pnl_read_verdict`. If 232 lands first, re-base that line; if the conflict is annoying, the pointer fix is the sole item that can move to a follow-up records commit.
3. `analytics-service/tests/test_okx_archive_apply.py`: 232 may touch the live fakes (`_equity`, `_trades`). 223 edits the `_funding` fakes and adds one test; keep the edits local to those functions.
4. 223 must not touch `_check_live_realized_flags`, `fetch_account_equity_and_upnl_usd` or `fetch_all_trades` call lines in `_live_reference` (C26 is 232's). The funding `_within(...)` block is the only hunk in that function.

## Sources

### Primary (HIGH confidence: files read in this session)
- `analytics-service/services/okx_archive_job.py` (`STOP_CLASSES`, `TRANSIENT_STOP_CLASSES`, `_Stop`, `_within`, `_finish_stop`, `_error_text`, `_live_reference`, `_evaluate`, `_run_evaluation`, `run_okx_archive_rebuild_job`)
- `analytics-service/services/funding_fetch.py` (`FundingRowsMalformed`, `_raise_if_malformed`, the three fetchers, `upsert_funding_rows`, `FUNDING_UPSERT_BATCH_SIZE`)
- `analytics-service/services/exchange_pagination.py` (`_windows`, `walk_paginated`)
- `analytics-service/services/job_worker.py` (`run_sync_funding_job`, `_funding_since_from_cursor`, `FUNDING_CURSOR_OVERLAP_DAYS`, `TIMEOUT_PER_KIND`, `dispatch`, `classify_exception`)
- `analytics-service/services/db.py` (`db_execute`)
- `supabase/migrations/20260411144407_compute_jobs_queue.sql`, `20261024120000_fan_in_graph_and_decision_cascade.sql`, `20260428155809_claim_failed_retry.sql` (retry and backoff)
- `analytics-service/tests/` files named above; `.github/workflows/ci.yml` (mypy and pytest steps); `analytics-service/requirements.txt`, `requirements-dev.txt`, `pytest.ini`, `Makefile`
- Local probe of `asyncio.wait_for` cancellation and executor-thread completion (Python 3.12, this session)
- Phase 223 and 231 planning files (`223-CONTEXT.md`, `223-PROD-MALFORMED-COUNT.md`, `231-CENSUS.md`, 232 CONTEXT read-only)

### Secondary / Tertiary
- None. No web or Context7 source was needed; all behaviour is in-repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (nothing new).
- Architecture: HIGH for ruling 1 and the window arithmetic; MEDIUM for C27 timing (A1, A2).
- Pitfalls: HIGH (each traced to code or an existing test).

**Research date:** 2026-11-24
**Valid until:** 2026-12-08 (Phase 232 and 231 are editing neighbouring files; re-measure before planning if either lands first)
