---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
reviewed: 2026-11-11T18:50:06Z
depth: standard
diff_range: 19353fd1f..HEAD (feat/201-plainwords, head 9f7a8aeca), excluding .planning
severity_floor: MEDIUM
files_reviewed: 168
files_reviewed_list:
  - "e2e/helpers/discovery-selectors.ts"
  - "eslint.config.mjs"
  - "scripts/copy-census/policy.ts"
  - "scripts/copy-census/run.ts"
  - "scripts/copy-census/scan.ts"
  - "src/app/(dashboard)/admin/compute-jobs/page.tsx"
  - "src/app/(dashboard)/admin/csv-status/page.tsx"
  - "src/app/(dashboard)/admin/deletion-requests/page.tsx"
  - "src/app/(dashboard)/admin/intros/page.tsx"
  - "src/app/(dashboard)/admin/page.tsx"
  - "src/app/(dashboard)/admin/users/[id]/page.tsx"
  - "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx"
  - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
  - "src/app/(dashboard)/allocations/HoldingsTabPanel.tsx"
  - "src/app/(dashboard)/allocations/MandateTabPanel.tsx"
  - "src/app/(dashboard)/allocations/ScenarioStub.tsx"
  - "src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx"
  - "src/app/(dashboard)/allocations/components/BridgeDrawer.tsx"
  - "src/app/(dashboard)/allocations/components/BridgeOutcomeBanner.tsx"
  - "src/app/(dashboard)/allocations/components/BridgeWidget.tsx"
  - "src/app/(dashboard)/allocations/components/CustomRangePicker.tsx"
  - "src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx"
  - "src/app/(dashboard)/allocations/components/GlancePanel.tsx"
  - "src/app/(dashboard)/allocations/components/HoldingDetail.tsx"
  - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
  - "src/app/(dashboard)/allocations/components/KpiStrip.tsx"
  - "src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx"
  - "src/app/(dashboard)/allocations/components/OnboardingBanner.tsx"
  - "src/app/(dashboard)/allocations/components/OptimizerPanel.tsx"
  - "src/app/(dashboard)/allocations/components/SavedScenariosList.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx"
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
  - "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx"
  - "src/app/(dashboard)/allocations/components/StressVarSection.tsx"
  - "src/app/(dashboard)/allocations/components/WatchlistPanel.tsx"
  - "src/app/(dashboard)/allocations/hooks/useScenarioState.ts"
  - "src/app/(dashboard)/allocations/lib/add-allocation.ts"
  - "src/app/(dashboard)/allocations/lib/book-figures.ts"
  - "src/app/(dashboard)/allocations/lib/dust.ts"
  - "src/app/(dashboard)/allocations/lib/holdings-adapter.ts"
  - "src/app/(dashboard)/allocations/lib/live-holdings-summary.ts"
  - "src/app/(dashboard)/allocations/lib/scenario-state.ts"
  - "src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts"
  - "src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx"
  - "src/app/(dashboard)/allocations/widgets/intelligence/RegimeDetector.tsx"
  - "src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx"
  - "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx"
  - "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx"
  - "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx"
  - "src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx"
  - "src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx"
  - "src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx"
  - "src/app/(dashboard)/discovery/[slug]/page.tsx"
  - "src/app/(dashboard)/recommendations/page.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx"
  - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"
  - "src/app/(dashboard)/strategies/page.tsx"
  - "src/app/(marketing)/for-quants/page.tsx"
  - "src/app/(marketing)/legal/disclaimer/page.tsx"
  - "src/app/(marketing)/security/page.tsx"
  - "src/app/api/admin/match/preferences/[allocator_id]/route.ts"
  - "src/app/api/admin/match/send-intro/route.ts"
  - "src/app/api/alerts/critical/route.ts"
  - "src/app/api/allocator/scenario/commit/route.ts"
  - "src/app/api/allocator/scenario/share/route.ts"
  - "src/app/api/bridge/route.ts"
  - "src/app/api/cron/founder-lp-report/route.ts"
  - "src/app/api/og/factsheet/[id]/route.tsx"
  - "src/app/api/portfolio-alerts/route.ts"
  - "src/app/api/portfolio-strategies/alias/route.ts"
  - "src/app/api/portfolio-strategies/allocation/route.ts"
  - "src/app/api/preferences/route.ts"
  - "src/app/api/simulator/route.ts"
  - "src/app/api/strategies/[id]/name/route.ts"
  - "src/app/api/strategies/browse/route.ts"
  - "src/app/factsheet/[id]/tearsheet/page.tsx"
  - "src/app/factsheet/[id]/trade-fetch-lines.tsx"
  - "src/app/factsheet/[id]/v2/AnalyticalPanels.tsx"
  - "src/app/factsheet/[id]/v2/BatchDPanels.tsx"
  - "src/app/factsheet/[id]/v2/DistributionPanels.tsx"
  - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
  - "src/app/factsheet/[id]/v2/HeatmapPanels.tsx"
  - "src/app/factsheet/[id]/v2/MandatePanels.tsx"
  - "src/app/factsheet/[id]/v2/MetricsColumn.tsx"
  - "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx"
  - "src/app/factsheet/[id]/v2/basis-context.tsx"
  - "src/app/factsheet/[id]/v2/page.tsx"
  - "src/app/portfolio-pdf/[id]/page.tsx"
  - "src/app/scenario-share/[token]/page.tsx"
  - "src/app/scenario-share/[token]/share-resolve.ts"
  - "src/components/admin/AdminTabs.tsx"
  - "src/components/admin/AllocatorMatchQueue.tsx"
  - "src/components/admin/CandidateDetail.tsx"
  - "src/components/admin/ComputeJobsTable.tsx"
  - "src/components/admin/ForQuantsLeadsTable.tsx"
  - "src/components/admin/MatchEvalDashboard.tsx"
  - "src/components/admin/PreferencesPanel.tsx"
  - "src/components/admin/SendIntroPanel.tsx"
  - "src/components/admin/match/ModeBadge.tsx"
  - "src/components/admin/match/ShortlistCard.tsx"
  - "src/components/auth/DeleteAccountButton.tsx"
  - "src/components/auth/ProfileTabs.tsx"
  - "src/components/contact/ContactPointerText.tsx"
  - "src/components/deck/DeckCard.tsx"
  - "src/components/discovery/SimulateImpactButton.tsx"
  - "src/components/error/ErrorEnvelope.tsx"
  - "src/components/exchanges/AllocatorExchangeManager.tsx"
  - "src/components/exchanges/ExchangesTabContent.tsx"
  - "src/components/kpi/KpiPanel.tsx"
  - "src/components/landing/VerificationResults.tsx"
  - "src/components/layout/MobileNav.tsx"
  - "src/components/layout/Sidebar.tsx"
  - "src/components/mandate/MandateForm.tsx"
  - "src/components/mandate/MandateSlider.tsx"
  - "src/components/org/OrganizationTab.tsx"
  - "src/components/portfolio/CorrelationHeatmap.tsx"
  - "src/components/portfolio/InsightStrip.tsx"
  - "src/components/portfolio/PortfolioImpactPanel.tsx"
  - "src/components/portfolio/PortfolioOptimizer.tsx"
  - "src/components/portfolio/ReplacementCard.tsx"
  - "src/components/portfolio/ReplacementPanel.tsx"
  - "src/components/strategy/ApiKeyManager.tsx"
  - "src/components/strategy/CompareEquityOverlay.tsx"
  - "src/components/strategy/CompareTable.tsx"
  - "src/components/strategy/CustomizeDrawer.tsx"
  - "src/components/strategy/EmptyWatchlist.tsx"
  - "src/components/strategy/FactsheetPreview.tsx"
  - "src/components/strategy/FreshnessBadge.tsx"
  - "src/components/strategy/HoldingFactsheet.tsx"
  - "src/components/strategy/ManagerIdentityPanel.tsx"
  - "src/components/strategy/PendingIntros.tsx"
  - "src/components/strategy/RequestIntroButton.tsx"
  - "src/components/strategy/StaleSeriesChip.tsx"
  - "src/components/strategy/StrategyFilters.tsx"
  - "src/components/strategy/StrategyGrid.tsx"
  - "src/components/strategy/StrategyHeader.tsx"
  - "src/components/strategy/StrategyTable.tsx"
  - "src/components/strategy/SyncProgress.tsx"
  - "src/components/strategy/WatchlistTabs.tsx"
  - "src/components/strategy/discovery-columns.ts"
  - "src/components/ui/CollapsibleSection.tsx"
  - "src/components/ui/Term.tsx"
  - "src/components/ui/Tooltip.tsx"
  - "src/lib/admin/match.ts"
  - "src/lib/allocation-helpers.ts"
  - "src/lib/auth-types.ts"
  - "src/lib/capital-ownership.ts"
  - "src/lib/contact.ts"
  - "src/lib/degrade-warnings.ts"
  - "src/lib/display-labels.ts"
  - "src/lib/email.ts"
  - "src/lib/factsheet/allocator-portfolio-payload.ts"
  - "src/lib/factsheet/build-payload.ts"
  - "src/lib/factsheet/fetch-and-build-payload.ts"
  - "src/lib/factsheet/joint.ts"
  - "src/lib/factsheet/returns-unit.ts"
  - "src/lib/glossary.ts"
  - "src/lib/portfolio-insights.ts"
  - "src/lib/queries.ts"
  - "src/lib/strategy-display.ts"
  - "src/lib/utils.ts"
  - "src/lib/visibility.ts"
  - "src/lib/wizardErrors.ts"
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
  necessity: 0
