---
phase: 31-graphs-lead-layout-collapsible-controls
plan: 02
subsystem: ui
tags: [react, collapsible-section, details-element, scenario-composer, regression-test, frozen-spine-guard]

# Dependency graph
requires:
  - phase: 31-01
    provides: "Lifted CollapsibleSection primitive at @/components/ui/CollapsibleSection (native <details>, storageKey persistence, optional onToggle)"
  - phase: 30
    provides: "Factsheet-grade blend graphs (Correlation, Returns distribution, Rolling metrics) already DOM-ordered before CompositionList in ScenarioComposer"
  - phase: 29
    provides: "Unified ScenarioComposer spine hosting the composition controls"
provides:
  - "CompositionList wrapped in the lifted CollapsibleSection (hide-don't-unmount) so the graphs lead when the controls are collapsed (LAYOUT-01)"
  - "Composer-scoped collapse persistence via storageKey composer-collapse:controls (independent of the factsheet-collapse: namespace)"
  - "Non-vacuous LAYOUT-02 regression test proving weight + leverage edits survive collapse->expand and the projection still reflects them (Pitfall 5)"
  - "phase-31-frozen-spine-guards.test.ts — durable structural gate: scenario.ts/scenario.test.ts zero-diff + no-conditional-mount of CompositionList"
