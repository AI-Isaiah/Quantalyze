---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 03
subsystem: ui
tags: [react, tweaks, density, strategy-table, vitest, css]

requires:
  - phase: 195-trim (plan 01)
    provides: "branch and the route/sidebar retirements this plan sits beside; no code dependency"
provides:
  - "/allocations shell with no Tweaks provider, toggle, panel or Outcomes redirect guard; header row reads Export then the add button"
  - "EquityChart with fixed defaults (area fill, BTC benchmark always shown) and no tweak hook"
  - "StrategyTable without the density strip; rows stay at the :root 44px; view toggle and data-strategy-table marker intact"
  - "Tests pinning that a stale stored allocations.tweaks value changes nothing"
affects: [195-04 dark-factsheet CSS removal, 195-07 guard test]

plan_head_before: 872a11760df7bbc5133a5fa9cfb78428dd29527c
plan_head_after: f995f29efd7971e1b7891c0e9487ffb1b0a6ac7b

actuals:
  tokens: 40000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "removed-knob pin: seed the FULL set of stale non-default stored values and assert none reaches the DOM or the render"

key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChart.fixed-defaults.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChartWidget.header.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/EquityChartWidget.payload-contract.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/equity-curve.equitydailypoints.test.tsx"
    - "src/app/(dashboard)/allocations/components/BridgeWidget.tsx"
    - "src/__tests__/contracts/contracts-registry.test.ts"
    - "src/app/globals.css"
    - "e2e/layout-narrow.spec.ts"
    - "src/components/strategy/StrategyTable.tsx"
    - "src/components/strategy/StrategyTable.test.tsx"
    - "src/components/strategy/StrategyTable.default-mounts.test.tsx"
    - "src/components/strategy/StrategyTable.manager-rows.test.tsx"
    - "src/components/strategy/__fixtures__/strategy-table-default-mounts.json"
  deleted:
    - "allocations/components/Tweaks.tsx, Tweaks.test.tsx, TweaksToggle.tsx"
    - "allocations/context/TweaksContext.tsx, TweaksContext.codec.test.ts"
    - "allocations/widgets/performance/EquityChart.tweaks.test.tsx"
    - "src/lib/view-transition.ts, view-transition.test.ts"

key-decisions:
  - "Kept the stale-value coverage as a new EquityChart.fixed-defaults.test.tsx instead of only deleting EquityChart.tweaks.test.tsx: the default-behaviour pins (always area, always benchmark) are the S-6 truth and still worth having."
  - "view-transition helper deleted (dead code created by this change); the ::view-transition reduced-motion CSS guard stays, its comment reworded to stop citing the deleted helper."
  - "Contract-registry floor note placed after the existing 'RAISED 63 -> 64' block (chronological, matching the file's convention), not above it as the plan text said."

requirements-completed: [LEAN-07]

coverage:
  - id: D1
    description: "The /allocations header action row reads Export then the add button with no Tweaks control and no empty slot; no Tweaks panel renders"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx#[D-05] the header action row holds Export then the add button, and no Tweaks control"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stale stored allocations.tweaks value (all knobs non-default) hides nothing: Outcomes tab present and reachable by keyboard, no redirect off ?tab=outcomes, none of body[data-density|data-display-font|data-show-outcomes] or html[data-accent-intensity] is set"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx#AllocationsTabs - a stored Tweaks value changes nothing (Phase 195 D-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The equity chart always draws the area fill and the BTC benchmark (chip and dashed path), even with a stale stored chartStyle=line / showBench=false"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/widgets/performance/EquityChart.fixed-defaults.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "StrategyTable renders no 'Table density' group and no data-density on any mounting surface; the table/grid view toggle still switches views; the three default mounts match the hand-edited fixture"
    requirement: LEAN-07
    verification:
      - kind: unit
        ref: "src/components/strategy/StrategyTable.test.tsx#renders no 'Table density' group, no Comfortable/Compact buttons and no data-density; the view toggle stays"
        status: pass
      - kind: unit
        ref: "src/components/strategy/StrategyTable.default-mounts.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real browser seeded with allocations.tweaks = non-default values renders /allocations with every S-6 default (accent, serif display, Outcomes visible, 44px rows) (UC-6 backstop)"
    requirement: LEAN-07
    verification: []
    human_judgment: true
    rationale: "The unit tests prove no read path and no DOM attribute write; the visual end state in a real browser is a CI/UAT backstop that cannot run locally (no seeded build)."

