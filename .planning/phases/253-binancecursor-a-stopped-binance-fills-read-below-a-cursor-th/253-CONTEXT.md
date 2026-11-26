# Phase 253: BINANCECURSOR - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning
**Mode:** stage agent, founder not reachable. Every gray area below was AUTO-TAKEN on the recommended option and is marked `[auto]`. None needed a founder-only call.

<domain>
## Phase Boundary

A Binance raw fills read that stops (deadline, `BINANCE_PAGE_CAP`), loses a symbol (`binance_partial_symbols`) or raises never leaves an unread span that no later run re-reads, even when the per-key fills cursor column (`api_keys.last_fetched_trade_timestamp`) is ahead of this strategy's newest stored fill. The run-time signal that names such a span (`binance_stop_below_cursor`, `binance_deadline_symbols` and the other sync-time `binance_*` keys) outlives the chained `derive_broker_dailies` write and the `run_csv_strategy_analytics` rebuild. Closes `TODOS.md` `[250-BINANCE-STOP-BELOW-CURSOR]` (Phase 250 review rounds 1-3, `250-REVIEW-R3.md` WR-01 and WR-02).

Out of scope: turning `USE_RAW_TRADE_INGESTION` on for Binance (SC-4), the T-250-19 handler-tail overrun, the quiet-prefix deadline exception (founder-ruled, Phase 250), other venues' cursor semantics, and non-`binance_*` sync-time flags (`sync_truncated_*`).
</domain>

<decisions>
## Implementation Decisions