affects: [phase-32-dead-link-fix-route-retirement, phase-33-journey-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hide-don't-unmount: wrap edit-bearing controls in a native <details> CollapsibleSection so collapse HIDES (never unmounts) the children; edit state stays in the parent above the collapsible boundary and survives collapse->expand by construction"
    - "Content-inspecting structural exit-gate guard: readFileSync the host source and assert the wrap relationship AND the absence of a conditional-mount pattern, so a silent regression fails CI even without rerunning the behavioral test"

key-files:
  created:
    - "src/__tests__/phase-31-frozen-spine-guards.test.ts"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "CompositionList wrapped as an UNCONDITIONAL child of CollapsibleSection (never {open && <CompositionList}) — native <details> hides a mounted child, so leverageByRef + scenario.draft.weightOverrides (parent state) survive collapse"
  - "defaultOpen=true (expanded first load) + composer-scoped storageKey composer-collapse:controls; no onToggle (composer collapse analytics out of scope this phase)"
  - "No panel reorder — graphs already render before CompositionList in DOM order, so collapsing the controls alone makes the graphs lead (surgical, per 31-CONTEXT)"
  - "FALLBACK_BASE_SHA for the phase-31 guard = 94f36e4e (execution-time HEAD / phase branch point); merge-base origin/main..HEAD = b8a0337b (v1.2 base) used in CI"

patterns-established:
  - "Hide-don't-unmount wrap for edit-bearing collapsible UI (the LAYOUT-02 / Pitfall 5 invariant)"
  - "Phase exit-gate guard pairs a behavioral regression test (runtime survival) with a content-inspecting structural guard (durable, runs even when the behavioral test is not re-executed)"

requirements-completed: [LAYOUT-01, LAYOUT-02]

# Metrics
duration: 7 min
completed: 2026-06-23
---

# Phase 31 Plan 02: Graphs-Lead Layout & Collapsible Controls Summary

**Wrapped the ScenarioComposer's CompositionList (toggle/weight/leverage) in the lifted CollapsibleSection so the factsheet graphs lead when collapsed — native `<details>` keeps the controls MOUNTED and parent-held edits survive collapse→expand, durably guarded by a non-vacuous regression test plus a content-inspecting no-conditional-mount exit gate.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-23T16:59:42Z
- **Completed:** 2026-06-23T17:06:46Z
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **LAYOUT-01** — `CompositionList` is now wrapped in `<CollapsibleSection id="composer-composition-controls" title="Strategies & weights" defaultOpen storageKey="composer-collapse:controls">`. The Phase-30 graphs (Correlation, Returns distribution, Rolling metrics) already render above it in DOM order, so collapsing the controls gives the graphs the full surface with zero panel reorder. The collapse choice persists across reloads via the composer-scoped storageKey.
- **LAYOUT-02 (Pitfall 5)** — Hide-don't-unmount holds by construction: the native `<details>` keeps `CompositionList` mounted when collapsed, and the edit state (`leverageByRef` at the parent top, `scenario.draft.weightOverrides`) lives ABOVE the collapsible boundary, so in-progress weight + leverage edits survive collapse→expand. Proven by a non-vacuous regression test.
- **Durable structural guard** — `phase-31-frozen-spine-guards.test.ts` enforces both phase invariants: the frozen engine (`scenario.ts`/`scenario.test.ts`) stays zero-diff vs the phase baseline (fail-loud if the baseline ref is unresolvable), AND no conditional MOUNT of `CompositionList` can be reintroduced (`&& <CompositionList` or a ternary mount both fail the gate).

## Task Commits

Each task was committed atomically:

1. **Task 1: Wrap CompositionList in the lifted CollapsibleSection** - `19b2d202` (feat)
2. **Task 2: Non-vacuous type→collapse→expand→survives regression test** - `5aeaecfa` (test)
3. **Task 3: Phase-31 frozen-spine + no-conditional-mount exit-gate guard** - `4a59eb19` (test)

**Plan metadata:** (this SUMMARY commit)

_Note: Task 2 is a regression-guard for the already-shipped Task-1 wrap, so it is a single `test(...)` commit (passes against the wrap, fails on the conditional-mount regression) rather than a RED→GREEN pair._

## Files Created/Modified

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - Added the `CollapsibleSection` import; wrapped the existing `<CompositionList />` render site in `<CollapsibleSection>` (unconditional child). No CompositionList prop change, no state relocation, no panel reorder, no engine touch.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - Added the LAYOUT-02 regression test: types a non-default weight (0.250) + leverage (2), asserts the projection (KpiStrip scenarioMetrics twr/volatility) moved off baseline (non-vacuity), collapses + expands the `<details>`, and asserts both inputs survive AND the projection still reflects the edits.
- `src/__tests__/phase-31-frozen-spine-guards.test.ts` - New exit-gate guard. Git-delta frozen-engine zero-diff (mirrors phase-30, fail-loud baseline) + content-inspecting wrap-present + no-conditional-mount gates over ScenarioComposer.tsx.

## Decisions Made

- **CompositionList is an unconditional child of CollapsibleSection.** The whole point of the native `<details>` wrap is to HIDE a mounted child; a `{open && <CompositionList}` conditional would unmount it on collapse and wipe parent-held edits. Followed the plan/CONTEXT exactly.
- **defaultOpen=true, composer-scoped storageKey, no onToggle** — per 31-CONTEXT: an allocator composing needs the controls visible; hiding to focus on graphs is opt-in. The composer key is independent of the factsheet `factsheet-collapse:` namespace, and composer collapse analytics are out of scope this phase.
- **Guard FALLBACK_BASE_SHA = 94f36e4e** — the execution-time HEAD (phase branch point on the feature branch), used only when `merge-base origin/main HEAD` is unavailable (shallow CI clone). In this environment the merge-base resolved to `b8a0337b` (the v1.2 milestone base) and the phase delta correctly excludes the frozen engine.

## Deviations from Plan

None - plan executed exactly as written.

The only adjustments were within-task corrections, not deviations:
- Task 1: my explanatory comment originally contained the literal forbidden pattern `{open && <CompositionList ...>}` as a "do NOT do this" example, which tripped both the acceptance grep and would have tripped the Task-3 guard. Reworded the comment to describe the prohibition without embedding the pattern. (Same-task fix, no behavior change.)
- Task 2: the plan's illustrative "0.000 default" assumed an added strategy starts at weight 0.000, but the test's `mockHoldingPlusStrategy()` adapter seeds the added strategy at weight 0.500. Dropped the brittle hardcoded-default sanity assertion and instead captured the actual pre-edit value and asserted the edit differs from it — the non-vacuity is carried by the projection-moves-off-baseline assertion (the load-bearing check), exactly as the plan specifies. (Same-task fix; the gate's intent — non-default edits before collapse — is fully satisfied.)

## Issues Encountered

- **`mockHoldingPlusStrategy()` seeds weight 0.500, not 0.000.** First test run failed on a wrong default-value assumption (expected '0.000', got '0.500'). Resolved by reading the pre-edit value dynamically and asserting the post-edit value differs — keeps the test honest about whatever default the adapter seeds. All 77 tests in the file then passed.
- **`grep -Pzoc` is environment-specific** (the shell aliases `grep` to `ugrep` here, which handles `-Pz` differently and returned 0 for the wrap match). Confirmed the wrap relationship via perl multiline match and line-ordering instead; the canonical durable check is the Task-3 guard's `readFileSync` + JS-regex enclosure assertion, which passes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- LAYOUT-01 + LAYOUT-02 complete; the composer collapse surface is settled. Phase 32 (Dead-Link Fix & Route Retirement) and Phase 33 (Journey Polish) can build on the settled layout.
- Verification all green: `npx tsc --noEmit` clean; 93 tests pass across ScenarioComposer.test.tsx (77) + phase-31-frozen-spine-guards.test.ts (5) + CollapsibleSection.test.tsx (11); frozen engine `scenario.ts`/`scenario.test.ts` zero-diff.
- No blockers.

## Self-Check: PASSED

- Files created/modified exist on disk: `ScenarioComposer.tsx`, `ScenarioComposer.test.tsx`, `phase-31-frozen-spine-guards.test.ts` — all FOUND.
- Task commits reachable: `19b2d202`, `5aeaecfa`, `4a59eb19` — all FOUND.
- Plan-level verification re-run green: tsc clean, all three suites pass (93 tests), engine zero-diff.

---
*Phase: 31-graphs-lead-layout-collapsible-controls*
*Completed: 2026-06-23*
