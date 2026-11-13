# Phase 196: ONESTRATEGYPAGE - Context

**Gathered:** 2026-11-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A strategy has one page, the factsheet (`/factsheet/[id]`). The tearsheet is its print view; every other strategy detail route leads to it. A signed-in user never sees visitor prompts; an owner can open their own unpublished strategy; a signed-in reader has a way back and a next step; a shared factsheet carries a header and a sign-up link; the factsheet opens as a summary, one chart and one metrics table with the rest under "Advanced". Requirements: LEAN-02, ROUTE-02, ROUTE-04, LEAN-05. New capabilities (shortlist/compare, renames) belong to Phases 197 and 201.
</domain>

<decisions>
## Implementation Decisions

### Back and next step (discussed with the founder)
- **D-01 Back link:** a visible named link, "Back to Discovery" / "Back to My allocation" / etc., built from the origin the link into the factsheet carries. When the origin is unknown (bookmark, pasted URL), fall back to browser history. Founder pick: "Named link + fallback".
- **D-02 Next steps:** two actions in the factsheet header for a signed-in allocator: "Request intro" and "Add to my allocation". "Add to my allocation" opens the existing add flow on My allocation and replaces `AddToPortfolio`'s link to the removed `/portfolios`. Owners see neither action; they see "Edit strategy" instead. Founder pick: "Request intro + Add to allocation". Compare/shortlist is NOT added here (Phase 197).

### Settled on the recommendation (founder left these to me, 2026-11-08)
- **D-03 Old routes:** `/strategy/[id]`, `/strategy/[id]/v2`, `/browse/[slug]/[strategyId]` and `/discovery/[slug]/[strategyId]` permanently redirect (308) to `/factsheet/[id]`, carrying the origin for D-01. Existing links and shared URLs keep working. `/factsheet/[id]/tearsheet` stays and becomes the factsheet's print view (same layout as D-04). `/factsheet-share/[token]` stays as its own route.
- **D-04 Opening view:** summary line, the equity curve (with drawdown beneath), and the main metrics table. Everything else (distribution, heatmaps, rolling, stress, signatures, mandate, comparator panels) sits behind one "Advanced" disclosure below, collapsed by default, its open state remembered per viewer in browser storage (wrapped in try/catch; renders correctly without it). No metric appears twice, the chart hint appears once, one small-sample warning, empty sections and "— on request" rows hidden.
- **D-05 Shared factsheet:** `/factsheet-share/[token]` gets a slim Quantalyze header (logo, "What is Quantalyze?", "Sign up") and a sign-up line under the factsheet; no navigation into the app; same layout as the main factsheet including "Advanced". Phase 194 D-22 (no AUM for a viewer who may not see it) still applies.

### Carried forward (do not re-decide)
- Phase 194 D-04/D-11/D-20/D-21: the figure gate (short-track withholding, covered-day counting, 1y warm-up). The new layout shows withheld figures as withheld, never re-derives them.
- Phase 194 D-22: AUM and max capacity only for viewers allowed to see them (`canViewAum`/`withViewerAum`).
- Phase 193: viewing a strategy changes nothing and shows only its own content.
- Phase 195: `/portfolios` and the Tweaks panel are gone.

### Founder decisions after research (2026-11-08)
- **D-06 Lost strategy-v2 panels:** founder pick "Drop now, book a phase". "Trades & positions" and "Exposure & greeks" render only in `StrategyV2Shell` on `/strategy/[id]/v2`, which D-03 retires. They are dropped in this phase; the loss is recorded in the plan and the CHANGELOG, and their revival is booked as a follow-up (TODOS.md entry + Deferred Ideas below).
- **D-07 Search indexing:** founder pick "Index published only". `/factsheet/[id]` drops `noindex` on the published lane only, so the 308s from the indexable `/browse/[slug]/[strategyId]` and `/strategy/[id]` land on an indexable page. Owner/unpublished and share-token lanes stay `noindex`.
- **D-08 LP report PDF:** founder pick "Full report". The PDF route (`/api/factsheet/[id]/pdf`, which screenshots the factsheet) gets a server-only print-all mode that renders "Advanced" open, so the report stays full length. The mode is not reachable from a viewer-controlled parameter.
- **D-09 Discovery detail extras:** founder pick "Print view replaces Tear Sheet; drop Book Intro Call". A "Print view" link to `/factsheet/[id]/tearsheet` replaces the discovery page's "Tear Sheet" link; "Book Intro Call" is not carried to the factsheet. Both are stated in the CHANGELOG.

