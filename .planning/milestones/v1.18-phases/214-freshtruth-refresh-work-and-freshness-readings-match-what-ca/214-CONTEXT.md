# Phase 214: FRESHTRUTH — refresh work and freshness readings match what can actually change - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning. Founder answered Q1-Q3 on 2026-11-14 (via the coordinator's AskUserQuestion).

<domain>
## Phase Boundary

Refresh work goes only where data can actually advance, and every freshness reading tells the truth
about why a series has stopped. Four threads, one per closed TODOS entry:

1. **SC-1/SC-2 (TODOS `0.1` residue).** One live MT5 strategy's series has been stuck for 36 days
   while its key syncs daily and its fan-out derive + compute finish `done` / `publish_warned` every
   day. Diagnose and record why; make the single-key fan-out cap (never exclude) a strategy whose
   completed refresh leaves `last_return_date` unmoved, and count each skip with a reason.
2. **SC-3 (TODOS `0.3`, already removed from TODOS by #1267; founder decision 0.3 "Yes, closed
   records").** A composite whose member windows have all closed reads as closed in
   `ledger_refresh_staleness`, not stale. The composite fan-out stays unscheduled.
3. **SC-5 (TODOS `0.12`).** The FreshnessChip `Track record · future — check data` label overflows
   its masthead column at 1485px (297.9px in 204.2px).
4. **SC-8 (TODOS `211-D11-RESIDUAL-UNCORRELATED-SENDERS`).** The finalize-wizard `stitch_composite`
   and csv-finalize `compute_analytics_from_csv` enqueues send no `correlation_id`, so Phase 211's
   `_record_enqueue_dedup` cannot retract an inherited `ledger-refresh` marker for them.

Out of scope: changing the derive's money math (if SC-1 finds a derive defect it is recorded and
routed, not fixed here); scheduling the composite fan-out; widening `_record_enqueue_dedup`.

</domain>

<decisions>
## Implementation Decisions

### SC-2 — fan-out treatment of a strategy whose refresh cannot advance (founder, Q1 = A)
- Weekly cap, never exclude. Trigger on the generic signal, not on the dust flag: a completed derive + compute run happened after the strategy went stale and `last_return_date` has stayed unmoved for 3 or more days. Then the single-key fan-out's attempt cooldown goes from 20 hours to 7 days. — **Reversibility:** costly — it redefines the live hourly SECURITY DEFINER `enqueue_ledger_refresh_for_strategies` through an auto-applying migration (TEST then PROD on merge, no human gate).
- The throttle lives in the fan-out's candidate cooldown, never in the staleness view (Phase 174 decisions 01 and 04 precedent: the view's verdict fails toward stale and its static gate bans time columns in the verdict region).
- Each skip is counted per tick with its reason in `public.cron_runs`, under an error/cause tag that cannot collide with `candidate_enqueue_failed` (the prober's `cron-obs` arm counts that tag and the fan-out's own failed-attempt cooldown reads it).

### SC-8 — the two uncorrelated enqueue callers (founder, Q2 = A)
- Both routes send their request's `correlation_id` in `p_metadata`: finalize-wizard `stitch_composite` and csv-finalize `compute_analytics_from_csv`. No SQL widening of `_record_enqueue_dedup`. — **Reversibility:** costly — it changes what lands in `compute_jobs.metadata` / `compute_job_dedup_events` and turns on the Phase 211 decision D11 item 2 retraction for those callers.
- Proof: a TypeScript test that goes RED when either route stops sending the id, plus a SQL gate arm pinning both routes' exact payloads (with `correlation_id`) retracting an inherited marker. The SQL is unchanged, so the "RED on Phase 211 code" clause of SC-8 is met by the TS test (founder accepted this).
- Consistent with Phase 211 decision D11 item 8: a `correlation_id` means user-initiated; no background path retracts.

### SC-5 — chip label overflow (founder, Q3 = a)
- ⛔ AMENDED 2026-11-14 (founder, after measurement, option A): the overflow does not reproduce at HEAD (1485px plus a 1485-to-360px sweep, real browser, local stack). SC-5 now reads "does not reproduce at HEAD, measured". The spec e2e/freshness-chip-width.spec.ts becomes a passing one-line fit check in the e2e-seeded CI list. TODOS 0.12 is deleted with "does not reproduce" wording. The wrap decision below stands. Recorded here and in the ROADMAP (deviation policy).
- Let the label row wrap at that width and keep the full `Track record · future — check data` sentence. No copy change. Measure at 1485px in a real browser, per DESIGN.md.

