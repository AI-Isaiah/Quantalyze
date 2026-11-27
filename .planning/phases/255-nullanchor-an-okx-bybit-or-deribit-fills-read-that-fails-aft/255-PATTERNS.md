# Phase 255: NULLANCHOR - Pattern Map

**Mapped:** 2026-11-26
**Files analyzed:** 11 new/modified (1 new test module, 1 Python service file with 11 edit sites, 1 optional constants edit, 1 docstring edit, 3 hand-rolled RPC fakes, 1 Binance test file with 3 assertions, TODOS.md, CHANGELOG.md)
**Analogs found:** 11 / 11 (every analog path below was checked with `git ls-files` in the 255 worktree and is tracked)

Cite by symbol; line numbers are from the 255 worktree at HEAD `ddd5be9f` (branch `gsd/phase-255-nullanchor`) and drift. No migration, no SQL, no TS in this phase: the bound table and RPC are venue-agnostic and already shipped (Phase 253).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `analytics-service/services/job_worker.py` (`run_sync_trades_job`, 11 edit sites) | service (job handler) | event-driven job: seed -> provisional write -> read -> epilogue write | itself, the Phase 253 `_binance_read` gating | exact (generalise in place) |
| `analytics-service/services/exchange.py` (optional `OKX_FILLS_REACH_DAYS`, anchor helper) | config / constants | transform | `BINANCE_FILLS_REACH_DAYS` (exchange.py:705) and `OKX_BILLS_REACH_DAYS` (:160) | exact |
| `analytics-service/services/trade_resume.py` (`load_strategy_fills_reread_bound` docstring) | utility | request-response (reader, fails open) | itself | exact (wording only) |
| `analytics-service/tests/test_nullanchor_bound.py` (NEW) | test (two-run integration matrix + SC-2 pin) | job-driven, stateful fake store | `tests/test_binancefills_cursor.py::TestProvisionalBoundBeforeTheRead` + `tests/test_okxtrades_cursor.py` harness + `tests/_binance_fills.py` | exact |
| `analytics-service/tests/test_sync_trades_resume_seed.py` (`_rpc` fake) | test fixture fix | request-response fake | `tests/test_okxtrades_cursor.py::_make_supabase` `_rpc` | exact |
| `analytics-service/tests/test_sync_trades_store_truth.py` (`_rpc` fake) | test fixture fix | request-response fake | same | exact |
| `analytics-service/tests/test_ana_recon_audit.py` (`_rpc` fake) | test fixture fix | request-response fake | same | exact |
| `analytics-service/tests/test_binancefills_cursor.py` (3 intent-change assertions) | test (intent change, dated note) | job-driven | itself | exact |
| `TODOS.md` | ledger | n/a | PR #1259 / sweep-2 deletions (CLAUDE.md "TODOS.md holds open work only") | rule-match |
| `CHANGELOG.md` | ledger | n/a | top entries (`## [0.133.100.2]` / `[0.133.100.1]`) | exact |

## Pattern Assignments

### `analytics-service/services/job_worker.py`, `run_sync_trades_job` (service, event-driven job)

**Analog:** the same function, Phase 253 Binance gating. The change is mechanical generalisation: a second flag `_bound_read` for "a bound-tracked ccxt raw fills read ran", while `_binance_read` keeps every Binance-only predicate. Every gate keeps `and _reach_anchor_ms is not None` (mypy `--strict` narrowing of `int | None`; dropping it gave 6 errors in the research prototype).

Edit sites, by symbol (research table, re-confirmed against the file at HEAD):

**1. Declarations** (search `_binance_read = False`, ~line 2257): add `_bound_read = False` beside it. Existing neighbours to copy the comment style from:
```python
    _binance_read = False
    # Round-2: the provisional bound write failed or answered orphan, so the fills read is skipped.
    _fills_read_skipped = False
    _bound_orphaned = False
    _reach_anchor_ms: int | None = None
    _reread_bound_ms: int | None = None
    _unread_from_ms: int | None = None
    _covers_from_iso: str | None = None
```

