---
phase: 170-pagecopy
verified: 2026-09-30T20:25:35Z
status: gaps_found
score: 9/19 must-haves verified (8 failed, 1 present-behavior-unverified, 1 human-only)
verified_at_sha: 650448ee82caa7c81226abf5b3cefa5a82ba98b5
drift_subjects:
  - .github/workflows/ci.yml
  - DESIGN.md
  - e2e/helpers/reflow.ts
  - e2e/helpers/geometry.ts
  - e2e/helpers/seed-test-project.ts
  - e2e/layout-narrow.spec.ts
  - e2e/reflow.spec.ts
  - e2e/reflow-sweep.spec.ts
  - e2e/reflow-sweep-authed.spec.ts
  - e2e/composer-axe.spec.ts
  - e2e/mobile-drawer-keyboard.spec.ts
  - src/app/(dashboard)/admin/page.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/CoverageStateChip.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
  - src/app/(dashboard)/allocations/components/Tweaks.tsx
  - src/app/(dashboard)/allocations/components/TweaksToggle.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(marketing)/layout.tsx
  - src/app/(marketing)/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/components/admin/AdminTabs.tsx
  - src/components/admin/AllocatorMatchQueue.tsx
  - src/components/admin/CandidateDetail.tsx
  - src/components/admin/match/ShortlistCard.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/kpi/KpiPanel.tsx
  - src/components/marketing/MarketingHeaderActions.tsx
  - src/components/strategy/ShareableLink.tsx
  - src/components/strategy/StrategyFilters.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/ui/Button.tsx
  - src/components/ui/NowrapWords.tsx
  - src/components/ui/Tabs.tsx
  - src/lib/routing/default-route.ts
  - src/lib/tab-strip-scroll.ts
  - src/proxy.ts
  - src/lib/admin/match.ts
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "SC2: no page scrolls horizontally at 390 px (iPhone 12) or at desktop 200% zoom — the composed scenario (/allocations?tab=scenario with one strategy added) overflows the DOCUMENT at every viewport"
    status: failed
    reason: "CI run 36764778803 job 110056506084 at 650448ee: 7 rows (N-FOOT V390/V640/V960, N-SCN V390/V640, N-KPI composed V390/V640) fail their assertNoReflow with main=0 and doc=459..487 (V390), 209..231 (V640), 180..188 (V960). The overflowing right edge is the same in every viewport once the left offset is added: 390+471=861, 640+216=856, 960+180=1140 (=260 sidebar + ~26 padding + 854). The same run records 'N-SCN V960 scrollWidth=854', the natural width of the 'Strategies and weights' list (ul min-w-max inside ResponsiveTable). So the escaping box sits at the constituent list's right end. HYPOTHESIS, not measured: the sr-only <label>s in the constituent rows (ScenarioComposer.tsx weight/leverage labels at :7448, :7472, :7780, :7804, plus the sr-only notional spans near :6898/:7135/:7206) are position:absolute; neither ResponsiveTable's scroller nor #main-content (DashboardChrome.tsx 'flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0') is positioned, so their containing block is the initial containing block and they escape both overflow-x scrollers onto the document."
    artifacts:
      - path: "src/components/ResponsiveTable.tsx"
        issue: "scroll region is not a containing block (no `relative`), so absolutely positioned descendants escape it"
      - path: "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
        issue: "constituent list (min-w-max, ~854 px natural width) carries position:absolute sr-only labels at the row's right end"
    missing:
      - "Fix the walker first (next gap), re-run e2e-seeded, and confirm the named offender before acting"
      - "Likely fix: make the ResponsiveTable scroller (or the constituent-list card) `relative` so it is the containing block of its sr-only descendants; re-measure all 7 rows"
      - "After the reflow passes, the N-FOOT (f)/(g) assertions (footer children inside, clear of nav, Commit inside viewport and uncovered) run for the first time — they are unverified until then"
  - truth: "170-01 T0: the reflow failure message names the first offender by TAG#id.class — on the document-scroller path it cannot"
    status: failed
    reason: "Every LAYOUT-NARROW-OFFENDER line in run 36764778803 prints offender=<unknown>. e2e/helpers/reflow.ts:103-114: when main does not overflow, scroller=doc and the containment climb walks DOM parentElement up to the document; any ancestor with computed overflow-x auto/scroll and an in-viewport right edge marks the element 'contained'. #main-content is overflow-y-auto (so overflow-x computes to auto) with its right edge inside the viewport, and ResponsiveTable is overflow-x-auto too, so every descendant of main is classed contained even when its containing block is outside both scrollers. The 170-01 self-test (e2e/reflow.spec.ts) has a document fixture WITHOUT #main-content, so the doc-overflow-with-main-present case was never exercised (170-01-SUMMARY 'document fixture: body-level 800px element with no #main-content'). Deferred-items #1."
    artifacts:
      - path: "e2e/helpers/reflow.ts"
        issue: "containment test uses DOM ancestry, not containing-block ancestry; cannot name an abspos escapee on the doc path"
      - path: "e2e/reflow.spec.ts"
        issue: "no fixture for doc overflow while #main-content is present"
    missing:
      - "Containment climb must follow the containing-block chain (offsetParent / position-aware) or refuse to treat an ancestor as containing an element whose containing block lies above it"
      - "Self-test fixture: #main-content present, an absolute-positioned child with no positioned ancestor painting past the viewport → helper must throw and NAME that child"
  - truth: "SC2-(a) / 170-03: the allocations tablist scrolls inside its own strip at V390/V640 and at V960 sits on one row with the actions, not scrolling"
    status: failed
    reason: "V390 passed. V640 fails 'does not scroll inside itself (scrollWidth=264 clientWidth=264)'; V960 fails 'tablist top 696.19 is not on the Export row 709.19' (13 px > 8). Cause: the UI-SPEC's own classes contradict its own assertions. Tailwind sm = 640 px, and the tablist (AllocationsTabs.tsx:824) is `... overflow-x-auto ... sm:basis-auto sm:flex-wrap sm:overflow-x-visible`, so AT 640 px the strip stops scrolling and is allowed to wrap. UI-SPEC line 203 specifies those classes ('Result below sm'), line 207 asserts scrolling 'at V390 and V640'. At V960 the 13 px offset under `items-center` matches a tablist that has wrapped to two lines (half of one extra ~26 px tab row) inside the ~700 px main (960 − 260 sidebar) — inferred from the geometry, not measured. That also contradicts CONTEXT 'An overflowing tab bar becomes a horizontal scroller ... It does not wrap'."
    artifacts:
      - path: "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
        issue: "sm:flex-wrap sm:overflow-x-visible at :824 makes the strip wrap (not scroll) from 640 px up"
      - path: ".planning/phases/170-pagecopy/170-UI-SPEC.md"
        issue: "Scrollable Tab Strip row (:203) and its Assertions (:207) disagree at V640 and V960"
    missing:
      - "Decide one contract: keep the strip a nowrap horizontal scroller at every width (drop sm:flex-wrap / sm:overflow-x-visible, or move the breakpoint to md/lg), or change the V640 assertion to 'fits OR scrolls, never wraps'"
      - "V960: assert the tablist is one line (height == one tab) and on the Export row; make the markup satisfy it"
  - truth: "SC1-PRIVLINK / 170-05 N-STRAT: at V640/V960 the /strategies row is one row and the name block is at least 160 px wide"
    status: failed
    reason: "V390 and V960 passed (no intersection, whole name, one-line tags). V640 fails 'name block narrower than 160px' — received 142. The name/control non-intersection assertion at V640 ran first and PASSED, so nothing overlaps; the failure is the UI-SPEC width floor. Cause: strategies/page.tsx:774/:790 — the row goes `sm:flex-row` at 640 px and the control group is `sm:ml-4 sm:shrink-0`, so the max-content group (sm private-link button + status Badge + StrategyActions + date) keeps its full width and the `flex-1 min-w-0` name block gets the ~142 px left over. With a no-sidebar 640 px main the 160 px floor is unreachable with that group."
    artifacts:
      - path: "src/app/(dashboard)/strategies/page.tsx"
        issue: "row stacks only below sm; control group is sm:shrink-0"
    missing:
      - "Move the stack breakpoint to md (flex-col below md, md:flex-row, md:shrink-0), or let the control group shrink/wrap at sm, so the name block keeps >= 160 px at V640"
  - truth: "(k) / 170-10 N-TABLE: on /my-strategies the Sort selects are the hit target after the sticky header passes the filter bar at V390/V640/V960"
    status: failed
    reason: "V960 passed. V390 and V640 fail BEFORE any geometry: layout-narrow.spec.ts:483 `page.locator('a[href=\"/my-strategies\"]').first()` resolves to the desktop sidebar link (class list 'border-l-2 ... border-accent bg-surface-subtle text-accent', aria-current=page), which is hidden below md, so toBeVisible times out. Test-locator defect; the (k) fix (StrategyTable `isolate`, StrategyFilters `top-12 md:top-0`) has never been measured below md."
    artifacts:
      - path: "e2e/layout-narrow.spec.ts"
        issue: "anchor locator picks the first, hidden, sidebar link below md"
    missing:
      - "Anchor on `[data-strategy-table]` (already awaited on the next line) or on a visible-only link (`:visible` / the Primary mobile nav); then read the Sort-select elementFromPoint result at V390/V640"
  - truth: "SC2: /admin/match on mobile is read-only in fact (170-06 N-MATCH: no write control at V390, at least one at V960)"
    status: partial
    reason: "Both N-MATCH rows fail at the h1 anchor (layout-narrow.spec.ts:538/:560). The CI server log prints '[api/admin/match/[allocator_id]] error: Error: castRow: expected a row (preferences), got null' six times. src/lib/admin/match.ts:168 (no-batch path) and :232 (batch path) call `castRow<Record<string, unknown> | null>(preferences ?? null, \"preferences\")`; castRow throws on null unconditionally (src/lib/supabase/cast.ts:15-19), although the type and the `?? null` say null is legal and castRowOrNull sits right below it. The seeded allocator has no allocator_preferences row → 500 → AllocatorMatchQueue renders its error branch (:411) → no <h1> (it is in the success render at :483). PRE-EXISTING (match.ts untouched since v0.24.15.63) and it is itself a user-facing admin defect: /admin/match/<id> 500s for any allocator with no preferences row. The 170-06 code is present and wired (readOnly = forceReadOnly || !isMd at :179, handler guards at :235/:312/:338, `hidden md:inline-flex` on the action bar and ShortlistCard Send intro, `hidden md:flex` on the CandidateDetail bar, banner '768px or wider' at :472) and vitest pins it, but the browser gate has never run."
    artifacts:
      - path: "src/lib/admin/match.ts"
        issue: "castRow on a nullable preferences row at :168 and :232 throws for any allocator without preferences"
      - path: "e2e/layout-narrow.spec.ts"
        issue: "N-MATCH rows unrunnable until the route returns 200 for the seeded allocator"
    missing:
      - "Use castRowOrNull for preferences at match.ts:168 and :232 (the root-cause fix; the page should render an allocator with no preferences), with a vitest that fails on the current castRow"
      - "Re-run N-MATCH V390/V960 in e2e-seeded"
  - truth: "SC2-PROFILE / 170-08: on /profile?tab=exchanges Disconnect is inside the viewport and not covered at V390/V640, and the tab list scrolls"
    status: failed
    reason: "V390 passed. V640 fails 'Disconnect: box {x:471.0,y:439.3,w:111.0,h:44.0} is outside viewport 640x400'. Horizontally it is inside (471+111 = 582 < 640); it is BELOW THE FOLD of a 400 px tall viewport (439+44 > 400). geometry.ts assertInsideViewport checks all four edges without scrolling the element into view. Test-design defect, not a layout defect: the SC says 'clipped', and content reachable by vertical scroll in main is not clipped. The following assertScrollsInside on the profile tablist at V640 has never run; at 640 px the six underline tabs may fit without scrolling, which would repeat the SC2-(a) V640 contract contradiction."
    artifacts:
      - path: "e2e/layout-narrow.spec.ts"
        issue: "asserts vertical in-viewport without scrollIntoViewIfNeeded at a 400 px tall viewport; asserts 'scrolls' where content may fit"
    missing:
      - "scrollIntoViewIfNeeded on Disconnect before assertInsideViewport (or assert horizontal containment only)"
      - "Replace 'tablist scrolls' at V640 with 'tablist fits or scrolls inside itself, and the page does not overflow'"
  - truth: "No regression in the seeded chart-parity gate (svg-chart-parity portrait 320px streak-distribution)"
    status: failed
    reason: "NEW at 650448ee: 'Expected an image 288px by 185px, received 288px by 184px' for the Wins streak-length distribution SVG (viewBox 440x280, w-full → 183.3 px CSS). It passed in run 36755290085 at 20895bcc. Between the two SHAs only FactsheetView.tsx (170-11 KPI ladder, 170-12 ControlBar voice) and MetricsColumn.tsx (170-13) changed in src; inferred cause: the content above the panel changed height by a fractional amount, shifting the SVG's sub-pixel y and the rounded element-screenshot height by 1 px. The chart itself is not shown to have changed. 320 px is a retired width (founder 2026-09-27)."
    artifacts:
      - path: "e2e/svg-chart-parity.spec.ts-snapshots/streak-distribution-portrait-320-chromium-linux.png"
        issue: "golden height 185 vs 184 after 170-11..13 layout shifts"
    missing:
      - "Confirm by diffing the actual vs golden pixels; then either re-bake via the bake_svg_goldens dispatch (reviewed PNG) or move the portrait row to 390 px per the 2026-09-27 decision"
