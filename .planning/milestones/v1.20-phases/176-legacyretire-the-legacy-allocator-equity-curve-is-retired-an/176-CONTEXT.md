# Phase 176: LEGACYRETIRE — the legacy allocator equity curve is retired and every reader moves to the marked series - Context

**Gathered:** 2026-10-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Retire the legacy allocator equity curve, `public.allocator_equity_snapshots`. It is written by the daily refresh, the history reconstruct and the window replace. Every product reader moves to the derived allocator series, `allocator_equity_derived` with kind `equity_curve`: realized basis before an account's first mark and marked from it on (NAVMTM/MARKSOURCE). The legacy writers stop, and the table is removed. The phase absorbs Phase 181 SHAREDKEYS and supersedes Phase 182 SPIKEREPAIR (D-01).

Census of record (2026-10-31, read-only, at origin/main 293a68f8e). The My Allocation equity chart and the embedded portfolio factsheet already draw from the derived series (`src/lib/queries.ts` `equityDailyPoints = series.curve`, ~:5093). The legacy curve feeds only these:
- The 30-day warm-up gate: `snapshotCount < 30` in `KpiStrip.tsx` and `ScenarioComposer.tsx`, from `queries.ts` ~:5805.
- The history-depth copy (`minHistoryDepthMonths`) and the baseline-unknown banner (`partitionTrustworthyEquitySnapshots` -> `equityBaselineUnknown`, `AllocationDashboardV2.tsx`).
- Bridge outcomes: `compute_bridge_outcome_deltas` reads them through `extract_symbol_value_at`, per symbol, from the row's breakdown.
- The zero-history bootstrap: `enqueue_refresh_allocator_equity_for_all` :498-516, and its Python twin `_owed_reconstructs_for_zero_snapshot_book`.
- `delete_allocator_api_key`, both replace RPCs and the GDPR export manifest. The diagnostic scripts and tooling lists name the table too.
</domain>

<decisions>
## Implementation Decisions

### Relation to Phases 181 and 182
- **D-01:** "176 absorbs both (Recommended)" (founder 2026-10-31).
  - 176 moves the readers above to the derived series and stops the legacy writes.
  - **182 SPIKEREPAIR closes as superseded.** Its 22 spike days exist only in the legacy rows, and nothing reads those once 176 ships.
  - **181 SHAREDKEYS is done inside 176.** The derive already selects keys by `eligible_key_predicate` with no strategy-link exclusion (`job_worker.py` ~:14444; `derive.py` ~:331). The remaining exclusion is the TS reader rule `allocatorEligibleApiKeyIds` (`queries.ts` ~:6101-6111), and it is changed to the founder rule of 2026-10-31: one key can serve a manager and allocators at once, so a strategy-linked key also counts in its owner's allocator book. The legacy bootstrap's link filter goes away together with the legacy writer.
  - 181's success criterion 4 ("every allocator holding non-Deribit positions has a snapshot for the closed day") becomes: every such allocator has a derived curve point for the closed day.
  - The ROADMAP entries for 181 and 182 each get a dated line recording this, and they close with 176.

### The stored legacy rows
- **D-02:** "Drop the table" (founder 2026-10-31). — **Reversibility:** one-way — the migration drops `allocator_equity_snapshots` and its rows; undoing it needs a restore from backup.
  - The writers go too: `persist_equity_snapshots`, the two replace RPCs, the refresh job's legacy write and the bootstrap gate.
  - The table is also removed from `delete_allocator_api_key`, the GDPR export manifest and the tooling lists.
  - **Order (orchestrator constraint, not a new decision):** first every reader moves, and the move is deployed and read live on PROD. Then the writes stop. The drop ships last, in its own migration and PR.
  - The PROD apply runs automatically after TEST (CLAUDE.md, 2026-09-23), so every review the drop needs (migration-reviewer, rls-policy-auditor, data-dependence lint) happens before merge.