### Decided autonomously
- [SC-3] Q: "When does a composite read as closed?" → Selected: "Every strategy_keys member has window_end set AND the series' last_return_date has reached the last day the windows allow (max(window_end) - 1, window_end being exclusive). Closed excuses only the series_behind reason; no_analytics_row, status_not_success and no_return_date still read stale. A composite whose series has not reached its window end stays stale." — fails toward stale, and a forward migration can revise the predicate.
- [SC-3] Q: "How is closed exposed?" → Selected: "New columns appended at the END of the view (CREATE OR REPLACE VIEW can only append); security_invoker and service_role-only grants restated and asserted after apply; the verdict-region and venue-set static gates in test_ledger_refresh_gates.py must still pass; composite fan-out stays unscheduled and simply stops seeing a closed composite as stale." — view-only change, revisable by a forward migration.
- [SC-4] Q: "When is the PROD drain measured?" → Selected: "After merge (this agent does not merge). The post-deploy read goes through the Supabase MCP with the marker query first. Expected remaining stale rows: the 81-day MT5 strategy with a disconnected key (fan-out already excludes it) and the capped 36-day one, each named with its reason." — measurement step, no code.
- [SC-1] Q: "How far does the 36-day diagnosis go?" → Selected: "Research confirms the cause from code and read-only PROD reads; it is recorded in the phase artifacts. Working hypothesis: the account fell under the $100 dust-NAV floor (nav_twr.py / transforms.py) and the derive stops emitting days. A money-math derive defect, if found, is recorded and routed, not fixed here." — diagnosis only.
- [Ship] Q: "Which TODOS entries does the ship delete?" → Selected: "0.1, 0.12 and 211-D11-RESIDUAL-UNCORRELATED-SENDERS, named in the CHANGELOG; 0.3 was already removed by #1267." — ledger edit.
- [Hygiene] Q: "PROD identifiers in tracked text?" → Selected: "None: no PROD strategy ids in CONTEXT, RESEARCH, PLAN, CHANGELOG or commit messages; ages and counts only." — public repo rule.

### Claude's Discretion
- Exact column names for the closed verdict, the exact cron_runs tag/metadata shape for skip counts, and whether a tick with zero skips writes a row, provided the prober's existing counts are not disturbed.
- Migration timestamp: pick one unlikely to collide with parallel phases and re-check against origin/main before shipping.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public.ledger_refresh_staleness` (only definition: `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql`), verdict region between `LEDGER_REFRESH_VERDICT_BEGIN/END` markers.
- `enqueue_ledger_refresh_for_strategies()` latest body: `supabase/migrations/20261030120000_ledger_fanout_marks_paused_weekly.sql` (snapshot `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql`), whose 7-day/20-hour CASE cooldown is the exact precedent for SC-2. Composite arm last defined in `20260924120000_ledger_fanout_failure_count.sql`.
- `_record_enqueue_dedup` + `retract_ledger_refresh_marker`: `supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql`; TS backstop `src/lib/ledger-refresh-marker.ts`.
- `strategy_keys.window_end` (EXCLUSIVE end, NULL = open-ended).
- Enqueue sites: `src/app/api/strategies/finalize-wizard/route.ts` (stitch_composite, `{source: "finalize-wizard"}`, `correlationId` in scope); `src/app/api/strategies/csv-finalize/route.ts` (`{source: "csv-finalize", fmt}`, `opts.correlationId` in scope).
- FreshnessChip: `src/app/factsheet/[id]/v2/FactsheetView.tsx` (label row `flex items-center justify-end …`).

### Established Patterns
- Forward migrations only; re-base CREATE OR REPLACE on the latest definition; VAC-04 `prod-body-ack` pragma; regenerate `supabase/schema/functions/` with `npm run schema:functions`.
- SQL gates under `supabase/tests/` with `RED-UNDER` annotations scored by `sql-mutation`; floors in `scripts/mutation-floors.mjs`.
- Static gates: `analytics-service/tests/test_ledger_refresh_gates.py`.

### Integration Points
- `scripts/prod-prober/arms/cron-obs.mjs` counts `ledger_refresh_fanout` rows with error `candidate_enqueue_failed`; `docs/runbooks/ledger-refresh-go-live.md`.

</code_context>

<specifics>
## Specific Ideas

- PROD reading 2026-11-14 (counts and ages only): 4 stale rows in `ledger_refresh_staleness`: 2 deribit composites 199 days behind, all member windows closed, series ending on the last day the windows allow; 1 MT5 strategy 81 days, key disconnected; 1 MT5 strategy 36 days, key synced the same day, three consecutive daily fan-out derive+compute chains `done`/`publish_warned`, its strategy-scoped daily rows ending 2026-10-09 after a -22.6% day and two zero days written late, flags `dust_nav_guard`, `twr_chain_broken`, `insufficient_window`, `tiny_base_guard`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
