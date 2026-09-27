# Phase 170: LAYOUT — page layout reads clean and holds on every page - Context

**Gathered:** 2026-09-27
**Status:** Ready for planning
**Mode:** Autonomous smart discuss — all four grey areas accepted as recommended

<domain>
## Phase Boundary

Pages read as a finished product: no stacked look-alike panels, and the layout holds at 390 px (iPhone 12) and at desktop 200% zoom.

In scope: criterion 1 (stacked look-alike layers), criterion 2 (layout holds at 390 px and 200% zoom), criterion 3 (post-deploy re-check by the orchestrator), the grey-chip contrast pair, and the items already routed into this phase (private link, Tweaks overlap, tab overflow, scenario rows, admin match read-only, signed-in header, compare pointer).

Out of scope: page copy. Typos, raw ids, test text, and label wording belong to Phase 170.1 COPY, except the two labels this phase already owns from Phase 169 ("Month-to-date" on an ended record, and the admin owner line). The 400% zoom WCAG 1.4.10 reflow check is not required.

</domain>

<decisions>
## Implementation Decisions

### Stacked layers
- Merge the blend header, window control, coverage timeline, and the allocations 4-cell strip into one square "Blend window" data panel. The factsheet's own KPI panel stays the only free-standing KPI panel on the scenario tab.
- Collapse the composer's distribution and rolling cards into one closed section. Nothing is deleted in this phase.
- On the factsheet, SectionNav keeps the mono data voice and ControlBar actions move to the DM Sans interactive voice. The private-link control stays a bordered secondary peer inside that bar.
- Overview is photographed at 390, 640, and 960. A look-alike pair the founder names there becomes a follow-up, not an edit in this phase.

### Narrow width
- An overflowing tab bar becomes a horizontal scroller with an inset focus ring. It does not wrap, and it does not widen the page.
- The Tweaks control is pinned above the mobile bottom navigation and never covers it. Its rest state stays neutral.
- Scenario member rows stack below the small breakpoint. Weight, mode, leverage, and notional stay reachable at 390 px.
- On /strategies the name, status, date, and private-link control wrap or ellipsize. They never overlap. The name keeps its words whole.

### Controls and contrast
- The private-link control is bordered secondary, never accent-filled, and never placed in the masthead.
- /admin/match below the medium breakpoint offers no write. The server handlers keep their own admin check. The banner's copy changes only if the current copy claims a write the UI no longer offers.
- The four grey data-state chip sites move their text from text-muted to text-secondary on bg-track. No global token changes.

### Post-deploy check
- The orchestrator runs the pass in the logged-in browser at 390x844, 640x400, and 960x540, after deploy, and binds every row to the deploy SHA.
- A page-level horizontal scroll or a clipped primary action fails the phase. A contained scroller does not.
- A deletion the founder wants after seeing the screenshots is recorded as a follow-up. This phase does not delete a panel.

### Claude's Discretion
Class-level implementation inside the locked UI-SPEC contracts: which utility carries a hairline, how a test pin is worded, and how a residual offender is classified when the census names its file.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/170-pagecopy/170-UI-SPEC.md` — the locked visual contract. Plans cite it by section.
- `.planning/phases/170-pagecopy/170-RESEARCH.md` — owners and root causes.
- `.planning/phases/170-pagecopy/170-PATTERNS.md` — existing patterns to reuse.
- `DESIGN.md` — binding tokens. This phase adds none.
- `.planning/ROADMAP.md` `### Phase 170` — the founder decisions of 2026-09-25, 2026-09-26, and 2026-09-27.

</canonical_refs>

<code_context>
## Existing Code Insights

- `KpiPanel` already has a cards default. The scenario tab needs a panel variant; PortfolioKpiPanel and `/portfolios/[id]` stay on cards.
- `CollapsibleSection` is the disclosure primitive. The repeated composer cards collapse through it rather than a new component.
- `ResponsiveTable` is the wrap for a table that the corrected walker names. The drawdown table is already inside one.
- `assertNoReflow` exists and currently measures the document only. Plan 01 makes it measure `#main-content` too, so a dashboard route can no longer pass vacuously.
- The four grey chip sites are `CoverageStateChip` `CHIP["manually-excluded"]` and `CHIP["no-series"]`, plus the two `DATA_STATE_CHIP` sites in `StrategyTable`.

</code_context>

<specifics>
## Specific Ideas

- The narrowest supported phone is an iPhone 12. 390 px is the floor. Desktop 200% zoom is the second check. 320 px is retired.
- "The scenario should look exactly the same and use the same factsheet assets." The composer copy is the side that gets subordinated.
- Phase 169 must be on origin/main before any factsheet file this phase shares with 169 is edited. Plans 11, 12, and 13 already stop when that gate fails.

</specifics>

<deferred>
## Deferred Ideas

- Deleting a look-alike layer (FC-1 options b through e). Asked after the post-deploy screenshots, implemented only as a follow-up.
- The venue-label site on CSV-ingested strategies (FC-2). Not guessed. Stays open until the founder names the site.
- A look-alike pair on Overview, if the photographs show one.
- All page-copy work, owned by Phase 170.1.

</deferred>