status: issues_found
---

# Phase 201: Code Review Report

**Reviewed:** 2026-11-11T18:50:06Z
**Depth:** standard, weighted to the six focus areas in the brief
**Files Reviewed:** 168 non-test source files (`git diff 19353fd1f..HEAD -- . ':!.planning'`, with tests, snapshots, fixtures and `TODOS.md` taken out)
**Status:** issues_found
**Severity floor:** MEDIUM. LOW and INFO were not recorded, as the brief asked.

## Summary

I found no CRITICAL or HIGH defect. There are two MEDIUM findings, and both are user-facing. Neither touches data integrity.

**Coverage, stated plainly.** I read the files behind the six focus areas in full or close to it. I traced the copy-only diffs (renamed nouns, `formatDay` swaps) by their changed lines, not by reading each whole file. Those files are in the list above, but they were not read line by line. I did not run any test. Every claim below comes from reading source.

**Focus 1, name resolver and `redactedName` narrowing: no leak found.** I checked every non-test caller of `displayStrategyName` and `publicNamePreview`.
- `isDiscoveryVisible` (`src/lib/visibility.ts:182`) is `status === 'published'` OR the viewer's own row. It fails closed on a missing column or viewer id. Discovery's predicate is `withPublishedOnly` = `.eq("status","published")` (`visibility.ts`; `getStrategiesByCategory` in `queries.ts`), so the two agree. The extra category filter in discovery is navigation, not visibility.
- Each `{ visible: true }` site sits behind a published-only or owner-only read that I opened:
  - `getFactsheetDetail` → `withPublishedOnly` (`queries.ts:1722`)
  - the OG read → `withPublishedOnly`
  - v2 `generateMetadata` → `withPublishedOnly`
  - the v2 signature gate → `withPublishedOnly`, then `withPublishedOrOwner`, else `notFound()`
  - the flagged-candidate read → `withPublishedOnly` (`queries.ts:5624`)
  - the `PendingIntros` loader → `.in("strategy_id", strategyIds)`, where the ids come from `.eq("user_id", user.id)` (`strategies/page.tsx`)
  - `getOwnCapitalStrategies` → owner-only
  - the My allocation row adapters → read the payload that `redactedName` has already nulled
- `queries.ts` now selects `status` and `user_id` on all three service-role embeds, and strips both before the payload ships.
- The admin surfaces pass `isDiscoveryVisible(row, null)`, so only a published row is named. All five admin embeds now select `status`.
- The browse route keeps `withPublishedOrOwner` on the user-scoped client and adds a per-row guard.
- The token lane (`factsheet-share`) still names an unpublished strategy. It did that before this phase too (`strategy.name ?? …`), and `fetch-and-build-payload.ts:1006-1013` records it as accepted under D-17.
- `organization_name` keeps its tier rule (unchanged).

**Focus 2, date helper:** `formatDay`, `formatMonth` and `formatDayTime` (`src/lib/utils.ts`) read UTC fields only and return `—` for null, empty or unparseable input. Callers that hold a local-midnight `Date` build their input with `Date.UTC(...)` (`CustomRangePicker.tsx`). Callers that might call `toISOString()` on an invalid date guard with `Number.isFinite` first (`FreshnessBadge.tsx`, `SavedScenariosList.tsx`). The helper itself is sound. The gap is coverage and the gate: see WR-01.

**Focus 3, Term and Tooltip:** Form A (`Term.tsx`) is one `tabIndex=0` span, with `aria-describedby` on that span. Under `PlainTerms` it renders as plain text. The tearsheet route test proves the print view carries no `[data-term]`, and it includes a control arm that can fail (`tearsheet/page.test.tsx:502-532`). I found no `Term` nested inside a button, link, summary or tab, either in the same render scope (AST scan of all 37 `Term` files) or in the prop- and const-passed cases I spot-checked (`recommendations/page.tsx` `Metric`, `StrategyBrowseDrawer` `TIER_COPY`, the `PortfolioImpactPanel` chip, the `FactsheetPreview` mounts). Tabs, nav and chart radios put `aria-describedby` on the control. One Form B site is hover-only: see WR-02.

**Focus 4, Escape:** `StrategyFilters.tsx` adds a document `keydown` listener only while the panel is open. It skips `defaultPrevented`, claims the key, discards the draft and restores focus. `StrategyFilters.test.tsx:67-143` covers closing, the nested-handled case, other keys, draft discard and focus return after both Escape and Close.

**Focus 5, gate vacuity:** The census judge, the stale-row check, the both-direction pin on the exception list and the planted-tree arms can all fail. Rule C has a real blind spot, though (WR-01). Rule A skips a bare string attribute outside its 12 copy names. I found no live retired word in such an attribute, so that is not recorded.

**Focus 6, API strings and codes:** In every changed route, only the `error` sentence changed. `code` values are byte-identical (`PORTFOLIO_NOT_FOUND`, `UPSTREAM_TIMEOUT`, `DASHBOARD_ROW_STALE`, …). I found no client, e2e spec or Python module matching the old sentences.

**Process notes.** `.claude/skills/` and `.agents/skills/` do not exist in this checkout. I read `necessity-review.md`. No necessity finding reaches MEDIUM.

## Warnings

### WR-01: F-11 date rule incomplete: the public factsheet still prints raw `YYYY-MM-DD`, and rule C cannot see that form

**Severity:** MEDIUM · **User-facing:** yes · **Data-integrity:** no

**File:** `src/app/factsheet/[id]/v2/StressWindowsPanel.tsx:134` (also `src/components/admin/UserRolesPanel.tsx:37-41` used at `:152`, and `scripts/copy-census/scan.ts:397-418`)

**Evidence:**
```tsx
// StressWindowsPanel.tsx:133-135 (rendered by FactsheetView.tsx:846)
<td className="py-1.5 px-2 font-mono tabular-nums text-text-2 whitespace-nowrap">
  {w.start.slice(0, 10)} → {w.end.slice(0, 10)}
</td>
```
```ts
// UserRolesPanel.tsx:37-41: "Granted 2026-04-16" in the admin user page
function formatGrantDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
```
`201-RESEARCH.md:351` lists both lines as `YYYY-MM-DD` sites to move onto the helper. No plan or SUMMARY records them as moved or deferred: `201-09-SUMMARY.md` owns `StressWindowsPanel` and says nothing about its dates. Rule C (`scan.ts:397-418`) matches only these forms: `toLocaleDateString`, a dated `toLocaleString`, `Intl.DateTimeFormat`, a three-month-name array, and the two retired helper names. A `.slice(0, 10)` or `toISOString().slice(...)` print gets past it. So the census reads zero while these sites remain. Two chart tooltip label formatters print the same ISO form too: `widgets/positions/NetExposureChart.tsx:186` and `widgets/allocation/AllocationOverTime.tsx:227`. D-21 exempts axis ticks, not tooltip labels.

**Why it matters:** F-11 (founder-confirmed) says dates read "Nov 12, 2026" through one helper, with ISO kept only in CSV and exports. The public factsheet's Stress windows table breaks that, next to factsheet tables that now print "Oct 9, 2026". D-11 also promises "a test goes RED on a new non-helper date format in user-visible code". For the ISO-slice form, that promise has no mechanism behind it, so the next such site will pass the census as well.

**Fix:**
```tsx
// StressWindowsPanel.tsx
import { formatDay } from "@/lib/utils";
{formatDay(w.start)} → {formatDay(w.end)}
```
```ts
// UserRolesPanel.tsx
import { formatDay } from "@/lib/utils";
// replace formatGrantDate(...) with formatDay(grantInfo.granted_at)
```
For the two chart tooltips, use `labelFormatter={(ms) => formatDay(new Date(Number(ms)).toISOString())}`. Guard non-finite `ms` first, because `toISOString` throws on `NaN`. Alternatively, record them in `EXCEPTIONS` with a reason, if a tooltip label is meant to count as an axis tick.