**2. Per-venue reach anchor** (search `if ctx.key_row.get("exchange") == "binance":` followed by `_reach_anchor_ms = (` ~line 2403). Today:
```python
if ctx.key_row.get("exchange") == "binance":
    # Phase 253: the reach anchor is taken BEFORE the read (the CR-01 idiom: ...
    _reach_anchor_ms = (
        _exchange._now_ms() - BINANCE_FILLS_REACH_DAYS * 86_400_000
    )
    _binance_read = True
```
Becomes (research Pattern 1, verified on a scratch prototype): keep the Binance branch byte-identical, add `elif` for okx (`now - OKX_FILLS_REACH_DAYS(93) * 86_400_000`), bybit (`now - BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS(365) * 86_400_000`, NEVER `BYBIT_EXECUTION_HISTORY_DAYS`, which makes run 2 raise `start_too_old`), deribit (`0`, full-history crawl that ignores `since_ms`), then `_bound_read = _reach_anchor_ms is not None`. The anchor must be taken BEFORE the read, exactly as the Binance comment says.

**3. NULL-column None-seed anchor** (`elif ctx.key_row.get("exchange") == "binance":` ~line 2419, writing `fills_anchor_iso`): LEAVE Binance-only (research D2; an epoch-0 Deribit anchor would write 1970 into a shared per-key column, and the bound already covers the first-sync arms).

**4. Bound read as the seed's third term** (`if _binance_read:` ~line 2446): change to `if _bound_read:`. Copy intact:
```python
_bound_iso, _bound_err = await db_execute(
    lambda: load_strategy_fills_reread_bound(
        ctx.supabase, strategy_id, ctx.key_row["id"]
    )
)
_reread_bound_ms = parse_since_ms(_bound_iso)
if (_reread_bound_ms is not None and fills_since_ms is not None
        and _reread_bound_ms < fills_since_ms):
    fills_since_ms = _reread_bound_ms
    if _fills_cursor_ms is None:
        fills_anchor_iso = _iso_of_ms(_reread_bound_ms)
```

**5. Provisional write + fail-closed + orphan** (`if _binance_read and _reach_anchor_ms is not None:` ~line 2491 defining `_set_bound`): change to `_bound_read and ...`. Core to keep unchanged (the claim-token fence idiom and the value-is-the-seed rule):
```python
def _set_bound(unread_ms: int | None, covers_iso: str | None) -> bool:
    res = ctx.supabase.rpc(
        "set_strategy_fills_reread_bound",
        {
            "p_strategy_id": strategy_id,
            "p_api_key_id": ctx.key_row["id"],
            "p_job_id": job["id"],
            # WORKER_FENCE_V2 kill-switch, exactly as `_advance_cursor` below.
            "p_claim_token": (job.get("claim_token") if WORKER_FENCE_V2 else None),
            "p_unread_from": None if unread_ms is None else _iso_of_ms(unread_ms),
            "p_covers_from": covers_iso,
        },
    ).execute()
    return bool(res.data)   # True = owned, False = orphan claim token

_provisional_unread_ms = (
    fills_since_ms if fills_since_ms is not None else _reach_anchor_ms
)
```
Fail-closed `except Exception` arm (sets `_fills_read_skipped = True; phase1_read_refused = True; phase2_failed = True; phase2_error_message = f"re-read bound write failed ({type(exc).__name__})"`): keep; make the `logger.error` text venue-neutral ("re-read bound", not "Binance re-read bound"); names strategy and exception class only (no message text, per RESEARCH security domain). Flags: reuse `phase2_failed` only, no new public key (CONTEXT locked).

**6. Orphan arm** (search `_bound_orphaned = True` ~line 2561): it currently ends `_binance_read = False`; add `_bound_read = False` beside it (neuter N8 target).

**7. Epilogue inputs and `_earliest_through`** (`if _binance_read and _reach_anchor_ms is not None:` ~line 2776): change gate to `_bound_read and ...`. `_walk_start_ms` / `_covers_from_iso` expressions stay as they are (valid for the new venues; research verified). `_earliest_through` gets a non-Binance branch while the Binance body stays byte-identical. Existing body to preserve under `if _binance_read:`:
```python
_throughs: list[int] = []
if _read_through is not None and type(_read_through_raw) is int:
    _throughs.append(_read_through_raw)
if (exchange_dq_flags.get("binance_partial_symbols")
        or phase2_failed
        or (_fills_stopped and _read_through is None)):
    _throughs.append(_walk_start_ms - 1)
return min(_throughs) if _throughs else None
```
New `elif` for OKX, Bybit, Deribit (research clear-predicate table): `phase2_failed or any(key.startswith("sync_truncated_") and value for key, value in exchange_dq_flags.items())` -> `_throughs.append(_walk_start_ms - 1)`. Do NOT read `binance_*` keys on a non-Binance run (an existing test injects `binance_*` flags on an OKX key).

