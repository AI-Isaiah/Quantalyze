# Phase 195: TRIM — leftover and duplicate surfaces are gone - Context

**Gathered:** 2026-11-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove surfaces the product no longer stands behind: `/portfolios` and everything that only exists to reach it, Decks (hidden until it works), the allocator "Tweaks / Design variations" panel, the factsheet dark-mode option, the discovery table density toggle, the single-card `/browse` step, and repeated disclaimers. Stored data is kept; only surfaces go. Requirements LEAN-03, LEAN-07. Compare is NOT touched here (SCREEN 197 makes it startable).

</domain>

<decisions>
## Implementation Decisions

### /portfolios and what reaches it
- **D-01:** Every `/portfolios` route (`/portfolios`, `/portfolios/<id>`, `/portfolios/<id>/manage`, `/portfolios/<id>/documents`, and the dead `/portfolios/<id>/strategies/<id>` target) redirects to My allocation, `/allocations`. Links that pointed there now point to `/allocations` directly: the Exchanges tab "Real portfolio" / "Open portfolio →" (`src/components/exchanges/ExchangesTabContent.tsx:40,52`), the portfolio-alert email "View in dashboard →" (`src/lib/email.ts:1001`), and the remaining in-app links (`PortfolioOptimizer.tsx`, `StrategyBreakdownTable.tsx`). Stored `portfolios` / `portfolio_strategies` rows are kept, with no migration and no deletion. (Founder, 2026-11-07: "Redirect to My allocation".)
- **D-02:** The "Add to portfolio" button on the discovery strategy page (`AddToPortfolio`, mounted at `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:163`) is removed with its component, and so are its other mounts (portfolios page/layout, `MigrationWizard.tsx`) if they only serve /portfolios. It is not repointed to the Scenario. Existing `portfolio_strategies` rows stay. (Founder: "Remove it".)
- **D-03:** `/portfolio-pdf/<id>` and `/api/portfolio-pdf/<id>` are retired with `/portfolios`. An old share link lands on a named page saying the report was retired, never a 404. The route-contract manifest entry that says "NEVER MOVE" (`src/lib/routing/route-contract-manifest.ts:360-363`) is updated in the same change with the reason and date, and `PUBLIC_ROUTES` / bounce-exempt handling in `src/proxy.ts` is adjusted so the retired-page landing works without a session. (Founder: "Retire it with /portfolios"; there are no clients yet.) — **Reversibility:** costly — a share link already handed out cannot be restored once its renderer is deleted; accepted because no client holds one.

### Decks
- **D-04:** Decks leaves the sidebar (`src/components/layout/Sidebar.tsx:141`) and every other link, and `/decks` redirects to discovery until Decks is rebuilt. The Decks code (page, `DeckCard`, `getDecks`) stays in the repo, so bringing it back means removing the gate rather than rewriting it. (Founder: "Remove from nav, route redirects".)

### Leftover controls
- **D-05:** The "Tweaks / Design variations · live" panel (`src/app/(dashboard)/allocations/components/Tweaks.tsx`, mounted from `AllocationsTabs.tsx:23-25`) is removed for every user. (Roadmap SC-3, no question needed.)
- **D-06:** The factsheet "Dark mode" option (`FactsheetView.tsx` around :2944) is removed. `DESIGN.md` says "Dark mode: Not planned". (Roadmap SC-3; REQUIREMENTS out-of-scope row "Dark mode".)
- **D-07:** The discovery table's density toggle (comfortable/compact, `StrategyTable.tsx` `density` state) is removed. The table stays at comfortable (44px rows), the `:root` default. The table/grid view toggle STAYS, because it is a real choice between reading figures and scanning cards. (Founder: "Density goes, view stays".)

### /browse and disclaimers
- **D-08:** When the category query returns exactly one category, `/browse` redirects to `/browse/<that slug>`. With two or more it renders the category cards as today, and with zero the existing empty state. The rule follows the data, so a second category brings the cards back by itself. (Founder: "Go straight to the category".)
- **D-09:** Each page shows ONE disclaimer block, at the page bottom, carrying the text that applies there (on a public strategy page: custody + strategy wording combined; elsewhere the general wording). A layout-level footer disclaimer (e.g. `src/app/browse/layout.tsx:40`) does not render on pages that carry their own. No legally required sentence is dropped; only the repetition goes. Today's triple on `/browse/<cat>/<id>` (custody at top `:95`, strategy at bottom `:190`, layout footer) is the reference case. The planner/researcher must inventory every page that renders more than one disclaimer (`Disclaimer` variants, `LegalFooter`, `DashboardChrome`, tearsheet, `strategy/[id]`) and apply the same rule. (Founder: "One combined block, page bottom".)

