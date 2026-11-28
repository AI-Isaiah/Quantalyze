# Phase 257: SEEDHOLD - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Two survivors of Phase 255 NULLANCHOR's review, both in `run_sync_trades_job` (`analytics-service/services/job_worker.py`) and both about the next run's fills seed landing past (or stuck at) a span the per-strategy re-read bound does not record. Founder ruling 2026-11-27 (AskUserQuestion, recorded in the ROADMAP and `255-CONTEXT.md`), verbatim: **"Fix both in a follow-up (Recommended)"**.

1. **`[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`.** When the provisional `set_strategy_fills_reread_bound` write fails (its `except Exception` arm, so one transient failed write is enough, not only an outage or a rollback of migration `20261126150000`), the run skips its fills read and holds its own daily store. But other writers (`cron_sync` in `routers/cron.py`, `/fetch-trades` in `routers/exchange.py`, and any other writer the research census finds) still store daily rows, so the next run seeds at `min(column, daily high-water)` past the span run 1 never read, and its clean read clears `phase2_fill_ingestion_failed`. Phase 255 research measured it reachable on a set column with no stored fill and on a first sync for OKX, Bybit and Deribit, and NOT on a NULL column with a seed (the Phase 232 bootstrap anchor covers that one). The outcome this phase delivers: after a failed provisional bound write, run 2's walk start is at or before run 1's seed, whatever daily rows were stored in between.
2. **`[255-BYBIT-DEADLINE-NO-PROGRESS]`.** A Bybit fills read that hits its deadline (`BybitTradeWindowIncomplete("deadline")`) is all-or-nothing today, so the next run walks the same span from the same seed and refuses again, and each refusal lowers the bound by the 1 h overlap (`_earliest_through()` returns the walk start minus 1 ms on `phase2_failed`). The outcome: the read keeps what it completed, records how far it is complete (a read-through mark, as Binance does), and the next run continues from there.

In scope: the seed, bound and epilogue handling in `run_sync_trades_job`; the Bybit fills reader `_fetch_raw_trades_bybit` and its call in `fetch_raw_trades` (`services/exchange.py`); the two-run gate arms; a no-regression pin for Binance read-through, Phase 255's SC-1 matrix and `advance_sync_cursor`'s callers; deleting both TODOS entries in the ship PR; PROOF-01.