**8. Epilogue write** (`if _binance_read and _reach_anchor_ms is not None:` ~line 3041, `_unread_from_ms = _earliest_through()` then `_set_bound(_unread_from_ms, _covers_from_iso)` in a try): change gate to `_bound_read and ...`. The try/except body stays; make its log texts venue-neutral.

**9. `binance_stop_below_cursor` write** (the `if (_fills_cursor_ms is not None and _unread_from_ms is not None and _unread_from_ms + 1 < _fills_cursor_ms - _exchange.OVERLAP_WINDOW_MS):` block ~line 3054): add `_binance_read and` to the condition. Keeps the flag Binance-only (neuter N6).

**10. Failed epilogue write flag** (the `except Exception as exc:` arm, `exchange_dq_flags["binance_stop_below_cursor"] = True` ~line 3093): wrap that single assignment in `if _binance_read:`; the `logger.error` stays, venue-neutral text.

**11. Flag clear** (`clear_absent_binance_sync_flags` gate, `_binance_read and not phase2_failed and not _fills_read_skipped and not flag_load_failed` ~line 3247): UNCHANGED, stays on `_binance_read`.

**Untouched (venue-agnostic, why `advance_sync_cursor` params do not change):** `_fills_incomplete`, `_read_through`, `_fills_stopped`, the `advance_fetched_cursor` gate, the anchor `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:` stamp at ~line 3013. The `fetch_raw_trades(... read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S)` call is unchanged (ignored off Binance).

**Error handling pattern:** `try: _bound_owned = await db_execute(lambda: _set_bound(...)) except Exception as exc:  # noqa: BLE001` then `else: if not _bound_owned:` orphan branch logging `worker_orphan_write_blocked: ...`. Copy as is.

---

### `analytics-service/services/exchange.py` (config constants; optional, research D3)

**Analog:** `BINANCE_FILLS_REACH_DAYS` and `OKX_BILLS_REACH_DAYS`. Pattern is a typed module constant with a `#:` doc comment stating the margin and its source:
```python
#: How far back the OKX walk starts when it has no (or an older) start. Longer than any calendar
#: three months (92 days at most), the archive's documented reach, so a cron tick never spends its
#: deadline on windows that can only be empty.
OKX_BILLS_REACH_DAYS: int = 93
...
#: A first sync (no start, RESEARCH F3) walks this many days back (ruling OQ2): 53 windows.
BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS: int = 365
...
#: The venue keeps two years of executions and rejects an older start (retCode 10001). A start
#: older than this is refused before any request, never clamped.
BYBIT_EXECUTION_HISTORY_DAYS: int = 730
...
BINANCE_FILLS_REACH_DAYS: int = 85
```
Add `OKX_FILLS_REACH_DAYS: int = 93` next to `BINANCE_FILLS_REACH_DAYS` with a `#:` comment saying the first-sync bound anchor for the bound path is NOT a venue limit and Bybit's is the 365-day lookback not the 730-day history cap. `job_worker.py` already imports `BINANCE_FILLS_REACH_DAYS` from this module (follow its import line for the new names). Optional one-line helper returning the anchor ms or None so the worker holds no magic numbers.

---

### `analytics-service/services/trade_resume.py` (docstring only)

**Analog:** itself. `load_strategy_fills_reread_bound` docstring starts `"""This strategy's Binance fills re-read bound, or None. Returns (unread_from, error).` Replace "Binance" with "ccxt raw fills" wording only. Do not change the reader's fail-open behaviour or signature (it already selects `api_key_id, unread_from` by `strategy_id` only).

---

### `analytics-service/tests/test_nullanchor_bound.py` (NEW; test, two-run integration)