Then give rule C one more matcher: a call to `.slice(0, 10)` or `.slice(0, 7)` whose receiver is a `toISOString()` call, or which sits in JSX text or template position. Give it a planted red arm in `scan.test.ts`, and record the machine-value sites (file names, `<input type="date">` values, keys) as `machine value (D-11)` exceptions.

### WR-02: Returns Signatures definition is hover-only: keyboard and screen-reader users cannot reach it

**Severity:** MEDIUM · **User-facing:** yes (accessibility) · **Data-integrity:** no

**File:** `src/components/ui/CollapsibleSection.tsx:147-166`; its only caller is `src/app/factsheet/[id]/v2/FactsheetView.tsx:861-864` (`term="returns_signature"`)

**Evidence:**
```tsx
<summary className="... focus-visible:outline-accent ...">      {/* the focusable control */}
  ...
  <h2 ...>
    {term ? (
      <Tooltip content={termDefinition(term)} className="inline">  {/* onFocus lives here */}
        {title}
      </Tooltip>
    ) : title}
  </h2>
```
Keyboard focus lands on `<summary>`. `Tooltip`'s `onFocus`/`onBlur` sit on a span inside it, and focus events go up from the focused element to its ancestors, not down to its children. So focusing the summary never opens the bubble. `aria-describedby` goes on the inner node-child span (`Tooltip.tsx:198-199`), not on the summary, so a screen reader announces no definition either. The only test proves the mouse path alone (`FactsheetView.terms.test.tsx:165-176`: `fireEvent.mouseEnter`). `returns_signature` has no other trigger anywhere in `src` (its only reference is `FactsheetView.tsx:864`), so a keyboard user has no route to this registered definition.

**Why it matters:** The UI-SPEC's States table (Interaction contract 1) says a trigger opens its bubble on "Keyboard focus", and F-10 makes "a registered term without its tooltip" a gate failure. The phase's other Form B sites handle this correctly: `AllocationsTabs.tsx:917-923`, `ProfileTabs.tsx:127-133`, `MobileNav.tsx`, and the `EquityChart`/`DrawdownChart` radios. Each uses the function-child form, which puts `aria-describedby` on the control. This one does not, and `StrategyGrid.tsx:244-251` records its own hover-only case with a keyboard alternative. A census can only check the source: rule B accepts the `term` prop here, and the census also carries a `Returns Signatures` exception for `FactsheetView.tsx`. So the gate passes while the definition stays hover-only.

**Fix:** Use the same function-child pattern as the tabs. Move the `Tooltip` so it wraps the `<summary>` and receives its `aria-describedby`, or attach the handlers to the summary itself:
```tsx
const summary = (describedBy?: string) => (
  <summary aria-describedby={describedBy} className="...">...{title}...</summary>
);
return (
  <details ...>
    {term ? (
      <Tooltip content={termDefinition(term)} className="contents [&>span]:contents">
        {({ "aria-describedby": d }) => summary(d)}
      </Tooltip>
    ) : summary()}
    ...
```
Check that `<summary>` stays the first child of `<details>`. If a wrapper span would break that, put `onFocus`/`onBlur`/`aria-describedby` on the summary directly and render the bubble from a small hook. Add a test arm that focuses the summary (`fireEvent.focus(summary)`), advances 150ms, and expects the `role="tooltip"` text plus `summary.getAttribute("aria-describedby")` equal to the bubble's id. Show that arm going RED against the current file before keeping it.

---

_Reviewed: 2026-11-11T18:50:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter findings (round 1, added by the orchestrator)

### SFH-01: `{ visible: true }` is an unchecked literal claim at 14 call sites (MEDIUM, privacy guard / test quality)

**Files:** `src/lib/allocation-helpers.ts:41`, `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts:242,290`, `src/app/(dashboard)/allocations/lib/holdings-adapter.ts:229`, `src/lib/queries.ts:5657`, `src/lib/strategy-display.ts:61-62`, `src/lib/factsheet/fetch-and-build-payload.ts:1014`, `src/app/factsheet/[id]/v2/page.tsx:752`, `src/app/factsheet/[id]/tearsheet/page.tsx:45,191`, `src/app/api/og/factsheet/[id]/route.tsx:180`, `src/components/strategy/PendingIntros.tsx:157`.
**Issue:** the `displayStrategyName` docblock says a missing visibility fact "can only withhold a name, never print one", but these sites hard-code `true`, justified only in comments. A future site passing `visible: true` over an unpublished or service-role read would print a hidden strategy's name and nothing would go red. The token-lane exception (pre-existing behaviour, kept under D-17) is not named in the docblock.
**Fix (minimal):** one test that scans non-test files under `src/` for the `visible: true` literal passed to `displayStrategyName` and pins the exact set of files (a new site becomes a reviewed change); shown RED by planting a site. One docblock line naming the token-lane exception.

### SFH-02: admin row types make `status` optional, so a select that drops it silently shows codenames to staff (MEDIUM, staff-facing)

**Files:** `src/components/admin/AdminTabs.tsx:265`, `src/components/admin/AllocatorMatchQueue.tsx:671,763,842`, `src/components/admin/SendIntroPanel.tsx:159`, `src/components/admin/match/ShortlistCard.tsx:48`, `src/components/admin/CandidateDetail.tsx:56` (row types with `status?: string | null`).
**Issue:** `isDiscoveryVisible` fails closed without a signal; an edited admin select missing `status` would show `Strategy #…` for a published strategy.
**Fix (minimal):** make `status` required (`status: string | null`) in the admin row types those call sites use, so omitting it is a compile error. No runtime change.


## Round 2

**Reviewed:** 2026-11-11 · **Scope:** `git diff 8a6849e72..HEAD -- . ':!.planning'` (merges `c09dc614e` SFH-01/SFH-02 and `76638ca93` WR-01/WR-02), 17 files · **Severity floor:** MEDIUM · **Reviewer:** Claude (gsd-code-reviewer)

**What was run.** The commands below ran against the review worktree, read-only:
- the eight fix test files plus `src/components/ui/` and `src/__tests__/copy-census.test.ts`: 23 files, 267 tests, all green
- `tsc --noEmit`: clean
- `eslint` on the changed sources: clean
- `copy-census --summary`: `A=0 B=0 C=0`, 35 exceptions, 0 `iso-slice` hits

**Can-fail proofs.** These ran in a throwaway `git archive HEAD` copy in the scratchpad, with `node_modules` symlinked, and never in the worktree. I undid each fix and watched its test go RED:
- `StressWindowsPanel` back to `.slice(0, 10)`: RED
- `UserRolesPanel` back to `toISOString().slice(0, 10)`: RED
- `onFocus` and `onBlur` taken off the summary: the WR-02 arm goes RED
- one chart `labelFormatter` reverted: `copy-census.test.ts` goes RED, and the scan names `NetExposureChart.tsx:186` as an `iso-slice` hit. The two charts have no render test, so this gate is their only cover.
- a `displayStrategyName(…, { visible: true })` call planted in `src/lib/visibility.ts`: the SFH-01 pin goes RED

### Verdicts on round-1 findings

| id | verdict | basis |
|---|---|---|
| WR-01 | **Resolved for the named sites. The class is NOT closed (see R2-02).** | All four named sites now go through `formatDay`, each has a test that can fail, and the new `iso-slice` matcher catches every original form. The matcher only sees a slice at the point it is printed, and only lengths 10 and 7, so it misses ISO dates printed through a variable or a field. Live residuals remain on user-facing surfaces. |
| WR-02 | **Resolved, with one new defect (R2-01).** | Keyboard focus on `<summary>` opens the bubble. The summary carries `aria-describedby` while the bubble is open, and the summary stays the direct child of `<details>`. The test asserts all three and goes RED without the fix. |
| SFH-01 | **Resolved.** | `strategy-display.test.ts` pins the exact set of files and counts that pass the literal `visible: true`, and goes RED on a planted site. The docblock now names the token-lane exception. |
| SFH-02 | **NOT resolved (R2-03).** | Making `status` required does not make "a select that omits it fails to compile" true. I proved this: the build stays clean with `status` taken out of every admin embed. |

**Was the `useTooltip` extraction necessary for WR-02? Yes, it is justified.** `git diff --color-moved` shows a pure move: the state, timers, layout effect and portal are unchanged, `Tooltip` keeps its old markup, and the existing `Tooltip` and `Term` tests stay green. Each smaller option fails:
- Wrapping the title in `Tooltip` (the round-1 code) cannot see focus on its ancestor `<summary>`.
- Wrapping `<details>` in `Tooltip` breaks two things. Focus on any control in the section body would bubble up and open the definition, and the bubble would anchor to the whole section.
- A `Tooltip` around the `<summary>` would stop it being the first child of `<details>`.
- `Tooltip` had no way to be opened from outside, and copying its roughly 40 lines of state and portal into `CollapsibleSection` would add more code than the move does.

