# Phase 195: TRIM — leftover and duplicate surfaces are gone - Research

**Researched:** 2026-11-07
**Domain:** Next.js 16 App Router route retirement, nav/UI control removal, test/census lockstep (no new packages, no DB)
**Confidence:** HIGH on inventory and mechanism (every site below was read or grepped at HEAD `8e38fb3b2` in this worktree); MEDIUM on a few recommendations marked `[ASSUMED]`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Every `/portfolios` route (`/portfolios`, `/portfolios/<id>`, `/portfolios/<id>/manage`, `/portfolios/<id>/documents`, and the dead `/portfolios/<id>/strategies/<id>` target) redirects to My allocation, `/allocations`. Links that pointed there now point to `/allocations` directly: the Exchanges tab "Real portfolio" / "Open portfolio →" (`src/components/exchanges/ExchangesTabContent.tsx:40,52`), the portfolio-alert email "View in dashboard →" (`src/lib/email.ts:1001`), and the remaining in-app links (`PortfolioOptimizer.tsx`, `StrategyBreakdownTable.tsx`). Stored `portfolios` / `portfolio_strategies` rows are kept, with no migration and no deletion.
- **D-02:** The "Add to portfolio" button on the discovery strategy page (`AddToPortfolio`, mounted at `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:163`) is removed with its component, and so are its other mounts (portfolios page/layout, `MigrationWizard.tsx`) if they only serve /portfolios. It is not repointed to the Scenario. Existing `portfolio_strategies` rows stay.
- **D-03:** `/portfolio-pdf/<id>` and `/api/portfolio-pdf/<id>` are retired with `/portfolios`. An old share link lands on a named page saying the report was retired, never a 404. The route-contract manifest entry that says "NEVER MOVE" (`src/lib/routing/route-contract-manifest.ts:360-363`) is updated in the same change with the reason and date, and `PUBLIC_ROUTES` / bounce-exempt handling in `src/proxy.ts` is adjusted so the retired-page landing works without a session. (Reversibility: costly, accepted because no client holds a link.)
- **D-04:** Decks leaves the sidebar (`src/components/layout/Sidebar.tsx:141`) and every other link, and `/decks` redirects to discovery until Decks is rebuilt. The Decks code (page, `DeckCard`, `getDecks`) stays in the repo, so bringing it back means removing the gate rather than rewriting it.
- **D-05:** The "Tweaks / Design variations · live" panel (`Tweaks.tsx`, mounted from `AllocationsTabs.tsx:23-25`) is removed for every user.
- **D-06:** The factsheet "Dark mode" option (`FactsheetView.tsx` around :2944) is removed. `DESIGN.md` says "Dark mode: Not planned".
- **D-07:** The discovery table's density toggle (comfortable/compact, `StrategyTable.tsx` `density` state) is removed. The table stays at comfortable (44px rows). The table/grid view toggle STAYS.
- **D-08:** When the category query returns exactly one category, `/browse` redirects to `/browse/<that slug>`. Two or more render the cards as today; zero the existing empty state. The rule follows the data.
- **D-09:** Each page shows ONE disclaimer block, at the page bottom, carrying the text that applies there (public strategy page: custody + strategy wording combined; elsewhere the general wording). A layout-level footer disclaimer does not render on pages that carry their own. No legally required sentence is dropped. Planner/researcher inventories every page rendering more than one disclaimer.
- **D-10:** One test lists every removed route and control and goes RED if one renders or is linked again. It must be able to fail: neuter, see RED, restore.

### Claude's Discretion
- Wording of the retired-report page (D-03) and the redirect mechanism (route-level `redirect()` vs `next.config` redirects vs proxy). Match earlier retirements.
- Whether the portfolio-alert cron/route keeps sending is out of scope. Only its email link changes (D-01).

### Deferred Ideas (OUT OF SCOPE)
- Repointing "Add to portfolio" as "Add to scenario" (SCREEN 197 / MYBOOK 198).
- Whether portfolio alerts should keep firing for portfolios no one can see: stays as is (only the link changes).

### Orchestrator-settled interpretation (record in PLAN/CONTEXT)
- UC-12: the `PortfolioOptimizer` "Add to portfolio" link is REMOVED under D-02 (it renders on `/allocations`, a D-01 repoint would be a self-link); "View strategy" stays. UC-10, UC-11, UC-13: take the UI-SPEC recommended defaults.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEAN-03 | `/portfolios` is removed and Decks is hidden until it works. | Sections 1-3 (inventory, delete/keep, `next.config.ts` `redirects()` mechanism, manifest + census edits). |
| LEAN-07 | Leftovers gone: Tweaks panel, dark-mode option, do-nothing toggles, single-card `/browse`, duplicated disclaimers. | Sections 4-6 (Tweaks, dark mode, density, `/browse` redirect, disclaimer inventory) and 7 (guard). |
</phase_requirements>

## Summary

Phase 195 is a removal phase with one real design decision (the redirect mechanism) and a large, hidden test-coupling surface. The repo's own retirement precedent for a *moved* route is the `/scenarios` entry: a config-level `redirects()` rule in `next.config.ts`, a manifest entry with `redirectFrom`, and an unseeded Playwright canary in `e2e/route-redirects.spec.ts`. **Correction to CONTEXT:** Phase 192 did NOT retire `/demo` with a 307 redirect. It deleted the routes outright; a signed-out `/demo` now 307s to `/login` because it left `PUBLIC_ROUTES`, and a signed-in `/demo` is a Next 404 (`src/proxy.test.ts` comment: "Phase 192 D-11: /demo has no route any more... answers 404"). So for D-01/D-03/D-04, the `/scenarios` pattern is the precedent to follow, not `/demo`.

