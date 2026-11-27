# Phase 255: NULLANCHOR - Research

**Researched:** 2026-11-26
**Domain:** `run_sync_trades_job` fills-read resume seed and the Phase 253 per-strategy re-read bound, extended from Binance to OKX, Bybit and Deribit (Python only, no migration)
**Confidence:** HIGH on the code behaviour and the matrix (measured this session on the worktree and on a scratch prototype); MEDIUM on venue reach numbers (vendor docs only partly reachable); two ASSUMED items listed below.

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied from `255-CONTEXT.md` (`## Decisions`, `### Claude's Discretion`, `## Deferred Ideas`). These are the phase agent's autonomous decisions and bind the planner.

### Locked Decisions

- [Fix direction] Q: "Extend the 253 bound, hold the daily store, or anchor through advance_sync_cursor?" → Selected: "Extend the 253 bound to OKX, Bybit and Deribit" — Python only (the SQL is venue-agnostic), so undoing it is reverting the gating; a stray bound row only lowers one strategy's seed (an idempotent over-fetch absorbed by the fills unique index) and is cleared by the next complete run or by key or strategy deletion.
- [Database surface] Q: "Ship a migration to reword the table comments?" → Selected: "No migration; Python comments and CHANGELOG carry it" — nothing persisted changes shape.
- [Failure variants] Q: "Which failure variants does the gate cover?" → Selected: "The three SC-1 names: a 429 (`ccxt.RateLimitExceeded` out of `fetch_raw_trades`), a cancel (the handler's `asyncio.wait_for` CancelledError), and a plain raised read; each on a NULL column and on a set column with no stored fill; a daily row stored in run 1; for each of OKX, Bybit and Deribit (18 two-run arms), PLUS one first-sync arm per venue (NULL column AND no daily high-water before run 1, so the seed is None; run 1 stores daily rows, then the fills read fails)" — test-only scope choice.
- [Measurement first] Q: "Is every SC-1 arm RED on origin/main today?" → Selected: "Not assumed. The TODOS evidence is OKX only, and on a NULL column only the 429 and the cancel were measured; the plain raised read on a NULL column likely reaches the epilogue, which stamps the Phase 232 bootstrap anchor (`fills_anchor_iso`) through `advance_sync_cursor`, so it may already be GREEN. The FIRST plan task writes the matrix and runs it on unmodified code for all three venues, recording each arm RED or GREEN verbatim. An arm that is GREEN on origin/main stays in the gate as a regression pin and is reported as a deviation from SC-1's 'each arm is RED' wording, never forced RED" — test-only.
- [Failure variants] Q: "Do truncated or partial non-Binance reads (`sync_truncated_*`, page caps) join the bound?" → Selected: "Research measures whether such a read can leave a span the next seed skips. If yes and the bound covers it with the same epilogue predicate, include it; if not, record it in the SUMMARY with the measurement and book a MEDIUM+ residual" — scope is the SC-1 variants first.
- [Walk start per venue] Q: "Is Binance's walk-start model (`seed - OVERLAP_WINDOW_MS`, `-infinity` covers at the reach, a reach anchor) right for OKX, Bybit and Deribit?" → Selected: "Not assumed. Research reads, per venue, where `fetch_raw_trades` actually starts for a given `since_ms` and for `None`, and the epilogue's `_walk_start_ms` / `_covers_from_iso` are derived from that per venue. Note `_set_bound(None, None)` is RPC R0 and writes nothing, so a None seed with no reach anchor leaves no bound: the first-sync arm pins this" — internal logic.
- [Clear predicate] Q: "What counts as a complete read that may clear (R6) the bound on OKX, Bybit and Deribit?" → Selected: "A REQUIRED research answer. `_earliest_through()` reads only `binance_*` keys and `phase2_failed`. Research enumerates every flag or swallowed condition each venue's fills read can raise (partial symbols, `sync_truncated_*`, page caps, pagination stops) and states which of them mean the read is not complete through the walk start; those keep the bound. A wrong clear reopens the hole one run later" — internal logic.
- [Seed with no anchor] Q: "What does the provisional bound hold when the seed is None (NULL column and no daily high-water)?" → Selected: "A per-venue reach anchor taken BEFORE the read, the way `BINANCE_FILLS_REACH_DAYS` works for Binance; research reads each venue's documented fills-history reach (OKX, Bybit, Deribit API docs) and the existing reach constants in `services/exchange.py` (e.g. `OKX_BILLS_REACH_DAYS`). If a venue has no usable reach, the provisional row holds the earliest instant the read could have walked from, never later than the walk start" — internal constant, cheap to change.
- [Flags] Q: "Which data_quality_flags does a non-Binance bound failure write?" → Selected: "No new public key. A bound-write failure stamps `phase2_fill_ingestion_failed` (via `phase2_failed`) as Binance's provisional failure does; the Binance-only `binance_stop_below_cursor` and the nine-key carry allowlist stay Binance-only" — avoids widening the anon-readable flags surface (`[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]` class).
- [Code shape] Q: "How is the gating generalised?" → Selected: "Rename or split `_binance_read` so the bound path is gated on 'a ccxt raw fills read ran' with the reach anchor per venue, while every Binance-only predicate (`binance_read_through_ms`, page-cap/deadline/untimed symbols, `binance_stop_below_cursor`, the binance flag clear) stays gated on Binance" — internal naming.
- [Tests] Q: "Where do the gate arms live?" → Selected: "A new parametrised pytest module under `analytics-service/tests/` modelled on `test_binancefills_cursor.py` and `test_okxtrades_cursor.py` two-run harnesses; existing Binance suites stay green unchanged except where they assert that a non-Binance run issues no bound RPC (those assertions are the documented intent change and are updated with a dated note)" — test files only.
- [Residual pointer] Q: "What happens to `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`?" → Selected: "Not fixed by default. Extending the bound makes that residual reachable on OKX, Bybit and Deribit keys (PROD has them) whenever the bound RPC is unavailable, where the founder accepted it only because PROD had no Binance key. The ship PR rewrites its scope, owner and trigger to say so, and the phase agent reports it to the founder as a decision item. If the planner finds the entry's fail-closed fix direction is small (refuse the ccxt raw ingestion when the RPC is missing), it may include it" — ledger edit plus a founder item.

### Claude's Discretion

- Plan count and wave split. The founder's standing rules apply: one executor per plan, PROOF-01 recorded verbatim in each plan SUMMARY, CI mypy strict in every analytics-touching pre-push check.

### Deferred Ideas (OUT OF SCOPE)

- `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` stays open (fail-closed refusal when the bound RPC is missing); its scope text widens to OKX, Bybit and Deribit in the ship PR.
- Rewording the bound table's catalog COMMENTs, unless a migration is needed for another reason.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were provided (ROADMAP: `**Requirements**: TBD`). The four ROADMAP success criteria are the contract.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | OKX, Bybit, Deribit x {NULL column, set column with no stored fill} x {429, cancel, plain raise}: run 2's walk start at or before run 1's seed | Matrix below: 15 of 18 arms RED today, 3 GREEN (NULL-column plain raise); all 9 first-sync arms RED; the prototype turns every arm GREEN |
| SC-2 | Binance Phase 253 and `advance_sync_cursor` callers do not regress, pinned by a test | Section "SC-2 pin": `advance_sync_cursor` has ONE Python caller; its params were byte-identical across 36 before/after matrix runs |
| SC-3 | `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` deleted in the ship PR, named in the CHANGELOG entry | Ledger work, no research dependency; widen `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` in the same PR |
| SC-4 | PROOF-01 neuter, RED, restore with `cp`, `cmp`, GREEN | Neuter list proposed under "Validation Architecture" |
</phase_requirements>

## Summary