### Settled after research (Claude's discretion, 2026-11-08; recorded as such, not founder picks)
- **OQ-4:** `FactsheetBody` takes a `layout` prop: `"document"` (opening view + Advanced) for the factsheet, its share route and its print view; the allocator mounts (My allocation Overview, Scenario composer chart) keep `"full"` until Phase 198 decides.
- **OQ-3:** on `/factsheet-share/[token]` the session wins: a signed-in recipient sees the slim header without "Sign up" and no sign-up line. The token route reads only whether a session exists. Flagged for the phase security review.
- **OQ-6:** `StrategyNoteCard` mounts on the factsheet for signed-in viewers, after the Advanced row, excluded from print, so redirecting `/strategy/[id]` does not remove the only strategy-note surface.
- **OQ-5:** "Add to my allocation" ships now; until Phase 198 merges it lands on My allocation.
- **OQ-1 / OQ-2:** UI-SPEC defaults stand: the summary line is the KPI strip, and each strip cell carries the comparator's value on a muted line when a comparator is active.
- **198 entry point (locked with Phase 198):** "Add to my allocation" links to `/allocations?add=<strategyId>`; Phase 198 opens its "+ Allocation" flow pre-filled with that strategy and removes `add` from the URL once the flow opens.

### Claude's Discretion
- How the origin is carried (query param vs. other), redirect implementation (middleware vs. route-level), exact header layout per DESIGN.md, the before/after census method for SC-5 (three named strategies; names must not be PROD ids in tracked text).
- **D-13 (founder, 2026-11-10, UAT): "no metric shown twice" applies to the opening view.** Founder pick: "Opening view only". The rolling-window Sharpe, Sortino and Volatility rows under Advanced are different statistics from the headline figures, so a repeat with Advanced open is not a defect. SC-4 is narrowed to the closed (opening) view. Recorded here and in the ROADMAP Phase 196 success criterion 4 (deviation policy). Closes `TODOS.md` `196-ROLLING-REPEATS-01`.
- **D-14 (founder, 2026-11-10, UAT): `/api/intro` enforces the attestation.** Founder pick: "Enforce in /api/intro", then "Here, with an attest prompt": every intro entry point (factsheet, Bridge ReplacementCard) shows an unattested allocator an attest step. Routed to Phase 194.2 FIGURERESIDUALS (its D-03, D-04); `196-INTRO-API-ATTESTATION-01` is owned there.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/ROADMAP.md` (### Phase 196) — goal, success criteria, evidence at HEAD
- `.planning/REQUIREMENTS.md` — LEAN-02, ROUTE-02, ROUTE-04, LEAN-05
- `DESIGN.md` — dated-document principle, Numbers Contract, data density principle (UI-SPEC must check against these)
- `.planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-CONTEXT.md` — D-04, D-11, D-20, D-21, D-22
- `.planning/phases/193-*/193-CONTEXT.md` and `.planning/phases/195-*/195-CONTEXT.md` — prior page decisions
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/factsheet/[id]/v2/` — `FactsheetView.tsx`, `FactsheetBody`, `MetricsColumn.tsx`, `TimeSeriesChart.tsx`, `LazyMount.tsx` (lazy panels; reuse for "Advanced"), `MandatePanels.tsx` ("— on request" rows at ~143-146), `HistogramChart.tsx` (zoom hint at ~259-260).
- `src/lib/factsheet/viewer-aum.ts` — `canViewAum`, `withViewerAum`.

### Integration Points
- Routes: `src/app/factsheet/[id]/page.tsx` (re-exports v2), `factsheet/[id]/tearsheet`, `src/app/strategy/[id]/page.tsx` (unconditional "Sign up" ~220-223), `src/app/strategy/[id]/v2` (`StrategyV2Shell`), `src/app/browse/layout.tsx:32`, `browse/[slug]/page.tsx:73-80`, `browse/[slug]/[strategyId]/page.tsx:170-179`, `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`, `src/app/factsheet-share/[token]/page.tsx`.
- `AddToPortfolio` component links to removed `/portfolios`.
- The huge FactsheetView/MetricsColumn test suites pin current layout; expect many to move.
</code_context>

<specifics>
## Specific Ideas
- Unpublished strategy: owner opens it; after the owner has viewed it, an anonymous request still gets not-found (no cache bleed; see `page.public-cache-key.test.tsx`).
</specifics>

<deferred>
## Deferred Ideas
- Revival of the "Trades & positions" and "Exposure & greeks" panels dropped with `/strategy/[id]/v2` (D-06): a follow-up phase, booked in TODOS.md.
- Shortlist/compare action from the factsheet: Phase 197 scope.
</deferred>

---

*Phase: 196-onestrategypage*
*Context gathered: 2026-11-08*
