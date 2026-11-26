# Phase 232: OKXTRADES — an OKX read converts or refuses a non-USDT bill, completes a long window and never runs ahead of stored trades - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

From ROADMAP.md `### Phase 232` (quoted, binding): "An OKX read converts or refuses a non-USDT daily bill, completes a first window longer than the page cap, and never lets the trade cursor run ahead of stored trades."

Delivers (REQUIREMENTS.md VREAD-06..08, ROADMAP SC-1..4):
- VREAD-06: an OKX daily P&L bill in a currency other than USDT is converted at a stated rate or refused by name, never summed at face value. A test RED on today's code feeds a mixed-currency day.
- VREAD-07: an OKX first window longer than the page cap completes across ticks with no daily `error`, with `OKX_BILLS_PAGE_CAP` unchanged ("Raising `OKX_BILLS_PAGE_CAP` is not a close"). Or, if OKXHISTORY (167.1.2.2.2.1) already closed it, the closing evidence is recorded.
- VREAD-08: `api_keys.last_fetched_trade_timestamp` never reads ahead of the newest stored trade, and a key found ahead has its skipped days re-read. SC-3: "A key whose cursor is ahead of its newest stored trade reads from the stored high-water mark and re-reads its skipped days, and the cursor never advances past stored data."
- PROOF-01 (SC-4): each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), GREEN, recorded verbatim in the plan SUMMARY.

Scope fence (ROADMAP, Depends on): "It shares `run_sync_trades_job` with 222 ALERTTRUTH (ERRC-03), so this phase edits only the cursor read and the `advance_fetched_cursor` path, and 222, later in the order, re-bases on it. Research first: check whether OKXHISTORY already closed the truncation." Plan write scopes are listed BY SYMBOL. Phase 223 FLOWKINDS runs in parallel and owns funding callers (`run_sync_funding_job`, `services/okx_archive_job.py`, `services/funding_fetch.py`): this phase does not edit them. Phases 225, 227, 229 run in other worktrees: not touched.

Hand-off from Phase 231 (records on main, `231-04-SUMMARY.md` `dependency-232`, `231-REVIEW-W2.md` WR-03 / SF-6 / R2-3, ruling OQ5): `run_sync_trades_job` advances `last_fetched_trade_timestamp` when a raised `fetch_raw_trades` left `raw_fills` empty (`advance_fetched_cursor = (not raw_fills) or (...)`), so a named refusal does not hold the window; and the next clean run's self-heal pops `phase2_fill_ingestion_failed`, so the skipped span becomes a silent gap (gap 1). Gap 2 (more is lost than before) follows from the same line. Gap 3 (a first sync whose 365-day walk hits the 900 s handler timeout loses that run's Phase-1 daily P&L) is about the ORDER of Phase 1 and Phase 2 inside `run_sync_trades_job`, outside this phase's cursor-only write scope.

</domain>

<decisions>
## Implementation Decisions

### PROD readings taken 2026-11-24 (marker query returned the PRODUCTION comment first; counts only, no ids)
- `api_keys.last_fetched_trade_timestamp` is non-NULL on 20 active keys: Bybit 5 (4 with no stored fill at all, 1 ahead of its newest stored fill by 33.0 days), MT5 10 (none has any stored fill), OKX 5 (2 with no stored fill, 2 ahead of their newest stored fill by more than 1 day, at most 6.0 days). No key is ahead of its newest stored daily (`is_fill = false`) row by more than 1 day.
- Code reading: the ONLY writer is `run_sync_trades_job`'s epilogue through the `advance_sync_cursor` RPC, which stamps wall-clock `now` (`_p_last_fetched = _now_iso if advance_fetched_cursor else None`). `advance_fetched_cursor` is true whenever `raw_fills` is empty, which covers a raised fetch, an empty read, the MT5 arm and every run with `USE_RAW_TRADE_INGESTION` off. So the writer that puts the column ahead is identified: it stamps "now" rather than a stored-through mark. The RPC keeps the column monotonic (`CASE ... last_fetched_trade_timestamp < p_last_fetched_ts`), so a lower value cannot be written back through it.