The hole is real and wider than the TODOS entry says, and the fix CONTEXT chose works. On unmodified code, with the fills read replaced by a failing double and a stateful two-run harness, 15 of the 18 SC-1 arms and all 9 first-sync arms are RED for OKX, Bybit and Deribit alike. The only GREEN arms are the three NULL-column plain-raise arms (one per venue): the epilogue stamps the Phase 232 bootstrap anchor (`fills_anchor_iso`) through `advance_sync_cursor`, so run 2's `since_ms` equals run 1's seed. Those three stay in the gate as regression pins (a deviation from SC-1's "each arm is RED" wording, as CONTEXT already allows). Also RED today and not named by the TODOS entry: an OKX read truncated by the page cap on a set column whose column is ahead of the stored fills (the newest stored fills move the seed past the unread oldest span).

A scratch prototype (a patched COPY of `analytics-service` in the session scratchpad; the repo is untouched) generalises the bound gate to the three venues with a per-venue reach anchor and a non-Binance clear predicate. It turns every NULL-column and set-column arm GREEN, keeps `advance_sync_cursor` params identical, passes mypy `--strict` as CI runs it, and breaks exactly 12 existing tests, all in two classes (fakes that answer `data=0` for the new RPC name so it reads as an orphan, and three Binance-file assertions that an OKX run issues no bound RPC). Two venue facts the plan must respect: Deribit's fills read IGNORES `since_ms` (full-history id-cursor crawl), so Deribit cannot lose a span in production but is RED at the `since_ms` seam the gate observes; and Bybit's provisional anchor must be the 365-day first-sync lookback, never the 730-day history limit, or run 2 raises `start_too_old` by construction.

**Primary recommendation:** add a `_bound_read` gate (venue in binance, okx, bybit, deribit, with `_reach_anchor_ms is not None` kept in every gate for mypy narrowing) beside the untouched `_binance_read`; reach anchors OKX now-93d, Bybit now-365d, Deribit epoch 0; a non-Binance `_earliest_through` branch that keeps the bound on `phase2_failed` or any truthy `sync_truncated_*`; no migration; do NOT fix `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (measured reachable on all three venues, fix is not small).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fills-read seed and provisional bound write | API / Backend (analytics worker, `run_sync_trades_job`) | Database (RPC `set_strategy_fills_reread_bound`) | The seed is computed in the worker; the DB only stores and arbitrates (R0 to R7) |
| Bound storage and state machine | Database / Storage | — | `strategy_fills_reread_bounds` plus the SECDEF RPC; venue-agnostic already |
| Per-venue walk start and reach | API / Backend (`services/exchange.py`, `services/deribit_ingest.py`) | — | Each venue branch owns its own start rule; the epilogue must mirror it |
| Failure-flag surface (`phase2_fill_ingestion_failed`) | Database (`strategy_analytics.data_quality_flags`) | API / Backend | Written from the epilogue; anon-readable, so no new key |
| Cron / `/fetch-trades` daily store | API / Backend (`routers/cron.py`, `routers/exchange.py`) | — | Out of scope; they cannot consult the bound (the `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` residual) |

## Standard Stack

No new libraries. The stack is the repo's own modules.

### Core
| Component | Where | Purpose | Why standard |
|-----------|-------|---------|--------------|
| `run_sync_trades_job` | `analytics-service/services/job_worker.py:2217` | The one sync_trades handler; the only place the seed, the provisional bound and the epilogue bound live | Phase 253 already built the mechanism here |
| `set_strategy_fills_reread_bound` + `strategy_fills_reread_bounds` | `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` | Fenced per-strategy bound writer and table | Already applied to PROD (the baseline carries it, see Environment Availability) |
| `load_strategy_fills_reread_bound` | `analytics-service/services/trade_resume.py` | Reader, fails open | Third term of the seed |
| Test fakes | `tests/_binance_fills.py` (`RereadBounds`, `bound_after_set`, `column_after_advance`), `tests/test_okxtrades_cursor.py` (`_make_supabase`, `_run_job`, `_the_advance`) | Two-run harness | Models the SQL R0..R7 in Python and is pinned against the SQL case table |

### Supporting / Alternatives
Alternatives were decided by CONTEXT (holding the daily store, `advance_sync_cursor` anchor): not re-opened.

**Installation:** none.

**Version verification:** no packages are installed or added. Local tooling observed: Python 3.14.3, pytest 9.0.2, ccxt 4.5.64, mypy 2.0.0 (local) while `requirements-dev.txt:53` pins `mypy==2.4.0`. [VERIFIED: shell this session; `analytics-service/requirements-dev.txt:53` `mypy==2.4.0`]

## Package Legitimacy Audit

Not applicable: this phase installs no external packages. Packages removed: none. Packages flagged SUS: none.

## Architecture Patterns

### System Architecture Diagram

```
queued sync_trades job
        |
        v
 _exchange_preflight -> ctx (ccxt exchange, key_row, supabase)
        |
        +-- Mt5Session? -> no daily read, no fills read (unchanged)
        |
        v  (ccxt arm)
 daily read (fetch_all_trades, seeded by load_strategy_high_waters)  -> daily_since_ms
        |
        v  _RAW_TRADE_INGESTION_ENABLED?
 seed = min(column, stored-fill high-water | daily high-water)  -> fills_since_ms (None = first sync)
        |
        v  NEW: venue in {binance, okx, bybit, deribit}  (_bound_read)
 reach anchor R (taken BEFORE the read)  ;  bound term: seed = min(seed, stored bound)
        |
        v
 PROVISIONAL set_strategy_fills_reread_bound(unread = seed or R, covers = NULL)   <-- precedes the daily store
        |   fails -> skip read, hold daily store, phase2_failed        orphan -> skip read, hold daily store, no flag
        v
 Phase-1 daily store (sync_trades RPC)  ->  balance read
        |
        v
 fetch_raw_trades(since_ms=seed)  -- raise / 429 / CancelledError --> (no epilogue; provisional row stands = seed)
        |
        v
 persist fills  ->  EPILOGUE:
     _earliest_through():  Binance branch (unchanged)  |  non-Binance: phase2_failed or sync_truncated_* -> walk_start - 1
     set_strategy_fills_reread_bound(unread = through | NULL, covers = -infinity | walk_start)   (R4 advance / R6 clear)
     strategy_analytics flags (phase2_*; binance_* only on Binance)
     advance_sync_cursor(last_fetched_ts stamp, last_sync_at, balance)   (UNCHANGED params)
```

### Recommended Project Structure (touch points only)
```
analytics-service/
├── services/job_worker.py        # gating + per-venue anchor + non-Binance _earliest_through branch
├── services/exchange.py          # (optional) named per-venue first-sync reach constants / helper
├── services/trade_resume.py      # docstring wording only ("Binance" -> any ccxt venue)
└── tests/
    ├── test_nullanchor_bound.py  # NEW parametrised matrix + SC-2 pin
    ├── test_binancefills_cursor.py          # 3 assertions updated with a dated note
    ├── test_sync_trades_resume_seed.py      # fake RPC answer
    ├── test_sync_trades_store_truth.py      # fake RPC answer
    └── test_ana_recon_audit.py              # fake RPC answer
```

### Pattern 1: gate the bound on "a bound-tracked read ran", keep Binance predicates on `_binance_read`
**What:** two flags. `_bound_read` (true for binance, okx, bybit, deribit when `_reach_anchor_ms` is set) drives the bound read, provisional write, epilogue write and orphan/skip handling. `_binance_read` (true only for Binance) keeps `binance_read_through_ms`, page-cap/deadline/untimed symbols, `binance_partial_symbols`, `binance_stop_below_cursor`, the binance flag clear and the None-seed column anchor.
**Why both conjuncts:** `_reach_anchor_ms` is `int | None`; the existing gate `if _binance_read and _reach_anchor_ms is not None:` is what narrows it for mypy. Measured: replacing it by `if _bound_read:` gives 6 `mypy --strict` errors (`Unsupported operand types for - ("None" and "int")`, `job_worker.py:2819` in the patched copy); restoring `and _reach_anchor_ms is not None` gives `Success: no issues found in 146 source files`. [VERIFIED: mypy run this session on the scratch copy]
**Example (verified prototype, scratch copy only):**
```python
# declarations (next to `_binance_read = False`, job_worker.py:2257)
_bound_read = False

# the Phase-2 seed block (replaces job_worker.py:2403-2409)
_exch_id = ctx.key_row.get("exchange")
if _exch_id == "binance":
    _reach_anchor_ms = _exchange._now_ms() - BINANCE_FILLS_REACH_DAYS * 86_400_000
    _binance_read = True
elif _exch_id == "okx":
    _reach_anchor_ms = _exchange._now_ms() - 93 * 86_400_000      # name it OKX_FILLS_REACH_DAYS
elif _exch_id == "bybit":
    _reach_anchor_ms = _exchange._now_ms() - 365 * 86_400_000     # BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS
elif _exch_id == "deribit":
    _reach_anchor_ms = 0                                          # full-history crawl: no reach
_bound_read = _reach_anchor_ms is not None
# every later gate: `if _bound_read and _reach_anchor_ms is not None:` (bound read, _set_bound, epilogue)
# the orphan arm (job_worker.py:2563) resets BOTH: `_binance_read = False; _bound_read = False`

def _earliest_through() -> int | None:
    _throughs: list[int] = []
    if _binance_read:
        ...  # the existing Binance body, byte-identical
    elif phase2_failed or any(
        key.startswith("sync_truncated_") and value for key, value in exchange_dq_flags.items()
    ):
        _throughs.append(_walk_start_ms - 1)
    return min(_throughs) if _throughs else None
```
The `binance_stop_below_cursor` write (job_worker.py:3054-3068) and the failed-epilogue-write flag (3093) need an extra `_binance_read and` / `if _binance_read:` guard. The NULL-column None-seed anchor branch (`elif ctx.key_row.get("exchange") == "binance":` at job_worker.py:2419) and the flag clear (3247-3255) stay as they are.

### Anti-Patterns to Avoid
- **Setting the Bybit anchor to the 730-day history limit.** Run 2's clock is later than run 1's, so a bound at exactly `now1 - 730d` makes run 2's start older than `now2 - 730d` and `_fetch_raw_trades_bybit` raises `BybitTradeWindowIncomplete("start_too_old")` before any request, for ever. Use the 365-day first-sync lookback.
- **Reading `binance_*` keys on a non-Binance run in `_earliest_through`.** The stamp logic (`_read_through`, `_fills_stopped`) is venue-agnostic today and an existing test injects `binance_*` flags on an OKX key; only the NEW bound predicate must stay Binance-keyed.
- **Forcing a RED arm.** The three NULL-column plain-raise arms are GREEN on origin/main; keep them as pins and report the deviation.
- **Adding a public flag key** (CONTEXT locked): a bound-write failure reuses `phase2_failed`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| The R0..R7 state machine | A Python re-implementation of the bound arbitration in the worker | The SQL RPC (already shipped) and the existing Python mirror `bound_after_set` for the test fake | The mirror is pinned to the SQL case table by `test_the_mirror_matches_the_sql_case_table` |
| Two-run integration harness | A new fake Supabase | `_make_supabase` / `_run_job` / `RereadBounds` / `column_after_advance` / `_two_run_walk_start_ms` / `_persisted_fills` | Already model the forward-only column RPC and the stateful bound table |
| A per-venue reach/walk model | Re-deriving the walk start in the epilogue from the venue response | The fixed rule `seed - OVERLAP_WINDOW_MS` (same for every venue, applied in `fetch_raw_trades`) plus a per-venue anchor for a None seed | The venue functions do not report their own start |
| A new "failed span" marker | A new `data_quality_flags` key | The bound row plus `phase2_failed` | CONTEXT locked: no new anon-readable key |

**Key insight:** the mechanism already exists and is venue-agnostic in SQL. The work is gating, one anchor per venue, one clear predicate, and tests; every extra mechanism reopens a Phase 253 review class.

## Current-behaviour matrix (answer to required question 1)

Measured this session on the unmodified worktree (HEAD `ddd5be9f`, branch `gsd/phase-255-nullanchor`) with a scratch pytest in the session scratchpad (not in the repo) that imports the repo's own harness. Clock pinned at `NOW_MS = 1784116800000` (2026-07-15T12:00Z). Run 1 stores a daily row for 2026-07-14 through the `sync_trades` RPC, then the fills read fails; run 2 gets run 1's flags, run 1's bound store, run 1's persisted rows plus the moved daily row, and the column as `advance_sync_cursor` left it (`column_after_advance`). [VERIFIED: scratch run, 36 passed]

Run 1 seed = 1778112000000 (2026-05-07T00:00Z, the daily high-water of `DAILY_ONLY_TRADES`) on the NULL and set-column arms; None on first sync. Column for "set" = `CURSOR_AHEAD_TS` (2026-06-20, ahead of the daily high-water, no stored fill).

| Column | Variant | OKX | Bybit | Deribit | Run 2 `since_ms` (all three venues identical) |
|--------|---------|-----|-------|---------|------------------------------------------------|
| NULL | 429 | RED | RED | RED | 1783987200000 (2026-07-14) |
| NULL | cancel | RED | RED | RED | 1783987200000 |
| NULL | plain raise | **GREEN** | **GREEN** | **GREEN** | 1778112000000 (= run 1 seed: the anchor stamp `2026-05-07T00:00:00+00:00`) |
| SET, no stored fill | 429 | RED | RED | RED | 1781913600000 (2026-06-20, the column) |
| SET, no stored fill | cancel | RED | RED | RED | 1781913600000 |
| SET, no stored fill | plain raise | RED | RED | RED | 1781913600000 (stamp None: the RPC cannot lower a set column) |
| first sync (NULL, no daily hw) | 429 | RED | RED | RED | 1783987200000 vs run 1 seed None |
| first sync | cancel | RED | RED | RED | 1783987200000 |
| first sync | plain raise | RED | RED | RED | 1783987200000 (no anchor for a None seed on a non-Binance key) |
| NULL / SET / first | OKX only, `sync_truncated_okx` true + one stored fill | NULL: GREEN (anchor) / SET: **RED** / first: **RED** | n/a | n/a | SET: 1781913600000 |

Run 1 RPC lists, verbatim from the run: 429: `['sync_trades', 'stamp_api_key_429']`; cancel: `['sync_trades']`; plain raise: `['sync_trades', 'advance_sync_cursor', 'enqueue_compute_job']`. They match the TODOS evidence (rpcs and the 2026-07-14 value). [VERIFIED: scratch run output]

Reading the matrix:
- **GREEN today (3 arms):** NULL column plus a plain raised read, because the epilogue's `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:` stamps `fills_anchor_iso` (the run's seed) into the NULL column. Keep as regression pins; record the deviation from SC-1's wording in the SUMMARY.
- **Set column plus a plain raise is RED** although a Phase 232 comment calls it the pre-251 class: `fills_anchor_iso` is only set when the column is NULL, so a set column gets `p_last_fetched_ts = None`.
- **The "trunc" row for Bybit and Deribit in the raw scratch output is not a loss.** Neither venue can return a truncated-but-successful read (see the clear-predicate table), so that fixture is a clean read; ignore those scratch lines. Only OKX `sync_truncated_okx` is a real partial read.
- **Deribit RED is a seam artefact:** the production Deribit read ignores `since_ms` (below). The gate observes `since_ms` handed to `fetch_raw_trades`, which is what SC-1 literally names.

How the existing harnesses drive two runs and observe `since_ms` (all [VERIFIED: Read this session]):
- `tests/test_okxtrades_cursor.py::_run_job` drives the REAL `run_sync_trades_job`, patching `_exchange_preflight`, `fetch_all_trades` (daily read, `daily_trades=` makes the `sync_trades` RPC fire), `fetch_usdt_balance`, `fetch_raw_trades` (an `AsyncMock`), `db_execute` and `_RAW_TRADE_INGESTION_ENABLED`; `exchange=` sets `key_row["exchange"]` (this is the only venue switch, since the fetch is patched). `raw_error=` makes `fetch_raw` raise.
- It asserts `result.outcome == DispatchOutcome.DONE`, so 429 and cancel arms must be wrapped: `with pytest.raises(ccxt.RateLimitExceeded)` and `with pytest.raises(asyncio.CancelledError)` around `_run_job` (the pattern at `test_binancefills_cursor.py` `test_cr02_...`). The 429 run also issues `stamp_api_key_429`. A cancel is simulated by `raw_error=asyncio.CancelledError()`; a mid-persist cancel by `_cancel_the_second_persist(sb)`.
- `since_ms` is `out.fetch_raw.call_args.kwargs["since_ms"]` (with `pytest.raises` arms the `AsyncMock` still holds the call, but `_run_job` returns nothing then, so hand-type run 1's seed as the Binance cursor tests do). `_two_run_walk_start_ms(out2)` = `since - ex.OVERLAP_WINDOW_MS`, or `-1` for None.
- The Supabase fake is STATELESS across runs: run 2 needs a fresh `_make_supabase(trades_rows=...)` with the moved daily row appended, `flags=` shared, and `bounds=` shared (`RereadBounds`). The column for run 2 is `column_after_advance(column, stamp)` where `stamp = rec1.advance_params[0]["p_last_fetched_ts"]` (None if the epilogue never ran). Persisted fills become stored rows via `_persisted_fills(rec1, STRATEGY_ID)` (`test_binancefills_cursor.py`).
- Pin the clock with an autouse `monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS)`; `test_binancefills_cursor.py` does (`NOW_253_MS = 1784116800000`), `test_okxtrades_cursor.py` does not, so a new module must.

First-sync arm criterion (the seed is None in run 1): with the fix, run 2's `since_ms` is the reach anchor, not None. The assertion is `run2 since - OVERLAP_WINDOW_MS <= run 1's reach anchor`, hand-typed under the pinned clock: OKX 1776081600000 (2026-04-13T12:00Z), Bybit 1752580800000 (2025-07-15T12:00Z), Deribit 0. Do not assert `since is None`.