This is not a new abstraction. It is the existing one with its trigger markup split off.

**Chart `labelFormatter`:** `formatDay(new Date(Number(ms)).toISOString())` still throws on a non-finite `ms`. The pre-fix `.toISOString().slice(0, 10)` threw in the same way, and recharts calls `labelFormatter` only with a non-nil label. This is not a new defect, so it is not raised.

**Required `status` admin types:** these compile, and the only producers that had to change were two test fixtures (`status: null`). That is the evidence behind R2-03: test fixtures are the only producers the type actually checks.

### R2-01: Clicking the Returns Signatures summary pins the definition bubble open until focus leaves

**Severity:** MEDIUM · **User-facing:** yes (the public factsheet) · **Data-integrity:** no
**File:** `src/components/ui/CollapsibleSection.tsx:151-154` and `:169-174`

**Evidence:** The fix puts `onFocus={show}` / `onBlur={hide}` on the `<summary>`. It leaves `onMouseLeave={hide}` on the inner title `<span>` only. The summary is a full-width flex row with the chevron, the title and the "Show"/"Hide" label. Chrome and Firefox focus a `<summary>` on mouse click. So a user who clicks the row outside the title, for example on "Show", gets the bubble 150 ms later. It then stays open: no mouseleave handler covers that pointer path, and only a blur closes it. While it is open, the scroll listener (`Tooltip.tsx:186`) keeps re-anchoring it to the title. When the title nears the top of the viewport, the bubble flips below the title and covers the top of the section the user just expanded. `pointer-events-none` stops it blocking clicks, not reading.

The existing triggers do not do this. The tabs and chart radios use the `Tooltip` wrapper, where the element that takes focus is inside the element that has `onMouseLeave`, so moving the pointer away closes a bubble opened by a click.

jsdom cannot show this, because it does not move focus on a synthetic click. The claim rests on browser focus-on-click behaviour; Safari does not focus a summary on click and is unaffected.

**Minimal fix:** close the bubble when the pointer leaves the summary, matching the wrapper's semantics. Add one prop to the summary:
```tsx
onMouseLeave={term ? hide : undefined}
```
The title span can keep its own `onMouseEnter`/`onMouseLeave`. Keyboard focus never fires mouseleave, so the WR-02 path is unchanged.

### R2-02: F-11 residuals: raw `YYYY-MM-DD` still printed on user-facing surfaces, through indirection the new matcher cannot see

**Severity:** MEDIUM · **User-facing:** yes (the public factsheet, My allocation, the scenario composer, the wizard), plus staff-facing admin pages · **Data-integrity:** no

**Evidence:** Each site below prints an ISO day or timestamp that has passed through a variable or a field. `isIsoSliceDisplay` (`scripts/copy-census/scan.ts:363-382`) only fires when the `.slice(0, 10|7)` call itself is in JSX-text, `labelFormatter` or `format*`-return position, so the census reads zero for all of them. UI-SPEC `:602` puts chart hover tooltips and heatmap cell titles inside the rule (U-15), and D-21 says a time stamp uses the day format followed by the time.
- `src/app/factsheet/[id]/v2/HeatmapPanels.tsx:472` builds `iso = dt.toISOString().slice(0, 10)`, and `:633` renders `{reveal.iso}` in the daily heatmap's hover/tap reveal. This is the **public factsheet**, in a file plan 201-10 edited for "factsheet dates through formatDay".
- `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx:55-57` prints `as of ${snapshot.asof}`. Tests pin the ISO output: `ExposureByClass.test.tsx:136` `"as of 2026-10-03"` and `HoldingsTabPanel.exposure.test.tsx:161`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5936` prints `${coverageWindow.start} → ${coverageWindow.end}`, pinned by `ScenarioComposer.test.tsx:8790` as `"2026-01-01 → 2026-01-06"`. `:7058-7072` prints the "Include → moves window start to {target.start}" dates.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:2976` prints `{gap.start} → {gap.end}` in the coverage-gap list.
- Staff-facing:
  - `src/app/(dashboard)/admin/intros/page.tsx:218` prints `createdAtLabel = toISOString().slice(0, 16).replace("T", " ")`, which reads `2026-04-16 12:30` against D-21. Phase 201 touched this file (plan 31).
  - `src/app/(dashboard)/admin/usage/page.tsx:128` prints `{row.day}`.
- To check before fixing (they may fall under the axis-tick exemption, or may be SVG `<title>` hover text that the UI-SPEC puts inside the rule): `CoverageTimeline.tsx:176-177`, `TimeSeriesChart.tsx:373,412`, `widgets/lib/chart-gaps.tsx:113`.

**Why it matters:** round 1's thesis was that the census reads zero while ISO prints remain. That is still true, just for a different syntactic form. The matcher's own docblock admits it cannot see "a date that reaches the screen through a helper with a neutral name". D-11's "a test goes RED on a new non-helper date format" is therefore still only partly backed by a mechanism.

**Minimal fix:**
- Wrap each listed render in `formatDay` (or `formatDayTime` for the intros timestamp) and update the tests that pin ISO output to the helper's form.
- Leave the matcher as it is: making it follow data flow would be a new abstraction. Record any deliberate machine-value or axis case as a `machine value (D-11)` or axis exception in `policy.ts`.

### R2-03: SFH-02's required `status` is not enforced by any production producer, and the new comment says it is

**Severity:** MEDIUM · **User-facing:** no (staff-facing, the same as round 1) · **Data-integrity:** no
**File:** `src/components/admin/AdminTabs.tsx:56-57`, `src/components/admin/AllocatorMatchQueue.tsx:69-70,137`. The producers are `src/app/(dashboard)/admin/page.tsx:37` and `src/lib/admin/match.ts:168,191,235`.

**Evidence:** `createAdminClient()` is untyped (`src/lib/supabase/admin.ts:18`).
- The intro rows are asserted with `.returns<IntroRequestRow[]>()`. In postgrest-js, `returns<>` only runs `CheckMatchingArrayTypes`, which checks array against single row and never checks selected columns against the type.
- The candidate and decision rows go through `castRows<Record<string, unknown>>` (a bare `as T[]`, `src/lib/supabase/cast.ts:33-36`) and then over HTTP into `AllocatorMatchQueue` via `res.json()`, which is untyped.

**Proof:** in the scratch copy I removed `status` from all three embeds (`contact_requests → strategies`, `match_candidates → strategies`, `match_decisions → strategies`), and `tsc --noEmit` exited 0. A planted type error in the same file did fail tsc, which shows the check was really running. So the comment "Required: a select that omits it fails to compile" is false. The only things the type now guards are typed object literals, meaning the two test fixtures. The silent-codename failure mode SFH-02 named is exactly as open as before.

**Minimal fix:** use SFH-01's mechanism. Add one source-scan test that asserts each of the three `strategies!…_fkey(…)` embed strings in `admin/page.tsx` and `lib/admin/match.ts` contains `status`, show it RED by deleting one, and correct the two comments to name that test instead of the compiler.

### Silent-failure-hunter round 2 (added by the orchestrator)

#### R2-SFH-01 (MEDIUM): chart `labelFormatter` throws before `formatDay` can guard
`src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx:227`, `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx:186`: `formatDay(new Date(Number(ms)).toISOString())` throws `RangeError` on a non-finite `ms` inside tooltip render (pre-existing behaviour, now looks guarded). Minimal fix: return "—" when `Number(ms)` is not finite, else format.

#### R2-SFH-02 (MEDIUM, test quality): the `visible: true` pin test's comment overstates its coverage
`src/lib/strategy-display.test.ts` ("pins the exact set of production call sites"): it only sees the literal in direct `displayStrategyName(` calls (not shared option objects, aliases, or same-file substitutions; comment stripping can eat `//` inside strings). Minimal fix: correct the comment to say exactly what it covers ("literal `visible: true` in direct calls, per-file counts").


## Round 3

**Reviewed:** 2026-11-11 · **Scope:** `git diff 9a0b6d1fb..HEAD -- . ':!.planning'` at HEAD `264d0021f` (merges `ad59473e1` R2-01/R2-03/R2-SFH-02 and `264d0021f` R2-02/R2-SFH-01), 24 files · **Severity floor:** MEDIUM · **Reviewer:** Claude (gsd-code-reviewer)

**What was run** (in the review worktree, read-only):
- The changed test files, plus `src/app/(dashboard)/allocations/widgets`, `src/components/ui` and `src/__tests__/copy-census.test.ts`: 72 files, 728 tests, all green.
- `ScenarioComposer.test.tsx`, `ScenarioComposer.save.test.tsx` and every `HoldingsTabPanel*` test: 12 files, 630 tests, all green.
- `tsc --noEmit`: exit 0.

