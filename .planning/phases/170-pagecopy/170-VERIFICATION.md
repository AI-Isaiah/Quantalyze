---
phase: 170-pagecopy
verified: 2026-10-01T07:31:04Z
status: passed
score: 20/20 must-haves resolved (truth 20 by the 2026-10-01 post-deploy pass, with Holdings routed to 170.2; truth 1 by founder FC-1 "Ship as is")
resolved_at: 2026-10-01
verified_at_sha: a82496148b7decfdcd3db87c1150045144352c7e
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
  - e2e/svg-chart-parity.spec.ts-snapshots/bootstrap-ci-portrait-320-chromium-linux.png
  - e2e/svg-chart-parity.spec.ts-snapshots/correlation-strip-portrait-320-chromium-linux.png
  - e2e/svg-chart-parity.spec.ts-snapshots/quantile-box-plot-portrait-320-chromium-linux.png
  - e2e/svg-chart-parity.spec.ts-snapshots/streak-distribution-portrait-320-chromium-linux.png
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
  - src/components/ResponsiveTable.tsx
  - src/components/admin/AdminTabs.tsx
  - src/components/admin/AllocatorMatchQueue.tsx
  - src/components/admin/CandidateDetail.tsx
  - src/components/admin/PreferencesPanel.tsx
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
  - src/lib/admin/match.ts
  - src/lib/routing/default-route.ts
  - src/lib/tab-strip-scroll.ts
  - src/proxy.ts
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 9/19
  previous_sha: 650448ee82caa7c81226abf5b3cefa5a82ba98b5
  gaps_closed:
    - "SC2: no page scrolls horizontally at 390 px or desktop 200% zoom (composed scenario document overflow)"
    - "170-01 T0: the reflow failure names the first offender"
    - "SC2-(a): allocations tab list scrolls inside itself / one line on the Export row at V960 (GC-01)"
    - "SC1-PRIVLINK / N-STRAT: name block >= 160 px (GC-02, amended 2026-10-01)"
    - "(k) / N-TABLE: Sort selects stay the hit target below md"
    - "SC2: /admin/match on mobile is read-only in fact (N-MATCH)"
    - "SC2-PROFILE: Disconnect reachable, profile tab list fits or scrolls"
    - "No regression in svg-chart-parity portrait 320 streak-distribution (GC-03)"
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "SC1: Factsheet and Allocations panels no longer stack as near-identical layers"
    test: "Open /allocations?tab=scenario (composed) and a published factsheet at 390 px and at desktop 200% zoom in the logged-in browser"
    expected: "One square 'Blend window' panel (eyebrow 'Scenario blend') replaces the former blend header / window / coverage / strip stack; the distribution and rolling cards sit in one closed 'Blend distribution and rolling windows' section; the factsheet ControlBar actions read in DM Sans and the private-link control is a bordered secondary peer"
    why_human: "Whether panels read as near-identical layers is a visual judgment; vitest pins classes and structure only"
human_verification:
  - test: "170-14 SC3 post-deploy pass: every SC3 route at 390x844 and at desktop 200% zoom (640x400, 960x540 CSS px) in the logged-in browser, bound to the deploy SHA"
    expected: "scrollWidth - clientWidth <= 1 on #main-content and documentElement; no primary action clipped or under a fixed/sticky layer"
    why_human: "Post-deploy and orchestrator-run by the phase's own design (founder deferred all browser checks until 170 lands)"
  - test: "SC1 stacked-layers visual read (see behavior_unverified_items)"
    expected: "As above"
    why_human: "Visual judgment"
  - test: "FC-1: show the founder the scenario-tab screenshots at 390 px and desktop 200% zoom with the layer-deletion options (b)-(e)"
    expected: "Founder's pick recorded; default (a), nothing deleted, stands otherwise (170-CONTEXT deferred list)"
    why_human: "Founder decision"
  - test: "FC-2: ask the founder which site carries the venue label on CSV-ingested strategies (routed item (b))"
    expected: "Site named, or the item stays open and unimplemented (170-CONTEXT deferred list)"
    why_human: "Founder decision; not guessed by design"
---

# Phase 170: LAYOUT — Verification Report

