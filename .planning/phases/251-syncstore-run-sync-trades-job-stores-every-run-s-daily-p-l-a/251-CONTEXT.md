# Phase 251: SYNCSTORE - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

<domain>
## Phase Boundary

`run_sync_trades_job` in `analytics-service/services/job_worker.py` (the queued sync, not the cron in `routers/cron.py`) keeps the daily P&L each run read and records its refusal flags truthfully. Four items routed from Phase 232 OKXTRADES (`handoff-222` in `232-01-SUMMARY.md`), plus the TODOS entry `[222-SYNCTRADES-REREAD-FAILED]` (review finding SFH-R3-01) that Phase 222 booked to this phase. Success criteria 1-6 in the ROADMAP section are the contract.

Run as a phase agent with no founder access: every gray area below took the recommended option, recorded with its reason. No migration is expected (all changes are in one Python handler and its tests).

</domain>

<decisions>
## Implementation Decisions

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

### Research resolutions (2026-11-26, after 251-RESEARCH.md; phase agent took the recommended option on each)
- `write_needed` must ACCUMULATE (only ever set True after the Phase-1 and owned-key arms), never be reassigned False by the Phase-2 `else:` chain. That clobber is part of item 4's root cause. The consequence, that `phase1_daily_pnl_persist_failed` now actually lands on a Phase-1 persist failure, is the truthful outcome and goes in the CHANGELOG.
- When the flag read fails on a run where Phase 2 did not run (ingestion off), the flag write is skipped (logged): an upsert of a guessed payload replaces the whole `data_quality_flags` column. The existing Phase-2 load-failed recovery arm stays, gated on Phase 2 having actually run.
- A refused run does not clear a stale `phase1_daily_pnl_persist_failed` (it never persisted, so it is not evidence of recovery). A clean run still clears it, as today.
- The stored `daily_pnl_fetch_error_class` is the sanitized `verdict.error_class` (identifier regex), never the raw drained value; absent when the verdict has none.
- Deribit: `fetch_daily_pnl` has no Deribit branch, so a queued Deribit sync would be refused by name every run (`daily_pnl_fetch_error` + `daily_pnl_unsupported_venue`), holding `last_sync_at`. Kept as the locked behaviour, pinned by a test, named in the CHANGELOG. PROD reading 2026-11-26: 0 `sync_trades` jobs for Deribit keys in the last 30 days (only Bybit and MT5 ran), so this is latent.
- A pin test asserts every `daily_pnl_*` flag name recorded in `services/exchange.py` is either an owned key or `daily_pnl_malformed_*`, so a new flag cannot silently escape the owned set.
- Source-text pins in `analytics-service/tests/test_ana_recon_audit.py`, `test_mt5_handover`, and the "contact support" scan bind the edit (see RESEARCH); the edit keeps them green rather than editing the pins.

### Decided autonomously
- [Tests] Q: "How are the item tests driven?" → Selected: "Mocked-supabase handler tests beside test_sync_trades_preserves_fills.py and test_sync_trades_resume_seed.py, with _RAW_TRADE_INGESTION_ENABLED patched via monkeypatch (never importlib.reload)" — test files only.
- [Tests] Q: "How is the live-lane RED shown under the load limit?" → Selected: "No local Docker boot: the RED for the re-read outcome is shown on a mocked unit test of the same branch, and the live-lane test runs in CI's local-stack lane" — reversible; the live test can be run locally later.
- [Scope] Q: "Does the cron path change?" → Selected: "No, routers/cron.py already refuses degraded reads" — no code there.

### Claude's Discretion
- Exact helper shape for the owned-key set (a module constant beside the verdict, or a small predicate) is the planner's call, provided it reuses `daily_pnl_read_verdict` for the reason set.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/exchange.py::daily_pnl_read_verdict` (reasons, error_class, rate_limited) and `get_and_clear_last_dq_flags`.
- The derive's refusal arm in `run_derive_broker_dailies_job` (verdict → rate-limit re-raise → named refusal) is the pattern to mirror.
- `routers/cron.py::_fetch_degradation` / `_fetch_prefix_only` document why a refused read must store nothing (`sync_trades` deletes the payload's `[min, max]` span; the Binance income fallback returns spot fills shaped as daily rows).

### Established Patterns
- Flag read-modify-write in the handler: `_load_existing_flags` → merge → `write_needed` → `_stamp_phase2_flags` upsert.
- The epilogue's NULL-means-untouched `advance_sync_cursor` params.
- PROOF-01 neuter-RED-restore with a byte backup.

### Integration Points
- `run_sync_trades_job` only; the Phase 222 enqueue-failure tail at its end.
- Tests: `analytics-service/tests/test_sync_trades_*.py`, `tests/test_daily_pnl_read_verdict.py`.

</code_context>

<specifics>
## Specific Ideas

- Exchange-read work also consults the venue API docs (OKX for the routed items): the planner/researcher reads OKX's bills endpoints (`/api/v5/account/bills`, `/bills-archive`) only to confirm the flags' meanings; no venue read changes in this phase.

</specifics>

<deferred>
## Deferred Ideas

- Whether the derive pre-stamp / CSV runner should carry the sync's refusal keys through their wholesale rebuild (so the flag survives a completed chain) is a derive-ownership question, out of scope here.

</deferred>