## Per-venue fills walk (answer to required question 2)

| | OKX | Bybit | Deribit |
|---|---|---|---|
| Entry | `_fetch_raw_trades_okx` over `_OKX_FILL_INST_TYPES` | `_fetch_raw_trades_bybit(category="linear")` | `fetch_deribit_fills` (delegate) |
| Seed handling | `fetch_raw_trades` passes `since_ms - OVERLAP_WINDOW_MS`; OKX sends `begin = that` on EVERY page `if since_ms:` | same subtraction; windows start at exactly that instant | **`since_ms` is accepted and ignored** |
| `since_ms=None` | no `begin`: venue's default window, newest first, back to its documented 3-month reach | `start = now - 365 days` (`default_lookback_days`) | the same full history crawl |
| Reach clamp | none in code; an old `begin` is sent as is | none; a start older than 730 days raises `BybitTradeWindowIncomplete("start_too_old")`, never clamped | none (no documented reach) |
| Windows | none; `after=<tradeId>` cursor, DESC | 7-day windows `[start, now]`, `endTime` on every request, `nextPageCursor` | `start_id` id-cursor, `sorting=asc`, `historical=true`, `count=1000` |
| Page cap | 100 pages x 100 rows per instType (`PAGE_CAP = 100`), oldest rows unread on a hit | 200 pages per window, then RAISES | none (stops on a short page with `has_more` false) |