duration: 12min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 03: Remove the Tweaks panel and the table density toggle Summary

**The allocator Tweaks panel, its context and every storage read or DOM-attribute write are gone (area chart and benchmark are fixed defaults, Outcomes is always a tab), and the discovery table lost its density strip while keeping the table/grid toggle and the `data-strategy-table` marker.**

## Performance

- **Duration:** about 12 min
- **Started:** about 2026-11-07T11:46Z (estimated from first test run; not recorded at spawn)
- **Completed:** 2026-11-07T11:57Z
- **Tasks:** 3
- **Files modified:** 24 (358 insertions, 2712 deletions over 3 commits)

## Accomplishments

- `/allocations` shell: no Tweaks provider, header toggle, floating panel or `OutcomesTabRedirectGuard`; keyboard tab navigation no longer reads `body[data-show-outcomes]`; header row is Export then the add button (with its existing `ml-1`).
- `TweaksContext.tsx` deleted; `EquityChart` always draws the area fill and the BTC benchmark; all consumers fixed; no code reads `allocations.tweaks` (only the sign-out purge test, the new stale-value tests and comments name the key).
- CSS: `body[data-density]`, `[data-allocator-dashboard]` density overrides, `data-show-outcomes`, `data-display-font`, the whole `html[data-accent-intensity]` block (including its dark-factsheet re-assert) and the `[data-strategy-table][data-density]` rules are deleted. `:root` `--row-h: 44px` / `--density-pad: 16px` stay. The `.factsheet-v2-shell[data-theme="dark"]` blocks are untouched (plan 04).
- `StrategyTable`: density state, handler, `data-density`, effect dependency and the whole strip removed; sticky-header and frame-measure assertions still pass untouched.
- `src/lib/view-transition.ts` (+test) removed with its only caller.

## Task Commits

1. **Task 1 (tracer): Tweaks out of the shell, toggle and CSS** - `ffff6311a` (feat)
2. **Task 2: delete the Tweaks context, fix consumers to defaults, move the registry census** - `a7fd669af` (refactor)
3. **Task 3: remove the density strip, hand-edit the fixture, delete view-transition** - `f995f29ef` (feat)

**Plan metadata:** the SUMMARY commit (docs) follows this file.

## Grep gates (HEAD baseline -> after)

| Gate | HEAD | After |
|------|------|-------|
| `Tweaks.tsx` / `TweaksToggle.tsx` / `TweaksContext.tsx` exist | yes | no / no / no |
| `TweaksToggle` in AllocationsTabs.tsx | 2 | 0 |
| `data-accent-intensity` in globals.css | 3 | 0 |
| `body\[data-density` in globals.css | 7 | 0 |
| `TWEAKS_PANEL` in layout-narrow.spec.ts | present | 0 |
| `grep -E "from .*TweaksContext\|useTweakValue\(\|<TweaksProvider" src` | hits | none |
| `TweaksContext.codec.test.ts` in contracts-registry.test.ts | 1 | 0 |
| `^  { path:` rows in contracts-registry.test.ts | 64 | 63 |
| `toBeGreaterThanOrEqual(63)` in contracts-registry.test.ts | 0 | 1 |
| `TweaksContext` in contracts/REGISTRY.md | 0 | 0 (not edited) |
| `aria-label="Table density"` in StrategyTable.tsx | 1 | 0 |
| `data-density=` in StrategyTable.tsx | 1 | 0 |
| `data-strategy-table` in StrategyTable.tsx | 2 | 2 |
| `Table density` in default-mounts fixture | 3 | 0 |
| `NEXT SURGICAL EDIT 2026-11-07` in default-mounts test | 0 | 1 |
| `src/lib/view-transition.ts` exists | yes | no |