### Decided autonomously
- [VREAD-08] Q: "What does the cursor stamp?" → Selected: "A stored-through mark: the newest timestamp among the fills this run persisted; when the run persisted no fill, the column is left untouched (NULL param). It never stamps wall-clock now." — Python-only change to the param the existing RPC already takes.
- [VREAD-08] Q: "When may it advance?" → Selected: "Only when Phase 2 ran, did not raise and persisted, and Phase 1 did not fail: gate `advance_fetched_cursor` on `not phase2_failed` as the 231 hand-off asks. A refused or failed fills read holds the cursor." — one boolean expression.
- [VREAD-08] Q: "How does the read seed when the column is ahead?" → Selected: "`fills_since_ms` is the EARLIER of the column and the strategy's stored fills high-water (newest `is_fill = true` trade); with no stored fill it falls back to the stored daily high-water, as a NULL cursor does today. So an ahead key re-reads its skipped days; the over-fetch is absorbed by the `exchange_fill_id` unique-index dedup." — read-side clamp, local.
- [VREAD-08] Q: "Does the refusal flag survive until the refused span is covered (231 gap 1)?" → Selected: "Yes by construction: the cursor holds on a refusal, so the next clean run re-reads from the stored high-water, which covers the refused span; only then does the existing self-heal clear the flag. A test pins that sequence." — no new state.
- [VREAD-08] Q: "231 gap 3 (Phase-1 persist ordered after the Phase-2 walk)?" → Selected: "Not fixed here: it reorders `run_sync_trades_job` beyond the cursor read and `advance_fetched_cursor` path the ROADMAP fences. Recorded in the phase report and routed by name to 222 ALERTTRUTH (shares the function), latent while `USE_RAW_TRADE_INGESTION` is off." — scope note, revisitable.
- [VREAD-08] Q: "Repair of the columns already ahead on PROD?" → Selected: "No migration and no RPC change in this phase. The read clamp makes an ahead column harmless at once. A one-time PROD repair (set the column to the newest stored fill, or NULL where none) is proposed to the coordinator for after the merge, recorded in the SUMMARY with the before/after counts; the TODOS gate's repeated read is taken after it." — a data write, decided outside the code.
- [VREAD-06] Q: "Convert or refuse?" → Selected: "A bill whose `ccy` is a stable coin under the existing shared rule `services/price_rule.is_stable_value` is counted at 1.0 (the codebase's stated rate for stable coins, already used by the current-equity read). Any other `ccy`, including a blank or missing one, refuses the OKX daily-P&L read by name: a new closed token (for example `daily_pnl_non_usd_okx`) recorded through `_record_dq_flag`, carried by `daily_pnl_read_verdict` and the realized refusal set exactly like `daily_pnl_truncated_okx`, never summed. No price source is added." — code-only; a conversion path can be added later without migrating anything. Exposure measured nil so far (the 2026-10-26 archive census: 1606 of 1606 bills USDT; stored OKX fills and funding all USDT).
- [VREAD-06] Q: "Refuse the day or the whole read?" → Selected: "The whole read, permanent class (the same history fails the same way), like a cap hit. Withholding one day would leave a hole a downstream reader can take for zero P&L." — local to the verdict.
- [VREAD-07] Q: "Already closed by OKXHISTORY?" → Selected: "Research re-measures at HEAD first. The TODOS entry says 'measured, not fixed, stays open' (2026-10-15 and 2026-10-26), so the default is to fix it." — evidence step.
- [VREAD-07] Q: "Fix shape?" → Selected: "Walk the OKX bills read in UTC-day-aligned time windows (`begin`/`end` on every request) taken OLDEST first, each window paged newest-first by `after` up to the unchanged `OKX_BILLS_PAGE_CAP`. A walk stopped by the read deadline returns only fully read windows, a contiguous oldest prefix, under a distinct non-error marker so the caller stores that prefix and the next tick resumes from the stored high-water; a single window that exceeds the cap still refuses by name (`daily_pnl_truncated_okx`). Window length is sized by research from the measured bill density." — request-shape change inside the OKX branch of `fetch_daily_pnl`; the exact marker and the caller wiring are research outputs.
- [Fixtures] Q: "Test payloads?" → Selected: "Built from recorded real OKX v5 `/account/bills` payload shapes (fields `billId`, `ccy`, `pnl`, `fee`, `ts`, `type`, `instType`), mocks mirror the payload, not the parser's field names." — test-only.