**Can-fail proofs.** These ran in a throwaway `git archive HEAD` copy in the scratchpad, with `node_modules` symlinked, never in the worktree. I undid each fix and watched its test go RED:

| fix undone | test that went RED |
|---|---|
| R2-01: removed the summary `onMouseLeave` | `FactsheetView.terms.test.tsx`, "a bubble opened by focus closes when the pointer leaves the summary" |
| R2-SFH-01: removed the `Number.isFinite` guard, in `NetExposureChart` and separately in `AllocationOverTime` | each chart's "non-finite hover value" test |
| R2-03: removed `status` from the `match_candidates` embed, and separately from the `contact_requests` embed | `strategy-display.test.ts`, "admin strategy embeds select status", for that file |
| R2-02: reverted `HeatmapPanels` | `heatmap-month-labels` and `tap-charts-viewport` (2 files) |
| R2-02: reverted `admin/usage` | `admin/usage/page.test.tsx` |
| R2-02: reverted `admin/intros` | `admin/intros/page.test.tsx` |
| R2-02: reverted `ExposureByClass` | `ExposureByClass.test.tsx` |
| R2-02: reverted the wizard gap list | `SyncPreviewStep.composite.render.test.tsx` |
| R2-02: reverted the composer's both-ends Include arm | the `ScenarioComposer` BOTH-ends test |

Some R2-02 sites were not reverted one by one: the coverage-window value, the start-only and end-only Include arms, and the `match_decisions` embed. Each is pinned by an exact-string assertion that the fix updated, and the `match_decisions` embed is counted by the same `strategy-display.test.ts` scan.

### Verdicts on round-2 findings

| id | verdict | basis |
|---|---|---|
| R2-01 | **Resolved.** | `CollapsibleSection.tsx:155` adds `onMouseLeave={term ? hide : undefined}` to the `<summary>`, so a bubble that a click-focus opened closes when the pointer leaves the row. Keyboard focus never fires mouseleave, so the WR-02 path is unchanged and its arm stays green. The new arm goes RED without the fix. |
| R2-02 | **Resolved for the six named sites. The class is still open (R3-01).** | Heatmap reveal, `ExposureByClass`, the composer window and Include arms, the wizard gap list, the `admin/intros` time stamp (now `formatDayTime`) and the `admin/usage` Day column each print through the helper, and each has a test that went RED when reverted. The fix introduced one range-form defect, which is folded into R3-01. |
| R2-03 | **Resolved.** | The `strategy-display.test.ts` scan pins the embed count per file (1 in `admin/page.tsx`, 2 in `lib/admin/match.ts`) and needs `\bstatus\b` in each embed's column list. The `[^)]*` capture spans the concatenated `match_candidates` select string, so removing `status, ` from `match.ts:179` reddens it. Both comments now name the test, not the compiler. Every admin `displayStrategyName` caller (`AdminTabs`, `AllocatorMatchQueue`, `CandidateDetail`, `ShortlistCard`, `SendIntroPanel`) reads rows from one of those three embeds. |
| R2-SFH-01 | **Resolved.** | Both `labelFormatter`s return `—` for a non-finite `Number(ms)`. Each chart's test captures the prop through a `TouchTooltip` mock, calls it with `undefined` and `"not-a-number"`, and goes RED on the unguarded form. The new file-level mock in `NetExposureChart.test.tsx` displaces no existing assertion: none of that file's other tests read tooltip content. |
| R2-SFH-02 | **Resolved.** | The comment now says exactly what the test covers: per-file counts of the literal `visible: true` in direct `displayStrategyName(` calls. It also names the blind spots: a shared options object, an alias, a same-file substitution, and comment stripping inside strings. |

No new defect was found in the fixes beyond the range-form bullet inside R3-01.

### R3-01: F-11 residuals: raw `YYYY-MM-DD` still printed on user-facing surfaces at HEAD (consolidated)

**Severity:** MEDIUM · **User-facing:** yes (public factsheet and tear sheet, My allocation, the scenario composer, the strategy wizard, the exchange manager), plus staff-facing admin pages · **Data-integrity:** no

**Evidence.** Each site below prints an ISO day, or a full ISO timestamp, in copy a person reads. None is an axis tick or a machine value. None has a `policy.ts` exception: the only census entry for these files is the rule-A `PORTFOLIO` literal in `SyncPreviewStep`. Most print through a field, a variable or a local helper, which the `iso-slice` matcher cannot see.

The tests listed after each site assert the ISO output, so a fix must update them. They also mean the census cannot be the only source for this list. Several sites were found by grepping the tests for rendered-text assertions that contain `\d{4}-\d{2}-\d{2}`.

*User-facing (confirmed rendered at HEAD):*
1. **Public factsheet and tear sheet, Terms panel.** `src/app/factsheet/[id]/v2/MandatePanels.tsx:123` (`Live since {iso(native.startDate)}`) and `:126` (`observation window starts {iso(recordStart)}`). Both go through a local `iso()` at `:302-310` that builds `YYYY-MM-DD` by hand. It is a second date formatter in a factsheet file, the thing D-11 retires, and it falls back to the raw input on a parse failure. Pinned by `FactsheetBody.tearsheet-homes.test.tsx:242` and `FactsheetView.usd-terms.test.tsx:178`.
2. **My allocation, Holdings → Exposure.** `widgets/positions/NetExposureChart.tsx:123` and `widgets/allocation/AllocationOverTime.tsx:164` (`as of {points.at(-1)!.asof}`). These sit in the same section as `ExposureByClass`, which R2-02 moved to `as of Oct 3, 2026`, so one section now prints two date formats. Pinned by `NetExposureChart.test.tsx:148` and `HoldingsTabPanel.exposure.test.tsx:228`.
3. **My allocation, Holdings notes.** `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx`:
   - `:155` "Positions from … are as last read on 2026-08-31"
   - `:184` the same sentence for spot holdings
   - `:272` "… could not be read on its sync of 2026-09-05"

   They render at `:768` and `:792`. Pinned by `HoldingsTabPanel.key-read-notes.test.tsx:122,142,154-155,191`.
4. **Scenario composer.**
   - `src/app/(dashboard)/allocations/components/BlendHeader.tsx:77-79` reads "Mean of N strategies · 2024-01-02–2024-06-01". It is the primary header right above the coverage-window value that R2-02 formatted.
   - `components/ScenarioCompareTable.tsx:385-387` prints the effective-window stamp, pinned by `ScenarioCompareTable.test.tsx:333-342`.
   - `components/CoverageTimeline.tsx:121`: each bar's `aria-label`, `covers 2026-01-01–2026-01-06`, is what a screen reader announces. The composer and the wizard both render it, and it is pinned by `CoverageTimeline.test.tsx:131-134`.
   - `components/CustomRangePicker.tsx:391,416`: the `aria-live` clamp announcement reads "Start date 2099-01-01 is outside the allowed range; adjusted to 2024-06-30." The `<input type="date">` values stay exempt; this sentence is prose. Pinned by `CustomRangePicker.test.tsx:796`.
5. **Strategy wizard.**
   - `steps/SyncPreviewStep.tsx:2707-2708` (`rangeClause`) feeds the success paragraph at `:2809`: "… one continuous track record, 2025-08-03 – 2025-09-30."
   - `:2886-2889` prints the attribution table's window column, pinned by `SyncPreviewStep.composite.render.test.tsx:1302,1576,1603`.
   - `steps/MultiKeyConnectStep.tsx:2379` prints the collapsed key summary `{p.windowStart} – {p.windowEnd}`, pinned by `MultiKeyConnectStep.test.tsx:296,864`.
   - `steps/ReviewStep.tsx:215` prints the "Date range" recap row, pinned by `ReviewStep.test.tsx:176`.
6. **Exchange manager.** `src/lib/departed-history.ts:386,388,390` builds "History included until 2026-06-10." for `AllocatorExchangeManager`. Pinned by `AllocatorExchangeManager.departed-history.test.tsx:227,331,374`.
7. **Retired portfolio-PDF page.** `src/app/portfolio-pdf/[id]/page.tsx:62` prints the hard-coded literal `Retired 2026-11-07`. Pinned by `portfolio-pdf/[id]/page.test.tsx:97`.
8. **New in the R2-02 fix: the range form.** `ScenarioComposer.tsx:7065` now reads `Jan 4, 2026–Jan 9, 2026`, with an unspaced en dash between two comma-bearing dates. UI-SPEC `:592` fixes the day range as "day, space, en dash, space, day" (`Oct 9, 2026 – Nov 3, 2026`, two `formatDay` calls), and `returns-unit.ts` documents the same spaced form. The fixed sites that use `→` (the composer window, the wizard gap list) or `to` (`ExposureByClass`) kept their pre-existing separators. Those are noted here, not raised separately.