Interpretation note: the criterion "`grep -a -rn "allocations.tweaks" src --include='*.ts' --include='*.tsx' | grep -a -v SignOutButton` prints nothing" cannot hold literally, because the plan also requires stale-value tests that seed that key. The remaining hits are the four tests that seed it on purpose and two comments. No production code names the key.

## Fixture diff (`strategy-table-default-mounts.json`)

By hand, textual (no regeneration, the test has no write path): the identical 503-character strip string was removed from each of the three mounts (`discovery` 22008 -> 21505, `browse` 16668 -> 16165, `myStrategiesOwner` 24925 -> 24422 characters; a 3-line / 3-line diff). The removed text, in each mount, sat directly after the frame's opening tag and before the ResponsiveTable region:

```
<div class="flex items-center justify-end border-b border-border px-4 py-2"><div role="group" aria-label="Table density" class="inline-flex overflow-hidden rounded-lg border border-border"><button type="button" aria-pressed="true" class="px-3 py-1 text-caption transition-colors bg-page text-accent">Comfortable</button><button type="button" aria-pressed="false" class="border-l border-border px-3 py-1 text-caption transition-colors text-text-muted hover:text-text-primary">Compact</button></div></div>
```

`data-density` was never serialised (comfortable renders it `undefined`), so no attribute hunk. A dated line "NEXT SURGICAL EDIT 2026-11-07 (Phase 195 D-07)" was added to the test docblock.

## Neuter -> RED -> restore proofs

| Guard | Neuter | RED observed | Restore |
|-------|--------|--------------|---------|
| `AllocationsTabs.test.tsx` D-05 tests (header row, stale-value x3) | tests written first, against production code that still mounted Tweaks | 4 failed (header row, redirect off Outcomes, body attributes set, ArrowRight skipping Outcomes) | production edit made them green (52/52) |
| `EquityChart.fixed-defaults.test.tsx` | `{false && ...}` on the area path and the dashed benchmark path in `EquityChart.tsx` | 3 of 3 failed | `cp -p` from byte backup, `cmp` equal, 3/3 green |
| `StrategyTable.test.tsx` no-density test | test written first, strip still in `StrategyTable.tsx` | 1 failed ("Table density" group found) | production edit made it green |
| `StrategyTable.test.tsx` + `default-mounts` | re-added `data-density="tight"` to the frame in `StrategyTable.tsx` | 4 failed across the two files (no-density test and the byte-identity pins) | `cp -p` from byte backup, `cmp` equal, 98/98 green with manager-rows |

## Gate results

