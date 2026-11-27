# Phase 255: NULLANCHOR - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

<domain>
## Phase Boundary

A raw fills read on OKX, Bybit or Deribit in `run_sync_trades_job` (`analytics-service/services/job_worker.py`) that raises, is rate limited (429) or is cancelled AFTER Phase 251's Phase-1 daily `sync_trades` store must never leave a span the next run's seed skips. This holds on a NULL `api_keys.last_fetched_trade_timestamp` column and on a set column with no stored fill for the strategy. This is the `TODOS.md` entry `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]`, live today: Railway production `USE_RAW_TRADE_INGESTION` is `true` on both analytics services (founder ruling 2026-11-26, "Keep it on, fix records"), and PROD holds OKX, Bybit and Deribit keys.

In scope: the seed and the bound handling for these three venues inside `run_sync_trades_job`, the SC-1 two-run gate arms, a Binance and `advance_sync_cursor`-caller no-regression pin (SC-2), deleting the TODOS entry in the ship PR (SC-3), PROOF-01 (SC-4).

Out of scope: `cron_sync` / `/fetch-trades` themselves, MT5 (no fills read by design), new public `data_quality_flags` keys, the Binance-only sync flags and their carry allowlist.

</domain>

<decisions>
## Implementation Decisions

### Decided autonomously
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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `run_sync_trades_job` ccxt arm (`analytics-service/services/job_worker.py`, search `Phase 253 BINANCECURSOR round-2 (CR-02`): the provisional bound write `_set_bound`, its fail-closed `except` (sets `_fills_read_skipped`, `phase1_read_refused`, `phase2_failed`) and its orphan branch (`_bound_orphaned`).
- The seed's third term: `load_strategy_fills_reread_bound` (`services/trade_resume.py` import block near the top of `job_worker.py`), applied when `_binance_read`.
- Epilogue: `_walk_start_ms`, `_covers_from_iso`, `_earliest_through()` and the epilogue `_set_bound(_unread_from_ms, _covers_from_iso)` call, all gated on `_binance_read and _reach_anchor_ms is not None`.
- NULL-column bootstrap anchor `fills_anchor_iso` (Phase 232 VREAD-08), stamped through `advance_sync_cursor` on a failed Phase 2.
- Two-run harnesses: `analytics-service/tests/test_binancefills_cursor.py`, `analytics-service/tests/test_okxtrades_cursor.py`, `analytics-service/tests/_binance_fills.py`.
- The 253 scratch probes named in the TODOS entry (`test_probe_r2_main_null_column_okx.py`, `test_probe_r3_okx_set_column.py`) were in a session scratchpad and are not in the repo; their measured numbers are in the TODOS entry (run 2 `since_ms` 1783987200000 / 1781049600000 against run 1 seed 1778112000000).

### Established Patterns
- Claim-token fence via `WORKER_FENCE_V2` on every RPC write.
- Seed = min(column, stored-fill high-water or daily high-water, re-read bound); over-fetch absorbed by the `(strategy_id, exchange, exchange_fill_id)` unique index.
- PROOF-01: neuter, see RED with the named arm, restore with `cp`, verify with `cmp`, GREEN; never `git checkout/restore/stash` on uncommitted work.

### Integration Points
- `fetch_raw_trades` (`services/exchange.py`) per-venue branches for OKX, Bybit, Deribit; venue reach constants there.
- `routers/cron.py` and `routers/exchange.py` (`/fetch-trades`) store daily rows without the bound: unchanged, and the bound makes their stores harmless to the seed.

</code_context>

<specifics>
## Specific Ideas