*Staff-facing:*
- **`src/app/(dashboard)/admin/usage/page.tsx:219`.** The session-heatmap column headers print `{d.slice(5)}` (`04-16`), a yearless raw fragment. They are `<th>` cells of a data table, not a chart axis. This is the same file as the `formatDay(row.day)` fix eight rows up.
- **`src/lib/admin/usage-metrics.ts:132-134`.** The stale-cache `NoticeBox` on `/admin/usage` prints `new Date(storedAt).toISOString()` in full ("showing cached data from 2026-11-11T18:50:06.123Z"). D-21 says a time stamp is the day format followed by the time (`formatDayTime`).

*Checked and excluded, with the reason:*
- `widgets/lib/chart-gaps.tsx:113` and `factsheet/[id]/v2/TimeSeriesChart.tsx:373,412`: these SVG `<title>`s sit inside a `<g pointerEvents="none">` (`chart-gaps.tsx:111`, `TimeSeriesChart.tsx:441`), so no hover can reach them. Their host charts are `role="img"` with their own `aria-label` (`NetExposureChart`, `AllocationOverTime.tsx:183`, `TimeSeriesChart.tsx:941`), so assistive tech does not read them either. They are not user-visible.
- `components/CoverageTimeline.tsx:176-177`: the union endpoint labels are the gantt's axis endpoints, and the code comment above them says so. D-21 exempts chart axis ticks. The bar `aria-label` at `:121` is not exempt; it is item 4 above.
- The `ScenarioFactsheetChart` master-brush edge labels (`scenario-shared-window.test.tsx:137-138`): chart-brush edge labels, treated as axis chrome.
- `src/components/strategy/StrategyHeader.tsx:78` (`Live since {strategy.start_date}`): nothing imports the component at HEAD, so it is not rendered.
- `scenario-share/[token]/page.test.tsx:772,798` (`overlay:2026-06-01=…`): a serialized data payload, which is a machine value.

**Why it matters.** F-11 is founder-confirmed: dates read "Nov 12, 2026" through one helper, and ISO stays only in CSV and exports. The public factsheet's Terms panel and the tear sheet still print `2024-06-01` through their own formatter, beside factsheet copy that now prints `Jun 1, 2024`. Every surface this phase moved still has an unmoved neighbour, often in the same card. This is the third round in which the census reads zero while user-facing ISO prints remain. Under the review policy, a user-facing MEDIUM that survives three rounds is routed to a phase.

**Minimal fix.** One mechanical pass, with no matcher change and no new helper:
- **`formatDay` wraps:** wrap each user-facing site in `formatDay`, and print the PDF literal as `Nov 7, 2026`.
- **`MandatePanels.tsx`:** replace the local `iso()` with `formatDay`, and delete the helper.
- **`usage-metrics.ts`:** use `formatDayTime`.
- **Ranges:** use the UI-SPEC `:592` form `${formatDay(a)} – ${formatDay(b)}`, which includes `ScenarioComposer.tsx:7065`.
- **Wizard open end:** keep the `"live"` branch outside the call (`p.stillLive || !p.windowEnd ? "live" : formatDay(p.windowEnd)` and `member.windowEnd ? formatDay(member.windowEnd) : "live"`), because `formatDay(null)` returns `—`, which would erase the open end.
- **Tests:** update the pinned tests listed above to the helper's form.
- **Deliberate exemptions:** record any deliberate machine or axis case as a `policy.ts` exception with its D-11 or D-21 reason.

*Sweep method, so the list's limits are known:* JSX and template interpolation of date-named fields across `src/**/*.{ts,tsx}`, `slice(0, 7|10|16)` across `src/**/*.tsx`, and test assertions on rendered text containing an ISO day. A site that prints a date through a neutrally named variable, with no test pinning its text, could still be missed.

---

_Round 3 reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

## Gap closure review (round 1)

**Reviewed:** 2026-11-11 · **Scope:** `git diff 95bf90ac7..HEAD -- . ':!.planning'` at HEAD `7a199d1bc` (plans 201-35 to 201-40, SC-3 "one date format"), 59 files · **Severity floor:** MEDIUM · **Reviewer:** Claude (gsd-code-reviewer)

**What was run** (in the review worktree, read-only):
- The 29 changed test files: 1117 tests, all green.
- `vitest related` over every changed non-test source file: 252 files, 5405 passed, 28 skipped, 0 failed.
- `src/__tests__/security-packet-date-drift.test.ts`, run on its own because it reads `security/page.tsx` through `fs`: green. Its 120-character window after "Last reviewed" still finds the ISO literal inside `formatDay("2026-11-07")`.
- Scanner probes in the scratchpad: `scanSource` on planted shapes, and `scanTree` with a wider date-name list, to find under-matching.
- `e2e/` grep: no text assertion on a changed surface still carries an ISO day or the old dotted `YYYY.MM.DD` footer stamp.

**Checked and clean:**
- **Helper use.** Every change calls `formatDay` or `formatDayTime` at the print position only. The `truncated` flag in `BlendHeader` and the backtest-gap comparison in `MandatePanels` (`recordStart`, `declaredStart`, `obsStart`) still read ISO values. The `admin/usage` heatmap `days` keys and `by_day` lookups still read ISO. The `<input type="date">` values, the sample-row CSV preview cells and the CSV export still read ISO.
- **Wizard "live".** Both "live" branches sit outside the helper call: `MultiKeyConnectStep.tsx:2379-2382` and `SyncPreviewStep.tsx:2887-2889`.
- **CSV `date_range`.** `csv_validator.py:1462-1463` emits it as `str(Timestamp.date())`, an ISO day, so `formatDay` reads it on UTC midnight. A non-UTC browser cannot shift it a day.
- **Re-pinned tests.** None was weakened. Each moved from an ISO literal to the exact helper form and gained a negative `\d{4}-\d{2}-\d{2}` assertion. Several gained an exact `toBe` where they had only `toContain`, `not.toBeNull` or a regex.
- **Forbidden files.** `ApiKeyManager.tsx`, the `AllocatorExchangeManager.tsx` component, the shared `Modal`, `e2e/manager-keys.spec.ts` and `ci.yml` do not appear in the diff.
- **`StrategyHeader` exception row.** It holds: no non-test file imports the component. The only other mention, `Badge.tsx:27`, is a comment.

### GC-01: The custom range picker's footer still prints `2024-02-01 → 2024-06-30`, in the file plan 201-37 fixed

**Severity:** MEDIUM · **User-facing:** yes (scenario composer and My allocation equity chart) · **Data-integrity:** no

**Evidence.**
- `src/app/(dashboard)/allocations/components/CustomRangePicker.tsx:224` builds `const rangeLabel = \`${startIso} → ${endIso}\`` from `toISODate(...)`, and `:488` renders it as visible footer text.
- The picker is mounted at `ScenarioComposer.tsx:5994` and at `EquityChart.tsx:1476` and `:2511`.
- Plan 201-37 moved the clamp notice in the same popover to `formatDay` ("adjusted to Jun 30, 2024"). One popover now shows `Jun 30, 2024` in its live region and `2024-02-01 → 2024-06-30` in its footer.
- The footer also breaks the UI-SPEC `:592` day-range form (spaced en dash), because it uses `→`.
- Census rule C cannot see this site: `startIso` and `endIso` are not in `DATES.fieldNames`. No test pins the footer text.

**Minimal fix.** Change `:224` to `const rangeLabel = \`${formatDay(startIso)} – ${formatDay(endIso)}\`;`. Leave `startIso`, `endIso`, `minIso` and `maxIso` as ISO for the inputs. Add one `CustomRangePicker.test.tsx` arm that asserts the footer reads `Feb 1, 2024 – May 1, 2024` and contains no ISO day.

### GC-02: The public factsheet's chart hover tooltip prints the raw ISO day

**Severity:** MEDIUM · **User-facing:** yes (public factsheet, every `TimeSeriesChart` panel) · **Data-integrity:** no

**Evidence.**
- `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:1278` passes `date={view.dates[crossIdx]}` to the crosshair tooltip, and `:1520` prints it unchanged as the tooltip's bold header: `<text …>{date}</text>`.
- `view.dates` holds ISO days. The same array is written unchanged into the chart's CSV export (`:1339`, `const cells = [dates[i] ?? ""]`) and compared as ISO strings by `indexOfDate` (`:40`).
- UI-SPEC `:602` (U-15) says: "Chart hover tooltips and heatmap cell titles are inside the rule … D-21 exempts axis ticks only."
- The dashboard charts already comply. `AllocationOverTime.tsx:227` and `NetExposureChart.tsx:186` format their tooltip labels with `formatDay`.
- The file is outside this diff, so this is a residual against the phase goal ("dates use one format across the app"), not a defect the change introduced. R3-01 did not list it, and the census cannot see it because `date` is not a listed field name.