Verbatim code values [VERIFIED: Read `analytics-service/services/exchange.py` and `services/deribit_ingest.py` this session]:
- `exchange.py:160` `OKX_BILLS_REACH_DAYS: int = 93` (comment: "Longer than any calendar three months (92 days at most), the archive's documented reach").
- `exchange.py:182` `BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS: int = 365`; `exchange.py:191` `BYBIT_EXECUTION_HISTORY_DAYS: int = 730` (comment: "A start older than this is refused before any request, never clamped").
- `exchange.py:507` `_OKX_FILL_INST_TYPES: tuple[str, ...] = ("SWAP", "FUTURES", "SPOT", "MARGIN")`; `exchange.py:3052` `PAGE_CAP = 100`; `exchange.py:686` `OVERLAP_WINDOW_MS = 3_600_000`; `exchange.py:2560-2563` the overlap is subtracted once, in `fetch_raw_trades`, for every venue.
- `deribit_ingest.py:3178` `TRADES_PAGE_COUNT: int = 1000`; `fetch_deribit_fills` docstring: "`since_ms` is accepted for signature parity with the other `_fetch_raw_trades_*` producers; the id-cursor crawl is full-history (`historical=true`) and dedups downstream on `exchange_fill_id`."
- `job_worker.py` passes `read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S` to every venue; only Binance reads it ("the other venues ignore it").