### Measured facts the decisions rest on (scout, 2026-11-26, at `c57961a54`)
- The fills cursor column is PER KEY: `api_keys.last_fetched_trade_timestamp`, written only through `advance_sync_cursor` (one definition, `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql`, forward-only `CASE ... last_fetched_trade_timestamp < p_last_fetched_ts`, claim-token fenced, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`). Snapshot: `supabase/schema/functions/advance_sync_cursor.sql`.
- A seed rule that distrusts a column ahead of stored fills ALREADY EXISTS and does not close the gap: Phase 232 VREAD-08 seeds at `min(column, strategy fill high-water)` in `run_sync_trades_job`. `load_strategy_fill_high_water` (`analytics-service/services/trade_resume.py`) is strategy-wide (`trades` where `strategy_id` and `is_fill`, newest `timestamp`), NOT per symbol, so a healthy symbol's newer fill masks a stopped or failed symbol's unread span.
- A per-strategy resume-state precedent exists: `strategy_sync_cursors` (`supabase/migrations/20260919120000_strategy_sync_cursors.sql`, PK `strategy_id`, ON DELETE CASCADE, deny-all RLS, service_role only), written today by the cron fan-out in `analytics-service/routers/cron.py`.

### Cursor fix design
- **D-01 [auto]:** The choice between (a) letting a stopped read LOWER the shared per-key column and (b) keeping the stop bound in PER-STRATEGY state that the seed reads is decided by RESEARCH, against the locked discriminator in D-02. **Recommended default (b)**: a per-strategy re-read bound the seed takes the minimum with, written only by the run that stopped and cleared only by a run that reads complete through it, leaving `advance_sync_cursor` and its ACL untouched. Reason for the lean: under (a) a sibling strategy's clean run on the same key moves the column forward again, so the lowered bound does not survive a normal (non-concurrent) sequence. If research shows (a) survives D-02, (a) is allowed. — **Reversibility:** one-way — either path carries a migration (a new column or table, or an RPC signature change) that applies to TEST then PROD with no human stop.
- **D-02 [auto], LOCKED discriminator:** whichever design wins must pass a THREE-STEP INTERLEAVE arm, not only the SC-1 two-run arm: strategy B (shared key, column set by strategy A, no stored fills of its own) stops below the column; strategy A then syncs cleanly and advances the column; strategy B runs again and MUST re-read its span from the bound. The SC-1 two-run arm is also required, RED on today's code.
- **D-03 [auto]:** SC-1 "the cursor never stamps past stored data" holds for both the per-key column and any new per-strategy state: neither may record a point past where the run is complete through.
- **D-04 [auto]:** No regression for the sibling strategy on the same key and no change for other venues' callers of `advance_sync_cursor` (OKX, Bybit, Deribit, MT5 paths in `run_sync_trades_job`, and `routers/cron.py`). If (a) wins: DROP + CREATE (never a second overload by `CREATE OR REPLACE` with a new parameter), a default that preserves forward-only behaviour, the live ACL re-applied identically (read from the snapshot and baseline, not only the migration's REVOKE line), deploy ordering against the old worker stated, snapshot and `src/lib/database.types.ts` regenerated, and a check that the sibling's re-walk from the lowered bound cannot ping-pong on its own deadline.
- **D-05 [auto]:** If (b) wins: the write is claim-token fenced the way `advance_sync_cursor` is (or the plan argues why an orphan write is harmless), the bound is monotonic toward the EARLIER instant on a stop (LEAST) and cleared only when a run's earliest complete-through instant is at or past it, concurrent advance-vs-lower on the same strategy is analysed (sync jobs per strategy and the claim fence), and the behaviour on a key re-point (`strategies.api_key_id` change) is defined. If it lives on `strategy_sync_cursors`, the table comment's "sole writer is the cron fan-out" and cron.py's reader (three-state membership rule) must stay correct.

### Stop predicate (SC-2)
- **D-06 [auto]:** Adopt the round-3 WR-01 predicate: the unread start is the EARLIEST complete-through instant (a stop: its bound; a failed symbol or a stop with no usable bound: the walk start, i.e. the seed minus `OVERLAP_WINDOW_MS`, or the reach when there was no seed), compared with the next run's walk start (at most `column - OVERLAP_WINDOW_MS`). A stop-plus-partial arm pins it (the `test_probe_false_negative_partial_plus_stop_above_column` shape), with a partial-only arm.
- **D-07 [auto]:** A RAISED read (`phase2_fill_ingestion_failed` on the shared-key first sync, R3 `test_probe_raised_read_column_ahead`) joins the predicate and the re-read bound, so it is flagged and re-read rather than self-healed past. Recommended because it is the same root and data-integrity.

### Signal durability (SC-3)
- **D-08 [auto]:** Option (a) of WR-02: CARRY the sync-time `binance_*` keys (`binance_stop_below_cursor`, `binance_deadline_symbols`, `binance_partial_symbols`, `binance_page_cap_symbols`, and any other `binance_*` key the sync writes; research enumerates them) through the derive prestamp (`_prestamp_flags` in `run_derive_broker_dailies` / the derive path of `job_worker.py`) and the `run_csv_strategy_analytics` rebuild (`analytics_runner.py`). Lists carry as lists (the `is True` present-only pattern fits only the booleans). An arm proves each hop for `binance_stop_below_cursor` and `binance_deadline_symbols`.
- **D-09 [auto]:** Lifetime: a carried key lives until the NEXT SYNC that does not raise it; that sync removes it. A clearing arm is required, or the flag sticks forever. Research traces whether any early return in the derive skips the prestamp for a Binance key (R3 left it untraced) and how the sync epilogue merge treats absent keys.

### Records and switch (SC-4, SC-5)
- **D-10 [auto]:** `USE_RAW_TRADE_INGESTION` stays off for Binance; no plan flips it. The ship PR rewrites the `_RAW_TRADE_INGESTION_ENABLED` comment's SC-3 open-gap paragraph to say it is closed and how, deletes `[250-BINANCE-STOP-BELOW-CURSOR]` from `TODOS.md`, and names it in the CHANGELOG entry.
- **D-11 [auto]:** PROOF-01: every gate goes RED on pre-fix or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), recorded verbatim in the plan SUMMARY. Never `git checkout/restore/stash` on uncommitted work.
- **D-12 [auto]:** Any new `supabase/tests` gate carries a `RED-UNDER` annotation, passes `scripts/lint-migration-data-dependence.mjs` and `node scripts/lint-sql-gates.mjs`, and the plan greps every census it moves (`scripts/mutation-floors.mjs` floors and the vitest ratchet in `src/__tests__/mutation-runner-floors.test.ts`, among others; grep them all with `grep -a`). The migration is stamped after main's latest (`20261125212222` at scout time; re-measure at plan time and before ship) and goes through migration-reviewer and rls-policy-auditor clean at MEDIUM+.
- **D-13 [auto]:** Write scope is listed BY SYMBOL in every plan, because `run_sync_trades_job` is shared with Phase 251 SYNCSTORE.

### Claude's Discretion
- Exact column or table name for the per-strategy bound, the RPC name if one is added, and test file names.
- Whether the predicate code and the bound write share one helper.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and gap record
- `.planning/ROADMAP.md` `### Phase 253` — goal and Success Criteria 1-5.
- `TODOS.md` `[250-BINANCE-STOP-BELOW-CURSOR]` — what, signal gaps, fix direction, gate.
- Phase 250 records, on the LOCAL branch `gsd/phase-250-binancefills` only (`git show gsd/phase-250-binancefills:.planning/phases/250-binancefills-a-binance-fills-read-walks-every-window-and-nev/<file>`): `250-REVIEW-R3.md` (WR-01 predicate code, WR-02 overwrite trace), `250-UAT.md`, `250-VERIFICATION.md`, `250-CONTEXT.md`. Also readable at `the Phase 250 worktree` (read-only).

### Code
- `analytics-service/services/job_worker.py` — `_RAW_TRADE_INGESTION_ENABLED` comment block, `run_sync_trades_job` (seed block using `_fills_cursor_ms` / `load_strategy_fill_high_water`, `fills_anchor_iso`, the `binance_stop_below_cursor` epilogue, the `advance_sync_cursor` call), `_prestamp_flags` in the derive, `JOB_CHAIN_FOLLOW_ON`.
- `analytics-service/analytics_runner.py` — `run_csv_strategy_analytics` `data_quality_flags` rebuild.
- `analytics-service/services/trade_resume.py` — `load_strategy_fill_high_water`.
- `analytics-service/services/exchange.py` — the Binance windowed fills walk, `OVERLAP_WINDOW_MS`, `BINANCE_PAGE_CAP`, `_binance_fills_window_ms`.
- `analytics-service/routers/cron.py` — `strategy_sync_cursors` reader/writer, other `advance_sync_cursor` reference.
- `analytics-service/tests/test_binancefills_cursor.py`, `analytics-service/tests/_binance_fills.py` — Phase 250 arms and fixtures to extend.

### Database
- `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql` and `supabase/schema/functions/advance_sync_cursor.sql` — the only definition; ACL.
- `supabase/migrations/20260810120000_lock_api_keys_exchange_column.sql` — references `advance_sync_cursor`; check what it enforces on `api_keys` writes.
- `supabase/migrations/20260919120000_strategy_sync_cursors.sql` — per-strategy precedent.

### External
- Binance API docs for spot `GET /api/v3/myTrades` and USD-M futures `GET /fapi/v1/userTrades` (time-window limits, `fromId`, `startTime`/`endTime` semantics): research fetches and cites them.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 232 VREAD-08 seed (`min(column, fill high-water)`) is the insertion point for a per-strategy bound: one more term in the `min`.
- `daily_pnl_malformed_*` carry in `run_csv_strategy_analytics` is the pattern WR-02 names for carrying keys through the rebuild.
- `strategy_sync_cursors` gives a per-strategy, cascade-on-delete, service-role-only home.

### Established Patterns
- Claim-token fence on epilogue writes (`WORKER_FENCE_V2`, NEW-C12-05).
- Over-fetch is absorbed by the `(strategy_id, exchange, exchange_fill_id)` unique index, so re-reading a span is safe.

### Integration Points
- The epilogue between the persist and the `advance_sync_cursor` call in `run_sync_trades_job`, shared with Phase 251.
</code_context>

<specifics>
## Specific Ideas
- R3's verified predicate code block in `250-REVIEW-R3.md` WR-01 is the starting point for D-06.
</specifics>

<deferred>
## Deferred Ideas
- Carrying non-`binance_*` sync-time flags (`sync_truncated_*`) through the derive: same overwrite class, outside this phase's SC-3.
- A fully per-strategy fills cursor replacing the per-key column for every venue: larger than this gap.
</deferred>

---

*Phase: 253-binancecursor*
*Context gathered: 2026-11-26*