### Claude's Discretion
- Plan split and waves, within: research first; VREAD-06 and VREAD-07 both edit the OKX branch of `fetch_daily_pnl`, so they are serial or one plan; VREAD-08 edits only `run_sync_trades_job`'s cursor read and `advance_fetched_cursor` path and can run in parallel. At most 2 executors at once.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/exchange.py`: `fetch_daily_pnl` OKX branch (live bills walk, archive walk, merge/dedup by `billId`, per-day aggregation that drops funding type `8`), `_okx_bills_fetch_with_backoff`, `OKX_BILLS_PAGE_CAP` / `OKX_ARCHIVE_PAGE_CAP`, `_record_dq_flag` / `get_and_clear_last_dq_flags`, `_finite_float`, `daily_pnl_read_verdict`.
- `services/price_rule.is_stable_value`: the shared stable-coin rule.
- `services/job_worker.py`: `READ_INCOMPLETE_TOKENS`, `_DAILY_PNL_REFUSAL_ORDER`, `_TRANSIENT_REFUSAL_TOKENS` (realized refusal machinery); `run_sync_trades_job`, `load_strategy_high_waters`, `parse_since_ms`.
- `routers/cron.py` `_FETCH_TRUNCATED_PREFIX` (the cron's reading of `daily_pnl_truncated_*`).
- `services/exchange_pagination.walk_paginated` (template for windowed walks, per 231).

### Established Patterns
- Fail loud, fail alone: a typed, scrubbed refusal by a closed token, never a silent partial (186 decision 05).
- Truncated windows are degraded: nothing stored, no stamp, key `error` (167.1.2.2.2 PR-B SFH-H2).
- Cursor writes go through the claim-token-fenced `advance_sync_cursor` RPC (monotonic per column).

### Integration Points
- `fetch_daily_pnl` callers (strategy sync, the cron daily path, the derive) and every reader of `daily_pnl_truncated_okx` (`routers/cron.py`, `job_worker.py` refusal sets, `services/okx_archive_job.py:1660`, a Phase 223 file: read only, not edited).
- `run_sync_trades_job`: the `fills_since_ms` read and the `advance_fetched_cursor` / `_p_last_fetched` epilogue only.

</code_context>

<specifics>
## Specific Ideas

- The TODOS entries this phase closes: `[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]`, `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]`, `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD`. Each is deleted in the ship PR and named in the CHANGELOG (founder decision 2026-11-14), and any pointer to them is fixed in the same PR.
- Analytics gates: test against CI's pinned ccxt and pass CI's mypy strict; pytest runs only from `analytics-service/`.

</specifics>

<deferred>
## Deferred Ideas

- Converting a non-stable OKX bill at a market rate (needs a price source): not needed while exposure is nil; the refusal names it if it appears.
- 231 gap 3 (Phase-1 persist after the Phase-2 walk): routed to 222 ALERTTRUTH.
- One-time PROD repair of the ahead cursors: coordinator decision after the merge.

</deferred>

<orchestrator_rulings>
## Rulings after research (2026-11-24, phase orchestrator; reversible technical choices)

These answer 232-RESEARCH.md `### Needs a ruling before planning` Q1-Q7. None is a founder ruling; each is recorded in the phase report.

- Q1 VREAD-08 bootstrap (NULL column, no stored fill): no new JSONB key. The seed rule becomes `fills_since_ms = min(column, newest stored fill if one exists else daily_since_ms)`; a NULL column keeps today's seed (`daily_since_ms`). When `fetch_raw_trades` raised AND the column was NULL at read time AND the run had a non-NULL seed, the epilogue passes that seed as `p_last_fetched_ts` (an anchor at the read start, never ahead of where the read began; the RPC writes it only into a NULL column). The next clean run then seeds from that anchor and covers the refused span before the self-heal clears the flag. A first sync whose seed is NULL (full reach) has nothing to anchor: accepted and documented (raw ingestion is off).
- Q2 Prefix marker: reuse `daily_pnl_deadline_okx`, with the tightened contract "rows are whole UTC days of the windows read before the deadline, a contiguous oldest prefix".
- Q3 VREAD-06 refinement: a bill refuses when its `ccy` is not stable under `is_stable_value` AND its finite `pnl + fee` is nonzero. A zero-amount non-stable bill contributes 0 at any rate, so counting it is exact and refusing it would be over-refusal. Blank/missing `ccy` with a nonzero amount refuses. A spot key paying fees in the base coin therefore still refuses by name (recorded; no OKX spot key is stored on PROD).
- Q4 `okx_archive_job._check_live_realized_flags` (Phase 223's file): not edited; the one-line hand-off goes to the coordinator for 223.
- Q5 Self-checking walk: adopt (window clip and descending numeric `billId`, a violation raises a typed exception whose class name reaches `daily_pnl_fetch_error_class`). Re-date the affected harness fixtures to window-relative times; fix the `test_walletoffset_probe` calendar rot in the same plan.
- Q6 Age-route endpoints per window (`/bills` for the last 7 days, `/bills-archive` older, both for a straddling window, union by `billId`): adopt; `test_90_day_gate_skips_archive` flips.
- Q7 Hold the fills cursor also when any `sync_truncated_*` flag is true: adopt.
- Follow-on, not fixed: a marker-present cron strategy whose 30-day window exceeds the OKX cron deadline re-reads the same prefix every tick (loud: `held` + `fetch_partial_prefix`); recorded in the phase report.
- Routed to 222 ALERTTRUTH by name: 231 gap 3, the Phase-1 store under flags in `run_sync_trades_job`, the never-cleared public `daily_pnl_*` flags.
- Plan split: research's A (VREAD-06 + VREAD-07 walk in `exchange.py`), B (cron prefix handling in `routers/cron.py::_sync_single_key`, after A), C (VREAD-08, parallel with A). At most 2 executors at once.
- Planner rulings (2026-11-24, after planning): SC-2's "no daily `error`" is read as the KEY status `error` the TODOS entry describes ("reports `error` daily"). A catch-up tick's key status is `held` with `fetch_partial_prefix`, never `error`. The `cron_runs` heartbeat still counts `held` as non-OK (an `error` row naming only `held=1`) and is NOT edited, so a permanent stall stays loud; a self-resolving backlog writes about one such row per catch-up tick except the last. The planner's reversible choices 1-7 are accepted as written in the plans (anchor also on a partial persist, 93-day reach clamp, unparsable non-stable amount goes to the malformed path, VREAD-06 as its own wave-2 plan, no COVERAGE.md, the dated runbook notes, the wave-1 cross-file rule).
- ⭐ **Founder ruling (2026-11-24), superseding the framing that the SC-2 reading in the planner ruling above was still being put to the founder by the coordinator (232-VERIFICATION.md):** "SC-2 = key status only. SC-2 is met as verified, and the heartbeat row keeps reporting held keys as error." The planner ruling on SC-2 is therefore confirmed by the founder, and the `cron_runs` heartbeat keeps `held` in `_NON_OK_STATUSES`.
</orchestrator_rulings>
