---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 10
subsystem: ui
tags: [factsheet, advanced-disclosure, opening-view, print-view, cross-tab-storage, census-hooks]
status: complete

requires:
  - phase: 196
    provides: "plan 05 beforeFooterSlot, plan 06 viewer chrome, plan 09 MetricsColumn part prop, plan 15 discovery detail page removal"
provides:
  - "FactsheetBody layout (document | full) and printView; FactsheetView always renders document"
  - "AdvancedDisclosure: details#factsheet-advanced, collapsed, contents mount on first open, remembered per viewer"
  - "PerformanceCharts variant (all | equity | rest), MetricsColumnWithBasis part"
  - "data-census-section hooks: equity, main-metrics, advanced"
  - "buildTearsheetHref and the ControlBar Print view link"
affects: [196-11, 196-12, 196-13, 196-14, 196-21]

key-files:
  created:
    - src/app/factsheet/[id]/v2/AdvancedDisclosure.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx
    - e2e/helpers/open-advanced.ts
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.usd-terms.test.tsx
    - src/components/auth/SignOutButton.test.tsx
    - src/lib/factsheet/origin.ts
    - src/lib/factsheet/origin.test.ts
    - e2e/svg-chart-parity.spec.ts
    - e2e/target-size.spec.ts
    - e2e/composite-factsheet-render.spec.ts
    - e2e/layout-narrow.spec.ts

key-decisions:
  - "The six CollapsibleSections moved into one internal FactsheetSections component shared by both layouts, so the full layout is unchanged and Advanced mounts the same sections, keys, defaults and gates"
  - "The Signatures gate is one predicate (signaturesSectionRenders) read by both the section mount and the Advanced contents line"
  - "Advanced storage key is factsheet-collapse:advanced (registered prefix), not the UI-SPEC's factsheet:advanced-open (RESEARCH Pitfall 6)"

requirements-completed: [LEAN-05, LEAN-02]

actuals:
  tokens: 78000
  tasks: 3
  commits: 3
plan_head_before: 056a4e5ea1283034cbd11a552fc18938044af49f
plan_head_after: ee4974da8334389309b75cb67110bd3053984686
---

# Phase 196 Plan 10: Advanced disclosure and the opening view Summary

The factsheet, share and print views now open as the KPI strip, ControlBar and one equity figure (curve plus drawdown) beside one Main metrics table, with every other section behind one native `details#factsheet-advanced` that is collapsed on the server, mounts its contents on first open, remembers the reader, and is ignored by Reset view and by the print force-open.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 400b27c75 | `layout`, `PerformanceCharts variant`, `MetricsColumnWithBasis part`, `AdvancedDisclosure` (in-memory), census hooks, `KNOWN_APP_KEYS` entry, tracer arms |
| 2 | 9625de68e | storage, print selector, Print view link, `buildTearsheetHref`, `printView`, the remaining arms (26 total in the advanced test file) |
| 3 | ee4974da8 | usd-terms test and five e2e specs moved to the new layout |

## Prop signatures for plans 11, 12 and 13

```ts
// FactsheetBodyOptions (FactsheetView.tsx)
layout?: "document" | "full";   // default "full"; FactsheetView passes "document"
printView?: boolean;            // default false; document layout only

// FactsheetView
FactsheetView({ payload, ...OwnerLaneProps, beforeFooterSlot, printView })

// internal to FactsheetView.tsx
type PerformanceVariant = "all" | "equity" | "rest";
function PerformanceCharts({ variant }: { variant?: PerformanceVariant })
function MetricsColumnWithBasis({ scenarioMode, part }: { scenarioMode: boolean; part?: MetricsPart }) // part default "all"
function FactsheetSections({ payload, showSignatures, performanceVariant })
function signaturesSectionRenders(payload, hasComparator): boolean
function advancedSectionList(showSignatures): { id: string; title: string }[]

// AdvancedDisclosure.tsx
AdvancedDisclosure({ sections: { id: string; title: string }[]; children: ReactNode })

// src/lib/factsheet/origin.ts
buildTearsheetHref(strategyId: string): string   // "/factsheet/<encoded id>/tearsheet"

// e2e/helpers/open-advanced.ts
openAdvanced(page: Page): Promise<void>
```

DOM contract for the census (plans 01, 11, 14): `[data-census-section="equity"]` wraps `MasterBrush` plus the two charts (`figure` x 2); `[data-census-section="main-metrics"]` wraps the `part="main"` rail; `[data-census-section="advanced"]` wraps `details#factsheet-advanced`. Inside the open disclosure, `[data-advanced-contents]` holds the six sections and the `part="detailed"` rail. The chart hint (`factsheet-chart-hint`) is plan 11's and is not in this plan.