- `npx tsc --noEmit`: clean (no output) after each task.
- `npm run lint`: exit 0; 0 errors, 2 pre-existing warnings (unused vars in `MetricsColumn.tsx` and `composite-read-path.ts`, untouched here); route-contract, admin-route, planning-hygiene and canonical-domain checks OK.
- `npx vitest run "src/app/(dashboard)/allocations" src/__tests__/contracts/contracts-registry.test.ts`: 161 files, 2779 passed.
- `npx vitest run src/components/strategy`: 74 files, all passed after the manager-rows fix (the earlier run had 1 failure, see Deviations).
- Wider `src/components/strategy src/lib`: 361 files, 8428 passed, 26 skipped, 2 failed: `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C, a last-digit floating-point snapshot difference (`skew` -0.11360716852722537 vs ...538). Not touched by this plan (no factsheet compute file changed); recorded as pre-existing and out of scope, not fixed.
- `next build` not run (not a local gate on the symlinked node_modules).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `StrategyTable.manager-rows.test.tsx` clicked the removed density buttons**
- **Found during:** Task 3
- **Issue:** the "mount once" test (not in the plan's file list) clicked "Compact" / "Comfortable" and failed once the strip was gone.
- **Fix:** removed the density step from that test (its sort and search steps still prove the row identity invariant) and its title and comment mentions.
- **Files modified:** `src/components/strategy/StrategyTable.manager-rows.test.tsx`
- **Verification:** 98/98 across StrategyTable, default-mounts and manager-rows.
- **Committed in:** `f995f29ef`

**2. [Rule 2 - Missing coverage] Replaced the deleted tweaks test with `EquityChart.fixed-defaults.test.tsx`**
- **Found during:** Task 2
- **Issue:** the plan said to delete `EquityChart.tweaks.test.tsx` outright, which would leave no test that the chart still draws the area fill and benchmark (the S-6 defaults) or that a stale stored value cannot hide them (T-195-07).
- **Fix:** deleted the old file; added a small new one pinning always-area, always-benchmark, and stale-value-changes-nothing.
- **Files modified:** `EquityChart.fixed-defaults.test.tsx` (new)
- **Verification:** neuter -> 3/3 RED -> restore -> 3/3 green.
- **Committed in:** `a7fd669af`

**3. [Rule 3 - Blocking] Reworded the `Phase 50 / STATE-04` reduced-motion comment in globals.css**
- **Found during:** Task 3
- **Issue:** the comment cited the deleted `src/lib/view-transition.ts` helper. The `::view-transition-*` CSS itself is unchanged.
- **Files modified:** `src/app/globals.css`
- **Committed in:** `f995f29ef`

**4. Placement note (not a defect):** the dated "LOWERED 64 -> 63" census comment sits after the existing "RAISED 63 -> 64" block, not above it, to keep the file's chronological ordering.

**5. Interpretation note:** the `allocations.tweaks` grep criterion (see Grep gates) cannot literally print nothing while the plan's own stale-value tests exist.

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing coverage) plus 2 notes. **Impact:** no scope creep; all necessary to keep the suite honest.

### Authentication gates

None.

## Issues Encountered

- A first CSS edit used a non-unique anchor (`Phase 50 / STATE-04` appears twice in `globals.css`) and cut the reduced-motion block. Caught immediately from the diff; rebuilt from a copy of the HEAD file in the scratchpad with unique anchors, then re-diffed. Nothing was committed from the bad state.

## Known Stubs

None.

## Threat Flags

None. This plan only removes a localStorage read and DOM writes (T-195-07 mitigated and test-pinned); no new endpoint, auth path or schema.

## STATE.md and ROADMAP.md

Not updated (orchestrator-owned per the dispatch rules). LEAN-07 is declared by this plan; `requirements.mark-complete` is the orchestrator's call after the shared-ID gate.

## Expected CI changes (e2e, CI only)

- `e2e/layout-narrow.spec.ts`: the "Tweaks - N-TWEAKS" describe (4 viewport cases) no longer exists; the other describes are unchanged.
- Specs keying on `data-strategy-table` settle signals are unchanged; any spec that clicked "Compact" / "Comfortable" or read `data-density` would break (`grep` found none in `e2e/`).
- Screenshot goldens expected to change: none (no golden renders `/allocations`, the discovery table or the density strip). A diff in a golden is a regression. Executors do not re-bake goldens.
- UC-6 backstop (real-browser seeded stale value renders every S-6 default) is CI/UAT only.

## Next Phase Readiness

Plan 04 can remove the `.factsheet-v2-shell[data-theme="dark"]` CSS blocks: every other Tweaks/density rule in `src/app/globals.css` is already gone. No blockers.

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*

## Self-Check: PASSED

- Created/changed files exist: `EquityChart.fixed-defaults.test.tsx` found; deleted files (`Tweaks.tsx`, `TweaksToggle.tsx`, `TweaksContext.tsx`, `view-transition.ts`) absent.
- Commits `ffff6311a`, `a7fd669af`, `f995f29ef` are ancestors of HEAD; measured `commits: 3` from the plan ledger.
- All task acceptance criteria re-run and passing (table above, with the one interpretation note); plan-level verification (tsc, lint, targeted vitest) green.