- Why the bound and not the alternatives (recorded by the phase agent, not a founder choice): holding the daily store until the fills read has run changes Phase 251's ordering and leaves `cron_sync` and `/fetch-trades` able to move the daily high-water past the unread span; an `advance_sync_cursor` anchor cannot lower a set column (253-REVIEW-R3.md). The bound does not rest on the daily high-water, so cron-stored daily rows cannot move a seed past it. The table and RPC are venue-agnostic in SQL (`supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` has no exchange column or Binance predicate), so no migration is needed; its catalog COMMENTs say "Binance" and become stale wording.
- Test census warning: existing suites assert exact RPC lists on switch-on non-Binance runs (`test_okxtrades_cursor.py` names the bound RPC; `test_stamp_io_exhaustive.py` broke in Phase 253). The planner `grep -a`s for `set_strategy_fills_reread_bound`, `load_strategy_fills_reread_bound` and exact `rpcs ==` lists across `analytics-service/tests/` before sizing plans.

- SC-1: for each of OKX, Bybit and Deribit, on a NULL column and on a set column with no stored fill, with a 429, a cancel and a plain raised read after run 1 stored a daily row, run 2's walk start is at or before run 1's seed. Each arm RED on `origin/main`.
- SC-2: Binance's Phase 253 behaviour and `advance_sync_cursor`'s callers do not regress, pinned by a test.
- Research for venue reach reads the OKX, Bybit and Deribit API docs (founder rule: MT5/OKX investigations also read the venue docs).

</specifics>

<deferred>
## Deferred Ideas

- `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` stays open (fail-closed refusal when the bound RPC is missing); its scope text widens to OKX, Bybit and Deribit in the ship PR.
- Rewording the bound table's catalog COMMENTs, unless a migration is needed for another reason.

</deferred>

## Decisions addendum 2026-11-27 (founder rulings at the Phase 255 close)

Asked through AskUserQuestion after Phase 255 shipped as v0.133.104.0 (#1395). Answers are verbatim.

- **`[255-OKX-PAGER-BACKFILL]`: "Re-read now (Recommended)".** The affected OKX strategies' full available history is re-read promptly through the product's own path, then stored fill counts are compared against the gate in the `TODOS.md` entry. It runs outside this phase's plans and its results are added in a later commit on the records branch. Older fills than the OKX `fills-history` 3-month reach still need the archive endpoint. ⭐ **Result:** the backfill ran 2026-11-27 about 16:00Z on PROD through the product's own path. No cursor reset was needed: all three strategies' fills cursors and newest stored fills were already older than the OKX begin floor, and no re-read bound row existed, so the queued read's seed was clamped to the floor (`okx_fills_reach_clamped`) and walked the whole reachable span. One `sync_trades` job per strategy was enqueued through `enqueue_compute_job`, as the wizard does, after confirming the analytics service runs `2fda7ab31` or later on Railway. All three `sync_trades` jobs ended `done`, with no `sync_truncated_*` or `phase2_fill_ingestion_failed` flag and no bound row left. Stored OKX ETHUSDTSWAP fills: 100 -> 1182, 106 -> 1188 and 200 -> 1282 (total fills 3316 -> 4409, 106 -> 1199, 200 -> 1293), now running to 2026-11-20, so every read paged far past one 100-row page. The fills stored before Phase 255 all predate the floor (the newest was 2026-08-19), so the spans the one-page pager dropped before then are outside `fills-history`'s reach and were NOT recovered; only the OKX archive endpoint could reach them. No headline figure moved: each chained `derive_broker_dailies` ended `failed_final` with `realized read incomplete (daily_pnl_non_usd_okx)`, the same refusal every daily derive of these strategies has hit since at least 2026-11-25 (owned by Phase 256 OKXUNITSWITCH), so `strategy_analytics.computed_at` and its metrics are unchanged. The same Phase-1 refusal holds `last_fetched_trade_timestamp`, so later reads re-walk from the floor and the unique index absorbs the overlap.
- **`[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` and `[255-BYBIT-DEADLINE-NO-PROGRESS]`: "Fix both in a follow-up (Recommended)".** Both are owned by Phase 257 SEEDHOLD, booked in v1.23 HARDEN the same day. The `TODOS.md` entries' owner lines point at it.
- **`[255-OKX-BEGIN-REACH-PROBE]` has no ruling yet** and stays booked in `TODOS.md` with its owner unchanged ("the next phase that touches `_fetch_raw_trades_okx`").