**Phase Goal:** Pages read as a finished product: no stacked look-alike panels, and the layout holds at 390 px (iPhone 12) and at desktop 200% zoom.
**Verified:** 2026-10-01T07:31:04Z at code HEAD `a82496148b7decfdcd3db87c1150045144352c7e` (branch `feat/170-layout`; docs-only commits on top through `3112caa49`)
**Status:** passed (resolved 2026-10-01; see the note below)
**Re-verification:** Yes, after gap-closure plans 170-15..170-20 and the round-1 review fix round (topics A-D)

**Lineage.** 2026-09-30T20:25:35Z at `650448ee82caa7c81226abf5b3cefa5a82ba98b5`: `gaps_found`, 9/19, eight gaps, bound to CI run `36764778803` e2e-seeded job `110056506084` (16 failed). That verdict is superseded by this report and kept here as history.

**Evidence base.** SHA-bound CI: run `36829190398`, `head_sha` = `a82496148b7decfdcd3db87c1150045144352c7e` (confirmed via `gh run view --json headSha`).

- **e2e-seeded** job `110261959804`: conclusion `success`. Invocation includes `e2e/reflow-sweep-authed.spec.ts`, `e2e/layout-narrow.spec.ts`, `e2e/svg-chart-parity.spec.ts`, `e2e/composer-axe.spec.ts`, `e2e/axe-app-wide.spec.ts`, `e2e/strategy-v2-axe.spec.ts` with `BAKE_SVG_GOLDENS: false`. Totals: **212 tests, 200 passed, 11 skipped, 1 flaky, 0 failed**. Zero `LAYOUT-NARROW-OFFENDER` lines; `LAYOUT-NARROW-CLEAN ... main=0 doc=0` at 390/640/768/800/960/2560.
- **e2e** job `110262227830`: conclusion `success` (173 tests, 102 passed, 71 skipped). Its invocation includes `e2e/reflow.spec.ts`, the helper self-test; its log prints `offender=LABEL#escapee` for the new escapee fixture.
- **frontend-test (1)/(2)** `110261760327`/`110261760320`, **frontend-typecheck** `110261760342`, **frontend-coverage** `110263381103`, **frontend-build**, **frontend-lint**, **knip**: all `success`.
- `version-gate` `110261656810`: `failure`, the expected red on a draft PR with no release bump yet. Not counted.
- **Run final:** `completed / failure`, 26 jobs: 25 `success`, 1 `failure` (`version-gate`, expected above). The `frontend` aggregator `110269353430`, `python` `110261760310` and `sql-mutation` `110261760520` all `success`.