Because `redirects()` runs before the filesystem AND before the proxy (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md`: "Redirects are checked before the filesystem"), a config redirect needs no `PUBLIC_ROUTES` change for the `/portfolios*` and `/api/portfolio-pdf` hops and works without a session. Only `/portfolio-pdf/<id>` needs to stay public and bounce-exempt, and it already is.

The dominant risk is not the deletion itself but ~20 tests, censuses and lists keyed on the deleted files (one of them a Python census, one a module-level `readFileSync` that would crash a whole vitest file). They are enumerated in section 8 and must move in the same change.

**Primary recommendation:** Use `next.config.ts` `redirects()` for `/portfolios/:path*` (and `/portfolios`), `/decks`, and `/api/portfolio-pdf/:id`; keep a rewritten `src/app/portfolio-pdf/[id]/page.tsx` as the named retired page; do the `/browse` single-category redirect with a page-level `redirect()`; add one disk-walking guard test modelled on `src/__tests__/dashboard-disclaimer-once.test.ts` plus extra cases in `e2e/route-redirects.spec.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Old-URL redirects (`/portfolios*`, `/decks`, `/api/portfolio-pdf/*`) | CDN / edge config (`next.config.ts` `redirects()`) | Proxy (not involved) | Runs before filesystem and proxy, so works signed-out and costs no render. |
| Retired-report page | Frontend Server (RSC page, no data read) | — | Reads nothing but the URL; must be public. |
| `/browse` single-category redirect | Frontend Server (page-level `redirect()`) | API/Backend (`getPopulatedCategorySlugs`) | Depends on a data read, so it cannot live in config. |
| Nav removal (Decks), Tweaks/dark/density removal | Browser / Client components | — | Pure component edits. |
| Disclaimer composition | Frontend Server (page/layout) | — | Static text composition from `Disclaimer.tsx` constants. |

## Standard Stack

No new packages. Everything is existing in-repo machinery.

| Tool | Version | Purpose | Source |
|------|---------|---------|--------|
| next | `next@16.4.2` (UI-SPEC records the resolved version) | `redirects()`, `redirect()` | `[CITED: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md]` |
| vitest + @testing-library | existing | guard + census tests | `[VERIFIED: node_modules/.bin/vitest present]` |
| playwright | existing | redirect canary (`e2e/route-redirects.spec.ts`, in the unseeded CI list at `.github/workflows/ci.yml:6370`) | `[VERIFIED: ci.yml:6370 grep]` |

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Audit not applicable. Packages removed: none. Packages flagged: none.

## 1. Inventory of every reference (HEAD, file:line)

Legend: **DEL** delete, **EDIT** change in place, **KEEP**, **CENSUS** census/list row to move or remove.

### 1a. `/portfolios` page tree — DEL (whole directory, including its 24 test/loading/error files)
`src/app/(dashboard)/portfolios/{layout,page,loading,error}.tsx`, `[id]/{page,loading,error,equity-curve-series.test,page.metadata.test}.tsx`, `[id]/manage/*`, `[id]/documents/*` and every `*.test.tsx` beside them `[VERIFIED: find output]`. `[id]/page.tsx` also exports helpers (`chooseAnalytics`) that tests import, see 1h.

### 1b. `/portfolio-pdf` and `/api/portfolio-pdf`
| Path | Class | Detail |
|------|-------|--------|
| `src/app/api/portfolio-pdf/[id]/route.ts` + `route.test.ts` | DEL | replaced by a config redirect |
| `src/app/portfolio-pdf/[id]/page.tsx` | EDIT (rewrite as retired page) | currently renders the PDF page and mounts `<Disclaimer variant="factsheet" trustTier={null} />` at `:406` |
| `src/app/portfolio-pdf/[id]/{vintage.ts,vintage.test.ts,page.*.test.tsx (5 files)}` | DEL | tests of the deleted renderer; replace with one retired-page test |
| `src/lib/pdf-render-token.ts` + `.test.ts` | DEL | importers are only the two deleted files plus tests `[VERIFIED: reach script, importer grep]`. Its secret is `const SECRET_ENV = "DEMO_PDF_SECRET"` (`pdf-render-token.ts:18`) |
| `src/lib/portfolio-analytics-adapter.ts` + test | **KEEP** | `src/__tests__/seed-integrity.test.ts:16` imports `adaptPortfolioAnalytics`; `scripts/seed-demo-data.ts:189` and `src/lib/types.ts:1485` cite it. Deleting it drags a seed test into scope. |
| `next.config.ts:156` `"/api/portfolio-pdf/\\[id\\]": CHROMIUM_BIN,` | EDIT (delete the line) | Chromium trace include for the deleted route. The comment block at `:8-11` mentions "the authed portfolio PDF route"; reword. |
| `src/proxy.ts:18` PUBLIC_ROUTES contains `"/portfolio-pdf"`; `:97` comment; `:123-124` `isPortfolioPdfRoute` | **KEEP** | retired page must stay public and bounce-exempt (D-03). Update the `:97` comment only. |
| `src/proxy.test.ts:244, 376-377` | KEEP | still true (`/portfolio-pdf` public, bounce-exempt). `:289` `/api/demo/portfolio-pdf/abc-123` is a different (192) route; keep. |
| `src/lib/api/limiter-ordering.test.ts:152` `"portfolio-pdf/[id]/route.ts",` | CENSUS (remove) | test at `:282` "registry has no stale entries (every classified path exists & consumes a limiter)" goes RED otherwise `[VERIFIED: :282-291]` |
| `src/__tests__/critical-regressions.test.ts:35-51` (`[CRITICAL-01] portfolio-pdf IDOR` reads `src/app/portfolio-pdf/[id]/page.tsx`) and `:204` (`"src/app/api/portfolio-pdf/[id]/route.ts"` in `pdfRoutes`, loop does `readText(route)`) | CENSUS | remove the IDOR describe (the new page has no admin client) and the `:204` entry; keep the two factsheet routes |
| `src/lib/ratelimit.ts:674`, `src/app/api/factsheet/[id]/pdf/route.ts:196`, `tearsheet.pdf/route.ts:143`, `src/app/api/allocator/scenario/share/route.ts:62`, `src/__tests__/no-store-coverage.test.ts:48` | comments only | optional reword; no behavior |
| `vitest.node-env.ts:191` (`"src/app/portfolio-pdf/[id]/vintage.test.ts"`), `:256` (`src/lib/pdf-render-token.test.ts`) | CENSUS (remove) | node-env include list. Keep `:259` (`portfolio-analytics-adapter.test.ts`). |
| `src/__tests__/contracts/env-manifest.test.ts:91-92` `const INDIRECT_READS = new Set(["ALERT_ACK_SECRET", "DEMO_PDF_SECRET"]);` | CENSUS (remove `DEMO_PDF_SECRET`, fix comment) | `.env.example` no longer documents it (Phase 192). Planner: run this test and `grep -a DEMO_PDF_SECRET` to confirm no other reader. |
| `src/__tests__/display-sign-single-source.test.ts:96,158` list `"src/app/portfolio-pdf/[id]/page.tsx"` (SCAN_FILES and CENSUS_FILES; the latter is a must-exist list, `:100-...`) | CENSUS | the retired page has no formatters: remove from both |
| `src/lib/anon-strategies-projection.test.ts:52` `"src/app/portfolio-pdf",` in `ANON_ROUTE_DIRS` | KEEP | the dir still exists and is still an anonymous route dir; the new page must not read strategy columns (it reads nothing) |
| `src/__tests__/test-restore-workflow-wiring.test.ts:5791`, `docs/architecture/adr-0014-secret-handling.md` | comment/doc | cite `pdf-render-token.test.ts` line 74; reword or leave (comment only) |

### 1c. `/portfolios` links and references outside the tree
| Site | Class | Action |
|------|-------|--------|
| `src/components/exchanges/ExchangesTabContent.tsx:40` and `:52` (`href={`/portfolios/${activePortfolio.id}`}`), label `:55` "Open portfolio →" | EDIT | `href="/allocations"`; label "Open My Allocation →" (UI-SPEC copy). No existing test file for this component `[VERIFIED: grep]`. |
| `src/lib/email.ts:1001` `<a href="${APP_URL}/portfolios" ...>View in dashboard →` | EDIT | `${APP_URL}/allocations`. No existing email test asserts it; add one assertion (the guard test can read the file). |
| `src/components/portfolio/PortfolioOptimizer.tsx:163` "Add to portfolio" `Link` (UC-12) | EDIT | delete the `Link` at `:162-167`; then `SuggestionCard`'s `portfolioId` prop (`:118-121`, passed at `:393`) is unused in the card: remove it. `portfolioId` is still used for the fetch at `:223`. Check `PortfolioOptimizer.test.tsx` and `OptimizerPanel.test.tsx` for assertions on the link (grep found none by text). |
| `src/components/portfolio/StrategyBreakdownTable.tsx:220` | DEL with the file | mounts only on the deleted `/portfolios/[id]` page |
| `src/components/portfolio/AddToPortfolio.tsx:121` `href="/portfolios"` | DEL with the file | |
| `src/components/layout/Sidebar.tsx:183-186` | comments | contain the words "/portfolios" and "AddToPortfolio"; reword so a comment-stripped scan and a plain grep are both clean |
| `src/components/layout/DashboardChrome.tsx:102` (comment), `:142` `/^\/(allocations\|compare\|discovery\|admin\|portfolios\|my-strategies)(\/\|$)/` | EDIT | drop `portfolios` from the alternation (dead after the redirect) and fix comment. Tests: `DashboardChrome.test.tsx:445-455` (two `/portfolios` isWide tests: delete) and `:601` (`"src/app/(dashboard)/portfolios",` in `SCANNED_TREES`: remove, the directory will not exist) |
| `src/app/(dashboard)/requireRolePage-wiring.test.tsx:95` (`await import("./portfolios/layout")`, label `portfolios/layout`) | CENSUS | delete that case. KEEP the `decks/page` case at `:123` (the page stays). |
| `src/components/layout/MobileNav.test.tsx:63,87,125` `expect(hrefs).not.toContain("/portfolios")` | KEEP | already a negative; still true |
| `eslint.config.mjs:289` glob `"src/app/(dashboard)/portfolios/**"` in the `no-raw-font-px` per-surface list | EDIT (remove the glob) | |
| `DESIGN.md:253` lists `/portfolios` among data-dense surfaces | EDIT (one token) | DESIGN.md is the source of truth; keep the edit to removing the route from that list |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.tsx:24`, `lib/watchlist-read.ts:135`, `HoldingsTabPanel.test.tsx:266`, `OptimizerPanel.test.tsx:90,114`, `src/components/ui/CardShell.tsx:6`, `MorningBriefing.tsx:6`, `RiskAttribution.test.tsx:63`, `BenchmarkComparison.test.tsx:7`, `PortfolioOptimizer.test.tsx:3,13`, `src/lib/queries.ts:2502,2556,2869,2902` (cite `portfolios/[id]/page.tsx:283,466`), `src/app/(dashboard)/allocations/lib/*` | comments only | KEEP; optionally trim stale `/portfolios/[id]` mentions. A guard that scans comment-stripped code will not trip on them. |
| `analytics-service/routers/portfolio.py:86`, `tests/test_computation_error_curated.py:4` | docstring/comments | KEEP |
| `analytics-service/tests/test_computing_started_at_stamp.py:943` `"src/app/(dashboard)/portfolios/[id]/page.tsx": 1,` in `_TS_BENIGN_FILES` | CENSUS (remove) | **Python census over `src/**`**: a pinned count for a file that no longer exists. Verify how the test treats a missing key (read `:925-990` plus its assertion), run `pytest` from `analytics-service/` only. |
| `src/lib/complete-status-scan.test.ts:80` `"app/(dashboard)/portfolios/[id]/page.tsx": 3,` | CENSUS (remove) | frozen ALLOWLIST |
| `src/lib/queries.audit-2026-05-07.test.ts:1176-1232` (five `import("@/app/(dashboard)/portfolios/[id]/page")` for `chooseAnalytics`) | CENSUS | these tests exercise a helper that lives in the deleted page; delete the describe block (the helper is gone with the page) |
| `src/components/portfolio/StrategyBreakdownTable.test.tsx:8` imports from the deleted page | DEL with the component | |
| `src/__tests__/dashboard-disclaimer-once.test.ts:118` `expect(files).toContain("src/app/(dashboard)/portfolios/[id]/page.tsx");` | CENSUS | swap for another real dashboard page, e.g. `src/app/(dashboard)/allocations/page.tsx` |
| `src/__tests__/phase-32-frozen-spine-guards.test.ts:184-188` | **CRITICAL CENSUS** | `readFileSync(MANAGE_PAGE_PATH)` and `readFileSync(ID_PAGE_PATH)` run at **module scope**; deleting the pages throws on import and takes the whole file down. Remove `PORTFOLIOS_DIR`, `MANAGE_PAGE_*`, `ID_PAGE_*` and the two FLOW-01 tests at `:~285-345` (they assert `/discovery/crypto-sma` links on the deleted pages and read `AddToPortfolio.tsx`). Keep the rest of the file (`SIDEBAR_SRC` checks). |
| `src/__tests__/phase-150-capital-ownership-invariant.test.ts:399-400` (`SANCTIONED_POSITION_WRITERS`), `:980-981` (P4c consumer loop), `:700` (`expect(positionWriters()).toEqual([...SANCTIONED_POSITION_WRITERS].sort())`), `:~891-1000` prose/test names ("exactly three production files create a portfolio_strategies row") | **CRITICAL CENSUS** | deleting `AddToPortfolio.tsx` and `MigrationWizard.tsx` removes 2 of the 3 browser-direct `portfolio_strategies` writers (`AddToPortfolio.tsx:55` insert, `MigrationWizard.tsx:115` upsert `[VERIFIED: grep]`). Update `SANCTIONED_POSITION_WRITERS` to `[ALLOCATION_ROUTE, SEED_DEMO_DATA, SEED_FULL_APP_DEMO, (SEED_PORTFOLIO_BENCHMARK_LOCAL if kept)]`, delete the `consumer` loop (it asserts `capitalOwnershipRefusalMessage` is used in both components), and keep every SQL-trigger pin (P4, P4b) untouched: the trigger guards the table whoever writes it. Re-title P2. This is data-integrity-adjacent (OWN-03): do NOT neuter any trigger assertion. |
| `e2e/portfolio-benchmark-local.spec.ts`, `scripts/seed-portfolio-benchmark-local.ts` | DEL (pair) | the spec walks `/portfolios/[id]` (`:96`); neither is in `package.json`, `.github` or `playwright.config.ts` `[VERIFIED: grep]`. The seed script is also named in `phase-150...test.ts` as `SEED_PORTFOLIO_BENCHMARK_LOCAL`/`SEED_SCRIPTS`: remove from those two lists in the same change. |
| `e2e/og-public.spec.ts:52-60` `GET /api/portfolios/list` | KEEP | a nonexistent-route proxy-gating probe, unrelated. The guard must not flag `/api/portfolios`. |

Not found anywhere (grep -a, repo excluding `node_modules`, `.git`, `.next`, `.planning`): sitemap, robots, `.github` workflows, `lighthouserc.json`, `playwright.config.ts`, hygiene/lint scripts reading route lists other than `scripts/check-route-contract.ts`. `[VERIFIED: grep]`

### 1d. `/decks`
`Sidebar.tsx:141` `{ label: "Decks", href: "/decks", icon: DeckIcon },` (EDIT: delete); `Sidebar.tsx:125` comment names `/decks` (reword); `Sidebar.tsx:655` `function DeckIcon` (DEL: otherwise an unused function); `Sidebar.test.tsx:282-293` asserts `a[href="/decks"]` exists and sits before My Strategies (EDIT: anchor the order test on Compare instead). `src/app/(dashboard)/decks/page.tsx`, `src/components/deck/DeckCard.tsx`, `getDecks`: **KEEP untouched** (D-04). Because the redirect lives in `next.config.ts`, `requireRolePage-wiring.test.tsx:123` and `page-titles.test.ts:367-432` (which list the decks page) stay green with no edit. MobileNav has no Decks item `[VERIFIED: grep "Decks" MobileNav.tsx returns none]`.
Note the discovery categories `crypto-decks`/`tradfi-decks` in `src/lib/constants.ts:363-364` are NOT the Decks surface (UI-SPEC S-3); the guard must not flag them.

## 2. /portfolios-only vs shared components

Method: a reachability script (scratchpad `reach.mjs`, import-graph from every `page|layout|route|loading|error` entry, tests excluded) run with and without the deleted trees `[VERIFIED: ran at HEAD]`.

**Orphaned by the deletion (no non-test importer outside the deleted set):** `AddToPortfolio`, `MigrationWizard`, `AlertsList`, `AllocationEventForm`, `AllocationTimeline`, `AttributionBar`, `BenchmarkComparison`, `CompositionDonut`, `CreatePortfolioForm`, `DocumentList`, `DocumentUpload`, `MorningBriefing`, `PortfolioEquityCurve`, `PortfolioKpiPanel`, `RemoveStrategyButton`, `RiskAttribution`, `StrategyBreakdownTable` (all `src/components/portfolio/`), plus `src/lib/pdf-render-token.ts` and `src/lib/portfolio-analytics-adapter.ts`.

**Shared with /allocations, MUST survive:** `PortfolioOptimizer`, `ReplacementPanel`, `ReplacementCard`, `BridgeTrigger`, `CorrelationHeatmap` (also `scenario-share` and `ScenarioComposer`), `InsightStrip`, `PortfolioImpactPanel` (`SimulateImpactButton`), `CardShell`. Word-matches of "AttributionBar/RiskAttribution/PortfolioKpiPanel/CompositionDonut/MigrationWizard/RemoveStrategyButton" in `ExposureByClass.tsx`, `AllocationsTabs.tsx`, `KpiPanel.tsx`, `AllocateDialog.tsx`, `MarkOwnershipDialog.tsx`, `StrategyTable.tsx`, `capital-ownership.ts`, `visibility.ts`, `api/portfolio-strategies/allocation/route.ts` are comments or type names, not imports (the import graph confirms).

**Recommendation (prescriptive):** Two tiers.
1. **Must delete** (named by D-01/D-02/D-03): the three page trees, the API route, `AddToPortfolio` (+ its mount at `discovery/[slug]/[strategyId]/page.tsx:5,163`), `MigrationWizard` (its only mount was the deleted manage page), `StrategyBreakdownTable`, `pdf-render-token`.
2. **Should delete in a separate, later plan within the phase** (orphans, dead code, each with census rows): the other 13 orphaned components. Each has rows in `src/__tests__/display-sign-single-source.test.ts` (component directory `src/components/portfolio` is in `SCAN_DIRS` `:85`, so removing files shrinks the population but `POPULATION_FLOOR = 150` `:~165` has headroom; the per-file exemption map at `:988-1074` has entries for `AlertsList`, `AllocationEventForm`, `CompositionDonut`, `CreatePortfolioForm`, `DocumentUpload`, `MigrationWizard`, `RemoveStrategyButton`, `RiskAttribution`: those keys must go, and `CENSUS_FILES :100-...` lists `PortfolioEquityCurve` and `StrategyBreakdownTable`: both must be removed, plus the second list at `:121,146,150,152`), `src/__tests__/display-sign-census-misses.test.tsx` (references `RiskAttribution`, `ReplacementCard`), `src/components/portfolio/portfolio.signed-zero.test.tsx` (imports many; edit rather than delete, because it also covers shared components), `src/lib/queries.trade-venues.test.ts` (references `CompositionDonut`, `StrategyBreakdownTable`). If the plan runs short, tier 2 is the safe thing to defer: leaving an unimported component breaks nothing. Record any deferral in the phase SUMMARY/TODOS rather than silently.
3. **Keep all of `src/lib/queries.ts`** (`getUserPortfolios`, `getPortfolioDetail`, `getPortfolioStrategies`, `getAllocationEvents`, `assertPortfolioOwnership`, `getDecks`): exported helpers with other tests; unused-export removal is not this phase.

## 3. Redirect mechanism (recommendation)

**Precedent, read at HEAD:** `next.config.ts` `redirects()` carries `{ source: "/scenarios", destination: "/allocations?tab=scenario", permanent: true }`; the manifest carries `{ route: "/scenarios", class: "exception", redirectFrom: "/scenarios", notes: "EXCEPTION: MOVED route (Phase 51 NAV-01)... redirects() runs before the filesystem, so there is NO backing page.tsx..." }` (`route-contract-manifest.ts:263-269`); `scripts/check-route-contract.ts` Rule 3 enforces `redirectFrom` ⇒ matching `redirects()` `source` (exact string, via `parseRedirectSources`, `:~330-360`); `e2e/route-redirects.spec.ts` asserts status and `Location` with `maxRedirects: 0`. Phase 192's `/demo` is NOT a redirect precedent (see Summary).

**Recommended rules (add to `redirects()` after the `/scenarios` entry):**
```ts
// Phase 195 TRIM (D-01): the /portfolios surface is retired; every sub-route lands on My allocation.
{ source: "/portfolios/:path*", destination: "/allocations", permanent: true },
// Phase 195 TRIM (D-04): Decks is hidden until it works. NOT permanent: it is expected to come back.
{ source: "/decks", destination: "/discovery/crypto-sma", permanent: false },
// Phase 195 TRIM (D-03): the portfolio report API is retired; land on the named retired page.
{ source: "/api/portfolio-pdf/:id", destination: "/portfolio-pdf/:id", permanent: true },
```
- `:path*` is "zero or more", so `/portfolios/:path*` also matches `/portfolios` itself `[CITED: redirects.md: "/blog/:slug* matches /blog, /blog/a, and /blog/a/b/c"]`. This also covers the dead `/portfolios/<id>/strategies/<id>` target. A planner should still add a runtime assertion that `GET /portfolios` (no suffix) redirects, because the doc covers `/blog` but this repo has not exercised it.
- Status codes: 308 for the permanent retirements, 307 for `/decks` (documented: `permanent: false` is 307, "not cached"). `[ASSUMED]` that browser caching of the 308 is acceptable; the `DOMAINONE` entry in this same file records the same trade-off. If the founder prefers no cached redirect, make all three `permanent: false`; nothing else changes.
- **Query is forwarded, not dropped.** The docs say "any query values provided in the request will be passed through". The UI-SPEC says `/portfolios/<id>/manage?add=<sid>` lands on plain `/allocations`. `/allocations` ignores an `add` param `[VERIFIED: grep of allocations/page.tsx and the tree for get("add")]`, so the outcome is visually identical. Record this as an accepted deviation; do not add a `has`/proxy hack.
- Works signed-out: config redirects precede the proxy, so a signed-out `/portfolios` goes `/allocations` then the proxy's existing `/login` bounce (same as `/scenarios`, asserted in `route-redirects.spec.ts` by checking only the first hop). `/api/portfolio-pdf/x` becomes a public hop to the already-public `/portfolio-pdf/x`: **no `PUBLIC_ROUTES` addition needed** (`/api/portfolio-pdf` was never in it `[VERIFIED: proxy.ts:18]`).
- Wrong-role: `/allocations` is allocator-only, so a manager hitting an old `/portfolios` link follows today's `/allocations` role bounce. Accepted (UI-SPEC S-1).

**Manifest edits (`src/lib/routing/route-contract-manifest.ts`), alphabetical, with reason and date in `notes`:**
1. Delete the four entries at `:225-244` (`/portfolios`, `/portfolios/:id`, `/portfolios/:id/documents`, `/portfolios/:id/manage`): Rule 4 would flag all four as STALE once the pages are gone. Replace with one `{ route: "/portfolios", class: "exception", redirectFrom: "/portfolios/:path*", notes: "RETIRED 2026-11-07 (Phase 195 D-01)... config-level redirect to /allocations; stored portfolios rows kept" }`. `redirectFrom` must equal the `source` string byte for byte or Rule 3 reports MISSING-REDIRECT.
2. `/decks` (`:191-195`): keep `class: "private"` (the page file stays, so Rule 1 and Rule 4 still pass), add `redirectFrom: "/decks"` and rewrite notes ("HIDDEN 2026-11-07 (Phase 195 D-04): next.config redirect to /discovery/crypto-sma until Decks works; removing the redirect restores the page"). `[ASSUMED]` that a non-exception entry may carry `redirectFrom`: the type allows it and Rule 3 only inspects `redirectFrom`, but no existing entry combines them; the `check-route-contract.test.ts` fixtures do not cover it, so run `npm run check:route-contract` after the edit.
3. `/portfolio-pdf/:id` (`:359-364`): keep `class: "public"`, replace notes. Exact current text to replace: "Share-token PDF deep link — covered by the /portfolio-pdf PUBLIC_ROUTES prefix + bounce-exempt. NEVER MOVE." New: retired 2026-11-07 per D-03, page reads nothing, public so an old link never lands on a login or 404.
4. Add `{ route: "/api/portfolio-pdf/:id", class: "exception", redirectFrom: "/api/portfolio-pdf/:id", notes: "RETIRED 2026-11-07..." }` for the audit trail (Rule 4 skips exceptions; the manifest key must differ from the page entry's `route`).
5. The header comment of the manifest and the test `src/__tests__/check-route-contract.test.ts` need no edit (fixture-driven).

**Retired page** (`src/app/portfolio-pdf/[id]/page.tsx`, rewritten): server component, no data read, no `createAdminClient`, `export const metadata = { title: "Portfolio report retired", robots: "noindex" }`, `LegalFooter` from `@/components/legal/LegalFooter`, `Button` (`size="md"` is `min-h-[44px] px-4 py-2.5 text-body`, `src/components/ui/Button.tsx:15-17`) wrapped in `Link`. Layout and copy: UI-SPEC S-4 verbatim. Mirror `src/app/factsheet/[id]/v2/not-found.tsx` structure but with the UI-SPEC tokens (that file uses `font-serif`/`text-text-2`; the UI-SPEC specifies `font-display text-page-title`). Because `/portfolio-pdf` is a root-level route outside `(dashboard)`, no chrome wraps it, so `<main>` and `LegalFooter` are the page's. It must not read `searchParams` (so `renderToken` is ignored), and `src/lib/anon-strategies-projection.test.ts:52` will scan it as an anonymous route dir (it reads no strategy columns).

## 4. Tweaks panel

Readers (grep -a): `AllocationsTabs.tsx:23-25` imports, `:630-645` (`outcomesHidden` reads `document.body.getAttribute("data-show-outcomes")`), `:765` `<TweaksProvider>`, `:787-789` comment, `:917-918` `<TweaksToggle />`, `:1032` `<Tweaks />`, `:1215-1230` `OutcomesTabRedirectGuard` (`useTweakValue("showOutcomes")`); `context/TweaksContext.tsx` (331 lines; `STORAGE_KEY = "allocations.tweaks"` `:68`, `TWEAK_DEFAULTS` `:58`, effects `:226-290` writing `body[data-density]`, `body[data-display-font]`, `body[data-show-outcomes]`, `html[data-accent-intensity]`); `widgets/performance/EquityChart.tsx:13,640-641,2200` (`useTweakValue("chartStyle")`, `("showBench")`, branches at `:1807`, `:1844`); `components/BridgeWidget.tsx:8,51` (prop default "full", docs only); `globals.css` `:206-262` (`body[data-density]` + `[data-allocator-dashboard]`), `:272-` (`data-show-outcomes`), `:342-346` (`body[data-display-font="sans"] .font-display`), `:642-663` (`html[data-accent-intensity="full"]`, including the dark-factsheet re-assert at `:659-663`).

Tests/specs to delete or edit: `components/Tweaks.test.tsx`, `context/TweaksContext.codec.test.ts`, `widgets/performance/EquityChart.tweaks.test.tsx`, `EquityChartWidget.header.test.tsx` (check), `AllocationsTabs.test.tsx` (check Tweaks mentions), `e2e/layout-narrow.spec.ts` (`TWEAKS_TOGGLE`/`TWEAKS_PANEL` consts `:69-70` and the whole `test.describe("Tweaks — N-TWEAKS"` block `:255-~320`), prose mentions in `e2e/helpers/reflow.ts:63`, `e2e/reflow.spec.ts:162`. `src/components/auth/SignOutButton.test.tsx:75,129` lists `"allocations.tweaks"` as a known app key purged by prefix on sign-out: **KEEP**; it is the cleanup path for already-stored values (the file itself notes the same pattern for a retired writer: "writer retired in B7b; still prefix-purged").

**Recommendation:** delete `Tweaks.tsx`, `TweaksToggle.tsx`, `TweaksContext.tsx` (provider, codec, effects, `useTweaks`); replace with nothing but `TWEAK_DEFAULTS` constants consumed directly (`EquityChart` `chartStyle = "area"`, `showBench = true`; `AllocationsTabs` drop `outcomesHidden` and `OutcomesTabRedirectGuard`; remove the `<TweaksProvider>` wrapper; delete the five CSS blocks above, keeping `--row-h`/`--density-pad` `:root` defaults). Result: no code path reads `allocations.tweaks`, so a stale stored value cannot change anything (UC-6), and no body/html attribute is ever set. If a smaller edit to the 2200-line `EquityChart.tsx` is wanted, the fallback is to keep `useTweakValue` as a pure function over `TWEAK_DEFAULTS` with no storage and no effects; either way the storage read and the DOM attribute writes must go, because they are what a stale value acts through. Delete the dead `line`/`showBench=false` branches too unless a test pins them (then delete the test).

## 4b. Dark mode (`factsheet-context.tsx` is shared with Phase 193)

Sites (grep -a `darkMode|setDarkMode|"dark"`): `factsheet-context.tsx:46-47` (type `darkMode`, `setDarkMode`), `:61-67` (`DisplayContext` comment + `darkMode: boolean`), `:124` (`if (r.dark === "1" || r.dark === true) out.dark = r.dark;` in the codec), `:205` (`const [darkMode, setDarkMode] = useState(false)`), `:341-343` (`get("dark")` → `setDarkMode(true)`), `:366` (`dark: darkMode ? "1" : undefined`), `:376` (`if (state.dark) params.set("dark", "1"); else params.delete("dark");`), `:387` (effect deps), `:401-405` (context values), `:459` (comment). `FactsheetView.tsx:418,435,436,456` (`useDisplay`, `resolvePalette({ darkMode, colorblind })`, `paletteToCssVars(resolved, darkMode)`, `data-theme={darkMode ? "dark" : "light"}`), `:2919-2970` `DisplayMenu` (`activeCount = (darkMode ? 1 : 0) + ...`, the "Dark mode" toggle row at `~:2944-2950` calling `trackFactsheetEvent("factsheet_v2_toggle_dark", ...)`). `palette.ts:16,119,123,131-147` (`darkMode` param, `DARK`, `COLORBLIND_DARK`, `colorScheme`). `HeatmapPanels.tsx:16-17`. `globals.css:567-663` (`.factsheet-v2-shell[data-theme="dark"]` and the dark colorblind rules; `[data-theme="light"][data-colorblind="1"]` rules at `:630-635` must KEEP, and `data-theme` is still emitted as "light").

Tests: `factsheet-context.codec.test.ts` (`:24,36,57,93-106` pin `dark` round-trip), `factsheet-context.provider.test.tsx` (`:112-116,267,352-361` darkMode probe), `HeatmapPanels.tint-contrast.test.ts:39-42` (four modes), `FactsheetBody.guard04-no-bleed.test.tsx` (`:23-40,166-172,189,300`: it drives its URL/localStorage mutation by `fireEvent.click(screen.getByText("Dark mode"))`; **re-drive it with the "Colorblind palette" toggle**, `cb` is also a persisted view-state param, and keep `FACTSHEET_URL_PARAM_RE = /[?&](range|cmp|dark)=/` as is: the `dark` alternative becoming a never-hit param is fine and still guards a regression).

**Recommendation (minimal and 193-safe):** remove only `darkMode` state, `setDarkMode`, the `get("dark")` read (`:341-343`), the `dark:` write/param (`:366`, `:376`) and the codec line (`:124`) in `factsheet-context.tsx`, so a stored `dark:"1"` or `?dark=1` is simply never read and never re-written (UC-7). Do NOT refactor the surrounding persistence (Phase 193 QUIETVIEW edits that file's persistence); sequence this plan after 193's edit of the same file or keep the diff to those lines so a textual merge is trivial `[ASSUMED]`. Then thin consumers: `palette.ts` loses `DARK`/`COLORBLIND_DARK` and the `darkMode` param (`resolvePalette({ colorblind })`); `DisplayMenu` drops the row and its count term; `HeatmapPanels` test collapses to two modes. Delete the dark CSS blocks. `FactsheetFooter` is untouched (UC-11).

## 4c. StrategyTable density (D-07)

`StrategyTable.tsx`: `:578-583` state (`useState<"comfortable" | "compact">`), `:727-734` `handleDensityChange` (uses `withViewTransition`), `:1002` effect dep `[density, page, effectiveViewMode, paged.length]` (drop `density`), `:1101` `data-density={density === "compact" ? "tight" : undefined}` (remove the attribute; **keep `data-strategy-table=""`**: `e2e` and `globals.css` key on it), `:1106-1141` the strip (`<div className="flex items-center justify-end border-b border-border px-4 py-2">` through its closing tag). `src/lib/view-transition.ts` exports `withViewTransition`; its only importer outside its own test is `StrategyTable.tsx` `[VERIFIED: grep]` — after the change the helper has no caller: delete it and its test, or leave it (planner's call; deleting needs `view-transition.test.ts` removal). `globals.css:228-245` `[data-strategy-table][data-density="tight"|"loose"]` rules go. Tests: `StrategyTable.test.tsx:615-616` (comment), `:828-847` (the "Table density" test: DELETE), `StrategyTable.default-mounts.test.tsx` and its fixture `__fixtures__/strategy-table-default-mounts.json` (**3 mounts: discovery, browse, myStrategiesOwner; each contains the strip** `[VERIFIED: python json check]`): the test says "THIS TEST HAS NO WRITE OR UPDATE PATH... never a regenerated fixture" and records prior by-hand surgical edits. Follow that precedent: remove the strip's HTML (and nothing else) by hand from all three mounts, record a dated "NEXT SURGICAL EDIT" line in the test docblock. The sticky header offset (UI-SPEC S-8) is measured from `frame` (`setFrame` ref, `:~1099`), not from the strip, so no offset change is expected; the executor must check `:950-1002` `measure` still pins the header (assertion in the existing tests).

## 5. `/browse` single-category redirect (D-08)

`src/app/browse/page.tsx`: `getPopulatedCategorySlugs()` (`src/lib/queries.ts:1265-1296`) **never throws and returns `[]` on both a DB error and an empty result** (`:1279-1284`). The page filters `DISCOVERY_CATEGORIES` by it and, when `populatedSlugs.length === 0`, renders ALL five categories (`:21-24`); the "No strategies published yet" line at `:56-60` is **unreachable at HEAD** (`categories.length === 0` cannot happen because `DISCOVERY_CATEGORIES` is non-empty). So the UI-SPEC S-9 table ("0 → existing empty state; failed → fallback cards") does not match the code: zero and failed are indistinguishable and both render the five cards. Resolution: redirect only when `populatedSlugs.length >= 1 && categories.length === 1`; leave the zero/failed path exactly as today (cards). This satisfies the one thing the spec cares about (a failed read never redirects) and does not touch the unreachable empty state. Flag this discrepancy to the founder in the phase report; changing it means making `getPopulatedCategorySlugs` return a discriminated result, which is a new behavior and out of scope.

Implementation: in `BrowsePage`, after computing `categories`: `if (populatedSlugs.length > 0 && categories.length === 1) redirect(`/browse/${categories[0].slug}`);` with `import { redirect } from "next/navigation"`. It must be **outside** the `try/catch` (`redirect` throws; docs: "`redirect` throws an error so it should be called outside the `try` block"). There is no `loading.tsx` under `src/app/browse` `[VERIFIED: ls]`, so it is a real 307, not the streaming meta-refresh the docs describe for streaming contexts. Also reword the sign-up copy at `:68-70` ("...and build portfolios." → "...and model an allocation.", UC-13).

e2e/CI impact (important): the seeded e2e database has exactly one populated category (`scripts/seed-demo-data.ts:901-943` resolves only `crypto-sma`), so `/browse` will redirect there. `e2e/full-flow.spec.ts:64-66` (`goto("/browse")` then `expect(page.locator("h1")).toContainText("Browse")`) will fail (h1 becomes "Crypto SMA", `browse/[slug]/page.tsx:51-53`); change it to assert the redirect landed on `/browse/crypto-sma`. The three unseeded sweeps (`reflow-sweep.spec.ts:49`, `axe-app-wide.spec.ts:100`, `no-clip-sweep.spec.ts:155`, anchor `main h1`) run on the placeholder-env build with no DB, so `getPopulatedCategorySlugs` returns `[]` and no redirect occurs: unchanged. Add a unit test for `BrowsePage`: mock `getPopulatedCategorySlugs` to `["crypto-sma"]` (expect `redirect` called with `/browse/crypto-sma`), `["crypto-sma","cfd"]` (cards, no redirect), `[]` (cards, no redirect, as today).

## 6. D-09 disclaimer inventory (measured at HEAD)

`Disclaimer` mounts in non-test `src` (`grep -a -rn "<Disclaimer"`): `browse/layout.tsx:40` (footer), `browse/[slug]/[strategyId]/page.tsx:95` (custody) and `:190` (strategy), `factsheet/[id]/tearsheet/page.tsx:675` (custody), `strategy/[id]/page.tsx:227` (strategy), `strategy-v2/StrategyV2Shell.tsx:151` (strategy), `layout/DashboardChrome.tsx:178` and `:254` (footer, one per layout arm), `portfolio-pdf/[id]/page.tsx:406` (factsheet; goes with the page), `landing/VerificationResults.tsx:127` (not mounted at HEAD per UI-SPEC). `LegalFooter` mounts: `(marketing)/layout.tsx:52`, `browse/layout.tsx:42`, `DashboardChrome.tsx:180,256` (navigation, not a disclaimer). Texts (`src/components/ui/Disclaimer.tsx`, read in full): `FOOTER_TEXT = "Not financial advice. Past performance does not guarantee future results. Cryptocurrency trading involves substantial risk of loss."`; `CUSTODY_TEXT = "Strategy monitored via read-only exchange API. Manager retains asset custody. ${PLATFORM_NAME} provides analytics only — no pooling, no fund administration, no custody of client assets."`; `PROVENANCE.api_verified = "Data verified from exchange API. ${PLATFORM_NAME} does not independently audit trading strategies."`; the `strategy` variant is `${provenanceFor(trustTier)} Past performance is not indicative of future results.`

| Page | Blocks now | Single block after |
|------|-----------|--------------------|
| `/browse/<cat>/<id>` | custody `:95`, strategy `:190`, layout footer (`browse/layout.tsx:40`) = 3 | one block after the sign-up CTA: `CUSTODY_TEXT` + `provenanceFor(tier)` + `FOOTER_TEXT`. |
| `/factsheet/<id>/tearsheet` | custody section `:673-676` + Risk Disclosure `:678-696` = 2 | one Risk Disclosure section: delete the custody `<section>` and the `Disclaimer` import; append "Quantalyze provides analytics only — no pooling, no fund administration, no custody of client assets." after "managers retain asset custody." (UI-SPEC S-5 verbatim); move the section below the contact CTA. `page.test.tsx:52` and `page.trade-fetch.test.tsx:56` `vi.mock` the Disclaimer module: harmless once unmounted, but remove the stale mocks. |
| `/browse`, `/browse/<cat>` | layout footer (1) | unchanged in rendered output, but the footer must move out of the layout (below) |
| `(dashboard)` pages | chrome footer (1) | unchanged; `dashboard-disclaimer-once.test.ts` already pins it |
| `/strategy/<id>`, `/strategy/<id>/v2` | strategy variant (1), no layout footer | unchanged |
| `/discovery/<slug>/<id>`, `/allocations` (FactsheetView) | chrome footer + `FactsheetFooter` note (`FactsheetView.tsx:3026`: "...Past performance is not indicative of future results.") | UC-11 recommendation: leave untouched, route to Phase 196. `[ASSUMED]` per UI-SPEC; the note is the only risk statement on the public `/factsheet/<id>/v2`. |

**Mechanism (prescriptive).** A layout cannot know whether its page carries its own block, so move the footer into the pages instead of conditionally hiding it: delete `<Disclaimer variant="footer" />` from `browse/layout.tsx:40`; mount it as the last element in `browse/page.tsx` and `browse/[slug]/page.tsx`; on `browse/[slug]/[strategyId]/page.tsx` remove `:95` and `:190` and mount a new combined block. Add a variant to `Disclaimer.tsx` rather than inlining text: e.g. `variant="strategy-page"` that renders `${CUSTODY_TEXT} ${provenanceFor(trustTier)} ${FOOTER_TEXT}` with the `footer` frame classes (`text-center py-6 border-t border-border mt-12`, UI-SPEC A-4). This keeps every sentence sourced from the existing constants (no new legal copy) and dedupes the two "past performance" sentences exactly as UI-SPEC S-5 specifies. Add a `Disclaimer.test.tsx` case pinning the composed string for `api_verified` verbatim from UI-SPEC S-5 and a `csv_uploaded` case (UC-10: custody sentence stays verbatim; booked for Phase 201). Update `browse/[slug]/[strategyId]/page.max-dd-tone.test.tsx:17` (`vi.mock("@/components/ui/Disclaimer", () => ({ Disclaimer: () => null }))`): still fine.

## 7. D-10 guard test design

**Home and analogs.** `src/__tests__/` (vitest). Closest analog: `src/__tests__/dashboard-disclaimer-once.test.ts`: derives its population from disk each run, strips comments via `stripCommentsPreserveLines` (`@/lib/source-scan`, `src/lib/source-scan.ts:400`), has self-tests proving the matcher can fire, and a positive control (population contains a known file; chrome footer count = 2). Reuse that skeleton. A second precedent for lockstep with config is `scripts/check-route-contract.ts` (`parseRedirectSources`, `parsePublicRoutes`, `stripComments` are exported).

**Proposed file:** `src/__tests__/trim-removed-surfaces.test.ts` (name per planner). Cases (each must have a self-test showing the matcher fires on a synthetic string):
1. **Routes gone:** `existsSync` is false for `src/app/(dashboard)/portfolios`, `src/app/api/portfolio-pdf`; `src/app/portfolio-pdf/[id]/page.tsx` exists, contains no `createAdminClient`, no `verifyPdfRenderToken`, and exports `metadata` with `noindex`.
2. **Redirects present (positive control):** `parseRedirectSources(readFileSync("next.config.ts"))` contains `/portfolios/:path*`, `/decks`, `/api/portfolio-pdf/:id`, and the destinations (read the matching object literal) are `/allocations`, `/discovery/crypto-sma`, `/portfolio-pdf/:id`. `/portfolio-pdf` is still in `parsePublicRoutes(proxy.ts)`.
3. **No in-app link (comment-stripped, non-test `src/**/*.ts(x)`):** regex over string literals/JSX for `["'`]\s*(\$\{[^}]*\})?/(portfolios|decks)(/|["'`?$])` and for `/portfolio-pdf` and `/api/portfolio-pdf`, with an explicit allowlist of files that legitimately name them: `src/proxy.ts`, `src/lib/routing/route-contract-manifest.ts`, `src/app/portfolio-pdf/[id]/page.tsx`, and (for `/decks`) none. Must not flag `/api/portfolios/list` (e2e only, outside `src`) or `crypto-decks`/`tradfi-decks` slugs. `src/lib/email.ts` must contain `${APP_URL}/allocations` (positive control for D-01).
4. **Controls gone (source scan, comment-stripped):** no `aria-label="Toggle tweaks panel"`, `Design variations`, `allocations-tweaks-panel`, `aria-label="Table density"` (scoped to `src/components/strategy/StrategyTable.tsx`); no `label: "Decks"` in `Sidebar.tsx`; no `"Dark mode"` in `FactsheetView.tsx`; no `<AddToPortfolio` or `AddToPortfolio` import anywhere in `src`; `src/app/(dashboard)/allocations/components/Tweaks.tsx` and `TweaksToggle.tsx` do not exist.
5. **Render probes (cheap, behavioral):** render `Sidebar` as allocator (`Sidebar.test.tsx` already does) and assert `a[href="/decks"]` is null and no `a[href^="/portfolios"]`; render `StrategyTable` default and assert `queryByRole("group", { name: "Table density" })` is null.
6. **Disclaimer once:** per page, count `<Disclaimer` in comment-stripped source: `browse/layout.tsx` 0; `browse/page.tsx` 1; `browse/[slug]/page.tsx` 1; `browse/[slug]/[strategyId]/page.tsx` exactly 1 and it is the combined variant; `tearsheet/page.tsx` 0. Positive control: `Disclaimer.tsx` still exports all variants.

**Runtime canary:** extend `e2e/route-redirects.spec.ts` (already in the unseeded CI list, `ci.yml:6370`): `/portfolios`, `/portfolios/x/manage`, `/decks`, `/api/portfolio-pdf/x` each `request.get(..., { maxRedirects: 0 })` with status and `Location` assertions (308/308/307/308; never `/login`), and `/portfolio-pdf/<uuid>` returns 200 with an `h1` containing "retired" and no session. Add the retired route to the three public sweeps (`reflow-sweep`, `axe-app-wide`, `no-clip-sweep`: anchor `main h1`) for UC-20.

**Neuter, RED, restore (never `git checkout`, `restore` or `stash`).** For each of at least four neuters, run: `cp -p <file> <scratchpad>/<name>.bak && shasum -a 256 <file> <scratchpad>/<name>.bak`, edit the file, `npx vitest run src/__tests__/trim-removed-surfaces.test.ts` and capture the failing test name, then `cp -p <scratchpad>/<name>.bak <file> && cmp <file> <scratchpad>/<name>.bak && shasum -a 256 <file>` and re-run GREEN. Neuters to prove: (a) re-add the Decks item to `Sidebar.tsx`; (b) delete the `/decks` object from `next.config.ts` `redirects()`; (c) put `href="/portfolios"` back in `email.ts` or `ExchangesTabContent.tsx`; (d) re-add `<Disclaimer variant="footer" />` to `browse/layout.tsx`; (e) restore the density strip/`aria-label="Table density"`. Paste the RED output in the SUMMARY.

## 8. Census / test / golden moves (consolidated checklist, all `grep -a`)

Must move in the same change (details in section 1 unless noted): `phase-32-frozen-spine-guards.test.ts` (module-scope reads), `phase-150-capital-ownership-invariant.test.ts` (writers list, consumer loop, seed list), `dashboard-disclaimer-once.test.ts:118`, `critical-regressions.test.ts:35-51,204`, `limiter-ordering.test.ts:152` (stale-entry guard), `complete-status-scan.test.ts:80`, `queries.audit-2026-05-07.test.ts:1176-1232`, `display-sign-single-source.test.ts:96,121,146-158,988-1074`, `display-sign-census-misses.test.tsx`, `DashboardChrome.test.tsx:445-455,601`, `requireRolePage-wiring.test.tsx:95`, `Sidebar.test.tsx:282-293`, `env-manifest.test.ts:92`, `vitest.node-env.ts:191,256`, `eslint.config.mjs:289`, `analytics-service/tests/test_computing_started_at_stamp.py:943`, `StrategyTable.test.tsx:828-847` + `strategy-table-default-mounts.json` (by-hand edit), `factsheet-context.{codec,provider}.test`, `HeatmapPanels.tint-contrast.test.ts`, `FactsheetBody.guard04-no-bleed.test.tsx`, `AllocationsTabs.test.tsx` / `EquityChart.*` (Tweaks), `e2e/layout-narrow.spec.ts`, `e2e/full-flow.spec.ts:64-66`, `e2e/portfolio-benchmark-local.spec.ts` + `scripts/seed-portfolio-benchmark-local.ts`, `e2e/route-redirects.spec.ts`. `CHANGELOG.md` entry and the VERSION/package.json bump per the repo's ship rules (executors do not ship; flagged for the orchestrator).

**Screenshot goldens.** `e2e/svg-chart-parity.spec.ts` shoots `/factsheet/<id>/v2` (`:210`) full-page and per-panel (`e2e/svg-chart-parity.spec.ts-snapshots`, 29 PNGs); `e2e/strategy-v2-chart-parity.spec.ts` is the only other `toHaveScreenshot` spec `[VERIFIED: grep]`. Nothing 195 changes is rendered on those pages: the `DisplayMenu` is a closed `<details>` whose badge is 0 on load, the palette with `darkMode=false` is unchanged, and `/factsheet/<id>/v2` keeps its footer. **No golden is expected to change.** If CI shows a diff on them, the cause is a regression to investigate, not a re-bake: executors do not re-bake goldens (CI does, per the orchestrator). The other visible changes (Tweaks button, density strip, Decks nav, disclaimers) are on pages with no golden.

## Architecture Patterns

### Request flow after the phase
```
old URL ──► Vercel/Next redirects() (before filesystem, before proxy)
   /portfolios[/...]        ──308──► /allocations ──► proxy auth gate ──► (dashboard) allocator page
   /decks                   ──307──► /discovery/crypto-sma
   /api/portfolio-pdf/:id   ──308──► /portfolio-pdf/:id  (public, bounce-exempt) ──► retired page (no data read)
/browse ──► page: getPopulatedCategorySlugs() ──► 1 populated? redirect(/browse/<slug>) : cards
```

### Recommended edit order (disjoint plans, suggested)
1. Routes: `next.config.ts`, manifest, retired page, deletions, Exchanges/email links, route censuses, e2e redirect canary.
2. Add-to-portfolio + Decks nav + PortfolioOptimizer link (+ phase-150/phase-32 census edits; these two share the censuses with plan 1, so sequence or merge them).
3. Tweaks removal (AllocationsTabs, EquityChart, globals.css, e2e layout-narrow).
4. Dark mode + density (factsheet-context.tsx: coordinate with 193; StrategyTable + fixture).
5. `/browse` redirect + disclaimers.
6. Guard test + neuter proofs (last, depends on all).
Plans 3 and 4 touch `globals.css`: sequence them or assign disjoint line ranges.

### Anti-patterns
- Page-level `redirect()` stubs for the old routes: keeps dead page files, and `check-route-contract` Rule 1/4 then require manifest entries for stubs. Config redirects are the established, lint-enforced pattern.
- Regenerating `strategy-table-default-mounts.json` or any census instead of hand-editing (the file forbids it).
- Deleting `portfolio-analytics-adapter.ts` (live test import) or any `queries.ts` export in this phase.
- Weakening any SQL-trigger pin in `phase-150...` when trimming the writer list.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Old-URL redirects | a proxy branch or page stubs | `next.config.ts` `redirects()` + manifest `redirectFrom` | lint Rule 3 enforces lockstep; runs before the proxy |
| Comment-safe source scan | your own comment stripper | `stripCommentsPreserveLines` (`src/lib/source-scan.ts`), `stripComments`/`parseRedirectSources` (`scripts/check-route-contract.ts`) | already hardened against comment/string bypass |
| Disclaimer text | new legal sentences | `CUSTODY_TEXT`, `PROVENANCE`, `FOOTER_TEXT` in `Disclaimer.tsx` | D-09: no new legal copy |

## Common Pitfalls

1. **Module-scope `readFileSync` of a deleted file** (`phase-32-frozen-spine-guards.test.ts:184-188`) fails the whole file at import. Edit it before deleting the pages, then run it.
2. **Rule 4 STALE** if the four `/portfolios` manifest entries stay once the pages are deleted, and **Rule 3 MISSING-REDIRECT** if `redirectFrom` is not byte-identical to the `source` (`/portfolios/:path*`).
3. **`limiter-ordering` stale-entry guard** goes RED on the leftover `portfolio-pdf/[id]/route.ts` row.
4. **`/browse` redirect breaks seeded e2e** (`full-flow.spec.ts:64-66`) because the seeded DB has one category; unseeded sweeps are unaffected.
5. **`getPopulatedCategorySlugs` conflates error and empty**: redirect only on a non-empty single result (section 5); do not "fix" it here.
6. **Removing `data-strategy-table`** with the density attribute breaks e2e settle signals; keep the marker, drop only `data-density`.
7. **Sign-out purge list** (`SignOutButton.test.tsx:129`) still names `allocations.tweaks`: keep, it is cleanup.
8. **Sidebar comments** mention `/portfolios` and the literal retired route slug the frozen-spine guard substring-matches (`Sidebar.tsx:~141-147` comment note). Do not introduce the literal `href="/scenarios"` while rewording.
9. **Do not edit `supabase/**`, `.planning` ledgers, or quote PROD ids** (public repo). `next build` fails locally on the symlinked `node_modules` (not a gate).

## Code Examples

```ts
// Source: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md
{ source: "/blog/:slug*", destination: "/news/:slug*", permanent: true } // :slug* = zero or more
// Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md
// redirect() throws NEXT_REDIRECT: call it OUTSIDE try/catch.
const categories = /* filtered DISCOVERY_CATEGORIES */;
if (populatedSlugs.length > 0 && categories.length === 1) {
  redirect(`/browse/${categories[0].slug}`);
}
```

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| In-page `redirect()` stub for `/scenarios` | config-level `redirects()` (Phase 51 NAV-01) | one source of truth, lint-enforced |
| `/demo` | deleted outright (Phase 192 D-11), no redirect | not a precedent for "named landing page" |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 308 (browser-cached) is acceptable for `/portfolios` and `/api/portfolio-pdf`; `/decks` is 307 because it returns | 3 | A cached 308 survives a later un-retirement; switch to `permanent: false` |
| A2 | A non-`exception` manifest entry (`/decks`) may carry `redirectFrom` without tripping a rule | 3 | `check:route-contract` fails; fall back to an `exception` entry named differently plus a keep-page entry |
| A3 | `/portfolios/:path*` matches bare `/portfolios` in this Next version (docs show `/blog` for `:slug*`) | 3 | add an explicit `/portfolios` source and a second manifest `redirectFrom` |
| A4 | Sequencing the dark-mode edit after Phase 193's `factsheet-context.tsx` edit (or keeping the diff to the listed lines) merges cleanly | 4b | merge conflict in the one shared file |
| A5 | UC-10/11/13 UI-SPEC defaults hold (custody sentence verbatim, `FactsheetFooter` untouched, sign-up copy "model an allocation") | 6, 5 | founder rules otherwise; copy-only changes |
| A6 | Orphaned-component deletion (tier 2) is wanted in this phase rather than deferred | 2 | wasted effort or leftover dead code; defer-safe |

## Open Questions

1. **`/browse` zero-populated behavior.** UI-SPEC/CONTEXT say "zero → existing empty state"; at HEAD zero and error both render all five cards and the empty line is dead. Recommendation: leave as is, redirect only on exactly one; report to founder.
2. **Query forwarding on `/portfolios/.../manage?add=` redirects.** Config redirects forward the query; the spec says dropped. Harmless today (`/allocations` ignores `add`); accept and record.
3. **Delete orphan `view-transition.ts`?** No caller after the density strip goes; optional.

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| node | all | yes, `v25.8.1` | engines `>=22` |
| vitest, tsc | validation | yes (`node_modules/.bin`, symlinked checkout) | |
| playwright browsers / seeded Supabase | e2e | not exercised here | e2e is CI-only; unseeded canary needs no DB |
| `next build` | — | fails locally on symlinked `node_modules` | not a gate (orchestrator) |
| python venv for `analytics-service` pytest | census edit | not checked | run pytest only from `analytics-service/` |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (jsdom + node projects via `vitest.node-env.ts`), Playwright for e2e |
| Config | `vitest.config.ts`, `vitest.node-env.ts`, `playwright.config.ts` |
| Quick run | `npx vitest run <file>` |
| Full suite | `npx vitest run` (2 known pre-existing failures in `compute.conventions.test.ts`) |
| Static gates | `npx tsc --noEmit`; `npm run lint` (eslint + `check-admin-route-manifest` + `check-route-contract` + `check-planning-hygiene` + `check-canonical-domain`) |

### Phase Requirements to Test Map
| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|--------------|
| LEAN-03 | `/portfolios*`, `/decks`, `/api/portfolio-pdf` redirect; manifest and lockstep valid | lint + unit | `npm run check:route-contract` ; `npx vitest run src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.ts` | guard test new (Wave 0) |
| LEAN-03 | retired page renders for any id, no session, no data read | unit | `npx vitest run "src/app/portfolio-pdf/[id]/page.test.tsx"` | new (Wave 0) |
| LEAN-03 | no link to removed routes; Decks absent from nav | unit | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx src/__tests__/trim-removed-surfaces.test.ts` | edit |
| LEAN-03 | OWN-03 invariant intact after writer removal | unit | `npx vitest run src/__tests__/phase-150-capital-ownership-invariant.test.ts src/__tests__/phase-32-frozen-spine-guards.test.ts` | edit |
| LEAN-07 | Tweaks gone, defaults only | unit | `npx vitest run "src/app/(dashboard)/allocations"` | edit |
| LEAN-07 | dark option gone, `?dark=1` ignored | unit | `npx vitest run "src/app/factsheet/[id]/v2"` | edit |
| LEAN-07 | density strip gone, fixture pin | unit | `npx vitest run src/components/strategy/StrategyTable.test.tsx src/components/strategy/StrategyTable.default-mounts.test.tsx src/components/strategy/StrategyTable.prefs-applied.test.tsx` | edit |
| LEAN-07 | `/browse` redirect rule | unit | `npx vitest run src/app/browse` | new (Wave 0) |
| LEAN-07 | one disclaimer per page | unit | `npx vitest run src/components/ui/Disclaimer.test.tsx src/__tests__/dashboard-disclaimer-once.test.ts "src/app/factsheet/[id]/tearsheet" "src/app/browse"` | edit |
| LEAN-03/07 | runtime redirects and retired page, a11y/reflow | e2e (CI only) | `e2e/route-redirects.spec.ts`, public sweeps | edit |
| census | Python TS-write census | pytest | `cd analytics-service && python -m pytest tests/test_computing_started_at_stamp.py -q` | edit |

### Sampling Rate
- Per task commit: the targeted vitest files above plus `npx tsc --noEmit`.
- Per wave merge: `npm run lint` and `npx vitest run src/__tests__ src/lib "src/app/(dashboard)"`.
- Phase gate: full `npx vitest run` (only the 2 known failures allowed), `npm run lint`, `npx tsc --noEmit`, then the neuter-RED-restore proofs.

### Wave 0 Gaps
- [ ] `src/__tests__/trim-removed-surfaces.test.ts` (D-10)
- [ ] `src/app/portfolio-pdf/[id]/page.test.tsx` (retired page: any id, no session, metadata noindex)
- [ ] `src/app/browse/page.test.tsx` (0/1/2+ populated, failed read)
- [ ] `Disclaimer.test.tsx` case for the combined variant
- [ ] email href assertion in a new or existing email test

## Security Domain

### Applicable ASVS Categories
| ASVS | Applies | Control |
|------|---------|---------|
| V4 Access Control | yes | retired page is public by design and reads nothing; `/allocations` keeps its role gate; keep `/portfolio-pdf` in `PUBLIC_ROUTES` and **do not** add `/api/portfolio-pdf` (the config hop makes it unnecessary) |
| V5 Input Validation | yes | `<id>` is never read; no `renderToken`; static redirect destinations (no open redirect, no user-controlled `Location`) |
| V6 Cryptography | no | `pdf-render-token` (HMAC) is deleted, not changed |
| V2/V3 | no | no auth/session changes |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Open redirect via `:id`/`:path*` | Tampering | destinations are fixed strings; `:id` is only appended to a same-origin `/portfolio-pdf/` path |
| Stale IDOR surface left behind | Info disclosure | the admin-client PDF page and render-token verifier are deleted; the guard asserts no `createAdminClient` in the retired page |
| Anonymous exposure of a private route | Elevation | `check-route-contract` Rule 5 stays green: do not widen `PUBLIC_ROUTES` |
| Removing a legally required sentence | Repudiation | combined block composed from the three existing constants; pinned verbatim in `Disclaimer.test.tsx` |

## Sources

### Primary (HIGH)
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/redirects.md`, `.../04-functions/redirect.md` (this checkout)
- In-repo files read this session: `next.config.ts`, `src/proxy.ts`, `src/lib/routing/route-contract-manifest.ts`, `scripts/check-route-contract.ts`, `src/components/ui/Disclaimer.tsx`, `src/app/browse/{page,layout}.tsx`, `src/lib/queries.ts:1265-1296`, `e2e/route-redirects.spec.ts`, `src/__tests__/dashboard-disclaimer-once.test.ts`, the Phase 192 merge diff (`git show 671d2f755`), the census tests cited above.

### Secondary / Tertiary
- None. All claims not tagged `[ASSUMED]`/`[CITED]` were confirmed by reading or grepping this worktree at HEAD.

## Metadata

**Confidence:** inventory HIGH; mechanism HIGH (precedent read, doc cited); component classification HIGH for file-level reachability, MEDIUM for tier-2 test-edit scope (not every dependent test was opened); guard design HIGH.
**Research date:** 2026-11-07. **Valid until:** until any of `next.config.ts`, the manifest, `Sidebar.tsx`, or Phase 193's `factsheet-context.tsx` changes on `main`.