behavior_unverified_items:
  - truth: "SC1: Factsheet and Allocations panels no longer stack as near-identical layers"
    test: "Open /allocations?tab=scenario (composed) and a published factsheet at V390, V640 and V960 in the logged-in browser"
    expected: "One square 'Blend window' panel (eyebrow 'Scenario blend') replaces the blend header / window / coverage / 4-cell strip stack; composer distribution + rolling cards sit in one closed 'Blend distribution and rolling windows' section; the factsheet ControlBar actions read in DM Sans and the private-link control is a bordered secondary peer, never near the masthead"
    why_human: "Whether panels 'read as near-identical layers' is a visual judgment; vitest pins classes and structure only"
human_verification:
  - test: "170-14 SC3 post-deploy pass: every UI-SPEC SC3 route at 390x844, 640x400 and 960x540 in the logged-in browser, bound to the deploy SHA"
    expected: "scrollWidth - clientWidth <= 1 on #main-content and documentElement; no primary action outside the viewport horizontally or under a fixed/sticky layer"
    why_human: "Post-deploy, orchestrator-run by the phase's own design; cannot run before landing"
  - test: "FC-1: show the founder the scenario-tab screenshots at V390 and V640 with the five layer options"
    expected: "Founder's pick recorded; default (a) (nothing deleted) stands otherwise"
    why_human: "Founder decision"
  - test: "FC-2: ask the founder which site carries the venue label on CSV-ingested strategies (routed item (b))"
    expected: "Site named, or the item stays open and unimplemented"
    why_human: "Founder decision; not guessed by design"
  - test: "SC1 stacked-layers visual read (see behavior_unverified_items)"
    expected: "As above"
    why_human: "Visual judgment"