Document layout order inside the article: notices, header, `topSlot`, `KpiStrip`, `ControlBar` (omitted in `printView`), the opening grid, Advanced (omitted in `printView`), `beforeFooterSlot` and `FactsheetFooter` (both omitted in `printView`). `SectionNav` is not rendered in the document layout.

## Changed test arms

`FactsheetView.usd-terms.test.tsx`: four arms now open Advanced first (the Terms panel lives in the Detailed metrics rail) and keep every assertion unchanged: "an API-verified strategy reads 'API-verified' in both views", "every tier survives the switch unchanged", "a live record never gains a backtest clause by switching to USD", "the Live since row still reports a real backtest gap in BOTH views". They became `async` and call a local `openAdvanced` (click the summary, wait for `[data-advanced-contents]`). The fixture-bites arm needed no change.

`FactsheetView.usd-toggle.test.tsx`: no edit. Every arm asserts on the strip, masthead, ControlBar, basis group or leverage input, all in the opening view; the full file passes (it was in the plan's file list as a precaution).

Pre-existing `FactsheetBody.*.test.tsx` and every other test in the v2 folder pass with no edit. `src/components/auth/SignOutButton.test.tsx`: one `KNOWN_APP_KEYS` entry added.

## e2e step additions (no e2e run here: the seeded lane needs CI)

| Spec | Change | `expect(` before / after |
|------|--------|--------------------------|
| `svg-chart-parity.spec.ts` | `openAdvanced(page)` at the end of `gotoFactsheetAndSettle`; eight of nine panels are in Advanced, only the master brush is in the opening view | 9 / 9 |
| `target-size.spec.ts` | `openAdvanced(page)` after the goto in the heatmap and streak arms (both panels are in Advanced) | 2 / 2 |
| `composite-factsheet-render.spec.ts` | `openAdvanced(page)` before each of the three axe scans, so the scan still covers every section the full factsheet carried; the strip and stitched-summary assertions are in the opening view and untouched | 20 / 20 |
| `layout-narrow.spec.ts` (re-read fresh after Phase 197; no conflict) | factsheet-body arm only: tiles asserted on the opening view, then `openAdvanced` before `assertNoReflow("#factsheet-main")` so the reflow walk covers the whole article | 103 / 103 |
| `full-flow.spec.ts` | none: it asserts the masthead h1, "Institutional Factsheet" and (self-skipped) the strip's CAGR and Sharpe, all in the opening view | 22 / 22 |

`playwright test --list` over the five specs exits 0 (85 tests).

## Neuter evidence (every record: backup in the scratchpad, edit, run, RED naming the arm, restore with `cp -p`, `cmp` exit 0, GREEN)

1. `AdvancedDisclosure.tsx`: `{everOpened && (` changed to `{(everOpened || true) && (`. RED, 5 arms, including `shows no chart outside the equity pair while Advanced is closed` (`expected <figure ...>`), `server-renders closed with no contents, whatever storage holds` (`not to contain 'data-probe'`), and the two Reset view and garbage-storage arms. Restored, `cmp` exit 0, 26 passed.
2. `FactsheetView.tsx`: `PRINT_FORCE_OPEN_SELECTOR` changed from `details:not(#factsheet-advanced)` to `details`. RED, 2 arms: `beforeprint leaves a closed Advanced closed, forces the other details open, afterprint restores` and `beforeprint keeps an Advanced the reader closed after opening it closed` (`expected true to be false`). Restored, `cmp` exit 0, 26 passed.
3. `FactsheetView.tsx`, Print view gate: removing `!recipientShare` alone stayed GREEN, because `shareMode` in `ControlBar` already ORs `recipientShare` (the term is redundant belt-and-braces, kept). Removing `!shareMode` and `!recipientShare` together went RED on `is absent for a share-token recipient` and `is absent in ?share=1 share mode, like every outbound link`. Restored, `cmp` exit 0, 26 passed.

Full layout identity: the HEAD copy of `FactsheetView.tsx` was loaded beside the new one and `FactsheetBody` (no layout prop) rendered from both over census fixtures A, B and C: 3 of 3 `innerHTML` equal, each over 5,000 characters. The temporary copy and test were deleted, not committed.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2"`: 114 files, 1515 tests passed.
- `npx vitest run "src/app/factsheet/[id]/v2" src/components/auth src/lib/factsheet/origin.test.ts "src/app/(dashboard)/allocations"`: 306 files, 4794 tests passed (allocator suites untouched).
- `FactsheetBody.advanced.test.tsx`: 26 arms (plan floor 12). `origin.test.ts`: 56 passed.
- Also green: `src/app/factsheet-share`, `src/app/api/og/factsheet`, `src/components/strategy`, `src/components/layout`, `phase-52-frozen-spine-guards`, `trim-removed-surfaces`, `src/app/(dashboard)/strategies` (147 files, 2678 tests), and `scripts/factsheet-census` (19 tests).
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors; 2 warnings, both pre-existing (`nativeUnitReason` in `MetricsColumn.tsx`, `isRankableAnalyticsRow` in `composite-read-path.ts`); trailing checks (route contract, planning hygiene) OK.
- Acceptance greps: `id="factsheet-advanced"` in `AdvancedDisclosure.tsx` 1; `data-census-section=` in `FactsheetView.tsx` 3; `"factsheet-collapse:advanced"` in `SignOutButton.test.tsx` 1; `factsheet-advanced` in `FactsheetView.tsx` 2; `COLLAPSIBLE_OPEN_ALL_EVENT` in `AdvancedDisclosure.tsx` 0; `Print view` in `FactsheetView.tsx` 3; `factsheet-advanced` in `svg-chart-parity` 1, `target-size` 2, `composite-factsheet-render` 3.

## Deviations from Plan

### Auto-added

**1. [Rule 3 - structure] Shared `FactsheetSections`, `signaturesSectionRenders`, `advancedSectionList`.** The plan said to build the contents line from "the same conditions that mount each section, in one array". Both layouts mount the same six sections, so they were moved into one internal component rather than copied (about 80 lines). The Signatures gate is one predicate used by the mount and by the contents line, and an arm in the advanced test compares the line to the `details` actually mounted. Verified byte-identical full output (above). Commit 400b27c75.

**2. [Rule 3 - blocking] New file `e2e/helpers/open-advanced.ts`** (outside the plan's file list). Four specs need the same click-and-wait step; one helper is smaller than four inline copies and keeps the four in step. It clicks only when the disclosure is closed, so a viewer whose stored state is already open does not get it toggled shut. Commit ee4974da8.

### Decisions and observations (not deviations)

- The composite sr-only "Stitched from N keys" summary and the basis caption plus its `role="status"` region go with the equity variant (they describe the series the opening charts draw); the rolling-window choice and the not-enough-data panels go with `rest`. A strict-mode locator in the composite e2e therefore still finds exactly one stitched summary.
- `MetricsColumnWithBasis` renders its BASIS eyebrow wrapper for every `part`. On a composite (or MTM-participant) strategy the eyebrow therefore shows once above the Main metrics table and once above the Detailed metrics rail when Advanced is open. It is the same label for the same basis, and the e2e eyebrow locators run with Advanced closed, so nothing breaks; plan 11 or 14 may choose to drop it from `detailed`. Left unchanged to keep the rail's original behaviour.
- The Advanced summary row carries `factsheet-v2-no-print`, per UI-SPEC. The contents do not, so an open Advanced prints.
- `printView` keeps `MasterBrush` (it is a `factsheet-v2-no-print` control and the plan's list of removals does not name it).

## Golden note (not re-baked, as instructed)

Plan 09's document variant drops the Point column of the Bootstrap panel, so `bootstrap-ci-*` goldens may mismatch. Beyond that flagged case, the two `full-page-*` goldens (desktop and 2560) capture the whole page and now show the new layout (opening view plus an opened Advanced), so they will also mismatch by construction; this is the intended layout change, not a defect in a panel. Per-panel crops should be unaffected. Both are ship notes for the CI `workflow_dispatch` bake (`bake_svg_goldens`); the orchestrator should decide whether to bake on the phase branch.

## Not measured

- No e2e spec was run (the seeded lane needs the TEST database env and CI). The click on `#factsheet-advanced > summary` and the wait on `[data-advanced-contents]` are covered in jsdom only; real Chromium's `toggle` event on a React-controlled `open` attribute follows the same idiom `CollapsibleSection` already ships.
- The "contents line with every section present wraps under the title on narrow widths and is never truncated" and "Advanced open state across two tabs" backstops are by construction (`flex-wrap`, no `truncate`, the cross-tab primitive plus a jsdom StorageEvent arm) and have no visual check here.
- No PROD access was used or needed.

## Known Stubs

None. No TODO, placeholder or hardcoded-empty value was introduced.

## Threat Flags

None. The new surface is one same-origin link (`/factsheet/<id>/tearsheet`, built through `encodeURIComponent`, shown only on a published lane) and one localStorage key under a registered purge prefix; both are in the plan's threat register (T-196-22, T-196-23, T-196-24).

## Self-Check: PASSED

Created files found: `AdvancedDisclosure.tsx`, `FactsheetBody.advanced.test.tsx`, `e2e/helpers/open-advanced.ts`. Commits 400b27c75, 9625de68e, ee4974da8 are ancestors of HEAD. `git rev-list --count 056a4e5ea..HEAD` is 3.