### Guard
- **D-10:** One test lists every removed route and control (the /portfolios routes, /portfolio-pdf, /decks in nav, the Tweaks panel, the dark-mode option, the density toggle) and goes RED if one renders or is linked again (roadmap SC-5). It must be able to fail: neuter, see RED, restore.

### Claude's Discretion
- The wording of the retired-report page (D-03) and the redirect mechanism (route-level `redirect()` vs `next.config` redirects vs proxy) are up to the planner. Match how earlier retirements were done (Phase 192 retired `/demo` with a 307 redirect).
- Whether the portfolio-alert cron/route (`src/app/api/portfolio-alerts/route.ts`) keeps sending is out of scope. Only its email link changes (D-01).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` § "Phase 195: TRIM" — goal, success criteria 1-5, evidence at HEAD
- `.planning/REQUIREMENTS.md` — LEAN-03, LEAN-07, and the out-of-scope row "Dark mode"
- `DESIGN.md` — "Dark mode: Not planned"; data density principle (removals are checked against it)

### Prior retirement pattern
- `.planning/phases/192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one/192-CONTEXT.md` — D-11 retired /demo (routes, readers, specs, CI plumbing) with PROD rows untouched; the same shape applies here
- `src/lib/routing/route-contract-manifest.ts` — route contract; every removed or redirected route must be reflected here (hygiene/route-contract lint reads it)

### Surfaces named in the evidence
- `src/app/(dashboard)/portfolios/**`, `src/app/portfolio-pdf/[id]/**`, `src/app/api/portfolio-pdf/[id]/route.ts`, `src/lib/pdf-render-token.ts`
- `src/components/portfolio/AddToPortfolio.tsx`, `src/components/exchanges/ExchangesTabContent.tsx`, `src/lib/email.ts`
- `src/components/layout/Sidebar.tsx`, `src/app/(dashboard)/decks/page.tsx`
- `src/app/(dashboard)/allocations/components/Tweaks.tsx`, `AllocationsTabs.tsx`
- `src/components/strategy/StrategyTable.tsx` (density state)
- `src/app/browse/page.tsx`, `src/app/browse/layout.tsx`, `src/app/browse/[slug]/[strategyId]/page.tsx`, `src/components/ui/Disclaimer.tsx`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Disclaimer` (`src/components/ui/Disclaimer.tsx`) already has variants (`custody`, `strategy`, `factsheet`, `footer`); D-09's combined block can be a composition of the existing texts rather than new copy.
- `requireRolePage` and the existing redirect helpers; Phase 192's /demo 307 redirect is the closest precedent for D-01/D-04.

### Established Patterns
- Removals keep data: no migration, no row deletion (192 D-11, founder "keep data" rule).
- `/portfolios` was already off primary nav since v0.4.0 and reached only through AddToPortfolio and deep links (Sidebar comment ~:183), so removing the button closes the last entry point.
- `allocations/lib/watchlist-read.ts`, `OptimizerPanel.tsx`, `CardShell.tsx`, `MorningBriefing.tsx` mention `/portfolios/[id]` only in comments or shared components. Shared components used by `/allocations` must survive. Delete only what is /portfolios-only.

### Integration Points
- `src/proxy.ts` PUBLIC_ROUTES and the bounce-exempt list (portfolio-pdf entries at :97-124)
- `src/test-setup.ts` references `/portfolios`; e2e specs and vitest censuses that list routes will need their rows moved (the route-contract and display censuses)

</code_context>

<specifics>
## Specific Ideas

- The founder picked the recommended option on all seven questions: lean removals that keep data and land every old URL on a named page.

</specifics>

<deferred>
## Deferred Ideas

- Repointing "Add to portfolio" as "Add to scenario" was offered and not taken. If wanted, it is a new capability for a later phase (SCREEN 197 or MYBOOK 198).
- Whether portfolio alerts should keep firing for portfolios no one can see any more: not discussed, so it stays as is (only the link changes).

</deferred>

---

*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Context gathered: 2026-11-07*