---

# Phase 170: LAYOUT — Verification Report

**Phase Goal:** Pages read as a finished product: no stacked look-alike panels, and the layout holds at 390 px (iPhone 12) and at desktop 200% zoom.
**Verified:** 2026-09-30T20:25:35Z at `650448ee82caa7c81226abf5b3cefa5a82ba98b5` (worktree branch `feat/170-layout`)
**Status:** gaps_found
**Re-verification:** No, initial verification

**Evidence base.** SHA-bound CI: run `36764778803`, e2e-seeded job `110056506084` at head `650448ee82caa7c81226abf5b3cefa5a82ba98b5` (confirmed via the runs API: `head_sha` matches, conclusion `failure`). Totals: 16 failed, 11 skipped, 183 passed, 210 tests, 1 worker. Comparison run `36755290085` job `110024318330` at `20895bcc` (14 failed). Local: `npx tsc --noEmit -p .` exit 0; `npx vitest run` 17988 passed, 292 skipped, 1 failed (`ci-anti-skip-gate.contract.test.ts`, a listed flake), which passed alone (33/33). The version-gate red is expected (release bump comes at ship) and is not counted.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: Factsheet and Allocations panels no longer stack as near-identical layers | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `KpiPanel variant="panel"` mounted in ScenarioComposer; `CollapsibleSection id="composer-blend-detail"` at ScenarioComposer.tsx:5946; ControlBar DM Sans voice (170-12). The visual read is a human item (FC-1 / SC3) |
| 2 | SC1: the private-link control is secondary and never overlaps content | ✓ VERIFIED | N-STRAT name-vs-control-group non-intersection passed at V390, V640 and V960 (the V640 row failed only later, on the width floor); `ShareableLink size="sm"`, bordered secondary |
| 3 | SC1-PRIVLINK: /strategies name block ≥ 160 px at V640/V960 (UI-SPEC N-STRAT) | ✗ FAILED | V640 name block 142 px; `sm:flex-row` + `sm:shrink-0` control group (strategies/page.tsx:774/:790) |
| 4 | SC2: `/security` and legal pages show the signed-in header | ✓ VERIFIED | `e2e/reflow-sweep-authed.spec.ts` (SC2-HEADER, 'Go to app', no 'Sign in') passed in the run; `MarketingHeaderActions.tsx` + test |
| 5 | SC2: the floating Tweaks control never covers the bottom navigation | ✓ VERIFIED | `Tweaks — N-TWEAKS` V390/V640/V960 passed (toggle not fixed, no nav/footer intersection, open panel clear of nav) |
| 6 | SC2: `/compare` does not point to controls that do not exist | ✓ VERIFIED | `/compare — N-CMP` both rows passed (no 'checkboxes', one-strategy note) |
| 7 | SC2: `/admin/match` on mobile is read-only in fact | ✗ FAILED (partial) | Code present and wired; the browser gate never ran: the API 500s on `castRow(null)` for the seeded allocator's missing preferences row (pre-existing, src/lib/admin/match.ts:168/:232) |
| 8 | SC2: no page scrolls horizontally at 390 px or desktop 200% zoom | ✗ FAILED | The composed scenario overflows the document at V390 (doc 459..487), V640 (209..231), V960 (180..188); 7 rows red |
| 9 | SC2-(a): allocations tab strip scrolls in its own strip / one row at V960 | ✗ FAILED | V390 passed; V640 does not scroll (264/264) and V960 is 13 px off the Export row: `sm:flex-wrap sm:overflow-x-visible` at 640 px, a UI-SPEC self-contradiction |
| 10 | SC2-PROFILE: Disconnect reachable, profile tabs scroll | ✗ FAILED (test defect) | V390 passed; V640 Disconnect is below the fold of a 400 px viewport (y 439), not clipped horizontally (x+w 582 < 640) |
| 11 | (f)(g)(h): the scenario commit bar never covers a heading, Commit is visible and tappable, and the empty state shows once | ✗ FAILED (blocked by the first gap, composed-scenario doc overflow) | (h) pinned by vitest (ScenarioFooter). (f)/(g) N-FOOT assertions were never reached: all three rows die at the preceding `assertNoReflow` (truth 8). Tracked in that gap's `missing:` list |
| 12 | (j): KPI values never break inside a number; labels readable | ✓ VERIFIED | N-KPI tile assertions passed on the composed mount at V390/V640 (they run before the trailing reflow that failed) and on the published factsheet at V390/V640 (rows fully green); vitest kpistrip pins |
| 13 | (k): `/strategies` table header never covers the Sort controls | ✗ FAILED (unverified below md) | V960 passed; V390/V640 never reached geometry: the anchor `a[href="/my-strategies"]`.first() is the hidden desktop sidebar link |
| 14 | (l): names and tags wrap only between words | ✓ VERIFIED | N-STRAT V390 one-line tag chips and exact-text name passed; `NowrapWords` + vitest |
| 15 | Grey chip pair ≥ 4.5:1 | ✓ VERIFIED | `text-text-secondary bg-track` at CoverageStateChip.tsx:44/:53 and StrategyTable.tsx:1217/:1381; the axe specs in the seeded list (composer-axe, axe-app-wide, strategy-v2-axe) did not fail in the run |
| 16 | Routed (a): an ended record's month row reads as its last month | ✓ VERIFIED | MetricsColumn.tsx:434-443 'Final month (MMM YYYY)'; `MetricsColumn.final-month.test.tsx` on both clock branches |
| 17 | Routed (c)/(d): admin owner line disambiguated without a short id; intro count relabelled | ✓ VERIFIED | AdminTabs.tsx:363-369 (name · email · Computed), :217 '{n} intro made' |
| 18 | 170-01 T0: the reflow failure names the first offender | ✗ FAILED | Every offender line is `offender=<unknown>`; DOM-ancestry containment test (reflow.ts:103-114); self-test lacks the doc-overflow-with-main case |
| 19 | SC3: post-deploy re-check at 390 px and 200% zoom by the orchestrator | ? HUMAN | Plan 170-14, after landing, by design |

