---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 04
subsystem: ui
tags: [factsheet, view-state, palette, dark-mode-removal, localStorage, tailwind-css]

requires:
  - phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
    provides: plan 03 had already edited src/app/globals.css (accent-intensity block), so the dark blocks were deleted after it
  - phase: 193-quietview
    provides: factsheet-context.tsx persistence (range purge, `persist` gate) that this plan leaves untouched
provides:
  - factsheet view-state codec, provider and persisted write without a dark field
  - Display menu with Colorblind palette then Regimes overlay only; badge counts those two
  - data-theme always "light"; light-only resolvePalette({ colorblind }) and paletteToCssVars(palette)
  - no dark palettes, heatmap dark modes, dark analytics event or dark factsheet CSS
affects: [195-06, 195-07, factsheet, e2e svg-chart-parity]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2

plan_head_before: 9784e1ee67058f888b1594bb4cf2195a654e05fb
plan_head_after: 08e196e02f069d3ec55f425c633f248fd20e0709

tech-stack:
  added: []
  patterns:
    - "A removed persisted field is dropped at the codec decode boundary, so the next write re-encodes without it (no purge code needed)"

key-files:
  created:
    - src/app/factsheet/[id]/v2/palette.test.ts
  modified:
    - src/app/factsheet/[id]/v2/factsheet-context.tsx
    - src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts
    - src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx
    - src/app/factsheet/[id]/v2/factsheet-analytics.ts
    - src/app/factsheet/[id]/v2/factsheet-analytics.test.ts
    - src/app/factsheet/[id]/v2/palette.ts
    - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
    - src/app/factsheet/[id]/v2/HeatmapPanels.tint-contrast.test.ts
    - src/app/globals.css

key-decisions:
  - "The `?dark=1` URL param is neither read nor written nor deleted: a stale `dark=1` in a pasted link stays in the address bar but reaches nothing (plan step 2 lists the URL set/delete for removal)"
  - "The dark-toggle analytics event left the FactsheetV2Event union with its only emitter (D-06 plan decision)"

patterns-established:
  - "Display-menu contract pinned at body level: two rows in order, badge 0/1/2, article data-theme light"

requirements-completed: [LEAN-07]

coverage:
  - id: D1
    description: "Display menu lists Colorblind palette then Regimes overlay and no Dark mode; badge counts only those two (none at 0, then 1, 2)"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx#FactsheetBody — Display menu has no Dark mode (D-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stored dark value and ?dark=1 reach nothing: the codec drops dark on decode, no context exposes it, the next write carries no dark key, data-theme is always light"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts#a stored dark '1' decodes to no dark field"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx#?dark=1 and a stored dark '1' expose no dark flag, and the next write has no dark key"
        status: pass
    human_judgment: false
  - id: D3
    description: "Colorblind palette (Oxford Blue / Claret over the light base) survives; dark palettes and dark CSS are gone"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/palette.test.ts"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/HeatmapPanels.tint-contrast.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "In a real browser, a factsheet opened with ?dark=1 and one with stored dark:'1' render without data-theme=dark and with the light palette (UC-7)"
    requirement: LEAN-07
    verification: []
    human_judgment: true
    rationale: "Real-browser half of UC-7 has no automated spec in this plan (verification: backstop); the unit tests cover the same decision in jsdom"

duration: 30min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 04: Dark mode removal Summary

**The factsheet "Dark mode" option is gone end to end: the Display menu row, its badge term, the `dark` view-state field (codec, URL read, localStorage write), the dark palettes, the dark heatmap modes, the dark analytics event and every dark CSS rule, with the colorblind palette intact and pinned by a new test.**

## Performance

- **Duration:** about 30 min
- **Tasks:** 2 (1 tracer, 1 auto)
- **Files modified:** 12 (11 modified, 1 created)

## Accomplishments

- A stored `dark: "1"` blob and `?dark=1` are never read; the codec drops the field on decode so the next write re-encodes without it, and `data-theme` is always `light`.
- Display menu is Colorblind palette then Regimes overlay; badge is none at 0, then 1 or 2.
- `palette.ts` lost `DARK`, `COLORBLIND_DARK` and the dark parameter; `resolvePalette({ colorblind })` and `paletteToCssVars(palette)` are light-only; `HeatmapPanels.tsx` lost its dark foreground branch; the tint-contrast sweep runs the two light modes with unchanged 4.5:1 thresholds.
- `globals.css`: all `data-theme="dark"` rules (38 rules plus a comment mention) deleted; the four `data-theme="light"` colorblind rules stay.

## Task Commits

1. **Task 1 (tracer): the factsheet Display menu loses Dark mode; `?dark=1` and a stored dark value reach nothing** - `1e1443688` (feat)
2. **Task 2: dark palettes, dark heatmap modes and dark factsheet CSS deleted** - `08e196e02` (feat)

**Plan metadata:** this SUMMARY's own commit (docs), orchestrator owns STATE/ROADMAP.

## Re-measurements at HEAD (plan anchors)

- Phase 193 QUIETVIEW (`7f667bb29`) HAD landed on this branch (`git merge-base --is-ancestor` true). The plan premise held: every dark line the plan names still existed in `factsheet-context.tsx` (provider `darkMode` state, URL read, persisted write, URL set/delete, effect deps, context value), `FactsheetView.tsx` and the codec. Phase 193's range-purge and `persist` gate were not touched.
- `factsheet-context.tsx` diff: 18 insertions, 30 deletions (48 changed lines). The plan asked for about 25. The overshoot is comment lines that named dark (type docs, the RT2 read-gate comments, the hydration comment); code removal itself is about 20 lines and no persistence logic was refactored or reordered.
- The tracer's `<verify>` was re-run at expansion time: 37 targeted tests green, so Task 2 went ahead.