**Per-row binding is partly inferential.** e2e-seeded uses the dot reporter and the run uploads no Playwright report artifact (artifacts: two vitest blobs, gitleaks SARIF, nextjs-build). Per-row binding rests on: 0 failed in the job; the skip count is 11, the same as at `650448ee` when every layout-narrow row ran (and 16 of them failed); every `test.skip` in `e2e/layout-narrow.spec.ts` is the `!HAS_SEED_ENV` guard, and the job has the seed env (seeded `CLEAN` lines print at every viewport). Rows that log their own marker are bound directly: `SC2-(a) V390/V640/V960 allocations tablist scrolls=true`, `SC2-PROFILE V390/V640 profile tab list scrolls=true`, `N-SCN V960 scrollWidth=837 clientWidth=554 scrolls=true`, `N-MATCH V960 rendered write controls: Recompute now, Edit preferences`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: Factsheet and Allocations panels no longer stack as near-identical layers | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unchanged since the prior verdict: `KpiPanel variant="panel"` in ScenarioComposer, the `composer-blend-detail` CollapsibleSection, the ControlBar DM Sans voice (170-12). The visual read is a human item |
| 2 | SC1: the private-link control is secondary and never overlaps content | ✓ VERIFIED | N-STRAT non-intersection rows green at V390/V640/V960, plus the new CR-01 draft rows at V768/V800 (`rectsIntersect(block, controlBox) === false`, `rectsIntersect(nameBox, controlBox) === false`) |
| 3 | SC1-PRIVLINK / N-STRAT: name block ≥ 160 px (GC-02 as amended 2026-10-01) | ✓ VERIFIED | `strategies/page.tsx`: row `flex-col md:flex-row`, name block `flex-1 min-w-0 md:min-w-[160px]`, control group `md:min-w-0 md:justify-end`, no `md:shrink-0`. e2e N-STRAT V640 green (stacked below md, asserted) and CR-01 draft rows V768/V800 green (block width ≥ 160) |
| 4 | SC2: `/security` and legal pages show the signed-in header | ✓ VERIFIED | `reflow-sweep-authed.spec.ts` in the green e2e-seeded run; `MarketingHeaderActions.tsx` + test. See the SFH-R2-01 note under Anti-Patterns for its outage path |
| 5 | SC2: the floating Tweaks control never covers the bottom navigation | ✓ VERIFIED | N-TWEAKS V390/V640/V960 green; WR-01 focus-order fix in `Tweaks.tsx`/`TweaksToggle.tsx` with `Tweaks.test.tsx` |
| 6 | SC2: `/compare` does not point to controls that do not exist | ✓ VERIFIED | N-CMP both rows green |
| 7 | SC2: `/admin/match` on mobile is read-only in fact | ✓ VERIFIED | Root cause fixed: `src/lib/admin/match.ts` uses `castRowOrNull` for preferences on both paths, pinned by `match.test.ts` (frontend-test green). N-MATCH V390 (no write control, banner names 768px or wider) and V960 (`rendered write controls: Recompute now, Edit preferences`) green. SFH-5: below md the Save in `PreferencesPanel.tsx` is disabled and a refused recompute reports itself |
| 8 | SC2: no page scrolls horizontally at 390 px or desktop 200% zoom | ✓ VERIFIED (seeded routes; post-deploy sweep is truth 20) | `ResponsiveTable.tsx` adds `relative`, so sr-only abspos labels no longer escape the scroller. N-FOOT V390/V640/V960, N-SCN V390/V640 and N-KPI composed V390/V640, the seven rows red at `650448ee`, are green; zero OFFENDER lines in the job |
| 9 | SC2-(a): the allocations tab list never wraps, scrolls only when it must, and at V960 sits on the Export row (GC-01) | ✓ VERIFIED | `AllocationsTabs.tsx` tablist drops `sm:flex-wrap sm:overflow-x-visible`. e2e `assertFitsOrScrollsInside` + V960 Export-row centre check green at all three viewports; log `scrolls=true` at V390/V640/V960 |
| 10 | SC2-PROFILE: Disconnect reachable, profile tab list fits or scrolls on one line | ✓ VERIFIED | Spec now `scrollIntoViewIfNeeded` + `assertNotClippedByAncestors` (SFH-170-02), and `assertFitsOrScrollsInside`; V390/V640 green, log `scrolls=true` |
| 11 | (f)(g)(h): the commit bar never covers a heading, Commit is visible and tappable, the empty state shows once | ✓ VERIFIED | N-FOOT rows (footer children inside, clear of nav, Commit inside and uncovered) ran past the reflow check for the first time and are green at V390/V640/V960; (h) vitest-pinned |
| 12 | (j): KPI values never break inside a number; labels readable | ✓ VERIFIED | N-KPI composed and published rows green at V390/V640 |
| 13 | (k): the `/strategies` table header never covers the Sort controls | ✓ VERIFIED | N-TABLE rewritten: anchors on `[data-strategy-table]`, scrolls `#main-content` in 8 px steps until a sticky z-indexed table cell lies under the select, and fails if it never gets there (WR-04). Green at V390/V640/V960 |
| 14 | (l): names and tags wrap only between words | ✓ VERIFIED | N-STRAT V390 exact-name and one-line tag assertions green; WR-02 `NowrapWords breakOverlong` lets an overlong hyphenated name break inside its block, pinned by `NowrapWords.test.tsx` |
| 15 | Grey chip pair ≥ 4.5:1 | ✓ VERIFIED | Unchanged; composer-axe, axe-app-wide and strategy-v2-axe green in the run |
| 16 | Routed (a): an ended record's month row reads as its last month (WR-03 amended rule) | ✓ VERIFIED | `MetricsColumn.tsx`: 0 months behind → `Month-to-date`, 1 → `Last month (MMM YYYY)`, 2+ → `Final month (MMM YYYY)`, empty/unparseable → `Month-to-date`; pinned by `MetricsColumn.final-month.test.tsx` (frontend-test green); DESIGN.md AD-10 amended |
| 17 | Routed (c)/(d): admin owner line disambiguated without a short id; intro count relabelled | ✓ VERIFIED | Unchanged since the prior verdict (AdminTabs.tsx) |
| 18 | 170-01 T0: the reflow failure names the first offender | ✓ VERIFIED | `e2e/helpers/reflow.ts` climbs the containing-block chain (`offsetParent` for `position: absolute`, skips `position: fixed`, counts `hidden`/`clip` as clipping). New escapee and contained-escapee fixtures in `e2e/reflow.spec.ts`; e2e job log prints `offender=LABEL#escapee` |
| 19 | No regression in svg-chart-parity (portrait 320 goldens) | ✓ VERIFIED | GC-03: commit `11ac37bbf` re-baked four portrait-320 PNGs (streak-distribution, bootstrap-ci, correlation-strip, quantile-box-plot); svg-chart-parity ran with `BAKE_SVG_GOLDENS: false` in the green e2e-seeded job |
| 20 | SC3: post-deploy re-check at 390 px and 200% zoom by the orchestrator | ? HUMAN | Plan 170-14, after landing, by design |