Also verified: the published factsheet `/factsheet/<id>/v2` has no page overflow at V390/V640 (N-KPI published rows run `assertNoReflow(#factsheet-main)` and passed), so evidence items (c) HeatmapPanels chart and (e) drawdown / other table are not reproduced on that route at this SHA. Item (d) scenario member rows scroll inside their labelled region (N-SCN `assertScrollsInside` passed at V390/V640 before the reflow failed), but they are the prime suspect for the document overflow (truth 8).

**Score:** 9/19 verified (8 failed, 1 present but behavior-unverified, 1 human-only SC3).

### Backstop-tier truths

| Plan | Backstop | Result |
|------|----------|--------|
| 170-02 | populated composed scenario shows no page overflow and no footer/Tweaks intersection at three viewports | ✗ FAILED (N-FOOT reflow red; Tweaks part green) |
| 170-03 | Tweaks panel open at V390/V640 does not intersect the nav | ✓ VERIFIED (N-TWEAKS green) |
| 170-11 | no factsheet KPI label ellipsised at V390/V640 on both mounts | ✓ VERIFIED (N-KPI tile assertions green on both mounts) |

### SUMMARY vs CI

The SUMMARYs were honest: 170-03/04/05/06/08/10 each state the seeded `layout-narrow` rows were NOT run locally and were left for CI. The plan truths that name those rows as GREEN (170-03 tab strip, 170-04 N-FOOT, 170-05 N-STRAT, 170-06 N-MATCH, 170-08 SC2-PROFILE, 170-10 N-TABLE) are red at HEAD, per the table above.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `e2e/helpers/reflow.ts` | ⚠️ PARTIAL | main-aware measure works (main=/doc= split printed); offender naming fails on the doc path |
| `e2e/layout-narrow.spec.ts` + ci.yml e2e-seeded entry | ✓ WIRED | runs in e2e-seeded (FLOW-01 both places); 3 rows carry test defects (N-TABLE anchor, SC2-PROFILE fold, V640 scroll contracts) |
| `AllocationsTabs.tsx` tab strip + inline TweaksToggle | ⚠️ | Tweaks verified; strip wraps from 640 px up |
| `ScenarioFooter.tsx` | ? | (h) vitest-verified; (f)/(g) unmeasured |
| `ScenarioComposer.tsx` constituent list in ResponsiveTable | ⚠️ | contained scroll works; suspected escapee source for the doc overflow |
| `strategies/page.tsx`, `ShareableLink.tsx`, `NowrapWords.tsx` | ⚠️ | V390/V960 green; V640 width floor red |
| `AllocatorMatchQueue.tsx`, `CandidateDetail.tsx`, `ShortlistCard.tsx` | ✓ present, e2e unrun | blocked by `src/lib/admin/match.ts` castRow |
| `Tabs.tsx`, `tab-strip-scroll.ts`, `AllocatorExchangeManager.tsx` | ✓ (V390) | V640 row blocked by a test defect |
| `StrategyTable.tsx`, `StrategyFilters.tsx`, `CoverageStateChip.tsx` | ✓ / unmeasured below md | chip contrast verified; (k) unmeasured at V390/V640 |
| `FactsheetView.tsx`, `MetricsColumn.tsx`, `KpiPanel.tsx`, `KpiStrip.tsx` | ✓ | N-KPI green; month label pinned |
| `MarketingHeaderActions.tsx`, `(marketing)/layout.tsx`, `default-route.ts`, `compare/page.tsx`, `AdminTabs.tsx` | ✓ | e2e + vitest green |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `layout-narrow.spec.ts` | ci.yml e2e-seeded list | playwright arg list | WIRED (log shows it in the invocation) |
| `AllocationsTabs.tsx` | `src/lib/tab-strip-scroll.ts` | import + re-export | WIRED |
| `Tabs.tsx` underline variant | `computeTabStripScroll` | import | WIRED |
| `AllocatorMatchQueue` write handlers | `readOnly` guard | `if (readOnly) return` at :235/:312/:338 | WIRED |
| `/admin/match/[id]` page | `/api/admin/match/[id]` → `getAllocatorMatchQueue` | fetch | BROKEN for allocators without preferences (pre-existing castRow) |
| ResponsiveTable scroller | abspos descendants | containing block | NOT CONTAINED (suspected; unconfirmed) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type check | `npx tsc --noEmit -p .` | exit 0 | ✓ PASS |
| Unit suite | `npx vitest run` | 17988 passed / 292 skipped / 1 failed (listed flake) | ✓ PASS after rerun |
| Flake rerun alone | `npx vitest run src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | 33/33 | ✓ PASS |
| Seeded geometry | CI run 36764778803 job 110056506084 | 16 failed (15 layout-narrow, 1 svg-chart-parity) | ✗ FAIL |

### Probe Execution

Step 7c: SKIPPED. No `scripts/*/tests/probe-*.sh` is declared by any 170 PLAN, and the phase is not a migration/tooling phase.

### CI failure census (all 16 rows, cause per row)

| # | Row | Assertion hit | Cause | Class |
|---|-----|---------------|-------|-------|
| 1-3 | N-FOOT V390/V640/V960 | first `assertNoReflow` (spec :143) | document overflow of the composed scenario, right edge = constituent list end; walker cannot name it | layout defect (hypothesis: abspos sr-only escapees) + helper defect |
| 4 | SC2-(a) V640 | `assertScrollsInside` 264/264 | `sm:` classes switch the strip to wrap at exactly 640 px | spec self-contradiction; markup follows the UI-SPEC classes |
| 5 | SC2-(a) V960 | tablist top 696.19 vs Export 709.19 (13 > 8) | tablist allowed to wrap (`sm:flex-wrap`), taller under `items-center` (inferred) | layout vs contract |
| 6-7 | N-SCN V390/V640 | trailing `assertNoReflow` (scrolls-inside passed) | same as 1-3 | same as 1-3 |
| 8 | SC2-PROFILE V640 | `assertInsideViewport` y 439 + 44 > 400 | below the fold, not clipped | test defect |
| 9 | N-STRAT V640 | name block 142 < 160 | `sm:flex-row` + `sm:shrink-0` group | layout vs contract |
| 10-11 | N-TABLE V390/V640 | anchor `a[href="/my-strategies"]`.first() hidden | first match is the desktop sidebar link | test locator defect |
| 12-13 | N-MATCH V390/V960 | h1 not found | API 500: `castRow: expected a row (preferences), got null` (match.ts:168/:232) | pre-existing app bug blocks the gate |
| 14-15 | N-KPI composed V390/V640 | trailing `assertNoReflow` (tiles passed) | same as 1-3 | same as 1-3 |
| 16 | svg-chart-parity portrait 320 streak-distribution | 288x184 vs 288x185 golden | new since 20895bcc; sub-pixel shift from 170-11..13 factsheet layout above the panel (inferred) | golden drift at a retired width |

### Requirements Coverage

Phase 170 has no REQUIREMENTS.md ids ("Requirements: TBD (phase-local SC ids)"). Coverage is by roadmap SC and routed item, tabulated above. No orphaned requirement ids.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/admin/match.ts` | 168, 232 | `castRow<T \| null>(x ?? null)` throws on the null its own type admits | 🛑 Blocker (for truth 7) | 500 on /admin/match/<id> for allocators without preferences; pre-existing |
| `e2e/layout-narrow.spec.ts` | 483 | `.first()` on a locator that matches a hidden element first | ⚠️ Warning | N-TABLE never measures below md |
| `e2e/layout-narrow.spec.ts` | 366-367, 199 | "must scroll" / "inside viewport" asserted where content fits or is below the fold | ⚠️ Warning | red rows that do not describe a layout defect |

No `TBD` / `FIXME` / `XXX` added by the phase (scanned the added lines of `git diff 25182655c..HEAD -- src e2e tests`).

### Human Verification Required

1. **SC3 post-deploy pass (170-14).** Every SC3 route at 390x844, 640x400, 960x540 in the logged-in browser, bound to the deploy SHA. Expected: slop ≤ 1 on both scrollers, no clipped primary action.
2. **FC-1.** Scenario-tab screenshots at V390/V640 with the five layer options, founder answer recorded.
3. **FC-2.** Venue-label site named by the founder, or left open.
4. **SC1 visual read.** No near-identical stacked layers on the scenario tab and the factsheet.

### Deferred Items

None. Deferred-items #1 and #2 are owned by this phase's own plans (170-01, 170-04), and Phase 170.1 is COPY, so neither is a later-phase deferral. Both are gaps above.

### Gaps Summary

The phase goal is not met at `650448ee`: the composed scenario, the phase's headline surface, still scrolls horizontally at 390 px, 640 px and 960 px, and the tool meant to name the culprit cannot. The root-cause chain has three parts: (1) the reflow walker treats DOM ancestry as containment, so it cannot name an abspos escapee; (2) the arithmetic puts the escapee at the constituent list's right edge, and the likely fix is a containing block on the ResponsiveTable scroller, to be confirmed with a fixed walker; (3) once that is fixed, the N-FOOT (f)/(g) assertions run for the first time.

Separately:
- Two V640 rows fail because the UI-SPEC switches behaviour at `sm` (= 640 px) while asserting below-`sm` behaviour at 640. One contract needs choosing: tab strip and N-STRAT row.
- Three rows are test defects: the N-TABLE anchor, the SC2-PROFILE fold, and "must scroll" where content fits.
- The N-MATCH gate is blocked by a pre-existing `castRow` null throw in `src/lib/admin/match.ts`, which is also a real admin 500.
- A 1 px golden drift in svg-chart-parity is new since 170-11..13.

Suggested gap-plan grouping: (A) reflow helper and self-test; (B) composed-scenario doc overflow; (C) V640 contracts, tab strip and /strategies row; (D) spec defects, N-TABLE anchor and profile fold; (E) match.ts castRowOrNull plus the N-MATCH re-run; (F) svg-parity golden.

---

_Verified: 2026-09-30T20:25:35Z_
_Verifier: Claude (gsd-verifier)_