## Acceptance results

| Criterion | Result |
|---|---|
| `Dark mode` in FactsheetView.tsx | 0 (baseline 1) |
| `darkMode` in factsheet-context.tsx | 0 (baseline 10) |
| `get("dark")` in factsheet-context.tsx | 0 |
| `factsheet_v2_toggle_dark` in src e2e scripts | no hits (baseline 4 lines) |
| `factsheet_v2_toggle_colorblind` in analytics test | 2 |
| `data-theme="dark"` in globals.css | 0 (baseline 39) |
| `data-theme="light"` in globals.css | 4 (baseline 4, unchanged) |
| `COLORBLIND_DARK` in palette.ts | 0 |

## Neuter, RED, restore proofs

All restores were `cp -p` from a scratchpad byte backup, proven with `cmp` (no git checkout/restore/stash).

1. **Codec drops dark (tests first):** before the implementation the new/changed codec and provider tests failed (3 failed: legacy-blob decode still carried `dark`, `dark '1' decodes to no dark field`, `toggle-keys` still listed `darkMode`); GREEN after.
2. **No-bleed guard still bites:** removed `|| !persist` from the provider write effect, re-driven guard04 test (Colorblind toggle) went RED (1 failed), restored, `cmp` identical.
3. **Provider never re-writes dark:** added `dark: "1"` to the persisted write state; the D-06 provider test and the Case B range test went RED (2 failed), restored, `cmp` identical.
4. **Colorblind palette must stay:** neutered `resolvePalette` to ignore `COLORBLIND_LIGHT`; `palette.test.ts` colorblind case went RED (1 failed), restored, `cmp` identical.
5. **Badge term:** neutered `activeCount` to add a constant 1; the badge test (0, 1, 2) went RED (1 failed), restored, `cmp` identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] HeatmapPanels.tsx touched in Task 1**
- **Found during:** Task 1
- **Issue:** `HeatmapPanels.tsx` destructured `darkMode` from `useToggles()`, so removing the field broke `tsc` before Task 2.
- **Fix:** Task 1 passed the light value (`resolvePalette({ darkMode: false, colorblind })`) there; Task 2 removed the parameter.
- **Files modified:** src/app/factsheet/[id]/v2/HeatmapPanels.tsx
- **Committed in:** `1e1443688`

**2. [Rule 2 - Missing critical] `cb` added to the no-bleed guard's URL predicate**
- **Found during:** Task 1 (re-driving guard04 via Colorblind, as the plan directs)
- **Issue:** the plan keeps `FACTSHEET_URL_PARAM_RE` unchanged, but the Colorblind toggle writes `?cb=1`, which `range|cmp|dark` does not match, so the URL half of the guard would have been vacuous (could not fail).
- **Fix:** regex is now `/[?&](range|cmp|cb|dark)=/`, plus one predicate-scoping assertion for `?cb=1`; `dark` stays in the alternation. Proven by neuter 2 above.
- **Files modified:** src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx
- **Committed in:** `1e1443688`

**3. [Rule 2 - Missing critical] Tests added that the plan did not list**
- **Issue:** nothing pinned the colorblind palette values or the menu/badge/data-theme contract, and the plan required proving the colorblind palette stays.
- **Fix:** new `palette.test.ts`; a "Display menu has no Dark mode" describe appended to the guard04 file (reuses its mounting helpers and storage stubs).
- **Committed in:** `08e196e02`

**4. Provider tests re-driven on `cb`:** several existing provider tests used `dark` as the "hydration ran" sentinel; they now use `cb`, with a new D-06 test asserting that `?dark=1` and a stored `dark` expose no flag and the next blob has no `dark` key.

---

**Total deviations:** 4 (1 blocking, 2 missing-critical, 1 test re-drive). **Impact:** all inside the plan's files plus one new test file; no scope creep.

## Issues Encountered

None.

## Gate results

- `npx tsc --noEmit`: exit 0, no errors.
- `npm run lint`: 0 errors, 2 warnings (`nativeUnitReason` in MetricsColumn.tsx, `isRankableAnalyticsRow` in composite-read-path.ts; both pre-existing, untouched files); all `check-*` scripts OK.
- `npx vitest run "src/app/factsheet/[id]/v2"`: 102 files, 1331 tests, all passed.
- Targeted 4 plan files at Task 1: 4 files, 37 tests passed.
- `next build` not run (not a local gate).

## Expected CI effects

- Screenshot goldens expected to change: none. `e2e/svg-chart-parity.spec.ts` shoots the light default with the Display `<details>` closed and badge 0; `e2e/svg-chart-parity.spec.ts-snapshots` currently holds only a README (goldens not baked). A diff there would be a regression to investigate.
- No e2e spec references `?dark=1` or "Dark mode" (grep over `e2e`); no e2e spec expected to change.
- UC-7 real-browser half (`verification: backstop`) has no automated spec here; recorded as `human_judgment: true` in D4.

## Known Stubs

None.

## Threat Flags

None. T-195-08 (tampering via `?dark=1` / stored view state) is mitigated: the param and field are never read or written, pinned by the codec and provider tests.

## Next Phase Readiness

Plans 06 and 07 are unaffected by this plan. `src/app/globals.css` and the `v2` factsheet directory are free of dark-mode code.

## Self-Check: PASSED

- Created file present: `src/app/factsheet/[id]/v2/palette.test.ts`.
- Commits `1e1443688` and `08e196e02` are ancestors of HEAD; `git rev-list --count 9784e1ee6..HEAD` = 2 at SUMMARY time.
- No file deletions in either commit.

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*
