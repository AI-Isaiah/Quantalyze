# Phase 223: FLOWKINDS - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Each funding caller outside the composite path gets a recorded, test-pinned decision on a malformed funding row, and the PROD malformed realized-row count is on record with the founder's ruling (FLOWK-02, FLOWK-03). By founder ruling on 2026-11-24 the phase also owns census row C27 from Phase 231: the daily Bybit `sync_funding` walk runs past its 180-second handler budget and, because rows are upserted only after the whole walk, has never filled `funding_fees`.

In scope, by symbol:
- `services/okx_archive_job.py::_live_reference` (the live OKX funding read).
- `services/job_worker.py::run_sync_funding_job`.
- `services/funding_fetch.py::fetch_funding_bybit`, only as far as C27 needs.

Out of scope:
- The composite member read (`run_stitch_composite_job` and its member funding read), by founder ruling F-2 of 2026-11-23, "Forget about conposites".
- Phase 232's symbols: `run_sync_trades_job`, the OKX trade reads and the OKX bills reader in `services/exchange.py`.
- Any refusal of a malformed REALIZED row anywhere, including `okx_archive_job._check_live_realized_flags` (ruling 2 below).

The PROD count is recorded in `223-PROD-MALFORMED-COUNT.md` (2026-11-24): 0 flags on every measured key and strategy. Two Bybit key rows predate Phase 186, so they and the Bybit keys with no derived row are not measured.

</domain>

<decisions>
## Implementation Decisions

### Founder rulings, 2026-11-24 (AskUserQuestion, relayed by the orchestrator, labels verbatim)
- Ruling 1, `okx_archive_job` and a malformed live funding row: "Stop by name (Recommended)". `_live_reference` calls `fetch_funding_okx(..., on_malformed="raise")` and turns `FundingRowsMalformed` into `_Stop("live_anchor_unusable", "live_funding=malformed")` before any write. — **Reversibility:** costly — the stop decides whether an operator-run rebuild publishes a series; live funding feeds `rebuild_union` and the rolled NAV anchor on live-only days that the cent-level reconciliation does not cover.
- Ruling 2, FLOWK-03 and a malformed realized row: "Keep flagging (Recommended)". Phase 186 D-12 stays: the `daily_pnl_malformed_<venue>` flag is recorded and the key is not refused. No code adds a realized-row refusal in this phase.
- Ruling 3, C27, the Bybit `sync_funding` walk over budget: "Yes, 223 fixes it". This went against the phase agent's recommendation to keep C27 out of scope. The walk must fit its budget, or be restructured so it fills the table, without hiding a timeout.

### `run_sync_funding_job` and a malformed funding row (phase agent's decision, confirmed by the orchestrator 2026-11-24)
- It keeps the default `on_malformed="drop"` (WARNING log), pinned by a test that fails if the caller starts raising or stops dropping. Reason: no published number reads `funding_fees` (its one reader, `position_reconstruction.reconstruct_positions`, has no non-test caller at HEAD; the other readers are the GDPR export, `sanitize_user` and the operator script `scripts/bybit_reconcile.py`). Refusing would also starve the table: a refused walk stores nothing, the cursor never moves, and the job would refuse daily. Revisit when a published reader of `funding_fees` appears.

### F-2 (founder 2026-11-23, unchanged)
- `[186-OTHER-FUNDING-CALLERS-DROP]`'s composite caller is recorded in the ship as out of scope by F-2, not as fixed.

### Decided autonomously
- [C27] Q: 'How does the Bybit funding walk fill the table inside a 180 s budget?' → Selected: 'run_sync_funding_job walks the Bybit range one 7-day window at a time (fetch_funding_bybit gains an optional end bound), reading both categories per window and upserting after each window, oldest first, so the max-timestamp cursor only advances over ranges already stored and the next attempt resumes there' — no schema, no migration; the change is local to the handler and one fetcher keyword.
- [C27] Q: 'Does the walk stop itself before the handler budget?' → Selected: 'No self-deadline. The handler timeout stays the only stop, so a walk still over budget fails as Handler exceeded timeout and is retried; each attempt keeps what it stored' — one less mechanism, and a timeout stays visible as a failure, never a quiet DONE.
- [C27] Q: 'Category order inside a window' → Selected: 'linear then inverse inside the same window, before that window's upsert' — the per-strategy cursor is shared by both categories, so a category-outer walk would let linear progress skip inverse history.
- [PROOF-01] Q: 'How is each decision pinned?' → Selected: 'one test per caller that drives a malformed row through the real caller with the fetcher's walk mocked at the exchange call, plus a C27 test that a cancelled walk keeps the windows it finished; each goes RED on a neutered copy and GREEN after cp/cmp restore' — test-only.

### Claude's Discretion
- Test file placement, the exact `_Stop` detail wiring and the fetcher keyword's name.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services/funding_fetch.py`: `FundingRowsMalformed`, `_raise_if_malformed`, the `on_malformed` keyword on all three fetchers, and `upsert_funding_rows` (idempotent on `match_key`).
- `services/exchange_pagination.py::walk_paginated`: categories outer, windows inner; takes `since_ms` and `now_ms`.
- `services/okx_archive_job.py::_Stop` and `_check_live_realized_flags` show the named-stop shape.
- The derive (`run_derive_broker_dailies_job`) already maps `FundingRowsMalformed` to the named refusal `funding_rows_malformed`, the model for ruling 1.

### Established Patterns
- Tests mock `services.funding_fetch.fetch_funding_*` in `tests/test_job_worker_sync_funding.py`, and `okx_archive_job.fetch_funding_okx` in `tests/test_okx_archive_apply.py`.
- `tests/test_bybitreads_census_pins.py::test_census_c27_...` (Phase 231) pins the 106-request floor of a first walk; this phase must keep it true or update it on purpose.

### Integration Points
- `TIMEOUT_PER_KIND["sync_funding"]` is 180 s; the cron (`src/app/api/cron/sync-funding/route.ts`) enqueues daily at 04:00 UTC.
- `sync_funding` is a side kind in the analytics status (migration `20261009120000_sync_status_analytics_scope.sql`), so its failures do not move a strategy's status.

</code_context>

<specifics>
## Specific Ideas

- Probe numbers for C27 (231-CENSUS, 2026-11-23, one key): 379 s, 1438 calls, 65522 linear rows, 0 inverse rows, 0 rows stored.
- Close `[186-OTHER-FUNDING-CALLERS-DROP]` and `[186-REALIZED-MALFORMED-COUNT]` in the ship PR and name them in the CHANGELOG.

</specifics>

<deferred>
## Deferred Ideas

- A realized-row refusal (ruling 2 keeps D-12; nothing to build).
- The composite member funding read (F-2).

</deferred>