**Analogs:** `tests/test_binancefills_cursor.py` (`TestProvisionalBoundBeforeTheRead`, `_two_run_walk_start_ms`, `_persisted_fills`, `_pinned_clock`), `tests/test_okxtrades_cursor.py` (`_make_supabase`, `_run_job`, `_the_advance`, fixtures), `tests/_binance_fills.py` (`RereadBounds`, `column_after_advance`, `bound_after_set`).

**Imports pattern** (test_binancefills_cursor.py lines 73-98, adapt):
```python
from __future__ import annotations

import asyncio
import logging
from typing import Any
from unittest.mock import MagicMock

import ccxt
import pytest

from services import exchange as ex
from tests._binance_fills import RereadBounds, bound_after_set, column_after_advance
from tests.test_okxtrades_cursor import (
    CURSOR_AHEAD_TS,
    DAILY_ONLY_TRADES,
    DEFAULT_TRADES,
    STRATEGY_ID,
    _make_supabase,
    _run_job,
    _the_advance,
)
# also needs _persisted_fills / _two_run_walk_start_ms: import from tests.test_binancefills_cursor
# or copy the 8-line bodies (they are module-level functions there, not fixtures).
```

**Pinned clock (REQUIRED; `test_okxtrades_cursor.py` does not pin one):**
```python
NOW_253_MS = 1784116800000  # 2026-07-15T12:00:00Z

@pytest.fixture(autouse=True)
def _pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ex, "_now_ms", lambda: NOW_253_MS)
```
Hand-typed instants already in the repo: 1778112000000 = 2026-05-07T00:00Z (run 1 seed on DAILY_ONLY_TRADES), 1781913600000 = 2026-06-20T00:00Z (`CURSOR_AHEAD_TS`), 1783987200000 = 2026-07-14T00:00Z (the moved daily row), 1784116800000 = 2026-07-15T12:00Z. First-sync reach anchors under the pinned clock (research): OKX 1776081600000, Bybit 1752580800000, Deribit 0. Never compute expected values with the code under test.

**Core two-run arm to copy** (test_binancefills_cursor.py `test_cr02_...`, lines ~1476-1512, with `exchange=venue`):
```python
@pytest.mark.parametrize(
    "raw_error", [ccxt.RateLimitExceeded("429"), asyncio.CancelledError()], ids=["429", "cancel"]
)
async def test_cr02_a_null_column_run_raised_or_cancelled_after_the_daily_store_is_reread(
    self, raw_error: BaseException
) -> None:
    run1_seed_ms = 1778112000000
    bounds = RereadBounds()
    sb1, _rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
    with pytest.raises(type(raw_error)):
        await _run_job(supabase=sb1, column=None, exchange="binance", raw_error=raw_error,
                       daily_trades=[{"date": "2026-07-14", "daily_pnl": 1.0}])
    called = [c.args[0] for c in sb1.rpc.call_args_list]
    assert "sync_trades" in called, "the premise: Phase 1 stored the daily row first"

    rows2 = DAILY_ONLY_TRADES + [
        {"strategy_id": STRATEGY_ID, "is_fill": False, "timestamp": "2026-07-14T00:00:00+00:00"}
    ]
    sb2, _rec2 = _make_supabase(trades_rows=rows2, bounds=bounds)
    out2 = await _run_job(supabase=sb2, column=None, exchange="binance")
    assert _two_run_walk_start_ms(out2) <= run1_seed_ms - ex.OVERLAP_WINDOW_MS
    assert bounds.rows == {}, "run 2's clean read cleared the provisional bound (RPC R6)"
    assert called.index("set_strategy_fills_reread_bound") < called.index("sync_trades")
```
For the new module: parametrise `venue in ("okx", "bybit", "deribit")` x `column in (None, CURSOR_AHEAD_TS)` x `{429, cancel, plain RuntimeError}` (18 arms), plus per-venue first-sync arms (`trades_rows=[]`, column None, daily rows stored in run 1; assert run 2 `since - OVERLAP_WINDOW_MS <= reach anchor`, never `since is None`). A plain raise does NOT use `pytest.raises` (`_run_job` returns DONE; the epilogue runs), so take run 2's column from `column_after_advance(column, rec1.advance_params[0]["p_last_fetched_ts"])` as in the research snippet (stamp is None when the epilogue never ran). For the 429/cancel arms the stamp is None and run 2's column equals run 1's. The comparison constant for a set column is run 1's seed `1778112000000` (research matrix): the walk start must be at or before it. Research matrix expects 15 of 18 RED and the 3 NULL-column plain-raise arms GREEN on unmodified main: those 3 stay as regression pins with a comment, and the first plan task records each arm RED/GREEN verbatim (CONTEXT "Measurement first").