### Bridge outcomes
- **D-03:** "Derived account total" (founder 2026-10-31). The +30d and +90d outcome is measured on the account's derived equity, not on the symbol's value from the breakdown.
  - This changes what the outcome means. Copy or labels that say the outcome is per symbol must say per account.
  - Outcomes already stored keep their values. Whether they are recomputed is the planner's question to raise, not assumed.

### Founder answers after research (2026-10-31)
- **D-04:** "Retire the job (Recommended)". The `reconstruct_allocator_history` job retires with the table. All three enqueue paths stop, including the one in `request_allocator_holdings_sync`, which is re-based in a migration. The handler becomes a stub that returns DONE, so already-queued jobs finish as no-ops. Its `compute_job_kinds` row stays, because `compute_jobs.kind` is a foreign key to it. The cap and marker machinery is left inert, and its removal is booked as a follow-up.
- **D-05:** "Compounded daily returns (Recommended)". The +30d, +90d and +180d bridge outcome compounds the derived row's flow-neutral daily returns over the window, so deposits and withdrawals do not count as performance. These are the returns the factsheet KPIs read (consistent with `[167.1.1-BRIDGE-DOLLAR-RATIO-RETURNS]`). A missing day gives NULL. **Amended 2026-10-31 (founder, "Accept amendment (Recommended)", review round 1 F1):** an absent day counts as no change, and the outcome is NULL only when the curve does not cover the window's start and end (or the row is missing, untrustworthy or malformed). A day with 1+r <= 0 compounds to -100%. Reason: measured on PROD 2026-10-31, every trustworthy derived curve omits about 23% of calendar days (for example 188 returns over a 244-day span), so the strict rule would leave almost every holding outcome Pending for ever. **Refined 2026-10-31 (founder, "At least one day", review round 2 WR-02):** a window the curve spans but with no return inside it is NULL, not 0%; one return inside the window is enough to measure it. Only well-formed `YYYY-MM-DD` dates count toward coverage. Stored outcomes are kept: a later run fills only a window still empty, and overwrites only when `needs_recompute` is set (review round 2 WR-03, all three reviewers).
- **D-06:** "Reset and recompute once (Recommended)". The PR 1 migration sets `needs_recompute = TRUE` and NULLs the old deltas together, for the holding-measuring outcome rows only, so every stored outcome ends up on the new basis. Before writing, the affected rows are counted read-only on PROD (research form R3). This supersedes the line in D-03 that said "outcomes already stored keep their values".
- **D-07:** "Remove both (Recommended)". The "Only N months of history available on {venues}" copy (`minHistoryDepthMonths`) and the "Limited equity history" banner (`equityBaselineUnknown`) are removed. Before removing them, who sees the banner today is counted read-only (form R0). The 30-day warm-up countdown stays, counted on the derived curve's days.

### Founder answers at plan 11's go/no-go (2026-11-01)
- **D-08:** "Go (Recommended)" (founder 2026-11-01, AskUserQuestion, plan 11 Task 1), reached in three steps:
  1. The founder first asked how the new solution looks, and whether the deletion removes the named phases' work or the legacy code.
  2. They then chose "Check the new path, then go (Recommended)": "First check whether the new curve's path has the problems those phases fixed in the old engine (Bybit above the trade-read limit, OKX opening balance, trade pages, multi-key accounts). Report any gap, then delete the old engine in full."
  3. After the check, they answered "Go (Recommended)": "Delete the old engine in full. The REBUILDGATES/BYBITFUNDING probe script, which imports it, is retired with it. The Bybit Unified-transfer reader is not on the delete list and stays, ready for the gap below."
  - Plan 11's `go` set is deleted: the eight writers and job bodies, the dead crawl minus the D-04 keep-list, and both legacy operator scripts (`scripts/allocator_history_probe.py`, which imports the module, and `scripts/e2_allocator_ground_truth.py`) with their tests. `services/bybit_unified_flows.py` is not on the delete list and stays.
  - The gaps the check found in the NEW path are booked as a separate fix phase. They are not 176's work.

