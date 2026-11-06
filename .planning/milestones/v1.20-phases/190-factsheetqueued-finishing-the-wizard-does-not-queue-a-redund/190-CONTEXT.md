# Phase 190: FACTSHEETQUEUED - Context

**Gathered:** 2026-11-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Finishing the strategy wizard no longer queues a second analytics run that isn't needed. A queued or running re-compute never hides a strategy's already-computed factsheet. A strategy with no analytics yet still shows the queued or computing state.

The evidence and SC-1..SC-6 are in the `### Phase 190` entry of `.planning/ROADMAP.md`. Read it first.

</domain>

<decisions>
## Implementation Decisions

- **D-01 — Booking.** Founder 2026-11-03, AskUserQuestion: "New phase, start now (Recommended)". STATUSBRIDGE 164.6.6.3.4 closed on 2026-10-08, so it could not absorb this.
- **D-02 — Stays published.** Founder 2026-11-03, AskUserQuestion. Question: "Today a pending or computing re-run fails the strategy gate, so the strategy shows as UNPUBLISHED (and drops out of what allocators see) until the run finishes. With computed analytics already stored, what should a re-run do to its published state?" Answer: "Stays published (Recommended)". The option text: "A strategy with stored analytics passes the gate during a re-run: it stays published and allocators keep seeing the last computed numbers. If the re-run then fails, the existing failed-status rules apply as today."
- **D-03 — Small line on the factsheet.** Founder 2026-11-03, AskUserQuestion. Question: "Where does the 'updating' note show while a re-run is pending or computing?" Answer: "Small line on the factsheet (Recommended)". The option text: "One quiet line near the factsheet's 'computed at' date, e.g. 'Updating with new data…', styled per DESIGN.md. Everyone who can see the factsheet sees it."

### Decided after planning (founder 2026-11-03, AskUserQuestion)
- **D-04 — One more planning round, then execute.** Answer: "One more round, then go (Recommended)". The option text: "One planner pass: in that case the factsheet falls back to today's queued state rather than mixing old numbers with new warnings. Then execute." So plan 03 fails closed for a `complete_with_warnings` row with no bound snapshot.
- **D-05 — Reach: factsheet, lists, /compare only.** Answer: "Factsheet, lists, /compare only (Recommended)". The option text: "Ship the main surfaces now; the other surfaces are named in the after-deploy check as still waiting, and booked in TODOS." The surfaces left out are the share card image, the tear sheet/PDF, the returns API, recommendations, portfolios and the composer.
- **D-06 — Note wording.** Answer: "Use that wording (Recommended)". The text: "Updating with the latest data. These figures are from the last completed computation."

### Claude's Discretion
- When finalize genuinely needs a re-run, for example when the wizard changed an input that affects analytics after the first run. The planner derives this from the code and the SC-1 count. It must not drop a run that is needed.
- What "stored analytics" means for the gate. Use the same freshness source the product already uses: `strategy_analytics.computed_at`, never `last_sync_at`.
- The exact wording of the note, which needs a DESIGN.md check.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/ROADMAP.md` `### Phase 190`: evidence, SC-1..SC-6.
- `src/app/api/strategies/finalize-wizard/route.ts`: where the second `sync_trades` is queued (source `finalize-wizard`).
- `src/lib/strategyGate.ts`: the `ANALYTICS_PENDING` and `ANALYTICS_COMPUTING` arms.
- `.planning/phases/164.6.6.3.4-statusbridge-a-strategy-s-analytics-status-reads-failed-only/164.6.6.3.4-CONTEXT.md`: how the analytics status bridge sets `computation_status` (closed phase; do not reopen it).
- `DESIGN.md`: for the "updating" line.

</canonical_refs>

<code_context>
## Existing Code Insights

- `src/app/api/strategies/create-with-key/route.ts` also queues runs and comments on mirroring finalize-wizard. Check both paths for the same redundant enqueue.
- PROD reads run from the main checkout, which has the `supabase/.temp` link. The marker query comes first.

</code_context>

<specifics>
## Specific Ideas

- Founder-observed sequence (PROD 2026-11-03): factsheet visible, then a rename, then "UNPUBLISHED … A computation for this strategy is queued and has not started yet." The second `sync_trades` job had source `finalize-wizard`.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 190-factsheetqueued*
*Context gathered: 2026-11-03*