**Cancel mid-persist variant** (optional): `_cancel_the_second_persist(sb)` in test_binancefills_cursor.py (~line 1443) and `_persisted_fills(rec1, STRATEGY_ID)` (line 809) show how to carry stored fills into run 2's `trades_rows`.

**OKX truncated arm** (research: SET column RED today): `fills_flags={"sync_truncated_okx": True}` with one persisted fill (use `_fill(...)` from test_okxtrades_cursor.py, `exchange="okx"`); run 2 must still walk from run 1's seed.

**SC-2 pin class** (research section "SC-2 pin"): parametrise venue (binance, okx, bybit, deribit) x {clean read with a fill, plain raise, truncated (OKX)}; assert `set(params) == expected_keys` with the six keys, golden hand-typed `p_last_fetched_ts`, non-Binance runs make exactly two `set_strategy_fills_reread_bound` calls (provisional `p_covers_from is None`, then epilogue), no `binance_*` key on a non-Binance run, `binance_stop_below_cursor` never off Binance. Copy the key-set assertion shape from `test_d04_...` (test_binancefills_cursor.py ~line 1038):
```python
expected_keys = {"p_api_key_id", "p_job_id", "p_claim_token",
                 "p_last_fetched_ts", "p_last_sync_at", "p_account_balance"}
...
params = _the_advance(rec)
assert set(params) == expected_keys
```
Keep `test_the_mirror_matches_the_sql_case_table` green (do not edit `bound_after_set`).

**Bybit anchor arm (N4):** run 2 clock later than run 1's (re-monkeypatch `ex._now_ms` between runs) so an anchor at 730 days would put run 2 past `start_too_old`; the fetch is patched, so assert the stored/seeded `since_ms`, not the venue error.

**Fake caveat (Pitfall 1):** any new fake MUST route `set_strategy_fills_reread_bound` to `RereadBounds` (as `_make_supabase` does) or answer truthy, otherwise every OKX/Bybit/Deribit run reads as an orphan run and the read is skipped ("fetch_raw awaited 0 times").

**PROOF-01 neuters (research N1-N8)** go in the module docstring in the style of the `NEUTER (each recorded in the 232-01 SUMMARY, restored from a byte backup)` block at the top of `test_okxtrades_cursor.py` (N-numbered, each naming the test that goes RED). Backup outside the worktree, neuter, see the NAMED arm RED, restore with `cp`, `cmp`, GREEN; never `git checkout/restore/stash` on uncommitted work.

---

### The three hand-rolled RPC fakes (test fixture fix)

**Analog:** `tests/test_okxtrades_cursor.py::_make_supabase` `_rpc`, which already routes the bound RPC (lines ~223-235):
```python
def _rpc(name: str, payload: dict[str, Any]) -> MagicMock:
    if name == "advance_sync_cursor":
        rec.advance_params.append(dict(payload))
    if name == "set_strategy_fills_reread_bound":
        return bound_store.rpc(payload)
    stub = MagicMock()
    ...
```
For the three hand-rolled fakes the minimal fix (research: "answer True for the bound RPC too") is the one-line change of the truthy set. Each fake today is `data=True if name == "advance_sync_cursor" else 0`:

- `tests/test_sync_trades_resume_seed.py` `_rpc` (~lines 129-135, three tests: `test_fresh_last_sync_at_and_no_fills_cursor_reach_back_to_stored_day`, `test_failed_high_water_read_gives_full_reach_on_both_reads`, `test_fills_cursor_governs_the_fills_read_only`). Fake signature `def _rpc(name: str, _payload: dict[str, Any])`.
- `tests/test_sync_trades_store_truth.py` `_rpc` (~lines 303-317, five tests in `TestStoreOrder`, `TestFlagWrite`, `TestOwnedKeyReplacement`; order assertions use `rec.events`).
- `tests/test_ana_recon_audit.py` `_rpc` (~lines 490-503, `test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance`), nested inside the test.