Venue API documentation read (founder rule: OKX investigations read the venue docs):
- **OKX** `GET /api/v5/trade/fills-history`. The official page (`https://www.okx.com/docs-v5/en/#order-book-trading-trade-get-transaction-details-last-3-months`) could NOT be read: the fetched copy of the page text ends (about 400k characters) before the Trade REST section, the same limitation Phase 167.2.1.1.2.1 and Phase 173 recorded. What was confirmed second-hand: the endpoint is the "last 3 months" endpoint (ccxt 4.5.64 `fetch_my_trades` docstring links that anchor; the `okxr` R wrapper documents "Retrieve historical filled transaction details from the last 3 months", `begin`/`end` in ms, `after` = "Pagination cursor for earlier records", `before` = newer, `limit`); ccxt's request comment: `'limit': limit,  # default 100, max 100` and "okx will return the n most recent results" when `limit` is sent without `since`. Order is newest first, as `_fetch_raw_trades_okx_inst_type`'s own comment says ("OKX fills-history returns DESC-sorted data; `after=<tradeId>` fetches records OLDER than the cursor"). [CITED: ccxt okx.py docstring (installed 4.5.64); https://rdrr.io/cran/okxr/man/get_trade_fills_history.html; `.planning/milestones/v1.20-phases/167.2.1.1.2.1-*/167.2.1.1.2.1-RESEARCH.md:222-227`] Behaviour of an out-of-reach `begin` (older than 3 months) is not documented in anything read: see Assumptions A1.
- **Bybit** `GET /v5/execution/list` (`https://bybit-exchange.github.io/docs/v5/order/execution`): "startTime and endTime are not passed, return 7 days by default"; "Only startTime is passed, return range between startTime and startTime+7 days"; "If both are passed, the rule is endTime - startTime <= 7 days"; limit "[1, 100]. Default: 50"; cursor via `nextPageCursor`; results "sorted by execTime in descending order"; page title "Get Trade History (2 years)". The page gave no text for the error on an older start, so the repo's 730-day `start_too_old` refusal rests on the "(2 years)" title plus the code comment ("retCode 10001"). [CITED: bybit-exchange.github.io/docs/v5/order/execution]
- **Deribit** `private/get_user_trades_by_currency` (`https://docs.deribit.com/api-reference/trading/private-get_user_trades_by_currency`): `count` min 1, max 1000, default 10; `start_id` / `end_id`; `start_timestamp` "cannot be combined with a start_id"; `historical` default false: "Returns recent records: orders for 30 min, trades for 24h"; true: "Fetches historical records, available after a short delay due to indexing. Recent data is not included."; the page does not state how far back historical data goes; `has_more` has no further description. [CITED: docs.deribit.com] Consequence: a Deribit read with `historical=true` omits the most recent trades by documentation, and it re-reads all history each run, so there is no skipped span from the seed.

### Recommended provisional-bound value for a None seed, and covers derivation

| Venue | `_reach_anchor_ms` (taken BEFORE the read) | Never later than the real walk start because | `_walk_start_ms` | `covers_from` |
|-------|--------------------------------------------|----------------------------------------------|------------------|---------------|
| OKX | `now - 93 days` (`OKX_BILLS_REACH_DAYS` value; add a named `OKX_FILLS_REACH_DAYS = 93`) | the venue's own reach is at most 3 calendar months (92 days) from the same or a later clock | `seed - OVERLAP_WINDOW_MS`, or the anchor when seed is None | `"-infinity"` iff seed is None or walk start <= anchor, else the walk start ISO (the existing expression) |
| Bybit | `now - 365 days` (`BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS`) — NOT 730 | the read's own `start = now_read - 365d` with `now_read` taken after the anchor (Bybit uses `time.time()` directly, so the anchor and the read share a clock in production) | same | same |
| Deribit | `0` (epoch): the read is full history, the seed is moot | no finite instant is "earlier than full history"; 0 is the honest bound and the later `since_ms=0` is ignored by `fetch_deribit_fills` (prototype run 2 `since_ms` 0 and the read double proved the path) | same (cosmetic) | same; optionally always `"-infinity"` because every Deribit read covers all history |

Why `covers` can stay one expression for the new venues: a stored bound B is always at or above the seed (the seed is `min(..., B)`), so `walk_start = seed - 1h < B`, so `covers <= B` and a complete run takes R6. The "older than the reach is unreachable" argument that motivated `-infinity` for Binance (the read clamps to a reach) does not change the outcome for these venues. [VERIFIED by prototype: clean runs on all three venues leave `bounds.rows == {}`; the two epilogue calls were `unread=None, covers='2026-05-06T23:00:00+00:00'`]

The Bybit first-sync reach is a product choice (365 days), not a venue limit (730). A repeated None-seed run on Bybit therefore walks from its OWN clock minus 365 days and does not re-cover the sliver `[now1-365d, now2-365d)`. That sliver is older than any first sync ever reads, so it is not a skipped span by the product's own rule; record it in the SUMMARY, do not "fix" it.

## Clear predicate (answer to required question 3)

What each fills read can raise, set or swallow, and what it means for "complete through the walk start". `_fills_incomplete` already ORs any `sync_truncated_*` and `binance_partial_symbols` into the cursor HOLD for every venue (`job_worker.py:2735-2739`); the NEW predicate is `_earliest_through()` (it decides keep versus R6 clear).

| Venue | Condition | Where | Surfaces as | Means "not complete through walk start"? | Bound action |
|-------|-----------|-------|-------------|------------------------------------------|--------------|
| OKX | page cap hit on any instType (100 pages, oldest rows unread, newest returned) | `_fetch_raw_trades_okx` | returns fills + flags `sync_truncated_okx=True`, `sync_truncated_okx_pages=<int>` | **YES** | keep: `walk_start - 1` |
| OKX | any request error on any page of any instType | `_fetch_raw_trades_okx_inst_type` `except Exception: raise` | the whole read raises (no partial return) | YES | `phase2_failed` -> keep |
| OKX | `RateLimitExceeded` | same, re-raised by the worker | outer 429 arm, no epilogue | YES | provisional row stands (the seed) |
| OKX | fill dropped (unparseable `ts`, non-finite price/size, bad post-rescale amount) | `continue` after a logged `ERROR` | nothing: no flag, no raise | would be YES, but deterministic: a re-read drops it again | not detectable; record as a known silent drop (not the seed's fault) |
| OKX | "Pagination stuck on cursor" (`not new_cursor` or repeated cursor) | `natural_break = True` | nothing: silent early stop | possibly YES | **undetectable**; a residual to record, outside SC-1 |
| OKX | `okx_unknown_ctval`, `fee_currency_mismatch*` | informational | flags only | NO | do not keep |
| Bybit | page cap, stuck cursor, malformed reply, unreadable fill row, start older than 730 days | `_fetch_raw_trades_bybit` | ALWAYS raises `BybitTradeWindowIncomplete` (it also records `sync_truncated_bybit*` first, but the worker's `except Exception` arm drains and DISCARDS the buffer) | YES | `phase2_failed` -> keep |
| Bybit | non-fill rows (Funding, Settle, ...) or a finite zero/negative quantity skipped | logged skip | nothing | NO (not fills by the repo's rule) | none |
| Bybit | any request error / 429 | `_fetch_page` re-raise | raise / outer 429 arm | YES | keep / provisional row |
| Deribit | `-32602` non-margin currency | `fetch_deribit_fills` `continue` | scrubbed WARNING only | NO (a permanent, expected skip of a currency that has no fills for that wallet type) | none |
| Deribit | `10028` rate limit | `paginate_trades_id_cursor`, up to `TRADES_MAX_RETRIES = 8`, then raises | raise | YES | keep |
| Deribit | any other error, `CurrencyEnumerationError` | propagates | raise | YES | keep |
| Deribit | `historical=true` omits recent trades (indexing delay) | venue behaviour | nothing | NO for the seed (the next run re-reads everything) | none |
| any | persist batch failure | worker epilogue | `phase2_failed` | YES | keep |
| any | `_record_dq_flag` never raises, so a LOST `sync_truncated_okx` would read as complete | `exchange.py:286-` | silent | YES but not detectable | accept (same trust as Binance's stop record, which holds when its bound is unusable; OKX has no companion field to cross-check) |

**Predicate for OKX, Bybit and Deribit:** keep the bound (`walk_start - 1`) when `phase2_failed` OR any `sync_truncated_*` flag is truthy; otherwise the read is complete and R6 may clear. Nothing else on these venues is observable. Deribit and Bybit never return a flagged partial read (they raise), so for them the predicate collapses to `phase2_failed`. Binance's branch (`binance_read_through_ms`, `binance_partial_symbols`, the stop-without-bound hold) stays Binance-only and byte-identical.

Does a truncated or partial NON-Binance read leave a span the next seed skips? **Yes, for OKX, measured**: SET column ahead of the stored fills, `sync_truncated_okx` true, one fill persisted at the newest end: on origin/main run 2's `since_ms` is 1781913600000 (the column) against run 1's seed 1778112000000 (RED), because the newest stored fill moves the `min(column, fill high-water)` seed while the column is held; and on a first sync it is RED too. With the generalised predicate both go GREEN (prototype: `okx set trunc` and `okx null trunc` GREEN, `okx first trunc` is the same first-sync class). So CONTEXT's "include it" branch applies: include `sync_truncated_*` with the same epilogue predicate and add one OKX truncated arm per column kind. Side effect to document: a persistently capped OKX key keeps its bound for ever (the column hold behaves the same today), and the bound walks one hour earlier per consecutive failed run (`unread = walk_start - 1` goes through R4), exactly as Binance does.

## Exact code edit sites (answer to required question 4)

All line numbers are in the UNMODIFIED `analytics-service/services/job_worker.py` of this worktree. [VERIFIED: Read this session]

| # | Site (lines) | Today | Change |
|---|--------------|-------|--------|
| 1 | 2257 | `_binance_read = False` | add `_bound_read = False` beside it |
| 2 | 2403-2409 | `if ctx.key_row.get("exchange") == "binance": _reach_anchor_ms = ...; _binance_read = True` | per-venue anchor as in Pattern 1; `_bound_read = _reach_anchor_ms is not None`; Binance branch unchanged |
| 3 | 2413-2432 | NULL-column None-seed anchor only `elif ... == "binance"` | **leave Binance-only** (see Decision D2) |
| 4 | 2446 | `if _binance_read:` (bound read, third term of the seed) | `if _bound_read:` |
| 5 | 2491 | `if _binance_read and _reach_anchor_ms is not None:` (defines `_set_bound`, provisional write, fail-closed `except`, orphan branch) | `if _bound_read and _reach_anchor_ms is not None:`; make the two log texts venue-neutral ("re-read bound", not "Binance re-read bound") |
| 6 | 2560-2563 | orphan arm sets `_binance_read = False` | also `_bound_read = False` |
| 7 | 2776 | `if _binance_read and _reach_anchor_ms is not None:` (`_walk_start_ms`, `_covers_from_iso`, `_earliest_through`) | `_bound_read and ...`; `_earliest_through` gets the non-Binance branch (Pattern 1) |
| 8 | 3041 | `if _binance_read and _reach_anchor_ms is not None:` (epilogue `_unread_from_ms`, `_set_bound`) | `_bound_read and ...` |
| 9 | 3054-3068 | `binance_stop_below_cursor` write | add `_binance_read and` to the condition |
| 10 | 3078-3093 | failed epilogue write: `exchange_dq_flags["binance_stop_below_cursor"] = True` | `if _binance_read:` around the flag write (the `logger.error` stays, venue-neutral text) |
| 11 | 3247-3255 | `clear_absent_binance_sync_flags` gate `_binance_read and not phase2_failed ...` | **unchanged** |
| 12 | `services/trade_resume.py` `load_strategy_fills_reread_bound` docstring | "this strategy's Binance fills re-read bound" | wording only |
| 13 | `fetch_raw_trades` call (2648) | passes `read_deadline_s=BINANCE_SYNC_FILLS_READ_DEADLINE_S` to every venue | unchanged (ignored off Binance) |

The stamp logic (`_fills_incomplete`, `_read_through`, `_fills_stopped`, the `advance_fetched_cursor` gate, the anchor `elif`s at 3013-3032) is venue-agnostic and untouched: that is why `advance_sync_cursor` params do not change.

**Confirmed venue-agnostic, no migration:** the table `strategy_fills_reread_bounds` has columns `strategy_id`, `api_key_id`, `unread_from`, `updated_at` and no exchange column; `set_strategy_fills_reread_bound` takes `(p_strategy_id, p_api_key_id, p_job_id, p_claim_token, p_unread_from, p_covers_from)` and contains no exchange predicate; the strings "Binance" appear only in comments and `COMMENT ON` text. `load_strategy_fills_reread_bound` selects `api_key_id, unread_from` by `strategy_id` only. [VERIFIED: Read `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` and `services/trade_resume.py` this session] `unread_from` is `TIMESTAMPTZ NOT NULL`: epoch 0 (`1970-01-01T00:00:00+00:00`) is storable and `parse_since_ms` reads it back as 0 (prototype run 2 `since_ms` = 0).

### Decisions the planner must make (research recommendation in bold)
- **D1 Deribit treatment.** Production Deribit is structurally safe (full-history re-read), so extending the bound there is a no-op in effect. **Recommended: treat it uniformly (anchor 0, same code path)** so the three-venue SC-1 gate is literal and RED to GREEN, and say in the code comment that its read ignores the seed. The alternative (exclude Deribit and reword SC-1) needs a ROADMAP edit and a deviation note; not recommended.
- **D2 None-seed NULL-column anchor for OKX/Bybit.** Binance writes a reach-anchored `fills_anchor_iso` on a first sync (Phase 250 CR-01). **Recommended: leave it Binance-only**, because the bound already covers the SC-1 first-sync arms and no new column write is introduced (the existing `test_a_bootstrap_refusal_with_no_seed_writes_nothing` stays valid). Cost: the first-sync half of the RPC-down residual stays open on OKX/Bybit (measured below). Generalising it for OKX and Bybit only (never Deribit: an epoch-0 anchor would write 1970 into a shared per-key column) closes that half for about six lines and one intent-change on that test; acceptable but optional.
- **D3 Named constants.** **Recommended:** put `OKX_FILLS_REACH_DAYS = 93` and reuse `BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS` in `services/exchange.py` next to `BINANCE_FILLS_REACH_DAYS`, with a one-line helper returning the anchor or None, so the worker holds no magic numbers.

## Test census (answer to required question 5)

Measured, not guessed: the prototype was run against every test file that names `run_sync_trades_job` or `_RAW_TRADE_INGESTION_ENABLED`, plus `test_stamp_io_exhaustive.py`, `test_binance_sync_flags.py`, `test_fetch_trades_resume_seed.py`. Baseline (unmodified worktree): `830 passed, 13 skipped`. Prototype: `13 failed, 817 passed, 13 skipped`. One of the 13 is a scratch-copy artefact (`test_no_contact_support_copy.py` shells out to `git ls-files` and the scratch copy is not a git checkout: `CalledProcessError ... exit status 128`), so **12 real breaks**. After patching the three fakes in the copy, those 9 passed (`62 passed` over the three files). [VERIFIED: scratch runs this session]

| File | Tests (count) | Why they break | Fix |
|------|---------------|----------------|-----|
| `tests/test_sync_trades_resume_seed.py:130-134` | `test_fresh_last_sync_at_and_no_fills_cursor_reach_back_to_stored_day`, `test_failed_high_water_read_gives_full_reach_on_both_reads`, `test_fills_cursor_governs_the_fills_read_only` (3) | fake `_rpc` answers `data=True if name == "advance_sync_cursor" else 0`; the new `set_strategy_fills_reread_bound` call reads `0` = orphan, so the fills read is skipped ("Expected mock to have been awaited once. Awaited 0 times") | answer True for `set_strategy_fills_reread_bound` too |
| `tests/test_sync_trades_store_truth.py:310-313` | `TestStoreOrder::test_store_before_balance_and_fills_walk`, `test_cancelled_fills_walk_keeps_the_daily_store`, `test_cancelled_fills_walk_raising_keeps_the_daily_store`, `TestFlagWrite::test_persist_failure_stamps_persist_failed_flag[ingestion_on]`, `TestOwnedKeyReplacement::test_clean_read_pops_every_owned_key[ingestion_on]` (5) | same fake shape: orphan answer holds the daily store and skips the read | same one-line fix (the order assertions use `rec.events`; they pass once the bound RPC is owned) |
| `tests/test_ana_recon_audit.py:495-499` | `test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance` (1) | same fake shape; `p_last_fetched_ts` asserted `'2026-06-01T09:00:00+00:00'`, got None | same one-line fix |
| `tests/test_binancefills_cursor.py` | `TestBinanceFillsCursorGate::test_an_okx_run_makes_no_bound_read_and_no_bound_write` (L349), `::test_a_raised_okx_read_never_sets_a_binance_flag` (L482), `TestRereadBoundAcrossRuns::test_d04_a_stop_run_calls_advance_sync_cursor_with_the_same_params_on_every_venue` (L1038) (3) | assert `bounds.calls == [] and bounds.reads == 0` for an OKX run (Phase 253 D-04 "the bound is Binance-only") | the documented intent change: invert to "an OKX run makes exactly the provisional and the epilogue write (`len(bounds.calls) == 2`) and one bound read", keep their other assertions (no `binance_*` key on an OKX run; the six-key `advance_sync_cursor` set; `p_last_fetched_ts == "2026-06-02T09:00:00+00:00"`), add a dated note citing Phase 255 |

Not impacted (measured green on the prototype): `test_okxtrades_cursor.py` (its `_make_supabase` already routes the bound RPC to `RereadBounds`), `test_binancefills_e2e.py`, `test_sync_trades_preserves_fills.py`, `test_sync_trades_enqueue_failure_bridge_live.py`, `test_job_worker.py` (its fake answers `else 2`, truthy, so owned), `test_mt5_sync_path.py`, `test_mt5_handover.py`, `test_failed_status_logged.py`, `test_exchange.py`, `test_stamp_io_exhaustive.py` (it broke in Phase 253 because of a new guarded flag read; Phase 255 adds no read of that kind), `test_binance_sync_flags.py`, `test_fetch_trades_resume_seed.py`. `grep -a` of every `*.py`, `*.ts`, `*.sql`, `*.mjs`, `*.yml` for `set_strategy_fills_reread_bound`, `load_strategy_fills_reread_bound`, `strategy_fills_reread_bounds`, `RereadBounds`: Python hits are `tests/test_binancefills_cursor.py`, `tests/test_okxtrades_cursor.py`, `tests/_binance_fills.py`, `services/binance_sync_flags.py`, `services/trade_resume.py`, `services/job_worker.py`; the rest are the migration, its down file, `supabase/tests/test_strategy_fills_reread_bound.sql`, `supabase/schema/*`, `scripts/dump-sql-functions.ts`, `scripts/baseline-content-drift-check.mjs` and three `src/__tests__` mutation-gate tests, none of which read the Python gating. A new fake added by the planner must answer True for the bound RPC (or use `RereadBounds`) or it silently turns every OKX/Bybit/Deribit run into an orphan run that skips its read: this is the single most likely trap for any other suite that drives `run_sync_trades_job` with a hand-rolled RPC fake.

## Residual `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` (answer to required question 6)

**Reachable on all three venues after this phase, measured.** Prototype, bound RPC raising in run 1 (the fail-closed arm skips the read and holds the daily store), then a cron-style daily row for 2026-07-14 appended before run 2 with the RPC back: SET column, run 2 `since_ms` 1781913600000 against run 1's seed 1778112000000, `phase2_fill_ingestion_failed` cleared by the clean run, on OKX, Bybit and Deribit; first-sync, run 2 `since_ms` 1783987200000 vs a None seed, flag cleared, on all three. The NULL-column-with-seed variant is NOT reachable: the existing bootstrap anchor stamps run 1's seed (`run2 since_ms` 1778112000000). [VERIFIED: scratch run output `RESIDUAL ...`] Deribit's real impact is nil (full re-read); OKX and Bybit are real.

It is bounded: the migration is already in PROD (the baseline carries the table and function, see Environment Availability), so the trigger is a PostgREST/RPC outage longer than a cron cycle or a rollback of `20261126150000`. Net effect of the phase: the always-on SC-1 hole becomes an outage-only residual.

**Is the entry's fail-closed fix small? No.** "Refuse the ccxt raw ingestion when the RPC is missing" does not touch the mechanism: `cron_sync` and `/fetch-trades` store daily rows without consulting the bound, so refusing Phase 2 in the worker still lets the daily high-water move, and the next healthy run seeds past the span and clears the flag. A real fix needs either a durable marker the recovering run can read (the only existing durable write that survives an RPC outage is `strategy_analytics.data_quality_flags`, and CONTEXT forbids a new public key there) or the cron path reading the bound (a router change, out of scope). **Recommendation: do not include it; rewrite the entry's scope (OKX, Bybit and Deribit, PROD has all three), owner and trigger in the ship PR and report the decision item to the founder**, as CONTEXT already prescribes.

## SC-2 pin (answer to required question 7)

- **`advance_sync_cursor` has exactly one Python caller**: `_advance_cursor()` in the `run_sync_trades_job` epilogue (`job_worker.py:3396-3412`). `grep -a` over `services/`, `routers/`, `main.py` and `main_worker.py`: the only hits are `job_worker.py` lines 3388, 3397, 3424; `routers/cron.py:1606` is a comment. MT5 reaches the same epilogue (`test_mt5_sync_path.py:357` asserts the RPC), and the nightly cron path uses a different RPC family (`strategy_sync_cursors`). The CONTEXT list "OKX, Bybit, Deribit, MT5 paths, routers/cron.py" therefore collapses to one call site. [VERIFIED: grep this session]
- **Measured non-regression:** across the 36 matrix runs (3 venues x NULL / SET / first-sync x 429 / cancel / plain / truncated) the `p_last_fetched_ts` handed to `advance_sync_cursor` was identical before and after the prototype (`diff` of the extracted `stamp=` fields printed `IDENTICAL_STAMPS`). The call's six keys are `p_api_key_id, p_job_id, p_claim_token, p_last_fetched_ts, p_last_sync_at, p_account_balance` (pinned today by `test_d04_...`, `test_binancefills_cursor.py:1038-1066`).
- **The Binance pin** is `test_binancefills_cursor.py`: 72 tests; on the prototype 69 pass unchanged and the 3 failures are the OKX intent-change assertions above (every Binance arm passes unmodified, including the P0..P7 and R2-P0..P4 neuter families and the clear/orphan/failed-write arms).
- **Plan the SC-2 test as** one class in the new module: (a) parametrise venue (binance, okx, bybit, deribit) x {clean read with a fill, plain raise, truncated (OKX)} and assert the `advance_sync_cursor` param key set equals the six keys and `p_last_fetched_ts` equals a hand-typed golden value measured on origin/main; (b) assert non-Binance runs make exactly two `set_strategy_fills_reread_bound` calls (provisional with `p_covers_from` None, then epilogue) and Binance runs still make their existing count; (c) assert no `binance_*` key is written on a non-Binance run and `binance_stop_below_cursor` is never set off Binance; (d) keep `test_the_mirror_matches_the_sql_case_table` green (it pins the SQL arms the three venues now share).

## Common Pitfalls

### Pitfall 1: A hand-rolled RPC fake turns every non-Binance run into an orphan run
**What goes wrong:** a fake answering `data=0` (or any falsy) for unknown RPC names makes `bool(res.data)` False, which the provisional write reads as "orphan claim token": the read is skipped, the daily store held, and tests fail with "awaited 0 times".
**Why it happens:** the three fakes in the census were written when only Binance called the bound RPC.
**How to avoid:** use `RereadBounds` or return True for `set_strategy_fills_reread_bound`; the census above lists the three files.
**Warning signs:** `fetch_raw` never awaited; `p_last_fetched_ts` None where a stamp is expected.

### Pitfall 2: mypy narrowing lost by gating on the new flag alone
**What goes wrong:** `if _bound_read:` leaves `_reach_anchor_ms: int | None` un-narrowed, 6 strict errors.
**How to avoid:** keep `and _reach_anchor_ms is not None` in every gate (measured fix). CI runs mypy 2.4.0 (`requirements-dev.txt:53`) while the local binary is 2.0.0: run the CI command and treat a CI-only error as possible.

### Pitfall 3: Bybit anchor at the venue limit
**What goes wrong:** anchor = now - 730d makes run 2 raise `start_too_old` (see Anti-Patterns). **How to avoid:** 365d, and pin it with an arm whose run 2 clock is later than run 1's.
**Related:** a Bybit bound or column older than 730 days raises `start_too_old` on every run (existing behaviour for stale columns too; the bound only inherits it).

### Pitfall 4: first-sync read cost
A None-seed OKX or Bybit read after a failure is retried from the reach anchor (OKX 93 days, Bybit 365 days = 53 windows) instead of skipping ahead. With no `read_deadline_s` on these venues, a first sync too big for the handler's `asyncio.wait_for` cancels again and repeats rather than skipping, which is the intended integrity-over-liveness trade; say so in the SUMMARY.

### Pitfall 5: the bound creeps one hour per failed run
`unread_from = walk_start - 1 ms` goes through RPC R4 each failed run, so the stored bound moves earlier by `OVERLAP_WINDOW_MS + 1 ms` per consecutive failure (prototype plain-raise run 2 `since_ms` 1778108399999 = seed - 1 h - 1 ms). Binance behaves the same. Harmless over-fetch; do not "fix" it, and do not write `walk_start` instead (Phase 253 R2-P2: R7 would then never clear).

### Pitfall 6: first-sync arm assertion
Do not assert `since_ms is None` for run 2: with the fix it is the reach anchor.

### Pitfall 7: the clock seam
The matrix and every anchor assertion need `ex._now_ms` pinned; Bybit's real read uses `time.time()` and the fetch is patched in these tests, so the pin affects only the worker's anchor.

## Code Examples

### SC-1 two-run arm (scratch pattern that produced the matrix; adapt into the new module)
```python
# Source: analytics-service/tests/test_binancefills_cursor.py TestProvisionalBoundBeforeTheRead
# (the 429 / cancel / NULL-column arm) and tests/test_okxtrades_cursor.py harness.
bounds = RereadBounds()
sb1, rec1 = _make_supabase(trades_rows=DAILY_ONLY_TRADES, bounds=bounds)
with pytest.raises(type(raw_error)):          # ccxt.RateLimitExceeded("429") or asyncio.CancelledError()
    await _run_job(supabase=sb1, column=column, exchange=venue, raw_error=raw_error,
                   daily_trades=[{"date": "2026-07-14", "daily_pnl": 1.0}])
stamp = rec1.advance_params[0]["p_last_fetched_ts"] if rec1.advance_params else None
rows2 = DAILY_ONLY_TRADES + [{"strategy_id": STRATEGY_ID, "is_fill": False,
                              "timestamp": "2026-07-14T00:00:00+00:00"}]
sb2, _ = _make_supabase(trades_rows=rows2, bounds=bounds)
out2 = await _run_job(supabase=sb2, column=column_after_advance(column, stamp), exchange=venue)
assert _two_run_walk_start_ms(out2) <= RUN1_SEED_MS          # 1778112000000, hand-typed
```
Hand-typed instants already in the repo (verified by `datetime.fromtimestamp`): 1778112000000 = 2026-05-07T00:00Z, 1781913600000 = 2026-06-20T00:00Z, 1783987200000 = 2026-07-14T00:00Z, 1784116800000 = 2026-07-15T12:00Z.

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Per-key column only | per-strategy bound table, provisional write before the daily store | Phase 253 (v0.133.93.0) | Binance only |
| Binance-only gating | bound-tracked read for the four ccxt fills venues | this phase | closes `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` |

**Deprecated/outdated:** the TODOS entry's "Dormant today" bullet (switch is on in PROD, founder ruling 2026-11-26); `test_an_okx_run_makes_no_bound_read_and_no_bound_write`'s premise.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OKX `fills-history` accepts a `begin` older than its 3-month reach and simply returns what it holds (no error). The vendor page was unreachable; no source read states it. Today's worker already sends unclamped old `begin` values from stale columns | Per-venue walk; Pitfalls | If OKX errors on an out-of-reach `begin`, a failing OKX strategy whose bound ages past 3 months fails on every run and never clears. Mitigation if true: clamp the SENT `begin` to the 93-day reach (harmless, the venue cannot return older). Confirm with one OKX read-only probe through the founder's authorised PROD-read path before ship, or accept |
| A2 | The page-cap truncation order of the OKX read is "oldest unread" because the endpoint is DESC (`[CITED]` to ccxt/repo comments, not the vendor page; same status as Phases 167.2.1.1.2.1 and 173) | Clear predicate | If the venue paged ascending, `walk_start - 1` is still conservative (keeps the bound), so the predicate is safe either way |
| A3 | Deribit's documented `historical=true` omission of "recent data" is short (indexing delay) and irrelevant to the seed because the read is full-history each run | Per-venue walk | If the omission were long, recent fills would be stored late; they are still read on every later full re-read, so no span is skipped |
| A4 | The epoch-0 Deribit anchor is acceptable as a stored `unread_from` and never reaches another reader (the table is service-role only, deny-all RLS) | Edit sites | A reviewer may prefer a documented finite constant; the read ignores the seed either way |

## Open Questions

1. **OKX `begin` older than 3 months (A1).** What we know: the worker sends unclamped `begin` today. What is unclear: the venue's reply. Recommendation: accept as pre-existing, or probe once read-only.
2. **Generalise the None-seed column anchor to OKX and Bybit (D2)?** Recommendation: no for this phase (bound covers SC-1); revisit if the founder wants the first-sync half of the RPC-down residual closed.
3. **OKX "pagination stuck" silent early stop** (`not new_cursor` / repeated cursor): undetectable by the epilogue, outside SC-1. Recommendation: record in the SUMMARY as a known undetectable condition and book only if the reviewers rate it MEDIUM+ with a user-facing effect.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python / pytest | all tests | yes | 3.14.3 / 9.0.2 | — |
| ccxt | `ccxt.RateLimitExceeded` in arms | yes | 4.5.64 | — |
| mypy | CI type gate | yes (local) | 2.0.0; CI pins 2.4.0 | run the CI command; install the pinned version if a CI-only diff appears |
| Bound table and RPC in PROD | runtime | yes by repo evidence: `supabase/schema/baseline.sql` has 27 mentions of `strategy_fills_reread_bounds` and `baseline-carried-migrations.txt:361` lists `20261126150000_strategy_fills_reread_bound.sql`; baseline re-dump commits `fdcf4deb8` / `45d7b4e5c` say "after the PROD apply" | — | PROD and shared TEST were NOT touched this session |
| Live DB / Docker | none (Python unit tests only, no SQL change) | not needed | — | — |

Missing dependencies with no fallback: none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2, `asyncio_mode = auto` |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py -q` |
| Full suite command (CI) | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (`ci.yml` `python` job, line 5930) |
| Type gate (CI, verbatim) | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (`ci.yml:5751`; measured on the prototype: `Success: no issues found in 146 source files`) |
| Census command | `cd analytics-service && python3 -m pytest tests/test_ana_recon_audit.py tests/test_binancefills_cursor.py tests/test_binancefills_e2e.py tests/test_computation_error_provenance_census.py tests/test_exchange.py tests/test_failed_status_logged.py tests/test_job_worker.py tests/test_mt5_handover.py tests/test_mt5_sync_path.py tests/test_no_contact_support_copy.py tests/test_okxtrades_cursor.py tests/test_sync_trades_enqueue_failure_bridge_live.py tests/test_sync_trades_preserves_fills.py tests/test_sync_trades_resume_seed.py tests/test_sync_trades_store_truth.py tests/test_stamp_io_exhaustive.py tests/test_binance_sync_flags.py tests/test_fetch_trades_resume_seed.py -q` (baseline `830 passed, 13 skipped`, about 51 s) |

### Phase Requirements to Test Map
| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | 18 two-run arms (3 venues x NULL/SET x 429/cancel/plain) + first-sync arms + OKX truncated arms; run 2 walk start <= run 1 seed; the 3 NULL+plain arms recorded GREEN on origin/main | integration (real `run_sync_trades_job`, fake Supabase) | `python3 -m pytest tests/test_nullanchor_bound.py -q` | Wave 0 (new) |
| SC-1 mechanism | provisional write precedes `sync_trades`; clean run clears the row; bound-RPC failure skips the read and holds the daily store; orphan answer skips read and daily store; Bybit anchor is 365 d with a later run-2 clock | integration | same file | Wave 0 |
| SC-2 | six-key `advance_sync_cursor` params and golden `p_last_fetched_ts` per venue; non-Binance: exactly two bound calls, no `binance_*` key; Binance suite unchanged | integration | `python3 -m pytest tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py -q` | Wave 0 + existing |
| SC-3 | TODOS entry deleted, CHANGELOG names it | file check at ship | `grep -a -c '253-NULL-COLUMN-ANCHOR-ALL-VENUES' TODOS.md` must be 0 (the CHANGELOG entry still names it) | ship step |
| SC-4 | PROOF-01 neuters | manual-run, recorded in each SUMMARY | below | per plan |

### Sampling Rate
- **Per task commit:** the quick run command plus the mypy command above.
- **Per wave merge:** the census command (all 18 files) plus mypy.
- **Phase gate:** the CI `python` job command (full suite, coverage floor 80) green, plus mypy, before `/gsd-verify-work`.

### Proposed PROOF-01 neuters (each: byte backup outside the worktree, neuter, see RED with the NAMED arm, `cp` back, `cmp`, GREEN; never `git checkout/restore/stash`)
- **N1** make `_bound_read` false for OKX/Bybit/Deribit (the origin/main behaviour): every SC-1 arm except the three NULL+plain pins goes RED with its parametrised id named.
- **N2** drop the provisional write call: the 429 and cancel arms go RED.
- **N3** drop the non-Binance `sync_truncated_` / `phase2_failed` branch of `_earliest_through`: the OKX truncated arm and the plain-raise arms on a set column go RED (R6 clears a bound that must stay).
- **N4** Bybit anchor 730 days: the later-clock arm goes RED with `start_too_old`.
- **N5** provisional value `walk_start - 1` instead of the seed: the clean-run-clears-the-bound arm goes RED (R7), as Phase 253 R2-P2.
- **N6** let `binance_stop_below_cursor` be written on any venue (drop the `_binance_read` guard): the no-`binance_*`-on-OKX arm goes RED.
- **N7** make `_binance_read` true for every venue: the Binance-only clear/flag arms go RED.
- **N8** drop `_bound_read = False` in the orphan arm: the orphan arm goes RED (epilogue writes after an orphan).

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_nullanchor_bound.py` - new parametrised module (matrix, mechanism, SC-2 pin, pinned clock fixture)
- [ ] Update the three fakes and the three Binance-file assertions listed in the census (same wave as the code change, or every suite goes red at once)
- [ ] No framework install needed

## Security Domain

`security_enforcement` is absent in `.planning/config.json` (treated as enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes (data-tier) | the bound table stays service-role only: deny-all RLS, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; no migration, so no change. Do not add a public flag key (anon-readable `data_quality_flags`) |
| V5 Input Validation | yes | venue values never reach a flag or log verbatim: keep the existing scrubbing (`scrub_freeform_string`); the new log lines name the strategy and the exception class only |
| V6 Cryptography | no | — |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Orphaned worker (watchdog reclaim) writes a stale bound | Tampering | the RPC's claim-token fence (`WORKER_FENCE_V2`), already used by both bound writes |
| Venue string or symbol leaking onto the anon-readable flags surface (`[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]` class) | Information disclosure | no new key; bound failure reuses `phase2_fill_ingestion_failed` / `phase2_error` with a static text |
| Signed ccxt request text in logs on a read failure | Information disclosure | existing `scrub_freeform_string` in the venue modules; new worker log text carries no exception message |

## Sources

### Primary (HIGH confidence, read this session)
- `analytics-service/services/job_worker.py` (run_sync_trades_job 2217-3500), `services/exchange.py` (reach constants, OKX/Bybit/Deribit reads, `fetch_raw_trades`), `services/exchange_pagination.py` (`walk_paginated`), `services/deribit_ingest.py` (`paginate_trades_id_cursor`, `fetch_deribit_fills`, `_build_trades_params`), `services/trade_resume.py`
- `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql`; `tests/_binance_fills.py`, `tests/test_okxtrades_cursor.py`, `tests/test_binancefills_cursor.py`
- `.planning/phases/253-*/253-REVIEW-R3.md` (the path table), `TODOS.md` entries, `.github/workflows/ci.yml:5751,5930`, `analytics-service/pytest.ini`, `requirements-dev.txt:53`
- Scratch measurements: `$SCRATCH (the session scratchpad)` (`test_matrix_scratch.py`, `test_extra_scratch.py`, `proto_patch.py`, `census_run.txt`, `wt/` the patched copy). Nothing in the repo was modified.

### Secondary (MEDIUM confidence)
- https://bybit-exchange.github.io/docs/v5/order/execution (GET /v5/execution/list; summarised fetch)
- https://docs.deribit.com/api-reference/trading/private-get_user_trades_by_currency (summarised fetch)
- ccxt 4.5.64 `okx.fetch_my_trades` docstring and request comments (installed package); https://rdrr.io/cran/okxr/man/get_trade_fills_history.html

### Tertiary (LOW confidence, flagged)
- OKX official `fills-history` page: NOT readable through the fetch tool (page text ends before the Trade REST section); reach and ordering are second-hand. Same gap recorded by Phases 167.2.1.1.2.1 and 173.
- The `gsd-tools` research-plan / research-store seam and Context7 were not used (Context7 needs authentication; the questions were repo-internal or answered by direct vendor-doc fetches).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages.
- Architecture and edit sites: HIGH, read and prototyped (mypy strict clean, matrix GREEN, census measured).
- Venue reach and clear predicate: MEDIUM, in-repo code is verbatim, vendor docs partly second-hand (A1, A2).
- Pitfalls: HIGH for the measured ones (orphan fake, mypy narrowing, Bybit 730 d), MEDIUM for the OKX out-of-reach `begin`.

**Research date:** 2026-11-26
**Valid until:** 2026-12-10 (the file is hot: re-measure the matrix at HEAD before executing, and re-check the three fakes if another phase lands a new `run_sync_trades_job` driver)