**Score:** 18/20 verified (1 present but behavior-unverified: truth 1; 1 human-only: truth 20).

Note on truth 9: at V960 the Allocations tab list scrolls inside itself (`scrolls=true`) while staying on the Export row. GC-01 permits that ("scrolls inside itself ONLY when its tabs do not fit"), so it is not a gap, but at desktop 200% zoom some tabs sit behind a horizontal scroll. The SC3 browser pass should look at it.

### Gap closure, row by row (all 8 prior gaps)

| Prior gap | Fix | Evidence at `a82496148` |
|-----------|-----|-------------------------|
| Composed scenario document overflow (7 rows) | `ResponsiveTable.tsx` `relative` (170-16) | N-FOOT ×3, N-SCN ×2, N-KPI composed ×2 green; 0 OFFENDER lines |
| Walker cannot name an offender | containing-block climb in `reflow.ts` + fixtures (170-15) | `offender=LABEL#escapee` in e2e job `110262227830` |
| Tab strip V640/V960 contract | GC-01 classes + `assertFitsOrScrollsInside` (170-17, 170-18) | SC2-(a) V390/V640/V960 green |
| N-STRAT V640 width floor | GC-02 `md` breakpoint (170-17), CR-01 amendment | N-STRAT V640 + draft V768/V800 green |
| N-TABLE anchor defect | spec rewrite (170-18, WR-04) | N-TABLE V390/V640 green |
| N-MATCH blocked by castRow 500 | `castRowOrNull` (170-19) | N-MATCH V390/V960 green |
| SC2-PROFILE fold | scrollIntoView + ancestor-clip check (170-18, SFH-170-02) | SC2-PROFILE V640 green |
| svg-parity 1 px golden drift | re-bake (170-20, GC-03) | svg-chart-parity green |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `e2e/helpers/reflow.ts`, `e2e/helpers/geometry.ts` | ✓ VERIFIED | containing-block climb; `assertFitsOrScrollsInside`, `assertNotClippedByAncestors`; self-tests in `e2e/reflow.spec.ts` run in the `e2e` job |
| `e2e/layout-narrow.spec.ts` + ci.yml e2e-seeded entry | ✓ WIRED | in the e2e-seeded invocation; skip guards are `!HAS_SEED_ENV` only |
| `src/components/ResponsiveTable.tsx` | ✓ VERIFIED | `relative` + `ResponsiveTable.test.tsx` |
| `AllocationsTabs.tsx`, `Tweaks.tsx`, `TweaksToggle.tsx` | ✓ VERIFIED | GC-01 strip; WR-01 focus order |
| `strategies/page.tsx`, `NowrapWords.tsx`, `ShareableLink.tsx` | ✓ VERIFIED | GC-02 amended; WR-02 |
| `src/lib/admin/match.ts`, `AllocatorMatchQueue.tsx`, `PreferencesPanel.tsx` | ✓ VERIFIED | castRowOrNull; SFH-5 read-only Save and refused-recompute notice |
| `MetricsColumn.tsx` | ✓ VERIFIED | WR-03 rule |
| 4 × portrait-320 goldens | ✓ VERIFIED | re-baked, gate green |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `layout-narrow.spec.ts` | ci.yml e2e-seeded list | playwright arg list | WIRED (in the job's invocation) |
| `reflow.spec.ts` | ci.yml e2e list | playwright arg list | WIRED (in the e2e job's invocation) |
| `/admin/match/[id]` page | `/api/admin/match/[id]` → `getAllocatorMatchPayload` | fetch | WIRED (N-MATCH renders the h1 and controls for an allocator with no preferences row) |
| ResponsiveTable scroller | abspos descendants | containing block (`relative`) | CONTAINED |
| `AllocatorMatchQueue` write handlers | `readOnly` / `readOnlyRef` guard | early return | WIRED |

### Behavioral Spot-Checks

| Behavior | Source | Result | Status |
|----------|--------|--------|--------|
| Seeded layout geometry | run `36829190398` job `110261959804` | 200 passed / 11 skipped / 1 flaky / 0 failed | ✓ PASS |
| Helper self-test | run `36829190398` job `110262227830` | success; `offender=LABEL#escapee` | ✓ PASS |
| Unit suite | frontend-test (1)/(2), frontend-coverage | success | ✓ PASS |
| Type check | frontend-typecheck | success | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED. No `scripts/*/tests/probe-*.sh` is declared by any 170 PLAN, and the phase is not a migration/tooling phase.

### Requirements Coverage

Phase 170 has no REQUIREMENTS.md ids ("Requirements: TBD (phase-local SC ids)"). Coverage is by roadmap SC and routed item, tabulated above. No orphaned requirement ids.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `e2e/composite-factsheet-render.spec.ts` | 203 | `composite factsheet: zero axe violations (cash basis)` FLAKY, `page-has-heading-one` on `html`, passed on retry | ⚠️ Warning | Not a layout criterion. First recorded in 170-11-SUMMARY; 170-11/12 changed `FactsheetView.tsx`. Unknown whether it predates the phase. Looks like axe running before the h1 mounts |
| `src/app/(dashboard)/admin/page.tsx` | (R2 WR-01) | throws on any one queue error, so one failing query blanks all four admin queues | ⚠️ Warning, recorded not fixed | Round-2 MEDIUM; by founder rule MEDIUM gets no fix round and is not a gap here |
| `src/components/marketing/MarketingHeaderActions.tsx` | (SFH-R2-01) | `getUser()` returns network/5xx errors instead of throwing, so an auth outage renders "Sign in" with no log | ⚠️ Warning, recorded not fixed | Round-2 MEDIUM, same rule. A degradation path on the truth-4 surface, not the criterion itself |

No `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` on any line added since `650448ee` (scanned `git diff 650448ee..a82496148 -- src e2e`).

### Human Verification Required

1. **SC3 post-deploy pass (170-14).** Every SC3 route at 390x844 and at desktop 200% zoom in the logged-in browser, bound to the deploy SHA. Expected: slop ≤ 1 on both scrollers, no clipped primary action. Include the Allocations tab list at V960 (it scrolls inside itself there).
2. **SC1 visual read.** No near-identical stacked layers on the scenario tab and the factsheet.
3. **FC-1.** Scenario-tab screenshots with the layer-deletion options; founder answer recorded.
4. **FC-2.** Venue-label site named by the founder, or left open.

### Deferred Items

None.

### Gaps Summary

No gaps. All eight gaps from the `650448ee` verdict are closed in code and green in CI run `36829190398` at `a82496148`. The headline surface, the composed scenario, no longer overflows the document at any measured viewport, and the reflow helper now names an escaping box. What remains is human by design: the post-deploy browser pass (SC3), the SC1 visual read, and two founder decisions (FC-1, FC-2). Two round-2 MEDIUM findings and one recurring axe flake are recorded as warnings and are not gaps.

---

_Verified: 2026-10-01T07:31:04Z_
_Verifier: Claude (gsd-verifier)_


## ⭐ Resolution 2026-10-01 (plan 170-14; founder closed Phase 170 to additions)

- **Truth 20, SC3 post-deploy pass:** run 2026-10-01 in the logged-in browser at 390 / 640 / 735 CSS px against `e3b4542da`. Every measured route has zero document overflow except `/allocations?tab=holdings` (150 px at 735), routed to **Phase 170.2 item 1**. V960 was unreachable on this screen; the composed scenario and signed-out legal pages were not measured. Recorded in `170-UAT.md`.
- **Truth 1, SC1 visual read:** settled by the founder's FC-1 answer "Ship as is" (nothing deleted).
- **FC-2:** "Factsheet masthead", routed to **Phase 170.2 item 4**.
- Founder 2026-10-01: Phases 169, 169.2 and 170 are closed and nothing is added to them; defects found after landing go to Phase 170.2.