**Minimal fix.** Change `:1520` to print `{formatDay(date)}`. Keep the `date` prop as ISO so the memo comparison is unchanged. Add one pointer-move assertion in the `charts.signed-zero.test.tsx` style that the tooltip header reads `Mon D, YYYY` and contains no ISO day.

### GC-03: The two new `MasterBrush` exception rows call a window readout a "chart axis tick", and the public factsheet keeps printing ISO through them

**Severity:** MEDIUM · **User-facing:** yes (public factsheet and the scenario composer) · **Data-integrity:** no

**Evidence.**
- `scripts/copy-census/policy.ts` adds two rule C rows for `MasterBrush.tsx` (`{startDate}` and `{endDate}`). Both give the reason "chart axis tick (D-21): the master-brush window-edge label".
- `MasterBrush.tsx:237` is an HTML `<span>` in the brush's header row, beside the word "Timeline". It prints the selected window as `{startDate} → {endDate}`, taken from `payload.dates[xs]` and `payload.dates[xe]` (`:226-227`).
- It is not an axis tick. The brush's ticks come from `yearTicks` at `:375`.
- It renders on the public factsheet (`FactsheetView.tsx:580` and `:610`), not only in the composer.
- R3-01 excluded the composer instance as "axis chrome", and these rows encode that call. I disagree, on the spec's own terms. UI-SPEC `:601` exempts only "chart axis tick labels". The composer's equivalent readout, `scenario-coverage-window-value`, was moved to `formatDay` in R2-02 (it now reads `Jan 4, 2026 → Jan 9, 2026`, pinned by `e2e/composer-axe.spec.ts`).
- So the two "selected window" readouts now disagree. The composer's own control prints `Mon D, YYYY`, while the factsheet brush prints ISO.
- `D-21` is quoted as the authority, but the rows exempt a non-tick element under it. That puts a false reason into the count-pinned list.

**Minimal fix.**
- Print `{formatDay(startDate)} – {formatDay(endDate)}` at `:237`. `formatDay("—")` already returns `—`, so the `?? "—"` fallbacks still work.
- Delete the two rows from `policy.ts` and from the typed list in `copy-census.test.ts`, and set `PINNED_EXCEPTION_COUNT` to 36.
- Update `scenario-shared-window.test.tsx:137-138` to the helper form.
- If the founder wants R3-01's exclusion kept instead, the row's reason must say what the element is ("selected-window readout, kept ISO by founder decision"), not cite D-21.

### GC-04: Rule C `date-field` has three blind spots its header does not list, one of them the exact unspaced-range defect form

**Severity:** MEDIUM · **User-facing:** no (gate integrity, latent: no live site of these shapes at HEAD) · **Data-integrity:** no

**Evidence.** Each of these reads 0 rule C hits under the shipped `POLICY` (scratchpad probe via `scanSource`):
1. **`&&` in a JSX child.** `<p>{show && r.asof}</p>` is missed, because `printedLeaves` (`scan.ts:399-412`) unwraps `?:`, `??` and `||`, but not `&&`.
2. **A bare date field in a copy attribute.** `<div aria-label={r.asof} />`, `<span title={r.until}>` and `<Row label=… value={r.asof} />` are all missed.
   - `scan.ts:511-512` checks only a `JsxExpression` whose parent is an element or fragment. Its comment says "An attribute value is a machine value."
   - The same scanner's `USER_ATTRS` (`scan.ts:95-98`: `label`, `title`, `aria-label`, `tooltip`, and others) already classifies those attributes as copy for rule A.
   - R3-01 item 4 was an `aria-label`. It is caught today only because it is built in a template that has a space.
3. **A whitespace-free range template.** `` `${r.effStart}–${r.effEnd}` `` is missed. `scan.ts:517` counts a template as prose only when a literal part contains `\s`, so an en-dash or arrow range with no spaces reads as a key. That unspaced `start–end` form is the range defect R3-01 item 8 raised.

None of these is in the blind-spot list in the scanner header (`scan.ts:20-24`: neutral names, calls, string literals outside JSX text). The `TODOS.md` closure note likewise presents the gate as covering the field form. A grep of `src/` for each shape over the listed names, plus `created_at`, `updated_at`, `as_of`, `computed_at`, `last_sync_at` and `date`, found no current site. The only copy-attribute matches were `<input type="date">` `value`s, which are exempt. So nothing is printing wrong today. The gap is that the next site of one of these shapes reads `C=0`.

**Minimal fix.**
- In `printedLeaves`, return the right operand of `&&`.
- In the `JsxExpression` branch, also fire when `n.parent` is a `JsxAttribute` whose name is in `USER_ATTRS`.
- Widen the prose test at `:517` from `/\s/` to `/[\s–→]/`.
- Add one RED arm and one GREEN arm per shape in `scan.test.ts`, then re-run the live census.
- If the founder prefers not to widen the matcher, the minimal alternative is to name these three shapes in the header's BLIND SPOTS paragraph and in the `TODOS.md` closure note.

**Verdict.** GC-01, GC-02 and GC-03 are user-facing MEDIUMs. GC-01 and GC-03 sit in files or rows this closure touched. GC-02 is a residual of the same SC-3 goal, outside the diff. GC-04 is a non-user-facing gate MEDIUM. No HIGH or CRITICAL. No finding is data-integrity: no machine value, input, CSV cell or comparison changed.

---

_Gap closure round 1 reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

**Orchestrator ruling on GC-03 (2026-11-11):** the MasterBrush window readout beside "Timeline" is a text readout, not an axis tick, so D-21 does not exempt it; format it with `formatDay` and drop the two exception rows (same treatment as the composer readout in round 2). All four GC findings go to one fixer round.

## Gap closure review (round 2)

**Reviewed:** 2026-11-11 · **Scope:** `git diff 020506bbc..HEAD -- . ':!.planning'` at HEAD `40ca07b68` (commits `639dd6b5c`, `6a573a208`, `1ce7e4acd`, `d8ab0d045`, merge `40ca07b68`), 11 files · **Severity floor:** MEDIUM · **Reviewer:** Claude (gsd-code-reviewer)

**What was run** (read-only on the review worktree; every neuter ran in a `git archive HEAD` scratch copy, never in the worktree):
- The 6 changed test files: 182 tests, all green.
- `vitest related` over the 5 changed source files: 113 files, 1983 passed, 14 skipped, 0 failed.
- `tsc --noEmit -p tsconfig.json`: exit 0, 0 lines of output. `eslint` over the 7 changed source and test files: exit 0.
- **Each fix reverted on its own (scratch copy):** the `CustomRangePicker` footer, the `TimeSeriesChart` tooltip header and the `MasterBrush` readout. The matching arm went RED each time: the GC-01 arm, the GC-02 arm, and all 4 `MasterBrush.basis` arms plus `scenario-shared-window` plus the live census, whose "no hit that is not a reasoned exception" arm went RED on the brush's `{startDate}` and `{endDate}` fields, which the two dropped rows used to consume.
- **Each `scan.ts` extension removed on its own** (the `&&` branch, the `USER_ATTRS` attribute branch, the `[\s–→]` widening): exactly its own new `scan.test.ts` arm went RED, 1 failed / 114 passed each time.
- **Fixture re-base check (`MasterBrush.basis.test.tsx`):** I neutered the three behaviours the file exists to pin. The MTM `max()` term in `factsheet-context.tsx:232` turned the MTM clamp arm RED. The smoothed term at `:239` turned the SMTM-01 arm RED. Reverting `useBasisSeriesView(usePayload())` to `usePayload()` turned the MTM-label arm and both clamp arms RED. The day arithmetic is right: index 99 and 149 from 2031-01-01 are Apr 10 and May 30, 2031, and from 2032-01-01 (a leap year) are Apr 9 and May 29, 2032. The new exact `toBe` pins are stronger than the old `startsWith` checks. The re-base lost no discriminating power.
- **Pinned count:** 4 policy rows + 31 ledger rows + 1 rule C row (`StrategyHeader`) = 36. `EXCEPTIONS` and `TYPED_EXCEPTIONS` both pass `toHaveLength(36)`, and "no exception without a live hit" still passes, so the remaining row is live.
- **Scanner probe** (`scanSource` with the shipped `POLICY`, 13 planted shapes, in the scratch copy): see GC2-02.
- **Live-tree widening run** (scratch copy): I made the attribute branch fire on every attribute outside `NON_COPY_ATTRS` and `data-*`, then ran `scanTree` over `src/`. That produced 10 `date-field` hits, and none is a display site:
  - 6 `computedAt={…}` props handed to components that format them (`FactsheetView.tsx:1623`, `SyncPreviewStep.tsx:2821` and `:3099`, `SubmitStep.tsx:780`, `OptimizerPanel.tsx:183`, `StrategyHeader.tsx:58`)
  - `startDate={s.start_date}` into `HealthScore` (`StrategyGrid.tsx:151`)
  - the two `<Input type="date">` values (`MultiKeyConnectStep.tsx:2525` and `:2538`)
  - the already-excepted `StrategyHeader.tsx:78` child

  Because the scanner walks the AST, this covers multi-line attributes too.
