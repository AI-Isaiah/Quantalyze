# Phase 198: MYBOOK - Context

**Gathered:** 2026-11-08
**Status:** Ready for planning

<domain>
## Phase Boundary

My allocation answers "how is my book doing?": the first tab shows the book's return, risk and holdings at a glance (or names exactly what is missing), "+ Allocation" opens the allocator's own flow, Holdings labels positions correctly, and the page has at most three tabs with each position listed once and dust hidden. Requirements: ROUTE-06, ROUTE-07, ROUTE-08, LEAN-06.
</domain>

<decisions>
## Implementation Decisions

### Missing-data message (discussed with the founder)
- **D-01 Key + days + action:** Founder pick (2026-11-08). Replace the generic "We are holding back your equity history" with a message naming the key, the missing day range and what to do, e.g. 'Binance key "Main": no data for 3–11 Oct. Reconnect the key or wait for the next sync.' The rest of the overview still renders with what is available. A key's problem affects only that key (founder rule: a dead key affects only itself, never other keys/venues of the account).

### Settled on the recommendation (founder left these to me, 2026-11-08)
- **D-02 Three tabs:** Overview (return, risk, holdings at a glance, same values as Scenario and Holdings), Holdings (each position once, dust hidden), Scenario. Outcomes, Mandate and Risk content folds into Overview or Holdings; nothing is deleted silently; the plan lists where each moved panel lands.
- **D-03 "+ Allocation":** an allocator flow on every tab: pick a strategy (search) and enter amount/date, reusing existing allocation APIs; never the manager's `WizardClient`. Phase 196's factsheet "Add to my allocation" (196 D-02) opens this same flow pre-filled with the strategy; expose an entry (route or query param) 196 can link to.
- **D-04 Dust:** a position worth under $50 or under 0.1% of the book is dust, hidden by default behind "Show n small positions".

### Carried forward
- Phase 194: book values agree across Scenario and Holdings (D-22 AUM rule where relevant).
- Phase 195: Tweaks panel gone.
- Founder rule: a strategy-linked key can also be in an allocator book.

### Founder decision after research (2026-11-08)
- **D-05 Write path for "+ Allocation":** Founder pick (2026-11-08): "Reuse existing routes (Recommended)". The flow sends an add of one of the allocator's own strategies to `/api/portfolio-strategies/allocation`, which creates a Holdings row. An add of someone else's strategy goes to `/api/allocator/scenario/commit` as a `voluntary_add` with an idempotency key. That add is recorded under Outcomes, and its success message says so. No new endpoint.
- **D-06 Glance figures (FD-2, coordinator relaying the founder, 2026-11-08):** the Overview glance panel reads the same shared figures module as Scenario's live strip. The 194 D-15 gate applies on both surfaces, and the figures show whenever they exist, independent of `equityHistoryState`. When the ready Overview shows two YTD figures computed from different series, each carries a distinct label.
- **D-07 Entry point (2026-11-08):** `/allocations?add=<strategyId>` is locked for Phase 196 to link to. `add` is removed from the URL when the flow opens (196's wording).
- **D-08 Sequencing (2026-11-08):** all 198 execution follows the 194.1 merge, rebased on main. Research corrections C1–C9 (`198-RESEARCH.md`) take precedence over `198-UI-SPEC.md`.

### Claude's Discretion
- Exact panel placement inside Overview/Holdings per DESIGN.md 9-State Matrix; how cash is classified (not as Spot exposure, SC-3 test RED first).
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` (### Phase 198) — goal, success criteria, evidence at HEAD
- `.planning/REQUIREMENTS.md` — ROUTE-06, ROUTE-07, ROUTE-08, LEAN-06
- `DESIGN.md` — Numbers Contract, data density principle, 9-State Matrix
- `.planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-CONTEXT.md`
- `.planning/phases/196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it/196-CONTEXT.md` (on branch feat/196-onestrategypage) — D-02 links into D-03's flow
</canonical_refs>

<code_context>
## Existing Code Insights

- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:70-222` (six tabs), `:587-611` ("+ Allocation" → `ContributionWizardOverlay`).
- `ContributionWizardOverlay.tsx:31` embeds the manager `WizardClient`.
- `EquityHistoryRebuilding.tsx:139` — the generic notice to replace.
- `HoldingsTable.tsx:504` — "not allocated" label.
</code_context>

<specifics>
## Specific Ideas
- None beyond decisions.
</specifics>

<deferred>
## Deferred Ideas
- Sidebar and mobile "Add a Strategy" still opens the manager `WizardClient` on the allocator workspace. The founder chose to leave it in this phase (FD-3, 2026-11-08), and a follow-up is to be booked.
</deferred>

---

*Phase: 198-mybook*
*Context gathered: 2026-11-08*