Change in each: `data=True if name in ("advance_sync_cursor", "set_strategy_fills_reread_bound") else 0`. Keep surrounding code untouched; add a short comment citing Phase 255 (the bound RPC now runs on OKX/Bybit/Deribit; a falsy answer reads as an orphan and skips the read). Do not touch `test_job_worker.py` (its fake answers `else 2`, truthy).

---

### `tests/test_binancefills_cursor.py` three intent-change assertions

**Analog:** the tests themselves; the documented intent change is "an OKX run now makes exactly the provisional and the epilogue write and one bound read". Keep every other assertion in each test. Add a dated `Phase 255` note in the comment (the founder's convention for intent changes; CONTEXT decision "Tests").

1. `TestBinanceFillsCursorGate::test_an_okx_run_makes_no_bound_read_and_no_bound_write` (~line 349): rename to reflect "an OKX run makes the bound read and both bound writes"; replace
```python
assert bounds.calls == []
assert bounds.reads == 0
assert _the_advance(rec)["p_last_fetched_ts"] == "2026-06-02T09:00:00+00:00"
```
with `len(bounds.calls) == 2`, `bounds.reads == 1`, keeping the stamp assertion. Update the `# D-04: the bound is Binance-only.` comment.
2. `test_a_raised_okx_read_never_sets_a_binance_flag` (~line 482): keep the flag assertions (`flags["phase2_fill_ingestion_failed"] is True`, `not [k for k in flags if k.startswith("binance_")]`); replace `assert bounds.calls == [] and bounds.reads == 0` (the last line) with the 2-call/1-read expectation (a raised read on OKX: provisional write plus epilogue write, because the epilogue runs on a plain raise; verify the call count by running it, do not assume).
3. `TestRereadBoundAcrossRuns::test_d04_a_stop_run_calls_advance_sync_cursor_with_the_same_params_on_every_venue` (~line 1038): in the `for exchange in ("okx", "binance"):` loop the tail is
```python
            if exchange == "okx":
                assert bounds.calls == [] and bounds.reads == 0
            else:
                assert len(bounds.calls) == 2
```
Collapse both arms to `assert len(bounds.calls) == 2` (the six-key set and `p_last_fetched_ts == "2026-06-02T09:00:00+00:00"` assertions above stay). Update the docstring comment "An OKX key makes no bound read and no bound write".

Every other test in this 72-test file passes unmodified on the research prototype and is the SC-2 Binance pin.

---

### `TODOS.md` (ledger)

**Pattern:** CLAUDE.md "TODOS.md holds open work only" rule (b): the ship PR DELETES the closed entry (no `[x]`, no "CLOSED" paragraph) and names it in the CHANGELOG entry. Delete the entry starting `- [ ] **`[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` ...` (lines ~248-257 at HEAD, through its `- **Gate:**` bullet). Check no test, runbook or CLAUDE.md pointer still cites it as open (`grep -a -rn "253-NULL-COLUMN-ANCHOR-ALL-VENUES"` across `*.md`, `*.py`, `*.ts`, `*.yml`; the id may stay in historical 253 review docs and in the CHANGELOG). SC-3 check: `grep -a -c '253-NULL-COLUMN-ANCHOR-ALL-VENUES' TODOS.md` must be 0.

**Rewrite, not delete,** `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (entry directly below, header `- [ ] **`[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` While `set_strategy_fills_reread_bound` is unavailable, the nightly `cron_sync` daily store can move a Binance strategy's seed past a span no bound records**`): widen scope text from "a Binance strategy's seed" to OKX, Bybit and Deribit (PROD holds all three, research measured it reachable on all three), rewrite owner (no longer "the phase that connects the first Binance key") and trigger (PostgREST/RPC outage longer than a cron cycle, or rollback of `20261126150000`; no longer dormant), add a dated `CORRECTED 2026-11-26 (Phase 255)` bullet in the style of the existing `⛔ **CORRECTED 2026-11-26 (...)**` bullets (keep old text as lineage). Research: the fail-closed fix is NOT small (cron and `/fetch-trades` do not consult the bound), so it is not included; surface it to the founder as a decision item.

---

### `CHANGELOG.md` (ledger)

**Analog:** the top of the file, entry header and section vocabulary:
```markdown
## [0.133.100.2] - 2026-11-26 — BASELINE: automated re-dump after the PROD apply of eedbc243

### Changed
- ...

### Notes
- ...
```
Rules (CLAUDE.md "CHANGELOG discipline"): one unified entry, newest first, `## [X.Y.Z.B] - YYYY-MM-DD — <name>`, in the same commit as the `VERSION` + `package.json` bump (byte-equal 4-digit strings; never `npm version`; re-pick from origin/main before the single CI run). Use this repo's vocabulary: `### Fixed` (root cause: the daily store moves the seed past an unread span on OKX, Bybit, Deribit, 15 of 18 arms plus all first-sync arms RED), `### Changed` (the bound gating generalised, per-venue anchors OKX 93 d / Bybit 365 d / Deribit epoch 0, non-Binance clear predicate), `### Tests` (new module, 3 fakes, 3 intent-change assertions with dated note), `### Removed` (the TODOS entry id `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` named here; `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` rewritten), `### Notes` (the 3 GREEN-on-main NULL-column plain-raise arms as a deviation from SC-1 wording, the Bybit 365-day sliver, the OKX "pagination stuck" silent early stop as an undetectable residual, the A1 assumption on OKX out-of-reach `begin`, no migration, the catalog COMMENTs still say "Binance"). Never write the CI-skip tokens or a credential-shaped literal. Enumerate every branch commit as a checklist.

## Shared Patterns

### Claim-token fence on every bound RPC write
**Source:** `job_worker.py` `_set_bound` closure (and `_advance_cursor` below it). **Apply to:** provisional write and epilogue write, unchanged; `WORKER_FENCE_V2` off passes a NULL token.

### Orphan answer means "skip read, hold daily store, no flag, no epilogue write"
**Source:** the orphan `else` branch after the provisional `db_execute`. **Apply to:** all four venues; it must reset BOTH `_binance_read` and `_bound_read`.

### Seed = min(column, stored-fill or daily high-water, re-read bound); over-fetch is safe
**Source:** the seed block and the `(strategy_id, exchange, exchange_fill_id)` unique index. **Apply to:** all bound-tracked venues; a stray row only lowers one strategy's seed.

### Test fakes must answer the bound RPC truthy
**Source:** `_make_supabase._rpc` routing to `RereadBounds`. **Apply to:** every test driving `run_sync_trades_job` with a hand-rolled `rpc` fake (three listed above; any NEW driver too).

### Flag surface
**Source:** `phase2_failed` -> `phase2_fill_ingestion_failed`. **Apply to:** all non-Binance bound failures; no new anon-readable key; `binance_*` keys and `clear_absent_binance_sync_flags` stay Binance-only.

### mypy strict gate
**Source:** CI command `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (ci.yml `python` job; CI pins mypy 2.4.0, local is 2.0.0). **Apply to:** every analytics-touching task; keep `and _reach_anchor_ms is not None` in every gate.

### PROOF-01
**Source:** module docstring of `tests/test_okxtrades_cursor.py` (N1-N9 style). **Apply to:** each plan SUMMARY, verbatim: byte backup outside the worktree, neuter, see the named arm RED, `cp` back, `cmp`, GREEN.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| (none) | | | Every file has an in-repo analog. The non-Binance branch of `_earliest_through` has no prior implementation, but the Binance body beside it and the research clear-predicate table fully specify it. |

## Metadata

**Analog search scope:** `analytics-service/services/job_worker.py`, `services/exchange.py`, `services/trade_resume.py`, `analytics-service/tests/` (`test_binancefills_cursor.py`, `test_okxtrades_cursor.py`, `_binance_fills.py`, the three fake-holding suites), `TODOS.md`, `CHANGELOG.md`, the Phase 253 PATTERNS and the 255 RESEARCH (13-site edit table, matrix, census).
**Files scanned:** 12 read in part (large files by targeted ranges, no range re-read).
**Tracked-source gate:** `git ls-files` confirmed tracked for `job_worker.py`, `exchange.py`, `trade_resume.py`, the three tests named in the brief, the three fake suites, `TODOS.md`, `CHANGELOG.md`. No gitignored mirror paths are named.
**Verification caution:** line numbers match RESEARCH's table at HEAD; re-measure the matrix at HEAD before executing (research valid until 2026-12-10).
**Pattern extraction date:** 2026-11-26