- **Goldens and e2e:** the `master-brush` SVG goldens capture only the `role="img"` `<svg>` (`MasterBrush.tsx:251`), not the header `<span>` at `:237`, so the readout change cannot move them. No e2e text assertion on the three changed surfaces carries an ISO day.

### Verdict per round 1 finding

- **GC-01: RESOLVED.** `CustomRangePicker.tsx:224` now prints `${formatDay(startIso)} – ${formatDay(endIso)}`. `startIso` and `endIso` stay ISO for the inputs. The new arm pins `Feb 1, 2024 – May 1, 2024` exactly, plus a negative ISO assertion over `textContent` (input values are not in `textContent`, so the check is not vacuous). It goes RED on revert.
- **GC-02: RESOLVED.** `TimeSeriesChart.tsx:1520` prints `{formatDay(date)}`. The `date` prop stays ISO, so the memo comparison and the CSV export at `:1339` are unchanged. The card width has a floor of 110 px, which fits the longest header (12 characters, `Sep 30, 2026`). The producers I traced emit date-only strings:
  - The factsheet payload drops every row that fails `isReadableDay` (`build-payload.ts:218`; strict `^\d{4}-\d{2}-\d{2}$` with a UTC round-trip, `figure-gate.ts:82-95`).
  - The composer's `portfolioDaily` and `datesR` (`scenario-factsheet-payload.ts:342`) come from `portfolio_daily_returns`, keyed by the strategy daily-return dates. `scenario.ts` compares those keys as strings against `YYYY-MM-DD` window bounds.

  So `formatDay` reads them on UTC midnight, with no `—` and no day shift. The new hover arm pins `Jan 6, 2026` and goes RED on revert.
- **GC-03: RESOLVED in code.** `MasterBrush.tsx:238` prints `{formatDay(startDate)} – {formatDay(endDate)}`, and the `?? "—"` fallbacks still read `—` through the helper. Both rows are gone from `policy.ts` and from the typed list. The count is 36. The record that describes this exception set was not updated: see GC2-01.
- **GC-04: RESOLVED for the three shapes as specified.** Each new branch has a RED arm that bites and a GREEN look-alike set, and the live census shows no new hits. One example that round 1 named under shape 2 is still unread: see GC2-02.

### GC2-01: The `TODOS.md` closure note still records the two MasterBrush exception rows, their D-21 reason and a count of 38

**Severity:** MEDIUM · **User-facing:** no · **Data-integrity:** no (record integrity)

**Evidence.**
- `TODOS.md:1514`, the SC-3 closure note, still says:
  - "on the fixed tree: none (`A=0 B=0 C=0`, **38 exceptions**)"
  - "**Three raw fields stay as reasoned exceptions** (R3-01 exclusions): **the two master-brush window-edge labels (chart chrome, D-21)** and `StrategyHeader`"
  - that `date-field` reads "a raw date field printed as a JSX child or in a prose template"
- After this round the count is 36 (`copy-census.test.ts:48`). One raw field stays excepted. The brush readout prints through `formatDay`. `date-field` also reads `&&` children, copy attributes and unspaced range templates (`scan.ts:18-20`).
- GC-03 was raised because these rows put a false D-21 reason into the count-pinned list. The fix removed that reason from the code. It is still stated, with a count that is now wrong, in the closure record that later sessions read as the gate's state.
- `git diff 020506bbc..HEAD -- TODOS.md` is empty: no fix commit touched the note.

**Minimal fix.** Edit that one paragraph only:
- `38 exceptions` becomes `36 exceptions`.
- "Three raw fields stay as reasoned exceptions …" becomes "One raw field stays a reasoned exception (R3-01): `StrategyHeader` (imported by nothing). The master-brush window readout prints through `formatDay` (gap closure GC-03)."
- The `date-field` clause takes the forms in the `scan.ts` header.

### GC2-02: Rule C still misses a bare date field in a `value=` prop, the shape round 1 named and the repo's own idiom for printing a date

**Severity:** MEDIUM · **User-facing:** no (gate integrity, latent: the live-tree widening run above found no display site of this shape at HEAD) · **Data-integrity:** no

**Evidence.**
- GC-04 item 2 listed three missed examples: `aria-label={r.asof}`, `title={r.until}` and `<Row label=… value={r.asof} />`. The fix keys the new attribute branch on `USER_ATTRS` (`scan.ts:96-98`, `:516`), and that set has no `value`.
- **This is a gap in round 1's own prescription, not a fixer miss.** Round 1's minimal fix said to fire "when `n.parent` is a `JsxAttribute` whose name is in `USER_ATTRS`", and the fixer did exactly that.
- The probe reads 0 rule C hits for `<Row label="As of" value={r.asof} />`. It also reads 0 for `<Card subtitle={r.asof} />`.
- The new test arm replaced the `value=` example with `tooltip={r.asof}` (`scan.test.ts`, "flags a bare date field in a copy attribute"), so the example round 1 actually raised is neither caught nor tested.
- `value=` is how this codebase prints a date in a label/value row:
  - `ReviewStep.tsx:216`, `CsvSubmitStep.tsx:717` and `CsvPreviewStep.tsx:123`: `value={\`${formatDay(…date_range[0])} – …\`}`
  - `admin/users/[id]/page.tsx:183`: `value={formatDayTime(profile.created_at)}`
  - The three CSV pills printed ISO before plan 201-38. The template branch catches the spaced-template form of these. A bare `value={preview.date_range[0]}` reads `C=0` (`date_range` is a listed name, and the element-access leaf resolves).
- The `scan.ts` header (`:18-24`) now says `date-field` reads "the value of a copy attribute (`USER_ATTRS`)", but its BLIND SPOTS sentence does not name `value=` or other non-`USER_ATTRS` display props. The `TODOS.md` note does not name them either.
- A naive `value` addition would false-positive. `MultiKeyConnectStep.tsx:2522-2541` passes `value={p.windowStart}` and `value={p.windowEnd}` to `<Input type="date" label=…>`, a machine value that D-11 exempts.

**Minimal fix (either one).**
- (a) In the attribute branch, also fire for `value` when the opening element carries no `type` attribute. Add a RED arm for `<Row label="As of" value={r.asof} />` and a GREEN arm for `<Input type="date" label="Active from" value={p.windowStart} />`. Then re-run the live census. The widening run above is a superset of this rule. On the live tree it reached `value` only on the two `type="date"` inputs, so (a) adds no live hit.
- (b) Round 1's sanctioned alternative: name "a date field passed through a display prop outside `USER_ATTRS` (`value`, `subtitle`, …)" in the `scan.ts` BLIND SPOTS sentence and in the `TODOS.md` closure note.

**Checked and below the floor (not raised):**
- An en-dash key template outside JSX now reads as a range, a false positive: `new Map([[\`${r.effStart}–${r.effEnd}\`, 1]])` gives 1 hit. It fails loud and has no live site.
- An unspaced em-dash range is still unread. In this UI-SPEC the em dash means "empty", not a range separator.
- The comment at `MasterBrush.tsx:54` still says "start → end".
- `→` separators remain at `StressWindowsPanel.tsx:135`, `SyncPreviewStep.tsx:2981` and `ScenarioComposer.tsx:5936`. Round 3 item 8 already noted these and did not raise them.

**Verdict.** All four round 1 findings are resolved in code, and every new test arm goes RED when its fix is reverted. The `MasterBrush.basis` fixture re-base keeps all three basis and clamp discriminations. The pinned count of 36 is arithmetically and behaviourally correct. There are two new MEDIUMs, both non-user-facing and neither data-integrity. GC2-01 is the stale closure record. GC2-02 is the `value=` shape of GC-04 that is still unread. No HIGH or CRITICAL.

---

_Gap closure round 2 reviewed: 2026-11-11 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

### Gap closure round 2: disposition (orchestrator, 2026-11-11)

Both MEDIUMs are non-user-facing and not data-integrity, so no fixer round runs (review policy).
- **GC2-01: corrected in place.** The `TODOS.md` closure note now reads 36 exceptions (38 before GC-03), names `StrategyHeader` as the one remaining raw-field exception, and gives the full `date-field` forms.
- **GC2-02: option (b), recorded as a stated blind spot.** The `scan.ts` BLIND SPOTS sentence and the `TODOS.md` closure note now name a date field passed through a display prop outside `USER_ATTRS` (`value`, `subtitle`, ...). It has no live site at this head. Option (a) is left for a later phase: a bare `value` rule would need the `type="date"` exemption and its own RED/GREEN arms.