Out of scope: `_fetch_raw_trades_okx` (editing it fires `[255-OKX-BEGIN-REACH-PROBE]`'s trigger), MT5 (no fills read by design), the Phase 232 VREAD-08 ruling Q1 seed rule, the shared `api_keys.last_fetched_trade_timestamp` semantics (forward-only through `advance_sync_cursor`), and the contract of the shared `walk_paginated` driver for its other callers.

</domain>

<decisions>
## Implementation Decisions

### Decided autonomously
- [Where the span lives when the bound write fails] Q: "What record carries run 1's seed to run 2 when `set_strategy_fills_reread_bound` raised?" → Selected: "NOT locked here. Research enumerates every candidate home and rates each against the five criteria below, with a measurement where the code allows one. The home is chosen only if an EXISTING record that is not anon-readable passes all five." — the choice is the research's, and the escalation trigger below keeps a hard-to-reverse choice away from autonomy.
  - (a) It works after ONE failed write. A probe of whether the RPC exists is not enough, because the arm is `except Exception`.
  - (b) It works on a first sync (possibly no `strategy_analytics` row yet) and on a set column with no stored fill for the strategy.
  - (c) It survives everything that can run between run 1 and run 2: the chained `derive_broker_dailies` pre-stamp (`_prestamp_dq_flags` builds a fresh flags dict and carries only an allowlist), the wholesale CSV rebuild in `analytics_runner`, any other wholesale `data_quality_flags` writer the census finds (including the Next.js routes under `src/app/api/`), and the worker's own `flag_load_failed` upsert, which replaces the column from an empty dict.
  - (d) It says what happens when its own write fails (the flags upsert is best-effort and unfenced), and that failure is named in the SUMMARY as a residual or closed.
  - (e) It leaves the shared `last_fetched_trade_timestamp` and the Phase 232 Q1 seed rule alone.
  - ⛔ **Escalation trigger.** If the only homes that pass (a) to (e) are a NEW key on the anon-readable `strategy_analytics.data_quality_flags` row, a migration (new table, column or RPC), or `cron_sync` and `/fetch-trades` holding their daily store, that is a founder question (it reverses Phase 255's "No new public key" choice, or adds a one-way schema change, or changes daily-P&L freshness on a separate path). The phase agent stops before planning this half and reports the measured table with a recommendation. The Bybit half may still be planned.
- [Writer census] Q: "Which writers can move a seed term between run 1 and run 2?" → Selected: "Research lists every writer of `is_fill = false` daily rows (every `sync_trades` RPC caller in Python and TypeScript, the chained derive) and every writer of the record chosen above. A seed-side fix is writer-agnostic; a writer-side fix must cover every writer on the list" — research-only.
- [Measurement first] Q: "Which SC-1 arms are RED at HEAD?" → Selected: "Not assumed. The FIRST plan task writes the matrix (Binance, OKX, Bybit, Deribit × a set column with no stored fill, a first sync with no column and no daily high-water, and a NULL column with a seed × run 1's provisional bound write raising, a daily row stored by a cron-style writer between the runs, run 2 with the RPC recovered) and runs it on unmodified code, recording each arm RED or GREEN verbatim. A GREEN arm (expected: every NULL-column-with-seed arm, and possibly Binance's first sync through the Phase 250 CR-01 reach anchor) stays as a regression pin and is reported, never forced RED" — test-only.
- [Bybit read-through shape] Q: "How does a deadline-stopped Bybit read record progress?" → Selected: "As Binance does: a window counts as complete only when its page loop ended naturally; the fills of the completed windows are returned and persisted; the read records the instant it is complete through (the end of the last completed window); the cursor stamp is at or before that mark; the epilogue's bound advances to it (`_earliest_through()` returns the mark, not the walk start minus 1 ms). A persist failure still falls back to the walk start minus 1 ms. When the deadline hits inside the FIRST window, nothing is complete: the bound holds at the run's seed and does not creep down by the overlap" — internal logic.
- [Bybit stall stays visible] Q: "Does a deadline-stopped Bybit run read as clean?" → Selected: "No. The run is never reported clean: it keeps an existing incomplete-read signal (`phase2_fill_ingestion_failed` or an existing key the research names) set, while the stamp and bound gates are decoupled from `phase2_failed` for this one case so the creep stops. The mark itself lives in the bound row and within the run if that suffices; a NEW public key for it is the same escalation as above" — avoids widening the anon-readable surface without a founder ruling.
- [Shared driver] Q: "May `walk_paginated` change?" → Selected: "Only additively, if at all: the Bybit reader tracks window completion in its own page callback, or through an opt-in the other contracts do not set. A pin asserts the other callers' behaviour is unchanged" — internal.
- [Timing] Q: "Does a partial persist after the deadline fit inside the 900 s handler cancel?" → Selected: "Research measures it against the read deadline constant and the persist batch size, and the plan states the margin; if it does not fit, the deadline is lowered for Bybit, never the handler cap raised" — internal constant.
- [Tests] Q: "Where do the gate arms live?" → Selected: "A new pytest module under `analytics-service/tests/` built on the two-run harnesses in `test_nullanchor_bound.py`, `test_binancefills_cursor.py` and `test_okxtrades_cursor.py`; existing suites change only where an assertion encodes the old behaviour, each with a dated intent-change note" — test files only.
- [Migration] Q: "Is a migration expected?" → Selected: "No. If research finds one is needed, that is the escalation above" — keeps the serial migration lane out unless a founder rules.

### Claude's Discretion
- Plan count and wave split. Standing rules: one executor per plan, PROOF-01 recorded verbatim in each plan SUMMARY, CI mypy strict in every analytics-touching pre-push check, the Bybit v5 API docs read for the execution-list paging and window semantics.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `run_sync_trades_job` ccxt arm (`services/job_worker.py`, search `Phase 253 BINANCECURSOR round-2 (CR-02`): `_set_bound`, `_provisional_unread_ms`, the fail-closed `except` (sets `_fills_read_skipped`, `phase1_read_refused`, `phase2_failed`, `phase2_error_message = "re-read bound write failed (...)"`), and the orphan branch.
- Seed terms: `_fills_cursor_ms` (column), `load_strategy_fill_high_water`, `load_strategy_high_waters` (daily high-water), `load_strategy_fills_reread_bound` (bound, `_bound_read`).
- Epilogue: `_walk_start_ms`, `_covers_from_iso`, `_earliest_through()` (Binance branch and the non-Binance `phase2_failed or sync_truncated_*` branch), the epilogue `_set_bound(_unread_from_ms, _covers_from_iso)`, `advance_fetched_cursor`, `fills_anchor_iso`, `_fills_stopped` / `_read_through` (Binance-keyed).
- Binance read-through: `_BinanceSymbolRead.read_through_ms`, `binance_read_through_ms` recorded through `_record_dq_flag` (`services/exchange.py`), carry allowlist `services/binance_sync_flags.py`.
- Bybit reader: `_fetch_raw_trades_bybit` (`services/exchange.py`), `read_deadline_s`, `BybitTradeWindowIncomplete`, `walk_paginated` (`services/exchange_pagination.py`, windows walked oldest first, rows lost on a raise).
- Two-run harness: `analytics-service/tests/test_nullanchor_bound.py` (Phase 255's 30-arm matrix).

### Established Patterns
- Claim-token fence via `WORKER_FENCE_V2` on every RPC write.
- Seed = min(column, stored-fill high-water or daily high-water, re-read bound); over-fetch absorbed by the `(strategy_id, exchange, exchange_fill_id)` unique index.
- The bound RPC can only INSERT, REPLACE or LOWER with `p_covers_from` NULL, and advances (R4) or clears (R6) with real covers.
- PROOF-01: neuter, see RED with the named arm, restore with `cp`, verify with `cmp`, GREEN; never `git checkout/restore/stash` on uncommitted work.

### Integration Points
- `cron_sync` (`routers/cron.py`, `_sync_single_key`, its own `strategy_sync_cursors` marker for the daily window) and `/fetch-trades` (`routers/exchange.py`) store daily rows through `sync_trades` without consulting the bound.
- `derive_broker_dailies` pre-stamp and the CSV rebuild replace `data_quality_flags` wholesale except for allowlisted carries.

</code_context>

<specifics>
## Specific Ideas

- 255-RESEARCH measured the residual (run 2 `since_ms` past run 1's seed on a set column and on a first sync, all three non-Binance venues; the NULL-column-with-seed variant not reachable). Deribit's real data impact is nil (`fetch_deribit_fills` ignores `since_ms`), but its arm measures the seed like the others.
- Expect merge conflicts with Phase 256 OKXUNITSWITCH in `services/exchange.py`; re-base before ship.
- At ship, grep both TODOS ids across the repo (runbooks, tests, CLAUDE.md), not only `TODOS.md`.

</specifics>

<deferred>
## Deferred Ideas

- `[255-OKX-BEGIN-REACH-PROBE]` stays booked; this phase does not touch the OKX reader.

</deferred>

## Research outcome 2026-11-27 (phase agent)

- The "one failed write is enough" premise was measured false: the epilogue write repairs a single failed provisional write. The ROADMAP goal bullet is corrected.
- The escalation trigger FIRED for half 1 (`257-RESEARCH.md`, candidate table). The only existing non-anon-readable record that carries the span is the run's own `compute_jobs.metadata`, and a compliant write of it needs a new fenced merge RPC (Phase 191 REFUSALRACE convention), which is a migration. Planning stopped here pending a founder ruling. The Bybit half is prototyped and plannable.

## Founder decision 2026-11-28 (AskUserQuestion, relayed by the coordinator)

- Half 1 home, verbatim choice: **"Job's private record (Recommended)"**. That is Option 1 of `257-RESEARCH.md`: one additive, claim-token-fenced merge RPC writes a seed-hold mark into the running job's own `compute_jobs.metadata` (service-role only), and the next run reads the mark at seed time as a further seed term. Planned together with the Bybit half.
- The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding before merge, and its timestamp sorts after the PROD ledger tip and after the other open phases' migrations (243 uses `20261127220000`).
- The two residuals (a double fault: the RPC down and the mark write failing in one run; the mark ageing out with the 30-day `done` reaper) are booked in `TODOS.md` only if rated MEDIUM or above.
- Both TODOS entries are deleted at ship.
