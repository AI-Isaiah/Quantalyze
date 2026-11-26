# Phase 251: SYNCSTORE - Research

**Researched:** 2026-11-26
**Domain:** `analytics-service` queued sync handler (`run_sync_trades_job`), Supabase `strategy_analytics.data_quality_flags` read-modify-write, venue daily-P&L read verdicts (OKX/Binance/Bybit)
**Confidence:** HIGH on the code and test findings (every one read or run this session); MEDIUM on PostgREST jsonb upsert semantics and on whether Deribit keys reach this handler (tagged `[ASSUMED]`, see Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Item 1: store order
- The Phase-1 store (`sync_trades` RPC on the daily rows) moves to right after the Phase-1 read, its flag drain and the refusal check (item 2), and before `fetch_usdt_balance` and the Phase-2 fills walk. A Phase-2 failure or cancellation (the dispatcher's `asyncio.wait_for(handler(job), timeout=TIMEOUT_PER_KIND["sync_trades"])`, 15 minutes) then can no longer lose that run's daily P&L. The RPC's own failure handling (`phase1_failed`) is unchanged.
- The `data_quality_flags` write stays in its one existing place at the end of the handler. A run that is cancelled after the store therefore loses its flag write. That is accepted: the cancelled run is FAILED in `compute_jobs`, `last_sync_at` is not advanced (the epilogue never ran), and the next run re-reads from the stored high-water and re-derives the flags.
- The sentence in `sync_trades`'s comment block saying Phase 1 failure "must NOT abort Phase 2" stays true: Phase 2 still runs after a Phase-1 persist failure.

### Item 2: no store under a refusal
- The reader is the existing shared `services.exchange.daily_pnl_read_verdict` (the one the derive uses, held in parity with the cron's `_fetch_degradation` by `tests/test_daily_pnl_read_verdict.py`). No fourth predicate is written.
- Deadline flags: the queued call passes no `read_deadline_s`, so `daily_pnl_deadline_*` cannot be stamped on this path today. If one ever is, the verdict names it as a reason and the run refuses the store; that is the conservative direction (the cron's prefix-store allowance is not imported).
- A refused read: stores nothing through `sync_trades`; holds `last_sync_at` (`_p_last_sync = None`); does not touch `phase1_failed`, so `phase1_daily_pnl_persist_failed` is never stamped for a read refusal (it would be untrue, the persist never ran); reports `trade_count` 0; holds the fills cursor exactly as a Phase-1 failure does (`advance_fetched_cursor` requires a non-refused Phase 1). The balance write and the follow-on enqueue are unchanged: the follow-on `derive_broker_dailies` re-reads the venue itself and refuses by name through its own `daily_pnl_read_verdict` arm, so a refused sync never publishes a figure the derive would not. The job outcome stays DONE (the cron's degraded tick is likewise not a job failure; the refusal is recorded in the flags).
- Rate limit: when `verdict.rate_limited`, the handler raises `ccxt.RateLimitExceeded` inside the exchange `try`, so the existing outer arm stamps `api_keys.last_429_at` and re-raises. This mirrors the derive (`run_derive_broker_dailies_job`), which does the same with the same verdict field.

### Items 3 and 4: the flag write
- The handler owns these refusal keys on `strategy_analytics.data_quality_flags`: the verdict's reason keys (`daily_pnl_fetch_error`, `daily_pnl_binance_income_fallback`, `daily_pnl_non_usd_okx`, every `daily_pnl_truncated_*` and `daily_pnl_deadline_*`) and their companions `daily_pnl_fetch_error_class` and `daily_pnl_unsupported_venue`. On every run where the ccxt Phase-1 read ran, the stored owned keys are replaced by this run's drained set: popped when the read is clean (item 3), written when it is refused (item 4).
- `daily_pnl_malformed_*` is NOT an owned key. The derive's pre-stamp owns it from a full-history read, and the sync's read covers only the span since the high-water, so a clean sync read is not evidence that the old malformed row is gone. The sync keeps today's behaviour for it (it still merges what it drained; it never pops it).
- `needs_flag_write` also holds when the ccxt Phase-1 read ran. That adds one `strategy_analytics` read per ccxt sync; the upsert runs only when a key actually changes (today's `write_needed` pattern). MT5 runs read no daily P&L and are unchanged.
- The write reuses the existing `_stamp_phase2_flags` upsert site. No new write site, so the provenance census (`EXPECTED_INERT_SITES`) is not moved. The planner must confirm this by grep and must check what the upsert creates when no `strategy_analytics` row exists yet (only on a refused first sync, since a clean run with no stored key has nothing to change): column defaults, the wizard poller, and the Phase 222 tail, which reads a zero-row conditional UPDATE as "no row".
- Where items 3 and 4 are measured: at the sync's own write (the criterion says so). The derive pre-stamp and the CSV runner rebuild `data_quality_flags` wholesale, so a sync-written key may be replaced seconds later when the chain completes; that is the derive's ownership and is out of scope. PROD reading, 2026-11-26 (marker query named PROD first): 0 `strategy_analytics` rows carry any `daily_pnl_*`, `phase1_*` or `phase2_*` key. This is a dated count; it fits item 4 alone and is not proof of the wholesale-rebuild mechanism.

### `[222-SYNCTRADES-REREAD-FAILED]`
- A re-read (`_strategy_has_published_numbers` after a zero-row conditional write) that raises returns DONE, with a log line that says the re-read failed after a zero-row write and nothing was written. The basis is the rule the same tail already applies at its first publish read: "an unreadable state is not 'nothing published'" and "a read hiccup must never unpublish a live strategy" (the `except read_exc` arm, residual T-222-13). The opposing reading, held by the 222 round-3 reviewer, is that FAILED is the better default because the no-row case is more common and DONE then leaves the row to the bridge's branch (c), 'complete' with no analytics. That outcome is the same T-222-13 residual Phase 222 already accepted for the identical unreadable condition, so the two arms are made consistent rather than split. 222's OQ4 ruling covers the published oracle, not this re-read, so this is a phase-level pick, not a reversal of a founder ruling.
- The write itself raising keeps FAILED: the first read said nothing was published and a failed write adds no evidence of publication. Only the re-read raising changes outcome, so the two must be told apart (separate `try` scopes).
- The misleading "wizard may still hang" log line is replaced with lines that name which call failed.
- Gate: a live-lane test in `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` that makes the re-read raise after a zero-row write over a published row and pins DONE with the row still published.

### Decided autonomously
- [Tests] Q: "How are the item tests driven?" → Selected: "Mocked-supabase handler tests beside test_sync_trades_preserves_fills.py and test_sync_trades_resume_seed.py, with _RAW_TRADE_INGESTION_ENABLED patched via monkeypatch (never importlib.reload)" — test files only.
- [Tests] Q: "How is the live-lane RED shown under the load limit?" → Selected: "No local Docker boot: the RED for the re-read outcome is shown on a mocked unit test of the same branch, and the live-lane test runs in CI's local-stack lane" — reversible; the live test can be run locally later.
- [Scope] Q: "Does the cron path change?" → Selected: "No, routers/cron.py already refuses degraded reads" — no code there.

### Claude's Discretion
- Exact helper shape for the owned-key set (a module constant beside the verdict, or a small predicate) is the planner's call, provided it reuses `daily_pnl_read_verdict` for the reason set.

### Deferred Ideas (OUT OF SCOPE)
- Whether the derive pre-stamp / CSV runner should carry the sync's refusal keys through their wholesale rebuild (so the flag survives a completed chain) is a derive-ownership question, out of scope here.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (ROADMAP `**Requirements**: TBD`). The contract is ROADMAP "Phase 251" success criteria 1-6.

| Criterion | Description | Research Support |
|-----------|-------------|------------------|
| SC-1 (item 1) | Phase-1 store before the Phase-2 walk; a cancelled walk leaves the store done | Q1, handler map, probe evidence (cancel loses the store today) |
| SC-2 (item 2) | refusal: no store, hold `last_sync_at`, no `phase1_daily_pnl_persist_failed`, `trade_count` 0, 429 arm | Q4, Q5, pitfalls P1-P4, probe evidence (spot fills stored today) |
| SC-3 (item 3) | clean read pops owned keys, spares `daily_pnl_malformed_*` | owned-key set, pitfalls P5-P7 |
| SC-4 (item 4) | flag OFF + refusal reaches `data_quality_flags`, `last_sync_at` held | probe evidence (no write today), pitfall P5 |
| SC-5 | re-read raise after zero-row write: DONE, live-lane pin, new log lines, TODOS entry deleted | Q6, code example 4 |
| SC-6 | PROOF-01 neuter / byte-backup restore | Validation Architecture |
</phase_requirements>

## Summary

All six criteria are changes inside one function, `analytics-service/services/job_worker.py::run_sync_trades_job` (line 2109 to 3071 at HEAD `acd04f587`), plus its tests. No migration, no new package, no new write site. The shared reader (`daily_pnl_read_verdict`) and the drain (`get_and_clear_last_dq_flags`) are already imported into `job_worker.py` (lines 126-127). The cron is already correct and is untouched.

The research found four traps CONTEXT does not name, each of which would redden an existing test or silently defeat a criterion. (1) `write_needed` is clobbered: the Phase-2 `else:` chain ends in `write_needed = False`, so any Phase-1 or owned-key `write_needed = True` computed before it is overwritten (measured: a Phase-1 persist failure with no other flag writes nothing today). (2) Once the flag read runs on every ccxt sync, a flag-OFF run whose read fails reaches the Phase-2 recovery arm and would write a `phase2_fill_ingestion_failed=False` payload that REPLACES the whole `data_quality_flags` column; the existing test `test_unreadable_publish_state_writes_nothing_and_returns_done` goes RED on that. (3) Two source-text pins on this function (`test_ana_recon_audit.py` lines 212-222 and 444-456) redden if the moved store keeps `except Exception as e` ahead of the first `except ccxt.RateLimitExceeded`, or if `_p_last_sync`'s `if not phase1_failed` text changes shape. (4) A Deribit key's daily read always carries `daily_pnl_fetch_error` + `daily_pnl_unsupported_venue`, so under item 2 every Deribit sync would be refused by name (see Open Question 1).

**Primary recommendation:** Implement in three small, separately testable edits to `run_sync_trades_job`: (a) in the ccxt arm, right after the existing daily drain, compute the verdict, raise on `rate_limited`, set `phase1_read_refused` on reasons, and otherwise run the moved `if trades:` store before `fetch_usdt_balance`; (b) rebuild the flag block so owned keys are replaced from the drained set with an accumulating `write_needed` and no write on a failed flag read; (c) split the tail's write and re-read into separate `try` scopes. Drive every criterion through one new mocked handler test file that plants flags through the real `_record_dq_flag` buffer, and add one `reread_raises` arm to the live bridge test.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Venue daily-P&L read and its quality flags | API / Backend (analytics-service `services/exchange.py`) | — | `fetch_daily_pnl` records `daily_pnl_*` into the per-task buffer; not touched |
| Refusal decision for a queued sync read | API / Backend (`run_sync_trades_job`) | — | reuses `daily_pnl_read_verdict`; no fourth predicate |
| Daily P&L persistence (`sync_trades` RPC) | Database / Storage | API / Backend | RPC deletes the payload's `[min,max]` span then inserts; a refused read must never reach it |
| `data_quality_flags` read-modify-write | API / Backend (handler) | Database / Storage | PostgREST upsert replaces the jsonb column; the handler must send the full merged object |
| Wizard / status display of the result | Browser / Client (`useStrategySyncPoller`) | Database (`sync_strategy_analytics_status` bridge) | consumers only; unchanged, but a flag-only row changes what they can read (Q2) |
| Job outcome (DONE/FAILED) | API / Backend (`dispatch` + `mark_compute_job_*` RPCs) | Database | tail outcome rule is the handler's; the bridge reacts |

## Standard Stack

### Core

No new libraries. Everything used already exists in the repo.

| Module | Version | Purpose | Why Standard |
|--------|---------|---------|--------------|
| `services.exchange.daily_pnl_read_verdict` / `DailyPnlReadVerdict` | in-repo (exchange.py:229-283) | the one reader of the drained daily-P&L buffer | used by the derive; parity-pinned to the cron and the OKX archive job by `tests/test_daily_pnl_read_verdict.py` |
| `services.exchange.get_and_clear_last_dq_flags` | in-repo (exchange.py:114-139) | drain the per-task ContextVar buffer | the existing drain at job_worker.py:2214 |
| `services.db.db_execute` / `db_read_with_retry` / `one` | in-repo | off-loop DB calls, retrying read, single-row narrowing | existing handler idiom |
| pytest 9.0.2, `unittest.mock` | installed (`python3 -m pytest --version`) | test runner and doubles | existing test idiom |
| mypy 2.0.0, `--strict` | installed | CI type gate on `services/` | `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py` printed `Success: no issues found in 1 source file` at baseline |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tests/test_okxtrades_cursor.py` fakes (`_FakeAnalytics`, `_make_supabase`, `_run_job`) | in-repo | a stored-flags-aware `strategy_analytics` double that models REPLACE-on-upsert | import or copy for the flag arms (repo precedent: `test_computation_error_provenance_census.py` imports from `test_computing_started_at_stamp.py`) |
| `tests/test_sync_trades_enqueue_failure_bridge_live.py::_drive` | in-repo | live-lane driver with `publish_race_row` | extend with one `reread_raises` parameter for SC-5 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| flag read through `db_execute` | `db_read_with_retry` | the existing `_load_existing_flags` uses `db_execute`; keep it, so the live test's `_racing_read` patch (keyed on `fn.__name__ == "_strategy_has_published_numbers"`) never sees the flag read |

**Installation:** none.

**Version verification:** no packages are added; nothing to verify against a registry.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. `gsd-tools query package-legitimacy check` was not run because there is nothing to check.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

Target flow of `run_sync_trades_job` (the new or moved steps are marked `NEW` or `MOVED`):

```
compute_jobs claim -> dispatch(kind="sync_trades") -> asyncio.wait_for(handler, 15 min)
  |
  v
_exchange_preflight (strategy + key + breaker + decrypt)      [DEFERRED/FAILED returns unchanged]
  |
  v   try:  (exchange open; finally: aclose_exchange)
  +-- Mt5Session ------------------------------------------> trades=[], balance via account_info
  |                                                           (no read, no store, no flag read: unchanged)
  +-- ccxt:
        load_strategy_high_waters -> daily_since_ms
        fetch_all_trades(since_ms=daily_since_ms)   (no read_deadline_s => no deadline flag possible)
        daily_pnl_dq_flags = get_and_clear_last_dq_flags()  -> exchange_dq_flags
        NEW verdict = daily_pnl_read_verdict(daily_pnl_dq_flags)
          |-- verdict.rate_limited --> raise ccxt.RateLimitExceeded --> outer except:
          |                            _stamp_429 -> drain -> re-raise -> dispatch classifies transient
          |-- verdict.reasons ------> phase1_read_refused = True  (no store; phase1_failed untouched)
          '-- clean ----------------> MOVED: if trades: sync_trades RPC   (own try/except -> phase1_failed)
        fetch_usdt_balance
        Phase 2 fills walk (flag-gated; failure never aborts Phase 1; cancelled here => store already done)
  |
  v   finally: close exchange
Phase-2 persist (raw fills upsert, unchanged)
  |
  v
flag block   NEW needs_flag_write also when ccxt Phase-1 read ran:
   load flags (db_execute) -> replace owned keys from daily_pnl_dq_flags (pop when clean, write when refused)
   -> accumulate write_needed (phase1 | phase2 | owned changed) -> _stamp_phase2_flags upsert (unchanged site)
  |
  v
cursor epilogue  advance_fetched_cursor needs `not phase1_read_refused`;
                 _p_last_sync None when refused or phase1_failed; advance_sync_cursor RPC (fenced)
  |
  v
enqueue follow-on derive_broker_dailies (unchanged, also after a refusal)
  |-- ok --> DONE (trade_count 0 when refused or phase1_failed)
  '-- raises --> publish read -> conditional failed write -> (zero rows) re-read
                  NEW write raising => FAILED; re-read raising => DONE (separate try scopes)
```

### Recommended Project Structure

No new files in `services/`. Tests only:

```
analytics-service/
├── services/job_worker.py                      # the only production file edited (plus an optional owned-key helper, see Pattern 2)
└── tests/
    ├── test_sync_trades_store_truth.py         # NEW: SC-1..SC-4 + SC-5 mocked arm (name is the planner's call)
    ├── test_sync_trades_enqueue_failure_bridge_live.py   # EDIT: one `reread_raises` arm (SC-5 live pin)
    └── test_daily_pnl_read_verdict.py          # EDIT (optional): pin that the owned-key predicate covers every verdict reason
```

### Pattern 1: store before Phase 2, refusal gate in front of it

**What:** the moved block sits inside the existing ccxt `else:` arm, directly after the drain and before `account_balance = await fetch_usdt_balance(ctx.exchange)`.
**When to use:** ccxt venues only. The MT5 arm sets `trades = []` and never reaches it.
**Example (illustrative; the quoted names are the repo's):**
```python
# Source: shape of the existing code at job_worker.py:2206-2217 and the derive arm at job_worker.py:8903-8913
daily_pnl_dq_flags = get_and_clear_last_dq_flags()
if daily_pnl_dq_flags:
    exchange_dq_flags.update(daily_pnl_dq_flags)
_verdict = daily_pnl_read_verdict(daily_pnl_dq_flags)
if _verdict.rate_limited:
    # static text only: no venue text rides an exception into compute_jobs.last_error
    raise ccxt.RateLimitExceeded("sync_trades: daily P&L read was rate limited")
if _verdict.reasons:
    phase1_read_refused = True
    logger.warning("sync_trades: daily P&L read refused for strategy %s (%s); nothing stored, last_sync_at held",
                   strategy_id, ",".join(_verdict.reasons))
elif trades:
    ...  # the existing `_sync` closure + `db_execute(_sync)` try/except, moved here verbatim, except-var renamed (Pitfall P3)
account_balance = await fetch_usdt_balance(ctx.exchange)
```

### Pattern 2: owned-key replacement with an accumulating `write_needed`

**What:** the owned set is the verdict's closed reason tokens plus two companions, matched by prefix for the two families the verdict builds by prefix. Pop owned keys absent from this run's drained set, then merge the drained set; mark the write needed only when the owned subset changed.
**Where:** a small module-level predicate. Recommended home is `services/exchange.py` directly beside `daily_pnl_read_verdict`, because the pin test (below) needs both in view; `job_worker.py` module level is also acceptable (CONTEXT leaves it to the planner).
**Example:**
```python
# Source: reasons and companions quoted in Findings Q-flags (exchange.py:262-273, 2371-2372, 2386-2387)
_SYNC_OWNED_DAILY_PNL_KEYS: Final[frozenset[str]] = frozenset({
    "daily_pnl_fetch_error", "daily_pnl_binance_income_fallback", "daily_pnl_non_usd_okx",
    "daily_pnl_fetch_error_class", "daily_pnl_unsupported_venue",
})
_SYNC_OWNED_DAILY_PNL_PREFIXES: Final[tuple[str, ...]] = ("daily_pnl_truncated_", "daily_pnl_deadline_")

def _is_sync_owned_daily_pnl_key(key: str) -> bool:
    return key in _SYNC_OWNED_DAILY_PNL_KEYS or key.startswith(_SYNC_OWNED_DAILY_PNL_PREFIXES)
```
`daily_pnl_malformed_*` must NOT match (CONTEXT decision; the verdict docstring at exchange.py:252-259 records founder decision D-12 that no reader names it).

### Anti-Patterns to Avoid

- **Overwriting `write_needed`:** the existing Phase-2 chain ends `else: write_needed = False` (job_worker.py:2673-2674). Do not append owned-key logic before it and assign; accumulate (`write_needed = write_needed or ...`) and initialise `write_needed = False` before the Phase-1 branches.
- **Writing flags after a failed flag read:** the fallback `existing_flags = {}` (job_worker.py:2608) turns the upsert into a column REPLACE with only this run's keys (Pitfall P6).
- **A new `strategy_analytics` write site or a payload built by a helper:** both censuses read the `.upsert({...})` literal; keep the literal `{"strategy_id": strategy_id, "data_quality_flags": existing_flags}` (Q3).
- **Annotating `phase1_failed`:** `test_c12_02_phase1_failed_flag_initialised` collects `ast.Assign` targets only; `phase1_failed: bool = False` (an `AnnAssign`) would redden it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Is this daily read refused? | a new predicate over flag names | `daily_pnl_read_verdict(daily_pnl_dq_flags)` | CONTEXT item 2; three readers are held in parity by an enumerating test |
| Rate-limit detection | string matching on the class name | `verdict.rate_limited` | `fetch_daily_pnl` swallows `RateLimitExceeded` into `daily_pnl_fetch_error_class`; the verdict reads `DAILY_PNL_RATE_LIMIT_CLASSES` |
| The stored error-class value | the raw drained string | `verdict.error_class` (regex-validated identifier or `None`) | T-186-13 precedent: venue text must never ride a class name into a stored flag |
| Flag-buffer drain | a second drain call | the existing single drain at job_worker.py:2214 | `test_okxtrades_cursor._run_job` patches `get_and_clear_last_dq_flags` with `itertools.chain([{}, second], itertools.repeat({}))` and documents "call 1 = the daily drain, call 2 = the fills drain"; a third call shifts them |
| Clearing owned keys | `del` on a copy of a hand-listed set | one predicate shared with a pin test | a `daily_pnl_*` flag added later would otherwise never be popped |

**Key insight:** every piece of the logic already exists in the derive and the cron; this phase moves and reuses it. The risk is not the logic, it is the surrounding structure (`write_needed`, flag-read failure, source-text pins).

## Findings by Question

### Q1. Tests that drive `run_sync_trades_job`, what they mock, and what breaks

Baseline measured at HEAD in this worktree: the eight-file driver set below ran `1074 passed in 13.97s`; the `test_job_worker.py` sync subset ran `28 passed, 110 deselected in 10.39s`; the two censuses ran `13 passed`; `test_mt5_handover.py -k sync_job_passes` ran `1 passed`; the live bridge file ran `1 passed, 7 skipped` (lane not configured).

**Call order assumption audit.** No driver asserts the relative order of `sync_trades`, `fetch_usdt_balance` and the Phase-2 fetch: they filter `rpc_calls` by name (`test_job_worker.py:1393-1397`, `3612-3617`, `by_name` in `test_mt5_sync_path.py`). So (a) the store move breaks none by order. The one ordering gate to ADD is the new SC-1 test.

| File (symbol) | How it mocks supabase | (a) store moves earlier | (b) flag read on every ccxt run |
|---|---|---|---|
| `test_job_worker.py::TestSyncTradesFeatureFlag` (`test_sync_trades_feature_flag_off`, `_on`) | `MagicMock()`; `rpc.return_value` data=5; `_on` scripts `table.return_value.select...maybe_single.execute` to `MagicMock(data=None)` | none | `_off` runs flag OFF: default MagicMock chain; `one()` returns `None` for a non-dict `.data` (db.py:396-411) so the read yields `{}`; a clean run with no owned key writes nothing. No change |
| `test_job_worker.py::TestAdvanceSyncCursorFence` (3 driven tests via `_run`, flag OFF) | default `MagicMock` supabase; `rpc` returns True / False per name | none | same as above. `p_last_sync_at is not None` (line 1203) still holds (no refusal) |
| `test_job_worker.py::TestSyncTradesEnqueuesComputeAnalytics` | default MagicMock, `_rpc` records calls | none | no change |
| `test_job_worker.py::TestDeriveBrokerDailies` (misfiled; `test_sync_trades_enqueue_failure_with_nothing_published_fails_transient` line 3056, `test_enqueue_failure_with_nothing_published_writes_the_five_key_failed_row` line 3137) | `table.side_effect = _table`; publish read scripted `MagicMock(data=None)`; `upsert` and `update` capture | none | the new flag read hits the same scripted `select` chain, returns `None` row, clean, no write. These pin the five-key payload (`set(payload) == {...}` lines 3275-3281), unaffected |
| `test_job_worker.py::TestSyncTradesEnqueueFailurePublishState` (`_run`, lines 3299-3377) | ONE scripted `select.eq.maybe_single.execute` chain serves the publish read AND (new) the flag read: `execute.side_effect = read` if `read` is an Exception, else `MagicMock(data=read)` | none | **`test_unreadable_publish_state_writes_nothing_and_returns_done` (lines 3481-3497) is the one that reddens under a naive implementation.** `read` is `RuntimeError`, so the flag read raises too, `flag_load_failed=True`, and today's Phase-2 `else:` chain reaches `elif flag_load_failed:` and upserts a recovery payload; the test asserts `upserts == []`. The published-row cases (`{"computation_status": ..., "metrics_json": ...}`) read as `{}` flags (no `data_quality_flags` key), clean, no write: fine. `test_failed_write_is_conditional_on_nothing_published` (line 3443) filters `select*` and `.data` calls out of each `strategy_analytics` table mock, so an extra select-only mock is invisible to it |
| `test_job_worker.py::TestSyncTradesEmptyResponsePreservesHistory` (2) | default MagicMock + `rpc_calls` | none | `if trades:` guard test asserts NO `sync_trades` call on `[]`: preserved by `elif trades:` |
| `test_job_worker.py::TestSyncTradesPhase2AmendmentDetection` (2), `TestSyncTradesPhase2PartialBatchFailure`, `TestSyncTradesPhase2FailureFlag` (3), `TestRedTeamSyncTradesPreDrainPreservesDqFlag` | per-table `_table` fakes; ingestion ON; `strategy_analytics` select scripted `MagicMock(data=None)` or a stored-flags dict | none | all ON: the read already ran today. `test_dq_flag_lands_on_strategy_analytics` plants the non-daily marker `test_pre_drain_marker` through the real `_record_dq_flag`; it is not an owned key, so it must keep landing |
| `test_job_worker.py::TestRedTeamSyncTradesRateLimitDrainsDqBuffer` | `fetch_all_trades` raises `ccxt.RateLimitExceeded` after planting a flag; `_stamp_429` patched | none | unchanged: raised before the new code |
| `test_okxtrades_cursor.py::_run_job` (about 20 tests) | `_make_supabase`: `_FakeTradesQuery`, `_FakeAnalytics` (stored-flags aware, upsert REPLACES `stored_flags`), rpc recorder | `daily_trades`/`sync_trades_error` cases keep working | all ingestion ON. **Drain patch**: `get_and_clear_last_dq_flags` side effect `itertools.chain([{}, second], repeat({}))` (lines 295-309); the plan must keep exactly one daily drain before the fills drain. No stored `daily_pnl_*` seed exists in this file |
| `test_sync_trades_resume_seed.py::_run_job` | `_FakeTradesQuery` for `trades`, bare `MagicMock()` for the rest; ingestion ON | none | no change |
| `test_ana_recon_audit.py::test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance` | one `table = MagicMock()` for every table with scripted select chains; `sync_trades` raises or not; ingestion ON | keeps passing: the failing store still sets `phase1_failed`, `p_last_fetched_ts` None, `p_last_sync_at` None | no change |
| `test_ana_recon_audit.py` source pins | `inspect.getsource` | see Q7 | see Q7 |
| `test_mt5_sync_path.py::test_run_sync_trades_job_mt5_routes_balance_and_skips_ccxt` | real `db_execute`; `table.return_value` inert chain; `Mt5Session` | none (MT5 arm sets `trades=[]`) | MT5 must not set the "Phase-1 read ran" flag, or its `needs_flag_write` changes |
| `test_failed_status_logged.py::_drive_sync_trades_enqueue_failed` | per-table `tbl` with `upsert`/`update` capture; publish read `data=None` | none | no change |
| `test_sync_trades_enqueue_failure_bridge_live.py` (`_drive`) | `_HandlerSupabase`: `strategy_analytics` is the REAL lane table, everything else a stub; enqueue RPC raises | none | the new flag read goes to the real lane table, reads `data_quality_flags` NULL, clean, no write. Safe |
| `test_sync_trades_preserves_fills.py` | does NOT drive the handler: psycopg against the lane, calls the `sync_trades` RPC directly | none | none. Its only mention of `run_sync_trades_job` is in a docstring (the "Phase 1 ran BEFORE Phase 2" sentence becomes historical; it is not a pin) |

Other files that merely mention the name: `test_exchange.py:6489` (a docstring about `str(e)[:200]`), `test_mt5_handover.py` (source pin, Q7), `test_no_contact_support_copy.py` (Q7), `test_computation_error_provenance_census.py` (Q3).

### Q2. What a flag-only `strategy_analytics` upsert creates when no row exists

`[VERIFIED: supabase/schema/baseline.sql:14749-14752, 14777, 16347]`. The table defaults, quoted verbatim:
```
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "computation_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "computation_warned" boolean DEFAULT false NOT NULL,
    ADD CONSTRAINT "strategy_analytics_strategy_id_key" UNIQUE ("strategy_id");
```
So `.upsert({"strategy_id": ..., "data_quality_flags": {...}}, on_conflict="strategy_id")` on a missing row INSERTs a row with `computation_status='pending'`, `computed_at=now()`, `computation_warned=false`, every metric column NULL, `computation_error` NULL (the `computation_error_markers_together_check` is satisfied by the NULL pair). The three BEFORE UPDATE triggers (`strategy_analytics_drop_stale_error_provenance_trigger`, `..._hold_computed_at_until_success_trigger`, `..._stamp_computing_started_trigger`, baseline.sql:17167-17187) fire on UPDATE only, so an INSERT keeps the `computed_at` default (the comment at 17179 says so: "An INSERT keeps the column default for a first-ever row"). Against an existing row the upsert's UPDATE sets only `data_quality_flags`; the triggers see no change to `computation_error`, `computation_status` or `computing_started_at`.

Interactions:
- **Wizard poller.** `useStrategySyncPoller.ts:291-367`: a missing row reports no status and counts toward `missingRowGracePolls` escalation; a `pending` row reports status `pending`, which is non-terminal ("Non-terminal (pending/computing) → keep polling", line 358). `isComputedAnalytics` is `status === "complete" || status === "complete_with_warnings"` (`src/lib/closed-sets.ts:808-812`), so `pending` is never read as computed. The follow-on enqueue's bridge call (branch (a)) moves the row to `computing` within the same job in the normal case, and the bridge's own INSERT also takes the `computed_at` default, so the flag-only row is the same shape the chain creates anyway.
- **Phase 222 tail.** The conditional failed UPDATE skips only the success statuses and a `computing` row with `metrics_json` (job_worker.py:3024-3028). A `pending` row matches it, so after a flag-only insert the write returns 1 row (`wrote` truthy) and the FAILED path proceeds as before; the zero-row ambiguity ("no row, or published in between") only shrinks. No new interaction. The flag write happens earlier in the handler than the tail, so ordering is flags then enqueue.
- **Bridge branch (c).** `INSERT ... ON CONFLICT (strategy_id) DO UPDATE` (baseline.sql around 12795-12810) sets `complete` whether or not a row exists, so a pre-existing `pending` row does not change the T-222-13 residual.
- **Residual to record.** A row that exists as `pending` with `computed_at = now()` and NULL metrics is visible to any reader that treats row existence or `computed_at` as freshness without a status gate. `[ASSUMED]` that the readers gate on status; they were not enumerated (Assumptions A5). The mitigation is that the bridge creates the same row moments later.
- **Existing guard test.** `test_fresh_strategy_missing_analytics_row_skips_spurious_write` (test_job_worker.py:4425) pins that a CLEAN first sync with no row writes nothing; the new logic keeps that (nothing to pop, nothing drained).

### Q3. Provenance census and `_stamp_phase2_flags`

`[VERIFIED]` by reading and running both censuses (`13 passed`).
- `tests/test_computation_error_provenance_census.py:197`: `EXPECTED_INERT_SITES: Final[int] = 1`. It counts only literals that NAME `computation_error` (`_error_sites`, line 365-372 region: `_has_key(s.payload, _ERROR_KEY)`), and the inert site is identified by file `job_worker.py` plus the exact key set `{strategy_id, computation_status, computation_warned, computing_started_at, computation_error}` (lines 170-185). The `_stamp_phase2_flags` payload is `{"strategy_id": ..., "data_quality_flags": ...}` (job_worker.py:2678-2683): no `computation_error`, so it is in none of the stamped, exempt, inert or reset groups.
- `tests/test_computing_started_at_stamp.py:511-520`: the JOB-01 census's `kept` is the sites carrying `computation_status`; the comment at line 512 says "The three partial data_quality_flags upserts resolve to dicts WITHOUT a status key and drop out HERE". `EXPECTED_SKIPPED_UNRESOLVED = 0` (line 732): a write payload the scanner cannot resolve moves into `skipped` and reddens. Therefore keep the upsert's argument an inline dict literal at the existing site. The change does not move any count.
- Run after the change: `python3 -m pytest tests/test_computation_error_provenance_census.py tests/test_computing_started_at_stamp.py -q -p no:cacheprovider`.

### Q4. Can `fetch_all_trades` without `read_deadline_s` stamp `daily_pnl_deadline_*`?

No. `[VERIFIED: services/exchange.py:1763-1765]`:
```
    _read_deadline = (
        float("inf") if read_deadline_s is None else _monotonic() + read_deadline_s
    )
```
Both stamping sites compare against it: OKX via `_okx_bills_window_read` (`if _monotonic() >= read_deadline:`, line 1670, returns `"deadline"`), Bybit via `if _monotonic() >= _read_deadline:` (line 2144) setting `_bybit_deadline_hit`. `_monotonic() >= float("inf")` is never true. The sync's call is `fetch_all_trades(ctx.exchange, since_ms=daily_since_ms)` (job_worker.py:2210) and `fetch_all_trades` forwards `read_deadline_s=None` by default (exchange.py:3275-3285). The verdict still names a deadline reason if one ever appears (exchange.py:268-273 `startswith(("daily_pnl_truncated_", "daily_pnl_deadline_"))`), and the owned predicate must cover that prefix, so the day a caller passes a deadline the refusal is already in place.

### Q5. How `rate_limited` is set, and how it behaves if raised inside the try

`[VERIFIED: services/exchange.py:280-282]`:
```
    rate_limited = bool(flags.get("daily_pnl_fetch_error")) and (
        flags.get("daily_pnl_fetch_error_class") in DAILY_PNL_RATE_LIMIT_CLASSES
    )
```
with `DAILY_PNL_RATE_LIMIT_CLASSES = frozenset({"RateLimitExceeded", "DDoSProtection"})` (line 220-222). Both flags are stamped by `fetch_daily_pnl`'s outermost `except Exception as e` (exchange.py:2398 and 2402: `_record_dq_flag("daily_pnl_fetch_error", True)` and `_record_dq_flag("daily_pnl_fetch_error_class", type(e).__name__)`), because the Bybit inner arm re-raises `ccxt.RateLimitExceeded` (line 2328-2333) into that outer handler, which swallows it. So today a rate-limited daily read in the sync never reaches `_stamp_429`.

The derive re-raise, `[VERIFIED: services/job_worker.py:8903-8912]`:
```
                _realized_verdict = daily_pnl_read_verdict(_realized_dq_flags)
...
                if _realized_verdict.rate_limited:
                    raise ccxt.RateLimitExceeded(
                        "derive_broker_dailies: realized read was rate limited"
                    )
```
Raising the same exception from the sync's ccxt arm lands in the handler's outer `except ccxt.RateLimitExceeded as exc:` (job_worker.py:2332-2345): `await _stamp_429(ctx.supabase, ctx.key_row, exc)`, then `get_and_clear_last_dq_flags()`, then `raise`; the `finally` still runs `aclose_exchange`. `_stamp_429` (job_worker.py:1670-1710) skips only a geo-block (`is_geo_blocked(exc)`) and otherwise calls the `stamp_api_key_429` RPC. A synthetic message is not a geo-block. The nested `except ccxt.RateLimitExceeded:` at job_worker.py:2289 wraps only `fetch_raw_trades`, so a raise placed before it is not caught there. The dispatcher classifies `RateLimitExceeded` as transient (`ccxt.NetworkError | RequestTimeout | RateLimitExceeded`, job_worker.py:1455-1460 region). Use static text (no venue string) in the new exception; no store, no flag write, no epilogue happens on this path (the job raises).

### Q6. The live-lane test harness (SC-5)

`tests/test_sync_trades_enqueue_failure_bridge_live.py`:
- **Seeding.** `_drive(admin, tag, seed_row, attempts_before_claim, publish_race_row, after_handler)` (line 159) creates a throwaway auth user (`admin.auth.admin.create_user`), a `strategies` row, optionally upserts `seed_row` into the lane's `strategy_analytics`, inserts a pending `sync_trades` job (`_insert_pending_sync_trades`), sets `attempts` so the claim is the last attempt by default (`max_attempts - 1`), and claims it with `_claim_one` (real claim RPC and token). It cascades the cleanup through the strategy row and `delete_user`.
- **What is real vs stubbed.** Real: handler, publish read and failed UPDATE (both on the lane's `strategy_analytics` through `_HandlerSupabase.table`), claim RPC, `mark_compute_job_done` / `mark_compute_job_failed`, the bridge. Stubbed: `fetch_all_trades` (`[{"test":"trade"}]`), `fetch_usdt_balance`, `db_execute` (runs `fn()` inline), every non-`strategy_analytics` table and every RPC except `enqueue_compute_job`, which raises `RuntimeError("simulated enqueue infra failure")`. `_RAW_TRADE_INGESTION_ENABLED` is patched False.
- **How to make the re-read raise after a zero-row write over a published row.** `publish_race_row` already produces the zero-row write: the patched `db_read_with_retry` (`_racing_read`, lines 249-256) runs the real publish read (no row, so "nothing published"), then upserts the published row through the lane, so the conditional UPDATE matches 0 rows. Add a `reread_raises: bool = False` parameter and a call counter to `_racing_read`: on the SECOND call whose `fn.__name__ == "_strategy_has_published_numbers"` raise `RuntimeError("simulated re-read failure")` instead of reading. The new test seeds nothing, passes `publish_race_row={"computation_status": "complete_with_warnings", "computation_warned": True, "metrics_json": _METRICS}` and `reread_raises=True`, then asserts `result.outcome == DispatchOutcome.DONE`, the row after the mark RPC and bridge is still `complete_with_warnings` with `computation_warned is True` and `metrics_json == _METRICS`, and `job["status"] == "done"`. On today's code the handler returns FAILED (the re-read exception lands in the shared `except mark_exc`), the last attempt makes it `failed_final`, and bridge branch (b) writes `failed` over the published row, which is the RED.
- **Does it run in CI, which job, what env.** Yes: the `python` job in `.github/workflows/ci.yml` (job key at line 5576; the pytest step is `pytest -n auto --dist loadgroup ...` at line 5919) runs against the local-stack lane private to the runner and exports `SUPABASE_TEST_URL` and `LANE_DB_URL` to `GITHUB_ENV` (lines ~5860-5872); the module also needs `SUPABASE_TEST_SERVICE_KEY`. The module reads `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY`, `pytest.skip`s locally when unset, `pytest.fail`s when unset and `CI == "true"`, and `_require_loopback_lane` refuses any non-loopback host. `tests/conftest.py:77` adds it to the `shared_test_db` xdist group because the module names `SUPABASE_TEST_URL`. Locally it skips (`1 passed, 7 skipped` measured), so the local RED must come from the mocked twin (CONTEXT decision).
- **Mocked twin for the local RED.** Do not script `select.execute.side_effect = [..]`: the new flag read is also a select on `strategy_analytics` and would consume a list entry in an order that depends on the implementation. Patch `services.job_worker.db_read_with_retry` with a function that keys on `fn.__name__ == "_strategy_has_published_numbers"` (exactly as the live harness does); the flag read goes through `db_execute`, so it never reaches that patch. Make the conditional UPDATE's chain return `MagicMock(data=[])` to force the zero-row branch.

### Q7. Gates and contract tests that pin `run_sync_trades_job`'s text or structure

Grepped `analytics-service/`, `src/`, `scripts/`, `docs/`, `.github/`, `supabase/` for `wizard may still hang`, `needs_flag_write`, `phase1_daily_pnl_persist_failed`, `phase1_failed`, `_stamp_phase2_flags`, `phase1_failed_at`: the only hits outside `job_worker.py` are the three source pins in `test_ana_recon_audit.py`. The pins that the change can redden:

1. `tests/test_ana_recon_audit.py:212-222` (`test_c12_01_phase2_rate_limit_reaches_outer_handler`): `src.find("except ccxt.RateLimitExceeded")` must be LESS than `src.find("except Exception as e")` over the whole function source. Today the first `except ccxt.RateLimitExceeded` is the nested one at job_worker.py:2289 and the first `except Exception as e` is at 2299. Moving the Phase-1 store (whose clause is `except Exception as e:` at 2382) to before line 2289 puts an `except Exception as e` textually first and REDDENS this test. Fix inside the moved block: name the variable so the substring `except Exception as e` does not match, for example `except Exception as persist_exc:` (a name beginning with `e` still matches, because the pin searches the prefix `except Exception as e`; `except Exception:` with no `as` also does not match).
2. `tests/test_ana_recon_audit.py:444-456` (`test_c12_02_phase1_failed_gates_last_sync_at`): `"if not phase1_failed" in src`. Today it is satisfied by `_p_last_sync = _now_iso if not phase1_failed else None` (job_worker.py:2791). Rewriting to `if not (phase1_failed or phase1_read_refused)` REDDENS it. Keep the literal, for example `_p_last_sync = None if phase1_read_refused else (_now_iso if not phase1_failed else None)`.
3. `tests/test_ana_recon_audit.py:421-441`: `phase1_failed` must be an `ast.Assign` Name target in the function (keep `phase1_failed = False`, unannotated).
4. `tests/test_mt5_handover.py:690-700`: the source must contain `_fetch_mt5_account_balance(` with `api_key_id=ctx.key_row.get("id")` in the text up to the first `)`. Do not touch the MT5 arm.
5. `tests/test_no_contact_support_copy.py`: (a) `SENTENCE_PINS` requires a string constant inside `run_sync_trades_job` containing "Analytics enqueue failed during sync. The next scheduled sync will retry — use the contact form if this persists." (job_worker.py:2999-3001; do not reword); (b) the module-wide AST scan fails on any non-docstring string constant matching `contact\s+support` in `services/`, `routers/`, `models/`, `scripts/`: do not write that phrase in the new log or exception strings.
6. The two censuses (Q3).
7. `plan-anchor-verify` (CLAUDE.md, in the `frontend` aggregator) re-resolves every `file:line` anchor and named symbol a pending PLAN.md asserts: the plans must cite lines that resolve, preferably by symbol.
8. CI mypy strict gate over `services/` (`.github/workflows/ci.yml:5739-5740`): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. `Final` is already imported in `job_worker.py` (line 58) and in `exchange.py`.

### Q8. OKX venue docs: what the flags mean

`[CITED: https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-bills-details-last-7-days]` (fetched this session; read in three chunks because the page is 406k characters). `GET /api/v5/account/bills` covers the last 7 days (5 requests per second); `GET /api/v5/account/bills-archive` covers the last 3 months (5 requests per 2 seconds); max `limit` is 100 for both; pagination uses `after` (records earlier than the given bill id) and `before` (newer), and both take `begin` / `end` timestamps in milliseconds. Field `ccy` is "Account balance currency"; `fee` is "Negative number represents the user transaction fee charged by the platform"; the docs do not state the currency of `pnl` explicitly (it is presumably `ccy`, an inference, `[ASSUMED]`, see A2). Wording the flags accordingly:
- `daily_pnl_non_usd_okx`: at least one OKX bill with a nonzero `pnl + fee` carried a `ccy` that is not a stable coin (or no `ccy`), so the read could not be summed into USDT and the WHOLE read was refused (`fetch_daily_pnl` returns `[]`, exchange.py:1932-1943). It is the boolean `True`; currency codes go only to a log line.
- `daily_pnl_truncated_okx`: a (window, instType, endpoint) read hit the page cap (`OKX_BILLS_PAGE_CAP`/`OKX_ARCHIVE_PAGE_CAP`, 100 pages of 100 rows) before the venue was exhausted, so the walk dropped that window and stopped; what came back is a contiguous oldest prefix of whole UTC days (exchange.py:1838-1844). Deterministic: the same history hits the same cap.
- `daily_pnl_deadline_okx` is the latency twin and is unreachable here (Q4).

No venue read changes are planned, so nothing else from the docs is needed.

### Q9. Validation Architecture

See the `## Validation Architecture` section below.

### Flag inventory (verbatim, for the owned-key set)

`[VERIFIED: services/exchange.py:262-273]` the verdict's reasons:
```
    reasons: list[str] = []
    if flags.get("daily_pnl_fetch_error"):
        reasons.append("daily_pnl_fetch_error")
    if flags.get("daily_pnl_binance_income_fallback"):
        reasons.append("daily_pnl_binance_income_fallback")
    if flags.get("daily_pnl_non_usd_okx"):
        reasons.append("daily_pnl_non_usd_okx")
    reasons.extend(
        key
        for key, value in flags.items()
        if key.startswith(("daily_pnl_truncated_", "daily_pnl_deadline_"))
        and value
    )
```
`[VERIFIED: services/exchange.py:2371-2372, 2386-2387, 2398, 2402]` the companions and the other stampers:
```
                _record_dq_flag("daily_pnl_fetch_error", True)
                _record_dq_flag("daily_pnl_fetch_error_class", type(exc).__name__)
...
            _record_dq_flag("daily_pnl_fetch_error", True)
            _record_dq_flag("daily_pnl_unsupported_venue", True)
...
        _record_dq_flag("daily_pnl_fetch_error", True)
...
        _record_dq_flag("daily_pnl_fetch_error_class", type(e).__name__)
```
and the non-owned family: `daily_pnl_malformed_okx`, `daily_pnl_malformed_binance`, `daily_pnl_malformed_bybit` (exchange.py:1897, 1930, 1989, 2263, 2299).
The pin test should AST-scan every `_record_dq_flag("daily_pnl_...` literal in `services/exchange.py` and assert each is either owned by the predicate or in the documented non-owned set (`daily_pnl_malformed_*`), so a future flag cannot silently escape the pop.

## Common Pitfalls

### Pitfall P1: the deribit/no-branch venue refusal
**What goes wrong:** `fetch_daily_pnl` has branches only for okx, binance and bybit; any other venue falls to the `else:` that stamps `daily_pnl_fetch_error` and `daily_pnl_unsupported_venue` (exchange.py:2374-2387; `DAILY_PNL_VENUES = frozenset({"okx", "binance", "bybit"})`, line 1062; `EXCHANGE_CLASSES` includes `"deribit"`, line 1045-1050; the cron's own test asserts `unsupported == {"deribit"}`, `test_cron_router.py:7880`). Under item 2 a Deribit key's queued sync would be refused every run: `last_sync_at` held (today it advances), `trade_count` 0 (today `len([])` is also 0), and the two keys written to `data_quality_flags` every run, never popped.
**Why it happens:** the cron guards the venue set before any call; the queued handler never did.
**How to avoid:** this is the locked behaviour (the verdict names `daily_pnl_fetch_error`); do not special-case it silently. Pin it with a Deribit-shaped drained set (`{"daily_pnl_fetch_error": True, "daily_pnl_unsupported_venue": True}`) so the effect is a recorded decision, and name it in the CHANGELOG `### Notes`. See Open Question 1.
**Warning signs:** a Deribit key's `last_sync_at` stops moving from the queued path (the daily holdings poll still moves it, per the Phase 211 comment at job_worker.py:2124-2128).

### Pitfall P2: balance, follow-on and fills still run after a refusal
**What goes wrong:** a refusal skips only the store. Phase 2 and `fetch_usdt_balance` still run, and `advance_fetched_cursor` must be held (`... and not phase1_read_refused`, job_worker.py:2726-2732) or the fills cursor advances past an unstored daily span. The fills-anchor branch (`elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None`, line 2749) is unchanged.
**How to avoid:** assert `p_last_fetched_ts is None` on a refused run that had fills in hand (ingestion ON control), and `p_account_balance` still written.
**Divergence to know, not to change:** the cron's degraded tick does not enqueue the follow-on (`test_cron_router.py:7520` and `:7588` assert no `enqueue_compute_job`); the sync does, by CONTEXT. The derive then refuses by name through its own arm.

### Pitfall P3: moved store and the `except Exception as e` source pin
See Q7 items 1 and 2. Rename the exception variable in the moved block and keep `if not phase1_failed` literal.

### Pitfall P4: `trade_count`
`trade_count=0 if phase1_failed else len(trades)` (job_worker.py:3070) becomes `0 if (phase1_failed or phase1_read_refused) else len(trades)`. A refused Binance-fallback run has `len(trades) == 1` today (measured), so SC-2's `trade_count == 0` is a real assertion.

### Pitfall P5: `write_needed` is clobbered (existing latent bug, measured)
**What goes wrong:** job_worker.py:2628-2674 sets `write_needed = True` in the Phase-1 branches and then the Phase-2 `else:` chain ends `else: write_needed = False` (line 2673-2674), overwriting it. Measured this session with a probe driving the real handler (no DB): with `sync_trades` raising, no other flag, ingestion ON or OFF, the handler writes NO `strategy_analytics` upsert, so `phase1_daily_pnl_persist_failed` is never stamped in the common case. Also measured: ingestion OFF + a drained `daily_pnl_non_usd_okx` writes nothing (item 4 reproduced); ingestion ON writes `{'strategy_id': 's', 'data_quality_flags': {'daily_pnl_non_usd_okx': True}}`.
**Why it matters here:** any owned-key `write_needed = True` placed before the Phase-2 chain is erased by it, and SC-2's "never stamps `phase1_daily_pnl_persist_failed`" needs a control arm showing the stamp CAN happen for a persist failure.
**How to avoid:** initialise `write_needed = False` before the Phase-1 branches, accumulate with `or`, and give the Phase-2 recovery arms their own variable. Fixing it makes the Phase-1 persist-failure stamp start working; there is no TS or SQL reader of `phase1_*` or `daily_pnl_*` keys (grep over `src/`, `scripts/` and the migrations found only an unrelated column comment), so the visible change is the stored flag only. Record the behaviour change in the CHANGELOG.

### Pitfall P6: a failed flag read must not write
**What goes wrong:** on a read failure the handler sets `existing_flags = {}` and `flag_load_failed = True` (job_worker.py:2603-2609), and the `else` chain then writes `phase2_fill_ingestion_failed=False` + `phase2_recovered_at` (lines 2662-2667). The upsert REPLACES the jsonb column (Pitfall P8), so this erases every other key (`last_success_snapshot`, `headline_since`, benchmark flags, the derive's per-key fields). Today this needs ingestion ON (off by default in prod per the comment at 2591-2592); making the flag read run on every ccxt sync exposes it on EVERY flag-OFF sync with a read hiccup. Also `test_unreadable_publish_state_writes_nothing_and_returns_done` (Q1) reddens on it.
**How to avoid:** (a) gate the Phase-2 success/recovery arms on "Phase 2 actually ran" (`_RAW_TRADE_INGESTION_ENABLED and not Mt5Session`), not on `phase2_failed` being False; (b) when `flag_load_failed` and the only reason to write is Phase-1 owned-key or Phase-1 persist state, skip the write and log a WARNING naming the strategy (the next run re-reads and re-derives, CONTEXT item 1's reasoning). Do not widen to rewrite the existing ON-path fallback arm unless a test requires it (Rule 3), but do not let the new OFF path reach it.

### Pitfall P7: the stale `phase1_daily_pnl_persist_failed` clear on a refusal
**What goes wrong:** the `elif existing_flags.get("phase1_daily_pnl_persist_failed"):` arm (line 2632) pops the stale persist-failed flag on any run where `phase1_failed` is False, including a refused run that persisted nothing (and today a run with `trades == []`).
**How to avoid / recommendation:** do not clear it on a refused run (`and not phase1_read_refused`): a refusal is not a successful Phase 1, and clearing the stamp would assert a recovery that did not happen. Open Question 4.

### Pitfall P8: PostgREST upsert replaces the jsonb column
**What goes wrong:** the stored `data_quality_flags` is the whole object the handler sends. In-repo evidence: `tests/test_okxtrades_cursor.py::_FakeAnalytics.upsert` models it as `stored_flags.clear(); stored_flags.update(copy.deepcopy(payload["data_quality_flags"]))`, and `src/app/api/keys/sync/route.ts:549` says an upsert "REPLACES `data_quality_flags` WHOLESALE". The handler's own comment (job_worker.py:2650-2651, "PostgREST upsert merges JSONB keys") contradicts both. The PostgREST reference was fetched and does not state jsonb behaviour (`[ASSUMED]`, A1). This is what makes "pop the owned keys" work (omitting a key removes it) and also what makes P6 dangerous.
**How to avoid:** always send the full merged object read in the same handler run; never send a partial object.

### Pitfall P9: store the sanitized error class, not the raw drained value
`daily_pnl_fetch_error_class` is `type(e).__name__` (exchange.py:2402, a class name, not venue text), but the verdict's `error_class` is regex-validated (`_DAILY_PNL_ERROR_CLASS_RE`, exchange.py:223) and `tests/test_daily_pnl_read_verdict.py` pins "T-186-13: venue text must never ride a class name into a stored flag". The existing merge (`exchange_dq_flags.update(...)`) is raw. When writing the owned keys, write `verdict.error_class` (omit when `None`) rather than the raw string.

### Pitfall P10: drain-count and `phase1_failed` interplay in the epilogue log
The "advance_sync_cursor skipped" log (job_worker.py:2797-2802) prints `phase1_failed`; add the refusal so a held `last_sync_at` is distinguishable from a regression. Keep the existing `phase1_failed=%s` text.

## Code Examples

### Example 1: SC-1 cancellation test shape (RED today, measured)
Probe result on today's code (scratchpad probe, real handler, mocked supabase): `cancel: TimeoutError; rpcs seen: []`, i.e. the daily store never ran. The test:
```python
# Source: probe driven this session; mirrors the dispatcher's asyncio.wait_for(handler(job), timeout=...)
async def _hang(*_a, **_k):
    await asyncio.sleep(3600)
with patch("services.job_worker.fetch_raw_trades", new=_hang), patch("services.job_worker._RAW_TRADE_INGESTION_ENABLED", True), ...:
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(run_sync_trades_job(job), timeout=0.2)
assert [n for n, _ in rpc_calls if n == "sync_trades"], "the daily store must precede the Phase-2 walk"
```
Add a second assertion that the `sync_trades` RPC was recorded BEFORE the `fetch_usdt_balance` call (record both into one shared list), which is the criterion's literal wording.

### Example 2: SC-2 refusal fixture through the REAL buffer (RED today, measured)
Probe result on today's code with the Binance income fallback's spot fill: `refusal: outcome DONE trade_count 1 rpcs ['sync_trades', 'advance_sync_cursor', 'enqueue_compute_job'] p_last_sync_at set: True`. Plant flags through the real `_record_dq_flag` (as `test_job_worker.py:4722-4795` does) rather than patching the drain, so the verdict reads a real buffer; use the spot-fill row shape from `test_cron_router.py::TestADegradedFetchIsNeverOk._SPOT_FILL` (`price: 64000.0`, `order_type: "limit"`):
```python
async def _fetch_all(*_a, **_k):
    _record_dq_flag("daily_pnl_binance_income_fallback", True)
    return [_SPOT_FILL]
```
Assert: no `sync_trades` rpc; `advance_sync_cursor` `p_last_sync_at is None`; no recorded `strategy_analytics` payload carries `phase1_daily_pnl_persist_failed`; `result.trade_count == 0`; `enqueue_compute_job` still called; `p_account_balance` still written. Parametrize over `daily_pnl_fetch_error`, `daily_pnl_non_usd_okx`, `daily_pnl_truncated_okx`, a Deribit-shaped pair, and a synthetic `daily_pnl_deadline_okx`. Add: `daily_pnl_malformed_okx` alone is NOT a refusal (rows stored, flag merged).

### Example 3: SC-2 rate-limit arm
Plant `{"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "RateLimitExceeded"}` (and `"DDoSProtection"`), patch `_stamp_429` (as `test_job_worker.py:4882-4898` does) and assert `pytest.raises(ccxt.RateLimitExceeded)`, `_stamp_429` awaited once, no `sync_trades` rpc, no `advance_sync_cursor`, and `get_and_clear_last_dq_flags() == {}` afterwards.

### Example 4: SC-5 split `try` scopes
```python
# Replaces job_worker.py:2986-3050 structure (illustrative)
if _nothing_published:
    try:
        wrote = await db_execute(_mark_analytics_failed)
    except Exception as write_exc:  # noqa: BLE001
        # the WRITE raised: the first read said nothing was published and a failed write adds
        # no evidence of publication, so the outcome stays FAILED below.
        logger.exception(
            "sync_trades: marking strategy_analytics failed raised for strategy %s after the "
            "enqueue failure; nothing was written by that call. Error: %s", strategy_id, write_exc)
    else:
        if not wrote:
            try:
                _raced = await db_read_with_retry(_strategy_has_published_numbers)
            except Exception as reread_exc:  # noqa: BLE001
                logger.exception(
                    "sync_trades: the failed-row write matched zero rows and the re-read of the "
                    "publish state then failed for strategy %s; nothing was written, returning DONE. "
                    "Error: %s", strategy_id, reread_exc)
                _nothing_published = False
            else:
                if _raced:
                    logger.error("... published between the read and the write ... (R2-WR-01)", strategy_id)
                    _nothing_published = False
```
Keep the existing R2-WR-01 sentence for the `_raced` branch and the unchanged FAILED `DispatchResult` below. The old "wizard may still hang" sentence must be gone (grep it in the test).

### Example 5: owned-key replacement inside the flag block
```python
# Illustrative; names new to this phase are phase1_read_ran, phase1_read_refused, daily_pnl_dq_flags
if phase1_read_ran:
    _owned_before = {k: v for k, v in existing_flags.items() if _is_sync_owned_daily_pnl_key(k)}
    for k in [k for k in existing_flags if _is_sync_owned_daily_pnl_key(k) and k not in daily_pnl_dq_flags]:
        existing_flags.pop(k, None)
    # the drained keys are merged by the existing existing_flags.update(exchange_dq_flags); write the
    # sanitized class (Pitfall P9) instead of the raw value
    _owned_after = {k: v for k, v in existing_flags.items() if _is_sync_owned_daily_pnl_key(k)}
    owned_changed = _owned_after != _owned_before
```
Order matters: pop first, merge second, then compare, so a key that is both stored and drained is not seen as removed.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase-1 store after the Phase-2 walk and after the exchange closes | store after the Phase-1 read, inside the exchange `try` | this phase | a 15-minute dispatcher cancel no longer loses the run's daily P&L; the DB write now happens with the exchange still open (a few ms) |
| three divergent readers of the daily-P&L buffer | one shared `daily_pnl_read_verdict` (derive uses it; cron and archive job kept in parity) | Phase 186 | this phase makes the queued sync the fourth consumer of the shared reader, not a fourth predicate |

**Deprecated/outdated:** the comment at job_worker.py:2650-2651 ("PostgREST upsert merges JSONB keys") and the `_load_existing_flags` comment at 2582-2593 describing the flag as reachable "only when USE_RAW_TRADE_INGESTION is on" both go stale; leave them or correct them in the same edit, do not leave the contradiction (Rule 7).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PostgREST `Prefer: resolution=merge-duplicates` replaces a supplied jsonb column wholesale rather than deep-merging | Pitfall P8, P6 | The in-repo fake and the `keys/sync` comment both say replace, and the PostgREST reference fetched this session is silent on jsonb. If it merged, popping an owned key would never remove it from the row and item 3 could not be met by omission. The live lane would show it: add one live arm that seeds an owned key and asserts it is gone after a clean run |
| A2 | OKX `pnl` is denominated in the bill's `ccy` | Q8 | Only wording of `daily_pnl_non_usd_okx`; no code depends on it (the code already refuses any nonzero non-stable bill) |
| A3 | Deribit keys reach `run_sync_trades_job` (via `/process-key` resync, the first-hop sweep, or finalize) | Pitfall P1, Open Question 1 | If they never do, P1 is moot; if they do, every Deribit sync is refused by name every run. The enqueue sites were not traced to a conclusion |
| A4 | The readers of a `pending`, flag-only `strategy_analytics` row (Discovery, factsheet, allocator surfaces) gate on `computation_status` rather than row existence or `computed_at` | Q2 | A surface could show a strategy with no analytics. Mitigated by the bridge creating the same row moments later in the normal chain; not enumerated |
| A5 | The CI `python` job exports `SUPABASE_TEST_SERVICE_KEY` alongside the two variables seen at ci.yml ~5860-5872 | Q6 | The live test would `pytest.fail` in CI (never skip) if it were missing; the existing live modules already depend on it, so low risk |

## Open Questions (RESOLVED)

All five resolved in 251-CONTEXT.md, "Research resolutions" (questions 1-4) and the item 2 decisions (question 5).

1. **Deribit (and any no-branch venue) is refused every sync**
   - What we know: the else branch stamps `daily_pnl_fetch_error` + `daily_pnl_unsupported_venue` (exchange.py:2374-2387); CONTEXT lists `daily_pnl_unsupported_venue` as an owned companion and the verdict names `daily_pnl_fetch_error`.
   - What's unclear: whether any Deribit key's `sync_trades` actually runs (A3).
   - Recommendation: keep the locked behaviour, pin it with a Deribit-shaped test, and state the consequence in the CHANGELOG `### Notes` (queued-sync `last_sync_at` no longer advances for such a key; the daily holdings poll still does). Do not add a venue special case without a new decision.

2. **Fixing the clobbered `write_needed` changes behaviour for the Phase-1 persist-failure stamp**
   - What we know: measured, it is never stamped when it is the only change (Pitfall P5). No reader exists in `src/`.
   - What's unclear: whether the founder expects the stamp to start appearing.
   - Recommendation: fix it (it is required for the owned-key write to be reliable and for SC-2's control arm), and list it under `### Fixed` / `### Root cause` in the CHANGELOG.

3. **Skip the flag write when the flag read failed**
   - Recommendation: skip and log at WARNING (Pitfall P6). The next sync re-reads and re-derives, the same reasoning CONTEXT item 1 uses for a cancelled run.

4. **Do not clear a stale `phase1_daily_pnl_persist_failed` on a refused run**
   - Recommendation: gate the clear with `not phase1_read_refused` (Pitfall P7).

5. **A refused sync still enqueues the follow-on (cron does not)**
   - Locked by CONTEXT; recorded so the reviewer does not read it as an omission.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | all test and type commands (the bare name `python` is NOT on PATH) | yes | 3.14.3 | none needed; use `python3 -m pytest` |
| pytest | unit tests | yes | 9.0.2 | none |
| mypy | `--strict` gate | yes | 2.0.0 | none |
| `-n0` xdist flag | would force serial runs | no (`pytest.ini` rejects it) | | plain `python3 -m pytest ... -p no:cacheprovider` works and is serial here |
| Docker / local-stack lane | live bridge test | not used (forbidden by the load limit) | | the mocked twin carries the local RED; the live test runs in CI's `python` job |
| git worktree | repo | yes | branch `gsd/phase-251-syncstore` | none |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the lane (CI only).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 with pytest-asyncio (`async def test_*` run under it; `@pytest.mark.asyncio` also used) |
| Config file | `analytics-service/pytest.ini` (also `pyproject.toml` for mypy) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider` |
| Full suite command | not run in this phase (load limit); the CI `python` job runs `pytest -n auto --dist loadgroup --cov ...` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | the daily store happens before `fetch_usdt_balance` and the Phase-2 walk; a cancelled walk keeps the store | mocked handler (`asyncio.wait_for`) | `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider -k "store_before or cancelled"` | no, Wave 0 (RED measured on today's code: `rpcs seen: []`) |
| SC-2 | refusal: no store, `p_last_sync_at` None, no `phase1_daily_pnl_persist_failed`, `trade_count` 0, fills cursor held, balance + enqueue kept; 429 arm | mocked handler, parametrized over verdict reasons incl. Binance-fallback spot fill, Deribit-shaped pair, synthetic deadline; control: persist failure DOES stamp | `... -k "refus or rate_limit"` | no, Wave 0 (RED measured: spot fill stored, `last_sync_at` advanced, `trade_count` 1) |
| SC-3 | clean read pops every owned key (reasons + `daily_pnl_fetch_error_class` + `daily_pnl_unsupported_venue`), keeps `daily_pnl_malformed_*` and unrelated keys (`last_success_snapshot`); replace semantics (stored truncated, now fetch_error); no write when nothing changes; MT5 makes no flag read | mocked handler with `_FakeAnalytics` (stored flags, REPLACE upsert); flag OFF and ON | `... -k "clean or owned"` | no, Wave 0 |
| SC-4 | flag OFF + refusal reaches `data_quality_flags` at the sync's write and `last_sync_at` held; failed flag read writes nothing; first sync with no row writes only owned keys | mocked handler | `... -k "flag_off or load_failed or no_row"` | no, Wave 0 (RED measured: OFF + refusal writes nothing) |
| SC-5 | re-read raising after a zero-row write returns DONE; write raising stays FAILED; new log lines name the failed call; old sentence gone | mocked (patched `db_read_with_retry`) + live lane | mocked: `... -k "reread"`; live: runs only in CI `python` job (`tests/test_sync_trades_enqueue_failure_bridge_live.py`) | mocked: Wave 0; live: edit existing file |
| SC-6 | PROOF-01: each gate RED on pre-fix code or a neutered copy, restored from a byte backup | procedure, recorded in the plan SUMMARY | see Neuter plan | n/a |

**Neuter plan (PROOF-01, `cp` backup, `cmp` after restore):** `cp services/job_worker.py <scratchpad>/job_worker.py.bak` then, one at a time, N1 move the store back below Phase 2 (SC-1 RED: no `sync_trades` rpc under cancel), N2 delete the verdict `reasons` branch (SC-2 RED), N3 delete the owned-key pop (SC-3 RED), N4 drop `phase1_read_ran` from `needs_flag_write` (SC-4 RED), N5 merge the write and the re-read back into one `try` (SC-5 mocked RED), N6 reintroduce the `write_needed = False` clobber (the persist-failure control arm RED). After each: run the named test, see the named arm fail first, `cp` back, `cmp -s` (no output), re-run GREEN. Never `git checkout`/`stash` over uncommitted work.

### Sampling Rate
- **Per task commit:** the quick command above plus `python3 -m mypy --strict --follow-imports=silent --config-file=pyproject.toml services/job_worker.py` (about 9 s at baseline) and the census pair.
- **Per wave merge:** all four regression sets:
  - Drivers (baseline `1074 passed`, about 14 s): `cd analytics-service && python3 -m pytest tests/test_sync_trades_resume_seed.py tests/test_okxtrades_cursor.py tests/test_mt5_sync_path.py tests/test_failed_status_logged.py tests/test_ana_recon_audit.py tests/test_no_contact_support_copy.py tests/test_daily_pnl_read_verdict.py tests/test_okxtrades_ccy.py -q -p no:cacheprovider`
  - Handler subset (baseline `28 passed`, about 10 s): `python3 -m pytest tests/test_job_worker.py -q -p no:cacheprovider -k "TestSyncTrades or TestAdvanceSyncCursorFence or TestRedTeamSyncTrades or enqueue_failure or sync_trades"`
  - Censuses (baseline `13 passed`): `python3 -m pytest tests/test_computation_error_provenance_census.py tests/test_computing_started_at_stamp.py -q -p no:cacheprovider`
  - MT5 pin (baseline `1 passed`): `python3 -m pytest tests/test_mt5_handover.py -q -p no:cacheprovider -k sync_job_passes`
- **Phase gate:** the four sets plus mypy green locally; the live bridge file is verified in CI's `python` job (it skips locally, `1 passed, 7 skipped` at baseline). Never run the full pytest or vitest suites, the mutation runner or e2e here.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_sync_trades_store_truth.py` — SC-1..SC-4 and the SC-5 mocked arm; a shared helper that builds a ctx whose `strategy_analytics` double is stored-flags aware (reuse or import `tests/test_okxtrades_cursor.py::_FakeAnalytics`), whose rpc recorder keeps one ordered list across `sync_trades`, `fetch_usdt_balance` and the Phase-2 fetch, and whose fetch plants flags through `services.exchange._record_dq_flag`.
- [ ] `tests/test_sync_trades_enqueue_failure_bridge_live.py` — `reread_raises` parameter and call counter in `_racing_read`, plus the new test; optionally one live arm for A1 (seed an owned key, clean run, assert gone) and Q2 (first-sync refusal creates a `pending` row carrying only the owned keys).
- [ ] `tests/test_daily_pnl_read_verdict.py` (optional) — the AST pin that every `_record_dq_flag("daily_pnl_...")` literal in `services/exchange.py` is owned or `daily_pnl_malformed_*`.
- [ ] Framework install: none.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | credentials handled by the unchanged preflight (`decrypt_credentials`) |
| V3 Session Management | no | worker job, no session |
| V4 Access Control | no | writes use the service role; `strategy_analytics` RLS (`analytics_insert_deny`, baseline.sql:17889) is bypassed by the service role as today |
| V5 Input Validation | yes | venue-derived values never reach a stored flag or an exception verbatim: store `verdict.error_class` (regex `_DAILY_PNL_ERROR_CLASS_RE`), booleans for reasons, static text in the new `RateLimitExceeded` |
| V6 Cryptography | no | none touched |
| V7 Error handling and logging | yes | new log lines name the strategy id and the closed reason tokens only; no exception text from the venue; no `contact support` phrase (AST-scanned) |
| V8 Data protection / integrity | yes | a refused read must never reach `sync_trades` (its window-scoped DELETE would replace real daily rows with spot fills); a failed flag read must never trigger a column-replacing upsert |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Binance income-fallback spot fills stored as daily rows over real P&L | Tampering | refuse before the store (item 2); fixture proves the RPC is not called |
| Whole-column `data_quality_flags` replace after a failed read | Tampering / Information loss | skip the write on `flag_load_failed` (P6) |
| Venue text riding a flag or exception into stored data / Sentry | Information disclosure | sanitized class name, static exception text (P9, Example 1) |
| Orphaned write after watchdog reclaim | Tampering | unchanged: the `advance_sync_cursor` claim-token fence |

## Sources

### Primary (HIGH confidence)
- `analytics-service/services/job_worker.py` (read lines 2040-3158, 8850-8960, 1670-1710, 1855-1900, 18890-18950) - the handler, the derive arm, `_stamp_429`, preflight, dispatch
- `analytics-service/services/exchange.py` (read lines 60-320, 1725-1970, 2000-2045, 2165-2192, 2325-2404, 2426-2479, 3275-3285) - verdict, buffer, flag stampers, deadline, `fetch_all_trades`
- `supabase/schema/baseline.sql` (lines 14749-14830, 16337-16347, 17160-17187, 11962-12896 branch reads) - table defaults, constraints, triggers, bridge
- `analytics-service/tests/` driver files read or run: `test_job_worker.py`, `test_okxtrades_cursor.py`, `test_sync_trades_resume_seed.py`, `test_sync_trades_preserves_fills.py`, `test_ana_recon_audit.py`, `test_mt5_sync_path.py`, `test_mt5_handover.py`, `test_failed_status_logged.py`, `test_sync_trades_enqueue_failure_bridge_live.py`, `test_computation_error_provenance_census.py`, `test_computing_started_at_stamp.py`, `test_no_contact_support_copy.py`, `test_daily_pnl_read_verdict.py`, `test_cron_router.py`
- `src/hooks/useStrategySyncPoller.ts`, `src/lib/closed-sets.ts`, `src/app/api/keys/sync/route.ts`, `.github/workflows/ci.yml` (python job at 5576)
- Probes run this session (scratchpad, real handler with mocked supabase): write-needed clobber, item-4 reproduction, spot-fill refusal and cancel RED evidence

### Secondary (MEDIUM confidence)
- [OKX API v5 docs, bills endpoints](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-bills-details-last-7-days) - windows, limit, pagination, `ccy`/`fee`; `pnl` currency not stated

### Tertiary (LOW confidence)
- [PostgREST tables and views reference](https://docs.postgrest.org/en/stable/references/api/tables_views.html) - fetched; silent on jsonb upsert behaviour (A1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; every module read in this session
- Architecture: HIGH - handler structure read end to end and exercised by probes
- Pitfalls: HIGH for P1-P7, P9, P10 (read or measured); MEDIUM for P8 (PostgREST semantics rest on in-repo evidence, A1)

**Research date:** 2026-11-26
**Valid until:** 2026-12-10 (the handler and its tests change often; re-measure line numbers by symbol at planning time, and the plan must cite symbols because `plan-anchor-verify` re-resolves anchors)