### Founder answer at PR 3's review (2026-11-02)
- **D-09:** "Delete the derived rows (Recommended)" (founder 2026-11-02, AskUserQuestion, PR 3 review finding MD-01/SFH-2): "The re-based delete removes the allocator's derived curve and that key's input row when its last key goes, so the UI's promise holds. The atomicity gate is flipped to require it. One more fix round, then re-review."
  - Why it was asked: D-02 removed the legacy table from `delete_allocator_api_key`, and the old Step 4 never wiped the derived rows, so after PR 3 a last-key hard delete would leave the `equity_curve` row and the key's `key_inputs:<id>` row, against the UI copy "Deleting also removes this account's history."

### Claude's Discretion
- What replaces the warm-up gate, depth months and baseline flag on the derived series. For example, the derived curve's day count for the 30-day gate, and its first realized day for depth. Each must be stated once and tested.
- Whether the `breakdown` column's other uses, if any turn up, move to `allocator_holdings`.
</decisions>

<canonical_refs>
## Canonical References
- `.planning/ROADMAP.md`, `### Phase 176`, and the entries for Phases 181 SHAREDKEYS and 182 SPIKEREPAIR (success criteria and evidence)
- `.planning/phases/167.2.1.1.1.1-marksource-open-positions-are-valued-with-one-stated-price-r/167.2.1.1.1.1-CONTEXT.md` (D-01: retiring the legacy curve booked as its own phase; D-08 exclusions)
- `.planning/phases/167.2.1.1.1.1-marksource-open-positions-are-valued-with-one-stated-price-r/167.2.1.1.1.1-08-SUMMARY.md` (first-night reading; the 3 books with no legacy curve)
- `docs/runbooks/marksource-legacy-chain-move-go-live.md` (legacy poll/refresh schedules and cron manifest; the rollback form)
- `scripts/prod-prober/cron-manifest.json` (must match PROD after any cron change)
- TODOS.md: `167.2.1.1.1.1-MT5-BTC-MISSING-CLOSE-LEGACY-EXCLUSION`, `167.2.1.1.1.1-SFOX-NONSTABLE-LEGACY-EXCLUSION` (SC-3, closed by this phase), `167.2.1.1.1.1-OKX-DOUBLE-COUNT-BEYOND-REBUILD-WINDOW` (its legacy rows go with the table)
- CLAUDE.md: migration auto-apply (no human gate), the marker query, never `db push`
</canonical_refs>

<code_context>
## Existing Code Insights
- Readers: `src/lib/queries.ts` (`getMyAllocationDashboard` ~:5390, `partitionTrustworthyEquitySnapshots` ~:3796, `snapshotCount` ~:5805, `minHistoryDepthMonths` ~:5117, `allocatorEligibleApiKeyIds` ~:6101); `KpiStrip.tsx` :156-162 and :356; `ScenarioComposer.tsx` :963; `AllocationDashboardV2.tsx` :160 and :211; SQL `extract_symbol_value_at` (20260421154030) and `compute_bridge_outcome_deltas` (20260426131718); `src/lib/gdpr-export-manifest.ts` :632 and :1011.
- Writers: `analytics-service/services/equity_reconstruction.py` `persist_equity_snapshots` ~:1965, `replace_equity_snapshots_window` ~:2381, the reconstruct job ~:7000-7044, the refresh job ~:7654-7726; the RPCs `replace_allocator_equity_snapshots` and `replace_allocator_equity_snapshots_window` (20261028120000); `delete_allocator_api_key` (20261028120000 :335).
- Derived series: `job_worker.py` `run_derive_allocator_equity_job` ~:14356; `services/nav_marks_apply.py` (realized basis before the first mark).
- The holdings poll does not write the legacy table. It keeps writing `allocator_holdings`, which other surfaces read.
</code_context>

<deferred>
## Deferred Ideas
- None.
</deferred>
